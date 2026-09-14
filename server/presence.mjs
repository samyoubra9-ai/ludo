import { db } from './db.mjs'

export const ONLINE_MS = 45_000
const TOUCH_EVERY_MS = 8_000
const touched = new Map()

export async function touchPresence(address) {
  const id = String(address || '').toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(id)) return
  const now = Date.now()
  const prev = touched.get(id) || 0
  if (now - prev < TOUCH_EVERY_MS) return
  touched.set(id, now)
  if (touched.size > 4000) {
    for (const [key, at] of touched) {
      if (now - at > ONLINE_MS * 2) touched.delete(key)
    }
  }
  await db.prepare('UPDATE wallets SET last_seen = ? WHERE address = ?').run(now, id)
}

export async function countOnline() {
  const row = await db
    .prepare('SELECT COUNT(*)::int AS n FROM wallets WHERE COALESCE(last_seen, 0) > ?')
    .get(Date.now() - ONLINE_MS)
  return row?.n || 0
}
