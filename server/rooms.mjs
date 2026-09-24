import { randomBytes } from 'node:crypto'
import { db, tx } from './db.mjs'
import { isAllowedStake, formatLudo, TABLE_STAKE } from './economy.mjs'
import { bus } from './bus.mjs'
import {
  acquireLock,
  createRoomExclusive,
  deleteRoom,
  listRooms,
  loadRoom,
  roomExists,
  saveRoom,
} from './redis.mjs'
import {
  PAQUET_COLORS,
  coverCurrent,
  createPaquetFromPlayers,
  endTable,
  isOver,
  isPaquetGame,
  minBet,
  peekChef,
  pickPacket,
  placeBet,
  startNextHand,
  stepAuto,
  viewFor,
  offerChef,
  buyChef,
  cancelOffer,
} from './paquet.mjs'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LOBBY_TTL_MS = 45 * 60 * 1000
const ENDED_TTL_MS = 2 * 60 * 1000
const ONLINE_MS = 8 * 1000
const DISCONNECT_GRACE_MS = 25 * 1000
const FORFEIT_GRACE_MS = 20 * 1000
const MATCH_COUNTDOWN_MS = 3000

async function persist(room, { silent = false } = {}) {
  if (!silent) {
    room.rev = (room.rev || 0) + 1
    room.touched = Date.now()
  }
  await saveRoom(room)
  if (!silent) bus.emit('room:update', room)
  return room
}

async function withRoom(code, fn) {
  const lock = await acquireLock(code)
  if (!lock) throw Object.assign(new Error('Salle occupée, réessaie.'), { status: 409 })
  try {
    const room = await loadRoom(code)
    return await fn(room)
  } finally {
    await lock.release()
  }
}

function nowIso() {
  return new Date().toISOString()
}

function randomCode() {
  const bytes = randomBytes(4)
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
}

export async function getWallet(address) {
  return db.prepare('SELECT address, coins FROM wallets WHERE address = ?').get(address)
}

export function refillIfNeeded(wallet) {
  return { ...wallet, refilled: false }
}

async function shiftCoins(address, delta) {
  if (!delta) return getWallet(address)
  return tx(async () => {
    const locked = await db.prepare('SELECT address, coins FROM wallets WHERE address = ? FOR UPDATE').get(address)
    if (!locked) throw new Error('Wallet introuvable.')
    if (locked.coins + delta < 0) throw Object.assign(new Error('Solde insuffisant.'), { status: 400 })
    await db
      .prepare('UPDATE wallets SET coins = coins + ?, updated_at = ? WHERE address = ?')
      .run(delta, nowIso(), address)
    return { address, coins: locked.coins + delta }
  })
}

async function cashOutSeat(room, seat) {
  if (!seat || seat.kind !== 'human' || !seat.address || seat.cashed) return
  const who = room.game?.players.find((p) => p.color === seat.color)
  const amount = Math.max(0, Math.floor(Number(who?.coins) || 0))
  if (amount) await shiftCoins(seat.address, amount)
  seat.cashed = true
}

async function cashOutAll(room) {
  for (const seat of room.seats) await cashOutSeat(room, seat)
}

function emptySeat(color) {
  return { color, name: 'Libre', address: null, kind: 'empty', lastSeen: 0, botPlay: false, forfeited: false, quitAt: 0 }
}

function humanSeat(color, name, address) {
  return { color, name, address, kind: 'human', lastSeen: Date.now(), botPlay: false, forfeited: false, quitAt: 0 }
}

function isLeaving(seat) {
  return Boolean(seat?.quitAt) && !seat.forfeited
}

function publicSeat(seat) {
  const online =
    seat.kind === 'human' && !seat.forfeited && !isLeaving(seat) && Date.now() - (seat.lastSeen || 0) < ONLINE_MS
  return {
    color: seat.color,
    name: seat.name,
    address: seat.address,
    kind: seat.kind,
    online: seat.kind === 'human' ? online : false,
    botPlay: Boolean(seat.botPlay),
    forfeited: Boolean(seat.forfeited),
    leaving: isLeaving(seat),
  }
}

