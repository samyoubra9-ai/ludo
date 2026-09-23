import { randomBytes } from 'node:crypto'
import { db, tx } from './db.mjs'
import { GAME_ASSET, GAME_RAKE_BPS, LUDO_PER_USD, STAKES } from './economy.mjs'
import { checkPassword, hashPassword, newSessionToken } from './pass.mjs'
import { PUBLIC_URL, publicUrls } from './config.mjs'
import { isPlaying, liveRoomStats } from './rooms.mjs'
import { countOnline } from './presence.mjs'

const SESSION_MS = 1000 * 60 * 60 * 24 * 30
const ADDR_RE = /^0x[a-f0-9]{40}$/

function nowIso() {
  return new Date().toISOString()
}

function validUser(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9._-]{3,32}$/.test(name.trim())
}

function validPass(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 72
}

function validAddress(address) {
  return typeof address === 'string' && ADDR_RE.test(address.toLowerCase())
}

export async function isActiveAgent(address) {
  const row = await db
    .prepare("SELECT id FROM agents WHERE address = ? AND status = 'active'")
    .get(String(address || '').toLowerCase())
  return Boolean(row)
}

async function adminCount() {
  const row = await db.prepare('SELECT COUNT(*)::int AS n FROM admins').get()
  return row?.n || 0
}

async function authAdmin(token) {
  if (!token) return null
  const row = await db
    .prepare(
      `SELECT a.id, a.username FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now())
  return row || null
}

async function authAgent(token) {
  if (!token) return null
  const row = await db
    .prepare(
      `SELECT ag.id, ag.name, ag.address, ag.status, ag.sell_da, ag.buy_da, w.coins
       FROM agent_sessions s
       JOIN agents ag ON ag.id = s.agent_id
       JOIN wallets w ON w.address = ag.address
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now())
  if (!row || row.status !== 'active') return null
  return row
}

function daFor(coins, rateDa) {
  return Math.floor((Math.max(0, Number(coins)) * Math.max(0, Number(rateDa))) / LUDO_PER_USD)
}

function validRate(value) {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n >= 1 && n <= 999999
}

async function cashStats(agentId, since) {
  let sql = `SELECT
      COALESCE(SUM(da) FILTER (WHERE kind = 'sell'), 0)::int AS cash_in,
      COALESCE(SUM(da) FILTER (WHERE kind = 'buyback'), 0)::int AS cash_out,
      COALESCE(SUM(coins) FILTER (WHERE kind = 'sell'), 0)::int AS sold,
      COALESCE(SUM(coins) FILTER (WHERE kind = 'buyback'), 0)::int AS bought,
      COUNT(*) FILTER (WHERE kind = 'sell')::int AS sell_n,
      COUNT(*) FILTER (WHERE kind = 'buyback')::int AS buy_n
     FROM kiosk_ops WHERE 1=1`
  const params = []
  if (agentId) {
    sql += ' AND agent_id = ?'
    params.push(agentId)
  }
  if (since) {
    sql += ' AND created_at >= ?'
    params.push(since)
  }
  const row = await db.prepare(sql).get(...params)
  return {
    cashIn: row?.cash_in || 0,
    cashOut: row?.cash_out || 0,
    profit: (row?.cash_in || 0) - (row?.cash_out || 0),
    sold: row?.sold || 0,
    bought: row?.bought || 0,
    sell: row?.sell_n || 0,
    buyback: row?.buy_n || 0,
  }
}

async function houseRake(since) {
  const sql = since
    ? `SELECT COALESCE(SUM(FLOOR(stake * players * ? / 10000.0)), 0)::int AS rake, COUNT(*)::int AS n
       FROM matches WHERE settled = 1 AND won = 1 AND created_at >= ?`
    : `SELECT COALESCE(SUM(FLOOR(stake * players * ? / 10000.0)), 0)::int AS rake, COUNT(*)::int AS n
       FROM matches WHERE settled = 1 AND won = 1`
  const row = since
    ? await db.prepare(sql).get(GAME_RAKE_BPS, since)
    : await db.prepare(sql).get(GAME_RAKE_BPS)
  return { rake: row?.rake || 0, wins: row?.n || 0 }
}

