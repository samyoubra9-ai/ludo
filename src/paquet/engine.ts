import { formatLudo, rakeOf, winnerPayout } from '../ludo/wallet'
import { PAQUET_COLORS, PAQUET_PALETTE, type PaquetColor } from './palette'

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type PaquetPhase =
  | 'elect'
  | 'named'
  | 'pick'
  | 'bet'
  | 'peek'
  | 'cover'
  | 'duel'
  | 'runoff'
  | 'claim'
  | 'hand'
  | 'ended'

export type Card = { rank: number; suit: Suit }

export type PaquetPlayer = {
  color: PaquetColor
  name: string
  isHuman: boolean
  coins: number
  packet: number | null
  bet: number
  electCard: Card | null
  peeked: boolean
  settled: boolean
  bank: number
  out?: boolean
}

export type Packet = {
  id: number
  card: Card | null
  takenBy: PaquetColor | null
}

export type DuelLog = {
  vs: PaquetColor
  chef: PaquetColor
  winner: PaquetColor
  bet: number
  payout: number
  chefCard: Card
  playerCard: Card
}

export type PaquetState = {
  table: 'paquet'
  id: string
  hand: number
  paid: boolean
  players: PaquetPlayer[]
  packets: Packet[]
  phase: PaquetPhase
  chef: PaquetColor | null
  actor: PaquetColor | null
  challenger: PaquetColor | null
  revealed: number[]
  message: string
  winner: PaquetColor | null
  stake: number
  pot: number
  lastDuel: DuelLog | null
  log: DuelLog[]
  nextChef: PaquetColor | null
  claimants: PaquetColor[]
  offer: number | null
}

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const SUIT_RANK: Record<Suit, number> = { clubs: 1, diamonds: 2, hearts: 3, spades: 4 }
const BOTS = ['Karim', 'Yanis', 'Sofia', 'Nour', 'Mehdi', 'Lina', 'Riad']

export function rankLabel(rank: number) {
  if (rank === 14) return 'A'
  if (rank === 13) return 'R'
  if (rank === 12) return 'D'
  if (rank === 11) return 'V'
  return String(rank)
}

export function suitMark(suit: Suit) {
  if (suit === 'spades') return '♠'
  if (suit === 'hearts') return '♥'
  if (suit === 'diamonds') return '♦'
  return '♣'
}

export function suitRed(suit: Suit) {
  return suit === 'hearts' || suit === 'diamonds'
}

export function cardPower(card: Card) {
  return card.rank * 10 + SUIT_RANK[card.suit]
}

export function cardLabel(card: Card) {
  return `${rankLabel(card.rank)}${suitMark(card.suit)}`
}

function shuffle<T>(items: T[]) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function deck(): Card[] {
  const cards: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank += 1) cards.push({ rank, suit })
  }
  return shuffle(cards)
}

function blankPlayer(partial: Partial<PaquetPlayer> & Pick<PaquetPlayer, 'color' | 'name' | 'isHuman' | 'coins'>): PaquetPlayer {
  return {
    packet: null,
    bet: 0,
    electCard: null,
    peeked: false,
    settled: false,
    bank: partial.coins,
    ...partial,
  }
}

export function minBet(state: PaquetState) {
  return Math.max(1, state.stake)
}

export function botStack(stake: number) {
  return Math.max(1, stake || 230) * 40
}

function player(state: PaquetState, color: PaquetColor | null) {
  return state.players.find((p) => p.color === color) ?? null
}

export function chefOf(state: PaquetState) {
  return player(state, state.chef)
}

export function heirOf(state: PaquetState) {
  return player(state, state.nextChef)
}

export function aceEaters(log: DuelLog[] | undefined) {
  const seen: PaquetColor[] = []
  for (const d of log ?? []) {
    if (d.winner !== d.vs || d.playerCard?.rank !== 14) continue
    if (!seen.includes(d.vs)) seen.push(d.vs)
  }
  return seen
}