function humanCount(room) {
  return room.seats.filter((s) => s.kind === 'human').length
}

function activeHumans(room) {
  return room.seats.filter((s) => s.kind === 'human' && s.address && !s.forfeited && !isLeaving(s))
}

function leavingSeats(room) {
  return room.seats.filter((s) => s.kind === 'human' && isLeaving(s))
}

export async function snapshot(room, address, opts = {}) {
  const you = room.seats.find((s) => s.address === address)
  const coins = opts.skipWallet ? undefined : address ? (await getWallet(address))?.coins : undefined
  const botsFor = room.seats.filter((s) => s.kind === 'human' && s.botPlay && !s.forfeited).map((s) => s.name)
  let notice = botsFor.length
    ? `${botsFor.join(', ')} hors ligne — la table continue.`
    : null
  if (room.status === 'playing' && room.forfeitWinAt) {
    const secs = Math.max(1, Math.ceil((room.forfeitWinAt - Date.now()) / 1000))
    const names = leavingSeats(room)
      .map((s) => s.name)
      .join(', ')
    if (isLeaving(you)) {
      notice = `Tu as ${secs} s pour revenir, sinon tu perds ta mise.`
    } else if (names) {
      notice = `${names} a quitté. Retour possible ${secs} s. Si tu quittes aussi, le pot va à la maison.`
    } else {
      notice = `Un joueur a quitté. Forfait dans ${secs} s.`
    }
  }
  return {
    code: room.code,
    host: room.host,
    count: room.count,
    stake: room.stake,
    status: room.status,
    you: you?.color ?? null,
    seats: room.seats.map(publicSeat),
    rolling: room.rolling,
    game: room.game ? viewFor(room.game, you?.color ?? null) : null,
    coins,
    humans: humanCount(room),
    rev: room.rev || 0,
    notice,
    forfeitWinAt: room.forfeitWinAt || 0,
    turnDueAt: room.turnDueAt || 0,
    startAt: room.startAt || 0,
    kind: room.kind === 'match' ? 'match' : 'private',
    table: 'paquet',
    waiting: (room.waiting || []).map((w) => ({ name: w.name, address: w.address })),
    watching: Boolean((room.waiting || []).some((w) => w.address === address) && !you),
  }
}

export async function getRoom(code) {
  return loadRoom(code)
}

export async function isPlaying(address) {
  for (const room of await listRooms()) {
    if (room.status !== 'playing') continue
    if (room.seats.some((seat) => seat.kind === 'human' && seat.address === address && !seat.forfeited)) {
      return true
    }
    if ((room.waiting || []).some((w) => w.address === address)) return true
  }
  return false
}

export async function liveRoomStats() {
  let rooms = 0
  let playing = 0
  let lobby = 0
  for (const room of await listRooms()) {
    if (room.status === 'ended') continue
    rooms += 1
    const humans = room.seats.filter((seat) => seat.kind === 'human' && !seat.forfeited).length
    if (room.status === 'playing') playing += humans
    else lobby += humans
  }
  return { rooms, playing, lobby }
}

export async function activeRoomFor(address) {
  for (const room of await listRooms()) {
    if (room.status === 'ended') continue
    if (room.seats.some((seat) => seat.kind === 'human' && seat.address === address && !seat.forfeited)) return room
    if ((room.waiting || []).some((w) => w.address === address)) return room
  }
  return null
}

function applyTouch(room, address) {
  const seat = room.seats.find((s) => s.address === address && s.kind === 'human')
  if (!seat || seat.forfeited) return { changed: false, reclaimed: false }
  seat.lastSeen = Date.now()
  if (isLeaving(seat) || !seat.botPlay || !room.game) return { changed: true, reclaimed: false }
  seat.botPlay = false
  room.game = {
    ...room.game,
    players: room.game.players.map((p) => (p.color === seat.color ? { ...p, isHuman: true } : p)),
    message: `${seat.name} est de retour.`,
  }
  return { changed: true, reclaimed: true }
}

