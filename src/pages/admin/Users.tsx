import { useState, useEffect } from 'react'
import { fetchUsers, fetchAccounts, createUser, type User as UserType, type Account } from '../../lib/api'
import { UsersRound, UserPlus } from 'lucide-react'

export default function AdminUsers() {
  const [users, setUsers] = useState<UserType[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'gerente', account_id: '' })

  const load = () => { setLoading(true); Promise.all([fetchUsers(), fetchAccounts()]).then(([u, a]) => { setUsers(u); setAccounts(a) }).finally(() => setLoading(false)) }
  useEffect(load, [])

  const handleCreate = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return
    await createUser({ ...newUser, account_id: newUser.account_id ? +newUser.account_id : undefined })
    setShowNew(false); setNewUser({ name: '', email: '', password: '', role: 'gerente', account_id: '' }); load()
  }

  const getAccountName = (id: number | null) => id ? accounts.find(a => a.id === id)?.name || '-' : 'Admin'

  return (
    <div>
      <div className="page-header">
        <h1><UsersRound size={20} style={{ marginRight: 8 }} /> Todos Usuarios</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><UserPlus size={14} /> Novo Usuario</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>Email</th><th>Conta</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="name">{u.name}</td><td>{u.email}</td>
                <td>{getAccountName(u.account_id)}</td>
                <td><span className="stage-badge" style={{ background: u.role === 'super_admin' ? '#FF6B6B20' : u.role === 'gerente' ? '#FFB30020' : '#5DADE220', color: u.role === 'super_admin' ? '#FF6B6B' : u.role === 'gerente' ? '#FFB300' : '#5DADE2' }}>{u.role}</span></td>
                <td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Usuario</h2>
            <div className="form-group"><label>Conta</label>
              <select className="select" value={newUser.account_id} onChange={e => setNewUser(p => ({ ...p, account_id: e.target.value }))}>
                <option value="">Admin (sem conta)</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Nome</label><input className="input" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Senha</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
            <div className="form-group"><label>Role</label>
              <select className="select" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                <option value="super_admin">Super Admin</option><option value="gerente">Gerente</option><option value="atendente">Atendente</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
