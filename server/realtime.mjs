import { WebSocketServer } from 'ws'
import { bus } from './bus.mjs'
import { sql } from './db.mjs'
import { getRoom, snapshot, touchSeat } from './rooms.mjs'
import { touchPresence } from './presence.mjs'

const MAX_SOCKETS = 800
const HEARTBEAT_MS = 25000

async function authToken(token) {
  if (!token || typeof token !== 'string') return null
  const session = await sql('SELECT address, expires_at FROM sessions WHERE token = ?').get(token)
  if (!session || session.expires_at < Date.now()) return null
  return session.address
}

function send(ws, payload) {
  if (ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(payload))
  } catch {
    /* drop */
  }
}

async function pushRoom(client) {
  if (!client.code) return
  const room = await getRoom(client.code)
  if (!room) {
    send(client.ws, { type: 'gone', code: client.code })
    return
  }
  send(client.ws, { type: 'room', room: await snapshot(room, client.address) })
}

export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 })
  const clients = new Set()

  function drop(client) {
    clients.delete(client)
    try {
      client.ws.terminate()
    } catch {
      /* already closed */
    }
  }

  wss.on('connection', (ws, req) => {
    if (clients.size >= MAX_SOCKETS) {
      ws.close(1013, 'busy')
      return
    }
    void accept(ws, req)
  })

  async function accept(ws, req) {
    const url = new URL(req.url || '/ws', 'http://localhost')
    const address = await authToken(url.searchParams.get('token') || '')
    if (!address) {
      ws.close(1008, 'auth')
      return
    }

    const client = { ws, address, code: '', alive: true }
    clients.add(client)
    void touchPresence(address)
    send(ws, { type: 'hello', ok: true })

    ws.on('pong', () => {
      client.alive = true
      void touchPresence(client.address)
    })

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (msg?.type === 'ping') {
        void touchPresence(client.address)
        send(ws, { type: 'pong' })
        return
      }
      if (msg?.type === 'watch' && typeof msg.code === 'string') {
        client.code = String(msg.code).toUpperCase().slice(0, 4)
        void (async () => {
          const room = await getRoom(client.code)
          if (room) await touchSeat(client.code, client.address)
          await pushRoom(client)
        })()
      }
    })

    ws.on('close', () => {
      clients.delete(client)
    })
    ws.on('error', () => drop(client))
  }

  bus.on('room:update', (room) => {
    const code = room?.code
    if (!code) return
    for (const client of clients) {
      if (client.code !== code) continue
      void pushRoom(client)
    }
  })

  bus.on('room:gone', (code) => {
    for (const client of clients) {
      if (client.code !== code) continue
      send(client.ws, { type: 'gone', code })
    }
  })

  const beat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        drop(client)
        continue
      }
      client.alive = false
      try {
        client.ws.ping()
      } catch {
        drop(client)
      }
    }
  }, HEARTBEAT_MS)
  beat.unref()

  return wss
}
