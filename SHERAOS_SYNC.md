# Sync workflow Sheraos CRM

Este repo (`soaresjoaoluiz1/sheraos-crm`) é um fork de `soaresjoaoluiz1/crm` (Dros CRM).
Toda atualização do código vem do upstream Dros + customizações Sheraos reaplicadas via script.

## Regra de ouro

- **NUNCA** editar `soaresjoaoluiz1/crm` por aqui
- **NUNCA** editar `drosagencia.com.br/crm` (a Dros em produção)
- Customizações Sheraos vivem dentro de `scripts/apply-sheraos-branding.sh`
- Editar arquivo direto perde-se na próxima sync. Editar o **script** que reaplica é o jeito certo.

## Setup inicial (uma vez por máquina/VPS)

```bash
cd /opt/sheraos-crm
git remote add upstream git@github.com:soaresjoaoluiz1/crm.git
git fetch upstream
```

## Workflow diário (quando upstream Dros atualizar)

```bash
cd /opt/sheraos-crm
git fetch upstream main
git reset --hard upstream/main            # pega tudo do Dros (DESTRUTIVO local)
bash scripts/apply-sheraos-branding.sh    # reaplica customizações Sheraos
git add -A
git commit -m "sync: upstream @ $(git rev-parse --short upstream/main) + branding"
git push origin main --force-with-lease   # nosso fork avança junto
docker compose build crm
docker compose up -d crm
```

## Workflow só Sheraos (mexeu só em customização local)

```bash
cd /opt/sheraos-crm
# edita scripts/apply-sheraos-branding.sh (adicionando nova substituição)
bash scripts/apply-sheraos-branding.sh
git add -A && git commit -m "branding: <descrição>"
git push origin main
docker compose build crm && docker compose up -d crm
```

## Adicionar nova customização

Se o upstream lançar um arquivo novo com "Dros" hardcoded:

1. Adicionar bloco no `scripts/apply-sheraos-branding.sh` com o `sed` apropriado
2. Adicionar o pattern na seção de "Verificação" no fim do script
3. Commit + push

## Quando o sed quebrar (upstream renomeou arquivo)

O script é `set -uo pipefail`, então erros aparecem. Possibilidades:
- Arquivo deletado pelo upstream → guard com `[ -f path ] && sed ...`
- Texto mudou no upstream → ajustar pattern do sed
- Caractere especial no replacement (`|`, `&`, etc.) → trocar delimitador do sed (`s~old~new~g` ou `s#old#new#g`)

## Conferir se branding tá íntegro

```bash
bash scripts/apply-sheraos-branding.sh   # roda, dá "OK, zero refs Dros" no fim
```

Idempotente: rodar 2x ou 200x dá o mesmo resultado.