function reclaimQuit(room, seat) {
  if (!seat || seat.forfeited || !isLeaving(seat)) return false
  if (room.forfeitWinAt && Date.now() >= room.forfeitWinAt) return false
  seat.quitAt = 0
  seat.botPlay = false
  seat.lastSeen = Date.now()
  setPlayerHuman(room, seat.color, true)
  if (!leavingSeats(room).length) room.forfeitWinAt = 0
  if (room.game) {
    room.game = {
      ...room.game,
      message: `${seat.name} est de retour.`,
    }
  }
  return true
}

export async function touchSeat(roomOrCode, address) {
  const code = typeof roomOrCode === 'string' ? roomOrCode : roomOrCode?.code
  if (!code || !address) return typeof roomOrCode === 'object' ? roomOrCode : null
  return withRoom(code, async (room) => {
    if (!room) return null
    const { changed, reclaimed } = applyTouch(room, address)
    if (reclaimed) armActor(room)
    if (!changed) return room
    await persist(room, { silent: !reclaimed })
    return room
  })
}

export async function createRoom({ address, name, color, count, stake, kind = 'private' }) {
  count = 8
  stake = TABLE_STAKE
  if (!PAQUET_COLORS.includes(color)) color = PAQUET_COLORS[0]
  if (!isAllowedStake(stake)) {
    throw Object.assign(new Error('Paramètres invalides.'), { status: 400 })
  }
  const hostWallet = await getWallet(address)
  if (!hostWallet || hostWallet.coins < stake) {
    throw Object.assign(new Error('Il faut 3,50 Ł pour s’asseoir.'), { status: 400 })
  }

  const colors = [...PAQUET_COLORS]
  const seats = colors.map((id) =>
    id === color ? humanSeat(id, name || 'Hôte', address) : emptySeat(id),
  )

  for (let i = 0; i < 20; i += 1) {
    const code = randomCode()
    if (await roomExists(code)) continue
    const room = {
      code,
      host: address,
      hostColor: color,
      count,
      stake,
      status: 'lobby',
      seats,
      game: null,
      rolling: false,
      busy: false,
      matchId: null,
      botDueAt: 0,
      rollDueAt: 0,
      rollValue: 0,
      rollPity: false,
      rev: 1,
      touched: Date.now(),
      forfeitWinAt: 0,
      turnDueAt: 0,
      startAt: 0,
      kind: kind === 'match' ? 'match' : 'private',
      table: 'paquet',
      waiting: [],
    }
    if (await createRoomExclusive(room)) return room
  }
  throw new Error('Impossible de créer un code.')
}

export async function matchmake({ address, name, color, count, stake }) {
  count = 8
  stake = TABLE_STAKE
  if (!PAQUET_COLORS.includes(color)) color = PAQUET_COLORS[0]
  const seeker = await getWallet(address)
  if (!seeker || seeker.coins < stake) {
    throw Object.assign(new Error('Il faut 3,50 Ł pour s’asseoir.'), { status: 400 })
  }

  const existing = await activeRoomFor(address)
  if (existing) return existing

  const lock = await acquireLock('MM-paquet-table', 5000)
  if (!lock) throw Object.assign(new Error('Recherche occupée, réessaie.'), { status: 409 })
  try {
    const again = await activeRoomFor(address)
    if (again) return again

    for (const candidate of await listRooms()) {
      if (candidate.kind !== 'match' || candidate.status === 'ended') continue
      if (candidate.seats.some((s) => s.address === address) || (candidate.waiting || []).some((w) => w.address === address)) {
        return (await loadRoom(candidate.code)) || candidate
      }
      try {
        return await joinRoom({ code: candidate.code, address, name, color })
      } catch (error) {
        if (error?.status === 400) continue
        throw error
      }
    }

    return await createRoom({ address, name, color, count, stake, kind: 'match' })
  } finally {
    await lock.release()
  }
}

