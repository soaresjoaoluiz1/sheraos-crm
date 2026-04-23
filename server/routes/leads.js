import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { broadcastSSE } from '../sse.js'

const router = Router()

// List leads with filters
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })

  const { stage_id, attendant_id, funnel_id, source, tag, city, search, date_from, date_to, show_archived, page = '1', limit = '50' } = req.query
  const where = ['l.account_id = ?', 'l.is_active = 1']
  const params = [req.accountId]

  // Archive filter: default hides archived; pass show_archived=1 to list only archived, =all to include both
  if (show_archived === '1') where.push('l.is_archived = 1')
  else if (show_archived !== 'all') where.push('l.is_archived = 0')

  // Atendente sees only their leads
  if (req.user.role === 'atendente') { where.push('l.attendant_id = ?'); params.push(req.user.id) }

  if (stage_id) { where.push('l.stage_id = ?'); params.push(stage_id) }
  if (attendant_id) { where.push('l.attendant_id = ?'); params.push(attendant_id) }
  if (funnel_id) { where.push('l.funnel_id = ?'); params.push(funnel_id) }
  if (source) { where.push('l.source = ?'); params.push(source) }
  if (city) { where.push('l.city LIKE ?'); params.push(`%${city}%`) }
  if (search) { where.push("(l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }
  if (date_from) { where.push('l.created_at >= ?'); params.push(date_from) }
  if (date_to) { where.push('l.created_at <= ?'); params.push(date_to + ' 23:59:59') }
  if (tag) {
    where.push('l.id IN (SELECT lead_id FROM lead_tags WHERE tag_id = ?)')
    params.push(tag)
  }

  const countSql = `SELECT COUNT(*) as total FROM leads l WHERE ${where.join(' AND ')}`
  const total = db.prepare(countSql).get(...params).total

  const offset = (parseInt(page) - 1) * parseInt(limit)
  const sql = `
    SELECT l.*, fs.name as stage_name, fs.color as stage_color, u.name as attendant_name,
      wi.instance_name as instance_name,
      (SELECT content FROM messages WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM messages WHERE lead_id = l.id) as message_count
    FROM leads l
    LEFT JOIN funnel_stages fs ON l.stage_id = fs.id
    LEFT JOIN users u ON l.attendant_id = u.id
    LEFT JOIN whatsapp_instances wi ON l.instance_id = wi.id
    WHERE ${where.join(' AND ')}
    ORDER BY l.updated_at DESC
    LIMIT ? OFFSET ?
  `
  const leads = db.prepare(sql).all(...params, parseInt(limit), offset)

  // Attach tags to all leads in one query (avoid N+1)
  if (leads.length > 0) {
    const placeholders = leads.map(() => '?').join(',')
    const allTags = db.prepare(`SELECT lt.lead_id, t.id, t.name, t.color FROM lead_tags lt JOIN tags t ON lt.tag_id = t.id WHERE lt.lead_id IN (${placeholders})`).all(...leads.map(l => l.id))
    const tagsMap = new Map()
    allTags.forEach(tag => { if (!tagsMap.has(tag.lead_id)) tagsMap.set(tag.lead_id, []); tagsMap.get(tag.lead_id).push({ id: tag.id, name: tag.name, color: tag.color }) })
    for (const lead of leads) lead.tags = tagsMap.get(lead.id) || []
  } else {
    for (const lead of leads) lead.tags = []
  }

  res.json({ leads, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) })
})

