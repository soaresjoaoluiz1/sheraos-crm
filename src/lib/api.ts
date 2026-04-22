const getToken = () => localStorage.getItem('dros_crm_token')
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api') ? `${BASE}${path}` : path
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...opts.headers },
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `API error: ${res.status}`) }
  return res.json()
}

export function formatBRL(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
export function formatNumber(n: number) { return n.toLocaleString('pt-BR') }
export function pctChange(c: number, p: number) { if (p === 0) return c > 0 ? 100 : null; return ((c - p) / p) * 100 }

// =============================================
// Types
// =============================================

export interface Account { id: number; name: string; slug: string; logo_url: string | null; is_active: number; created_at: string; lead_count?: number; user_count?: number; cnpj?: string | null; razao_social?: string | null; segmento?: string | null; website?: string | null; instagram?: string | null; whatsapp_comercial?: string | null; valor_mensal?: number | null; contrato_inicio?: string | null; cidade?: string | null; estado?: string | null; observacoes?: string | null; trabalha_anuncio?: number; investimento_anuncios?: number | null }
export interface User { id: number; account_id: number | null; name: string; email: string; role: string; is_active: number; created_at: string }
export interface FunnelStage { id: number; funnel_id: number; name: string; position: number; color: string; is_conversion: number; is_terminal: number; auto_keywords: string | null }
export interface Funnel { id: number; account_id: number; name: string; is_default: number; is_active: number; stages: FunnelStage[] }
export interface Tag { id: number; account_id: number; name: string; color: string }
export interface Lead {
  id: number; account_id: number; funnel_id: number; stage_id: number; attendant_id: number | null
  name: string | null; phone: string | null; email: string | null; city: string | null
  source: string | null; source_detail: string | null; notes: string | null
  wa_remote_jid: string | null; instance_id: number | null; profile_pic_url: string | null; is_active: number; created_at: string; updated_at: string
  is_archived?: number; archived_at?: string | null; has_new_after_archive?: number
  empresa?: string | null; cpf_cnpj?: string | null; instagram?: string | null; trabalha_anuncio?: number; investimento_anuncios?: number | null
  stage_name?: string; stage_color?: string; attendant_name?: string; instance_name?: string
  last_message?: string; message_count?: number; tags?: Tag[]
}
export interface Message { id: number; lead_id: number; direction: 'inbound' | 'outbound'; content: string | null; media_type: string; media_url: string | null; sender_name: string | null; wa_msg_id: string | null; created_at: string }
export const fetchMessageMedia = (leadId: number, msgId: number) => apiFetch<{ dataUrl: string; mime: string; type: string }>(`/api/messages/${leadId}/media/${msgId}`)
export interface StageHistoryEntry { id: number; lead_id: number; from_stage_name: string | null; to_stage_name: string; trigger_type: string; user_name: string | null; created_at: string }
export interface LeadNote { id: number; lead_id: number; user_id: number; content: string; user_name: string; created_at: string }
export interface PipelineMetric { stage_id: number; name: string; color: string; position: number; is_conversion: number; lead_count: number; avg_hours_in_stage: number | null; pct_of_total: number; conversion_from_prev: number | null }
export interface DashboardStats {
  totalLeads: number; prevTotalLeads: number; leadsToday: number; conversionRate: number; unassigned: number
  byStage: { id: number; name: string; color: string; position: number; count: number; is_conversion: number }[]
  bySource: { source: string; count: number }[]
  daily: { date: string; count: number }[]
}
export interface AgentStat { id: number; name: string; is_active: number; leads_period: number; leads_total: number; conversions: number }
export interface WhatsAppInstance { id: number; account_id: number; instance_name: string; api_url: string; api_key: string; status: string; phone_number: string | null; qr_code: string | null }
export interface Broadcast { id: number; name: string; message_template: string; status: string; sent_count: number; failed_count: number; total_count: number; created_at: string }

// =============================================
// API Functions
// =============================================

// Auth
export const login = (email: string, password: string) => apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

// Accounts
export const fetchAccounts = () => apiFetch<{ accounts: Account[] }>('/api/accounts').then(d => d.accounts)
export const createAccount = (data: Partial<Account> & { name: string }) => apiFetch<{ account: Account }>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }).then(d => d.account)
export const updateAccount = (id: number, data: Partial<Account>) => apiFetch<{ account: Account }>(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.account)
export const fetchAccount = (id: number) => apiFetch<{ account: Account; users: User[]; funnels: Funnel[] }>(`/api/accounts/${id}`)