export async function joinRoom({ code, address, name, color }) {
  return withRoom(code, async (room) => {
    if (!room) throw Object.assign(new Error('Salle introuvable.'), { status: 404 })

    const already = room.seats.find((s) => s.address === address)
    if (already) {
      if (already.forfeited) {
        throw Object.assign(new Error('Tu as quitté cette partie.'), { status: 400 })
      }
      const renamed = Boolean(name && already.name !== name)
      if (renamed) already.name = name
      const wasLeaving = isLeaving(already)
      const cameBack = reclaimQuit(room, already)
      if (wasLeaving && !cameBack) {
        throw Object.assign(new Error('Le délai pour revenir est terminé.'), { status: 400 })
      }
      const { reclaimed } = applyTouch(room, address)
      if ((cameBack || reclaimed) && !room.forfeitWinAt) armActor(room)
      if (renamed || cameBack || reclaimed) await persist(room)
      else await persist(room, { silent: true })
      return room
    }

    if (room.status === 'playing') {
      room.waiting = room.waiting || []
      if (room.waiting.some((w) => w.address === address)) {
        await persist(room, { silent: true })
        return room
      }
      const joiner = await getWallet(address)
      if (!joiner || joiner.coins < room.stake) {
        throw Object.assign(new Error('Il faut 3,50 Ł pour s’asseoir.'), { status: 400 })
      }
      room.waiting.push({ address, name: name || 'Joueur', joinedAt: Date.now() })
      if (room.game) {
        room.game = { ...room.game, message: `${name || 'Un joueur'} attend le prochain coup.` }
      }
      await persist(room)
      return room
    }

    if (room.status !== 'lobby') {
      throw Object.assign(new Error('La partie a déjà commencé.'), { status: 400 })
    }

    const wanted = color && room.seats.some((s) => s.color === color && s.kind === 'empty')
      ? color
      : room.seats.find((s) => s.kind === 'empty')?.color
    if (!wanted) throw Object.assign(new Error('Salle complète.'), { status: 400 })

    const joiner = await getWallet(address)
    if (!joiner || joiner.coins < room.stake) {
      throw Object.assign(new Error('Solde insuffisant pour cette mise.'), { status: 400 })
    }

    room.seats = room.seats.map((s) =>
      s.color === wanted ? humanSeat(s.color, name || 'Joueur', address) : s,
    )
    try {
      await maybeAutoStart(room)
    } catch (error) {
      console.error(error)
    }
    await persist(room)
    return room
  })
}

export async function leaveRoom({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room) return null

    if (room.status === 'ended') return room

    if (room.status === 'playing') {
      const waiting = room.waiting || []
      if (waiting.some((w) => w.address === address)) {
        room.waiting = waiting.filter((w) => w.address !== address)
        await persist(room)
        return room
      }
      if (await applyQuit(room, address)) await persist(room)
      return room
    }

    if (address === room.host && room.kind !== 'match') {
      await deleteRoom(room.code)
      bus.emit('room:gone', room.code)
      return null
    }

    room.seats = room.seats.map((s) => (s.address === address ? emptySeat(s.color) : s))
    room.startAt = 0
    const remaining = room.seats.find((s) => s.kind === 'human' && s.address)
    if (!remaining) {
      await deleteRoom(room.code)
      bus.emit('room:gone', room.code)
      return null
    }
    if (address === room.host) room.host = remaining.address
    await persist(room)
    return room
  })
}

function liveHumans(room) {
  return room.seats.filter((s) => s.kind === 'human' && s.address && !s.forfeited)
}

function pruneGamePlayers(room) {
  if (!room.game) return
  const colors = new Set(liveHumans(room).map((s) => s.color))
  const players = room.game.players.filter((p) => colors.has(p.color))
  const chef = players.some((p) => p.color === room.game.chef) ? room.game.chef : null
  room.game = { ...room.game, players, chef }
}

