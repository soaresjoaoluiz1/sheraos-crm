import { Router } from 'express'
import db from '../db.js'

const router = Router()

// Get conversation messages for a lead
router.get('/:leadId', (req, res) => {
  const { page = '1', limit = '50' } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const messages = db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(req.params.leadId, parseInt(limit), offset)
  const total = db.prepare('SELECT COUNT(*) as total FROM messages WHERE lead_id = ?').get(req.params.leadId).total
  res.json({ messages, total })
})

// Send message via Evolution API
router.post('/:leadId', async (req, res) => {
  try {
    const { content } = req.body
    if (!content) return res.status(400).json({ error: 'content required' })

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId)
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })

    // Find WhatsApp instance for this account
    const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ?').get(lead.account_id, 'connected')
    if (!instance) return res.status(400).json({ error: 'Nenhuma instancia WhatsApp conectada' })

    const jid = lead.wa_remote_jid || lead.phone
    if (!jid) return res.status(400).json({ error: 'Lead sem telefone' })

    // Send via Evolution API
    const sendRes = await fetch(`${instance.api_url}/message/sendText/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': instance.api_key },
      body: JSON.stringify({ number: jid.replace('@s.whatsapp.net', ''), text: content }),
    })
    const sendData = await sendRes.json()

    // Store message
    const result = db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, sender_name, wa_msg_id)
      VALUES (?, ?, 'outbound', ?, ?, ?)
    `).run(lead.id, lead.account_id, content, req.user.name, sendData.key?.id || null)

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid)
    res.json({ message })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