// Users
export const fetchUsers = (accountId?: number) => apiFetch<{ users: User[] }>(`/api/users${accountId ? `?account_id=${accountId}` : ''}`).then(d => d.users)
export const createUser = (data: { name: string; email: string; password: string; role: string; account_id?: number }) => apiFetch<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(data) }).then(d => d.user)
export const updateUser = (id: number, data: Partial<User & { password?: string }>) => apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteUser = (id: number) => apiFetch(`/api/users/${id}`, { method: 'DELETE' })

// Funnels
export const fetchFunnels = (accountId: number) => apiFetch<{ funnels: Funnel[] }>(`/api/funnels?account_id=${accountId}`).then(d => d.funnels)
export const createFunnel = (accountId: number, data: { name: string; stages: Partial<FunnelStage>[] }) => apiFetch<{ funnel: Funnel }>(`/api/funnels?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.funnel)
export const fetchFunnel = (id: number, accountId: number) => apiFetch<{ funnel: Funnel }>(`/api/funnels/${id}?account_id=${accountId}`).then(d => d.funnel)
export const updateFunnelStages = (id: number, accountId: number, stages: Partial<FunnelStage>[]) => apiFetch(`/api/funnels/${id}/stages?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ stages }) })

// Leads
export interface LeadFilters { stage_id?: number; attendant_id?: number; funnel_id?: number; source?: string; city?: string; tag?: number; search?: string; date_from?: string; date_to?: string; show_archived?: '1' | 'all'; page?: number; limit?: number }
export const fetchLeads = (accountId: number, filters: LeadFilters = {}) => {
  const params = new URLSearchParams({ account_id: String(accountId) })
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== '') params.set(k, String(v)) })
  return apiFetch<{ leads: Lead[]; total: number; page: number; totalPages: number }>(`/api/leads?${params}`)
}
export const fetchLead = (id: number, accountId: number) => apiFetch<{ lead: Lead; messages: Message[]; stageHistory: StageHistoryEntry[]; notes: LeadNote[] }>(`/api/leads/${id}?account_id=${accountId}`)
export const createLead = (accountId: number, data: Partial<Lead>) => apiFetch<{ lead: Lead }>(`/api/leads?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.lead)
export const updateLead = (id: number, data: Partial<Lead>) => apiFetch(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const moveLeadStage = (id: number, stageId: number) => apiFetch(`/api/leads/${id}/stage`, { method: 'PUT', body: JSON.stringify({ stage_id: stageId }) })
export const assignLead = (id: number, attendantId: number | null) => apiFetch(`/api/leads/${id}/assign`, { method: 'PUT', body: JSON.stringify({ attendant_id: attendantId }) })
export const refreshProfilePic = (id: number) => apiFetch<{ profile_pic_url: string | null }>(`/api/leads/${id}/refresh-profile-pic`, { method: 'POST' })
export const archiveLead = (id: number) => apiFetch<{ lead: Lead }>(`/api/leads/${id}/archive`, { method: 'PATCH' }).then(d => d.lead)
export const unarchiveLead = (id: number) => apiFetch<{ lead: Lead }>(`/api/leads/${id}/unarchive`, { method: 'PATCH' }).then(d => d.lead)
export const fetchArchivedCount = (accountId: number) => apiFetch<{ count: number; withActivity: number }>(`/api/leads/archived-count?account_id=${accountId}`)

// Messages
export const fetchMessages = (leadId: number, accountId: number) => apiFetch<{ messages: Message[] }>(`/api/messages/${leadId}?account_id=${accountId}`).then(d => d.messages)
export const sendMessage = (leadId: number, accountId: number, content: string) => apiFetch<{ message: Message }>(`/api/messages/${leadId}?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ content }) }).then(d => d.message)

// Dashboard
export const fetchDashboardStats = (accountId: number, days = 7) => apiFetch<DashboardStats>(`/api/dashboard/stats?account_id=${accountId}&days=${days}`)
export const fetchAgentStats = (accountId: number, days = 7) => apiFetch<{ agents: AgentStat[] }>(`/api/dashboard/agents?account_id=${accountId}&days=${days}`).then(d => d.agents)
export const fetchGlobalDashboard = () => apiFetch<{ accounts: any[]; totalLeads: number; leadsToday: number }>('/api/dashboard/global')

