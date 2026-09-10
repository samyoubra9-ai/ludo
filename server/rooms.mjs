import { randomBytes } from 'node:crypto'
import { db, tx } from './db.mjs'
import {
  applyMove,
  applyRoll,
  COLORS,
  colorsForCount,
  createGameFromPlayers,
  currentPlayer,
  pickBotMove,
  rollDie,
  skipOutPlayers,
} from './ludo.mjs'
import { isAllowedStake, rakeOf, winnerPayout } from './economy.mjs'
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

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LOBBY_TTL_MS = 45 * 60 * 1000
const ENDED_TTL_MS = 2 * 60 * 1000
const ONLINE_MS = 8 * 1000
const DISCONNECT_GRACE_MS = 25 * 1000
const FORFEIT_GRACE_MS = 20 * 1000
const TURN_MS = 15 * 1000
const BOT_DELAY_MS = 700
const ROLL_DELAY_MS = 720
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

async function deductStake(address, stake, matchId, players) {
  return tx(async () => {
    const locked = await db.prepare('SELECT address, coins FROM wallets WHERE address = ? FOR UPDATE').get(address)
    if (!locked) throw new Error('Wallet introuvable.')
    const already = await db.prepare('SELECT id FROM matches WHERE id = ?').get(matchId)
    if (already) return locked
    const cut = await db
      .prepare('UPDATE wallets SET coins = coins - ?, updated_at = ? WHERE address = ? AND coins >= ?')
      .run(stake, nowIso(), address, stake)
    if (!cut.changes) throw new Error('LUDO insuffisant.')
    await db
      .prepare('INSERT INTO matches (id, address, stake, players, settled, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(matchId, address, stake, players, nowIso())
    return { address, coins: locked.coins - stake }
  })
}

async function settleHuman(address, matchId, won, pot) {
  return tx(async () => {
    const match = await db
      .prepare('SELECT * FROM matches WHERE id = ? AND address = ? FOR UPDATE')
      .get(matchId, address)
    const wallet = await db.prepare('SELECT address, coins FROM wallets WHERE address = ? FOR UPDATE').get(address)
    if (!wallet) throw new Error('Wallet introuvable.')
    let coins = wallet.coins
    if (match && !match.settled) {
      const payout = won ? winnerPayout(pot) : 0
      if (payout) {
        await db
          .prepare('UPDATE wallets SET coins = coins + ?, updated_at = ? WHERE address = ?')
          .run(payout, nowIso(), address)
        coins += payout
      }
      await db.prepare('UPDATE matches SET settled = 1, won = ? WHERE id = ?').run(won ? 1 : 0, matchId)
    }
    return refillIfNeeded({ address, coins })
  })
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
    ? `${botsFor.join(', ')} hors ligne — un bot joue pour ${botsFor.length > 1 ? 'eux' : 'lui'}.`
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
    game: room.game,
    coins,
    humans: humanCount(room),
    rev: room.rev || 0,
    notice,
    forfeitWinAt: room.forfeitWinAt || 0,
    turnDueAt: room.turnDueAt || 0,
    startAt: room.startAt || 0,
    kind: room.kind === 'match' ? 'match' : 'private',
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
  }
  return false
}

export async function activeRoomFor(address) {
  for (const room of await listRooms()) {
    if (room.status === 'ended') continue
    if (room.seats.some((seat) => seat.kind === 'human' && seat.address === address && !seat.forfeited)) return room
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
  if ((count !== 2 && count !== 4) || !isAllowedStake(stake) || !COLORS.includes(color)) {
    throw Object.assign(new Error('Paramètres invalides.'), { status: 400 })
  }
  const hostWallet = await getWallet(address)
  if (!hostWallet || hostWallet.coins < stake) {
    throw Object.assign(new Error('LUDO insuffisant.'), { status: 400 })
  }

  const colors = colorsForCount(count, color)
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
    }
    if (await createRoomExclusive(room)) return room
  }
  throw new Error('Impossible de créer un code.')
}