export function salePrices(state: PaquetState) {
  const min = minBet(state)
  return [...new Set([min, min * 2, min * 5, min * 10])].filter((n) => n > 0)
}

export function clampBet(state: PaquetState, color: PaquetColor, amount: number) {
  const who = player(state, color)
  if (!who) return 0
  const min = minBet(state)
  const max = who.coins
  if (max < min) return 0
  const value = Math.floor(Number(amount))
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function handDelta(who: PaquetPlayer) {
  return who.coins - (who.bank ?? who.coins)
}

export function houseTake(state: PaquetState) {
  if (!state.paid) return 0
  return (state.log ?? []).reduce((sum, line) => sum + (line.bet * 2 - line.payout), 0)
}

export function isRecap(state: PaquetState) {
  return state.phase === 'hand'
}

export function actorOf(state: PaquetState) {
  return player(state, state.actor)
}

export function youOf(state: PaquetState) {
  return state.players.find((p) => p.isHuman) ?? state.players[0]
}

export function isOver(state: PaquetState) {
  return state.phase === 'ended'
}

function chefIndex(state: PaquetState) {
  const i = state.players.findIndex((p) => p.color === state.chef)
  return i >= 0 ? i : 0
}

export function aroundChef(state: PaquetState) {
  const n = state.players.length
  const start = chefIndex(state)
  return Array.from({ length: Math.max(0, n - 1) }, (_, k) => state.players[(start + k + 1) % n]!).filter(Boolean)
}

export function nextOpenBet(state: PaquetState, after: PaquetColor | null) {
  const n = state.players.length
  let i = state.players.findIndex((p) => p.color === (after ?? state.chef))
  if (i < 0) i = chefIndex(state)
  for (let k = 1; k <= n; k += 1) {
    const p = state.players[(i + k) % n]!
    if (p.color === state.chef || p.out || p.settled || p.bet <= 0) continue
    return p
  }
  return null
}

function say(state: PaquetState, message: string, extra: Partial<PaquetState> = {}): PaquetState {
  return { ...state, message, ...extra }
}

function mapPlayer(state: PaquetState, color: PaquetColor, fn: (p: PaquetPlayer) => PaquetPlayer) {
  return state.players.map((p) => (p.color === color ? fn(p) : p))
}

export function createPaquet(name: string, stake: number, coins: number, matchId?: string): PaquetState {
  const you = name.trim() || 'Toi'
  const stack = Math.max(coins, botStack(stake || 230))
  const players = PAQUET_COLORS.map((color, i) =>
    blankPlayer({
      color,
      name: i === 0 ? you : BOTS[i - 1] || `Bot ${i}`,
      isHuman: i === 0,
      coins: i === 0 ? Math.max(coins, stack) : stack,
    }),
  )
  return createPaquetFromPlayers(matchId || `pp-${Date.now().toString(16)}`, players, stake, false)
}

export function createPaquetFromPlayers(
  id: string,
  players: PaquetPlayer[] | Array<Partial<PaquetPlayer> & Pick<PaquetPlayer, 'color' | 'name' | 'isHuman' | 'coins'>>,
  stake: number,
  paid = true,
  chef: PaquetColor | null = null,
): PaquetState {
  const table: PaquetState = {
    table: 'paquet',
    id,
    hand: 1,
    paid,
    players: players.map((p) => blankPlayer(p)),
    packets: [],
    phase: chef ? 'pick' : 'elect',
    chef,
    actor: null,
    challenger: null,
    revealed: [],
    message: '',
    winner: null,
    stake,
    pot: 0,
    lastDuel: null,
    log: [],
    nextChef: null,
    claimants: [],
    offer: null,
  }
  return chef ? dealPackets(table) : dealElect(table)
}

function dealElect(state: PaquetState): PaquetState {
  const cards = deck().slice(0, state.players.length)
  return say(
    {
      ...state,
      phase: 'elect',
      actor: null,
      challenger: null,
      packets: [],
      revealed: [],
      lastDuel: null,
      log: [],
      nextChef: null,
      claimants: [],
      offer: null,
      players: state.players.map((p, i) => ({
        ...p,
        packet: null,
        bet: 0,
        electCard: cards[i]!,
        peeked: false,
        settled: false,
        bank: p.coins,
      })),
    },
    'Une carte chacun. La plus haute est chef.',
  )
}

export function resolveElect(state: PaquetState): PaquetState {
  if (state.phase !== 'elect') return state
  const best = state.players.reduce((top, p) => {
    if (!p.electCard) return top
    if (!top.electCard) return p
    return cardPower(p.electCard) > cardPower(top.electCard) ? p : top
  })
  if (!best.electCard) return state
  return say(
    {
      ...state,
      phase: 'named',
      chef: best.color,
      actor: null,
    },
    `${best.name} est chef · ${cardLabel(best.electCard)}.`,
  )
}

function dealPackets(state: PaquetState): PaquetState {
  const cards = deck().slice(0, state.players.length)
  const next: PaquetState = {
    ...state,
    phase: 'pick',
    actor: aroundChef(state)[0]?.color ?? null,
    challenger: null,
    revealed: [],
    pot: 0,
    lastDuel: null,
    log: [],
    packets: cards.map((card, id) => ({ id, card, takenBy: null })),
    players: state.players.map((p) => ({
      ...p,
      packet: null,
      bet: 0,
      electCard: null,
      peeked: false,
      settled: false,
      bank: p.coins,
    })),
  }
  const first = actorOf(next)
  return say(next, first ? `${first.name} prend un paquet.` : 'Prenez un paquet.')
}

export function freePackets(state: PaquetState) {
  return state.packets.filter((p) => !p.takenBy).map((p) => p.id)
}

export function pickPacket(state: PaquetState, color: PaquetColor, packetId: number): PaquetState {
  const runoff = state.phase === 'runoff'
  if ((state.phase !== 'pick' && !runoff) || state.actor !== color) return state
  const who = player(state, color)
  const packet = state.packets.find((p) => p.id === packetId)
  const claimed = state.claimants ?? []
  if (!who || who.packet != null || !packet || packet.takenBy) return state
  if (!runoff && color === state.chef) return state
  if (runoff && !claimed.includes(color)) return state
  const packets = state.packets.map((p) => (p.id === packetId ? { ...p, takenBy: color } : p))
  const players = mapPlayer(state, color, (p) => ({ ...p, packet: packetId }))
  const taken = { ...state, packets, players }
  if (runoff) {
    const next = claimed.find((c) => taken.players.find((p) => p.color === c)?.packet == null)
    if (!next) return resolveRunoff(taken)
    const left = claimed.filter((c) => taken.players.find((p) => p.color === c)?.packet == null).length
    return say({ ...taken, actor: next }, `${who.name} a pris. ${left} encore.`)
  }
  const left = packets.filter((p) => !p.takenBy).length
  if (left <= 1) return giveLastToChef(taken)
  const next = aroundChef(taken).find((p) => p.packet == null)
  return say(
    { ...taken, actor: next?.color ?? null },
    `${who.name} a pris. ${left - 1} restant${left - 1 > 1 ? 's' : ''}.`,
  )
}

function giveLastToChef(state: PaquetState): PaquetState {
  const chef = chefOf(state)
  const last = state.packets.find((p) => !p.takenBy)
  if (!chef || !last) return beginBets(state)
  return beginBets({
    ...state,
    packets: state.packets.map((p) => (p.id === last.id ? { ...p, takenBy: chef.color } : p)),
    players: mapPlayer(state, chef.color, (p) => ({ ...p, packet: last.id })),
  })
}

function beginBets(state: PaquetState): PaquetState {
  const next = aroundChef(state).find((p) => !p.out && p.coins >= minBet(state))
  if (!next) return say({ ...state, phase: 'hand', actor: null }, 'Personne ne peut miser. Prochain coup.')
  return say(
    { ...state, phase: 'bet', actor: next.color, challenger: null },
    `${next.name} mise. Minimum ${formatLudo(minBet(state))}.`,
  )
}

export function betOptions(state: PaquetState, color: PaquetColor) {
  const who = player(state, color)
  if (!who) return []
  const min = minBet(state)
  const max = who.coins
  if (max < min) return []
  const opts = [min, min * 2, min * 5].filter((n) => n <= max)
  if (!opts.includes(max)) opts.push(max)
  return [...new Set(opts)]
}

export function placeBet(state: PaquetState, color: PaquetColor, amount: number): PaquetState {
  if (state.phase !== 'bet' || state.actor !== color || color === state.chef) return state
  const who = player(state, color)
  const value = clampBet(state, color, amount)
  if (!who || who.bet > 0 || !value) return state
  const players = mapPlayer(state, color, (p) => ({ ...p, coins: p.coins - value, bet: value }))
  const taken = { ...state, players }
  const next = aroundChef(taken).find((p) => !p.out && p.bet === 0 && p.packet != null && p.coins >= minBet(state))
  if (!next) return beginPeek(taken)
  return say(
    { ...taken, actor: next.color },
    `${who.name} · ${formatLudo(value)}. ${next.name} à suivre.`,
  )
}

function beginPeek(state: PaquetState): PaquetState {
  const chef = chefOf(state)
  return say(
    { ...state, phase: 'peek', actor: chef?.color ?? null, challenger: null },
    chef ? `${chef.name} regarde. Lui seul.` : 'Le chef regarde.',
  )
}

export function peekChef(state: PaquetState, color: PaquetColor): PaquetState {
  if (state.phase !== 'peek' || state.chef !== color) return state
  const chef = chefOf(state)
  if (!chef) return state
  const first = aroundChef(state).find((p) => p.bet > 0 && !p.settled)
  if (!first) return say({ ...state, phase: 'hand', actor: null }, 'Aucune mise. Prochain coup.')
  return say(
    {
      ...state,
      phase: 'cover',
      actor: chef.color,
      challenger: first.color,
      players: mapPlayer(state, chef.color, (p) => ({ ...p, peeked: true })),
    },
    `1 contre 1 · ${first.name} ${formatLudo(first.bet)}.`,
  )
}

export function coverCurrent(state: PaquetState, color: PaquetColor): PaquetState {
  if (state.phase !== 'cover' || state.chef !== color || !state.challenger) return state
  const chef = chefOf(state)
  const vs = player(state, state.challenger)
  if (!chef || !vs || vs.bet <= 0) return state
  const cover = Math.min(vs.bet, chef.coins)
  if (cover <= 0) {
    const refunded: PaquetState = {
      ...state,
      players: state.players.map((p) =>
        p.color === vs.color ? { ...p, coins: p.coins + p.bet, bet: 0, settled: true } : p,
      ),
      challenger: null,
      pot: 0,
    }
    const following = nextOpenBet(refunded, vs.color)
    if (!following) {
      return say(
        { ...refunded, phase: 'hand', actor: null },
        `${chef.name} ne peut plus suivre. Coup fini.`,
      )
    }
    return say(
      {
        ...refunded,
        phase: 'cover',
        actor: chef.color,
        challenger: following.color,
        pot: following.bet * 2,
      },
      `${chef.name} ne peut plus aligner ${vs.name}. ${following.name} ensuite.`,
    )
  }
  const refund = vs.bet - cover
  const players = state.players.map((p) => {
    if (p.color === chef.color) return { ...p, coins: p.coins - cover }
    if (p.color === vs.color && refund) return { ...p, coins: p.coins + refund, bet: cover }
    return p
  })
  const vsPacket = players.find((p) => p.color === vs.color)?.packet
  const chefPacket = chef.packet
  const revealed = [...state.revealed]
  if (typeof vsPacket === 'number' && !revealed.includes(vsPacket)) revealed.push(vsPacket)
  if (typeof chefPacket === 'number' && !revealed.includes(chefPacket)) revealed.push(chefPacket)
  return say(
    { ...state, phase: 'duel', players, pot: cover * 2, revealed, actor: chef.color },
    'On compare.',
  )
}

export function resolveDuel(state: PaquetState): PaquetState {
  if (state.phase !== 'duel' || !state.chef || !state.challenger) return state
  const chef = chefOf(state)
  const vs = player(state, state.challenger)
  const chefPack = state.packets.find((p) => p.id === chef?.packet)
  const vsPack = state.packets.find((p) => p.id === vs?.packet)
  if (!chef || !vs || !chefPack?.card || !vsPack?.card) return state
  const playerWins = cardPower(vsPack.card) > cardPower(chefPack.card)
  const winner = playerWins ? vs : chef
  const bet = vs.bet
  const pot = bet * 2
  const payout = state.paid ? winnerPayout(pot) : pot
  const house = state.paid ? rakeOf(pot) : 0
  const lastDuel: DuelLog = {
    vs: vs.color,
    chef: chef.color,
    winner: winner.color,
    bet,
    payout,
    chefCard: chefPack.card,
    playerCard: vsPack.card,
  }
  const players = state.players.map((p) => {
    if (p.color === vs.color) {
      return { ...p, coins: p.coins + (playerWins ? payout : 0), settled: true, bet: 0 }
    }
    if (p.color === chef.color && !playerWins) return { ...p, coins: p.coins + payout }
    return p
  })
  const log = [...(state.log ?? []), lastDuel]
  const claimants = aceEaters(log)
  const nextChef = claimants.length === 1 ? claimants[0]! : null
  const next: PaquetState = { ...state, lastDuel, log, pot, players, nextChef, claimants }
  const following = nextOpenBet(next, vs.color)
  const houseNote = house ? ` Maison ${formatLudo(house)}.` : ''
  const aceNote = playerWins && vsPack.card.rank === 14
    ? claimants.length > 1
      ? ' Plusieurs as · barrage à la fin.'
      : ` As · ${vs.name} vise le chef.`
    : ` ${chef.name} reste chef.`
  if (playerWins) {
    const take = `${vs.name} mange · ${cardLabel(vsPack.card)} > ${cardLabel(chefPack.card)} · ${formatLudo(payout)}`
    if (following) {
      return say(
        {
          ...next,
          phase: 'cover',
          actor: chef.color,
          challenger: following.color,
          pot: following.bet * 2,
        },
        `${take}.${aceNote} ${following.name}.`,
      )
    }
    return closeCoup(next, `${take}.${aceNote}${houseNote}`)
  }
  if (following) {
    return say(
      { ...next, phase: 'cover', actor: chef.color, challenger: following.color, pot: following.bet * 2 },
      `${chef.name} mange ${vs.name} · ${cardLabel(chefPack.card)} > ${cardLabel(vsPack.card)} · ${formatLudo(payout)}. ${following.name}.`,
    )
  }
  return closeCoup(
    next,
    `${chef.name} mange ${vs.name} · ${cardLabel(chefPack.card)} > ${cardLabel(vsPack.card)} · ${formatLudo(payout)}. ${chef.name} tient.${houseNote}`,
  )
}

function refundPending(state: PaquetState): PaquetState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.color !== state.chef && p.bet > 0 && !p.settled ? { ...p, coins: p.coins + p.bet, bet: 0 } : p,
    ),
  }
}

