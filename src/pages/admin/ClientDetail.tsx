import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchAccount, createUser, type Account, type User as UserType, type Funnel } from '../../lib/api'
import { ArrowLeft, UserPlus, Building2 } from 'lucide-react'

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [account, setAccount] = useState<Account | null>(null)
  const [users, setUsers] = useState<UserType[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewUser, setShowNewUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'gerente' })

  const load = () => {
    if (!id) return
    setLoading(true)
    fetchAccount(+id).then(data => { setAccount(data.account); setUsers(data.users); setFunnels(data.funnels) }).finally(() => setLoading(false))
  }
  useEffect(load, [id])

  const handleCreateUser = async () => {
    if (!id || !newUser.name || !newUser.email || !newUser.password) return
    await createUser({ ...newUser, account_id: +id })
    setShowNewUser(false); setNewUser({ name: '', email: '', password: '', role: 'gerente' }); load()
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!account) return <div className="empty-state"><h3>Conta nao encontrada</h3></div>

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => navigate('/admin/clients')}><ArrowLeft size={16} /></button>
          <div><h1><Building2 size={20} style={{ marginRight: 8 }} />{account.name}</h1><div style={{ fontSize: 12, color: '#9B96B0' }}>Slug: {account.slug}</div></div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNewUser(true)}><UserPlus size={14} /> Novo Usuario</button>
      </div>

      <section className="dash-section">
        <div className="section-title">Usuarios ({users.length})</div>
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>
            {users.map(u => <tr key={u.id}><td className="name">{u.name}</td><td>{u.email}</td><td><span className="stage-badge" style={{ background: u.role === 'gerente' ? '#FFB30020' : '#5DADE220', color: u.role === 'gerente' ? '#FFB300' : '#5DADE2' }}>{u.role}</span></td><td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td></tr>)}
            {users.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: '#6B6580' }}>Nenhum usuario</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="dash-section">
        <div className="section-title">Funis ({funnels.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {funnels.map(f => (
            <div key={f.id} className="card">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{f.name} {f.is_default ? <span style={{ fontSize: 10, color: '#FFB300' }}>PADRAO</span> : null}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(f.stages || []).map(s => <span key={s.id} className="stage-badge" style={{ background: `${s.color}20`, color: s.color }}>{s.name}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {showNewUser && (
        <div className="modal-overlay" onClick={() => setShowNewUser(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Usuario — {account.name}</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Senha</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
            <div className="form-group"><label>Role</label>
              <select className="select" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                <option value="gerente">Gerente</option><option value="atendente">Atendente</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewUser(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreateUser}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
