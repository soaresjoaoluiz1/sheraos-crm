import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = resolve(__dirname, 'data', 'crm.db')

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Schema
db.exec(`
  -- Accounts (client companies)
  CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    logo_url    TEXT,
    timezone    TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Users (super_admin, gerente, atendente)
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('super_admin', 'gerente', 'atendente')),
    avatar_url  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  -- Funnels (custom pipelines per account)
  CREATE TABLE IF NOT EXISTS funnels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  -- Funnel stages
  CREATE TABLE IF NOT EXISTS funnel_stages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    funnel_id       INTEGER NOT NULL,
    name            TEXT NOT NULL,
    position        INTEGER NOT NULL DEFAULT 0,
    color           TEXT NOT NULL DEFAULT '#FFB300',
    is_conversion   INTEGER NOT NULL DEFAULT 0,
    is_terminal     INTEGER NOT NULL DEFAULT 0,
    auto_keywords   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_stages_funnel ON funnel_stages(funnel_id, position);

  -- Tags
  CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#FFB300',
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, name)
  );

  -- Leads
  CREATE TABLE IF NOT EXISTS leads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    funnel_id       INTEGER NOT NULL,
    stage_id        INTEGER NOT NULL,
    attendant_id    INTEGER,
    name            TEXT,
    phone           TEXT,
    email           TEXT,
    city            TEXT,
    source          TEXT,
    source_detail   TEXT,
    notes           TEXT,
    custom_fields   TEXT,
    wa_remote_jid   TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (funnel_id) REFERENCES funnels(id),
    FOREIGN KEY (stage_id) REFERENCES funnel_stages(id),
    FOREIGN KEY (attendant_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_leads_account ON leads(account_id);
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage_id);
  CREATE INDEX IF NOT EXISTS idx_leads_attendant ON leads(attendant_id);
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  CREATE INDEX IF NOT EXISTS idx_leads_wa_jid ON leads(wa_remote_jid);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_leads_funnel_active ON leads(funnel_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_leads_account_created ON leads(account_id, created_at DESC);

  -- Lead tags (many-to-many)
  CREATE TABLE IF NOT EXISTS lead_tags (
    lead_id     INTEGER NOT NULL,
    tag_id      INTEGER NOT NULL,
    PRIMARY KEY (lead_id, tag_id),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  -- Messages (WhatsApp conversation)
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL,
    account_id      INTEGER NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    content         TEXT,
    media_type      TEXT DEFAULT 'text',
    media_url       TEXT,
    wa_msg_id       TEXT,
    wa_timestamp    TEXT,
    sender_name     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id, created_at);

  -- Stage history (audit trail)
  CREATE TABLE IF NOT EXISTS stage_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL,
    from_stage_id   INTEGER,
    to_stage_id     INTEGER NOT NULL,
    trigger_type    TEXT NOT NULL DEFAULT 'manual',
    triggered_by    INTEGER,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (from_stage_id) REFERENCES funnel_stages(id),
    FOREIGN KEY (to_stage_id) REFERENCES funnel_stages(id),
    FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_lead ON stage_history(lead_id, created_at);

  -- WhatsApp instances (Evolution API config)
  CREATE TABLE IF NOT EXISTS whatsapp_instances (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    instance_name   TEXT NOT NULL,
    api_url         TEXT NOT NULL,
    api_key         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'disconnected',
    phone_number    TEXT,
    webhook_secret  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  -- Distribution rules (round-robin)
  CREATE TABLE IF NOT EXISTS distribution_rules (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id          INTEGER NOT NULL,
    funnel_id           INTEGER NOT NULL,
    type                TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('round_robin', 'manual')),
    last_assigned_index INTEGER NOT NULL DEFAULT 0,
    active_attendants   TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE CASCADE,
    UNIQUE(account_id, funnel_id)
  );

  -- Broadcasts (bulk messaging)
  CREATE TABLE IF NOT EXISTS broadcasts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    name            TEXT NOT NULL,
    message_template TEXT NOT NULL,
    media_url       TEXT,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'failed')),
    scheduled_at    TEXT,
    sent_count      INTEGER NOT NULL DEFAULT 0,
    failed_count    INTEGER NOT NULL DEFAULT 0,
    total_count     INTEGER NOT NULL DEFAULT 0,
    created_by      INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- Broadcast recipients
  CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id    INTEGER NOT NULL,
    lead_id         INTEGER NOT NULL,
    phone           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    wa_msg_id       TEXT,
    sent_at         TEXT,
    error           TEXT,
    FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_bcast_recipients ON broadcast_recipients(broadcast_id);

  -- Lead notes (internal comments)
  CREATE TABLE IF NOT EXISTS lead_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_lead ON lead_notes(lead_id, created_at DESC);

  -- Cadences (sequential contact workflows)
  CREATE TABLE IF NOT EXISTS cadences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cadence_attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cadence_id  INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    action_type TEXT NOT NULL CHECK (action_type IN ('mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita')),
    description TEXT,
    instructions TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_cadence_attempts_cadence ON cadence_attempts(cadence_id, position);

  CREATE TABLE IF NOT EXISTS lead_cadences (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id               INTEGER NOT NULL,
    cadence_id            INTEGER NOT NULL,
    current_attempt_id    INTEGER,
    status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    started_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE,
    FOREIGN KEY (current_attempt_id) REFERENCES cadence_attempts(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lead_cadences_lead ON lead_cadences(lead_id);

  -- Ready messages (quick templates)
  CREATE TABLE IF NOT EXISTS ready_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    image_url   TEXT,
    video_url   TEXT,
    stage_id    INTEGER,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES funnel_stages(id) ON DELETE SET NULL
  );

  -- Qualification sequences (lead scoring questions)
  CREATE TABLE IF NOT EXISTS qualification_sequences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    question    TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_qual_seq_account ON qualification_sequences(account_id, position);

  CREATE TABLE IF NOT EXISTS lead_qualifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL,
    sequence_id     INTEGER NOT NULL,
    answer          TEXT,
    answered_at     TEXT,
    answered_by     INTEGER,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (sequence_id) REFERENCES qualification_sequences(id) ON DELETE CASCADE,
    FOREIGN KEY (answered_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(lead_id, sequence_id)
  );

  -- Launches (product/property listings)
  CREATE TABLE IF NOT EXISTS launches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    title           TEXT NOT NULL,
    identification  TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS launch_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    launch_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_launch_messages_launch ON launch_messages(launch_id, position);
`)