function closeCoup(state: PaquetState, message: string): PaquetState {
  const eaters = aceEaters(state.log)
  if (eaters.length >= 2) return beginRunoff({ ...state, claimants: eaters }, message)
  const nextChef = eaters[0] ?? null
  const chef = nextChef || state.chef
  const named = player(state, chef)
  const note =
    nextChef && nextChef !== state.chef && named
      ? ` ${named.name} a mangé au as. Il est chef.`
      : ` ${named?.name ?? 'Le chef'} reste chef.`
  return say(
    {
      ...state,
      phase: 'hand',
      chef,
      nextChef,
      actor: null,
      challenger: null,
      offer: null,
      claimants: eaters,
    },
    `${message}${note}`,
  )
}

function beginRunoff(state: PaquetState, prefix: string): PaquetState {
  const claimants = state.claimants ?? []
  const cards = deck().slice(0, 5)
  const first = claimants[0] ?? null
  return say(
    {
      ...state,
      phase: 'runoff',
      actor: first,
      challenger: null,
      offer: null,
      packets: cards.map((card, id) => ({ id, card, takenBy: null })),
      players: state.players.map((p) => ({ ...p, packet: null, electCard: null })),
    },
    `${prefix} ${claimants.length} as. 5 paquets. La plus haute prend le chef.`,
  )
}

