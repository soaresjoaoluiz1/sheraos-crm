import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchFunnels, createFunnel, updateFunnelStages, type Funnel, type FunnelStage } from '../lib/api'
import { Plus, GripVertical, Trash2, Save, Target } from 'lucide-react'

const DEFAULT_COLORS = ['#FFB300', '#5DADE2', '#9B59B6', '#FFAA83', '#FF6B8A', '#34C759', '#FF6B6B']

export default function Funnels() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Funnel | null>(null)
  const [editStages, setEditStages] = useState<Partial<FunnelStage>[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')

  const load = () => { if (accountId) { setLoading(true); fetchFunnels(accountId).then(setFunnels).finally(() => setLoading(false)) } }
  useEffect(load, [accountId])

  const handleCreate = async () => {
    if (!accountId || !newName) return
    const stages = [
      { name: 'Novo Lead', color: '#FFB300' },
      { name: 'Em Atendimento', color: '#5DADE2' },
      { name: 'Qualificado', color: '#9B59B6' },
      { name: 'Venda', color: '#34C759', is_conversion: true, is_terminal: true },
      { name: 'Perdido', color: '#FF6B6B', is_terminal: true },
    ]
    await createFunnel(accountId, { name: newName, stages })
    setShowNew(false); setNewName(''); load()
  }

  const startEdit = (f: Funnel) => { setEditing(f); setEditStages(f.stages.map(s => ({ ...s }))) }

  const addStage = () => { setEditStages(prev => [...prev, { name: '', color: DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length], is_conversion: 0, is_terminal: 0, auto_keywords: null }]) }
  const removeStage = (i: number) => { setEditStages(prev => prev.filter((_, idx) => idx !== i)) }
  const updateStage = (i: number, field: string, value: any) => { setEditStages(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s)) }

  const saveStages = async () => {
    if (!editing || !accountId) return
    await updateFunnelStages(editing.id, accountId, editStages.map((s, i) => ({ ...s, position: i })))
    setEditing(null); load()
  }

  return (
    <div>
      <div className="page-header">
        <h1>Funis</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Funil</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {funnels.map(f => (
            <div key={f.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 600 }}>{f.name}</h3>
                  {f.is_default ? <span style={{ fontSize: 10, color: '#FFB300' }}>PADRAO</span> : null}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(f)}>Editar Etapas</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {f.stages.map(s => (
                  <span key={s.id} className="stage-badge" style={{ background: `${s.color}20`, color: s.color }}>
                    {s.is_conversion ? <Target size={10} style={{ marginRight: 3 }} /> : null}
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {funnels.length === 0 && <div className="empty-state"><h3>Nenhum funil criado</h3></div>}
        </div>
      )}

      {/* Edit stages modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h2>Editar Etapas — {editing.name}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {editStages.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <GripVertical size={14} style={{ color: '#6B6580', cursor: 'grab' }} />
                  <input type="color" value={s.color || '#FFB300'} onChange={e => updateStage(i, 'color', e.target.value)} style={{ width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
                  <input className="input" value={s.name || ''} onChange={e => updateStage(i, 'name', e.target.value)} placeholder="Nome da etapa" style={{ flex: 1 }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!s.is_conversion} onChange={e => updateStage(i, 'is_conversion', e.target.checked ? 1 : 0)} /> Conv.
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!s.is_terminal} onChange={e => updateStage(i, 'is_terminal', e.target.checked ? 1 : 0)} /> Final
                  </label>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeStage(i)}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addStage}><Plus size={12} /> Adicionar Etapa</button>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveStages}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* New funnel modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Funil</h2>
            <div className="form-group"><label>Nome do Funil</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Funil de Vendas" /></div>
            <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 8 }}>Um funil padrao sera criado com etapas: Novo Lead, Em Atendimento, Qualificado, Venda, Perdido. Voce pode editar depois.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate}>Criar Funil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
