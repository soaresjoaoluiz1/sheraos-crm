import crypto from 'crypto'
import fetch from 'node-fetch'
import db from '../db.js'

// Hash padrao Meta: SHA256 lowercase trim
function sha256(s) {
  if (!s) return null
  return crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex')
}

// Normaliza telefone pra E.164 sem +
function normalizePhoneForHash(p) {
  if (!p) return null
  const digits = String(p).replace(/[^\d]/g, '')
  if (!digits) return null
  // SHA256 do telefone com codigo do pais, sem +
  return sha256(digits)
}

// Constroi fbc a partir de ctwa_clid (formato padrao Meta)
function buildFbc(ctwaClid, eventTimeSec) {
  if (!ctwaClid) return null
  return `fb.1.${eventTimeSec * 1000}.${ctwaClid}`
}

// Tenta separar first_name e last_name de um nome completo
function splitName(fullName) {
  if (!fullName) return { fn: null, ln: null }
  const parts = String(fullName).trim().split(/\s+/)
  if (parts.length === 0) return { fn: null, ln: null }
  if (parts.length === 1) return { fn: parts[0], ln: null }
  return { fn: parts[0], ln: parts.slice(1).join(' ') }
}

// ─── Envia evento pro Meta CAPI ──────────────────────────────────────
// opts: { accountId, lead, eventName, stageId, historyId }
// retorna: { ok, skipped, reason, event_id, response, error }
export async function sendCapiEvent({ accountId, lead, eventName, stageId, historyId }) {
  if (!accountId || !lead || !eventName) return { skipped: true, reason: 'missing_params' }

  const account = db.prepare(`
    SELECT meta_pixel_id, meta_capi_token, meta_capi_test_event_code, meta_capi_enabled
    FROM accounts WHERE id = ?
  `).get(accountId)

  if (!account?.meta_capi_enabled || !account.meta_pixel_id || !account.meta_capi_token) {
    return { skipped: true, reason: 'capi_not_configured' }
  }

  // Decisao: so dispara pra leads que vieram de CTWA (tem ctwa_clid salvo)
  if (!lead.ctwa_clid) {
    return { skipped: true, reason: 'not_ctwa_lead' }
  }

  const eventTime = Math.floor(Date.now() / 1000)
  const eventId = `lead_${lead.id}_stage_${stageId || 0}_${eventTime}`

  const { fn, ln } = splitName(lead.name)

  // user_data — tudo hasheado em SHA256 lowercase trim
  const userData = {}
  const phHash = normalizePhoneForHash(lead.phone)
  if (phHash) userData.ph = [phHash]
  if (lead.email) userData.em = [sha256(lead.email)]
  if (fn) userData.fn = [sha256(fn)]
  if (ln) userData.ln = [sha256(ln)]
  // external_id facilita match com lead unico no CRM
  userData.external_id = [sha256(`crm_lead_${lead.id}`)]
  // fbc reconstruido a partir do ctwa_clid — Meta usa pra atribuir ao clique original
  const fbc = buildFbc(lead.ctwa_clid, eventTime)
  if (fbc) userData.fbc = fbc

  const payload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: 'system_generated',
      user_data: userData,
      custom_data: {
        lead_source: lead.source || 'crm',
        stage_id: stageId || null,
        currency: 'BRL',
      },
    }],
  }
  if (account.meta_capi_test_event_code) {
    payload.test_event_code = account.meta_capi_test_event_code
  }

  try {
    const url = `https://graph.facebook.com/v18.0/${account.meta_pixel_id}/events?access_token=${encodeURIComponent(account.meta_capi_token)}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10000,
    })
    const responseData = await r.json().catch(() => ({}))
    const ok = r.ok && !responseData.error

    // Audit no stage_history se foi passado
    if (historyId) {
      try {
        db.prepare('UPDATE stage_history SET capi_event_id = ?, capi_status = ? WHERE id = ?')
          .run(eventId, ok ? 'sent' : 'failed', historyId)
      } catch {}
    }

    if (!ok) {
      console.error(`[CAPI] lead ${lead.id} stage ${stageId} event ${eventName} — falha:`, JSON.stringify(responseData).substring(0, 300))
    } else {
      console.log(`[CAPI] lead ${lead.id} → ${eventName} enviado ok (event_id: ${eventId})`)
    }

    return { ok, event_id: eventId, response: responseData }
  } catch (err) {
    console.error(`[CAPI] erro fatal lead ${lead.id}:`, err.message)
    if (historyId) {
      try {
        db.prepare('UPDATE stage_history SET capi_status = ? WHERE id = ?').run('failed', historyId)
      } catch {}
    }
    return { ok: false, error: err.message }
  }
}

// Helper: pega lead completo pelo id (pra callers que so tem o id)
export function loadLeadForCapi(leadId) {
  return db.prepare('SELECT id, account_id, name, phone, email, ctwa_clid, source FROM leads WHERE id = ?').get(leadId)
}

// Helper: dispara CAPI se stage tem meta_event_name configurado.
// historyId opcional pra auditoria.
// Fire-and-forget — nunca bloqueia caller.
export function triggerCapiForStageChange(leadOrId, newStageId, historyId = null) {
  try {
    const lead = typeof leadOrId === 'number' ? loadLeadForCapi(leadOrId) : leadOrId
    if (!lead || !newStageId) return
    const stage = db.prepare('SELECT meta_event_name FROM funnel_stages WHERE id = ?').get(newStageId)
    if (!stage?.meta_event_name) return
    // Garante que temos ctwa_clid (recarrega se objeto veio sem)
    let leadFull = lead
    if (!('ctwa_clid' in lead)) leadFull = loadLeadForCapi(lead.id)
    sendCapiEvent({
      accountId: leadFull.account_id,
      lead: leadFull,
      eventName: stage.meta_event_name,
      stageId: newStageId,
      historyId,
    }).catch(e => console.error('[CAPI] async error:', e.message))
  } catch (e) {
    console.error('[CAPI] triggerCapiForStageChange error:', e.message)
  }
}

// Teste manual (chamado pelo endpoint /test-meta-capi)
export async function testCapi(accountId) {
  const account = db.prepare(`
    SELECT meta_pixel_id, meta_capi_token, meta_capi_test_event_code
    FROM accounts WHERE id = ?
  `).get(accountId)
  if (!account?.meta_pixel_id || !account?.meta_capi_token) {
    return { ok: false, error: 'Pixel ID ou Access Token nao configurado' }
  }
  const eventTime = Math.floor(Date.now() / 1000)
  const payload = {
    data: [{
      event_name: 'TestEvent',
      event_time: eventTime,
      event_id: `test_${eventTime}`,
      action_source: 'system_generated',
      user_data: { external_id: [sha256(`test_${eventTime}`)] },
    }],
  }
  if (account.meta_capi_test_event_code) payload.test_event_code = account.meta_capi_test_event_code
  console.log(`[CAPI TEST] account ${accountId} pixel ${account.meta_pixel_id} test_code ${account.meta_capi_test_event_code || '(none)'}`)
  try {
    const url = `https://graph.facebook.com/v18.0/${account.meta_pixel_id}/events?access_token=${encodeURIComponent(account.meta_capi_token)}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10000,
    })
    const responseData = await r.json().catch(() => ({}))
    console.log(`[CAPI TEST] account ${accountId} response HTTP ${r.status}:`, JSON.stringify(responseData).substring(0, 400))
    if (!r.ok || responseData.error) {
      return { ok: false, error: responseData.error?.message || `HTTP ${r.status}`, response: responseData }
    }
    return { ok: true, response: responseData }
  } catch (err) {
    console.error(`[CAPI TEST] account ${accountId} erro fatal:`, err.message)
    return { ok: false, error: err.message }
  }
}