async function admitWaiters(room) {
  if (!room?.game || room.status !== 'playing') return
  pruneGamePlayers(room)
  const queue = [...(room.waiting || [])]
  room.waiting = []
  for (const waiter of queue) {
    if ((room.game.players?.length ?? 0) >= 8) {
      room.waiting.push(waiter)
      continue
    }
    const wallet = await getWallet(waiter.address)
    if (!wallet || wallet.coins < room.stake) continue
    const taken = new Set(room.game.players.map((p) => p.color))
    const free = room.seats.find((s) => !taken.has(s.color) && (s.kind === 'empty' || s.forfeited || s.kind === 'bot'))
    if (!free) {
      room.waiting.push(waiter)
      continue
    }
    await shiftCoins(waiter.address, -room.stake)
    const seated = humanSeat(free.color, waiter.name || 'Joueur', waiter.address)
    seated.cashed = false
    room.seats = room.seats.map((s) => (s.color === free.color ? seated : s))
    room.game = {
      ...room.game,
      players: [
        ...room.game.players,
        {
          color: seated.color,
          name: seated.name,
          isHuman: true,
          coins: room.stake,
          packet: null,
          bet: 0,
          electCard: null,
          peeked: false,
          settled: false,
          bank: room.stake,
          out: false,
        },
      ],
      message: `${seated.name} s’assoit. Il joue ce coup.`,
    }
  }
}

async function kickBrokeHumans(room) {
  for (const seat of [...room.seats]) {
    if (seat.kind !== 'human' || !seat.address) continue
    const wallet = await getWallet(seat.address)
    if (wallet && wallet.coins >= room.stake) continue
    room.seats = room.seats.map((s) => (s.color === seat.color ? emptySeat(s.color) : s))
    if (room.host === seat.address) {
      const nextHost = room.seats.find((s) => s.kind === 'human' && s.address)
      if (nextHost) room.host = nextHost.address
    }
  }
}

async function launchGame(room) {
  const humanSeats = liveHumans(room)
  if (humanSeats.length < 2) {
    throw Object.assign(new Error('Il faut deux joueurs pour lancer.'), { status: 400 })
  }
  for (const seat of humanSeats) {
    if (((await getWallet(seat.address))?.coins ?? 0) < room.stake) {
      throw Object.assign(new Error(`${seat.name} n’a plus assez de Ł.`), { status: 400 })
    }
  }

  const matchId = randomBytes(16).toString('hex')
  const players = humanSeats.map((seat) => ({
    color: seat.color,
    name: seat.name,
    isHuman: true,
    coins: room.stake,
  }))

  for (const seat of humanSeats) {
    await shiftCoins(seat.address, -room.stake)
    seat.cashed = false
  }

  room.matchId = matchId
  room.game = createPaquetFromPlayers(matchId, players, room.stake, true)
  room.status = 'playing'
  room.rollDueAt = 0
  room.botDueAt = 0
  room.forfeitWinAt = 0
  room.startAt = 0
  for (const seat of room.seats) {
    if (seat.kind === 'human') {
      seat.lastSeen = Date.now()
      seat.quitAt = 0
      seat.forfeited = false
      seat.botPlay = false
    }
  }
  armActor(room)
}

async function maybeAutoStart(room) {
  if (room.kind !== 'match' || room.status !== 'lobby') return false
  await kickBrokeHumans(room)
  if (humanCount(room) < room.count) {
    if (!room.startAt) return false
    room.startAt = 0
    return true
  }
  const now = Date.now()
  if (!room.startAt) {
    room.startAt = now + MATCH_COUNTDOWN_MS
    return true
  }
  if (now < room.startAt) return false
  try {
    await launchGame(room)
    return true
  } catch (error) {
    console.error(error)
    room.startAt = 0
    await kickBrokeHumans(room)
    return true
  }
}

function handToBot(room, seat) {
  if (seat.kind !== 'human' || seat.botPlay || seat.forfeited || isLeaving(seat) || !room.game) return false
  seat.botPlay = true
  room.game = {
    ...room.game,
    players: room.game.players.map((p) => (p.color === seat.color ? { ...p, isHuman: false } : p)),
    message: `${seat.name} a perdu la connexion. La table continue.`,
  }
  return true
}