// Create lead manually
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { name, phone, email, city, source, source_detail, notes, funnel_id, attendant_id, empresa, cpf_cnpj, instagram, trabalha_anuncio, investimento_anuncios } = req.body

  // Get default funnel if not specified
  let fid = funnel_id
  if (!fid) {
    const defaultFunnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(req.accountId)
    if (!defaultFunnel) return res.status(400).json({ error: 'Nenhum funil configurado' })
    fid = defaultFunnel.id
  }

  // Get first stage
  const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(fid)
  if (!firstStage) return res.status(400).json({ error: 'Funil sem etapas' })

  const result = db.prepare(`
    INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, email, city, source, source_detail, notes, empresa, cpf_cnpj, instagram, trabalha_anuncio, investimento_anuncios)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.accountId, fid, firstStage.id, attendant_id || null, name, phone, email, city, source || 'manual', source_detail, notes, empresa || null, cpf_cnpj || null, instagram || null, trabalha_anuncio ? 1 : 0, investimento_anuncios || null)

  // Log stage history
  db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type, triggered_by) VALUES (?, ?, ?, ?)').run(
    result.lastInsertRowid, firstStage.id, 'manual', req.user.id
  )

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
  try { broadcastSSE(req.accountId, 'lead:created', lead) } catch {}
  res.json({ lead })
})

// Archived count (+ count with new activity). Must be declared before `/:id`.
router.get('/archived-count', (req, res) => {
  if (!req.accountId) return res.json({ count: 0, withActivity: 0 })
  const base = req.user.role === 'atendente'
    ? { where: 'account_id = ? AND is_archived = 1 AND attendant_id = ?', args: [req.accountId, req.user.id] }
    : { where: 'account_id = ? AND is_archived = 1', args: [req.accountId] }
  const count = db.prepare(`SELECT COUNT(*) as n FROM leads WHERE ${base.where}`).get(...base.args).n
  const withActivity = db.prepare(`SELECT COUNT(*) as n FROM leads WHERE ${base.where} AND has_new_after_archive = 1`).get(...base.args).n
  res.json({ count, withActivity })
})

// Get lead detail
router.get('/:id', (req, res) => {
  const lead = db.prepare(`
    SELECT l.*, fs.name as stage_name, fs.color as stage_color, u.name as attendant_name, wi.instance_name as instance_name
    FROM leads l LEFT JOIN funnel_stages fs ON l.stage_id = fs.id LEFT JOIN users u ON l.attendant_id = u.id LEFT JOIN whatsapp_instances wi ON l.instance_id = wi.id
    WHERE l.id = ?
  `).get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  if (req.user.role === 'atendente' && lead.attendant_id !== req.user.id) return res.status(403).json({ error: 'Sem permissao' })

  // Opening an archived lead acknowledges any new activity — clear the badge
  if (lead.is_archived && lead.has_new_after_archive) {
    db.prepare('UPDATE leads SET has_new_after_archive = 0 WHERE id = ?').run(lead.id)
    lead.has_new_after_archive = 0
  }

  lead.tags = db.prepare('SELECT t.id, t.name, t.color FROM lead_tags lt JOIN tags t ON lt.tag_id = t.id WHERE lt.lead_id = ?').all(lead.id)
  const messages = db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50').all(lead.id)
  const stageHistory = db.prepare(`
    SELECT sh.*, fs_from.name as from_stage_name, fs_to.name as to_stage_name, u.name as user_name
    FROM stage_history sh
    LEFT JOIN funnel_stages fs_from ON sh.from_stage_id = fs_from.id
    LEFT JOIN funnel_stages fs_to ON sh.to_stage_id = fs_to.id
    LEFT JOIN users u ON sh.triggered_by = u.id
    WHERE sh.lead_id = ? ORDER BY sh.created_at DESC
  `).all(lead.id)

  const notes = db.prepare('SELECT n.*, u.name as user_name FROM lead_notes n LEFT JOIN users u ON n.user_id = u.id WHERE n.lead_id = ? ORDER BY n.created_at DESC').all(lead.id)
  res.json({ lead, messages: messages.reverse(), stageHistory, notes })
})

// Update lead
router.put('/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })

  const { name, phone, email, city, notes, custom_fields, empresa, cpf_cnpj, instagram, trabalha_anuncio, investimento_anuncios } = req.body
  const sets = []; const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (phone !== undefined) { sets.push('phone = ?'); params.push(phone) }
  if (email !== undefined) { sets.push('email = ?'); params.push(email) }
  if (city !== undefined) { sets.push('city = ?'); params.push(city) }
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes) }
  if (custom_fields !== undefined) { sets.push('custom_fields = ?'); params.push(JSON.stringify(custom_fields)) }
  if (empresa !== undefined) { sets.push('empresa = ?'); params.push(empresa || null) }
  if (cpf_cnpj !== undefined) { sets.push('cpf_cnpj = ?'); params.push(cpf_cnpj || null) }
  if (instagram !== undefined) { sets.push('instagram = ?'); params.push(instagram || null) }
  if (trabalha_anuncio !== undefined) { sets.push('trabalha_anuncio = ?'); params.push(trabalha_anuncio ? 1 : 0) }
  if (investimento_anuncios !== undefined) { sets.push('investimento_anuncios = ?'); params.push(investimento_anuncios || null) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  try { broadcastSSE(lead.account_id, 'lead:updated', updated) } catch {}
  res.json({ lead: updated })
})

// Move lead stage
router.put('/:id/stage', (req, res) => {
  const { stage_id } = req.body
  if (!stage_id) return res.status(400).json({ error: 'stage_id required' })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })

  const oldStageId = lead.stage_id
  db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage_id, lead.id)
  db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type, triggered_by) VALUES (?, ?, ?, ?, ?)').run(
    lead.id, oldStageId, stage_id, 'manual', req.user.id
  )

  const updated = db.prepare('SELECT l.*, fs.name as stage_name, fs.color as stage_color, wi.instance_name as instance_name FROM leads l LEFT JOIN funnel_stages fs ON l.stage_id = fs.id LEFT JOIN whatsapp_instances wi ON l.instance_id = wi.id WHERE l.id = ?').get(lead.id)
  try { broadcastSSE(lead.account_id, 'lead:updated', updated) } catch {}
  res.json({ lead: updated })
})

// Archive lead — hides from pipeline/chat; messages still stored but don't broadcast
router.patch('/:id/archive', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  if (req.user.role === 'atendente' && lead.attendant_id !== req.user.id) return res.status(403).json({ error: 'Sem permissao' })
  db.prepare("UPDATE leads SET is_archived = 1, archived_at = datetime('now'), has_new_after_archive = 0, updated_at = datetime('now') WHERE id = ?").run(lead.id)
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  try { broadcastSSE(lead.account_id, 'lead:archived', { id: lead.id }) } catch {}
  res.json({ lead: updated })
})

// Unarchive lead — returns it to the active pipeline/chat
router.patch('/:id/unarchive', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  if (req.user.role === 'atendente' && lead.attendant_id !== req.user.id) return res.status(403).json({ error: 'Sem permissao' })
  db.prepare("UPDATE leads SET is_archived = 0, archived_at = NULL, has_new_after_archive = 0, updated_at = datetime('now') WHERE id = ?").run(lead.id)
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  try { broadcastSSE(lead.account_id, 'lead:unarchived', updated) } catch {}
  res.json({ lead: updated })
})

// Assign attendant
router.put('/:id/assign', requireRole('super_admin', 'gerente'), (req, res) => {
  const { attendant_id } = req.body
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  db.prepare("UPDATE leads SET attendant_id = ?, updated_at = datetime('now') WHERE id = ?").run(attendant_id || null, lead.id)
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  try { broadcastSSE(lead.account_id, 'lead:updated', updated) } catch {}
  res.json({ lead: updated })
})

// Refresh profile picture from Evolution API
router.post('/:id/refresh-profile-pic', async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead || !lead.phone) return res.status(404).json({ error: 'Lead nao encontrado ou sem telefone' })
  const instance = lead.instance_id
    ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(lead.instance_id)
    : db.prepare("SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = 'connected' LIMIT 1").get(lead.account_id)
  if (!instance) return res.status(400).json({ error: 'Sem instancia WhatsApp' })
  try {
    const r = await fetch(`${instance.api_url}/chat/fetchProfilePictureUrl/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ number: lead.phone }),
    })
    const data = await r.json()
    const url = data?.profilePictureUrl || null
    db.prepare("UPDATE leads SET profile_pic_url = ?, profile_pic_updated_at = datetime('now') WHERE id = ?").run(url, lead.id)
    res.json({ profile_pic_url: url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Add tag
router.post('/:id/tags', (req, res) => {
  const { tag_id } = req.body
  if (!tag_id) return res.status(400).json({ error: 'tag_id required' })
  try {
    db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(req.params.id, tag_id)
  } catch {}
  res.json({ ok: true })
})

// Remove tag
router.delete('/:id/tags/:tagId', (req, res) => {
  db.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag_id = ?').run(req.params.id, req.params.tagId)
  res.json({ ok: true })
})

// Export CSV
router.get('/export', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { date_from, date_to, funnel_id } = req.query
  const where = ['l.account_id = ?']
  const params = [req.accountId]
  if (date_from) { where.push('l.created_at >= ?'); params.push(date_from) }
  if (date_to) { where.push('l.created_at <= ?'); params.push(date_to + ' 23:59:59') }
  if (funnel_id) { where.push('l.funnel_id = ?'); params.push(funnel_id) }

  const leads = db.prepare(`
    SELECT l.name, l.phone, l.email, l.city, l.source, fs.name as etapa, u.name as atendente, l.notes, l.created_at, l.updated_at
    FROM leads l LEFT JOIN funnel_stages fs ON l.stage_id = fs.id LEFT JOIN users u ON l.attendant_id = u.id
    WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC
  `).all(...params)

  const header = 'Nome,Telefone,Email,Cidade,Fonte,Etapa,Atendente,Notas,Criado em,Atualizado em'
  const rows = leads.map(l => [l.name, l.phone, l.email, l.city, l.source, l.etapa, l.atendente, `"${(l.notes || '').replace(/"/g, '""')}"`, l.created_at, l.updated_at].join(','))
  const csv = [header, ...rows].join('\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename=leads-${new Date().toISOString().slice(0, 10)}.csv`)
  res.send('\uFEFF' + csv) // BOM for Excel UTF-8
})

// =============================================
// NOTES
// =============================================

router.get('/:id/notes', (req, res) => {
  const notes = db.prepare(`
    SELECT n.*, u.name as user_name FROM lead_notes n LEFT JOIN users u ON n.user_id = u.id
    WHERE n.lead_id = ? ORDER BY n.created_at DESC
  `).all(req.params.id)
  res.json({ notes })
})

router.post('/:id/notes', (req, res) => {
  const { content } = req.body
  if (!content) return res.status(400).json({ error: 'content required' })
  const result = db.prepare('INSERT INTO lead_notes (lead_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.user.id, content)
  const note = db.prepare('SELECT n.*, u.name as user_name FROM lead_notes n LEFT JOIN users u ON n.user_id = u.id WHERE n.id = ?').get(result.lastInsertRowid)
  res.json({ note })
})

// =============================================
// TAGS CRUD
// =============================================

router.get('/tags/list', (req, res) => {
  if (!req.accountId) return res.json({ tags: [] })
  const tags = db.prepare('SELECT * FROM tags WHERE account_id = ? ORDER BY name').all(req.accountId)
  res.json({ tags })
})

router.post('/tags/create', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { name, color } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const result = db.prepare('INSERT INTO tags (account_id, name, color) VALUES (?, ?, ?)').run(req.accountId, name, color || '#FFB300')
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid)
    res.json({ tag })
  } catch { res.status(400).json({ error: 'Tag ja existe' }) }
})

