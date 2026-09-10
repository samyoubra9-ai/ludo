import { randomBytes } from 'node:crypto'
import { createClient } from 'redis'
import './solana.mjs'

const REDIS_URL = String(process.env.REDIS_URL || '').trim()
const ROOM_PREFIX = 'ludo:room:'
const INDEX_KEY = 'ludo:rooms'
const LOCK_PREFIX = 'ludo:lock:'
const CHANNEL = 'ludo:bus'
const SERVER_ID = process.env.SERVER_ID || process.env.HOSTNAME || randomBytes(4).toString('hex')

const memory = new Map()
const memLocks = new Map()

let client = null
let sub = null

export function redisEnabled() {
  return Boolean(REDIS_URL)
}

export function serverId() {
  return SERVER_ID
}

export async function connectRedis() {
  if (!REDIS_URL || client) return redisEnabled()
  let lastError
  for (let i = 0; i < 10; i += 1) {
    try {
      client = createClient({ url: REDIS_URL })
      client.on('error', (err) => console.error('Redis:', err.message))
      await client.connect()
      sub = client.duplicate()
      sub.on('error', (err) => console.error('Redis sub:', err.message))
      await sub.connect()
      return true
    } catch (error) {
      lastError = error
      client = null
      sub = null
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
  throw lastError
}

function roomKey(code) {
  return ROOM_PREFIX + String(code || '').toUpperCase()
}

function lockKey(code) {
  return LOCK_PREFIX + String(code || '').toUpperCase()
}

function ttlFor(room) {
  if (room?.status === 'ended') return 180
  if (room?.status === 'playing') return 6 * 60 * 60
  return 45 * 60
}

export async function loadRoom(code) {
  const key = String(code || '').toUpperCase()
  if (!key) return null
  if (!client) {
    const room = memory.get(key)
    return room ? room : null
  }
  const raw = await client.get(roomKey(key))
  return raw ? JSON.parse(raw) : null
}

export async function saveRoom(room) {
  const key = String(room.code || '').toUpperCase()
  room.code = key
  if (!client) {
    memory.set(key, room)
    return
  }
  await client.set(roomKey(key), JSON.stringify(room), { EX: ttlFor(room) })
  await client.sAdd(INDEX_KEY, key)
}

export async function createRoomExclusive(room) {
  const key = String(room.code || '').toUpperCase()
  room.code = key
  if (!client) {
    if (memory.has(key)) return false
    memory.set(key, room)
    return true
  }
  const ok = await client.set(roomKey(key), JSON.stringify(room), { NX: true, EX: ttlFor(room) })
  if (ok) await client.sAdd(INDEX_KEY, key)
  return Boolean(ok)
}

export async function deleteRoom(code) {
  const key = String(code || '').toUpperCase()
  if (!client) {
    memory.delete(key)
    return
  }
  await client.del(roomKey(key))
  await client.sRem(INDEX_KEY, key)
}

export async function roomExists(code) {
  const key = String(code || '').toUpperCase()
  if (!client) return memory.has(key)
  return Boolean(await client.exists(roomKey(key)))
}

export async function listRooms() {
  if (!client) return [...memory.values()]
  const codes = await client.sMembers(INDEX_KEY)
  const rooms = []
  for (const code of codes) {
    const room = await loadRoom(code)
    if (room) rooms.push(room)
    else await client.sRem(INDEX_KEY, code)
  }
  return rooms
}

export async function listRoomCodes() {
  if (!client) return [...memory.keys()]
  return client.sMembers(INDEX_KEY)
}

async function acquireMemoryLock(code) {
  const key = String(code || '').toUpperCase()
  const prev = memLocks.get(key) || Promise.resolve()
  let unlock = () => {}
  const next = new Promise((resolve) => {
    unlock = resolve
  })
  const tail = prev.then(() => next)
  memLocks.set(key, tail)
  await prev
  return {
    release: async () => {
      unlock()
      if (memLocks.get(key) === tail) memLocks.delete(key)
    },
  }
}

const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`

export async function acquireLock(code, ttlMs = 4000) {
  if (!client) return acquireMemoryLock(code)
  const token = randomBytes(8).toString('hex')
  const key = lockKey(code)
  for (let i = 0; i < 25; i += 1) {
    const ok = await client.set(key, token, { NX: true, PX: ttlMs })
    if (ok) {
      return {
        release: async () => {
          try {
            await client.eval(UNLOCK_LUA, { keys: [key], arguments: [token] })
          } catch {
            /* expired */
          }
        },
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  return null
}

export async function publishBus(type, payload) {
  if (!client) return
  await client.publish(CHANNEL, JSON.stringify({ from: SERVER_ID, type, payload }))
}

export async function subscribeBus(handler) {
  if (!sub) return
  await sub.subscribe(CHANNEL, (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (!msg || msg.from === SERVER_ID) return
      handler(msg.type, msg.payload)
    } catch {
      /* ignore */
    }
  })
}
