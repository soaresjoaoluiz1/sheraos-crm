# Sheraos CRM · Runbook Operacional

Guia rápido pra intervenção em produção. Cenários mais comuns primeiro.

**Infra:** Docker Compose na VPS Locaweb (`sheraos-locaweb`), path `/opt/sheraos-crm`.
**URL:** https://sheraos.com.br/crm
**Containers:** `sheraos-crm-app` (Node/React), `sheraos-evolution-api`, `sheraos-evolution-postgres`

---

## 1. Deploy padrão (após commit no repo)

```bash
ssh sheraos-locaweb
cd /opt/sheraos-crm
git pull origin main
docker compose up -d --build crm
# Aguarda ~30s até "healthy"
docker ps --filter name=sheraos-crm-app
# Confere health endpoint
docker exec sheraos-crm-app node -e "require('http').get('http://localhost:3002/api/health', r => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>console.log(r.statusCode, b)) })"
```

**Nunca rode `docker compose up` sem `.env`.** Existe symlink `.env → .env.production` na VPS. Se sumir, recria: `ln -sf .env.production .env`.

---

## 2. Container app zumbi (fica "Up" mas não responde)

**Sintoma:** `curl https://sheraos.com.br/crm/api/health` retorna 502, mas `docker ps` mostra `Up`.

**Ação:**
```bash
ssh sheraos-locaweb
docker logs sheraos-crm-app --tail 200 | tail -50   # ver últimos erros
docker restart sheraos-crm-app                       # restart hot (5s)
sleep 15 && docker ps --filter name=sheraos-crm-app  # confere healthy
```

Se voltar `unhealthy`: precisa investigar logs. Se persistir, ver seção **Restore de backup**.

---

## 3. WhatsApp desconectou / QR não gera

**Sintoma:** cliente clica "Conectar" no CRM e fica em loop de "aguardando QR".

**Diagnóstico:**
```bash
ssh sheraos-locaweb
# 1. Evolution API tá up?
docker ps --filter name=sheraos-evolution-api
# 2. Evolution responde?
docker exec sheraos-crm-app node -e "require('http').get('http://evolution:8080/', r => console.log(r.statusCode))"
# 3. Se ambos ok, listar instâncias no Evolution
API_KEY=$(docker exec sheraos-crm-app env | grep ^EVOLUTION_API_KEY= | cut -d= -f2)
docker exec sheraos-evolution-api wget -q -O- --header="apikey: $API_KEY" http://localhost:8080/instance/fetchInstances | head -c 500
```

**Se instância existe no CRM mas não no Evolution** (órfã), cria manualmente:
```bash
docker exec sheraos-evolution-api wget -q -O- \
  --header="apikey: $API_KEY" \
  --header="Content-Type: application/json" \
  --post-data='{"instanceName":"NOME_DA_INSTANCIA","integration":"WHATSAPP-BAILEYS","qrcode":true,"webhook":{"url":"https://sheraos.com.br/crm/api/webhooks/evolution/SLUG_DA_CONTA","events":["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE","CONTACTS_UPSERT","CHATS_UPSERT"]}}' \
  http://localhost:8080/instance/create
```

Depois cliente clica "Conectar" no CRM que o QR aparece.

---

## 4. Msg não chegou no chat (cliente reclama)

**Diagnóstico:**
```bash
ssh sheraos-locaweb
# Logs webhook — procura por descarte
docker logs sheraos-crm-app --tail 500 2>&1 | grep -i "Msg ignorada\|Msg orfa\|Dedup por UNIQUE" | tail -20
# Dead-letter table
docker exec -e NODE_PATH=/app/node_modules sheraos-crm-app node -e "
const db = require('better-sqlite3')('/app/server/data/crm.db');
console.log(db.prepare('SELECT id, received_at, reason, remote_jid, push_name FROM messages_orphan ORDER BY id DESC LIMIT 10').all());"
```

Se `messages_orphan` crescendo → bug latente pra investigar.

---

## 5. Restore de backup (desastre total)

**Backups em:** `/root/backups/crm/` (rotação 30 dias, cron 3AM)

