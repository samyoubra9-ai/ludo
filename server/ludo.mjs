import { rakeOf, winnerPayout } from './economy.mjs'

export const COLORS = ['red', 'green', 'yellow', 'blue']
export const OPPOSITE = { red: 'yellow', yellow: 'red', green: 'blue', blue: 'green' }
export const HARD_PITY = 3
export const TRACK_MAX = 50
export const STRETCH_MAX = 4

const START_CELLS = {
  green: [6, 1],
  yellow: [1, 8],
  blue: [8, 13],
  red: [13, 6],
}

const STAR_CELLS = [
  [8, 2],
  [2, 6],
  [6, 12],
  [12, 8],
]

const HOME_SLOTS = {
  green: [
    [2, 2],
    [2, 4],
    [4, 2],
    [4, 4],
  ],
  yellow: [
    [2, 10],
    [2, 12],
    [4, 10],
    [4, 12],
  ],
  red: [
    [10, 2],
    [10, 4],
    [12, 2],
    [12, 4],
  ],
  blue: [
    [10, 10],
    [10, 12],
    [12, 10],
    [12, 12],
  ],
}

const TRACK = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
]

const STRETCH = {
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  red: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
}

const EMPTY_MISSES = { red: 0, green: 0, yellow: 0, blue: 0 }

function sameCell(a, b) {
  return a[0] === b[0] && a[1] === b[1]
}

function startIndex(color) {
  const start = START_CELLS[color]
  return TRACK.findIndex((cell) => sameCell(cell, start))
}

function cellOf(color, loc) {
  if (loc.kind === 'yard') return HOME_SLOTS[color][loc.slot]
  if (loc.kind === 'track') return TRACK[(startIndex(color) + loc.steps) % TRACK.length]
  if (loc.kind === 'stretch') return STRETCH[color][loc.steps]
  return [7, 7]
}

function tokenCell(token) {
  return cellOf(token.color, token.loc)
}

function isSafeCell(row, col) {
  return (
    STAR_CELLS.some((cell) => sameCell(cell, [row, col])) ||
    Object.values(START_CELLS).some((cell) => sameCell(cell, [row, col]))
  )
}

function occupantsOnCell(tokens, row, col, exceptId) {
  const counts = {}
  for (const token of tokens) {
    if (exceptId && token.id === exceptId) continue
    if (token.loc.kind === 'yard' || token.loc.kind === 'done') continue
    const [r, c] = tokenCell(token)
    if (r !== row || c !== col) continue
    counts[token.color] = (counts[token.color] || 0) + 1
  }
  return counts
}

function sendHome(token) {
  const slot = Number(token.id.split('-')[1] || 0)
  return { ...token, loc: { kind: 'yard', slot } }
}

