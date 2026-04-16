import { Router } from 'express'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'

const router = Router()

// Calculate due datetime for a cadence attempt.
// Anchor: last_executed_at (when previous step was completed) OR started_at (for step 1).
// Mode 'duration': anchor + delay_minutes
// Mode 'date': anchor + delay_days at scheduled_time (clock time)
function computeDueDatetime({ startedAt, lastExecutedAt, delay_days, scheduled_time, schedule_mode, delay_minutes }) {
  const anchorIso = lastExecutedAt || startedAt
  const anchor = new Date(anchorIso.replace(' ', 'T') + 'Z')

  if (schedule_mode === 'duration') {
    return new Date(anchor.getTime() + (delay_minutes || 0) * 60000)
  }

  // Date mode (default)
  const due = new Date(anchor)
  due.setDate(due.getDate() + (delay_days || 0))
  if (scheduled_time) {
    const [h, m] = scheduled_time.split(':').map(Number)
    due.setHours(h || 0, m || 0, 0, 0)
  } else if ((delay_days || 0) > 0) {
    due.setHours(0, 0, 0, 0)
  }
  return due
}

/**
 * Build query that returns all active task instances (lead_cadences with current_attempt_id)
 * with calculated due_datetime based on lc.started_at + delay_days + scheduled_time.
 *
 * Filters by attendant when role=atendente, or all leads of account otherwise.
 */
function getMyTasks({ accountId, userId, role }) {
  // Role-based scoping
  let attendantFilter = ''
  const params = [accountId]
  if (role === 'atendente') {
    attendantFilter = 'AND l.attendant_id = ?'
    params.push(userId)
  }

  const rows = db.prepare(`
    SELECT
      lc.id as lead_cadence_id,
      lc.lead_id,
      lc.cadence_id,
      lc.current_attempt_id,
      lc.status,
      lc.last_executed_at,
      lc.started_at,
      l.name as lead_name,
      l.phone as lead_phone,
      l.profile_pic_url,
      l.created_at as lead_created_at,
      l.stage_id,
      l.attendant_id,
      u.name as attendant_name,
      fs.name as stage_name,
      fs.color as stage_color,
      c.name as cadence_name,
      ca.position as attempt_position,
      ca.action_type,
      ca.description as attempt_description,
      ca.instructions as attempt_instructions,
      ca.delay_days,
      ca.scheduled_time,
      ca.schedule_mode,
      ca.delay_minutes,
      ca.auto_message,
      (SELECT COUNT(*) FROM cadence_attempts WHERE cadence_id = lc.cadence_id) as total_attempts
    FROM lead_cadences lc
    JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    JOIN leads l ON l.id = lc.lead_id
    LEFT JOIN users u ON u.id = l.attendant_id
    LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
    JOIN cadences c ON c.id = lc.cadence_id
    WHERE lc.status = 'active' AND l.is_active = 1 AND l.account_id = ?
    ${attendantFilter}
    ORDER BY l.created_at ASC
  `).all(...params)

  // Calculate due_datetime in JS for each task
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(today.getDate() + 2)
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7)

  const enriched = rows.map(r => {
    const due = computeDueDatetime({
      startedAt: r.started_at,
      lastExecutedAt: r.last_executed_at,
      delay_days: r.delay_days,
      scheduled_time: r.scheduled_time,
      schedule_mode: r.schedule_mode,
      delay_minutes: r.delay_minutes,
    })

    let bucket = 'later'
    if (due < today) bucket = 'overdue'
    else if (due < tomorrow) bucket = 'today'
    else if (due < dayAfterTomorrow) bucket = 'tomorrow'
    else if (due < weekEnd) bucket = 'week'

    return { ...r, due_datetime: due.toISOString(), bucket }
  })

  return enriched
}

// GET /api/tasks/my — group tasks by bucket
router.get('/my', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const tasks = getMyTasks({ accountId: req.accountId, userId: req.user.id, role: req.user.role })
  const grouped = { overdue: [], today: [], tomorrow: [], week: [], later: [] }
  for (const t of tasks) grouped[t.bucket].push(t)
  res.json(grouped)
})