export async function matchmake({ address, name, color, count, stake }) {
  if ((count !== 2 && count !== 4) || !isAllowedStake(stake) || !COLORS.includes(color)) {
    throw Object.assign(new Error('Paramètres invalides.'), { status: 400 })
  }
  const seeker = await getWallet(address)
  if (!seeker || seeker.coins < stake) {
    throw Object.assign(new Error('LUDO insuffisant.'), { status: 400 })
  }

  const existing = await activeRoomFor(address)
  if (existing) return existing

  const lock = await acquireLock(`MM-${count}-${stake}`, 5000)
  if (!lock) throw Object.assign(new Error('Recherche occupée, réessaie.'), { status: 409 })
  try {
    const again = await activeRoomFor(address)
    if (again) return again

    for (const candidate of await listRooms()) {
      if (candidate.kind !== 'match' || candidate.status !== 'lobby') continue
      if (candidate.count !== count || candidate.stake !== stake) continue
      if (candidate.seats.some((s) => s.address === address)) {
        return (await loadRoom(candidate.code)) || candidate
      }
      if (!candidate.seats.some((s) => s.kind === 'empty')) continue
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

    if (room.status !== 'lobby') {
      throw Object.assign(new Error('La partie a déjà commencé.'), { status: 400 })
    }

    const wanted = color && room.seats.some((s) => s.color === color && s.kind === 'empty')
      ? color
      : room.seats.find((s) => s.kind === 'empty')?.color
    if (!wanted) throw Object.assign(new Error('Salle complète.'), { status: 400 })

    const joiner = await getWallet(address)
    if (!joiner || joiner.coins < room.stake) {
      throw Object.assign(new Error('LUDO insuffisant pour cette mise.'), { status: 400 })
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

function fillBots(room) {
  let bot = 0
  room.seats = room.seats.map((seat) => {
    if (seat.kind !== 'empty') return seat
    bot += 1
    return {
      color: seat.color,
      name: `Bot ${bot}`,
      address: null,
      kind: 'bot',
      lastSeen: 0,
      botPlay: false,
      forfeited: false,
      quitAt: 0,
    }
  })
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

async function launchGame(room, { fillEmpty = true } = {}) {
  if (fillEmpty) fillBots(room)
  for (const seat of room.seats) {
    if (seat.kind !== 'human' || !seat.address) continue
    if (((await getWallet(seat.address))?.coins ?? 0) < room.stake) {
      throw Object.assign(new Error(`${seat.name} n’a plus assez de LUDO.`), { status: 400 })
    }
  }

  const matchId = randomBytes(16).toString('hex')
  const humanSeats = room.seats.filter((s) => s.kind === 'human' && s.address)
  const wallets = {}
  for (const seat of humanSeats) {
    wallets[seat.address] = await deductStake(seat.address, room.stake, `${matchId}:${seat.address}`, humanSeats.length)
  }

  const players = room.seats.map((seat) => ({
    color: seat.color,
    name: seat.name,
    isHuman: seat.kind === 'human',
    coins:
      seat.kind === 'human' && seat.address
        ? wallets[seat.address].coins
        : room.stake,
  }))

  room.matchId = matchId
  room.game = createGameFromPlayers(matchId, players, room.stake, room.hostColor)
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
    await launchGame(room, { fillEmpty: false })
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
    message: `${seat.name} a perdu la connexion. Un bot joue pour lui.`,
  }
  return true
}

function syncDisconnects(room) {
  if (room.status !== 'playing' || !room.game || room.game.winner || room.forfeitWinAt) return false
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
  const pot = room.game?.pot || 0
  if (room.matchId) {
    for (const seat of room.seats) {
      if (seat.kind !== 'human' || !seat.address) continue
      const paid = await settleHuman(seat.address, `${room.matchId}:${seat.address}`, false, pot)
      const player = room.game?.players.find((p) => p.color === seat.color)
      if (player) player.coins = paid.coins
    }
  }
  if (room.game) {
    room.game = {
      ...room.game,
      winner: null,
      phase: 'ended',
      movable: [],
      message: 'Tout le monde a quitté. Pot pour la maison.',
    }
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
  room.game = {
    ...room.game,
    winner: winner.color,
    phase: 'ended',
    movable: [],
    message: `${winner.name} gagne par forfait. Pot ${room.game.pot} LUDO · maison ${rakeOf(room.game.pot)} · net ${winnerPayout(room.game.pot)}.`,
  }
  room.forfeitWinAt = 0
  await settleRoom(room)
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
  if (room.status !== 'playing' || room.game?.winner) {
    room.forfeitWinAt = 0
    return
  }
  const leavers = leavingSeats(room)
  for (const seat of leavers) {
    seat.forfeited = true
    seat.quitAt = 0
    seat.botPlay = false
    setPlayerOut(room, seat.color, true)
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
        ? `${names} ne sont pas revenus. Leurs mises restent au pot. La partie continue.`
        : `${names} n’est pas revenu. Sa mise reste au pot. La partie continue.`
    room.game = skipOutPlayers({ ...room.game, message: note }, note)
  }
  armActor(room)
}

async function settleRoom(room) {
  if (!room.game?.winner || !room.matchId) return
  const winner = room.game.players.find((p) => p.color === room.game.winner)
  const pot = room.game.pot
  for (const seat of room.seats) {
    if (seat.kind !== 'human' || !seat.address) continue
    const matchId = `${room.matchId}:${seat.address}`
    const paid = await settleHuman(
      seat.address,
      matchId,
      Boolean(winner) && seat.color === winner.color && !seat.forfeited && !winner.out,
      pot,
    )
    const player = room.game.players.find((p) => p.color === seat.color)
    if (player) player.coins = paid.coins
  }
  room.status = 'ended'
  room.botDueAt = 0
  room.rollDueAt = 0
  room.busy = false
  room.rolling = false
  room.forfeitWinAt = 0
  room.turnDueAt = 0
}

function armBot(room, delay = BOT_DELAY_MS) {
  if (room.status !== 'playing' || !room.game || room.game.winner || room.busy || room.forfeitWinAt) {
    room.botDueAt = 0
    return
  }
  const player = currentPlayer(room.game)
  if (!player || player.isHuman) {
    room.botDueAt = 0
    return
  }
  room.botDueAt = Date.now() + delay
}

function armTurn(room) {
  room.turnDueAt = 0
  if (room.status !== 'playing' || !room.game || room.game.winner || room.busy || room.rolling || room.forfeitWinAt) {
    return
  }
  const player = currentPlayer(room.game)
  if (!player?.isHuman) return
  if (room.game.phase !== 'to-roll' && room.game.phase !== 'to-move') return
  room.turnDueAt = Date.now() + TURN_MS
}

function armActor(room) {
  if (room.game && !room.forfeitWinAt) room.game = skipOutPlayers(room.game)
  armBot(room)
  armTurn(room)
}

async function playTurnTimeout(room) {
  if (!room.turnDueAt || Date.now() < room.turnDueAt) return false
  if (room.forfeitWinAt || room.busy || room.rolling || !room.game || room.game.winner) {
    room.turnDueAt = 0
    return false
  }
  const player = currentPlayer(room.game)
  if (!player?.isHuman) {
    room.turnDueAt = 0
    return false
  }
  if (room.game.phase === 'to-roll') {
    return beginRoll(room)
  }
  if (room.game.phase === 'to-move') {
    const id = pickBotMove(room.game)
    if (id) room.game = applyMove(room.game, id)
    if (room.game.winner) await settleRoom(room)
    else armActor(room)
    return true
  }
  room.turnDueAt = 0
  return false
}

function beginRoll(room) {
  if (
    room.busy ||
    room.rolling ||
    room.forfeitWinAt ||
    !room.game ||
    room.game.phase !== 'to-roll' ||
    room.game.winner
  ) {
    return false
  }
  const outcome = rollDie(room.game)
  room.busy = true
  room.rolling = true
  room.rollDueAt = Date.now() + ROLL_DELAY_MS
  room.rollValue = outcome.value
  room.rollPity = outcome.pity
  room.botDueAt = 0
  room.turnDueAt = 0
  return true
}

async function finishRoll(room) {
  if (!room.game || room.status !== 'playing') {
    room.rolling = false
    room.busy = false
    room.rollDueAt = 0
    return
  }
  try {
    room.game = applyRoll(room.game, room.rollValue, room.rollPity)
  } catch (error) {
    console.error(error)
  }
  room.rolling = false
  room.busy = false
  room.rollDueAt = 0
  room.rollValue = 0
  room.rollPity = false
  if (room.game?.winner) await settleRoom(room)
  else armActor(room)
}

async function playBotStep(room) {
  if (room.status !== 'playing' || !room.game || room.game.winner || room.busy || room.forfeitWinAt) {
    room.botDueAt = 0
    return false
  }
  const now = currentPlayer(room.game)
  if (!now || now.isHuman) {
    room.botDueAt = 0
    return false
  }
  if (room.game.phase === 'to-roll') {
    return beginRoll(room)
  }
  if (room.game.phase === 'to-move') {
    const id = pickBotMove(room.game)
    if (id) room.game = applyMove(room.game, id)
    if (room.game.winner) await settleRoom(room)
    else armActor(room)
    return true
  }
  room.botDueAt = 0
  return false
}

export async function roomRoll({ code, address }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing') {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    if (seat.forfeited) throw Object.assign(new Error('Tu as quitté cette partie.'), { status: 403 })
    if (isLeaving(seat)) throw Object.assign(new Error('Tu as quitté. Reviens avant la fin du délai.'), { status: 403 })
    if (room.forfeitWinAt) {
      throw Object.assign(new Error('En attente de forfait.'), { status: 400 })
    }
    if (room.busy || room.rolling) {
      throw Object.assign(new Error('Le dé tourne déjà.'), { status: 409 })
    }
    if (room.game.turn !== seat.color || room.game.phase !== 'to-roll') {
      throw Object.assign(new Error('Ce n’est pas à toi de lancer.'), { status: 400 })
    }
    if (!beginRoll(room)) {
      throw Object.assign(new Error('Ce n’est pas à toi de lancer.'), { status: 400 })
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

    if (room.kind === 'match') {
      if (humanCount(room) < room.count) {
        throw Object.assign(new Error('Le matchmaking attend encore des joueurs.'), { status: 400 })
      }
      await maybeAutoStart(room)
      await persist(room)
      return room
    }

    if (room.host !== address) throw Object.assign(new Error('Seul l’hôte lance la partie.'), { status: 403 })
    if (humanCount(room) < 2) {
      throw Object.assign(new Error('Attends qu’un autre joueur rejoigne.'), { status: 400 })
    }

    await launchGame(room, { fillEmpty: true })
    await persist(room)
    return room
  })
}

export async function roomMove({ code, address, tokenId }) {
  return withRoom(code, async (room) => {
    if (!room?.game || room.status !== 'playing') {
      throw Object.assign(new Error('Partie introuvable.'), { status: 404 })
    }
    applyTouch(room, address)
    if (room.busy) throw Object.assign(new Error('Attends le dé.'), { status: 400 })
    const seat = room.seats.find((s) => s.address === address)
    if (!seat) throw Object.assign(new Error('Tu n’es pas dans cette salle.'), { status: 403 })
    if (seat.forfeited) throw Object.assign(new Error('Tu as quitté cette partie.'), { status: 403 })
    if (isLeaving(seat)) throw Object.assign(new Error('Tu as quitté. Reviens avant la fin du délai.'), { status: 403 })
    if (room.forfeitWinAt) {
      throw Object.assign(new Error('En attente de forfait.'), { status: 400 })
    }
    if (room.game.turn !== seat.color || room.game.phase !== 'to-move') {
      throw Object.assign(new Error('Ce n’est pas à toi de jouer.'), { status: 400 })
    }
    const next = applyMove(room.game, String(tokenId || ''))
    if (next === room.game) throw Object.assign(new Error('Coup invalide.'), { status: 400 })
    room.game = next
    if (room.game.winner) await settleRoom(room)
    else armActor(room)
    await persist(room)
    return room
  })
}

const lastDiscoCheck = new Map()

function needsTick(room, now) {
  if (!room) return false
  if (room.startAt && room.status === 'lobby' && now >= room.startAt) return true
  if (room.forfeitWinAt && now >= room.forfeitWinAt) return true
  if (room.turnDueAt && now >= room.turnDueAt) return true
  if (room.rollDueAt && now >= room.rollDueAt) return true
  if (room.botDueAt && now >= room.botDueAt) return true
  const age = now - (room.touched || 0)
  if (room.status === 'lobby' && age > LOBBY_TTL_MS) return true
  if (room.status === 'ended' && age > ENDED_TTL_MS) return true
  if (room.status === 'playing' && room.game && !room.game.winner) {
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

    if (room.forfeitWinAt && now >= room.forfeitWinAt && room.status === 'playing' && !room.game?.winner) {
      await resolveQuitTimer(room)
      dirty = true
    }

    if (!room.forfeitWinAt && room.rollDueAt && now >= room.rollDueAt) {
      await finishRoll(room)
      dirty = true
    }

    if (!room.forfeitWinAt && (await playTurnTimeout(room))) {
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
