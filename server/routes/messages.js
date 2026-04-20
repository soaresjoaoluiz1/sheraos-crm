import { Router } from 'express'
import fetch from 'node-fetch'
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

    // Anti-duplicate: check if same message was sent to this lead in last 5 minutes
    const duplicate = db.prepare(`
      SELECT id FROM messages WHERE lead_id = ? AND direction = 'outbound' AND content = ? AND created_at > datetime('now', '-5 minutes')
    `).get(req.params.leadId, content)
    if (duplicate) return res.status(409).json({ error: 'Mensagem identica ja enviada nos ultimos 5 minutos' })

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

// Fetch media on-demand from Evolution API (returns base64 data URL)
router.get('/:leadId/media/:msgId', async (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND lead_id = ?').get(req.params.msgId, req.params.leadId)
    if (!message || !message.wa_msg_id) return res.status(404).json({ error: 'Mensagem nao encontrada' })
    if (message.media_type === 'text') return res.status(400).json({ error: 'Sem midia' })

    const lead = db.prepare('SELECT account_id, instance_id FROM leads WHERE id = ?').get(message.lead_id)
    const instance = lead?.instance_id
      ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(lead.instance_id)
      : db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ? LIMIT 1').get(lead?.account_id, 'connected')
    if (!instance) return res.status(400).json({ error: 'Sem instancia WhatsApp' })

    const r = await fetch(`${instance.api_url}/chat/getBase64FromMediaMessage/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ message: { key: { id: message.wa_msg_id } }, convertToMp4: false }),
    })
    const data = await r.json()
    if (!data.base64) return res.status(404).json({ error: 'Midia nao encontrada na Evolution' })

    const mimeMap = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg', document: 'application/pdf', sticker: 'image/webp' }
    const mime = data.mimetype || mimeMap[message.media_type] || 'application/octet-stream'
    res.json({ dataUrl: `data:${mime};base64,${data.base64}`, mime, type: message.media_type })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
