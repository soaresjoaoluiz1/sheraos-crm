import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchUsers, createUser, updateUser, deleteUser, type User as UserType } from '../lib/api'
import { UserPlus, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'

export default function Team() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [users, setUsers] = useState<UserType[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' })

  const load = () => { if (accountId) { setLoading(true); fetchUsers(accountId).then(setUsers).finally(() => setLoading(false)) } }
  useEffect(load, [accountId])

  const handleCreate = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return
    await createUser({ ...newUser, role: 'atendente', account_id: accountId! })
    setShowNew(false); setNewUser({ name: '', email: '', password: '' }); load()
  }

  const toggleActive = async (u: UserType) => { await updateUser(u.id, { is_active: u.is_active ? 0 : 1 } as any); load() }
  const handleDelete = async (u: UserType) => { if (confirm(`Remover ${u.name}?`)) { await deleteUser(u.id); load() } }

  const atendentes = users.filter(u => u.role === 'atendente')
  const gerentes = users.filter(u => u.role === 'gerente')

  return (
    <div>
      <div className="page-header">
        <h1>Equipe</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><UserPlus size={14} /> Novo Atendente</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <>
          {gerentes.length > 0 && (
            <section className="dash-section">
              <div className="section-title">Gerentes</div>
              <div className="table-card"><table><thead><tr><th>Nome</th><th>Email</th><th>Status</th></tr></thead>
                <tbody>{gerentes.map(u => <tr key={u.id}><td className="name">{u.name}</td><td>{u.email}</td><td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td></tr>)}</tbody>
              </table></div>
            </section>
          )}

          <section className="dash-section">
            <div className="section-title">Atendentes ({atendentes.length})</div>
            <div className="table-card"><table><thead><tr><th>Nome</th><th>Email</th><th>Status</th><th className="right">Acoes</th></tr></thead>
              <tbody>
                {atendentes.map(u => (
                  <tr key={u.id}>
                    <td className="name">{u.name}</td>
                    <td>{u.email}</td>
                    <td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
                    <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => toggleActive(u)} title={u.is_active ? 'Desativar' : 'Ativar'}>
                        {u.is_active ? <ToggleRight size={14} style={{ color: '#34C759' }} /> : <ToggleLeft size={14} />}
                      </button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(u)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {atendentes.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: '#6B6580' }}>Nenhum atendente cadastrado</td></tr>}
              </tbody>
            </table></div>
          </section>
        </>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Atendente</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Senha</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
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
