# Dros CRM

CRM da Agência DROS. Captação e qualificação de leads, pipeline de vendas, atendimento via WhatsApp (Evolution API), broadcasts, cadências automáticas.

**Repo:** https://github.com/soaresjoaoluiz1/crm
**URL produção:** https://drosagencia.com.br/crm

## Stack

- **Backend:** Node 16 + Express 4 + SQLite (better-sqlite3) + JWT
- **Frontend:** React 19 + Vite 4 + TypeScript (base path `/crm/`)
- **Realtime:** Server-Sent Events (SSE)
- **WhatsApp:** Evolution API via webhook
- **Scheduler:** cron interno (cadências, broadcasts, status)

## Rodar local

```bash
npm install
cp .env.example .env       # ajusta JWT_SECRET e tokens Meta se for testar webhook
npm run dev                # sobe backend + frontend juntos
```

Backend escuta em `http://localhost:3002`. Frontend em `http://localhost:5173/crm/` (Vite).

## Build de produção

Diferente do Hub e do Painel Performance, o **CRM builda na VPS** (não local). O `dist/` está no .gitignore. Ver [DEPLOY.md](DEPLOY.md) pros comandos.

## Deploy

Ver [DEPLOY.md](DEPLOY.md) — caminho na VPS, processo PM2, comandos por tipo de mudança, constraints de versão.

## Arquitetura e convenções

Detalhes sobre multi-tenancy, integrações Evolution/Meta e constraints de versão em [CLAUDE.md](CLAUDE.md).
