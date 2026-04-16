import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchCadences, createCadence, updateCadenceAttempts, deleteCadence,
  type Cadence, type CadenceAttempt,
} from '../lib/api'
import { Plus, Trash2, Save, ListOrdered, Phone, Mail, MessageCircle, Video, MapPin, ChevronDown, ChevronUp } from 'lucide-react'

const ACTION_TYPES = [
  { value: 'mensagem', label: 'Mensagem', icon: MessageCircle },
  { value: 'ligacao', label: 'Ligacao', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'reuniao', label: 'Reuniao', icon: Video },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'visita', label: 'Visita', icon: MapPin },
]

export default function Cadences() {
  const { accountId } = useAccount()
  const [cadences, setCadences] = useState<Cadence[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Cadence | null>(null)
  const [editAttempts, setEditAttempts] = useState<Partial<CadenceAttempt>[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const load = () => { if (accountId) { setLoading(true); fetchCadences(accountId).then(setCadences).finally(() => setLoading(false)) } }
  useEffect(load, [accountId])

  const handleCreate = async () => {
    if (!accountId || !newName) return
    await createCadence(accountId, { name: newName, description: newDesc || undefined })
    setShowNew(false); setNewName(''); setNewDesc(''); load()
  }

  const startEdit = (c: Cadence) => { setEditing(c); setEditAttempts(c.attempts.map(a => ({ ...a }))) }
  const addAttempt = () => setEditAttempts(prev => [...prev, { action_type: 'mensagem', description: '', instructions: '', schedule_mode: 'date', delay_days: 0, delay_minutes: 0 }])
  const removeAttempt = (i: number) => setEditAttempts(prev => prev.filter((_, idx) => idx !== i))
  const updateAttempt = (i: number, field: string, value: string) => setEditAttempts(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: (field === 'delay_days' || field === 'delay_minutes') ? (parseInt(value) || 0) : value } : a))

  const saveAttempts = async () => {
    if (!editing || !accountId) return
    await updateCadenceAttempts(editing.id, accountId, editAttempts.map((a, i) => ({ ...a, position: i })))
    setEditing(null); load()
  }

  const handleDelete = async (id: number) => {
    if (!accountId) return
    await deleteCadence(id, accountId); load()
  }

  return (
    <div>
      <div className="page-header">
        <h1>Cadencias de Atendimento</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova Cadencia</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cadences.map(c => (
            <div key={c.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ListOrdered size={16} style={{ color: '#FFB300' }} />
                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</h3>
                    <span style={{ fontSize: 11, color: '#9B96B0', background: 'rgba(155,150,176,0.1)', padding: '2px 8px', borderRadius: 10 }}>{c.attempts.length} etapas</span>
                    {expanded === c.id ? <ChevronUp size={14} style={{ color: '#6B6580' }} /> : <ChevronDown size={14} style={{ color: '#6B6580' }} />}
                  </div>
                  {c.description && <p style={{ fontSize: 12, color: '#9B96B0', marginTop: 4 }}>{c.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => startEdit(c)}>Editar</button>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(c.id)}><Trash2 size={12} /></button>
                </div>
              </div>
              {expanded === c.id && c.attempts.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {c.attempts.map((a, i) => {
                    const at = ACTION_TYPES.find(t => t.value === a.action_type)
                    const Icon = at?.icon || MessageCircle
                    return (
                      <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', background: 'rgba(255,179,0,0.03)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#FFB30020', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#FFB300' }}>{i + 1}</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon size={12} style={{ color: '#FFB300' }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#FFB300', textTransform: 'uppercase' }}>{at?.label || a.action_type}</span>
                            <span style={{ fontSize: 10, color: '#9B96B0', marginLeft: 'auto' }}>
                              {a.schedule_mode === 'duration'
                                ? `${a.delay_minutes} min depois`
                                : `D+${a.delay_days ?? 0}${a.scheduled_time ? ` as ${a.scheduled_time}` : ''}`}
                            </span>
                          </div>
                          {a.description && <div style={{ fontSize: 12, marginTop: 2 }}>{a.description}</div>}
                          {a.instructions && <div style={{ fontSize: 11, color: '#9B96B0', marginTop: 2 }}>{a.instructions}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {cadences.length === 0 && <div className="empty-state"><h3>Nenhuma cadencia criada</h3><p>Crie cadencias de atendimento para organizar o follow-up dos leads.</p></div>}
        </div>
      )}

      {/* Edit attempts modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 650 }} onClick={e => e.stopPropagation()}>
            <h2>Editar Etapas — {editing.name}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, maxHeight: 400, overflowY: 'auto' }}>
              {editAttempts.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, color: '#9B96B0', fontSize: 12, fontWeight: 700, paddingTop: 8 }}>{i + 1}</div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select className="select" value={a.action_type || 'mensagem'} onChange={e => updateAttempt(i, 'action_type', e.target.value)} style={{ width: 130 }}>
                        {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <input className="input" value={a.description || ''} onChange={e => updateAttempt(i, 'description', e.target.value)} placeholder="Descricao" style={{ flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                      <button type="button" className={`btn btn-sm ${(a.schedule_mode || 'date') === 'date' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => updateAttempt(i, 'schedule_mode', 'date')} style={{ fontSize: 10, padding: '3px 10px' }}>Por Data</button>
                      <button type="button" className={`btn btn-sm ${a.schedule_mode === 'duration' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => updateAttempt(i, 'schedule_mode', 'duration')} style={{ fontSize: 10, padding: '3px 10px' }}>Por Tempo</button>
                      <span style={{ fontSize: 10, color: '#6B6580', marginLeft: 4 }}>
                        {i === 0 ? '(a partir da atribuicao)' : '(a partir da conclusao da etapa anterior)'}
                      </span>
                    </div>
                    {a.schedule_mode === 'duration' ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="number" min={0} className="input" value={a.delay_minutes ?? 0} onChange={e => updateAttempt(i, 'delay_minutes', e.target.value)} placeholder="10" style={{ width: 80, textAlign: 'center' }} />
                        <span style={{ fontSize: 11, color: '#9B96B0' }}>minutos depois</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 11, color: '#FFB300', fontWeight: 700 }}>D+</span>
                          <input type="number" min={0} className="input" value={a.delay_days ?? 0} onChange={e => updateAttempt(i, 'delay_days', e.target.value)} placeholder="0" style={{ width: 60, textAlign: 'center' }} title="D+0 = mesmo dia, D+1 = dia seguinte..." />
                        </div>
                        <span style={{ fontSize: 11, color: '#9B96B0' }}>as</span>
                        <input type="time" className="input" value={a.scheduled_time || ''} onChange={e => updateAttempt(i, 'scheduled_time', e.target.value)} style={{ width: 110 }} title="Horario do dia (opcional)" />
                      </div>
                    )}
                    <input className="input" value={a.instructions || ''} onChange={e => updateAttempt(i, 'instructions', e.target.value)} placeholder="Instrucoes (opcional)" style={{ fontSize: 12 }} />
                    {(a.action_type === 'whatsapp' || a.action_type === 'mensagem') && (
                      <textarea className="input" value={a.auto_message || ''} onChange={e => updateAttempt(i, 'auto_message', e.target.value)} placeholder="Mensagem automatica (opcional) — use {{name}} para nome do lead" rows={2} style={{ fontSize: 12, resize: 'vertical' }} />
                    )}
                  </div>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeAttempt(i)} style={{ marginTop: 6 }}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addAttempt}><Plus size={12} /> Adicionar Etapa</button>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveAttempts}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* New cadence modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Nova Cadencia</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Follow-up Padrao" /></div>
            <div className="form-group"><label>Descricao (opcional)</label><textarea className="input" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descreva o objetivo desta cadencia" rows={3} style={{ resize: 'vertical' }} /></div>
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
