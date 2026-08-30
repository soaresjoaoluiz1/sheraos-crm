import jwt from 'jsonwebtoken'

// FIX #1 — remove fallback publico. Se JWT_SECRET nao esta setado no env, aplicacao
// FALHA IMEDIATAMENTE em vez de rodar com secret que qualquer um pode ler no repo.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('[FATAL] JWT_SECRET nao setado ou muito curto (min 32 chars). Verifique .env.production e o symlink .env → .env.production.')
}
const JWT_SECRET = process.env.JWT_SECRET

// Verify JWT and attach user to request
export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' })
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// Require specific roles
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

// Auto-scope queries to user's account (gerente/atendente)
// Super admin can pass ?account_id=X to scope themselves
export function scopeToAccount(req, res, next) {
  if (req.user.role === 'super_admin') {
    req.accountId = req.query.account_id ? parseInt(req.query.account_id) : null
  } else {
    req.accountId = req.user.account_id
  }
  next()
}

export { JWT_SECRET }
