import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'

const router = Router()

// Helper: fetch profile picture URL from Evolution (async, fire-and-forget)
async function fetchAndSaveProfilePic(instance, phone, leadId) {
  if (!instance || !phone || !leadId) return
  try {
    const r = await fetch(`${instance.api_url}/chat/fetchProfilePictureUrl/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ number: phone }),
    })
    const data = await r.json()
    if (data?.profilePictureUrl) {
      db.prepare("UPDATE leads SET profile_pic_url = ?, profile_pic_updated_at = datetime('now') WHERE id = ?").run(data.profilePictureUrl, leadId)
    }
  } catch {}
}

// Helper: get or create lead from phone
function normalizePhone(p) {
  if (!p) return p
  p = p.replace(/[^\d]/g, '')
  if (p.startsWith('55') && p.length === 13) return p
  if (p.startsWith('55') && p.length === 12) return p.slice(0, 4) + '9' + p.slice(4)
  if (!p.startsWith('55') && p.length === 11) return '55' + p
  if (!p.startsWith('55') && p.length === 10) return '55' + p.slice(0, 2) + '9' + p.slice(2)
  return p // can't normalize safely — return as-is
}

function getOrCreateLead(accountId, phone, name, source, waJid, instanceId) {
  phone = normalizePhone(phone)
  // Find existing by phone or wa_remote_jid (prefer non-archived; if all archived, take most recent)
  let lead = null
  if (waJid) lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, waJid)
  if (!lead && phone) lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND phone = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, phone)

  if (lead) {
    // Update instance_id if not set
    if (instanceId && !lead.instance_id) {
      db.prepare('UPDATE leads SET instance_id = ? WHERE id = ?').run(instanceId, lead.id)
    }
    // Unarchive if needed (client sent new message — relevant again)
    if (lead.is_archived) {
      db.prepare("UPDATE leads SET is_archived = 0, archived_at = NULL, has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
      lead.is_archived = 0
    }
    return { lead, isNew: false }
  }

  // Get default funnel + first stage
  const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(accountId)
  if (!funnel) return { lead: null, isNew: false }
  const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
  if (!firstStage) return { lead: null, isNew: false }

  // Distribution: prefer instance.default_attendant_id, fallback to round-robin/manual
  let attendantId = null
  if (instanceId) {
    const inst = db.prepare('SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?').get(instanceId)
    if (inst?.default_attendant_id) attendantId = inst.default_attendant_id
  }
  if (!attendantId) {
    const rule = db.prepare('SELECT * FROM distribution_rules WHERE account_id = ? AND funnel_id = ?').get(accountId, funnel.id)
    if (rule && rule.type === 'round_robin' && rule.active_attendants) {
      try {
        const attendants = JSON.parse(rule.active_attendants)
        if (attendants.length > 0) {
          const idx = rule.last_assigned_index % attendants.length
          attendantId = attendants[idx]
          db.prepare("UPDATE distribution_rules SET last_assigned_index = ?, updated_at = datetime('now') WHERE id = ?").run(rule.last_assigned_index + 1, rule.id)
        }
      } catch {}
    }
  }

  const result = db.prepare(`
    INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id, opted_in_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(accountId, funnel.id, firstStage.id, attendantId, name || phone || 'Sem nome', phone || null, source, waJid || null, instanceId || null)

  // Log stage history
  db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(result.lastInsertRowid, firstStage.id, 'webhook')

  lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
  return { lead, isNew: true }
}

// Helper: auto-detect stage from message keywords
function autoDetectStage(lead, messageText) {
  if (!messageText) return
  const text = messageText.toLowerCase()

  // Get all stages ahead of current
  const currentStage = db.prepare('SELECT position FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  if (!currentStage) return

  const aheadStages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? AND position > ? ORDER BY position').all(lead.funnel_id, currentStage.position)

  for (const stage of aheadStages) {
    if (!stage.auto_keywords) continue
    let keywords
    try { keywords = JSON.parse(stage.auto_keywords) } catch { continue }
    if (!Array.isArray(keywords)) continue

    const matched = keywords.some(kw => text.includes(kw.toLowerCase()))
    if (matched) {
      const oldStageId = lead.stage_id
      db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage.id, lead.id)
      db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
        lead.id, oldStageId, stage.id, 'auto_keyword'
      )
      break // Only advance to first match
    }
  }
}

// Evolution API webhook
router.post('/evolution/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    // Identify which instance sent this webhook (by instance name in body or match account)
    const webhookInstance = req.body.instance || req.body.instanceName || null
    let waInstance = null
    if (webhookInstance) {
      waInstance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(account.id, webhookInstance)
    }
    if (!waInstance) {
      // Fallback: get first instance for this account
      waInstance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? ORDER BY id LIMIT 1').get(account.id)
    }

    // Verify webhook secret if configured
    if (waInstance?.webhook_secret && req.headers['x-webhook-secret'] !== waInstance.webhook_secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' })
    }

    const { event, data } = req.body
    if (event !== 'messages.upsert' || !data) return res.json({ ok: true })

    const remoteJid = data.key?.remoteJid || ''
    const senderPn = data.key?.senderPn || data.senderPn || ''
    const fromMe = data.key?.fromMe || false
    const msgId = data.key?.id || ''
    const pushName = data.pushName || ''
    const timestamp = data.messageTimestamp ? new Date(parseInt(data.messageTimestamp) * 1000).toISOString() : new Date().toISOString()

    // Detect message type + extract content/media info
    const msg = data.message || {}
    let content = ''
    let mediaType = 'text'
    let mediaUrl = null
    let mediaCaption = ''
    if (msg.conversation) {
      content = msg.conversation
    } else if (msg.extendedTextMessage?.text) {
      content = msg.extendedTextMessage.text
    } else if (msg.imageMessage) {
      mediaType = 'image'; mediaUrl = msg.imageMessage.url || null; mediaCaption = msg.imageMessage.caption || ''; content = mediaCaption || '[Imagem]'
    } else if (msg.videoMessage) {
      mediaType = 'video'; mediaUrl = msg.videoMessage.url || null; mediaCaption = msg.videoMessage.caption || ''; content = mediaCaption || '[Video]'
    } else if (msg.audioMessage) {
      mediaType = 'audio'; mediaUrl = msg.audioMessage.url || null; content = '[Audio]'
    } else if (msg.documentMessage) {
      mediaType = 'document'; mediaUrl = msg.documentMessage.url || null; content = msg.documentMessage.fileName || '[Documento]'
    } else if (msg.stickerMessage) {
      mediaType = 'sticker'; mediaUrl = msg.stickerMessage.url || null; content = '[Sticker]'
    }

    // Skip groups, status, broadcasts
    if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('status@')) {
      return res.json({ ok: true })
    }

    // Prefer senderPn (real phone) over remoteJid (might be @lid = legacy ID)
    const realJid = senderPn || remoteJid
    let phone = ''
    let dedupJid = ''
    let isLid = false

    if (senderPn) {
      phone = normalizePhone(senderPn.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
      dedupJid = `${phone}@s.whatsapp.net`
    } else if (realJid.endsWith('@lid')) {
      if (!pushName) return res.json({ ok: true })
      isLid = true
      phone = realJid.replace('@lid', '')
      dedupJid = realJid
    } else {
      phone = normalizePhone(realJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
      dedupJid = `${phone}@s.whatsapp.net`
    }
    if (!phone) return res.json({ ok: true })

    // Get or create lead
    let lead, isNew
    if (isLid) {
      // @lid: first try by LID jid, then by pushName in same account
      lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ?').get(account.id, dedupJid)
      if (!lead && pushName) {
        lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND name = ?').get(account.id, pushName)
        if (lead) {
          // Link LID to existing lead for future lookups
          db.prepare("UPDATE leads SET wa_remote_jid = ?, updated_at = datetime('now') WHERE id = ?").run(dedupJid, lead.id)
        }
      }
      if (!lead) {
        // Create new lead with LID (no real phone)
        const r = getOrCreateLead(account.id, null, pushName, 'whatsapp', dedupJid, waInstance?.id || null)
        lead = r.lead; isNew = r.isNew
      } else {
        isNew = false
      }
    } else {
      const r = getOrCreateLead(account.id, phone, pushName, 'whatsapp', dedupJid, waInstance?.id || null)
      lead = r.lead; isNew = r.isNew
    }
    if (!lead) return res.json({ ok: true })

    // Fetch profile picture in background (no await)
    if (waInstance && (isNew || !lead.profile_pic_url)) {
      fetchAndSaveProfilePic(waInstance, phone, lead.id)
    }

    // When attendant sends first message (fromMe=true) and lead is in first stage, advance to "Em Atendimento"
    if (!isNew && fromMe) {
      const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(lead.funnel_id)
      const secondStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1 OFFSET 1').get(lead.funnel_id)
      if (firstStage && secondStage && lead.stage_id === firstStage.id) {
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(secondStage.id, lead.id)
        db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
          lead.id, firstStage.id, secondStage.id, 'webhook'
        )
      }
    }

    // Store message (dedup by wa_msg_id) + track instance
    const existing = msgId ? db.prepare('SELECT id FROM messages WHERE wa_msg_id = ?').get(msgId) : null
    if (!existing) {
      db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, media_type, media_url, sender_name, wa_msg_id, wa_timestamp, instance_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lead.id, account.id, fromMe ? 'outbound' : 'inbound', content, mediaType, mediaUrl, fromMe ? '' : pushName, msgId || null, timestamp, waInstance?.id || null)
      // Update lead's last_instance_id (next message from CRM will use this instance)
      if (waInstance?.id) {
        db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(waInstance.id, lead.id)
        // Ensure assignment exists for (lead, instance). Default attendant = instance.default_attendant_id
        db.prepare(`
          INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
          VALUES (?, ?, (SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?))
        `).run(lead.id, waInstance.id, waInstance.id)
      }
    }

    // Auto stage detection: keywords in outbound messages advance stages
    // Inbound messages from client don't auto-advance (attendant controls flow)
    if (fromMe && content) autoDetectStage(lead, content)

    // Update lead name if we have pushName and lead has no name
    if (!lead.name && pushName) {
      db.prepare('UPDATE leads SET name = ? WHERE id = ? AND name IS NULL').run(pushName, lead.id)
    }

    // Broadcast SSE — archived leads mark activity silently, don't show up in pipeline/chat
    if (isNew) {
      broadcastSSE(account.id, 'lead:created', db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id))
    } else {
      const current = db.prepare('SELECT is_archived FROM leads WHERE id = ?').get(lead.id)
      if (current?.is_archived) {
        if (!fromMe) {
          db.prepare('UPDATE leads SET has_new_after_archive = 1 WHERE id = ?').run(lead.id)
          try { broadcastSSE(account.id, 'lead:archived-activity', { id: lead.id }) } catch {}
        }
      } else {
        broadcastSSE(account.id, 'lead:message', { leadId: lead.id, message: content, direction: fromMe ? 'outbound' : 'inbound' })
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook Evolution]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Meta Lead Form webhook
router.post('/meta-leads/:accountSlug', async (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const entries = req.body.entry || []
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue
        const leadgenId = change.value?.leadgen_id
        if (!leadgenId) continue

        // Fetch full lead data from Meta (needs META_ACCESS_TOKEN)
        const metaToken = process.env.META_ACCESS_TOKEN
        if (!metaToken) continue

        const r = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?access_token=${metaToken}`)
        const data = await r.json()
        if (data.error) continue

        // Extract fields
        let name = '', phone = '', email = ''
        for (const field of (data.field_data || [])) {
          const val = field.values?.[0] || ''
          if (field.name === 'full_name') name = val
          else if (field.name === 'phone_number') { phone = val.replace(/[^\d]/g, ''); if (!phone.startsWith('55') && phone.length >= 10 && phone.length <= 11) phone = '55' + phone }
          else if (field.name === 'email') email = val
        }

        getOrCreateLead(account.id, phone, name, 'meta_form', null)
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook Meta]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Meta webhook verification
router.get('/meta-leads/:accountSlug', (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN || 'dros-crm-verify'
  if (req.query['hub.verify_token'] === verifyToken && req.query['hub.mode'] === 'subscribe') {
    return res.send(req.query['hub.challenge'])
  }
  res.status(403).send('Forbidden')
})

// Website form webhook
router.post('/site/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const { name, phone, email, city, source, message } = req.body
    const { lead, isNew } = getOrCreateLead(account.id, phone, name, 'website', null)
    if (lead && email) db.prepare('UPDATE leads SET email = ? WHERE id = ? AND email IS NULL').run(email, lead.id)
    if (lead && city) db.prepare('UPDATE leads SET city = ? WHERE id = ? AND city IS NULL').run(city, lead.id)

    res.json({ ok: true, leadId: lead?.id })
  } catch (err) {
    console.error('[Webhook Site]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Google Sheets webhook ──────────────────────────────────────
router.post('/sheets/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const body = req.body
    // Extract known fields (supports both PT-BR and Facebook format)
    const name = body.name || body.first_name || body.nome || body.full_name || ''
    // Phone: remove prefixos comuns dos forms Meta (p:, p:+, +) — deixa so digitos com 55 prefix se for BR
    const phoneRaw = body.phone || body.phone_number || body.telefone || body.whatsapp || body.celular || ''
    let phone = String(phoneRaw).replace(/^\s*p\s*:\s*/i, '').replace(/[^\d+]/g, '').replace(/^\+/, '')
    const email = body.email || ''
    const city = body.city || body.cidade || ''
    const empresa = body.empresa || ''
    const cpf_cnpj = body.cpf_cnpj || body.cpf || body.cnpj || ''
    const instagram = body.instagram || ''
    const source = body.source || body.fonte || body.form_name || 'google_sheets'
    const source_detail = body.source_detail || [body.campaign_name, body.adset_name, body.ad_name].filter(Boolean).join(' > ') || ''

    if (!name && !phone) return res.status(400).json({ error: 'name ou phone obrigatorio' })

    const { lead, isNew } = getOrCreateLead(account.id, phone, name, source, null)
    if (!lead) return res.status(400).json({ error: 'Falha ao criar lead (sem funil configurado?)' })

    // Update optional fields
    if (email) db.prepare('UPDATE leads SET email = COALESCE(email, ?) WHERE id = ?').run(email, lead.id)
    if (city) db.prepare('UPDATE leads SET city = COALESCE(city, ?) WHERE id = ?').run(city, lead.id)
    if (empresa) db.prepare('UPDATE leads SET empresa = COALESCE(empresa, ?) WHERE id = ?').run(empresa, lead.id)
    if (cpf_cnpj) db.prepare('UPDATE leads SET cpf_cnpj = COALESCE(cpf_cnpj, ?) WHERE id = ?').run(cpf_cnpj, lead.id)
    if (instagram) db.prepare('UPDATE leads SET instagram = COALESCE(instagram, ?) WHERE id = ?').run(instagram, lead.id)
    if (source_detail) db.prepare('UPDATE leads SET source_detail = COALESCE(source_detail, ?) WHERE id = ?').run(source_detail, lead.id)

    // Collect custom/dynamic fields (Facebook form questions, etc)
    const knownKeys = new Set(['name','first_name','last_name','full_name','nome','phone','phone_number','telefone','whatsapp','celular','email','city','cidade','empresa','cpf_cnpj','cpf','cnpj','instagram','source','fonte','form_name','source_detail','campaign_name','campaign_id','adset_name','adset_id','ad_name','ad_id','form_id','id','created_time','is_organic','platform','lead_status','crm_enviado'])
    const customFields = Object.entries(body)
      .filter(([k, v]) => !knownKeys.has(k) && v && String(v).trim())
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n')

    if (customFields) {
      const existing = db.prepare('SELECT notes FROM leads WHERE id = ?').get(lead.id)
      const newNotes = existing?.notes ? existing.notes + '\n' + customFields : customFields
      db.prepare('UPDATE leads SET notes = ? WHERE id = ?').run(newNotes, lead.id)
    }

    if (isNew) {
      try { broadcastSSE(account.id, 'lead:created', lead) } catch {}
    }

    console.log(`[Webhook Sheets] ${isNew ? 'New' : 'Existing'} lead: ${name || phone} → account ${account.name}`)
    res.json({ ok: true, leadId: lead.id, isNew })
  } catch (err) {
    console.error('[Webhook Sheets]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
