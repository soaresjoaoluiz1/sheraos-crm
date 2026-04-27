import fetch from 'node-fetch'
import db from './db.js'
import { broadcastSSE } from './sse.js'

// Runs every 5 minutes
const INTERVAL_MS = 5 * 60 * 1000

// ─── Check WhatsApp instances + auto-reconnect ─────────────────
async function checkWhatsAppInstances() {
  // First check if Evolution API is alive
  let evolutionAlive = false
  try {
    const r = await fetch('http://127.0.0.1:8080/', { timeout: 5000 })
    evolutionAlive = r.ok || r.status === 401 || r.status === 404
  } catch {
    console.error('[Health] Evolution API is DOWN — cannot check instances')
    return
  }

  const instances = db.prepare("SELECT * FROM whatsapp_instances WHERE status IN ('connected', 'connecting')").all()
  for (const inst of instances) {
    try {
      const r = await fetch(`${inst.api_url}/instance/connectionState/${encodeURIComponent(inst.instance_name)}`, {
        headers: { apikey: inst.api_key },
      })
      const data = await r.json()
      const state = data?.instance?.state || ''
      let newStatus = 'disconnected'
      if (state === 'open' || state === 'connected') newStatus = 'connected'
      else if (state === 'connecting') newStatus = 'connecting'
      else if (state === 'close' || state === 'closed') newStatus = 'disconnected'

      if (newStatus !== inst.status) {
        db.prepare("UPDATE whatsapp_instances SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, inst.id)
        console.log(`[Health] ${inst.instance_name}: ${inst.status} → ${newStatus}`)
      }

      // AUTO-RECONNECT: if was connected but now disconnected/closed, try to reconnect
      if (inst.status === 'connected' && (newStatus === 'disconnected' || state === 'close' || state === 'closed')) {
        console.log(`[Health] ${inst.instance_name} — connection lost, attempting auto-reconnect...`)
        try {
          const reconnectRes = await fetch(`${inst.api_url}/instance/connect/${encodeURIComponent(inst.instance_name)}`, {
            headers: { apikey: inst.api_key },
          })
          const reconnectData = await reconnectRes.json()
          if (reconnectData?.instance?.state === 'open' || reconnectData?.instance?.state === 'connecting') {
            db.prepare("UPDATE whatsapp_instances SET status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(inst.id)
            console.log(`[Health] ${inst.instance_name} — reconnect initiated successfully`)
          } else {
            console.log(`[Health] ${inst.instance_name} — reconnect response:`, JSON.stringify(reconnectData).substring(0, 150))
          }
        } catch (reconnectErr) {
          console.error(`[Health] ${inst.instance_name} — reconnect failed:`, reconnectErr.message)
        }
      }
    } catch (err) {
      console.error(`[Health] ${inst.instance_name} — check failed:`, err.message)
      // If check fails, mark as disconnected so we try to reconnect next cycle
      if (inst.status === 'connected') {
        db.prepare("UPDATE whatsapp_instances SET status = 'disconnected', updated_at = datetime('now') WHERE id = ?").run(inst.id)
      }
    }
  }
}

// ─── Execute due cadence steps ───────────────────────────────────
async function processCadences() {
  // Find all active lead_cadences with current_attempt_id set
  const active = db.prepare(`
    SELECT lc.*, ca.delay_days, ca.scheduled_time, ca.schedule_mode, ca.delay_minutes, ca.action_type, ca.auto_message,
      l.phone, l.name as lead_name, l.account_id
    FROM lead_cadences lc
    JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    JOIN leads l ON l.id = lc.lead_id
    WHERE lc.status = 'active' AND l.is_active = 1
  `).all()

  const now = new Date()

  for (const row of active) {
    // Anchor for current step: last_executed_at (previous step done time) OR started_at (step 1)
    const anchorIso = row.last_executed_attempt_id && row.last_executed_at ? row.last_executed_at : row.started_at
    const anchor = new Date(anchorIso.replace(' ', 'T') + 'Z')
    let target

    if (row.schedule_mode === 'duration') {
      target = new Date(anchor.getTime() + (row.delay_minutes || 0) * 60000)
    } else {
      target = new Date(anchor)
      target.setDate(target.getDate() + (row.delay_days || 0))
      if (row.scheduled_time) {
        const [h, m] = row.scheduled_time.split(':').map(Number)
        target.setUTCHours((h || 0) + 3, m || 0, 0, 0) // America/Sao_Paulo UTC-3
      } else if ((row.delay_days || 0) > 0) {
        target.setUTCHours(3, 0, 0, 0) // midnight local = 03:00 UTC
      }
    }

    // Only execute if target time has passed
    if (now < target) continue
    // Skip if this attempt was already executed (last_executed_attempt_id === current_attempt_id)
    if (row.last_executed_attempt_id === row.current_attempt_id) continue

    // Auto-send DISABLED — all cadence messages are manual only (via Tasks/Chat button)
    // Just notify that the task is due
    broadcastSSE(row.account_id, 'task:due', { lead_cadence_id: row.id, lead_id: row.lead_id })
    console.log(`[Scheduler] Task due: lead #${row.lead_id} attempt #${row.current_attempt_id} (${row.action_type})`)
  }
}

// sendCadenceMessage REMOVED — all sending is manual only via Chat/Tasks buttons

// ─── Execute scheduled broadcasts ────────────────────────────────
async function processScheduledBroadcasts() {
  const due = db.prepare(`
    SELECT * FROM broadcasts
    WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND datetime(scheduled_at) <= datetime('now')
  `).all()

  for (const b of due) {
    console.log(`[Scheduler] Triggering broadcast #${b.id}: ${b.name}`)
    // Mark as sending and kick off background send (same logic as manual)
    db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(b.id)
    sendBroadcastInBackground(b.id).catch(err => console.error('[Scheduler] Broadcast failed:', err.message))
  }
}

async function sendBroadcastInBackground(broadcastId) {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId)
  if (!broadcast) return
  const instance = db.prepare("SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = 'connected' LIMIT 1").get(broadcast.account_id)
  if (!instance) {
    db.prepare("UPDATE broadcasts SET status = 'failed' WHERE id = ?").run(broadcastId)
    return
  }
  const recipients = db.prepare("SELECT * FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'").all(broadcastId)
  let sent = 0, failed = 0
  for (const r of recipients) {
    try {
      const lead = db.prepare('SELECT name FROM leads WHERE id = ?').get(r.lead_id)
      const text = broadcast.message_template.replace(/\{\{name\}\}/g, lead?.name || 'Cliente')
      const sendRes = await fetch(`${instance.api_url}/message/sendText/${instance.instance_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
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
      await new Promise(resolve => setTimeout(resolve, 1500))
    } catch (err) {
      db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?").run(err.message, r.id)
      failed++
    }
  }
  db.prepare("UPDATE broadcasts SET status = 'completed', sent_count = ?, failed_count = ?, completed_at = datetime('now') WHERE id = ?").run(sent, failed, broadcastId)
  broadcastSSE(broadcast.account_id, 'broadcast:completed', { id: broadcastId, sent, failed })
}

// ─── Polling backup: fetch missed messages from Evolution ────────
async function pollMissedMessages() {
  const instances = db.prepare("SELECT wi.*, a.id as acc_id, a.slug FROM whatsapp_instances wi JOIN accounts a ON a.id = wi.account_id WHERE wi.status = 'connected'").all()
  if (!instances.length) return

  // Import getOrCreateLead from webhooks logic inline
  function normalizePhone(p) {
    if (!p) return p
    p = p.replace(/[^\d]/g, '')
    if (p.startsWith('55') && p.length === 13) return p
    if (p.startsWith('55') && p.length === 12) return p.slice(0, 4) + '9' + p.slice(4)
    if (!p.startsWith('55') && p.length === 11) return '55' + p
    if (!p.startsWith('55') && p.length === 10) return '55' + p.slice(0, 2) + '9' + p.slice(2)
    return p // can't normalize safely — return as-is
  }

  for (const inst of instances) {
    try {
      // Fetch recent messages from Evolution (last 5 min)
      const r = await fetch(`${inst.api_url}/chat/findMessages/${encodeURIComponent(inst.instance_name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: inst.api_key },
        body: JSON.stringify({ where: {}, limit: 50 }),
      })
      if (!r.ok) continue
      const data = await r.json()
      const messages = data?.messages?.records || data?.messages || data || []
      if (!Array.isArray(messages)) continue

      let imported = 0
      for (const m of messages) {
        const key = m.key
        if (!key || !key.id || !key.remoteJid) continue
        // Skip groups, broadcasts, status
        if (key.remoteJid.includes('@g.us') || key.remoteJid.includes('@broadcast') || key.remoteJid.includes('status@')) continue
        // Skip if already in DB
        const exists = db.prepare('SELECT id FROM messages WHERE wa_msg_id = ?').get(key.id)
        if (exists) continue

        // Handle @lid (Legacy ID from WhatsApp) — accept if has pushName (real contact), skip if no identity
        const jid = m.senderPn || key.remoteJid
        let phone = ''
        let isLid = false

        if (m.senderPn) {
          // Has real phone via senderPn
          phone = normalizePhone(m.senderPn.replace('@s.whatsapp.net', '').replace('@c.us', ''))
        } else if (jid.endsWith('@lid')) {
          // LID without real phone — only accept if has pushName (real person, not group artifact)
          if (!m.pushName) continue
          isLid = true
          phone = jid.replace('@lid', '') // use LID as identifier
        } else {
          phone = normalizePhone(jid.replace('@s.whatsapp.net', '').replace('@c.us', ''))
        }
        if (!phone) continue
        const dedupJid = `${phone}@s.whatsapp.net`

        const fromMe = !!key.fromMe
        const pushName = m.pushName || ''
        const timestamp = m.messageTimestamp || null

        // Parse content
        const msg = m.message || {}
        let content = msg.conversation || msg.extendedTextMessage?.text || ''
        let mediaType = 'text'
        if (msg.imageMessage) { mediaType = 'image'; content = content || '[Imagem]' }
        else if (msg.videoMessage) { mediaType = 'video'; content = content || '[Video]' }
        else if (msg.audioMessage) { mediaType = 'audio'; content = content || '[Audio]' }
        else if (msg.documentMessage) { mediaType = 'document'; content = content || '[Documento]' }
        else if (msg.stickerMessage) { mediaType = 'sticker'; content = '[Sticker]' }
        else if (msg.reactionMessage) continue // skip reactions

        if (!content && mediaType === 'text') continue

        // Get or create lead
        const dedupJid = isLid ? `${phone}@lid` : `${phone}@s.whatsapp.net`
        let lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND (wa_remote_jid = ? OR phone = ?)').get(inst.acc_id, dedupJid, phone)

        if (!lead) {
          // Create lead using default funnel
          const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(inst.acc_id)
          if (!funnel) continue
          const stage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
          if (!stage) continue
          const result = db.prepare('INSERT INTO leads (account_id, funnel_id, stage_id, name, phone, source, wa_remote_jid, instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
            inst.acc_id, funnel.id, stage.id, pushName || phone || 'Sem nome', phone, 'whatsapp', dedupJid, inst.id
          )
          lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
          db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(lead.id, stage.id, 'polling')
          broadcastSSE(inst.acc_id, 'lead:created', lead)
        }

        // Store message
        db.prepare('INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          lead.id, inst.acc_id, fromMe ? 'outbound' : 'inbound', content, mediaType, fromMe ? '' : pushName, key.id, timestamp
        )
        imported++

        // SSE notify
        broadcastSSE(inst.acc_id, 'lead:message', { lead_id: lead.id })
      }

      if (imported > 0) console.log(`[Polling] ${inst.instance_name}: imported ${imported} missed messages`)
      else console.log(`[Polling] ${inst.instance_name}: ${messages.length} msgs checked, all synced`)
    } catch (err) {
      console.error(`[Polling] ${inst.instance_name}: error — ${err.message}`)
    }
  }
}

// ─── Re-register webhooks on every health check ─────────────────
async function reRegisterWebhooks() {
  const instances = db.prepare("SELECT wi.*, a.slug FROM whatsapp_instances wi JOIN accounts a ON a.id = wi.account_id WHERE wi.status = 'connected'").all()
  for (const inst of instances) {
    try {
      const webhookUrl = `https://drosagencia.com.br/crm/api/webhooks/evolution/${inst.slug}`
      await fetch(`${inst.api_url}/webhook/set/${encodeURIComponent(inst.instance_name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: inst.api_key },
        body: JSON.stringify({ webhook: { url: webhookUrl, enabled: true, events: ['MESSAGES_UPSERT'] } }),
      })
    } catch {}
  }
}

// ─── Clean up stale QR codes (older than 2 minutes) ──────────────
function cleanupStaleQRCodes() {
  db.prepare(`
    UPDATE whatsapp_instances SET qr_code = NULL
    WHERE qr_code IS NOT NULL AND status = 'connecting'
    AND datetime(updated_at) < datetime('now', '-2 minutes')
  `).run()
}

// ─── Main tick (every 5 min) ─────────────────────────────────────
async function tick() {
  try {
    await Promise.all([
      checkWhatsAppInstances(),
      processCadences(),
      processScheduledBroadcasts(),
    ])
    cleanupStaleQRCodes()
    // Re-register webhooks every tick to prevent stale webhooks
    await reRegisterWebhooks()
  } catch (err) {
    console.error('[Scheduler] Tick error:', err.message)
  }
}

// ─── Polling tick (every 3 min) ──────────────────────────────────
async function pollTick() {
  console.log('[Polling] Running...')
  try {
    await pollMissedMessages()
  } catch (err) {
    console.error('[Polling] Error:', err.message)
  }
}

export function startScheduler() {
  console.log('[Scheduler] Started — main every 5 min, polling every 3 min')
  tick()
  setInterval(tick, INTERVAL_MS)
  // Polling runs on separate interval (3 min)
  setTimeout(() => pollTick(), 30000) // first poll after 30s
  setInterval(pollTick, 3 * 60 * 1000)
}
