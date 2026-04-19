import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAccounts, createAccount, formatNumber, type Account } from '../../lib/api'
import { Building2, Plus, Users, Eye } from 'lucide-react'

export default function Clients() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')

  const load = () => { setLoading(true); fetchAccounts().then(setAccounts).finally(() => setLoading(false)) }
  useEffect(load, [])

  const handleCreate = async () => {
    if (!newName) return
    await createAccount(newName)
    setShowNew(false); setNewName(''); load()
  }

  return (
    <div>
      <div className="page-header">
        <h1><Building2 size={20} style={{ marginRight: 8 }} /> Clientes</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova Conta</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>Slug</th><th className="right">Leads</th><th className="right">Usuarios</th><th>Status</th><th className="right">Acoes</th></tr></thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id}>
                <td className="name">{a.name}</td>
                <td style={{ color: '#9B96B0' }}>{a.slug}</td>
                <td className="right" style={{ fontWeight: 600 }}>{formatNumber(a.lead_count || 0)}</td>
                <td className="right">{a.user_count || 0}</td>
                <td><span style={{ color: a.is_active ? '#34C759' : '#FF6B6B' }}>{a.is_active ? 'Ativo' : 'Inativo'}</span></td>
                <td className="right"><button className="btn btn-secondary btn-sm" onClick={() => navigate(`/admin/clients/${a.id}`)}><Eye size={12} /> Ver</button></td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhuma conta criada</td></tr>}
          </tbody>
        </table></div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Nova Conta</h2>
            <div className="form-group"><label>Nome do Cliente</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: BG Imoveis" /></div>
            <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 8 }}>Um funil padrao sera criado automaticamente.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate}>Criar Conta</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