router.delete('/tags/:tagId', requireRole('super_admin', 'gerente'), (req, res) => {
  db.prepare('DELETE FROM lead_tags WHERE tag_id = ?').run(req.params.tagId)
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.tagId)
  res.json({ ok: true })
})

// =============================================
// BULK ACTIONS
// =============================================

router.post('/bulk/assign', requireRole('super_admin', 'gerente'), (req, res) => {
  const { lead_ids, attendant_id } = req.body
  if (!lead_ids || !Array.isArray(lead_ids)) return res.status(400).json({ error: 'lead_ids required' })
  const stmt = db.prepare("UPDATE leads SET attendant_id = ?, updated_at = datetime('now') WHERE id = ?")
  const transaction = db.transaction(() => { for (const id of lead_ids) stmt.run(attendant_id || null, id) })
  transaction()
  res.json({ ok: true, count: lead_ids.length })
})

router.post('/bulk/stage', requireRole('super_admin', 'gerente'), (req, res) => {
  const { lead_ids, stage_id } = req.body
  if (!lead_ids || !Array.isArray(lead_ids) || !stage_id) return res.status(400).json({ error: 'lead_ids and stage_id required' })
  const stmtUpdate = db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?")
  const stmtHistory = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type, triggered_by) VALUES (?, (SELECT stage_id FROM leads WHERE id = ?), ?, ?, ?)')
  const transaction = db.transaction(() => {
    for (const id of lead_ids) {
      stmtHistory.run(id, id, stage_id, 'manual', req.user.id)
      stmtUpdate.run(stage_id, id)
    }
  })
  transaction()
  res.json({ ok: true, count: lead_ids.length })
})