function resolveRunoff(state: PaquetState): PaquetState {
  const claimants = state.claimants ?? []
  const best = claimants.reduce<(PaquetPlayer & { card: Card }) | null>((top, color) => {
    const who = player(state, color)
    const pack = state.packets.find((p) => p.id === who?.packet)
    if (!who || !pack?.card) return top
    if (!top) return { ...who, card: pack.card }
    return cardPower(pack.card) > cardPower(top.card) ? { ...who, card: pack.card } : top
  }, null)
  if (!best) return say({ ...state, phase: 'hand', actor: null, offer: null }, 'Barrage sans carte. Le chef reste.')
  const revealed = state.packets.filter((p) => p.takenBy).map((p) => p.id)
  return say(
    {
      ...state,
      phase: 'claim',
      chef: best.color,
      nextChef: best.color,
      actor: null,
      challenger: null,
      offer: null,
      revealed,
    },
    `${best.name} prend le chef · ${cardLabel(best.card)}.`,
  )
}

export function offerChef(state: PaquetState, color: PaquetColor, amount: number): PaquetState {
  if (state.phase !== 'hand' || state.chef !== color) return state
  const chef = chefOf(state)
  const value = Math.floor(Number(amount))
  if (!chef || !Number.isFinite(value) || value < minBet(state)) return state
  return say({ ...state, offer: value }, `${chef.name} vend le chef · ${formatLudo(value)}.`)
}

