import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, initDb, pingDb, sql } from './db.mjs'
import {
  activeRoomFor,
  createRoom,
  getRoom,
  joinRoom,
  matchmake,
  leaveRoom,
  roomPick,
  roomBet,
  roomPeek,
  roomCover,
  roomNext,
  roomRebuy,
  roomOffer,
  roomBuy,
  roomCancelOffer,
  snapshot,
  startRoom,
  startRoomJanitor,
  touchSeat,
} from './rooms.mjs'
import { allowOrigin, PORT, PUBLIC_URL, publicUrls, telegramBotUsername } from './config.mjs'
import { attachRealtime } from './realtime.mjs'
import { attachBus } from './bus.mjs'
import { connectRedis, redisEnabled } from './redis.mjs'
import { handleDesk } from './desk.mjs'
import { touchPresence } from './presence.mjs'
import { startTelegramBot } from './telegram.mjs'

const PEPPER = process.env.LUDO_PEPPER || 'ludo-dev-pepper'
const STARTING = 0
const SESSION_MS = 1000 * 60 * 60 * 24 * 30

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function nowIso() {
  return new Date().toISOString()
}

function hashToken(loginToken) {
  return sha256(`${PEPPER}:${loginToken}`)
}

function json(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  })
  res.end(data)
}

function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('Requête trop lourde.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('JSON invalide'))
      }
    })
    req.on('error', reject)
  })
}

function validAddress(address) {
  return typeof address === 'string' && /^0x[a-f0-9]{40}$/.test(address)
}

function bearer(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

async function getWallet(address) {
  return sql('SELECT address, coins FROM wallets WHERE address = ?').get(address)
}

async function authWallet(req) {
  const token = bearer(req)
  if (!token) return null
  const session = await sql('SELECT address, expires_at FROM sessions WHERE token = ?').get(token)
  if (!session || session.expires_at < Date.now()) return null
  const wallet = await getWallet(session.address)
  if (wallet) await touchPresence(wallet.address)
  return wallet
}

async function withDesk(wallet) {
  if (!wallet) return wallet
  const tagged = await sql(
    `SELECT a.name AS kiosk_name
     FROM wallets w
     LEFT JOIN agents a ON a.id = w.kiosk_id
     WHERE w.address = ?`,
  ).get(wallet.address)
  return {
    ...wallet,
    refilled: false,
    kioskName: tagged?.kiosk_name || null,
  }
}

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (!existsSync(dist)) return false
  const path = pathOf(req)
  if (path.startsWith('/api') || path === '/ws') return false
  let rel = path === '/' ? 'index.html' : path.replace(/^\//, '')
  if (rel.includes('..')) return false
  let file = join(dist, rel)
  if (!file.startsWith(dist)) return false
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html')
  if (!existsSync(file)) return false
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=86400',
  })
  createReadStream(file).pipe(res)
  return true
}

function pathOf(req) {
  return (req.url || '/').split('?')[0]
}

function roomCodeFrom(url) {
  const path = String(url || '/').split('?')[0]
  const match = path.match(/^\/api\/rooms\/([A-Z0-9]{4})(?:\/([a-z]+))?$/)
  return match ? { code: match[1], action: match[2] || '' } : null
}

function queryRev(req) {
  const raw = String(req.url || '')
  const q = raw.indexOf('?')
  if (q < 0) return -1
  const value = new URLSearchParams(raw.slice(q + 1)).get('rev')
  const n = Number(value)
  return Number.isInteger(n) ? n : -1
}

async function sendRoom(res, room, address, extra = {}) {
  if (!room) {
    json(res, 404, { error: 'Salle introuvable.' })
    return
  }
  json(res, 200, { ...await snapshot(room, address, extra.snapshotOpts), ...extra.payload })
}