// GET /api/tasks/counts — just numbers for sidebar badge
router.get('/counts', (req, res) => {
  if (!req.accountId) return res.json({ overdue: 0, today: 0, tomorrow: 0 })
  const tasks = getMyTasks({ accountId: req.accountId, userId: req.user.id, role: req.user.role })
  const counts = { overdue: 0, today: 0, tomorrow: 0, week: 0, total: tasks.length }
  for (const t of tasks) counts[t.bucket] = (counts[t.bucket] || 0) + 1
  res.json(counts)
})

// POST /api/tasks/:lcId/complete — mark current attempt as done and advance
router.post('/:lcId/complete', (req, res) => {
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(req.params.lcId)
  if (!lc) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (lc.status !== 'active') return res.status(400).json({ error: 'Cadencia nao esta ativa' })

  const currentAttempt = lc.current_attempt_id
    ? db.prepare('SELECT * FROM cadence_attempts WHERE id = ?').get(lc.current_attempt_id)
    : null
  const currentPos = currentAttempt ? currentAttempt.position : -1
  const nextAttempt = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? AND position > ? ORDER BY position LIMIT 1').get(lc.cadence_id, currentPos)

  if (nextAttempt) {
    db.prepare("UPDATE lead_cadences SET current_attempt_id = ?, last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?").run(nextAttempt.id, lc.current_attempt_id, lc.id)
  } else {
    db.prepare("UPDATE lead_cadences SET status = 'completed', last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?").run(lc.current_attempt_id, lc.id)
  }

  // Notify via SSE
  const lead = db.prepare('SELECT account_id, attendant_id FROM leads WHERE id = ?').get(lc.lead_id)
  if (lead) broadcastSSE(lead.account_id, 'task:updated', { lead_cadence_id: lc.id, attendant_id: lead.attendant_id })

  let nextStep = null
  if (nextAttempt) {
    // Anchor for the newly-current step is NOW (we just completed the previous one)
    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const due = computeDueDatetime({
      startedAt: lc.started_at,
      lastExecutedAt: nowIso,
      delay_days: nextAttempt.delay_days,
      scheduled_time: nextAttempt.scheduled_time,
      schedule_mode: nextAttempt.schedule_mode,
      delay_minutes: nextAttempt.delay_minutes,
    })
    nextStep = {
      position: nextAttempt.position,
      action_type: nextAttempt.action_type,
      description: nextAttempt.description,
      delay_days: nextAttempt.delay_days,
      scheduled_time: nextAttempt.scheduled_time,
      schedule_mode: nextAttempt.schedule_mode,
      delay_minutes: nextAttempt.delay_minutes,
      due_datetime: due.toISOString(),
    }
  }
  res.json({ ok: true, completed: !nextAttempt, nextStep })
})

// POST /api/tasks/:lcId/skip — skip current attempt without executing
router.post('/:lcId/skip', (req, res) => {
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(req.params.lcId)
  if (!lc) return res.status(404).json({ error: 'Tarefa nao encontrada' })

  const currentAttempt = lc.current_attempt_id
    ? db.prepare('SELECT * FROM cadence_attempts WHERE id = ?').get(lc.current_attempt_id)
    : null
  const currentPos = currentAttempt ? currentAttempt.position : -1
  const nextAttempt = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? AND position > ? ORDER BY position LIMIT 1').get(lc.cadence_id, currentPos)

  if (nextAttempt) {
    // Skip also resets the anchor for the next step (so D+1 / X minutes start counting now)
    db.prepare("UPDATE lead_cadences SET current_attempt_id = ?, last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?").run(nextAttempt.id, lc.current_attempt_id, lc.id)
  } else {
    db.prepare("UPDATE lead_cadences SET status = 'completed', last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?").run(lc.current_attempt_id, lc.id)
  }

  const lead = db.prepare('SELECT account_id, attendant_id FROM leads WHERE id = ?').get(lc.lead_id)
  if (lead) broadcastSSE(lead.account_id, 'task:updated', { lead_cadence_id: lc.id, attendant_id: lead.attendant_id })

  res.json({ ok: true })
})

export default router