// Integrations
export interface EvolutionConfig { api_url: string; api_key: string }
export const fetchEvolutionConfig = (accountId: number) => apiFetch<EvolutionConfig>(`/api/integrations/evolution-config?account_id=${accountId}`)
export const saveEvolutionConfig = (accountId: number, data: EvolutionConfig) => apiFetch(`/api/integrations/evolution-config?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })

export const fetchWhatsAppInstances = (accountId: number) => apiFetch<{ instances: WhatsAppInstance[] }>(`/api/integrations/whatsapp?account_id=${accountId}`).then(d => d.instances)
export const createWhatsAppInstance = (accountId: number, data: { instance_name: string }) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.instance)
export const connectWhatsAppInstance = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/connect?account_id=${accountId}`, { method: 'POST' }).then(d => d.instance)
export const checkWhatsAppStatus = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance; state: string }>(`/api/integrations/whatsapp/${id}/status?account_id=${accountId}`)
export const refreshWhatsAppQR = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/qrcode?account_id=${accountId}`, { method: 'POST' }).then(d => d.instance)
export const disconnectWhatsApp = (id: number, accountId: number) => apiFetch(`/api/integrations/whatsapp/${id}/disconnect?account_id=${accountId}`, { method: 'POST' })
export const deleteWhatsAppInstance = (id: number, accountId: number) => apiFetch(`/api/integrations/whatsapp/${id}?account_id=${accountId}`, { method: 'DELETE' })
export const setupWhatsAppWebhook = (id: number, accountId: number) => apiFetch<{ ok: boolean; webhookUrl: string }>(`/api/integrations/whatsapp/${id}/setup-webhook?account_id=${accountId}`, { method: 'POST' })
export const testWhatsAppConnection = (id: number, accountId: number) => apiFetch<{ success: boolean; status: string }>(`/api/integrations/whatsapp/${id}/test?account_id=${accountId}`, { method: 'POST' })

// Broadcasts
export const fetchBroadcasts = (accountId: number) => apiFetch<{ broadcasts: Broadcast[] }>(`/api/broadcasts?account_id=${accountId}`).then(d => d.broadcasts)
export const createBroadcast = (accountId: number, data: { name: string; message_template: string; message_variations?: string[]; delay_seconds?: number; lead_ids: number[] }) => apiFetch(`/api/broadcasts?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) })
export const sendBroadcast = (id: number, accountId: number) => apiFetch(`/api/broadcasts/${id}/send?account_id=${accountId}`, { method: 'POST' })

// Notes
export const addLeadNote = (leadId: number, content: string) => apiFetch<{ note: LeadNote }>(`/api/leads/${leadId}/notes`, { method: 'POST', body: JSON.stringify({ content }) }).then(d => d.note)

