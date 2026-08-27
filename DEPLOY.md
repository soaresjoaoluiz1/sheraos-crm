# Deploy — Sheraos CRM

## Infra

- **VPS:** Locaweb (191.252.219.218 · hostname `sheraos-vps`)
- **OS:** Ubuntu 24.04
- **Proxy reverso:** Traefik (rede `web`, external)
- **Path do repo:** `/opt/sheraos-crm`
- **Alias SSH local:** `sheraos-locaweb` (chave `id_ed25519_locaweb`)
- **URL:** https://sheraos.com.br/crm

## Containers

| Container | Serviço | Porta | Notas |
|-----------|---------|-------|-------|
| `sheraos-crm-app` | CRM Node/React | 3002 (interna) | Servido pelo Traefik em `sheraos.com.br/crm` |
| `sheraos-evolution-api` | Evolution API (WhatsApp) | 8080 (interna) | Não exposto pra fora, só CRM acessa |
| `sheraos-evolution-postgres` | Postgres da Evolution | 5432 (interna) | Volume persistente `sheraos-evo-pg` |

## Variáveis de ambiente

Arquivo: **`/opt/sheraos-crm/.env.production`** (chmod 600, root:root)

O `docker-compose.yml` tem `env_file: - .env.production` em cada serviço — as vars são carregadas automaticamente, **não depende de flag na linha de comando**.

Variáveis obrigatórias listadas em `.env.production.example`.

## Comandos por tipo de mudança

### 1. Frontend/backend (qualquer .tsx/.ts/.css/.js em src ou server)

```bash
ssh sheraos-locaweb
cd /opt/sheraos-crm
git pull origin main
docker compose up -d --build crm
```

O build do frontend acontece dentro do Dockerfile (multi-stage). Não precisa `npm install` local.

### 2. Rebuild sem mudança (ex: aplicar env novo)

```bash
docker compose up -d
```

### 3. Reset do container CRM (não perde dados)

```bash
docker compose restart crm
```

### 4. Restart completo de tudo (Evolution + Postgres + CRM)

```bash
docker compose down && docker compose up -d
```

Volumes persistem, banco não é perdido.

### 5. Ver logs

```bash
docker logs sheraos-crm-app --tail 100 -f
docker logs sheraos-evolution-api --tail 100 -f
docker logs sheraos-evolution-postgres --tail 100 -f
```

## Regras críticas (LER ANTES DE DEPLOY)

### 1. NUNCA rodar `docker compose up` sem env

O `docker-compose.yml` tem `env_file: .env.production` desde `commit 8xxx` (ago/2026). Isso garante que env vars são sempre carregadas.

**Se por algum motivo você rodar em outro diretório ou remover o env_file:** use `docker compose --env-file .env.production up -d`. Rodar sem env vazia `JWT_SECRET`, `EVOLUTION_API_KEY`, `EVO_DB_PASSWORD` e derruba a autenticação Evolution ↔ Postgres.

**Sintoma quando isso acontece:**
- Evolution API entra em restart-loop
- Logs: `Error: P1000: Authentication failed against database server`
- CRM logs: `Evolution API is DOWN`, `getaddrinfo EAI_AGAIN evolution`
- Frontend: WhatsApp não gera QR

### 2. NÃO recriar o volume `sheraos-evo-pg`

O Postgres foi inicializado em 30/07/2026 com a senha de `EVO_DB_PASSWORD`. Recriar o volume perde todas as instâncias Evolution (com histórico de mensagens).

Se PRECISAR recriar (só em último caso):
```bash
docker compose down
docker volume rm sheraos-evo-pg
docker compose up -d
# Instâncias antigas somem, precisa recriar via API/UI e reconectar
```

### 3. Instância Evolution órfã (existe no CRM, não existe no Evolution)

Sintoma: usuário clica "Conectar" no CRM, aparece "aguardando QR" e cai. Logs mostram `The "XXX" instance does not exist`.

Fix manual (substituir `XXX` pelo nome da instância):
```bash
ssh sheraos-locaweb
API_KEY=$(docker exec sheraos-crm-app env | grep ^EVOLUTION_API_KEY= | cut -d= -f2)
docker exec sheraos-evolution-api wget -q -O- \
  --header="apikey: $API_KEY" \
  --header="Content-Type: application/json" \
  --post-data='{"instanceName":"XXX","integration":"WHATSAPP-BAILEYS","qrcode":true,"webhook":{"url":"https://sheraos.com.br/crm/api/webhooks/evolution/SLUG-CONTA","events":["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE","CONTACTS_UPSERT","CHATS_UPSERT"]}}' \
  http://localhost:8080/instance/create
```

Depois de criar, o usuário clica "Conectar" no CRM e o QR aparece.

## Webhook WhatsApp (Evolution)

Cada conta do CRM tem seu webhook: `https://sheraos.com.br/crm/api/webhooks/evolution/{slug-conta}`

## Constraints (Node 20 + Debian slim)

Runtime moderna, sem restrições legadas. Versões atuais podem ser upgradadas normalmente.

## Troubleshooting rápido

| Sintoma | Causa provável | Fix |
|---------|----------------|-----|
| CRM 502 no navegador | Container `sheraos-crm-app` down | `docker compose restart crm` |
| Frontend velho após deploy | Cache do navegador | Ctrl+F5 (não é bug servidor) |
| WhatsApp não conecta, QR não vem | Instância não existe no Evolution OU env vazio | Ver seções acima |
| Chat travado com "Loading..." | Polling batendo com erro no Evolution | Ver logs Evolution primeiro |
| Todos os leads sumiram | Volume `sheraos-crm-data` corrompido | Verificar backup antes de restart |

## Contato / dono

**Dono:** João Luiz Soares (agenciadouc@gmail.com)
**Projeto pai:** Dros CRM (sync workflow em `reference_sheraos_sync_workflow.md`)
