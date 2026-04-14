import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// ─── Get Evolution API config for account ────────────────────────
router.get('/evolution-config', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const account = db.prepare('SELECT evolution_api_url, evolution_api_key FROM accounts WHERE id = ?').get(req.accountId)
  res.json({ api_url: account?.evolution_api_url || '', api_key: account?.evolution_api_key || '' })
})

// ─── Save Evolution API config for account ───────────────────────
router.put('/evolution-config', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { api_url, api_key } = req.body
  if (!api_url || !api_key) return res.status(400).json({ error: 'api_url e api_key obrigatorios' })
  const baseUrl = api_url.replace(/\/+$/, '')
  db.prepare("UPDATE accounts SET evolution_api_url = ?, evolution_api_key = ?, updated_at = datetime('now') WHERE id = ?").run(baseUrl, api_key, req.accountId)
  res.json({ ok: true, api_url: baseUrl })
})

// ─── List WhatsApp instances ─────────────────────────────────────
router.get('/whatsapp', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const instances = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? ORDER BY created_at DESC').all(req.accountId)
  res.json({ instances })
})

// ─── Create instance on Evolution API + get QR code ──────────────
router.post('/whatsapp', requireRole('super_admin', 'gerente'), async (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { instance_name } = req.body
  if (!instance_name) return res.status(400).json({ error: 'instance_name obrigatorio' })

  // Get Evolution API credentials from account config (or fallback to body for backwards compat)
  const account = db.prepare('SELECT evolution_api_url, evolution_api_key FROM accounts WHERE id = ?').get(req.accountId)
  const api_url = req.body.api_url || account?.evolution_api_url
  const api_key = req.body.api_key || account?.evolution_api_key
  if (!api_url || !api_key) return res.status(400).json({ error: 'Configure a Evolution API primeiro em Integracoes' })

  // Normalize api_url (remove trailing slash)
  const baseUrl = api_url.replace(/\/+$/, '')

  // Check if instance already exists in DB
  const existing = db.prepare('SELECT id FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(req.accountId, instance_name)
  if (existing) {
    db.prepare("UPDATE whatsapp_instances SET api_url = ?, api_key = ?, updated_at = datetime('now') WHERE id = ?").run(baseUrl, api_key, existing.id)
    const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(existing.id)
    return res.json({ instance })
  }

  // Create instance on Evolution API
  let qrCode = null
  try {
    const createRes = await fetch(`${baseUrl}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: api_key },
      body: JSON.stringify({ instanceName: instance_name, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
    })
    const createData = await createRes.json()
    qrCode = createData?.qrcode?.base64 || createData?.base64 || null
  } catch (err) {
    console.error('[Evolution Create Instance]', err.message)
  }

  // Save to DB
  const result = db.prepare(
    'INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, qr_code) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.accountId, instance_name, baseUrl, api_key, qrCode ? 'connecting' : 'disconnected', qrCode)
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(result.lastInsertRowid)

  // Setup webhook automatically
  try {
    const account = db.prepare('SELECT slug FROM accounts WHERE id = ?').get(req.accountId)
    // Use env or build from request
    const proto = req.get('x-forwarded-proto') || req.protocol
    const serverUrl = process.env.WEBHOOK_BASE_URL || `${proto}://${req.get('host')}`
    const webhookUrl = `${serverUrl}/crm/api/webhooks/evolution/${account.slug}`
    await fetch(`${baseUrl}/webhook/set/${instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: api_key },
      body: JSON.stringify({ url: webhookUrl, webhook_by_events: false, events: ['MESSAGES_UPSERT'] }),
    })
    console.log(`[Evolution Webhook] Set for ${instance_name} → ${webhookUrl}`)
  } catch (err) {
    console.error('[Evolution Webhook Setup]', err.message)
  }

  res.json({ instance })
})

// ─── Connect (get QR code for existing instance) ─────────────────
router.post('/whatsapp/:id/connect', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (!instance) return res.status(404).json({ error: 'Instancia nao encontrada' })

  try {
    const r = await fetch(`${instance.api_url}/instance/connect/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const qrCode = data?.base64 || data?.qrcode || null

    db.prepare("UPDATE whatsapp_instances SET qr_code = ?, status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(qrCode, instance.id)
    const updated = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
    res.json({ instance: updated })
  } catch (err) {
    console.error('[Evolution Connect]', err.message)
    res.status(500).json({ error: 'Falha ao conectar: ' + err.message })
  }
})

// ─── Check connection status ─────────────────────────────────────
router.get('/whatsapp/:id/status', async (req, res) => {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (!instance) return res.status(404).json({ error: 'Instancia nao encontrada' })

  try {
    const r = await fetch(`${instance.api_url}/instance/connectionState/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const state = data?.instance?.state || data?.state || ''

    let status = 'disconnected'
    if (state === 'open' || state === 'connected') status = 'connected'
    else if (state === 'connecting') status = 'connecting'

    // If connected, clear QR code and save phone number if available
    const updates = { status }
    if (status === 'connected') {
      updates.qr_code = null
    }

    db.prepare(`UPDATE whatsapp_instances SET status = ?, qr_code = ?, updated_at = datetime('now') WHERE id = ?`).run(
      updates.status, updates.qr_code !== undefined ? updates.qr_code : instance.qr_code, instance.id
    )

    const updated = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
    res.json({ instance: updated, state })
  } catch (err) {
    db.prepare("UPDATE whatsapp_instances SET status = 'disconnected' WHERE id = ?").run(instance.id)
    res.json({ instance: db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id), error: err.message })
  }
})

// ─── Refresh QR code ─────────────────────────────────────────────
router.post('/whatsapp/:id/qrcode', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (!instance) return res.status(404).json({ error: 'Instancia nao encontrada' })

  try {
    const r = await fetch(`${instance.api_url}/instance/connect/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const qrCode = data?.base64 || data?.qrcode || null

    db.prepare("UPDATE whatsapp_instances SET qr_code = ?, status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(qrCode, instance.id)
    const updated = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
    res.json({ instance: updated })
  } catch (err) {
    res.status(500).json({ error: 'Falha ao gerar QR code: ' + err.message })
  }
})

// ─── Disconnect (logout from WhatsApp) ───────────────────────────
router.post('/whatsapp/:id/disconnect', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (!instance) return res.status(404).json({ error: 'Instancia nao encontrada' })

  try {
    await fetch(`${instance.api_url}/instance/logout/${instance.instance_name}`, {
      method: 'DELETE',
      headers: { apikey: instance.api_key },
    })
  } catch (err) {
    console.error('[Evolution Logout]', err.message)
  }

  db.prepare("UPDATE whatsapp_instances SET status = 'disconnected', qr_code = NULL, updated_at = datetime('now') WHERE id = ?").run(instance.id)
  res.json({ ok: true })
})

// ─── Delete instance ─────────────────────────────────────────────
router.delete('/whatsapp/:id', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (instance) {
    // Try to delete from Evolution API too
    try {
      await fetch(`${instance.api_url}/instance/delete/${instance.instance_name}`, {
        method: 'DELETE',
        headers: { apikey: instance.api_key },
      })
    } catch {}
  }
  db.prepare('DELETE FROM whatsapp_instances WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ─── Re-set webhook URL on Evolution API ─────────────────────────
router.post('/whatsapp/:id/setup-webhook', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (!instance) return res.status(404).json({ error: 'Instancia nao encontrada' })
  const account = db.prepare('SELECT slug FROM accounts WHERE id = ?').get(instance.account_id)
  const proto = req.get('x-forwarded-proto') || req.protocol
  const serverUrl = process.env.WEBHOOK_BASE_URL || `${proto}://${req.get('host')}`
  const webhookUrl = `${serverUrl}/crm/api/webhooks/evolution/${account.slug}`
  try {
    const r = await fetch(`${instance.api_url}/webhook/set/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ url: webhookUrl, webhook_by_events: false, events: ['MESSAGES_UPSERT'] }),
    })
    const data = await r.json()
    console.log(`[Evolution Webhook] Updated ${instance.instance_name} → ${webhookUrl}`)
    res.json({ ok: true, webhookUrl, response: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Test connection (legacy, kept for compatibility) ────────────
router.post('/whatsapp/:id/test', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (!instance) return res.status(404).json({ error: 'Instancia nao encontrada' })

  try {
    const r = await fetch(`${instance.api_url}/instance/connectionState/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const status = data.instance?.state === 'open' ? 'connected' : 'disconnected'
    db.prepare("UPDATE whatsapp_instances SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, instance.id)
    res.json({ success: status === 'connected', status, data })
  } catch (err) {
    db.prepare("UPDATE whatsapp_instances SET status = 'disconnected' WHERE id = ?").run(instance.id)
    res.json({ success: false, error: err.message })
  }
})

export default router
