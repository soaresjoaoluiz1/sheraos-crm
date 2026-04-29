import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { useSSE } from '../context/SSEContext'
import {
  fetchWhatsAppInstances, fetchLeads, fetchLead, fetchFunnels, fetchUsers, fetchTags,
  sendMessage, updateLead, moveLeadStage, assignLead, addLeadNote, addLeadTag, removeLeadTag,
  fetchLeadCadence, advanceLeadCadence, removeLeadCadence, fetchCadences, assignLeadCadence, createTag,
  archiveLead, createStandaloneTask, fetchLeadTasks, completeStandaloneTask, deleteStandaloneTask, completeTask, skipTask,
  type WhatsAppInstance, type Lead, type Message, type StageHistoryEntry, type LeadNote,
  type Funnel, type User as UserType, type Tag, type LeadCadence, type Cadence,
} from '../lib/api'
import EditTaskModal from '../components/EditTaskModal'
import {
  MessageCircle, Search, Send, Phone, User, Edit3, Save, X, Plus,
  StickyNote, Tag as TagIcon, GitBranch, Smartphone, ListOrdered, ChevronRight, Check, Clock, Archive, ListTodo, ChevronDown, ChevronUp, Trash2,
} from 'lucide-react'
import MessageMedia from '../components/MessageMedia'
import { applyMessageVars } from '../lib/messageVars'

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function Chat() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [selectedInstance, setSelectedInstance] = useState<number | 'all'>('all')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search)
    const leadParam = params.get('lead')
    return leadParam ? parseInt(leadParam) : null
  })
  const [lead, setLead] = useState<Lead | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [history, setHistory] = useState<StageHistoryEntry[]>([])
  const [notes, setNotes] = useState<LeadNote[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [leadCadence, setLeadCadence] = useState<LeadCadence | null>(null)
  const [cadences, setCadences] = useState<Cadence[]>([])
  const [showCadenceMenu, setShowCadenceMenu] = useState(false)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<number | ''>('')
  const [attendantFilter, setAttendantFilter] = useState<number | 'all' | 'unassigned'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [msgText, setMsgText] = useState('')
  const [noteText, setNoteText] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [infoCollapsed, setInfoCollapsed] = useState(() => localStorage.getItem('chat_info_collapsed') !== '0')
  const [leadTasks, setLeadTasks] = useState<any[]>([])
  const [editingTask, setEditingTask] = useState<any>(null)
  const [sendInstanceOverride, setSendInstanceOverride] = useState<number | null>(null)
  const [showSendInstance, setShowSendInstance] = useState(false)
  const [editData, setEditData] = useState<Record<string, any>>({ name: '', phone: '', email: '', city: '' })
  const [rightTab, setRightTab] = useState<'info' | 'notes' | 'history'>('info')
  const [showTagMenu, setShowTagMenu] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#FFB300')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskMode, setTaskMode] = useState<'date' | 'duration'>('duration')
  const [taskMinutes, setTaskMinutes] = useState('10')
  const [taskDate, setTaskDate] = useState('')
  const [taskTime, setTaskTime] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [cadenceMsgText, setCadenceMsgText] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Load instances + globals
  useEffect(() => {
    if (!accountId) return
    fetchWhatsAppInstances(accountId).then(setInstances)
    fetchFunnels(accountId).then(setFunnels)
    fetchUsers(accountId).then(setUsers)
    fetchTags(accountId).then(setTags)
    fetchCadences(accountId).then(setCadences)
  }, [accountId])

  // Load leads list (with optional instance filter)
  const loadLeadsList = useCallback(() => {
    if (!accountId) return
    const filters: any = { limit: 200 }
    if (showArchived) filters.show_archived = 'all'
    fetchLeads(accountId, filters).then(data => {
      const filtered = selectedInstance === 'all' ? data.leads : data.leads.filter(l => l.instance_id === selectedInstance)
      setLeads(filtered)
    })
  }, [accountId, selectedInstance, showArchived])
  useEffect(() => { loadLeadsList() }, [loadLeadsList])

  // Load selected lead detail
  const loadLead = useCallback(async () => {
    if (!selectedLeadId || !accountId) { setLead(null); setMessages([]); setLeadTasks([]); return }
    const data = await fetchLead(selectedLeadId, accountId)
    setLead(data.lead)
    setMessages(data.messages)
    setHistory(data.stageHistory)
    setNotes(data.notes || [])
    fetchLeadTasks(selectedLeadId, accountId).then(setLeadTasks).catch(() => setLeadTasks([]))
    setEditData({ name: data.lead.name || '', phone: data.lead.phone || '', email: data.lead.email || '', city: data.lead.city || '', empresa: data.lead.empresa || '', cpf_cnpj: data.lead.cpf_cnpj || '', instagram: data.lead.instagram || '', trabalha_anuncio: data.lead.trabalha_anuncio || 0, investimento_anuncios: data.lead.investimento_anuncios || '' })
    try {
      const lc = await fetchLeadCadence(selectedLeadId, accountId)
      setLeadCadence(lc)
      if (lc?.attempt_message) {
        setCadenceMsgText(applyMessageVars(lc.attempt_message, {
          leadName: data.lead.name,
          leadEmpresa: data.lead.empresa,
          leadCity: data.lead.city,
          attendantName: user?.name,
        }))
      } else setCadenceMsgText('')
    } catch { setLeadCadence(null); setCadenceMsgText('') }
  }, [selectedLeadId, accountId])
  useEffect(() => { loadLead() }, [loadLead])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // SSE: new messages / leads
  useSSE('lead:message', useCallback((data: any) => {
    if (data.leadId === selectedLeadId) loadLead()
    loadLeadsList()
  }, [selectedLeadId, loadLead, loadLeadsList]))
  useSSE('lead:created', useCallback(() => loadLeadsList(), [loadLeadsList]))
  useSSE('lead:updated', useCallback((data: any) => {
    if (data.id === selectedLeadId) loadLead()
    loadLeadsList()
  }, [selectedLeadId, loadLead, loadLeadsList]))
  useSSE('lead:archived', useCallback((data: { id: number }) => {
    setLeads(prev => prev.filter(l => l.id !== data.id))
    if (selectedLeadId === data.id) setSelectedLeadId(null)
  }, [selectedLeadId]))
  useSSE('lead:unarchived', useCallback(() => loadLeadsList(), [loadLeadsList]))

  const handleArchiveLead = async (leadId: number, e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.()
    if (!confirm('Arquivar este lead? Ele some do chat e do pipeline, mas o historico fica salvo.')) return
    setLeads(prev => prev.filter(l => l.id !== leadId))
    if (selectedLeadId === leadId) setSelectedLeadId(null)
    try { await archiveLead(leadId) } catch { loadLeadsList() }
  }

  const filteredLeads = useMemo(() => {
    let result = leads
    if (tagFilter) result = result.filter(l => l.tags?.some(t => t.id === tagFilter))
    if (attendantFilter === 'unassigned') result = result.filter(l => !l.attendant_id)
    else if (typeof attendantFilter === 'number') result = result.filter(l => l.attendant_id === attendantFilter)
    if (search.trim()) {
      const s = search.toLowerCase()
      result = result.filter(l => (l.name || '').toLowerCase().includes(s) || (l.phone || '').includes(s))
    }
    return result
  }, [leads, search, tagFilter, attendantFilter])

  const handleSendMsg = async () => {
    if (!msgText.trim() || !lead || !accountId) return
    setSending(true)
    try {
      // Filtro de instancia ativo no header funciona como override implicito
      const filterOverride = (typeof selectedInstance === 'number') ? selectedInstance : undefined
      const override = sendInstanceOverride || filterOverride
      const result = await sendMessage(lead.id, accountId, msgText, override)
      setMessages(prev => [...prev, result.message])
      setMsgText('')
      if (!result.delivered) alert('Mensagem salva mas NAO enviada no WhatsApp. Verifique a conexao.')
      setSendInstanceOverride(null)
      loadLead()
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
    setSending(false)
  }

  // Resolve which instance the next send will use (mirror do backend)
  const resolvedSendInstance = (() => {
    if (!lead || !instances.length) return null
    // 1. Override manual
    if (sendInstanceOverride) return instances.find(i => i.id === sendInstanceOverride)
    // 2. Filtro de instancia ativo
    if (typeof selectedInstance === 'number') return instances.find(i => i.id === selectedInstance)
    // 3. User e atendente principal → continuidade
    if (user?.id && lead.attendant_id === user.id) {
      return instances.find(i => i.id === lead.last_instance_id) || instances.find(i => i.id === lead.instance_id) || null
    }
    // 4. Primary do user (gerente/admin "por fora")
    if (user?.primary_instance_id) return instances.find(i => i.id === user.primary_instance_id)
    // 5. Fallbacks
    if (lead.last_instance_id) return instances.find(i => i.id === lead.last_instance_id)
    if (lead.instance_id) return instances.find(i => i.id === lead.instance_id)
    return instances.find(i => i.status === 'connected') || instances[0]
  })()

  const handleSaveEdit = async () => {
    if (!lead) return
    await updateLead(lead.id, editData)
    setEditing(false); loadLead()
  }

  const handleAddNote = async () => {
    if (!noteText.trim() || !lead) return
    const note = await addLeadNote(lead.id, noteText)
    setNotes(prev => [note, ...prev]); setNoteText('')
  }

  const handleStageChange = async (stageId: number) => { if (lead) { await moveLeadStage(lead.id, stageId); loadLead(); loadLeadsList() } }
  const handleAssign = async (attId: number | null) => { if (lead) { await assignLead(lead.id, attId); loadLead() } }
  const handleAddTag = async (tagId: number) => { if (lead) { await addLeadTag(lead.id, tagId); loadLead(); setShowTagMenu(false) } }
  const handleRemoveTag = async (tagId: number) => { if (lead) { await removeLeadTag(lead.id, tagId); loadLead() } }
  const handleAdvanceCadence = async () => { if (leadCadence && accountId) { await advanceLeadCadence(leadCadence.id, accountId); loadLead() } }
  const handleSendCadenceMessage = async () => {
    if (!cadenceMsgText.trim() || !lead || !accountId || !leadCadence) return
    setSending(true)
    try {
      const result = await sendMessage(lead.id, accountId, cadenceMsgText)
      setMessages(prev => [...prev, result.message])
      if (result.delivered) {
        await advanceLeadCadence(leadCadence.id, accountId)
        loadLead()
      } else {
        alert('Mensagem NAO foi entregue no WhatsApp. Cadencia mantida na etapa atual. Verifique a conexao e tente novamente.')
      }
    } catch (err: any) {
      alert('Erro ao enviar: ' + (err?.message || 'desconhecido'))
    }
    setSending(false)
  }
  const handleAssignCadence = async (cadenceId: number) => { if (lead && accountId) { await assignLeadCadence(cadenceId, accountId, lead.id); setShowCadenceMenu(false); loadLead() } }

  const handleCreateTag = async () => {
    if (!accountId || !newTagName.trim() || !lead) return
    const tag = await createTag(accountId, newTagName.trim(), newTagColor)
    setTags(prev => [...prev, tag])
    await addLeadTag(lead.id, tag.id)
    setNewTagName(''); loadLead()
  }

  const allStages = funnels.flatMap(f => f.stages || [])
  const currentStage = lead ? allStages.find(s => s.id === lead.stage_id) : null
  const attendants = users.filter(u => u.role === 'atendente' && u.is_active)
  const availableTags = lead ? tags.filter(t => !lead.tags?.some(lt => lt.id === t.id)) : []

  return (
    <div className="chat-page">
      {/* Top bar: instance selector */}
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}><MessageCircle size={20} style={{ verticalAlign: -4, marginRight: 6 }} />Chat</h1>
          <select className="select" style={{ width: 200 }} value={selectedInstance} onChange={e => setSelectedInstance(e.target.value === 'all' ? 'all' : +e.target.value)}>
            <option value="all">Todos os numeros</option>
            {instances.map(i => (
              <option key={i.id} value={i.id}>{i.instance_name}{i.status === 'connected' ? ' ✓' : ' ✗'}</option>
            ))}
          </select>
          <select className="select" style={{ width: 160 }} value={tagFilter} onChange={e => setTagFilter(e.target.value ? +e.target.value : '')}>
            <option value="">Todas as tags</option>
            {tags.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {user?.role !== 'atendente' && (
            <select className="select" style={{ width: 180 }} value={attendantFilter} onChange={e => setAttendantFilter(e.target.value === 'all' ? 'all' : e.target.value === 'unassigned' ? 'unassigned' : +e.target.value)}>
              <option value="all">Todos atendentes</option>
              <option value="unassigned">Sem atendente</option>
              {attendants.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <button onClick={() => setShowArchived(s => !s)} className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 11 }} title="Mostrar leads arquivados">
            <Archive size={12} /> {showArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
          </button>
        </div>
      </div>

      <div className="chat-layout">
        {/* Column 1: Contacts */}
        <div className="chat-contacts">
          <div className="chat-search">
            <Search size={14} style={{ color: '#6B6580' }} />
            <input className="input" placeholder="Buscar contato..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: 'none', background: 'transparent', flex: 1 }} />
          </div>
          <div className="chat-contacts-list">
            {filteredLeads.map(l => {
              const active = l.id === selectedLeadId
              const stage = allStages.find(s => s.id === l.stage_id)
              return (
                <div key={l.id} className={`chat-contact-item ${active ? 'active' : ''}`} onClick={() => setSelectedLeadId(l.id)} style={{ position: 'relative' }}>
                  <div className="chat-contact-avatar" style={{ background: stage ? `${stage.color}25` : '#FFB30025', overflow: 'hidden' }}>
                    {l.profile_pic_url ? (
                      <img src={l.profile_pic_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <User size={16} style={{ color: stage?.color || '#FFB300' }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name || l.phone || 'Sem nome'}</span>
                      <span style={{ fontSize: 10, color: '#6B6580' }}>{timeAgo(l.updated_at)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: '#9B96B0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.last_message || (l.phone ? `📞 ${l.phone}` : 'Sem mensagens')}
                      </span>
                      {stage && <span style={{ fontSize: 9, color: stage.color, background: `${stage.color}20`, padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap' }}>{stage.name}</span>}
                    </div>
                  </div>
                  <button
                    className="chat-contact-archive"
                    title="Arquivar"
                    onClick={e => handleArchiveLead(l.id, e)}
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.35)', border: 'none', color: '#C8C4D4', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'none' }}>
                    <Archive size={11} />
                  </button>
                </div>
              )
            })}
            {filteredLeads.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#6B6580', fontSize: 12 }}>Nenhum contato</div>}
          </div>
        </div>

        {/* Column 2: Conversation */}
        <div className="chat-conversation">
          {!lead ? (
            <div className="chat-empty">
              <MessageCircle size={48} style={{ color: '#6B6580', marginBottom: 12 }} />
              <h3 style={{ fontSize: 16, color: '#9B96B0' }}>Selecione um contato</h3>
            </div>
          ) : (
            <>
              <div className="chat-conversation-header">
                <div className="chat-contact-avatar" style={{ background: `${currentStage?.color || '#FFB300'}25`, overflow: 'hidden' }}>
                  {lead.profile_pic_url ? (
                    <img src={lead.profile_pic_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <User size={16} style={{ color: currentStage?.color || '#FFB300' }} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{lead.name || 'Sem nome'}</div>
                  {lead.phone && <div style={{ fontSize: 11, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={10} />{lead.phone}</div>}
                </div>
                {lead.instance_name && <span style={{ fontSize: 10, color: '#34C759', display: 'flex', alignItems: 'center', gap: 4 }}><Smartphone size={10} />{lead.instance_name}</span>}
                <button className="btn btn-secondary btn-sm" title="Arquivar" onClick={() => handleArchiveLead(lead.id)} style={{ padding: '4px 8px' }}>
                  <Archive size={12} />
                </button>
              </div>
              <div className="chat-messages">
                {messages.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 40, fontSize: 13 }}>Nenhuma mensagem</div>}
                {messages.map(m => (
                  <div key={m.id} className={`chat-msg-row ${m.direction}`}>
                    <div className={`chat-bubble ${m.direction}`} style={m.direction === 'outbound' && !m.wa_msg_id ? { border: '1px solid #FF6B6B', opacity: 0.8 } : undefined}>
                      {m.media_type && m.media_type !== 'text'
                        ? <MessageMedia message={m} leadId={lead.id} />
                        : (m.content || <em style={{ opacity: 0.5 }}>Sem conteudo</em>)}
                    </div>
                    <div className="chat-bubble-time">
                      {m.sender_name && <span>{m.sender_name} · </span>}
                      <span>{new Date(m.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                      {(m as any).instance_id && (() => {
                        const inst = instances.find(i => i.id === (m as any).instance_id)
                        return inst ? <span style={{ marginLeft: 4, padding: '0 5px', borderRadius: 3, background: 'rgba(255,179,0,0.12)', color: '#FFB300', fontSize: 9, fontWeight: 600 }}>via {inst.instance_name}</span> : null
                      })()}
                      {m.direction === 'outbound' && (
                        m.wa_msg_id
                          ? <span style={{ color: '#53BDEB', marginLeft: 2 }}>✓✓</span>
                          : <span style={{ color: '#FF6B6B', marginLeft: 2 }}>✗</span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              {resolvedSendInstance && (
                <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9B96B0', borderTop: '1px solid rgba(255,255,255,0.04)', position: 'relative' }}>
                  <Smartphone size={11} style={{ color: '#FFB300' }} />
                  <span>Respondendo por:</span>
                  <button onClick={() => setShowSendInstance(s => !s)} style={{ background: 'none', border: 'none', color: '#FFB300', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 11 }}>
                    {resolvedSendInstance.instance_name} ▾
                  </button>
                  {showSendInstance && (
                    <div style={{ position: 'absolute', bottom: '100%', left: 12, marginBottom: 4, background: '#1a1625', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: 4, minWidth: 220, zIndex: 10, boxShadow: '0 4px 14px rgba(0,0,0,0.4)' }}>
                      {instances.filter(i => i.status === 'connected').map(i => (
                        <button key={i.id} onClick={() => { setSendInstanceOverride(i.id); setShowSendInstance(false) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: i.id === resolvedSendInstance.id ? 'rgba(255,179,0,0.12)' : 'transparent', color: i.id === resolvedSendInstance.id ? '#FFB300' : '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
                          {i.instance_name}{i.id === resolvedSendInstance.id ? ' ✓' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="chat-input">
                <input className="input" placeholder="Mensagem..." value={msgText} onChange={e => setMsgText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSendMsg() } }} disabled={sending} />
                <button className="btn btn-primary btn-icon" onClick={handleSendMsg} disabled={sending || !msgText.trim()}><Send size={16} /></button>
              </div>
            </>
          )}
        </div>

        {/* Column 3: Lead details / actions */}
        {lead && (
          <div className="chat-details">
            <div style={{ display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              {(['info', 'notes', 'history'] as const).map(tab => (
                <button key={tab} className={`btn btn-sm ${rightTab === tab ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRightTab(tab)} style={{ flex: 1, fontSize: 11 }}>
                  {tab === 'info' && <><User size={11} /> Info</>}
                  {tab === 'notes' && <><StickyNote size={11} /> Notas ({notes.length})</>}
                  {tab === 'history' && <><GitBranch size={11} /> Historico</>}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {rightTab === 'info' && (
                <>
                  {/* Stage + Attendant */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', marginBottom: 4 }}>Etapa</div>
                    <select className="select" style={{ width: '100%' }} value={lead.stage_id} onChange={e => handleStageChange(+e.target.value)}>
                      {allStages.filter(s => s.funnel_id === lead.funnel_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>

                  {user?.role !== 'atendente' && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', marginBottom: 4 }}>Atendente</div>
                      <select className="select" style={{ width: '100%' }} value={lead.attendant_id || ''} onChange={e => handleAssign(e.target.value ? +e.target.value : null)}>
                        <option value="">Sem atendente</option>
                        {attendants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Info */}
                  <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: infoCollapsed ? 0 : 8 }}>
                      <div onClick={() => { if (!editing) { setInfoCollapsed(p => { const v = !p; localStorage.setItem('chat_info_collapsed', v ? '1' : '0'); return v }) } }} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: editing ? 'default' : 'pointer', flex: 1 }}>
                        {!editing && (infoCollapsed ? <ChevronDown size={12} style={{ color: '#9B96B0' }} /> : <ChevronUp size={12} style={{ color: '#9B96B0' }} />)}
                        <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase' }}>Informacoes</div>
                      </div>
                      {!editing ? (
                        <button className="btn btn-secondary btn-sm" onClick={() => { setInfoCollapsed(false); setEditing(true) }} style={{ padding: '2px 6px', fontSize: 10 }}><Edit3 size={10} /></button>
                      ) : (
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} style={{ padding: '2px 6px', fontSize: 10 }}><Save size={10} /></button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} style={{ padding: '2px 6px', fontSize: 10 }}><X size={10} /></button>
                        </div>
                      )}
                    </div>
                    {!infoCollapsed && (editing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input className="input" placeholder="Nome" value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} style={{ fontSize: 12 }} />
                        <input className="input" placeholder="Telefone" value={editData.phone} onChange={e => setEditData(p => ({ ...p, phone: e.target.value }))} style={{ fontSize: 12 }} />
                        <input className="input" placeholder="Email" value={editData.email} onChange={e => setEditData(p => ({ ...p, email: e.target.value }))} style={{ fontSize: 12 }} />
                        <input className="input" placeholder="Cidade" value={editData.city} onChange={e => setEditData(p => ({ ...p, city: e.target.value }))} style={{ fontSize: 12 }} />
                        <input className="input" placeholder="Nome da Empresa" value={editData.empresa} onChange={e => setEditData(p => ({ ...p, empresa: e.target.value }))} style={{ fontSize: 12 }} />
                        <input className="input" placeholder="CPF/CNPJ" value={editData.cpf_cnpj} onChange={e => setEditData(p => ({ ...p, cpf_cnpj: e.target.value }))} style={{ fontSize: 12 }} />
                        <input className="input" placeholder="Instagram (@perfil)" value={editData.instagram} onChange={e => setEditData(p => ({ ...p, instagram: e.target.value }))} style={{ fontSize: 12 }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 11, color: '#9B96B0' }}>Anuncio:</span>
                          <select className="select" value={editData.trabalha_anuncio || 0} onChange={e => setEditData(p => ({ ...p, trabalha_anuncio: parseInt(e.target.value) }))} style={{ fontSize: 11, width: 70, padding: '3px 6px' }}>
                            <option value={0}>Nao</option>
                            <option value={1}>Sim</option>
                          </select>
                        </div>
                        <input className="input" placeholder="Investimento Anuncios (R$)" type="number" step="0.01" value={editData.investimento_anuncios} onChange={e => setEditData(p => ({ ...p, investimento_anuncios: e.target.value }))} style={{ fontSize: 12 }} />
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div><span style={{ color: '#6B6580' }}>Nome:</span> {lead.name || '-'}</div>
                        <div><span style={{ color: '#6B6580' }}>Tel:</span> {lead.phone || '-'} {lead.phone && lead.phone.replace(/\D/g,'').length !== 13 && <span style={{ color: '#FF6B6B', fontSize: 9 }}>⚠ numero incompleto</span>}</div>
                        <div><span style={{ color: '#6B6580' }}>Email:</span> {lead.email || '-'}</div>
                        <div><span style={{ color: '#6B6580' }}>Cidade:</span> {lead.city || '-'}</div>
                        {lead.empresa && <div><span style={{ color: '#6B6580' }}>Empresa:</span> {lead.empresa}</div>}
                        {lead.cpf_cnpj && <div><span style={{ color: '#6B6580' }}>CPF/CNPJ:</span> {lead.cpf_cnpj}</div>}
                        {lead.instagram && <div><span style={{ color: '#6B6580' }}>Instagram:</span> {lead.instagram}</div>}
                        <div><span style={{ color: '#6B6580' }}>Anuncio:</span> <span style={{ color: lead.trabalha_anuncio ? '#34C759' : '#9B96B0' }}>{lead.trabalha_anuncio ? 'Sim' : 'Nao'}</span></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: '#6B6580' }}>Disparos:</span>
                          {!lead.opted_out_at || (lead.opted_in_at && lead.opted_in_at > lead.opted_out_at)
                            ? <span style={{ color: '#34C759', fontSize: 11 }}>Sim</span>
                            : <span style={{ color: '#FF6B6B', fontSize: 11 }}>Bloqueado</span>}
                        </div>
                        {lead.investimento_anuncios && <div><span style={{ color: '#6B6580' }}>Investimento:</span> R$ {Number(lead.investimento_anuncios).toLocaleString('pt-BR')}</div>}
                        <div><span style={{ color: '#6B6580' }}>Fonte:</span> {lead.source || '-'}</div>
                        <div><span style={{ color: '#6B6580' }}>Criado:</span> {new Date(lead.created_at).toLocaleDateString('pt-BR')}</div>
                      </div>
                    ))}
                  </div>

                  {/* Tags */}
                  <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }}><TagIcon size={10} /> Tags</div>
                      <div style={{ position: 'relative' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowTagMenu(!showTagMenu)} style={{ padding: '2px 6px' }}><Plus size={10} /></button>
                        {showTagMenu && (
                          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: 6, zIndex: 50, minWidth: 200 }}>
                            {availableTags.length > 0 && (
                              <>
                                {availableTags.map(t => (
                                  <button key={t.id} onClick={() => handleAddTag(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: 'none', background: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color }} />{t.name}
                                  </button>
                                ))}
                                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 0' }} />
                              </>
                            )}
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: 2 }}>
                              <input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)} style={{ width: 22, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
                              <input className="input" value={newTagName} onChange={e => setNewTagName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateTag()} placeholder="Nova tag..." style={{ flex: 1, fontSize: 11, padding: '4px 6px' }} />
                              <button className="btn btn-primary btn-sm" onClick={handleCreateTag} disabled={!newTagName.trim()} style={{ padding: '4px 6px' }}><Plus size={10} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {lead.tags?.map(t => (
                        <span key={t.id} className="tag-pill" style={{ background: `${t.color}20`, color: t.color, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10 }} onClick={() => handleRemoveTag(t.id)}>
                          {t.name} <X size={7} />
                        </span>
                      ))}
                      {(!lead.tags || lead.tags.length === 0) && <span style={{ fontSize: 10, color: '#6B6580' }}>Sem tags</span>}
                    </div>
                  </div>

                  {/* Cadence */}
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }}><ListOrdered size={10} /> Cadencia</div>
                      <div style={{ position: 'relative' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowCadenceMenu(!showCadenceMenu)} style={{ padding: '2px 8px', fontSize: 10 }}>{leadCadence ? 'Trocar' : 'Atribuir'}</button>
                        {showCadenceMenu && (
                          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: 4, zIndex: 50, minWidth: 180, maxHeight: 220, overflowY: 'auto' }}>
                            {cadences.length === 0 && <div style={{ padding: 8, fontSize: 11, color: '#9B96B0' }}>Nenhuma cadencia. Crie em /cadences</div>}
                            {cadences.map(c => (
                              <button key={c.id} onClick={() => handleAssignCadence(c.id)} style={{ display: 'block', padding: '6px 10px', border: 'none', background: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', borderRadius: 4, width: '100%', textAlign: 'left' }}>
                                {c.name} <span style={{ color: '#6B6580' }}>({c.attempts.length} etapas)</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {leadCadence ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{leadCadence.cadence_name}</div>
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button className="btn btn-secondary btn-sm" style={{ padding: '2px 6px', fontSize: 9 }} onClick={() => { const base = import.meta.env.BASE_URL.replace(/\/$/, ''); window.open(`${base}/cadences`, '_blank') }}>Editar</button>
                            <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px', fontSize: 9 }} onClick={async () => {
                              if (!accountId || !confirm('Remover cadencia deste lead?')) return
                              await removeLeadCadence(leadCadence.id, accountId)
                              loadLead()
                            }}>Remover</button>
                          </div>
                        </div>
                        {leadCadence.status === 'completed' ? (
                          <div style={{ fontSize: 11, color: '#34C759', display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}><Check size={10} /> Concluida</div>
                        ) : (
                          <>
                            <div style={{ fontSize: 11, color: '#FFB300', marginTop: 2 }}>Etapa {(leadCadence.attempt_position ?? 0) + 1}/{leadCadence.total_attempts}: {leadCadence.action_type?.toUpperCase()}</div>
                            {leadCadence.attempt_description && <div style={{ fontSize: 11, color: '#fff', marginTop: 2, fontWeight: 500 }}>{leadCadence.attempt_description}</div>}
                            {leadCadence.attempt_instructions && <div style={{ fontSize: 10, color: '#9B96B0', marginTop: 2, fontStyle: 'italic' }}>{leadCadence.attempt_instructions}</div>}
                            {leadCadence.attempt_message ? (
                              <>
                                <textarea className="input" value={cadenceMsgText} onChange={e => setCadenceMsgText(e.target.value)} rows={3} style={{ marginTop: 8, fontSize: 11, resize: 'vertical', background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.2)' }} />
                                <button className="btn btn-primary btn-sm" style={{ marginTop: 8, width: '100%', fontSize: 11 }} onClick={handleSendCadenceMessage} disabled={sending || !cadenceMsgText.trim()}><Send size={10} /> Enviar e avancar</button>
                                <button className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%', fontSize: 10 }} onClick={handleAdvanceCadence}><ChevronRight size={10} /> So avancar (sem enviar)</button>
                              </>
                            ) : (
                              <button className="btn btn-primary btn-sm" style={{ marginTop: 8, width: '100%', fontSize: 11 }} onClick={handleAdvanceCadence}><ChevronRight size={10} /> Avancar</button>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: '#6B6580' }}>Nenhuma cadencia atribuida</div>
                    )}
                  </div>

                  {/* Lead pending tasks */}
                  {leadTasks.length > 0 && (
                    <div className="card" style={{ padding: 12, marginTop: 12 }}>
                      <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
                        <ListTodo size={10} /> Tarefas Pendentes ({leadTasks.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {leadTasks.map((t: any) => {
                          const due = new Date(t.due_datetime)
                          const overdue = due.getTime() < Date.now()
                          const isCadence = t.type === 'cadence'
                          const accent = isCadence ? '#FFB300' : '#9B59B6'
                          const key = isCadence ? `c-${t.lead_cadence_id}` : `s-${t.id}`
                          const title = isCadence
                            ? `${t.cadence_name} · Etapa ${(t.attempt_position || 0) + 1}/${t.total_attempts}`
                            : t.title
                          const desc = isCadence ? (t.attempt_description || t.auto_message) : t.description
                          return (
                            <div key={key} style={{ padding: '8px 10px', background: overdue ? 'rgba(255,107,107,0.06)' : `${accent}10`, border: `1px solid ${overdue ? 'rgba(255,107,107,0.2)' : `${accent}30`}`, borderLeft: `3px solid ${accent}`, borderRadius: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${accent}25`, color: accent, fontWeight: 700, textTransform: 'uppercase' }}>
                                  {isCadence ? 'Cadencia' : 'Avulsa'}
                                </span>
                                <div style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{title}</div>
                              </div>
                              {desc && <div style={{ fontSize: 11, color: '#9B96B0', marginBottom: 4 }}>{desc.substring(0, 100)}{desc.length > 100 ? '...' : ''}</div>}
                              <div style={{ fontSize: 10, color: overdue ? '#FF6B6B' : '#9B96B0', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 6 }}>
                                <Clock size={9} /> {due.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {!isCadence && t.assigned_name && <span> · {t.assigned_name}</span>}
                                {isCadence && t.action_type && <span> · {t.action_type}</span>}
                              </div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-primary btn-sm" onClick={async () => {
                                  if (!accountId || !lead) return
                                  try {
                                    if (isCadence) await completeTask(t.lead_cadence_id, accountId)
                                    else await completeStandaloneTask(t.id, accountId)
                                    fetchLeadTasks(lead.id, accountId).then(setLeadTasks)
                                  } catch (e: any) { alert('Erro: ' + e.message) }
                                }} style={{ fontSize: 10, padding: '3px 8px', background: '#34C759', borderColor: '#34C759', flex: 1 }}>
                                  <Check size={10} /> Concluir
                                </button>
                                {isCadence ? (
                                  <button className="btn btn-secondary btn-sm" onClick={async () => {
                                    if (!accountId || !lead) return
                                    if (!confirm('Pular esta etapa da cadencia?')) return
                                    try { await skipTask(t.lead_cadence_id, accountId); fetchLeadTasks(lead.id, accountId).then(setLeadTasks) } catch (e: any) { alert('Erro: ' + e.message) }
                                  }} style={{ fontSize: 10, padding: '3px 8px' }} title="Pular etapa">
                                    <ChevronRight size={10} />
                                  </button>
                                ) : (
                                  <>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingTask(t)} style={{ fontSize: 10, padding: '3px 8px' }} title="Editar">
                                      <Edit3 size={10} />
                                    </button>
                                    <button className="btn btn-secondary btn-sm" onClick={async () => { if (!accountId || !lead) return; if (!confirm('Excluir tarefa?')) return; await deleteStandaloneTask(t.id, accountId); fetchLeadTasks(lead.id, accountId).then(setLeadTasks) }} style={{ fontSize: 10, padding: '3px 8px', color: '#FF6B6B' }} title="Excluir">
                                      <Trash2 size={10} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Standalone Task */}
                  <div className="card" style={{ padding: 12, marginTop: 12 }}>
                    <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 6 }}><ListTodo size={10} /> Nova Tarefa</div>
                    <input className="input" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Ex: Ligar para o paciente" style={{ fontSize: 11, marginBottom: 6 }} />
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      <button className={`btn btn-sm ${taskMode === 'duration' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTaskMode('duration')} style={{ fontSize: 10, padding: '3px 8px' }}>Tempo</button>
                      <button className={`btn btn-sm ${taskMode === 'date' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTaskMode('date')} style={{ fontSize: 10, padding: '3px 8px' }}>Data</button>
                    </div>
                    {taskMode === 'duration' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                        <input type="number" className="input" value={taskMinutes} onChange={e => setTaskMinutes(e.target.value)} style={{ width: 60, fontSize: 11, textAlign: 'center' }} min={1} />
                        <span style={{ fontSize: 11, color: '#9B96B0' }}>minutos</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        <input type="date" className="input" value={taskDate} onChange={e => setTaskDate(e.target.value)} style={{ fontSize: 11, flex: 1 }} />
                        <input type="time" className="input" value={taskTime} onChange={e => setTaskTime(e.target.value)} style={{ fontSize: 11, width: 90 }} />
                      </div>
                    )}
                    <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: 11 }} disabled={!taskTitle.trim() || creatingTask} onClick={async () => {
                      if (!accountId || !lead) return
                      setCreatingTask(true)
                      try {
                        await createStandaloneTask(accountId, {
                          lead_id: lead.id,
                          title: taskTitle,
                          due_mode: taskMode,
                          due_minutes: parseInt(taskMinutes) || 10,
                          due_date: taskDate,
                          due_time: taskTime,
                        })
                        setTaskTitle(''); setTaskMinutes('10'); setTaskDate(''); setTaskTime('')
                        if (lead) fetchLeadTasks(lead.id, accountId).then(setLeadTasks)
                        alert('Tarefa criada!')
                      } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
                      setCreatingTask(false)
                    }}>
                      <ListTodo size={10} /> {creatingTask ? 'Criando...' : 'Criar Tarefa'}
                    </button>
                  </div>

                  {/* Archive */}
                  <div className="card" style={{ padding: 12, marginTop: 12 }}>
                    <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 6 }}><Archive size={10} /> Arquivar</div>
                    <div style={{ fontSize: 11, color: '#6B6580', marginBottom: 8 }}>Some do pipeline e do chat. Historico preservado. Ideal para contatos pessoais.</div>
                    <button className="btn btn-secondary btn-sm" style={{ width: '100%', fontSize: 11 }} onClick={() => handleArchiveLead(lead.id)}>
                      <Archive size={12} /> Arquivar lead
                    </button>
                  </div>
                </>
              )}

              {rightTab === 'notes' && (
                <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <input className="input" placeholder="Nota interna..." value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddNote()} style={{ fontSize: 12 }} />
                    <button className="btn btn-primary btn-icon" onClick={handleAddNote} disabled={!noteText.trim()}><Plus size={14} /></button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {notes.map(n => (
                      <div key={n.id} style={{ padding: '8px 10px', background: 'rgba(255,179,0,0.05)', borderRadius: 6, border: '1px solid rgba(255,179,0,0.1)' }}>
                        <div style={{ fontSize: 12 }}>{n.content}</div>
                        <div style={{ fontSize: 9, color: '#6B6580', marginTop: 2 }}>{n.user_name} · {new Date(n.created_at).toLocaleString('pt-BR')}</div>
                      </div>
                    ))}
                    {notes.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 20, fontSize: 11 }}>Sem notas</div>}
                  </div>
                </>
              )}

              {rightTab === 'history' && (
                <>
                  {history.map((h, i) => (
                    <div key={h.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: i < history.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <Clock size={10} style={{ color: '#FFB300', marginTop: 3, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 11 }}>{h.from_stage_name ? `${h.from_stage_name} → ${h.to_stage_name}` : `Entrada: ${h.to_stage_name}`}</div>
                        <div style={{ fontSize: 9, color: '#6B6580' }}>{h.trigger_type}{h.user_name ? ` · ${h.user_name}` : ''}</div>
                        <div style={{ fontSize: 9, color: '#6B6580' }}>{new Date(h.created_at).toLocaleString('pt-BR')}</div>
                      </div>
                    </div>
                  ))}
                  {history.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 20, fontSize: 11 }}>Sem historico</div>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {editingTask && lead && accountId && (
        <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onSaved={() => { fetchLeadTasks(lead.id, accountId).then(setLeadTasks); setEditingTask(null) }} />
      )}
    </div>
  )
}