export function cancelOffer(state: PaquetState, color: PaquetColor): PaquetState {
  if (state.phase !== 'hand' || state.chef !== color || !state.offer) return state
  const chef = chefOf(state)
  return say({ ...state, offer: null }, `${chef?.name ?? 'Chef'} garde le chef.`)
}

export function buyChef(state: PaquetState, color: PaquetColor): PaquetState {
  if (state.phase !== 'hand' || !state.offer || color === state.chef) return state
  const buyer = player(state, color)
  const chef = chefOf(state)
  const price = state.offer
  if (!buyer || !chef || buyer.out || buyer.coins < price) return state
  return say(
    {
      ...state,
      chef: buyer.color,
      nextChef: buyer.color,
      offer: null,
      claimants: [buyer.color],
      players: state.players.map((p) => {
        if (p.color === buyer.color) return { ...p, coins: p.coins - price }
        if (p.color === chef.color) return { ...p, coins: p.coins + price }
        return p
      }),
    },
    `${buyer.name} achète le chef · ${formatLudo(price)}.`,
  )
}

export function startNextHand(state: PaquetState): PaquetState {
  if (state.phase !== 'hand') return state
  const chef = state.chef
  if (!chef) return dealElect({ ...state, hand: state.hand + 1, winner: null, nextChef: null, claimants: [], offer: null })
  return dealPackets({
    ...state,
    chef,
    nextChef: null,
    claimants: [],
    offer: null,
    hand: state.hand + 1,
    winner: null,
    lastDuel: null,
    log: [],
    pot: 0,
    phase: 'pick',
  })
}

