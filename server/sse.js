// SSE client management — shared between index.js and route files
const sseClients = new Map() // accountId -> Set<res>

export function addSSEClient(accountId, res) {
  if (!sseClients.has(accountId)) sseClients.set(accountId, new Set())
  sseClients.get(accountId).add(res)
}

export function removeSSEClient(accountId, res) {
  sseClients.get(accountId)?.delete(res)
}

// FASE 2 (fix broadcastSSE) — cada write em try/catch INDIVIDUAL: cliente zumbi (conexao morta)
// nao aborta o broadcast pros outros. Cliente com erro eh removido do Set automaticamente.
export function broadcastSSE(accountId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const send = (clients) => {
    if (!clients) return
    for (const client of clients) {
      try {
        client.write(payload)
      } catch (e) {
        // Cliente zumbi (socket morto, tela fechada, timeout de proxy). Remove do Set.
        clients.delete(client)
      }
    }
  }
  send(sseClients.get(accountId))
  send(sseClients.get('admin'))
}

// FASE 2 (heartbeat SSE) — envia comentario ':heartbeat' a cada 25s pra manter conexao viva
// contra proxies com idle timeout (Traefik corta em 60s de silencio). Roda 1 timer global.
setInterval(() => {
  const beat = ':heartbeat\n\n'
  for (const [, clients] of sseClients) {
    for (const client of clients) {
      try { client.write(beat) } catch { clients.delete(client) }
    }
  }
}, 25 * 1000)
