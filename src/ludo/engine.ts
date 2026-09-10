import { seatPlayers } from './board'
import { needsEntry } from './dice'
import { cellOf, isSafeCell, occupantsOnCell, STRETCH_MAX, tokenCell, TRACK_MAX } from './path'
import { rakeOf, winnerPayout } from './wallet'
import type { ColorId, GameState, Player, PlayerCount, Token, TokenLoc } from './types'

const EMPTY_MISSES: Record<ColorId, number> = {
  red: 0,
  green: 0,
  yellow: 0,
  blue: 0,
}

function touchMisses(state: GameState, color: ColorId, value: number): GameState['boxedMisses'] {
  const boxedMisses = { ...state.boxedMisses }
  if (!needsEntry(state.tokens, color)) {
    boxedMisses[color] = 0
    return boxedMisses
  }
  boxedMisses[color] = value === 6 ? 0 : (boxedMisses[color] ?? 0) + 1
  return boxedMisses
}

function nextColor(players: Player[], current: ColorId): ColorId {
  const i = players.findIndex((p) => p.color === current)
  const start = i < 0 ? 0 : i
  for (let n = 1; n <= players.length; n += 1) {
    const player = players[(start + n) % players.length]
    if (!player.out) return player.color
  }
  return players[(start + 1) % players.length].color
}

function tokensOf(state: GameState, color: ColorId): Token[] {
  return state.tokens.filter((t) => t.color === color)
}

function sendHome(token: Token): Token {
  const slot = Number(token.id.split('-')[1] || 0)
  return { ...token, loc: { kind: 'yard', slot } }
}

function captureSinglesOnCell(tokens: Token[], row: number, col: number, moverColor: ColorId) {
  const counts = occupantsOnCell(tokens, row, col)
  let captured = false
  const next = tokens.map((token) => {
    if (token.color === moverColor) return token
    if (token.loc.kind === 'done' || token.loc.kind === 'yard') return token
    const [r, c] = tokenCell(token)
    if (r !== row || c !== col) return token
    if ((counts[token.color] || 0) >= 2) return token
    captured = true
    return sendHome(token)
  })
  return { tokens: next, captured }
}

function cutBrokenStack(tokens: Token[], row: number, col: number, color: ColorId) {
  if (isSafeCell(row, col)) return { tokens, eaten: false }
  const counts = occupantsOnCell(tokens, row, col)
  const mine = counts[color] || 0
  const enemyHere = Object.entries(counts).some(([other, n]) => other !== color && (n || 0) > 0)
  if (mine !== 1 || !enemyHere) return { tokens, eaten: false }
  let eaten = false
  const next = tokens.map((token) => {
    if (token.color !== color) return token
    if (token.loc.kind === 'done' || token.loc.kind === 'yard') return token
    const [r, c] = tokenCell(token)
    if (r !== row || c !== col) return token
    eaten = true
    return sendHome(token)
  })
  return { tokens: next, eaten }
}

export function destination(token: Token, dice: number): TokenLoc | null {
  if (token.loc.kind === 'done') return null

  if (token.loc.kind === 'yard') {
    return dice === 6 ? { kind: 'track', steps: 0 } : null
  }

  if (token.loc.kind === 'track') {
    const next = token.loc.steps + dice
    if (next <= TRACK_MAX) return { kind: 'track', steps: next }
    const into = next - TRACK_MAX - 1
    if (into <= STRETCH_MAX) return { kind: 'stretch', steps: into }
    if (into === STRETCH_MAX + 1) return { kind: 'done' }
    return null
  }

  const next = token.loc.steps + dice
  if (next <= STRETCH_MAX) return { kind: 'stretch', steps: next }
  if (next === STRETCH_MAX + 1) return { kind: 'done' }
  return null
}

export function legalMoves(state: GameState): string[] {
  const dice = state.dice
  return tokensOf(state, state.turn)
    .filter((token) => destination(token, dice) !== null)
    .map((token) => token.id)
}

function passTurn(state: GameState, message: string, bonus = false): GameState {
  const me = state.players.find((p) => p.color === state.turn)
  const extra = !me?.out && (bonus || (state.dice === 6 && state.sixes < 3))
  if (extra) {
    return {
      ...state,
      phase: 'to-roll',
      movable: [],
      message: bonus ? `${message} Tu rejoues.` : `${message} 6 : tu rejoues.`,
    }
  }
  return {
    ...state,
    turn: nextColor(state.players, state.turn),
    phase: 'to-roll',
    sixes: 0,
    movable: [],
    message,
  }
}

export function createGame(
  name: string,
  count: PlayerCount,
  color: ColorId,
  stake: number,
  humanCoins: number,
  matchId = crypto.randomUUID(),
): GameState {
  const seated = seatPlayers(count, color, name)
  const players: Player[] = seated.map((player) => ({
    ...player,
    coins: player.isHuman ? humanCoins : stake,
  }))
  const tokens: Token[] = players.flatMap((player) =>
    [0, 1, 2, 3].map((slot) => ({
      id: `${player.color}-${slot}`,
      color: player.color,
      loc: { kind: 'yard', slot },
    })),
  )

  const you = players.find((p) => p.isHuman) ?? players[0]
  const payers = players.filter((p) => p.isHuman).length
  const pot = stake * payers
  return {
    id: matchId,
    players,
    tokens,
    turn: you.color,
    phase: 'to-roll',
    dice: 6,
    sixes: 0,
    movable: [],
    message: stake
      ? `${you.name}, lance le dé. Mise ${stake} LUDO · pot ${pot} LUDO.`
      : `${you.name}, lance le dé. Partie libre, sans mise.`,
    winner: null,
    boxedMisses: { ...EMPTY_MISSES },
    stake,
    pot,
  }
}