```bash
ssh sheraos-locaweb
# Escolhe backup (por data)
ls -lh /root/backups/crm/crm-*.db
BACKUP=/root/backups/crm/crm-20260830-1931.db   # ajusta
# Para o CRM
docker stop sheraos-crm-app
# Copia sobre o volume
docker run --rm -v sheraos-crm-data:/data -v /root/backups/crm:/backup alpine cp /backup/$(basename $BACKUP) /data/crm.db
# Reinicia
docker compose up -d crm
# Aguarda healthy
sleep 20 && docker ps --filter name=sheraos-crm-app
```

**Se Evolution PostgreSQL foi perdido (instâncias WA desconfiguradas):**
```bash
docker stop sheraos-evolution-api sheraos-evolution-postgres
docker run --rm -v sheraos-evo-pg:/data -v /root/backups/crm:/backup alpine sh -c "cd /data && tar xzf /backup/evo-pg-YYYYMMDD-HHMM.tar.gz --strip-components=1"
docker compose up -d
```

---

## 6. Rotação de JWT_SECRET ou EVOLUTION_API_KEY

**JWT (invalida todas as sessões, todo mundo loga de novo):**
```bash
NEW=$(openssl rand -hex 32)
ssh sheraos-locaweb "sed -i 's/^JWT_SECRET=.*/JWT_SECRET=$NEW/' /opt/sheraos-crm/.env.production && cd /opt/sheraos-crm && docker compose restart crm"
```

**Evolution API Key (todas as contas recebem a chave nova via self-heal):**
```bash
NEW=$(openssl rand -hex 32)
ssh sheraos-locaweb "sed -i 's/^EVOLUTION_API_KEY=.*/EVOLUTION_API_KEY=$NEW/' /opt/sheraos-crm/.env.production && cd /opt/sheraos-crm && docker compose restart"
# Todas as contas serão atualizadas na inicialização (self-heal em db.js)
```

---

## 7. Multi-tenant: gerente reclama que "sumiu" broadcast/cadência/lead

Provavelmente ele tá logado na conta errada. Confirma:
```bash
docker exec -e NODE_PATH=/app/node_modules sheraos-crm-app node -e "
const db = require('better-sqlite3')('/app/server/data/crm.db');
console.log('accounts:', db.prepare('SELECT id, name, slug FROM accounts').all());"
```

Cada usuário só vê recursos da própria `account_id`. Super_admin pode passar `?account_id=X` na URL pra scopar.

---

## 8. Merge de leads duplicados

Se `phoneCompareKey` (últimos 10 dig) bate entre 2 leads na mesma conta:
```bash
# Detecta
docker exec -e NODE_PATH=/app/node_modules sheraos-crm-app node /tmp/check_leads_dup.js
```

Script de merge (`_backups/merge_leads.js` template): manter o mais antigo/ativo, mover FKs (messages/tags/notes/assignments/history), deletar o outro. **SEMPRE em transaction + backup antes.**

---

## 9. Escalada de performance (>1000 leads/dia)

- Polling atual: 5min (era 30s antes da FASE 2). Se ainda gargalar, refatorar pra batch `WHERE wa_msg_id IN(...)`.
- `broadcastSSE`: já tem try/catch por cliente + heartbeat 25s.
- `GET /leads` e `GET /messages`: clamp em `?limit=200` (evita DoS).

Se performance degradar mesmo assim: migrar SQLite pra PostgreSQL. Requer refactor de queries (SQLite `datetime()` != Postgres, better-sqlite3 → pg).

---

## 10. Números de emergência

- **Repositório:** github.com/soaresjoaoluiz1/sheraos-crm
- **Tag pré-sprint segurança:** `pre-sprint-security-2026-08-30` (rollback: `git reset --hard <tag>`)
- **Auditoria completa:** `AUDITORIA-2026-08-30.md` e `AUDITORIA2-2026-08-30.md`
- **Health endpoint:** https://sheraos.com.br/crm/api/health
- **Dono:** João Luiz Soares (agenciadouc@gmail.com)