// =============================================
// PIPELINE METRICS
// =============================================

router.get('/pipeline/metrics', (req, res) => {
  if (!req.accountId) return res.json({ metrics: [] })
  const { funnel_id } = req.query
  if (!funnel_id) return res.json({ metrics: [] })

  const metrics = db.prepare(`
    SELECT fs.id as stage_id, fs.name, fs.color, fs.position, fs.is_conversion,
      COUNT(l.id) as lead_count,
      AVG(CASE WHEN l.updated_at != l.created_at THEN (julianday(l.updated_at) - julianday(l.created_at)) * 24 ELSE NULL END) as avg_hours_in_stage
    FROM funnel_stages fs
    LEFT JOIN leads l ON l.stage_id = fs.id AND l.is_active = 1 AND l.is_archived = 0
    WHERE fs.funnel_id = ?
    GROUP BY fs.id
    ORDER BY fs.position
  `).all(funnel_id)

  // Calculate conversion rates between stages
  let totalLeads = metrics.reduce((s, m) => s + m.lead_count, 0)
  const result = metrics.map((m, i) => ({
    ...m,
    avg_hours_in_stage: m.avg_hours_in_stage ? Math.round(m.avg_hours_in_stage * 10) / 10 : null,
    pct_of_total: totalLeads > 0 ? ((m.lead_count / totalLeads) * 100) : 0,
    conversion_from_prev: i > 0 && metrics[i - 1].lead_count > 0 ? ((m.lead_count / metrics[i - 1].lead_count) * 100) : null,
  }))

  res.json({ metrics: result, totalLeads })
})

export default router