// Tags
export const fetchTags = (accountId: number) => apiFetch<{ tags: Tag[] }>(`/api/leads/tags/list?account_id=${accountId}`).then(d => d.tags)
export const createTag = (accountId: number, name: string, color: string) => apiFetch<{ tag: Tag }>(`/api/leads/tags/create?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ name, color }) }).then(d => d.tag)
export const deleteTag = (tagId: number, accountId: number) => apiFetch(`/api/leads/tags/${tagId}?account_id=${accountId}`, { method: 'DELETE' })
export const addLeadTag = (leadId: number, tagId: number) => apiFetch(`/api/leads/${leadId}/tags`, { method: 'POST', body: JSON.stringify({ tag_id: tagId }) })
export const removeLeadTag = (leadId: number, tagId: number) => apiFetch(`/api/leads/${leadId}/tags/${tagId}`, { method: 'DELETE' })

// Bulk actions
export const bulkAssignLeads = (accountId: number, leadIds: number[], attendantId: number | null) => apiFetch(`/api/leads/bulk/assign?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_ids: leadIds, attendant_id: attendantId }) })
export const bulkMoveLeads = (accountId: number, leadIds: number[], stageId: number) => apiFetch(`/api/leads/bulk/stage?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_ids: leadIds, stage_id: stageId }) })

// Pipeline metrics
export const fetchPipelineMetrics = (accountId: number, funnelId: number) => apiFetch<{ metrics: PipelineMetric[]; totalLeads: number }>(`/api/leads/pipeline/metrics?account_id=${accountId}&funnel_id=${funnelId}`)

// =============================================
// Cadences (sequential contact workflows)
// =============================================

export interface CadenceAttempt { id: number; cadence_id: number; position: number; action_type: string; description: string | null; instructions: string | null; delay_days: number; scheduled_time: string | null; auto_message: string | null; schedule_mode: 'date' | 'duration'; delay_minutes: number }
export interface Cadence { id: number; account_id: number; name: string; description: string | null; is_active: number; created_at: string; attempts: CadenceAttempt[] }
export interface LeadCadence {
  id: number; lead_id: number; cadence_id: number; current_attempt_id: number | null; status: string; started_at: string
  cadence_name?: string; action_type?: string; attempt_description?: string; attempt_instructions?: string; attempt_message?: string | null; attempt_position?: number; total_attempts?: number
}

export const fetchCadences = (accountId: number) => apiFetch<{ cadences: Cadence[] }>(`/api/cadences?account_id=${accountId}`).then(d => d.cadences)
export const createCadence = (accountId: number, data: { name: string; description?: string; attempts?: Partial<CadenceAttempt>[] }) => apiFetch<{ cadence: Cadence }>(`/api/cadences?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.cadence)
export const updateCadence = (id: number, accountId: number, data: Partial<Cadence>) => apiFetch(`/api/cadences/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateCadenceAttempts = (id: number, accountId: number, attempts: Partial<CadenceAttempt>[]) => apiFetch(`/api/cadences/${id}/attempts?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ attempts }) })
export const deleteCadence = (id: number, accountId: number) => apiFetch(`/api/cadences/${id}?account_id=${accountId}`, { method: 'DELETE' })
export const assignLeadCadence = (cadenceId: number, accountId: number, leadId: number) => apiFetch(`/api/cadences/${cadenceId}/assign?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_id: leadId }) })
export const advanceLeadCadence = (lcId: number, accountId: number) => apiFetch(`/api/cadences/lead-cadence/${lcId}/advance?account_id=${accountId}`, { method: 'PUT' })
export const removeLeadCadence = (lcId: number, accountId: number) => apiFetch(`/api/cadences/lead-cadence/${lcId}?account_id=${accountId}`, { method: 'DELETE' })
export const fetchLeadCadence = (leadId: number, accountId: number) => apiFetch<{ leadCadence: LeadCadence | null }>(`/api/cadences/lead/${leadId}?account_id=${accountId}`).then(d => d.leadCadence)

// =============================================
// Tasks (cadence steps that need execution)
// =============================================

export interface Task {
  lead_cadence_id: number; lead_id: number; cadence_id: number; current_attempt_id: number; status: string
  lead_name: string | null; lead_phone: string | null; profile_pic_url: string | null
  attendant_id: number | null; attendant_name: string | null
  stage_name: string | null; stage_color: string | null
  cadence_name: string; attempt_position: number; total_attempts: number
  action_type: string; attempt_description: string | null; attempt_instructions: string | null
  delay_days: number; scheduled_time: string | null; schedule_mode: 'date' | 'duration'; delay_minutes: number; auto_message: string | null
  due_datetime: string; bucket: 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'
}
export interface TaskCounts { overdue: number; today: number; tomorrow: number; week: number; total: number }
export interface TaskGroups { overdue: Task[]; today: Task[]; tomorrow: Task[]; week: Task[]; later: Task[] }

export const fetchMyTasks = (accountId: number) => apiFetch<TaskGroups>(`/api/tasks/my?account_id=${accountId}`)
export const fetchTaskCounts = (accountId: number) => apiFetch<TaskCounts>(`/api/tasks/counts?account_id=${accountId}`)
export interface NextStep { position: number; action_type: string; description: string | null; delay_days: number; scheduled_time: string | null; schedule_mode: 'date' | 'duration'; delay_minutes: number; due_datetime: string }
export interface CompleteResult { ok: boolean; completed: boolean; nextStep: NextStep | null }
export const completeTask = (lcId: number, accountId: number) => apiFetch<CompleteResult>(`/api/tasks/${lcId}/complete?account_id=${accountId}`, { method: 'POST' })
export const skipTask = (lcId: number, accountId: number) => apiFetch(`/api/tasks/${lcId}/skip?account_id=${accountId}`, { method: 'POST' })

// Standalone tasks
export interface StandaloneTaskInput { lead_id?: number; title: string; description?: string; due_mode: 'date' | 'duration'; due_date?: string; due_time?: string; due_minutes?: number; assigned_to?: number }
export const createStandaloneTask = (accountId: number, data: StandaloneTaskInput) => apiFetch<{ task: any }>(`/api/tasks/standalone?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) })
export const completeStandaloneTask = (id: number, accountId: number) => apiFetch(`/api/tasks/standalone/${id}/complete?account_id=${accountId}`, { method: 'POST' })
export const deleteStandaloneTask = (id: number, accountId: number) => apiFetch(`/api/tasks/standalone/${id}?account_id=${accountId}`, { method: 'DELETE' })