export function applyRoll(state: GameState, value: number, pity = false): GameState {
  if (state.phase !== 'to-roll' || state.winner) return state

  const boxedMisses = touchMisses(state, state.turn, value)
  const sixes = value === 6 ? state.sixes + 1 : 0
  if (value === 6 && sixes >= 3) {
    return {
      ...state,
      dice: value,
      boxedMisses,
      turn: nextColor(state.players, state.turn),
      phase: 'to-roll',
      sixes: 0,
      movable: [],
      message: 'Trois 6 d’affilée : le tour est perdu.',
    }
  }

  const rolled: GameState = { ...state, dice: value, sixes, boxedMisses }
  const movable = legalMoves(rolled)
  const player = rolled.players.find((p) => p.color === rolled.turn)!

  if (movable.length === 0) {
    return passTurn(rolled, `${player.name} : ${value}, aucun coup.`)
  }

  const sixText = pity
    ? `${player.name} : le 6 arrive enfin. Sors un pion.`
    : `${player.name} : 6 ! Sors un pion ou avance.`

  const waiting: GameState = {
    ...rolled,
    phase: 'to-move',
    movable,
    message: value === 6 ? sixText : `${player.name} : ${value}. Choisis un pion.`,
  }

  if (movable.length === 1) {
    return applyMove(waiting, movable[0])
  }

  return waiting
}

export function applyMove(state: GameState, tokenId: string): GameState {
  if (state.phase !== 'to-move' || !state.movable.includes(tokenId)) return state

  const token = state.tokens.find((t) => t.id === tokenId)
  if (!token) return state

  const dest = destination(token, state.dice)
  if (!dest) return state

  const fromBoard = token.loc.kind === 'track' || token.loc.kind === 'stretch'
  const origin = fromBoard ? tokenCell(token) : null

  let tokens = state.tokens.map((t) => (t.id === tokenId ? { ...t, loc: dest } : t))
  let captured = false
  let unstacked = false

  if (dest.kind === 'track' || dest.kind === 'stretch') {
    const [row, col] = cellOf(token.color, dest)
    if (!isSafeCell(row, col)) {
      const hit = captureSinglesOnCell(tokens, row, col, token.color)
      tokens = hit.tokens
      captured = hit.captured
    }
  }

  if (origin) {
    const broken = cutBrokenStack(tokens, origin[0], origin[1], token.color)
    tokens = broken.tokens
    unstacked = broken.eaten
  }

  const boxedMisses = { ...state.boxedMisses }
  if (token.loc.kind === 'yard' && dest.kind !== 'yard') {
    boxedMisses[token.color] = 0
  }
  if (captured || unstacked) {
    for (const color of Object.keys(boxedMisses) as ColorId[]) {
      if (needsEntry(tokens, color)) continue
      boxedMisses[color] = 0
    }
  }

  const moved: GameState = { ...state, tokens, boxedMisses }
  const finished = tokens.filter((t) => t.color === token.color && t.loc.kind === 'done').length
  if (finished === 4) {
    const winner = moved.players.find((p) => p.color === token.color)!
    return {
      ...moved,
      phase: 'ended',
      winner: token.color,
      movable: [],
      message:
        moved.pot > 0
          ? `${winner.name} a ramené ses 4 pions. Pot ${moved.pot} LUDO · maison ${rakeOf(moved.pot)} · net ${winnerPayout(moved.pot)}.`
          : `${winner.name} a ramené ses 4 pions !`,
    }
  }

  const reachedHome = dest.kind === 'done'
  const note = captured
    ? 'Pion adverse renvoyé à la maison.'
    : unstacked
      ? 'Le duo s’est cassé : le pion restant a été mangé.'
      : token.loc.kind === 'yard'
        ? 'Le pion sort et entre en jeu.'
        : reachedHome
          ? 'Un pion est arrivé au centre.'
          : 'Pion avancé.'
  return passTurn(moved, note, captured || reachedHome)
}

export function pickBotMove(state: GameState): string | null {
  const options = state.movable
    .map((id) => state.tokens.find((t) => t.id === id)!)
    .filter(Boolean)

  const capture = options.find((token) => {
    const dest = destination(token, state.dice)
    if (!dest || dest.kind === 'done' || dest.kind === 'yard') return false
    const [row, col] = cellOf(token.color, dest)
    if (isSafeCell(row, col)) return false
    const counts = occupantsOnCell(state.tokens, row, col, token.id)
    return Object.entries(counts).some(([color, n]) => color !== token.color && (n || 0) === 1)
  })
  if (capture) return capture.id

  const leave = options.find((t) => t.loc.kind === 'yard')
  if (leave) return leave.id

  const finish = options.find((t) => destination(t, state.dice)?.kind === 'done')
  if (finish) return finish.id

  const onTrack = options.filter((t) => t.loc.kind === 'track' || t.loc.kind === 'stretch')
  if (onTrack.length) {
    const progress = (token: Token) =>
      token.loc.kind === 'stretch'
        ? TRACK_MAX + 1 + token.loc.steps
        : token.loc.kind === 'track'
          ? token.loc.steps
          : 0
    return [...onTrack].sort((a, b) => progress(b) - progress(a))[0].id
  }

  return options[0]?.id ?? null
}

export function currentPlayer(state: GameState): Player {
  return state.players.find((p) => p.color === state.turn) ?? state.players[0]
}