function syncDisconnects(room) {
  if (room.status !== 'playing' || !room.game || isOver(room.game) || room.forfeitWinAt) return false
  const now = Date.now()
  let changed = false
  for (const seat of room.seats) {
    if (seat.kind !== 'human' || !seat.address || seat.botPlay || seat.forfeited || isLeaving(seat)) continue
    if (now - (seat.lastSeen || 0) < DISCONNECT_GRACE_MS) continue
    if (handToBot(room, seat)) changed = true
  }
  return changed
}

function pausePlay(room) {
  room.botDueAt = 0
  room.rollDueAt = 0
  room.turnDueAt = 0
  room.busy = false
  room.rolling = false
}

function setPlayerHuman(room, color, isHuman) {
  if (!room.game) return
  room.game = {
    ...room.game,
    players: room.game.players.map((p) => (p.color === color ? { ...p, isHuman } : p)),
  }
}

function setPlayerOut(room, color, out) {
  if (!room.game) return
  room.game = {
    ...room.game,
    players: room.game.players.map((p) => (p.color === color ? { ...p, out } : p)),
  }
}

async function settleAbandoned(room) {
  if (room.status === 'ended') return
  if (room.game) {
    room.game = endTable(room.game, 'Tout le monde a quitté. Les mises ouvertes reviennent.', null)
    await cashOutAll(room)
  }
  room.status = 'ended'
  room.forfeitWinAt = 0
  pausePlay(room)
}

async function awardForfeitWin(room) {
  const remaining = activeHumans(room)
  if (remaining.length !== 1 || !room.game) {
    await settleAbandoned(room)
    return
  }
  const winner = remaining[0]
  room.game = endTable(room.game, `${winner.name} gagne par forfait.`, winner.color)
  await cashOutAll(room)
  room.forfeitWinAt = 0
  room.status = 'ended'
  pausePlay(room)
}

async function applyQuit(room, address) {
  const seat = room.seats.find((s) => s.address === address && s.kind === 'human')
  if (!seat || seat.forfeited || isLeaving(seat)) return false
  seat.quitAt = Date.now()
  seat.botPlay = false
  pausePlay(room)
  room.forfeitWinAt = Date.now() + FORFEIT_GRACE_MS
  const secs = Math.max(1, Math.ceil((room.forfeitWinAt - Date.now()) / 1000))
  if (room.game) {
    room.game = {
      ...room.game,
      message: `${seat.name} a quitté. ${secs} s pour revenir.`,
    }
  }
  return true
}

async function resolveQuitTimer(room) {
  if (room.status !== 'playing' || isOver(room.game)) {
    room.forfeitWinAt = 0
    return
  }
  const leavers = leavingSeats(room)
  for (const seat of leavers) {
    seat.forfeited = true
    seat.quitAt = 0
    seat.botPlay = false
    setPlayerOut(room, seat.color, true)
    await cashOutSeat(room, seat)
  }
  room.forfeitWinAt = 0
  if (!leavers.length) {
    await awardForfeitWin(room)
    return
  }
  const left = activeHumans(room)
  const inPlay = room.game?.players.filter((p) => !p.out) ?? []
  if (left.length === 0) {
    await settleAbandoned(room)
    return
  }
  if (inPlay.length <= 1) {
    await awardForfeitWin(room)
    return
  }
  if (room.game) {
    const names = leavers.map((s) => s.name).join(', ')
    const note =
      leavers.length > 1
        ? `${names} ne sont pas revenus. La partie continue.`
        : `${names} n’est pas revenu. La partie continue.`
    room.game = { ...room.game, message: note }
  }
  armActor(room)
}

function armPaquetBots(room) {
  room.botDueAt = 0
  const game = room.game
  if (!isPaquetGame(game) || room.status !== 'playing' || isOver(game) || room.forfeitWinAt) return
  let wait = { elect: 6200, named: 5200, pick: 380, bet: 520, peek: 750, cover: 900, duel: 1700, runoff: 420, claim: 3600 }[game.phase]
  if (!wait) return
  if (
    (game.phase === 'pick' || game.phase === 'runoff') &&
    game.packets?.length &&
    game.packets.every((p) => !p.takenBy)
  ) {
    wait = Math.max(wait, 2400)
  }
  if (game.phase === 'pick' || game.phase === 'bet' || game.phase === 'runoff') {
    const actor = game.players.find((p) => p.color === game.actor)
    if (actor?.isHuman) return
  }
  if (game.phase === 'peek' || game.phase === 'cover') {
    const chef = game.players.find((p) => p.color === game.chef)
    if (chef?.isHuman) return
  }
  room.botDueAt = Date.now() + wait
}