function fail(res, error) {
  json(res, error.status || 400, { error: error.message })
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || ''
  if (origin && allowOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  } else if (!PUBLIC_URL) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (req.method === 'GET' && pathOf(req) === '/api/health') {
      try {
        await pingDb()
        json(res, 200, {
          ok: true,
          engine: 'postgres',
          rooms: redisEnabled() ? 'redis' : 'memory',
          realtime: 'ws',
          urls: publicUrls(),
        })
      } catch {
        json(res, 503, { ok: false, engine: 'postgres', error: 'base indisponible' })
      }
      return
    }

    if (req.method === 'GET' && pathOf(req) === '/api/lan') {
      json(res, 200, { urls: publicUrls() })
      return
    }

    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const body = await readBody(req)
      const { address, loginToken } = body
      if (!validAddress(address) || typeof loginToken !== 'string' || loginToken.length < 32) {
        json(res, 400, { error: 'Identifiants invalides.' })
        return
      }

      const tokenHash = hashToken(loginToken)
      const existing = await db.prepare('SELECT address, token_hash, coins FROM wallets WHERE address = ?').get(address)

      if (!existing) {
        await db
          .prepare('INSERT INTO wallets (address, token_hash, coins, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(address, tokenHash, STARTING, nowIso(), nowIso())
      } else {
        const a = Buffer.from(existing.token_hash, 'hex')
        const b = Buffer.from(tokenHash, 'hex')
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          json(res, 401, { error: 'Cette adresse ne correspond pas à ce wallet.' })
          return
        }
      }

      const session = randomBytes(32).toString('hex')
      await db
        .prepare('INSERT INTO sessions (token, address, expires_at) VALUES (?, ?, ?)')
        .run(session, address, Date.now() + SESSION_MS)
      await touchPresence(address)
      const wallet = await withDesk(await getWallet(address))
      json(res, 200, {
        token: session,
        address: wallet.address,
        coins: wallet.coins,
        refilled: wallet.refilled,
        kioskName: wallet.kioskName,
        telegramBot: telegramBotUsername(),
      })
      return
    }

    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      const token = bearer(req)
      if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
      json(res, 200, { ok: true })
      return
    }

    if (req.method === 'GET' && req.url === '/api/me') {
      const wallet = await authWallet(req)
      if (!wallet) {
        json(res, 401, { error: 'Session expirée.' })
        return
      }
      const next = await withDesk(wallet)
      const playing = await activeRoomFor(wallet.address)
      const youSeat = playing?.seats.find((seat) => seat.address === wallet.address && seat.kind === 'human')
      json(res, 200, {
        ...next,
        playing: playing
          ? { code: playing.code, status: playing.status, leaving: Boolean(youSeat?.quitAt) && !youSeat?.forfeited }
          : null,
        telegramBot: telegramBotUsername(),
      })
      return
    }

    if (req.method === 'POST' && pathOf(req) === '/api/rooms') {
      const wallet = await authWallet(req)
      if (!wallet) {
        json(res, 401, { error: 'Session expirée.' })
        return
      }
      const body = await readBody(req)
      try {
        const room = await createRoom({
          address: wallet.address,
          name: String(body.name || '').slice(0, 16),
          color: body.color,
          count: Number(body.count),
          stake: Number(body.stake),
        })
        await sendRoom(res, room, wallet.address, { payload: { urls: publicUrls() } })
      } catch (error) {
        fail(res, error)
      }
      return
    }

    if (req.method === 'POST' && pathOf(req) === '/api/rooms/match') {
      const wallet = await authWallet(req)
      if (!wallet) {
        json(res, 401, { error: 'Session expirée.' })
        return
      }
      const body = await readBody(req)
      try {
        const room = await matchmake({
          address: wallet.address,
          name: String(body.name || '').slice(0, 16),
          color: body.color,
          count: Number(body.count),
          stake: Number(body.stake),
        })
        await sendRoom(res, room, wallet.address, { payload: { urls: publicUrls() } })
      } catch (error) {
        fail(res, error)
      }
      return
    }

    if (req.method === 'POST' && pathOf(req) === '/api/rooms/join') {
      const wallet = await authWallet(req)
      if (!wallet) {
        json(res, 401, { error: 'Session expirée.' })
        return
      }
      const body = await readBody(req)
      try {
        const room = await joinRoom({
          code: String(body.code || ''),
          address: wallet.address,
          name: String(body.name || '').slice(0, 16),
          color: body.color,
        })
        await sendRoom(res, room, wallet.address, { payload: { urls: publicUrls() } })
      } catch (error) {
        fail(res, error)
      }
      return
    }

    const roomPath = roomCodeFrom(req.url)
    if (roomPath) {
      const wallet = await authWallet(req)
      if (!wallet) {
        json(res, 401, { error: 'Session expirée.' })
        return
      }

      if (req.method === 'GET' && !roomPath.action) {
        let room = await getRoom(roomPath.code)
        if (room) room = (await touchSeat(room.code, wallet.address)) || room
        if (room && queryRev(req) === (room.rev || 0)) {
          json(res, 200, { unchanged: true, rev: room.rev || 0 })
          return
        }
        await sendRoom(res, room, wallet.address)
        return
      }

      if (req.method === 'POST' && roomPath.action === 'start') {
        try {
          await sendRoom(res, await startRoom({ code: roomPath.code, address: wallet.address }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'pick') {
        const body = await readBody(req)
        try {
          await sendRoom(res, await roomPick({
            code: roomPath.code,
            address: wallet.address,
            packetId: body.packetId,
          }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'bet') {
        const body = await readBody(req)
        try {
          await sendRoom(res, await roomBet({
            code: roomPath.code,
            address: wallet.address,
            amount: body.amount,
          }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'peek') {
        try {
          await sendRoom(res, await roomPeek({ code: roomPath.code, address: wallet.address }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'cover') {
        try {
          await sendRoom(res, await roomCover({ code: roomPath.code, address: wallet.address }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'next') {
        try {
          await sendRoom(res, await roomNext({ code: roomPath.code, address: wallet.address }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'offer') {
        const body = await readBody(req)
        try {
          await sendRoom(res, await roomOffer({
            code: roomPath.code,
            address: wallet.address,
            amount: body.amount,
          }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'buy') {
        try {
          await sendRoom(res, await roomBuy({ code: roomPath.code, address: wallet.address }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'keep') {
        try {
          await sendRoom(res, await roomCancelOffer({ code: roomPath.code, address: wallet.address }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'rebuy') {
        try {
          await sendRoom(res, await roomRebuy({ code: roomPath.code, address: wallet.address }), wallet.address)
        } catch (error) {
          fail(res, error)
        }
        return
      }

      if (req.method === 'POST' && roomPath.action === 'leave') {
        const left = await leaveRoom({ code: roomPath.code, address: wallet.address })
        json(res, 200, left ? { ...await snapshot(left, wallet.address), urls: publicUrls() } : { left: true })
        return
      }
    }

    if (await handleDesk(req, res, { json, readBody, pathOf, fail, bearer })) return

    if (serveStatic(req, res)) return
    json(res, 404, { error: 'Route inconnue.' })
  } catch (error) {
    console.error(error)
    json(res, 500, { error: 'Erreur serveur.' })
  }
})

attachRealtime(server)
server.requestTimeout = 20000
server.headersTimeout = 15000
server.keepAliveTimeout = 5000

await initDb()
await connectRedis()
await attachBus()
if (process.env.TELEGRAM_IN_SERVER === '1') {
  await startTelegramBot().catch((error) => {
    console.error('Telegram bot:', error.message)
  })
} else {
  console.log('Telegram : npm run bot')
}

server.listen(PORT, '0.0.0.0', () => {
  startRoomJanitor()
  const urls = publicUrls()
  console.log(`Petit paquet · http://0.0.0.0:${PORT} · PostgreSQL · WebSocket /ws · salles ${redisEnabled() ? 'Redis' : 'mémoire'}`)
  if (urls.length) console.log(`Public : ${urls.join('  ')}`)
  const bot = telegramBotUsername()
  if (bot) console.log(`Recharge : https://t.me/${bot}`)
})
