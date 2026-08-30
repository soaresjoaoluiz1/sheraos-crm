# Auditoria Sheraos CRM · Relatório Executivo

**Data:** 30/08/2026
**Escopo:** 6 agentes cobriram correctness, data-integrity, multi-tenant, security, UI/UX, business logic
**Resultado bruto:** 49 findings (22 HIGH, 20 MED, 7 LOW)
**Tokens gastos:** ~885k · Duração: ~19min

---

## 1. Sumário Executivo

O CRM está **funcionando mas com problemas graves de isolamento entre contas e segurança de autenticação**. A boa notícia: o núcleo de envio/recebimento de mensagem, cadências e follow-ups funciona; a Alpha Tintas consegue operar hoje. A má notícia: existem **múltiplos caminhos onde uma conta consegue ler, editar ou apagar dados de outra conta** (Sheraos vê Alpha e vice-versa) e o token de login usa uma senha pública commitada no GitHub, ou seja, qualquer pessoa com acesso ao repo pode forjar um super_admin e entrar como se fosse dono da plataforma.

**Recomendação principal:** parar novos features por 3-5 dias e rodar um sprint de fechamento de brechas na sequência do item 4. Sem isso, uma segunda conta operando junto com a Alpha é risco jurídico (LGPD) e reputacional.

---

## 2. Top 10 Prioridades

### #1 · JWT_SECRET hardcoded no repo (HIGH / security)
- **O que é:** o segredo que assina os tokens de login está escrito no código como fallback (`sheraos-crm-secret-2026`).
- **Por que importa:** qualquer pessoa com acesso ao GitHub Agenciadouc/crm cria um token super_admin em 30 segundos e entra em todas as contas, lê chave Anthropic, chave Evolution, mensagens de clientes.
- **Onde:** `server/middleware/auth.js:3` e `server/index.js:118`
- **Fix:** remover fallback, exigir `process.env.JWT_SECRET`, gerar valor novo aleatório na VPS e rotacionar.
- **Esforço:** trivial (5 min)

### #2 · Chave Evolution API padrão hardcoded (HIGH / security)
- **O que é:** `DEFAULT_EVOLUTION_API_KEY = 'sheraos-evo-key-2026'` aplicada em toda conta.
- **Por que importa:** com essa chave alguém controla todas as instâncias WhatsApp da plataforma.
- **Onde:** `server/db.js:384`
- **Fix:** remover fallback, exigir env var, rotacionar chave na VPS.
- **Esforço:** trivial (10 min)

### #3 · Bug do lead fantasma continua ATIVO (HIGH / correctness)
- **O que é:** o commit 7b0dbc4 corrigiu SÓ METADE. O outro trecho ainda usa `senderPn` do owner sem checar `fromMe`, e o polling backup no scheduler faz igual.
- **Por que importa:** respostas do atendente do celular AINDA somem da conversa real e vão pro lead fantasma. Continua rolando em produção agora.
- **Onde:** `server/routes/webhooks.js:370` e `server/scheduler.js:190`
- **Fix:** trocar `if (senderPn)` por `if (senderPn && !fromMe)` nos dois arquivos.
- **Esforço:** trivial (15 min os dois)

### #4 · Leaks multi-tenant em rotas de lead (HIGH / multi-tenant)
- **O que é:** 6 endpoints de `/api/leads` não filtram por `account_id`.
- **Por que importa:** gerente da Alpha faz `PUT /leads/45/assign` e sequestra lead da Sheraos. Violação LGPD direta.
- **Onde:** `server/routes/leads.js:424, 483, 531, 555, 602, 677`
- **Fix:** adicionar `if (lead.account_id !== req.accountId) return 403` após cada SELECT.
- **Esforço:** rápido (2h + teste manual)

### #5 · Leaks multi-tenant em mensagens (HIGH / multi-tenant + security)
- **O que é:** `POST /messages/:leadId` e `GET /messages/:leadId/media/:msgId` não checam conta.
- **Por que importa:** gerente da Alpha manda mensagem pelo WhatsApp da Sheraos e baixa mídia privada de clientes da Sheraos.
- **Onde:** `server/routes/messages.js:85, 169`
- **Fix:** checagem de account_id antes do envio/leitura.
- **Esforço:** trivial (30 min)

### #6 · Broadcasts, funnels e cadences sem filtro de conta (HIGH / multi-tenant)
- **O que é:** `POST /broadcasts/:id/send` dispara campanha alheia. `PUT /funnels/:id/stages` deleta stage_history global. `PUT /cadences/:id` reescreve cadência de outra conta.
- **Por que importa:** gerente irritado dispara 500 disparos da Sheraos, ou apaga funil da Alpha.
- **Onde:** `broadcasts.js:123, 295, 384`, `funnels.js:47`, `cadences.js:46`
- **Fix:** `AND account_id = ?` em SELECT/UPDATE/DELETE.
- **Esforço:** rápido (3h com testes)

### #7 · XSS armazenado na proposta pública (HIGH / security)
- **O que é:** nome do cliente injetado no HTML sem escape.
- **Por que importa:** proposta enviada pro prospect com nome `<script>` rouba cookie de quem abre. Phishing no domínio sheraos.com.br.
- **Onde:** `server/routes/proposals.js:67`
- **Fix:** copiar `escapeHtml()` de `contracts.js:107` e aplicar.
- **Esforço:** trivial (10 min)