// ─── Schema migrations (add columns safely) ─────────────────────
function addColumnIfNotExists(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[DB] Added column ${table}.${column}`)
  }
}
// whatsapp_instances: qr_code for QR code base64
addColumnIfNotExists('whatsapp_instances', 'qr_code', 'TEXT')
// whatsapp_instances: default attendant for new inbound leads (overrides round-robin when set)
addColumnIfNotExists('whatsapp_instances', 'default_attendant_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
// leads: instance_id to track which WhatsApp number received this lead
addColumnIfNotExists('leads', 'instance_id', 'INTEGER REFERENCES whatsapp_instances(id) ON DELETE SET NULL')
// accounts: Evolution API credentials (shared across all instances)
addColumnIfNotExists('accounts', 'evolution_api_url', 'TEXT')
addColumnIfNotExists('accounts', 'evolution_api_key', 'TEXT')
// cadence_attempts: D+N days from lead creation + scheduled time
addColumnIfNotExists('cadence_attempts', 'delay_days', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('cadence_attempts', 'scheduled_time', 'TEXT')
// cadence_attempts: auto-send message template (for WhatsApp auto)
addColumnIfNotExists('cadence_attempts', 'auto_message', 'TEXT')
// cadence_attempts: schedule mode ('date' = D+N HH:MM, 'duration' = delay_minutes from anchor)
addColumnIfNotExists('cadence_attempts', 'schedule_mode', "TEXT NOT NULL DEFAULT 'date'")
addColumnIfNotExists('cadence_attempts', 'delay_minutes', 'INTEGER NOT NULL DEFAULT 0')
// lead_cadences: track when each attempt was executed/skipped
addColumnIfNotExists('lead_cadences', 'last_executed_at', 'TEXT')
addColumnIfNotExists('lead_cadences', 'last_executed_attempt_id', 'INTEGER')
// leads: WhatsApp profile picture URL (cached, expires periodically)
addColumnIfNotExists('leads', 'profile_pic_url', 'TEXT')
addColumnIfNotExists('leads', 'profile_pic_updated_at', 'TEXT')
// leads: archive flag + unread marker for messages that arrived after archiving
addColumnIfNotExists('leads', 'is_archived', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('leads', 'archived_at', 'TEXT')
addColumnIfNotExists('leads', 'has_new_after_archive', 'INTEGER NOT NULL DEFAULT 0')

// Accounts: extra business fields
addColumnIfNotExists('accounts', 'cnpj', 'TEXT')
addColumnIfNotExists('accounts', 'razao_social', 'TEXT')
addColumnIfNotExists('accounts', 'segmento', 'TEXT')
addColumnIfNotExists('accounts', 'website', 'TEXT')
addColumnIfNotExists('accounts', 'instagram', 'TEXT')
addColumnIfNotExists('accounts', 'whatsapp_comercial', 'TEXT')
addColumnIfNotExists('accounts', 'valor_mensal', 'REAL')
addColumnIfNotExists('accounts', 'contrato_inicio', 'TEXT')
addColumnIfNotExists('accounts', 'cidade', 'TEXT')
addColumnIfNotExists('accounts', 'estado', 'TEXT')
addColumnIfNotExists('accounts', 'observacoes', 'TEXT')
addColumnIfNotExists('accounts', 'trabalha_anuncio', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('accounts', 'investimento_anuncios', 'REAL')

// Leads: extra business fields
addColumnIfNotExists('leads', 'empresa', 'TEXT')
addColumnIfNotExists('leads', 'cpf_cnpj', 'TEXT')
addColumnIfNotExists('leads', 'instagram', 'TEXT')
addColumnIfNotExists('leads', 'trabalha_anuncio', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('leads', 'investimento_anuncios', 'REAL')
// Opt-in/opt-out for WhatsApp broadcasts (Meta compliance)
addColumnIfNotExists('leads', 'opted_in_at', 'TEXT')
addColumnIfNotExists('leads', 'opted_out_at', 'TEXT')
addColumnIfNotExists('leads', 'last_broadcast_at', 'TEXT')

// Broadcasts: message variations (JSON array) + delay between sends
addColumnIfNotExists('broadcasts', 'message_variations', 'TEXT')
addColumnIfNotExists('broadcasts', 'delay_seconds', 'INTEGER NOT NULL DEFAULT 3')

// Standalone tasks (not tied to cadences)
db.exec(`
  CREATE TABLE IF NOT EXISTS standalone_tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    lead_id         INTEGER,
    assigned_to     INTEGER,
    title           TEXT NOT NULL,
    description     TEXT,
    due_datetime    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    created_by      INTEGER,
    completed_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads(id),
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`)

// Seed super_admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@drosagencia.com.br')
if (!adminExists) {
  db.prepare(`
    INSERT INTO users (name, email, password, role, account_id) VALUES (?, ?, ?, 'super_admin', NULL)
  `).run('Dros Admin', 'admin@drosagencia.com.br', bcrypt.hashSync('dros2026', 10))
  console.log('[DB] Super admin created: admin@drosagencia.com.br')
}

console.log('[DB] SQLite ready at', dbPath)

export default db