async function profitByAgent() {
  const rows = await db
    .prepare(
      `SELECT agent_id,
         COALESCE(SUM(da) FILTER (WHERE kind = 'sell'), 0)::int AS cash_in,
         COALESCE(SUM(da) FILTER (WHERE kind = 'buyback'), 0)::int AS cash_out
       FROM kiosk_ops GROUP BY agent_id`,
    )
    .all()
  return new Map(rows.map((row) => [Number(row.agent_id), (row.cash_in || 0) - (row.cash_out || 0)]))
}

async function clientCounts() {
  const rows = await db
    .prepare('SELECT kiosk_id, COUNT(*)::int AS n FROM wallets WHERE kiosk_id IS NOT NULL GROUP BY kiosk_id')
    .all()
  return new Map(rows.map((row) => [Number(row.kiosk_id), row.n]))
}

async function publicAgent(row, counts, profits) {
  const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(row.address)
  const map = counts || (await clientCounts())
  const pnl = profits || (await profitByAgent())
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    status: row.status,
    coins: wallet?.coins ?? 0,
    clients: map.get(Number(row.id)) || 0,
    sellDa: row.sell_da ?? LUDO_PER_USD,
    buyDa: row.buy_da ?? LUDO_PER_USD,
    profitDa: pnl.get(Number(row.id)) || 0,
    created_at: row.created_at,
  }
}

async function adminOverview() {
  const kiosks = await db
    .prepare(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'frozen')::int AS frozen
       FROM agents`,
    )
    .get()
  const stock = await db
    .prepare(
      `SELECT COALESCE(SUM(w.coins), 0)::int AS coins
       FROM agents a JOIN wallets w ON w.address = a.address`,
    )
    .get()
  const players = await db
    .prepare(
      `SELECT
         COUNT(*)::int AS wallets,
         COUNT(*) FILTER (WHERE kiosk_id IS NOT NULL)::int AS tagged
       FROM wallets`,
    )
    .get()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const volume = await db
    .prepare(
      `SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(coins), 0)::int AS coins, COALESCE(SUM(da), 0)::int AS da
       FROM kiosk_ops WHERE created_at >= ? GROUP BY kind`,
    )
    .all(since)
  const today = { sell: 0, buyback: 0, sellCoins: 0, buybackCoins: 0, sellDa: 0, buybackDa: 0 }
  for (const row of volume) {
    if (row.kind === 'sell') {
      today.sell = row.n
      today.sellCoins = row.coins
      today.sellDa = row.da
    }
    if (row.kind === 'buyback') {
      today.buyback = row.n
      today.buybackCoins = row.coins
      today.buybackDa = row.da
    }
  }
  const [house, houseToday, kioskAll, kioskToday, online, tables] = await Promise.all([
    houseRake(),
    houseRake(since),
    cashStats(null),
    cashStats(null, since),
    countOnline(),
    liveRoomStats(),
  ])
  return {
    kiosks: { total: kiosks?.total || 0, active: kiosks?.active || 0, frozen: kiosks?.frozen || 0, stock: stock?.coins || 0 },
    players: {
      wallets: players?.wallets || 0,
      tagged: players?.tagged || 0,
      online,
      playing: tables.playing,
      lobby: tables.lobby,
      rooms: tables.rooms,
    },
    today,
    house: {
      rakeLudo: house.rake,
      rakeLudoToday: houseToday.rake,
      wins: house.wins,
      winsToday: houseToday.wins,
      unit: LUDO_PER_USD,
    },
    kiosk: kioskAll,
    kioskToday,
    recent: await listOps(12),
  }
}

async function listOps(limit = 40) {
  const cap = Math.min(100, Math.max(1, Math.floor(Number(limit) || 40)))
  return db
    .prepare(
      `SELECT o.id, o.kind, o.coins, o.da, o.client_address, o.created_at, a.name AS agent_name
       FROM kiosk_ops o
       JOIN agents a ON a.id = o.agent_id
       ORDER BY o.created_at DESC
       LIMIT ?`,
    )
    .all(cap)
}

async function lookupAdminWallet(raw) {
  const address = String(raw || '').trim().toLowerCase()
  if (!validAddress(address)) {
    throw Object.assign(new Error('Colle un ID joueur 0x…'), { status: 400 })
  }
  const wallet = await db.prepare('SELECT address, coins FROM wallets WHERE address = ?').get(address)
  if (!wallet) {
    throw Object.assign(new Error('Compte introuvable. Le joueur doit d’abord ouvrir Ludo.'), { status: 404 })
  }
  const agent = await db.prepare('SELECT name, status FROM agents WHERE address = ?').get(address)
  return {
    address: wallet.address,
    coins: wallet.coins,
    kioskName: agent?.name || null,
    kioskStatus: agent?.status || null,
    playing: await isPlaying(address),
  }
}

async function creditWallet(admin, rawAddress, rawCoins, rawNote) {
  const address = String(rawAddress || '').trim().toLowerCase()
  const coins = Math.floor(Number(rawCoins))
  const note = String(rawNote || '').trim().slice(0, 80)
  if (!validAddress(address)) {
    throw Object.assign(new Error('Colle un ID joueur 0x…'), { status: 400 })
  }
  if (!Number.isInteger(coins) || coins < 1 || coins > LUDO_PER_USD * 10_000) {
    throw Object.assign(new Error(`Montant : 1 à 10 000 ${GAME_ASSET}.`), { status: 400 })
  }
  return tx(async () => {
    const wallet = await db.prepare('SELECT address, coins FROM wallets WHERE address = ? FOR UPDATE').get(address)
    if (!wallet) {
      throw Object.assign(new Error('Compte introuvable. Le joueur doit d’abord ouvrir Ludo.'), { status: 404 })
    }
    await db
      .prepare('UPDATE wallets SET coins = coins + ?, updated_at = ? WHERE address = ?')
      .run(coins, nowIso(), address)
    const id = randomBytes(12).toString('hex')
    await db
      .prepare(
        `INSERT INTO admin_grants (id, admin_id, address, coins, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, admin.id, address, coins, note, nowIso())
    const next = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
    const agent = await db.prepare('SELECT name FROM agents WHERE address = ?').get(address)
    return { id, address, coins, balance: next.coins, kioskName: agent?.name || null, note }
  })
}