### #8 · Roleta atribui lead a usuário inativo (HIGH / business logic)
- **O que é:** roleta só valida `is_active` quando `excludeBots=true`, mas webhook não passa flag.
- **Por que importa:** leads reais caem em atendente desativado, handoff silencia, ninguém sabe. Alpha perde vendas sem alarme.
- **Onde:** `server/services/roulette.js:18` + `server/routes/webhooks.js:115`
- **Fix:** sempre validar `is_active` em `isUserOk`.
- **Esforço:** trivial (15 min)

### #9 · executeHandoff trava lead sem atendente (HIGH / business logic)
- **O que é:** quando roleta não acha ninguém, marca `ai_handed_off_at` mesmo assim. Bot para de responder, humano não atribuído, lead fica mudo.
- **Por que importa:** buraco negro. Cliente escreve, ninguém responde.
- **Onde:** `server/services/aiAgent.js:305`
- **Fix:** mover marcação pra dentro do `if(targetUserId)`, criar alerta se handoff falhar.
- **Esforço:** trivial (20 min)

### #10 · Cores hardcoded quebram tema claro (HIGH / UI-UX)
- **O que é:** ~15 lugares com `#C8C4D4`, `#E8E4F0` fixos. Contraste 1.1:1 no light (WCAG falha).
- **Por que importa:** gestor da Alpha usa light? Anotações do lead somem da tela sem aviso.
- **Onde:** `LeadDetail.tsx:306`, `Cadences.tsx:113`, `Integrations.tsx:938` e outros (`grep -rn "#C8C4D4" src/`)
- **Fix:** replace por `var(--text-secondary)` e `var(--bg-hover)`.
- **Esforço:** rápido (1h)

---

## 3. Achados por Dimensão (fora do Top 10)

### Correctness
- **Transfer-requests aceitas cross-tenant** (leads.js:380) - MED
- **`hasInbound` sem escopo de instância** (leadHandoff.js:501) - LOW

### Multi-tenant (resto)
- Tarefas standalone (tasks.js:377) - MED
- Ready messages (ready-messages.js:34) - MED
- Launches (launches.js:36) - MED
- Qualifications (qualifications.js:29) - MED
- Webhook /sheets aceita user com account_id NULL (webhooks.js:1042) - LOW
- broadcastSSE joga user sem account_id no bucket 'admin' e recebe eventos de todas as contas (sse.js:17) - LOW

### Security (resto)
- **GET /accounts/:id** devolve `evolution_api_key`, `anthropic_api_key`, `meta_capi_token` em plaintext pra qualquer atendente (accounts.js:58) - MED
- **Webhook Evolution** aceita request sem secret quando não configurado (webhooks.js:188) - MED
- **fetch pro Meta Graph** sem timeout (webhooks.js:702) - MED

### Business Logic (resto)
- Meta Lead sem dedup por `leadgen_id` (webhooks.js:718) - MED
- notifyAndOpenLead TOCTOU (leadHandoff.js:501) - MED
- PUT /users não reatribui leads quando desativa atendente (users.js:74) - MED
- Follow-up não atômico (followUpSender.js:124) - MED
- getOrCreateLead não atômico, falta UNIQUE em `(account_id, phone)` (webhooks.js:50) - MED
- Polling sem `phoneCompareKey` (scheduler.js:226) - MED

### UI-UX (resto)
- **Desconectar WhatsApp sem confirm** (Integrations.tsx:224) - HIGH
- **Deletar cadência sem confirm** (Cadences.tsx:86) - HIGH
- **Botão "Criar Lead" sem disabled** (Leads.tsx:342) - HIGH
- Nome truncado sem tooltip (Chat.tsx:1006) - MED
- Modal "Novo Atendente" sem loading nem toast (Team.tsx:124) - MED
- Input de busca sem aria-label - LOW

---

## 4. Sequência Recomendada de Fixes

### Hoje (bloqueio total, ~4h)
1. Trocar JWT_SECRET e EVOLUTION_API_KEY (#1, #2)
2. Completar bug do lead fantasma nos dois arquivos (#3)
3. Corrigir XSS da proposta (#7)
4. Adicionar confirm em "Desconectar WhatsApp" e "Deletar cadência" (UX HIGH)

### Esta semana (sprint 3 dias)
5. Sprint multi-tenant: `WHERE account_id = ?` em todas as rotas listadas (#4, #5, #6 + resto MED)
6. Corrigir roleta + executeHandoff (#8, #9)
7. Consertar cores hardcoded (#10)

### Este mês
8. Dedup Meta Lead + UNIQUE em `(account_id, phone)`
9. Reassignment de leads quando desativa atendente
10. Loading states, toasts e confirms
11. Redigir chaves sensíveis em GET /accounts/:id
12. Suite E2E multi-tenant

---

## 5. Nota Final, Limitações da Auditoria

Auditoria estática (leitura de código, sem carga real). NÃO coberto:
- Performance sob carga real
- Integridade do banco em produção agora (queries reais)
- Backup e recovery
- Fluxo de billing (se existe)
- Compliance LGPD formal (processo, DPO, política de retenção)
- Testes existentes (não rodei)

Recomendo, após o sprint desta semana, uma segunda auditoria focada em performance + integridade em produção com queries reais.
