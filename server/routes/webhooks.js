import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'

const router = Router()

// Helper: get or create lead from phone
function getOrCreateLead(accountId, phone, name, source, waJid, instanceId) {
  // Find existing by phone or wa_remote_jid
  let lead = null
  if (waJid) lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ?').get(accountId, waJid)
  if (!lead && phone) lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND phone = ?').get(accountId, phone)

  if (lead) {
    // Update instance_id if not set
    if (instanceId && !lead.instance_id) {
      db.prepare('UPDATE leads SET instance_id = ? WHERE id = ?').run(instanceId, lead.id)
    }
    return { lead, isNew: false }
  }

  // Get default funnel + first stage
  const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(accountId)
  if (!funnel) return { lead: null, isNew: false }
  const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
  if (!firstStage) return { lead: null, isNew: false }

  // Run distribution (round-robin or manual)
  let attendantId = null
  const rule = db.prepare('SELECT * FROM distribution_rules WHERE account_id = ? AND funnel_id = ?').get(accountId, funnel.id)
  if (rule && rule.type === 'round_robin' && rule.active_attendants) {
    try {
      const attendants = JSON.parse(rule.active_attendants)
      if (attendants.length > 0) {
        const idx = rule.last_assigned_index % attendants.length
        attendantId = attendants[idx]
        db.prepare("UPDATE distribution_rules SET last_assigned_index = ?, updated_at = datetime('now') WHERE id = ?").run(rule.last_assigned_index + 1, rule.id)
      }
    } catch {}
  }

  const result = db.prepare(`
    INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, funnel.id, firstStage.id, attendantId, name || null, phone || null, source, waJid || null, instanceId || null)

  // Log stage history
  db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(result.lastInsertRowid, firstStage.id, 'webhook')

  lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
  return { lead, isNew: true }
}

// Helper: auto-detect stage from message keywords
function autoDetectStage(lead, messageText) {
  if (!messageText) return
  const text = messageText.toLowerCase()

  // Get all stages ahead of current
  const currentStage = db.prepare('SELECT position FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  if (!currentStage) return

  const aheadStages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? AND position > ? ORDER BY position').all(lead.funnel_id, currentStage.position)

  for (const stage of aheadStages) {
    if (!stage.auto_keywords) continue
    let keywords
    try { keywords = JSON.parse(stage.auto_keywords) } catch { continue }
    if (!Array.isArray(keywords)) continue

    const matched = keywords.some(kw => text.includes(kw.toLowerCase()))
    if (matched) {
      const oldStageId = lead.stage_id
      db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage.id, lead.id)
      db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
        lead.id, oldStageId, stage.id, 'auto_keyword'
      )
      break // Only advance to first match
    }
  }
}

// Evolution API webhook
router.post('/evolution/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    // Identify which instance sent this webhook (by instance name in body or match account)
    const webhookInstance = req.body.instance || req.body.instanceName || null
    let waInstance = null
    if (webhookInstance) {
      waInstance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(account.id, webhookInstance)
    }
    if (!waInstance) {
      // Fallback: get first instance for this account
      waInstance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? ORDER BY id LIMIT 1').get(account.id)
    }

    // Verify webhook secret if configured
    if (waInstance?.webhook_secret && req.headers['x-webhook-secret'] !== waInstance.webhook_secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' })
    }

    const { event, data } = req.body
    if (event !== 'messages.upsert' || !data) return res.json({ ok: true })

    const remoteJid = data.key?.remoteJid || ''
    const fromMe = data.key?.fromMe || false
    const msgId = data.key?.id || ''
    const pushName = data.pushName || ''
    const content = data.message?.conversation || data.message?.extendedTextMessage?.text || ''
    const timestamp = data.messageTimestamp ? new Date(parseInt(data.messageTimestamp) * 1000).toISOString() : new Date().toISOString()

    // Extract phone from JID
    const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '')
    if (!phone || remoteJid.includes('@g.us')) return res.json({ ok: true }) // Skip group messages

    // Get or create lead (pass instance_id so lead is linked to the WhatsApp number)
    const { lead, isNew } = getOrCreateLead(account.id, phone, pushName, 'whatsapp', remoteJid, waInstance?.id || null)
    if (!lead) return res.json({ ok: true })

    // When attendant sends first message (fromMe=true) and lead is in first stage, advance to "Em Atendimento"
    if (!isNew && fromMe) {
      const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(lead.funnel_id)
      const secondStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1 OFFSET 1').get(lead.funnel_id)
      if (firstStage && secondStage && lead.stage_id === firstStage.id) {
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(secondStage.id, lead.id)
        db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
          lead.id, firstStage.id, secondStage.id, 'webhook'
        )
      }
    }

    // Store message (dedup by wa_msg_id)
    const existing = msgId ? db.prepare('SELECT id FROM messages WHERE wa_msg_id = ?').get(msgId) : null
    if (!existing) {
      db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, sender_name, wa_msg_id, wa_timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(lead.id, account.id, fromMe ? 'outbound' : 'inbound', content, fromMe ? '' : pushName, msgId || null, timestamp)
    }

    // Auto stage detection: keywords in outbound messages advance stages
    // Inbound messages from client don't auto-advance (attendant controls flow)
    if (fromMe && content) autoDetectStage(lead, content)

    // Update lead name if we have pushName and lead has no name
    if (!lead.name && pushName) {
      db.prepare('UPDATE leads SET name = ? WHERE id = ? AND name IS NULL').run(pushName, lead.id)
    }

    // Broadcast SSE
    if (isNew) broadcastSSE(account.id, 'lead:created', db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id))
    else broadcastSSE(account.id, 'lead:message', { leadId: lead.id, message: content, direction: fromMe ? 'outbound' : 'inbound' })

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook Evolution]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Meta Lead Form webhook
router.post('/meta-leads/:accountSlug', async (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const entries = req.body.entry || []
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue
        const leadgenId = change.value?.leadgen_id
        if (!leadgenId) continue

        // Fetch full lead data from Meta (needs META_ACCESS_TOKEN)
        const metaToken = process.env.META_ACCESS_TOKEN
        if (!metaToken) continue

        const r = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?access_token=${metaToken}`)
        const data = await r.json()
        if (data.error) continue

        // Extract fields
        let name = '', phone = '', email = ''
        for (const field of (data.field_data || [])) {
          const val = field.values?.[0] || ''
          if (field.name === 'full_name') name = val
          else if (field.name === 'phone_number') phone = val.replace(/[^\d+]/g, '')
          else if (field.name === 'email') email = val
        }

        getOrCreateLead(account.id, phone, name, 'meta_form', null)
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook Meta]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Meta webhook verification
router.get('/meta-leads/:accountSlug', (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN || 'dros-crm-verify'
  if (req.query['hub.verify_token'] === verifyToken && req.query['hub.mode'] === 'subscribe') {
    return res.send(req.query['hub.challenge'])
  }
  res.status(403).send('Forbidden')
})

// Website form webhook
router.post('/site/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const { name, phone, email, city, source, message } = req.body
    const { lead, isNew } = getOrCreateLead(account.id, phone, name, 'website', null)
    if (lead && email) db.prepare('UPDATE leads SET email = ? WHERE id = ? AND email IS NULL').run(email, lead.id)
    if (lead && city) db.prepare('UPDATE leads SET city = ? WHERE id = ? AND city IS NULL').run(city, lead.id)

    res.json({ ok: true, leadId: lead?.id })
  } catch (err) {
    console.error('[Webhook Site]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
