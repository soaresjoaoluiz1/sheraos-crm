import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try { await login(email, password) }
    catch (err: any) { setError(err.message || 'Erro ao fazer login') }
    finally { setLoading(false) }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo-dros.png" alt="Dros" style={{ height: 36, marginBottom: 16 }} />
        <h1>Sheraos CRM</h1>
        <div className="subtitle">Gestao de leads e pipeline de vendas</div>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label>Email</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div className="form-group"><label>Senha</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 8 }}>{loading ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  )
}
