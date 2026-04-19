import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// List all accounts (super_admin only)
router.get('/', requireRole('super_admin'), (req, res) => {
  const accounts = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM leads WHERE account_id = a.id) as lead_count,
      (SELECT COUNT(*) FROM users WHERE account_id = a.id) as user_count
    FROM accounts a ORDER BY a.name
  `).all()
  res.json({ accounts })
})

// Create account
router.post('/', requireRole('super_admin'), (req, res) => {
  const { name, logo_url } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const existing = db.prepare('SELECT id FROM accounts WHERE slug = ?').get(slug)
  if (existing) return res.status(400).json({ error: 'Conta com esse nome ja existe' })

  const result = db.prepare('INSERT INTO accounts (name, slug, logo_url) VALUES (?, ?, ?)').run(name, slug, logo_url || null)

  // Create default funnel with standard stages
  const funnelResult = db.prepare('INSERT INTO funnels (account_id, name, is_default) VALUES (?, ?, 1)').run(result.lastInsertRowid, 'Funil Principal')
  const funnelId = funnelResult.lastInsertRowid
  const stages = [
    { name: 'Novo Lead', position: 0, color: '#FFB300' },
    { name: 'Em Atendimento', position: 1, color: '#5DADE2' },
    { name: 'Qualificado', position: 2, color: '#9B59B6' },
    { name: 'Visita Agendada', position: 3, color: '#FFAA83' },
    { name: 'Proposta', position: 4, color: '#FF6B8A' },
    { name: 'Venda', position: 5, color: '#34C759', is_conversion: 1, is_terminal: 1 },
    { name: 'Perdido', position: 6, color: '#FF6B6B', is_terminal: 1 },
  ]
  const stageStmt = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal) VALUES (?, ?, ?, ?, ?, ?)')
  for (const s of stages) stageStmt.run(funnelId, s.name, s.position, s.color, s.is_conversion || 0, s.is_terminal || 0)

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid)
  res.json({ account })
})

// Get account detail
router.get('/:id', requireRole('super_admin'), (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id)
  if (!account) return res.status(404).json({ error: 'Conta nao encontrada' })
  const users = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE account_id = ?').all(account.id)
  const funnels = db.prepare('SELECT * FROM funnels WHERE account_id = ?').all(account.id)
  res.json({ account, users, funnels })
})

// Update account
router.put('/:id', requireRole('super_admin'), (req, res) => {
  const { name, logo_url, is_active, evolution_api_url, evolution_api_key } = req.body
  const sets = []
  const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (logo_url !== undefined) { sets.push('logo_url = ?'); params.push(logo_url) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (evolution_api_url !== undefined) { sets.push('evolution_api_url = ?'); params.push(evolution_api_url || null) }
  if (evolution_api_key !== undefined) { sets.push('evolution_api_key = ?'); params.push(evolution_api_key || null) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id)
  res.json({ account })
})

export default router