export function endTable(state: PaquetState, message: string, winner: PaquetColor | null = null): PaquetState {
  return say(refundPending({ ...state, phase: 'ended', actor: null, challenger: null, winner }), message)
}

export function botAmount(state: PaquetState, color: PaquetColor) {
  const opts = betOptions(state, color)
  if (!opts.length) return 0
  const roll = Math.random()
  if (roll > 0.88) return opts[opts.length - 1]!
  if (roll > 0.62) return opts[Math.min(1, opts.length - 1)]!
  return opts[0]!
}

export function stepAuto(state: PaquetState): PaquetState {
  if (state.phase === 'elect') return resolveElect(state)
  if (state.phase === 'named') return dealPackets(state)
  if (state.phase === 'claim') {
    return say({ ...state, phase: 'hand', actor: null, offer: null }, state.message)
  }
  if (state.phase === 'runoff') {
    const who = actorOf(state)
    const free = freePackets(state)
    if (who && !who.isHuman && free.length) {
      return pickPacket(state, who.color, free[Math.floor(Math.random() * free.length)]!)
    }
    return state
  }
  if (state.phase === 'pick') {
    const who = actorOf(state)
    const free = freePackets(state)
    if (who && !who.isHuman && free.length && who.color !== state.chef) {
      return pickPacket(state, who.color, free[Math.floor(Math.random() * free.length)]!)
    }
    if (free.length <= 1) return giveLastToChef(state)
    return state
  }
  if (state.phase === 'bet') {
    const who = actorOf(state)
    if (!who || who.isHuman) return state
    const amount = botAmount(state, who.color)
    if (!amount) {
      const skip = aroundChef(state).find((p) => p.bet === 0 && p.packet != null && p.color !== who.color && p.coins >= minBet(state))
      if (!skip) return beginPeek(state)
      return say({ ...state, actor: skip.color }, `${who.name} passe. Pas assez.`)
    }
    return placeBet(state, who.color, amount)
  }
  if (state.phase === 'peek') {
    const chef = chefOf(state)
    if (!chef || chef.isHuman) return state
    return peekChef(state, chef.color)
  }
  if (state.phase === 'cover') {
    const chef = chefOf(state)
    if (!chef || chef.isHuman) return state
    return coverCurrent(state, chef.color)
  }
  if (state.phase === 'duel') return resolveDuel(state)
  return state
}

