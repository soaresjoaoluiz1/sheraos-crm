import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'

const router = Router()

// Resolve which WhatsApp instance to use when sending a message.
// Priority:
//   1. Override (param) — user explicitly chose
//   2. lead.last_instance_id — last instance that conversed
//   3. lead.instance_id — original instance that created the lead
//   4. user.primary_instance_id — user's default
//   5. Most recently created connected instance on the account (fallback)
function resolveInstanceForSend({ lead, user, override }) {
  const tryGet = (id) => id ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND status = ?').get(id, 'connected') : null
  return tryGet(override)
    || tryGet(lead.last_instance_id)
    || tryGet(lead.instance_id)
    || tryGet(user?.primary_instance_id)
    || db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(lead.account_id, 'connected')
}

// Get conversation messages for a lead
router.get('/:leadId', (req, res) => {
  // Verify lead belongs to user's account
  const lead = db.prepare('SELECT account_id, attendant_id FROM leads WHERE id = ?').get(req.params.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  if (req.accountId && lead.account_id !== req.accountId) return res.status(403).json({ error: 'Sem permissao' })
  if (req.user.role === 'atendente' && lead.attendant_id !== req.user.id) return res.status(403).json({ error: 'Sem permissao' })

  const { page = '1', limit = '50' } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const messages = db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(req.params.leadId, parseInt(limit), offset)
  const total = db.prepare('SELECT COUNT(*) as total FROM messages WHERE lead_id = ?').get(req.params.leadId).total
  res.json({ messages, total })
})

// Send message via Evolution API
router.post('/:leadId', async (req, res) => {
  try {
    const { content, instance_id: overrideInstanceId } = req.body
    if (!content) return res.status(400).json({ error: 'content required' })

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId)
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })

    // Anti-duplicate: check if same message was sent to this lead in last 5 minutes
    const duplicate = db.prepare(`
      SELECT id FROM messages WHERE lead_id = ? AND direction = 'outbound' AND content = ? AND created_at > datetime('now', '-5 minutes')
    `).get(req.params.leadId, content)
    if (duplicate) return res.status(409).json({ error: 'Mensagem identica ja enviada nos ultimos 5 minutos' })

    // Resolve instance using priority chain (override → lead.last → lead.original → user.primary → fallback)
    const instance = resolveInstanceForSend({ lead, user: req.user, override: overrideInstanceId })
    if (!instance) return res.status(400).json({ error: 'Nenhuma instancia WhatsApp conectada' })

    let jid = lead.wa_remote_jid || lead.phone
    if (!jid) return res.status(400).json({ error: 'Lead sem telefone' })
    // Check if it's a @lid without real phone
    if (jid.endsWith('@lid') && !lead.phone) return res.status(400).json({ error: 'Lead sem telefone real (ID temporario do WhatsApp). Edite o lead e adicione o telefone manualmente.' })

    // Normalize number for Evolution API
    let number = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '').replace(/[^\d]/g, '')
    if (number.startsWith('55') && number.length === 12) number = number.slice(0, 4) + '9' + number.slice(4)
    else if (!number.startsWith('55') && number.length === 11) number = '55' + number
    else if (!number.startsWith('55') && number.length === 10) number = '55' + number.slice(0, 2) + '9' + number.slice(2)

    // Send via Evolution API (with 1 retry on failure)
    const sendPayload = { number, text: content }
    let sendData = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const sendRes = await fetch(`${instance.api_url}/message/sendText/${encodeURIComponent(instance.instance_name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': instance.api_key },
          body: JSON.stringify(sendPayload),
        })
        sendData = await sendRes.json()
        if (sendData.key?.id) break // success
        if (attempt === 0 && (sendData.error || sendData.status === 500)) {
          console.log(`[Messages] Send attempt 1 failed for ${instance.instance_name}, retrying in 2s...`)
          await new Promise(r => setTimeout(r, 2000))
        }
      } catch (fetchErr) {
        if (attempt === 0) {
          console.log(`[Messages] Send fetch failed: ${fetchErr.message}, retrying in 2s...`)
          await new Promise(r => setTimeout(r, 2000))
        } else {
          throw fetchErr
        }
      }
    }

    if (!sendData?.key?.id) {
      console.error(`[Messages] Failed to send to ${jid} via ${instance.instance_name}:`, JSON.stringify(sendData)?.substring(0, 200))
    }

    const delivered = !!sendData?.key?.id

    // Store message with delivery status + instance used
    const result = db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, sender_name, wa_msg_id, instance_id)
      VALUES (?, ?, 'outbound', ?, ?, ?, ?)
    `).run(lead.id, lead.account_id, content, req.user.name, sendData?.key?.id || null, instance.id)

    // Update lead's last_instance_id (so future messages remember which number to use)
    if (delivered) {
      db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(instance.id, lead.id)
    }

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid)
    res.json({ message, delivered, instance: { id: instance.id, name: instance.instance_name }, error: delivered ? undefined : 'Falha ao enviar pelo WhatsApp. Verifique a conexao.' })
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
