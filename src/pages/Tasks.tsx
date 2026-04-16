import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import { useSSE } from '../context/SSEContext'
import { fetchMyTasks, completeTask, skipTask, sendMessage, type Task, type TaskGroups, type NextStep } from '../lib/api'
import {
  ListTodo, Phone, MessageCircle, Mail, Video, MapPin, Check, SkipForward,
  ExternalLink, Clock, AlertCircle, User, Calendar, CheckCircle, Send,
} from 'lucide-react'

const ACTION_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  mensagem: MessageCircle, whatsapp: MessageCircle, ligacao: Phone,
  email: Mail, reuniao: Video, visita: MapPin,
}
const ACTION_LABELS: Record<string, string> = {
  mensagem: 'Mensagem', whatsapp: 'WhatsApp', ligacao: 'Ligacao',
  email: 'Email', reuniao: 'Reuniao', visita: 'Visita',
}

const BUCKETS = [
  { key: 'overdue' as const, label: 'Atrasadas', color: '#FF6B6B', icon: AlertCircle },
  { key: 'today' as const, label: 'Hoje', color: '#FBBC04', icon: Clock },
  { key: 'tomorrow' as const, label: 'Amanha', color: '#5DADE2', icon: Calendar },
  { key: 'week' as const, label: 'Esta semana', color: '#9B59B6', icon: Calendar },
  { key: 'later' as const, label: 'Mais tarde', color: '#6B6580', icon: Calendar },
]

