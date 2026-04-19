import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchBroadcasts, fetchLeads, createBroadcast, sendBroadcast, formatNumber, type Broadcast, type Lead } from '../lib/api'
import { MessageCircle, Plus, Send, CheckCircle, XCircle, Clock } from 'lucide-react'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: '#9B96B0' },
  scheduled: { label: 'Agendado', color: '#FBBC04' },
  sending: { label: 'Enviando', color: '#5DADE2' },
  completed: { label: 'Concluido', color: '#34C759' },
  failed: { label: 'Falhou', color: '#FF6B6B' },
}

export default function Messages() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTemplate, setNewTemplate] = useState('')
  const [selectedLeads, setSelectedLeads] = useState<Lead[]>([])
  const [leadSearch, setLeadSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Lead[]>([])
  const [step, setStep] = useState(1)

  const load = () => { if (accountId) { setLoading(true); fetchBroadcasts(accountId).then(setBroadcasts).finally(() => setLoading(false)) } }
  useEffect(load, [accountId])

  const searchLeads = async () => {
    if (!accountId) return
    const data = await fetchLeads(accountId, { search: leadSearch, limit: 50 })
    setSearchResults(data.leads.filter(l => l.phone))
  }

  useEffect(() => { if (leadSearch.length > 1 && accountId) searchLeads() }, [leadSearch])

  const toggleLead = (lead: Lead) => {
    setSelectedLeads(prev => prev.some(l => l.id === lead.id) ? prev.filter(l => l.id !== lead.id) : [...prev, lead])
  }

  const selectAll = () => setSelectedLeads(searchResults.filter(l => l.phone))

  const handleCreate = async () => {
    if (!accountId || !newName || !newTemplate || selectedLeads.length === 0) return
    await createBroadcast(accountId, { name: newName, message_template: newTemplate, lead_ids: selectedLeads.map(l => l.id) })
    setShowNew(false); setNewName(''); setNewTemplate(''); setSelectedLeads([]); setStep(1); load()
  }

  const handleSend = async (id: number) => {
    if (!accountId || !confirm('Enviar disparo agora?')) return
    await sendBroadcast(id, accountId)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <h1><MessageCircle size={20} style={{ marginRight: 8 }} /> Disparos</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Disparo</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card">
          <table>
            <thead><tr><th>Nome</th><th>Status</th><th className="right">Enviados</th><th className="right">Falhas</th><th className="right">Total</th><th className="right">Criado em</th><th className="right">Acoes</th></tr></thead>
            <tbody>
              {broadcasts.map(b => {
                const st = STATUS_MAP[b.status] || { label: b.status, color: '#9B96B0' }
                return (
                  <tr key={b.id}>
                    <td className="name">{b.name}</td>
                    <td><span className="stage-badge" style={{ background: `${st.color}20`, color: st.color }}>{st.label}</span></td>
                    <td className="right" style={{ color: '#34C759' }}>{b.sent_count}</td>
                    <td className="right" style={{ color: b.failed_count > 0 ? '#FF6B6B' : undefined }}>{b.failed_count}</td>
                    <td className="right">{b.total_count}</td>
                    <td className="right">{new Date(b.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="right">
                      {b.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => handleSend(b.id)}><Send size={12} /> Enviar</button>}
                      {b.status === 'completed' && <CheckCircle size={14} style={{ color: '#34C759' }} />}
                      {b.status === 'sending' && <Clock size={14} style={{ color: '#5DADE2' }} />}
                    </td>
                  </tr>
                )
              })}
              {broadcasts.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhum disparo criado</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New broadcast modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => { setShowNew(false); setStep(1) }}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h2>Novo Disparo — Etapa {step}/3</h2>

            {step === 1 && (
              <>
                <div className="form-group"><label>Nome do disparo</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Promo Marco 2026" /></div>
                <div className="form-group"><label>Mensagem (use {'{{name}}'} pra nome do lead)</label>
                  <textarea className="input" rows={4} value={newTemplate} onChange={e => setNewTemplate(e.target.value)} placeholder="Ola {{name}}, temos uma oferta especial..." />
                </div>
                {newTemplate && (
                  <div style={{ marginTop: 8, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 12 }}>
                    <div style={{ color: '#9B96B0', marginBottom: 4 }}>Preview:</div>
                    <div>{newTemplate.replace(/\{\{name\}\}/g, 'Joao Silva')}</div>
                  </div>
                )}
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => { setShowNew(false); setStep(1) }}>Cancelar</button>
                  <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!newName || !newTemplate}>Proximo</button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="form-group">
                  <label>Buscar leads (apenas com telefone)</label>
                  <input className="input" value={leadSearch} onChange={e => setLeadSearch(e.target.value)} placeholder="Buscar por nome, telefone..." />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
                  <span style={{ fontSize: 12, color: '#9B96B0' }}>{selectedLeads.length} selecionados</span>
                  {searchResults.length > 0 && <button className="btn btn-secondary btn-sm" onClick={selectAll}>Selecionar todos ({searchResults.length})</button>}
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {searchResults.map(l => (
                    <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: selectedLeads.some(s => s.id === l.id) ? 'rgba(255,179,0,0.08)' : 'transparent', cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={selectedLeads.some(s => s.id === l.id)} onChange={() => toggleLead(l)} />
                      <span style={{ fontWeight: 500 }}>{l.name || 'Sem nome'}</span>
                      <span style={{ color: '#9B96B0' }}>{l.phone}</span>
                    </label>
                  ))}
                  {searchResults.length === 0 && leadSearch.length > 1 && <div style={{ padding: 20, textAlign: 'center', color: '#6B6580' }}>Nenhum lead encontrado</div>}
                  {leadSearch.length <= 1 && <div style={{ padding: 20, textAlign: 'center', color: '#6B6580' }}>Digite pra buscar leads...</div>}
                </div>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setStep(1)}>Voltar</button>
                  <button className="btn btn-primary" onClick={() => setStep(3)} disabled={selectedLeads.length === 0}>Proximo ({selectedLeads.length} leads)</button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="card" style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: '#9B96B0', marginBottom: 8 }}>Resumo</div>
                  <div style={{ fontSize: 13 }}><strong>Nome:</strong> {newName}</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}><strong>Destinatarios:</strong> {selectedLeads.length} leads</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}><strong>Mensagem:</strong></div>
                  <div style={{ padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: 12, marginTop: 4 }}>{newTemplate}</div>
                </div>
                <div style={{ padding: 10, background: 'rgba(255,179,0,0.08)', borderRadius: 8, fontSize: 12, color: '#FFB300' }}>
                  O disparo sera criado como rascunho. Voce podera enviar depois na lista.
                </div>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setStep(2)}>Voltar</button>
                  <button className="btn btn-primary" onClick={handleCreate}>Criar Disparo</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