export function botPick(state: PaquetState) {
  return stepAuto(state)
}

export function allPicked(state: PaquetState) {
  return state.players.every((p) => p.packet != null)
}

function canSeePacket(state: PaquetState, viewer: PaquetColor | null, packet: Packet) {
  if (!packet.card) return false
  if (state.revealed.includes(packet.id)) return true
  if (!viewer) return false
  const chef = chefOf(state)
  return Boolean(chef && chef.color === viewer && chef.peeked && packet.takenBy === chef.color)
}

export function viewFor(state: PaquetState, viewer: PaquetColor | null): PaquetState {
  return {
    ...state,
    packets: state.packets.map((p) => ({
      ...p,
      card: state.phase === 'claim' && p.takenBy ? p.card : canSeePacket(state, viewer, p) ? p.card : null,
    })),
    players: state.players.map((p) => ({
      ...p,
      electCard: state.phase === 'elect' || state.phase === 'named' ? p.electCard : null,
      peeked: p.color === state.chef ? p.peeked : false,
    })),
  }
}

export function waitingHuman(state: PaquetState, color: PaquetColor) {
  if (state.phase === 'pick' || state.phase === 'bet' || state.phase === 'runoff') return state.actor === color
  if (state.phase === 'peek' || state.phase === 'cover') return state.chef === color
  return false
}

export function packetOwner(state: PaquetState, packetId: number) {
  const color = state.packets.find((p) => p.id === packetId)?.takenBy
  return player(state, color ?? null)
}

export { PAQUET_COLORS, PAQUET_PALETTE }
export type { PaquetColor }
