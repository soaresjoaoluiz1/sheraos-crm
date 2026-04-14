import fetch from 'node-fetch'
import db from './db.js'
import { broadcastSSE } from './sse.js'

// Runs every 5 minutes
const INTERVAL_MS = 5 * 60 * 1000

// ─── Check WhatsApp instance connections ─────────────────────────
async function checkWhatsAppInstances() {
  const instances = db.prepare("SELECT * FROM whatsapp_instances WHERE status IN ('connected', 'connecting')").all()
  for (const inst of instances) {
    try {
      const r = await fetch(`${inst.api_url}/instance/connectionState/${inst.instance_name}`, {
        headers: { apikey: inst.api_key }, timeout: 10000,
      })
      const data = await r.json()
      const state = data?.instance?.state || ''
      let newStatus = 'disconnected'
      if (state === 'open' || state === 'connected') newStatus = 'connected'
      else if (state === 'connecting') newStatus = 'connecting'

      if (newStatus !== inst.status) {
        db.prepare("UPDATE whatsapp_instances SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, inst.id)
        console.log(`[Scheduler] Instance ${inst.instance_name}: ${inst.status} → ${newStatus}`)
      }
    } catch (err) {
      // silent fail — don't spam logs
    }
  }
}

// ─── Execute due cadence steps ───────────────────────────────────
async function processCadences() {
  // Find all active lead_cadences with current_attempt_id set
  const active = db.prepare(`
    SELECT lc.*, ca.delay_days, ca.scheduled_time, ca.action_type, ca.auto_message,
      l.phone, l.name as lead_name, l.account_id, l.created_at as lead_created
    FROM lead_cadences lc
    JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    JOIN leads l ON l.id = lc.lead_id
    WHERE lc.status = 'active' AND l.is_active = 1
  `).all()

  const now = new Date()

  for (const row of active) {
    // Calculate target execution moment: lead_created + delay_days, at scheduled_time (or anytime if null)
    const leadDate = new Date(row.lead_created.replace(' ', 'T') + 'Z')
    const target = new Date(leadDate)
    target.setDate(target.getDate() + (row.delay_days || 0))

    if (row.scheduled_time) {
      const [h, m] = row.scheduled_time.split(':').map(Number)
      target.setUTCHours(h + 3, m || 0, 0, 0) // America/Sao_Paulo is UTC-3
    } else {
      target.setUTCHours(0, 0, 0, 0)
    }

    // Only execute if target time has passed and not already executed
    if (now < target) continue
    if (row.last_executed_at) continue // Already executed this attempt

    // Mark as executed
    db.prepare("UPDATE lead_cadences SET last_executed_at = datetime('now') WHERE id = ?").run(row.id)

    // If action_type is whatsapp/mensagem and auto_message is set, send it
    if ((row.action_type === 'whatsapp' || row.action_type === 'mensagem') && row.auto_message && row.phone) {
      await sendCadenceMessage(row.account_id, row.phone, row.auto_message.replace(/\{\{name\}\}/g, row.lead_name || 'Cliente'))
    }

    console.log(`[Scheduler] Cadence executed: lead #${row.lead_id} attempt #${row.current_attempt_id} (${row.action_type})`)
  }
}

async function sendCadenceMessage(accountId, phone, text) {
  const instance = db.prepare("SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = 'connected' LIMIT 1").get(accountId)
  if (!instance) return
  try {
    await fetch(`${instance.api_url}/message/sendText/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ number: phone, text }),
    })
  } catch (err) {
    console.error('[Scheduler] Send cadence message failed:', err.message)
  }
}

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

// ─── Clean up stale QR codes (older than 2 minutes) ──────────────
function cleanupStaleQRCodes() {
  db.prepare(`
    UPDATE whatsapp_instances SET qr_code = NULL
    WHERE qr_code IS NOT NULL AND status = 'connecting'
    AND datetime(updated_at) < datetime('now', '-2 minutes')
  `).run()
}

// ─── Main tick ───────────────────────────────────────────────────
async function tick() {
  try {
    await Promise.all([
      checkWhatsAppInstances(),
      processCadences(),
      processScheduledBroadcasts(),
    ])
    cleanupStaleQRCodes()
  } catch (err) {
    console.error('[Scheduler] Tick error:', err.message)
  }
}

export function startScheduler() {
  console.log('[Scheduler] Started — running every 5 minutes')
  tick() // Run once immediately
  setInterval(tick, INTERVAL_MS)
}