function armActor(room) {
  armPaquetBots(room)
}

async function playBotStep(room) {
  if (room.status !== 'playing' || !room.game || isOver(room.game) || room.busy || room.forfeitWinAt) {
    room.botDueAt = 0
    return false
  }
  const before = room.game
  const next = stepAuto(before)
  if (next === before) {
    room.botDueAt = 0
    return false
  }
  room.game = next
  armPaquetBots(room)
  return true
}

async function playAction(room, fn, error) {
  const next = fn(room.game)
  if (next === room.game) throw Object.assign(new Error(error), { status: 400 })
  room.game = next
  armPaquetBots(room)
}

export async function roomPick({ code, address, packetId }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    if (seat.forfeited) throw Object.assign(new Error('Tu as quitté cette partie.'), { status: 403 })
    if (isLeaving(seat)) throw Object.assign(new Error('Tu as quitté. Reviens avant la fin du délai.'), { status: 403 })
    if (room.forfeitWinAt) throw Object.assign(new Error('En attente de forfait.'), { status: 400 })
    await playAction(room, (game) => pickPacket(game, seat.color, Number(packetId)), 'Ce n’est pas à toi de choisir.')
    await persist(room)
    return room
  })
}

export async function roomBet({ code, address, amount }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    if (seat.forfeited || isLeaving(seat) || room.forfeitWinAt) {
      throw Object.assign(new Error('Tu ne peux pas miser maintenant.'), { status: 403 })
    }
    await playAction(room, (game) => placeBet(game, seat.color, Number(amount)), 'Mise impossible.')
    await persist(room)
    return room
  })
}

export async function roomPeek({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    await playAction(room, (game) => peekChef(game, seat.color), 'Seul le chef regarde sa carte.')
    await persist(room)
    return room
  })
}

export async function roomCover({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    await playAction(room, (game) => coverCurrent(game, seat.color), 'Le chef doit suivre.')
    await persist(room)
    return room
  })
}

export async function roomNext({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    if (seat.forfeited) throw Object.assign(new Error('Tu as quitté cette partie.'), { status: 403 })
    if (isLeaving(seat)) throw Object.assign(new Error('Tu as quitté. Reviens avant la fin du délai.'), { status: 403 })
    if (room.forfeitWinAt) throw Object.assign(new Error('En attente de forfait.'), { status: 400 })
    await admitWaiters(room)
    if ((room.game.players?.length ?? 0) < 2) {
      room.game = { ...room.game, message: 'On attend un autre joueur.' }
      await persist(room)
      return room
    }
    await playAction(room, (game) => startNextHand(game), 'Le coup n’est pas fini.')
    await persist(room)
    return room
  })
}

export async function roomRebuy({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address && s.kind === 'human')
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    if (seat.forfeited || isLeaving(seat) || room.forfeitWinAt) {
      throw Object.assign(new Error('Tu ne peux pas ajouter maintenant.'), { status: 403 })
    }
    const who = room.game.players.find((p) => p.color === seat.color)
    if (!who) throw Object.assign(new Error('Joueur introuvable.'), { status: 404 })
    const buyIn = Math.max(1, room.stake)
    if (who.bet > 0) throw Object.assign(new Error('Tu as déjà une mise en jeu.'), { status: 400 })
    if (who.coins >= minBet(room.game)) {
      throw Object.assign(new Error('Tu as encore des jetons sur la table.'), { status: 400 })
    }
    const wallet = await getWallet(address)
    if (!wallet || wallet.coins < buyIn) {
      throw Object.assign(new Error('Pas assez en poche pour ajouter.'), { status: 400 })
    }
    await shiftCoins(address, -buyIn)
    room.game = {
      ...room.game,
      players: room.game.players.map((p) => (p.color === who.color ? { ...p, coins: p.coins + buyIn } : p)),
      message: `${who.name} ajoute ${formatLudo(buyIn)}.`,
    }
    await persist(room)
    return room
  })
}