function captureSinglesOnCell(tokens, row, col, moverColor) {
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

function cutBrokenStack(tokens, row, col, color) {
  if (isSafeCell(row, col)) return { tokens, eaten: false }
  const counts = occupantsOnCell(tokens, row, col)
  const mine = counts[color] || 0
  const enemyHere = Object.entries(counts).some(([other, n]) => other !== color && n > 0)
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

export function needsEntry(tokens, color) {
  const mine = tokens.filter((token) => token.color === color)
  const stillHome = mine.some((token) => token.loc.kind === 'yard')
  const onBoard = mine.some((token) => token.loc.kind === 'track' || token.loc.kind === 'stretch')
  return stillHome && !onBoard
}

function fairD6() {
  return 1 + Math.floor(Math.random() * 6)
}

function weightedD6(misses) {
  const sixWeight = 1 + misses
  const total = 5 + sixWeight
  let pick = Math.random() * total
  for (let face = 1; face <= 5; face += 1) {
    pick -= 1
    if (pick <= 0) return face
  }
  return 6
}

export function rollDie(state) {
  if (!needsEntry(state.tokens, state.turn)) {
    return { value: fairD6(), pity: false }
  }
  const misses = state.boxedMisses[state.turn] ?? 0
  if (misses >= HARD_PITY) return { value: 6, pity: true }
  return { value: weightedD6(misses), pity: false }
}

function touchMisses(state, color, value) {
  const boxedMisses = { ...state.boxedMisses }
  if (!needsEntry(state.tokens, color)) {
    boxedMisses[color] = 0
    return boxedMisses
  }
  boxedMisses[color] = value === 6 ? 0 : (boxedMisses[color] ?? 0) + 1
  return boxedMisses
}

function nextColor(players, current) {
  const i = players.findIndex((p) => p.color === current)
  const start = i < 0 ? 0 : i
  for (let n = 1; n <= players.length; n += 1) {
    const player = players[(start + n) % players.length]
    if (!player.out) return player.color
  }
  return players[(start + 1) % players.length].color
}

export function skipOutPlayers(state, note) {
  if (!state || state.winner) return state
  const current = state.players.find((p) => p.color === state.turn)
  if (!current?.out) return state
  return {
    ...state,
    turn: nextColor(state.players, state.turn),
    phase: 'to-roll',
    sixes: 0,
    movable: [],
    message: note || `${current.name} a quitté. Sa mise reste au pot.`,
  }
}

function tokensOf(state, color) {
  return state.tokens.filter((t) => t.color === color)
}

export function destination(token, dice) {
  if (token.loc.kind === 'done') return null
  if (token.loc.kind === 'yard') return dice === 6 ? { kind: 'track', steps: 0 } : null
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

export function legalMoves(state) {
  return tokensOf(state, state.turn)
    .filter((token) => destination(token, state.dice) !== null)
    .map((token) => token.id)
}

function passTurn(state, message, bonus = false) {
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

export function colorsForCount(count, hostColor) {
  return count === 2 ? [hostColor, OPPOSITE[hostColor]] : [...COLORS]
}

export function createGameFromPlayers(id, players, stake, firstColor) {
  const tokens = players.flatMap((player) =>
    [0, 1, 2, 3].map((slot) => ({
      id: `${player.color}-${slot}`,
      color: player.color,
      loc: { kind: 'yard', slot },
    })),
  )
  const payers = players.filter((player) => player.isHuman).length
  const pot = stake * payers
  const starter = players.find((p) => p.color === firstColor) ?? players[0]
  return {
    id,
    players,
    tokens,
    turn: starter.color,
    phase: 'to-roll',
    dice: 6,
    sixes: 0,
    movable: [],
    message: `${starter.name}, lance le dé. Mise ${stake} LUDO · pot ${pot} LUDO.`,
    winner: null,
    boxedMisses: { ...EMPTY_MISSES },
    stake,
    pot,
  }
}

export function applyRoll(state, value, pity = false) {
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

  const rolled = { ...state, dice: value, sixes, boxedMisses }
  const movable = legalMoves(rolled)
  const player = rolled.players.find((p) => p.color === rolled.turn)

  if (movable.length === 0) {
    return passTurn(rolled, `${player.name} : ${value}, aucun coup.`)
  }

  const sixText = pity
    ? `${player.name} : le 6 arrive enfin. Sors un pion.`
    : `${player.name} : 6 ! Sors un pion ou avance.`

  const waiting = {
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

export function applyMove(state, tokenId) {
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
  if (token.loc.kind === 'yard' && dest.kind !== 'yard') boxedMisses[token.color] = 0
  if (captured || unstacked) {
    for (const color of Object.keys(boxedMisses)) {
      if (needsEntry(tokens, color)) continue
      boxedMisses[color] = 0
    }
  }

  const moved = { ...state, tokens, boxedMisses }
  const finished = tokens.filter((t) => t.color === token.color && t.loc.kind === 'done').length
  if (finished === 4) {
    const winner = moved.players.find((p) => p.color === token.color)
    if (winner?.out) {
      return passTurn(moved, `${winner.name} a quitté. Sa mise reste au pot.`)
    }
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

export function pickBotMove(state) {
  const options = state.movable
    .map((id) => state.tokens.find((t) => t.id === id))
    .filter(Boolean)

  const capture = options.find((token) => {
    const dest = destination(token, state.dice)
    if (!dest || dest.kind === 'done' || dest.kind === 'yard') return false
    const [row, col] = cellOf(token.color, dest)
    if (isSafeCell(row, col)) return false
    const counts = occupantsOnCell(state.tokens, row, col, token.id)
    return Object.entries(counts).some(([color, n]) => color !== token.color && n === 1)
  })
  if (capture) return capture.id

  const leave = options.find((t) => t.loc.kind === 'yard')
  if (leave) return leave.id

  const finish = options.find((t) => destination(t, state.dice)?.kind === 'done')
  if (finish) return finish.id

  const onTrack = options.filter((t) => t.loc.kind === 'track' || t.loc.kind === 'stretch')
  if (onTrack.length) {
    const progress = (token) =>
      token.loc.kind === 'stretch'
        ? TRACK_MAX + 1 + token.loc.steps
        : token.loc.kind === 'track'
          ? token.loc.steps
          : 0
    return [...onTrack].sort((a, b) => progress(b) - progress(a))[0].id
  }

  return options[0]?.id ?? null
}

export function currentPlayer(state) {
  return state.players.find((p) => p.color === state.turn) ?? state.players[0]
}
