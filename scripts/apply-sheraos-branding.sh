#!/bin/bash
# Reaplica todas as customizacoes Sheraos por cima do codigo do upstream Dros.
# Idempotente: pode rodar quantas vezes precisar.
# Editar este script eh o jeito CORRETO de adicionar nova customizacao Sheraos.
set -uo pipefail
cd "$(dirname "$0")/.."

echo ">> apply-sheraos-branding.sh"

# === Logo (assets versionados em sheraos-assets/) ===
mkdir -p public
cp -f sheraos-assets/logo-sheraos.png public/logo-sheraos.png
cp -f sheraos-assets/icon-sheraos.png public/icon-sheraos.png
rm -f public/logo-dros.png

# === index.html ===
sed -i 's|/logo-dros.png|/logo-sheraos.png|g' index.html
sed -i 's|<title>Dros CRM</title>|<title>Sheraos CRM</title>|' index.html

# === Login.tsx (logo + h1) ===
if [ -f src/pages/Login.tsx ]; then
  sed -i 's|https://drosagencia.com.br/wp-content/uploads/[^"]*\.png|/logo-sheraos.png|g' src/pages/Login.tsx
  sed -i 's|alt="Dros"|alt="Sheraos"|g' src/pages/Login.tsx
  sed -i 's|<h1>Dros CRM</h1>|<h1>Sheraos CRM</h1>|g' src/pages/Login.tsx
fi

# === Onboard.tsx (se existir) ===
if [ -f src/pages/Onboard.tsx ]; then
  sed -i 's|https://drosagencia.com.br/wp-content/uploads/[^"]*\.png|/logo-sheraos.png|g' src/pages/Onboard.tsx
  sed -i 's|alt="Dros"|alt="Sheraos"|g' src/pages/Onboard.tsx
  sed -i 's|<h1>Dros CRM</h1>|<h1>Sheraos CRM</h1>|g' src/pages/Onboard.tsx
fi

# === Sidebar.tsx (logo) ===
if [ -f src/components/Sidebar.tsx ]; then
  sed -i 's|https://drosagencia.com.br/wp-content/uploads/[^"]*\.png|/logo-sheraos.png|g' src/components/Sidebar.tsx
  sed -i 's|alt="Dros"|alt="Sheraos"|g' src/components/Sidebar.tsx
fi

# === localStorage keys (token + session + active_account) ===
FILES_WITH_KEYS=$(grep -rl 'dros_crm_token\|dros_crm_active_account\|dros_crm_session_started' src/ 2>/dev/null || true)
if [ -n "$FILES_WITH_KEYS" ]; then
  echo "$FILES_WITH_KEYS" | xargs sed -i \
    -e 's|dros_crm_token|sheraos_crm_token|g' \
    -e 's|dros_crm_active_account|sheraos_crm_active_account|g' \
    -e 's|dros_crm_session_started|sheraos_crm_session_started|g'
fi

# === AccountContext: conta default ===
# Upstream procura por "Dros | Deivid" pra iniciar sessao. No Sheraos, usa a conta "Sheraos".
if [ -f src/context/AccountContext.tsx ]; then
  python3 - <<'PY'
import pathlib
p = pathlib.Path("src/context/AccountContext.tsx")
s = p.read_text()
s = s.replace("'Dros | Deivid'", "'Sheraos'")
s = s.replace("drosDeivid", "sheraosDefault")
s = s.replace("comeca SEMPRE em Dros | Deivid", "comeca SEMPRE em Sheraos")
p.write_text(s)
PY
fi

# === CSS comment ===
sed -i 's|DROS CRM|SHERAOS CRM|g' src/index.css

# === server/index.js logs + JWT fallback ===
sed -i 's|\[Dros CRM\]|[Sheraos CRM]|g' server/index.js
sed -i 's|\[Dros CRM API\]|[Sheraos CRM API]|g' server/index.js
sed -i "s|'dros-crm-secret-2026'|'sheraos-crm-secret-2026'|g" server/index.js

# === server/middleware/auth.js JWT fallback ===
if [ -f server/middleware/auth.js ]; then
  sed -i "s|'dros-crm-secret-2026'|'sheraos-crm-secret-2026'|g" server/middleware/auth.js
fi

# === server/db.js (Evolution key default + admin seed) ===
# Importante: usar ~ como delimitador no bcrypt porque o replacement contem ||
sed -i "s|'dros-evo-key-2026'|'sheraos-evo-key-2026'|g" server/db.js
sed -i "s~bcrypt.hashSync('dros2026'~bcrypt.hashSync(process.env.INITIAL_ADMIN_PASSWORD || 'sheraos2026'~g" server/db.js
sed -i "s|'Dros Admin'|'Sheraos Admin'|g" server/db.js
sed -i 's|admin@drosagencia.com.br|admin@sheraos.com|g' server/db.js

# === server/routes/webhooks.js META_VERIFY_TOKEN fallback ===
if [ -f server/routes/webhooks.js ]; then
  sed -i 's|dros-crm-verify|sheraos-crm-verify|g' server/routes/webhooks.js
fi

# === Webhook URLs hardcoded: drosagencia.com.br/crm -> sheraos.com.br/crm ===
URL_FILES=$(grep -rl 'https://drosagencia.com.br/crm' src/ server/ 2>/dev/null || true)
if [ -n "$URL_FILES" ]; then
  echo "$URL_FILES" | xargs sed -i 's|https://drosagencia.com.br/crm|https://sheraos.com.br/crm|g'
fi

# === seed.js (script local de seed test data) ===
if [ -f seed.js ]; then
  sed -i 's|admin@drosagencia.com.br|admin@sheraos.com|g' seed.js
  sed -i 's|dros2026|sheraos2026|g' seed.js
fi

# === Cadences exemplos de copy ===
if [ -f src/pages/Cadences.tsx ]; then
  sed -i 's|da Dros|da Sheraos|g' src/pages/Cadences.tsx
fi

# === Clients placeholder ===
if [ -f src/pages/admin/Clients.tsx ]; then
  sed -i 's|Ex: Dros Agencia|Ex: Sheraos|g' src/pages/admin/Clients.tsx
fi

# === package.json ===
sed -i 's|"name": "dros-crm-dashboard"|"name": "sheraos-crm-dashboard"|' package.json

echo ">> Branding Sheraos aplicado"

# === Verificacao ===
echo
echo ">> Verificacao (deve estar tudo vazio):"
REMAINING=$(grep -rln 'dros_crm_token\|dros_crm_active_account\|dros_crm_session_started\|<title>Dros CRM\|<h1>Dros CRM\|drosagencia\.com\.br/crm\|admin@drosagencia\.com\.br\|dros-crm-secret\|dros-evo-key\|dros-crm-verify\|logo-dros\.png' \
  --include='*.tsx' --include='*.ts' --include='*.js' --include='*.html' --include='*.css' --include='*.json' \
  src/ server/ index.html package.json seed.js 2>/dev/null || true)
if [ -n "$REMAINING" ]; then
  echo "ATENCAO: ainda tem refs Dros em:"
  echo "$REMAINING"
  exit 1
fi
echo ">> OK, zero refs Dros nos arquivos cobertos"