export async function startRoom({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room) throw Object.assign(new Error('Salle introuvable.'), { status: 404 })
    if (room.status !== 'lobby') throw Object.assign(new Error('Partie déjà lancée.'), { status: 400 })

    const seated = room.seats.some((s) => s.address === address && s.kind === 'human' && !s.forfeited)
    if (!seated) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })

    await kickBrokeHumans(room)
    if (!room.seats.some((s) => s.address === address && s.kind === 'human')) {
      throw Object.assign(new Error('Il faut 3,50 Ł pour lancer.'), { status: 400 })
    }
    if (humanCount(room) < 2) {
      throw Object.assign(new Error('Encore un joueur. À deux on lance.'), { status: 400 })
    }
    await launchGame(room)
    await persist(room)
    return room
  })
}

export async function roomOffer({ code, address, amount }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    await playAction(room, (game) => offerChef(game, seat.color, Number(amount)), 'Tu ne peux pas vendre maintenant.')
    await persist(room)
    return room
  })
}

export async function roomBuy({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    await playAction(room, (game) => buyChef(game, seat.color), 'Tu ne peux pas acheter maintenant.')
    await persist(room)
    return room
  })
}

export async function roomCancelOffer({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing' || !isPaquetGame(room.game)) {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    await playAction(room, (game) => cancelOffer(game, seat.color), 'Pas d’offre.')
    await persist(room)
    return room
  })
}

const lastDiscoCheck = new Map()

function needsTick(room, now) {
  if (!room) return false
  if (room.startAt && room.status === 'lobby' && now >= room.startAt) return true
  if (room.forfeitWinAt && now >= room.forfeitWinAt) return true
  if (room.botDueAt && now >= room.botDueAt) return true
  const age = now - (room.touched || 0)
  if (room.status === 'lobby' && age > LOBBY_TTL_MS) return true
  if (room.status === 'ended' && age > ENDED_TTL_MS) return true
  if (room.status === 'playing' && room.game && !isOver(room.game)) {
    return now - (lastDiscoCheck.get(room.code) || 0) >= 2000
  }
  return false
}

async function tickRoom(code) {
  const lock = await acquireLock(code, 2500)
  if (!lock) return
  try {
    const room = await loadRoom(code)
    if (!room) return
    const now = Date.now()
    lastDiscoCheck.set(code, now)
    let dirty = false

    const age = now - (room.touched || 0)
    if (room.status === 'lobby' && room.kind === 'match') {
      if (await maybeAutoStart(room)) dirty = true
    }

    if (room.status === 'lobby' && age > LOBBY_TTL_MS) {
      lastDiscoCheck.delete(room.code)
      await deleteRoom(room.code)
      bus.emit('room:gone', room.code)
      return
    }
    if (room.status === 'ended' && age > ENDED_TTL_MS) {
      lastDiscoCheck.delete(room.code)
      await deleteRoom(room.code)
      bus.emit('room:gone', room.code)
      return
    }

    if (room.forfeitWinAt && now >= room.forfeitWinAt && room.status === 'playing' && !isOver(room.game)) {
      await resolveQuitTimer(room)
      dirty = true
    }

    if (!room.forfeitWinAt && syncDisconnects(room)) {
      armActor(room)
      dirty = true
    }

    if (!room.forfeitWinAt && room.botDueAt && now >= room.botDueAt) {
      if (await playBotStep(room)) dirty = true
    }

    if (dirty) await persist(room)
  } finally {
    await lock.release()
  }
}

export async function sweepRooms() {
  const now = Date.now()
  for (const room of await listRooms()) {
    if (!needsTick(room, now)) continue
    await tickRoom(room.code)
  }
}

export function startRoomJanitor() {
  setInterval(() => {
    void sweepRooms()
  }, 200).unref()
}
