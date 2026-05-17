#!/bin/bash
# Sincroniza /opt/sheraos-crm com o upstream soaresjoaoluiz1/crm,
# preserva arquivos so-Sheraos, reaplica branding, commit/push e rebuild Docker.
# Idempotente. Se nao tem nada novo no upstream, sai sem fazer nada.
set -euo pipefail
cd /opt/sheraos-crm

echo ">> sync-from-upstream.sh"

# Arquivos/pastas que existem APENAS no fork Sheraos (preservar no reset)
SHERAOS_ONLY=(
  "scripts"
  "sheraos-assets"
  "SHERAOS_SYNC.md"
  "DEPLOY.md"
  "docker-compose.yml"
  "Dockerfile"
)

# Arquivos do upstream que NUNCA devem entrar no fork (apagar apos reset)
UPSTREAM_BLOCKLIST=(
  ".env.production"
)

# 1. Confere remote upstream
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Configurando remote upstream..."
  git remote add upstream git@github.com:soaresjoaoluiz1/crm.git
fi

# 2. Fetch upstream
echo "Fetching upstream..."
git fetch upstream main

UPSTREAM_SHA=$(git rev-parse upstream/main)
SHORT_SHA=$(git rev-parse --short upstream/main)

# 3. Detecta se ja estamos sincronizados
LAST_SYNC_SHA=$(git log -1 --format=%s | grep -oE 'upstream @ [a-f0-9]+' | awk '{print $3}' || true)
if [ "$LAST_SYNC_SHA" = "$SHORT_SHA" ]; then
  echo ">> Ja sincronizado com upstream @ $SHORT_SHA. Nada a fazer."
  exit 0
fi

echo "Upstream tem novidade:"
echo "  Local: $(git rev-parse --short HEAD)"
echo "  Upstream: $SHORT_SHA"
echo

# 4. Preserva arquivos so-Sheraos antes do reset destrutivo
PRESERVE=/tmp/sheraos-preserve-$$
mkdir -p "$PRESERVE"
echo "Preservando arquivos so-Sheraos em $PRESERVE..."
for path in "${SHERAOS_ONLY[@]}"; do
  if [ -e "$path" ]; then
    # Preserva mantendo estrutura de diretorio se necessario
    target_dir="$PRESERVE/$(dirname "$path")"
    mkdir -p "$target_dir"
    cp -r "$path" "$target_dir/"
    echo "  + $path"
  fi
done

# 5. Hard reset pra upstream
git reset --hard upstream/main

# 6. Restaura arquivos so-Sheraos
echo "Restaurando arquivos so-Sheraos..."
for path in "${SHERAOS_ONLY[@]}"; do
  src="$PRESERVE/$path"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$path")"
    rm -rf "$path"
    cp -r "$src" "$path"
    echo "  + $path"
  fi
done

# 7. Remove arquivos do upstream que nao devem estar no fork
echo "Removendo arquivos blocklisted do upstream..."
for path in "${UPSTREAM_BLOCKLIST[@]}"; do
  if [ -e "$path" ]; then
    rm -f "$path"
    echo "  - $path"
  fi
done

# 8. Limpa preserve dir
rm -rf "$PRESERVE"

# 9. Reaplica branding Sheraos
bash scripts/apply-sheraos-branding.sh

# 10. Commit (se houver diff)
git add -A
if git diff --cached --quiet; then
  echo ">> Sem diff apos sync+branding. Pulando commit."
else
  git commit -m "sync: upstream @ $SHORT_SHA + branding"
fi

# 11. Push pro fork Sheraos
echo "Pushing pra origin/main..."
git push origin main --force-with-lease

# 12. Rebuild e restart Docker
echo "Rebuilding Docker..."
docker compose build crm
docker compose up -d crm

# 13. Health check
sleep 8
echo
echo ">> Logs do container apos restart:"
docker logs sheraos-crm-app --tail 10

echo
echo ">> sync-from-upstream.sh concluido."
echo "   URL: https://sheraos.com.br/crm"