// =============================================
// Ready Messages (quick templates)
// =============================================

export interface ReadyMessage { id: number; account_id: number; title: string; content: string; image_url: string | null; video_url: string | null; stage_id: number | null; stage_name?: string; stage_color?: string; is_active: number; created_at: string }

export const fetchReadyMessages = (accountId: number) => apiFetch<{ messages: ReadyMessage[] }>(`/api/ready-messages?account_id=${accountId}`).then(d => d.messages)
export const createReadyMessage = (accountId: number, data: Partial<ReadyMessage>) => apiFetch<{ message: ReadyMessage }>(`/api/ready-messages?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.message)
export const updateReadyMessage = (id: number, accountId: number, data: Partial<ReadyMessage>) => apiFetch(`/api/ready-messages/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteReadyMessage = (id: number, accountId: number) => apiFetch(`/api/ready-messages/${id}?account_id=${accountId}`, { method: 'DELETE' })

// =============================================
// Qualification Sequences
// =============================================

export interface QualificationSequence { id: number; account_id: number; question: string; position: number; is_active: number }
export interface LeadQualification { sequence_id: number; question: string; position: number; answer_id: number | null; answer: string | null; answered_at: string | null; answered_by: number | null; answered_by_name: string | null }

export const fetchQualifications = (accountId: number) => apiFetch<{ sequences: QualificationSequence[] }>(`/api/qualifications?account_id=${accountId}`).then(d => d.sequences)
export const createQualification = (accountId: number, question: string) => apiFetch<{ sequence: QualificationSequence }>(`/api/qualifications?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ question }) }).then(d => d.sequence)
export const updateQualification = (id: number, accountId: number, data: Partial<QualificationSequence>) => apiFetch(`/api/qualifications/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteQualification = (id: number, accountId: number) => apiFetch(`/api/qualifications/${id}?account_id=${accountId}`, { method: 'DELETE' })
export const fetchLeadQualifications = (leadId: number, accountId: number) => apiFetch<{ qualifications: LeadQualification[] }>(`/api/qualifications/lead/${leadId}?account_id=${accountId}`).then(d => d.qualifications)
export const answerQualification = (leadId: number, accountId: number, sequenceId: number, answer: string) => apiFetch(`/api/qualifications/lead/${leadId}/answer?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ sequence_id: sequenceId, answer }) })

// =============================================
// Launches (product/property listings)
// =============================================

export interface LaunchMessage { id: number; launch_id: number; position: number; question: string; answer: string }
export interface Launch { id: number; account_id: number; title: string; identification: string | null; is_active: number; created_at: string; messages: LaunchMessage[] }

export const fetchLaunches = (accountId: number) => apiFetch<{ launches: Launch[] }>(`/api/launches?account_id=${accountId}`).then(d => d.launches)
export const createLaunch = (accountId: number, data: { title: string; identification?: string; messages?: Partial<LaunchMessage>[] }) => apiFetch<{ launch: Launch }>(`/api/launches?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.launch)
export const updateLaunch = (id: number, accountId: number, data: Partial<Launch>) => apiFetch(`/api/launches/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateLaunchMessages = (id: number, accountId: number, messages: Partial<LaunchMessage>[]) => apiFetch(`/api/launches/${id}/messages?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ messages }) })
export const deleteLaunch = (id: number, accountId: number) => apiFetch(`/api/launches/${id}?account_id=${accountId}`, { method: 'DELETE' })
