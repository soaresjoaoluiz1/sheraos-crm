import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { broadcastSSE } from '../sse.js'

const router = Router()

// List broadcasts
router.get('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const broadcasts = db.prepare('SELECT * FROM broadcasts WHERE account_id = ? ORDER BY created_at DESC').all(req.accountId)
  res.json({ broadcasts })
})

// Create broadcast
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { name, message_template, message_variations, media_url, lead_ids, delay_seconds } = req.body
  if (!name || !message_template) return res.status(400).json({ error: 'name e message_template obrigatorios' })

  const variationsJson = message_variations && Array.isArray(message_variations) && message_variations.length > 0 ? JSON.stringify(message_variations) : null
  const delay = parseInt(delay_seconds) || 3

  const result = db.prepare('INSERT INTO broadcasts (account_id, name, message_template, message_variations, delay_seconds, media_url, total_count, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    req.accountId, name, message_template, variationsJson, delay, media_url || null, lead_ids?.length || 0, req.user.id
  )

  // Add recipients
  if (lead_ids && Array.isArray(lead_ids)) {
    const stmt = db.prepare('INSERT INTO broadcast_recipients (broadcast_id, lead_id, phone) VALUES (?, ?, ?)')
    for (const leadId of lead_ids) {
      const lead = db.prepare('SELECT phone FROM leads WHERE id = ? AND phone IS NOT NULL AND is_archived = 0').get(leadId)
      if (lead) stmt.run(result.lastInsertRowid, leadId, lead.phone)
    }
    db.prepare('UPDATE broadcasts SET total_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = ?) WHERE id = ?').run(result.lastInsertRowid, result.lastInsertRowid)
  }

  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(result.lastInsertRowid)
  res.json({ broadcast })
})

// Get broadcast detail
router.get('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id)
  if (!broadcast) return res.status(404).json({ error: 'Disparo nao encontrado' })
  const recipients = db.prepare(`
    SELECT br.*, l.name as lead_name FROM broadcast_recipients br LEFT JOIN leads l ON br.lead_id = l.id WHERE br.broadcast_id = ?
  `).all(broadcast.id)
  res.json({ broadcast, recipients })
})

// Send broadcast
router.post('/:id/send', requireRole('super_admin', 'gerente'), async (req, res) => {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id)
  if (!broadcast) return res.status(404).json({ error: 'Disparo nao encontrado' })
  if (broadcast.status !== 'draft') return res.status(400).json({ error: 'Disparo ja enviado' })

  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ?').get(broadcast.account_id, 'connected')
  if (!instance) return res.status(400).json({ error: 'Nenhuma instancia WhatsApp conectada' })

  db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(broadcast.id)

  const recipients = db.prepare('SELECT * FROM broadcast_recipients WHERE broadcast_id = ? AND status = ?').all(broadcast.id, 'pending')

  // Send in background (don't block response)
  res.json({ ok: true, message: `Enviando para ${recipients.length} contatos...` })

  // Parse message variations (if available)
  const variations = broadcast.message_variations ? JSON.parse(broadcast.message_variations) : []
  const allTemplates = [broadcast.message_template, ...variations].filter(Boolean)
  const delay = (broadcast.delay_seconds || 3) * 1000

  let sent = 0, failed = 0
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i]
    try {
      const lead = db.prepare('SELECT name FROM leads WHERE id = ?').get(r.lead_id)

      // Rotate through message variations
      const template = allTemplates[i % allTemplates.length]
      const text = template.replace(/\{\{name\}\}/g, lead?.name || 'Cliente')

      const sendRes = await fetch(`${instance.api_url}/message/sendText/${instance.instance_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': instance.api_key },
        body: JSON.stringify({ number: r.phone, text }),
      })
      const data = await sendRes.json()

      if (data.key?.id) {
        db.prepare("UPDATE broadcast_recipients SET status = 'sent', wa_msg_id = ?, sent_at = datetime('now') WHERE id = ?").run(data.key.id, r.id)
        sent++
      } else {
        db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?").run(JSON.stringify(data), r.id)
        failed++
      }

      // Configurable delay between messages (default 3s)
      if (i < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    } catch (err) {
      db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?").run(err.message, r.id)
      failed++
    }
  }

  db.prepare("UPDATE broadcasts SET status = 'completed', sent_count = ?, failed_count = ?, completed_at = datetime('now') WHERE id = ?").run(sent, failed, broadcast.id)

  broadcastSSE(broadcast.account_id, 'broadcast:completed', { id: broadcast.id, sent, failed })
})

// Delete broadcast
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  db.prepare('DELETE FROM broadcasts WHERE id = ? AND status = ?').run(req.params.id, 'draft')
  res.json({ ok: true })
})

export default router