export default function Tasks() {
  const navigate = useNavigate()
  const { accountId } = useAccount()
  const [tasks, setTasks] = useState<TaskGroups>({ overdue: [], today: [], tomorrow: [], week: [], later: [] })
  const [loading, setLoading] = useState(true)
  const [activeBucket, setActiveBucket] = useState<keyof TaskGroups>('today')
  const [actioning, setActioning] = useState<number | null>(null)
  const [confirmModal, setConfirmModal] = useState<{ leadName: string; nextStep: NextStep | null } | null>(null)

  const load = useCallback(() => {
    if (!accountId) return
    setLoading(true)
    fetchMyTasks(accountId).then(setTasks).finally(() => setLoading(false))
  }, [accountId])

  useEffect(() => { load() }, [load])
  useSSE('task:updated', useCallback(() => load(), [load]))
  useSSE('lead:updated', useCallback(() => load(), [load]))

  const handleComplete = async (lcId: number) => {
    if (!accountId) return
    setActioning(lcId)
    try { await completeTask(lcId, accountId); load() } catch (e: any) { alert('Erro: ' + e.message) }
    setActioning(null)
  }

  const handleSkip = async (lcId: number) => {
    if (!accountId || !confirm('Pular esta tarefa sem executar?')) return
    setActioning(lcId)
    try { await skipTask(lcId, accountId); load() } catch (e: any) { alert('Erro: ' + e.message) }
    setActioning(null)
  }

  const handleSendAndComplete = async (t: Task) => {
    if (!accountId || !t.auto_message) return
    setActioning(t.lead_cadence_id)
    try {
      const text = t.auto_message.replace(/\{\{name\}\}/g, t.lead_name || 'Cliente')
      await sendMessage(t.lead_id, accountId, text)
      const result = await completeTask(t.lead_cadence_id, accountId)
      setConfirmModal({ leadName: t.lead_name || t.lead_phone || 'Lead', nextStep: result.nextStep })
      load()
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
    setActioning(null)
  }

  const formatDueTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const renderTask = (t: Task) => {
    const Icon = ACTION_ICONS[t.action_type] || MessageCircle
    return (
      <div key={t.lead_cadence_id} className="card" style={{ padding: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {/* Avatar */}
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: t.stage_color ? `${t.stage_color}25` : '#FFB30025', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            {t.profile_pic_url ? (
              <img src={t.profile_pic_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <User size={18} style={{ color: t.stage_color || '#FFB300' }} />
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t.lead_name || t.lead_phone || 'Sem nome'}</span>
              <span style={{ fontSize: 11, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Clock size={11} /> {formatDueTime(t.due_datetime)}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#FFB30015', borderRadius: 6, fontSize: 11, color: '#FFB300', fontWeight: 600 }}>
                <Icon size={11} /> {ACTION_LABELS[t.action_type] || t.action_type}
              </span>
              <span style={{ fontSize: 10, color: '#9B96B0' }}>
                Etapa {t.attempt_position + 1}/{t.total_attempts} · {t.cadence_name}
              </span>
              {t.stage_name && <span style={{ fontSize: 10, color: t.stage_color || '#9B96B0', background: `${t.stage_color || '#9B96B0'}15`, padding: '2px 6px', borderRadius: 6 }}>{t.stage_name}</span>}
            </div>

            {t.attempt_description && <div style={{ fontSize: 12, color: '#C8C4D4', marginBottom: 4 }}>{t.attempt_description}</div>}
            {t.attempt_instructions && <div style={{ fontSize: 11, color: '#9B96B0', marginBottom: 4, fontStyle: 'italic' }}>{t.attempt_instructions}</div>}
            {t.auto_message && <div style={{ fontSize: 11, color: '#34C759', background: 'rgba(52,199,89,0.08)', padding: '6px 8px', borderRadius: 6, marginTop: 4 }}>📤 Msg automatica: "{t.auto_message.substring(0, 60)}{t.auto_message.length > 60 ? '...' : ''}"</div>}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {t.auto_message && (t.action_type === 'mensagem' || t.action_type === 'whatsapp') && (
                <button className="btn btn-primary btn-sm" onClick={() => handleSendAndComplete(t)} disabled={actioning === t.lead_cadence_id} style={{ fontSize: 11 }}>
                  <Send size={11} /> Enviar Mensagem
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/chat`)} style={{ fontSize: 11 }}>
                <MessageCircle size={11} /> Abrir Chat
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/leads/${t.lead_id}`)} style={{ fontSize: 11 }}>
                <ExternalLink size={11} /> Ver Lead
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => handleComplete(t.lead_cadence_id)} disabled={actioning === t.lead_cadence_id} style={{ fontSize: 11, background: '#34C759', borderColor: '#34C759' }}>
                <Check size={11} /> Concluido
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleSkip(t.lead_cadence_id)} disabled={actioning === t.lead_cadence_id} style={{ fontSize: 11 }}>
                <SkipForward size={11} /> Pular
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const counts = {
    overdue: tasks.overdue.length,
    today: tasks.today.length,
    tomorrow: tasks.tomorrow.length,
    week: tasks.week.length,
    later: tasks.later.length,
  }

  return (
    <div>
      <div className="page-header">
        <h1><ListTodo size={20} style={{ marginRight: 8, verticalAlign: -4 }} /> Minhas Tarefas</h1>
      </div>

      {/* Bucket tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {BUCKETS.map(b => {
          const Icon = b.icon
          const count = counts[b.key]
          const isActive = activeBucket === b.key
          return (
            <button
              key={b.key}
              className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveBucket(b.key)}
              style={{ fontSize: 12, gap: 6, ...(isActive ? {} : count > 0 ? { borderColor: b.color, color: b.color } : {}) }}
            >
              <Icon size={12} /> {b.label}
              {count > 0 && (
                <span style={{ background: isActive ? 'rgba(255,255,255,0.2)' : `${b.color}20`, color: isActive ? '#fff' : b.color, padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : tasks[activeBucket].length === 0 ? (
        <div className="empty-state">
          <CheckCircle size={32} style={{ color: '#34C759', marginBottom: 8 }} />
          <h3>Nenhuma tarefa {BUCKETS.find(b => b.key === activeBucket)?.label.toLowerCase()}</h3>
          <p>{activeBucket === 'today' || activeBucket === 'overdue' ? 'Voce esta em dia! 🎉' : 'Nada agendado.'}</p>
        </div>
      ) : (
        <div>
          {tasks[activeBucket].map(renderTask)}
        </div>
      )}

      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', padding: '8px 0' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#34C75920', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={28} style={{ color: '#34C759' }} />
              </div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Mensagem enviada</h2>
              <div style={{ fontSize: 13, color: '#9B96B0' }}>Para <b style={{ color: '#fff' }}>{confirmModal.leadName}</b></div>

              {confirmModal.nextStep ? (
                <div style={{ width: '100%', padding: 12, background: 'rgba(255,179,0,0.08)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 8, marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: '#FFB300', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Próxima etapa</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {ACTION_LABELS[confirmModal.nextStep.action_type] || confirmModal.nextStep.action_type}
                    {confirmModal.nextStep.description && <span style={{ color: '#9B96B0', fontWeight: 400 }}> · {confirmModal.nextStep.description}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#C8C4D4', marginTop: 4 }}>
                    <Clock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    {new Date(confirmModal.nextStep.due_datetime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    <span style={{ color: '#6B6580', marginLeft: 6 }}>
                      (D+{confirmModal.nextStep.delay_days}{confirmModal.nextStep.scheduled_time ? ` ${confirmModal.nextStep.scheduled_time}` : ''})
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ width: '100%', padding: 12, background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 8, fontSize: 13, color: '#34C759' }}>
                  <CheckCircle size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> Cadência concluída
                </div>
              )}
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setConfirmModal(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