async function listGrants(limit = 40) {
  const cap = Math.min(80, Math.max(1, Math.floor(Number(limit) || 40)))
  return db
    .prepare(
      `SELECT g.id, g.address, g.coins, g.note, g.created_at, a.username
       FROM admin_grants g
       LEFT JOIN admins a ON a.id = g.admin_id
       ORDER BY g.created_at DESC
       LIMIT ?`,
    )
    .all(cap)
}

export async function handleDesk(req, res, { json, readBody, pathOf, fail, bearer }) {
  const path = pathOf(req)

  if (req.method === 'GET' && path === '/api/admin/status') {
    json(res, 200, { setupNeeded: (await adminCount()) === 0 })
    return true
  }

  if (req.method === 'POST' && path === '/api/admin/setup') {
    const body = await readBody(req)
    if ((await adminCount()) > 0) {
      json(res, 409, { error: 'Un admin existe déjà. Connecte-toi.' })
      return true
    }
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (!validUser(username) || !validPass(password)) {
      json(res, 400, { error: 'Identifiant 3–32 caractères, mot de passe 8 caractères min.' })
      return true
    }
    const created = await db
      .prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?) RETURNING id, username')
      .get(username, hashPassword(password), nowIso())
    const token = newSessionToken()
    await db
      .prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)')
      .run(token, created.id, Date.now() + SESSION_MS)
    json(res, 200, { token, username: created.username })
    return true
  }

  if (req.method === 'POST' && path === '/api/admin/login') {
    const body = await readBody(req)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    const admin = await db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username)
    if (!admin || !checkPassword(password, admin.password_hash)) {
      json(res, 401, { error: 'Identifiant ou mot de passe incorrect.' })
      return true
    }
    const token = newSessionToken()
    await db
      .prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)')
      .run(token, admin.id, Date.now() + SESSION_MS)
    json(res, 200, { token, username: admin.username })
    return true
  }

  if (req.method === 'POST' && path === '/api/admin/logout') {
    const token = bearer(req)
    if (token) await db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
    json(res, 200, { ok: true })
    return true
  }

  if (path.startsWith('/api/admin')) {
    const admin = await authAdmin(bearer(req))
    if (!admin) {
      json(res, 401, { error: 'Session admin expirée.' })
      return true
    }

    if (req.method === 'GET' && path === '/api/admin/me') {
      json(res, 200, { username: admin.username })
      return true
    }

    if (req.method === 'POST' && path === '/api/admin/password') {
      const body = await readBody(req)
      const current = String(body.current || '')
      const next = String(body.next || '')
      if (!validPass(next)) {
        json(res, 400, { error: 'Nouveau mot de passe : 8 caractères min.' })
        return true
      }
      if (current === next) {
        json(res, 400, { error: 'Le nouveau mot de passe doit être différent.' })
        return true
      }
      const row = await db.prepare('SELECT id, password_hash FROM admins WHERE id = ?').get(admin.id)
      if (!row || !checkPassword(current, row.password_hash)) {
        json(res, 400, { error: 'Mot de passe actuel incorrect.' })
        return true
      }
      await db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(next), admin.id)
      await db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token <> ?').run(admin.id, bearer(req))
      json(res, 200, { ok: true })
      return true
    }

    if (req.method === 'GET' && path === '/api/admin/overview') {
      json(res, 200, await adminOverview())
      return true
    }

    if (req.method === 'GET' && path === '/api/admin/ops') {
      json(res, 200, { ops: await listOps(80) })
      return true
    }

    if (req.method === 'GET' && path === '/api/admin/agents') {
      const rows = await db
        .prepare('SELECT id, name, address, status, sell_da, buy_da, created_at FROM agents ORDER BY created_at DESC')
        .all()
      const counts = await clientCounts()
      const profits = await profitByAgent()
      json(res, 200, { agents: await Promise.all(rows.map((row) => publicAgent(row, counts, profits))) })
      return true
    }

    if (req.method === 'POST' && path === '/api/admin/agents') {
      const body = await readBody(req)
      try {
        json(res, 200, await createAgent(body))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    const freeze = path.match(/^\/api\/admin\/agents\/(\d+)\/(freeze|unfreeze)$/)
    if (req.method === 'POST' && freeze) {
      const id = Number(freeze[1])
      const status = freeze[2] === 'freeze' ? 'frozen' : 'active'
      const updated = await db
        .prepare('UPDATE agents SET status = ? WHERE id = ? RETURNING id, name, address, status, sell_da, buy_da, created_at')
        .get(status, id)
      if (!updated) {
        json(res, 404, { error: 'Kiosque introuvable.' })
        return true
      }
      if (status === 'frozen') {
        await db.prepare('DELETE FROM agent_sessions WHERE agent_id = ?').run(id)
      }
      json(res, 200, { agent: await publicAgent(updated) })
      return true
    }

    const drop = path.match(/^\/api\/admin\/agents\/(\d+)\/delete$/)
    if (req.method === 'POST' && drop) {
      try {
        json(res, 200, await deleteAgent(Number(drop[1])))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    if (req.method === 'GET' && path === '/api/admin/center-apps') {
      json(res, 200, { apps: await listCenterApps() })
      return true
    }

    const decide = path.match(/^\/api\/admin\/center-apps\/(\d+)\/(approve|reject)$/)
    if (req.method === 'POST' && decide) {
      try {
        json(res, 200, await decideCenterApp(Number(decide[1]), decide[2]))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    const walletPath = path.match(/^\/api\/admin\/wallet\/(0x[a-fA-F0-9]{40})$/)
    if (req.method === 'GET' && walletPath) {
      try {
        json(res, 200, await lookupAdminWallet(walletPath[1]))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    if (req.method === 'GET' && path === '/api/admin/grants') {
      json(res, 200, { grants: await listGrants(40) })
      return true
    }

    if (req.method === 'POST' && path === '/api/admin/credit') {
      const body = await readBody(req)
      try {
        json(res, 200, await creditWallet(admin, body.address, body.coins, body.note))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    json(res, 404, { error: 'Route admin inconnue.' })
    return true
  }

  if (req.method === 'POST' && path === '/api/kiosk/login') {
    const body = await readBody(req)
    const username = String(body.username || body.name || '').trim()
    const password = String(body.password || '')
    const agent = await db
      .prepare('SELECT id, name, address, status, password_hash FROM agents WHERE LOWER(name) = LOWER(?)')
      .get(username)
    if (!agent || agent.status !== 'active' || !checkPassword(password, agent.password_hash)) {
      json(res, 401, { error: 'Kiosque inconnu, gelé, ou mot de passe incorrect.' })
      return true
    }
    const token = newSessionToken()
    await db
      .prepare('INSERT INTO agent_sessions (token, agent_id, expires_at) VALUES (?, ?, ?)')
      .run(token, agent.id, Date.now() + SESSION_MS)
    const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(agent.address)
    json(res, 200, {
      token,
      name: agent.name,
      address: agent.address,
      coins: wallet?.coins ?? 0,
    })
    return true
  }

  if (req.method === 'POST' && path === '/api/kiosk/logout') {
    const token = bearer(req)
    if (token) await db.prepare('DELETE FROM agent_sessions WHERE token = ?').run(token)
    json(res, 200, { ok: true })
    return true
  }

  if (path.startsWith('/api/kiosk')) {
    const agent = await authAgent(bearer(req))
    if (!agent) {
      json(res, 401, { error: 'Session caisse expirée.' })
      return true
    }

    if (req.method === 'GET' && path === '/api/kiosk/me') {
      json(res, 200, await kioskSnapshot(agent))
      return true
    }

    if (req.method === 'POST' && path === '/api/kiosk/rates') {
      const body = await readBody(req)
      try {
        json(res, 200, await setKioskRates(agent.id, body.sellDa, body.buyDa))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    if (req.method === 'GET' && path.startsWith('/api/kiosk/client/')) {
      const address = path.slice('/api/kiosk/client/'.length).toLowerCase()
      try {
        json(res, 200, await lookupClient(agent, address))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    if (req.method === 'POST' && path === '/api/kiosk/sell') {
      const body = await readBody(req)
      try {
        json(res, 200, await sellToClient(agent, body.address, body.coins))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    if (req.method === 'POST' && path === '/api/kiosk/buyback') {
      const body = await readBody(req)
      try {
        json(res, 200, await buyFromClient(agent, body.address, body.coins))
      } catch (error) {
        fail(res, error)
      }
      return true
    }

    json(res, 404, { error: 'Route caisse inconnue.' })
    return true
  }

  return false
}

async function createAgent(body) {
  const name = String(body.name || '').trim()
  const address = String(body.address || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!validUser(name)) {
    throw Object.assign(new Error('Nom kiosque : 3–32 lettres/chiffres.'), { status: 400 })
  }
  if (!validAddress(address)) {
    throw Object.assign(new Error('Colle l’ID joueur 0x… du compte kiosque (créé dans le jeu).'), { status: 400 })
  }
  if (!validPass(password)) {
    throw Object.assign(new Error('Mot de passe caisse : 8 caractères min.'), { status: 400 })
  }
  const wallet = await db.prepare('SELECT address FROM wallets WHERE address = ?').get(address)
  if (!wallet) {
    throw Object.assign(new Error('Ce compte n’existe pas. Le kiosque doit d’abord ouvrir le jeu et créer son wallet.'), {
      status: 400,
    })
  }
  const takenName = await db.prepare('SELECT id FROM agents WHERE LOWER(name) = LOWER(?)').get(name)
  if (takenName) throw Object.assign(new Error('Ce nom de kiosque est déjà pris.'), { status: 400 })
  const takenAddr = await db.prepare('SELECT id FROM agents WHERE address = ?').get(address)
  if (takenAddr) throw Object.assign(new Error('Ce wallet est déjà un kiosque.'), { status: 400 })

  const row = await db
    .prepare(
      `INSERT INTO agents (name, address, password_hash, status, created_at)
       VALUES (?, ?, ?, 'active', ?) RETURNING id, name, address, status, sell_da, buy_da, created_at`,
    )
    .get(name, address, hashPassword(password), nowIso())
  return { agent: await publicAgent(row) }
}

async function deleteAgent(id) {
  const row = await db.prepare('SELECT id, name, address FROM agents WHERE id = ?').get(id)
  if (!row) throw Object.assign(new Error('Centre introuvable.'), { status: 404 })
  await tx(async () => {
    await db.prepare('UPDATE wallets SET kiosk_id = NULL WHERE kiosk_id = ?').run(id)
    await db.prepare('DELETE FROM kiosk_ops WHERE agent_id = ?').run(id)
    await db.prepare('DELETE FROM agent_sessions WHERE agent_id = ?').run(id)
    await db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  })
  return { ok: true, name: row.name }
}

export async function pendingCenterApp(address) {
  return db
    .prepare("SELECT id, name, city, status, created_at FROM center_apps WHERE address = ? AND status = 'pending'")
    .get(String(address || '').toLowerCase())
}

export async function submitCenterApp({ telegramId, address, name, city }) {
  const cleanName = String(name || '').trim()
  const cleanCity = String(city || '').trim().slice(0, 48)
  const addr = String(address || '').trim().toLowerCase()
  if (!validUser(cleanName)) {
    throw new Error('Nom du centre : 3 à 32 caractères (lettres, chiffres, point, tiret).')
  }
  if (await isActiveAgent(addr)) {
    throw new Error('Ce compte est déjà un centre de recharge.')
  }
  const open = await pendingCenterApp(addr)
  if (open) {
    throw new Error(`Une demande est déjà en cours (${open.name}).`)
  }
  const takenName = await db.prepare('SELECT id FROM agents WHERE LOWER(name) = LOWER(?)').get(cleanName)
  if (takenName) throw new Error('Ce nom est déjà attribué.')
  const takenApp = await db
    .prepare("SELECT id FROM center_apps WHERE LOWER(name) = LOWER(?) AND status = 'pending'")
    .get(cleanName)
  if (takenApp) throw new Error('Ce nom est déjà en demande.')

  const row = await db
    .prepare(
      `INSERT INTO center_apps (telegram_id, address, name, city, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id, name, city, address, status, created_at`,
    )
    .get(Number(telegramId), addr, cleanName, cleanCity, nowIso())
  return row
}

async function listCenterApps() {
  return db
    .prepare(
      `SELECT id, telegram_id, address, name, city, status, created_at, decided_at
       FROM center_apps ORDER BY created_at DESC LIMIT 80`,
    )
    .all()
}

function makeCaissePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('')
}

function caisseUrl() {
  return `${PUBLIC_URL || publicUrls()[0] || ''}/caisse`.replace(/([^:]\/)\/+/g, '$1')
}

async function notifyApplicant(telegramId, html) {
  if (!telegramId) return
  try {
    const { notifyTelegram } = await import('./telegram.mjs')
    await notifyTelegram(telegramId, html)
  } catch (error) {
    console.error('Notify centre:', error.message)
  }
}

async function decideCenterApp(id, action) {
  const app = await db.prepare('SELECT * FROM center_apps WHERE id = ?').get(id)
  if (!app) throw Object.assign(new Error('Demande introuvable.'), { status: 404 })
  if (app.status !== 'pending') {
    throw Object.assign(new Error('Cette demande a déjà été traitée.'), { status: 400 })
  }
  if (action === 'reject') {
    await db
      .prepare("UPDATE center_apps SET status = 'rejected', decided_at = ? WHERE id = ?")
      .run(nowIso(), id)
    await notifyApplicant(
      app.telegram_id,
      'Votre demande de centre de recharge n’a pas été retenue.',
    )
    return { ok: true, status: 'rejected' }
  }
  const password = makeCaissePassword()
  const created = await createAgent({ name: app.name, address: app.address, password })
  await db
    .prepare("UPDATE center_apps SET status = 'approved', decided_at = ? WHERE id = ?")
    .run(nowIso(), id)
  const login = caisseUrl()
  await notifyApplicant(
    app.telegram_id,
    [
      '<b>Centre de recharge validé</b>',
      `Connexion : ${login}`,
      `Nom : <code>${String(app.name).replace(/</g, '')}</code>`,
      `Mot de passe : <code>${password}</code>`,
      'Conservez-le. Il ne sera plus renvoyé.',
    ].join('\n'),
  )
  return { ok: true, status: 'approved', agent: created.agent, password, login }
}

async function setKioskRates(id, sellDa, buyDa) {
  if (!validRate(sellDa) || !validRate(buyDa)) {
    throw Object.assign(new Error('Tarifs DA : nombre entier entre 1 et 999 999.'), { status: 400 })
  }
  const sell = Math.floor(Number(sellDa))
  const buy = Math.floor(Number(buyDa))
  const row = await db
    .prepare('UPDATE agents SET sell_da = ?, buy_da = ? WHERE id = ? RETURNING id, name, address, status, sell_da, buy_da, created_at')
    .get(sell, buy, id)
  if (!row) throw Object.assign(new Error('Kiosque introuvable.'), { status: 404 })
  return { sellDa: row.sell_da, buyDa: row.buy_da, agent: await publicAgent(row) }
}

async function kioskSnapshot(agent) {
  const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(agent.address)
  const tagged = await db.prepare('SELECT COUNT(*)::int AS n FROM wallets WHERE kiosk_id = ?').get(agent.id)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [todayCash, allCash] = await Promise.all([cashStats(agent.id, since), cashStats(agent.id)])
  const ops = await db
    .prepare(
      `SELECT id, kind, client_address, coins, da, created_at
       FROM kiosk_ops WHERE agent_id = ? ORDER BY created_at DESC LIMIT 80`,
    )
    .all(agent.id)
  const roster = await db
    .prepare(
      `SELECT address, coins, updated_at
       FROM wallets WHERE kiosk_id = ? ORDER BY coins DESC LIMIT 80`,
    )
    .all(agent.id)
  const sellDa = agent.sell_da ?? LUDO_PER_USD
  const buyDa = agent.buy_da ?? LUDO_PER_USD
  return {
    name: agent.name,
    address: agent.address,
    coins: wallet?.coins ?? 0,
    stakes: STAKES,
    clients: tagged?.n || 0,
    sellDa,
    buyDa,
    unit: LUDO_PER_USD,
    today: {
      sell: todayCash.sell,
      buyback: todayCash.buyback,
      sellCoins: todayCash.sold,
      buybackCoins: todayCash.bought,
    },
    pnl: allCash,
    pnlToday: todayCash,
    ops,
    roster,
  }
}

async function lookupClient(agent, address) {
  if (!validAddress(address)) {
    throw Object.assign(new Error('ID joueur invalide.'), { status: 400 })
  }
  const wallet = await db.prepare('SELECT address, coins, kiosk_id FROM wallets WHERE address = ?').get(address)
  if (!wallet) {
    throw Object.assign(new Error('Compte introuvable. Le client doit d’abord créer son compte dans le jeu, puis te montrer son ID.'), { status: 404 })
  }
  const tagged = wallet.kiosk_id ? await db.prepare('SELECT id, name FROM agents WHERE id = ?').get(wallet.kiosk_id) : null
  const playing = await isPlaying(address)
  return {
    address: wallet.address,
    coins: wallet.coins,
    playing,
    kioskId: tagged?.id || null,
    kioskName: tagged?.name || null,
    yours: tagged?.id === agent.id,
    canSell: !playing && address !== agent.address,
    canBuyback: !playing && tagged?.id === agent.id && wallet.coins > 0 && address !== agent.address,
  }
}

async function sellToClient(agent, rawAddress, rawCoins) {
  const address = String(rawAddress || '').trim().toLowerCase()
  const coins = Math.floor(Number(rawCoins))
  if (!validAddress(address)) throw Object.assign(new Error('ID joueur invalide.'), { status: 400 })
  if (!Number.isInteger(coins) || coins < 1) {
    throw Object.assign(new Error('Montant invalide.'), { status: 400 })
  }
  if (address === agent.address) {
    throw Object.assign(new Error('Tu ne peux pas te vendre à toi-même.'), { status: 400 })
  }

  const result = await tx(async () => {
    if (await isPlaying(address)) {
      throw Object.assign(new Error('Le client est en partie. Attends la fin.'), { status: 400 })
    }
    const kiosk = await db
      .prepare('SELECT address, coins FROM wallets WHERE address = ? FOR UPDATE')
      .get(agent.address)
    const rates = await db.prepare('SELECT sell_da FROM agents WHERE id = ? FOR UPDATE').get(agent.id)
    const client = await db
      .prepare('SELECT address, coins, kiosk_id FROM wallets WHERE address = ? FOR UPDATE')
      .get(address)
    if (!client) {
      throw Object.assign(new Error('Compte introuvable. Le client doit d’abord créer son compte dans le jeu.'), { status: 404 })
    }
    if (!kiosk || kiosk.coins < coins) {
      throw Object.assign(new Error('Stock kiosque insuffisant.'), { status: 400 })
    }
    const da = daFor(coins, rates?.sell_da ?? LUDO_PER_USD)
    await db
      .prepare('UPDATE wallets SET coins = coins - ?, updated_at = ? WHERE address = ?')
      .run(coins, nowIso(), agent.address)
    await db
      .prepare('UPDATE wallets SET coins = coins + ?, kiosk_id = ?, updated_at = ? WHERE address = ?')
      .run(coins, agent.id, nowIso(), address)
    const id = randomBytes(12).toString('hex')
    await db
      .prepare(
        `INSERT INTO kiosk_ops (id, agent_id, client_address, kind, coins, da, created_at)
         VALUES (?, ?, ?, 'sell', ?, ?, ?)`,
      )
      .run(id, agent.id, address, coins, da, nowIso())
    const nextKiosk = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(agent.address)
    const nextClient = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
    return { kioskCoins: nextKiosk.coins, clientCoins: nextClient.coins, coins, da, address, kind: 'sell' }
  })
  return result
}

async function buyFromClient(agent, rawAddress, rawCoins) {
  const address = String(rawAddress || '').trim().toLowerCase()
  const coins = Math.floor(Number(rawCoins))
  if (!validAddress(address)) throw Object.assign(new Error('ID joueur invalide.'), { status: 400 })
  if (!Number.isInteger(coins) || coins < 1) {
    throw Object.assign(new Error('Montant invalide.'), { status: 400 })
  }
  if (address === agent.address) {
    throw Object.assign(new Error('Opération invalide.'), { status: 400 })
  }

  const result = await tx(async () => {
    if (await isPlaying(address)) {
      throw Object.assign(new Error('Le client est en partie. Attends la fin.'), { status: 400 })
    }
    const client = await db
      .prepare('SELECT address, coins, kiosk_id FROM wallets WHERE address = ? FOR UPDATE')
      .get(address)
    await db.prepare('SELECT address FROM wallets WHERE address = ? FOR UPDATE').get(agent.address)
    const rates = await db.prepare('SELECT buy_da FROM agents WHERE id = ? FOR UPDATE').get(agent.id)
    if (!client) throw Object.assign(new Error('Client introuvable.'), { status: 404 })
    if (client.kiosk_id !== agent.id) {
      throw Object.assign(new Error('Ce client n’est pas rattaché à ce kiosque. Il doit revenir à son guichet.'), {
        status: 403,
      })
    }
    if (client.coins < coins) {
      throw Object.assign(new Error('Le client n’a pas assez de Ł.'), { status: 400 })
    }
    const da = daFor(coins, rates?.buy_da ?? LUDO_PER_USD)
    const left = client.coins - coins
    await db
      .prepare('UPDATE wallets SET coins = coins - ?, kiosk_id = ?, updated_at = ? WHERE address = ?')
      .run(coins, left === 0 ? null : agent.id, nowIso(), address)
    await db
      .prepare('UPDATE wallets SET coins = coins + ?, updated_at = ? WHERE address = ?')
      .run(coins, nowIso(), agent.address)
    const id = randomBytes(12).toString('hex')
    await db
      .prepare(
        `INSERT INTO kiosk_ops (id, agent_id, client_address, kind, coins, da, created_at)
         VALUES (?, ?, ?, 'buyback', ?, ?, ?)`,
      )
      .run(id, agent.id, address, coins, da, nowIso())
    const nextKiosk = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(agent.address)
    const nextClient = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
    return { kioskCoins: nextKiosk.coins, clientCoins: nextClient.coins, coins, da, address, kind: 'buyback' }
  })
  return result
}
