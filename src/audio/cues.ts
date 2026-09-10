import type { ColorId, GameState } from '../ludo/types'

function yardCount(state: GameState, color: ColorId) {
  return state.tokens.filter((token) => token.color === color && token.loc.kind === 'yard').length
}

function doneCount(state: GameState) {
  return state.tokens.filter((token) => token.loc.kind === 'done').length
}

export function moveCue(prev: GameState, next: GameState) {
  if (doneCount(next) > doneCount(prev)) return 'home' as const
  for (const seat of next.players) {
    if (yardCount(next, seat.color) > yardCount(prev, seat.color)) return 'capture' as const
  }
  return null
}

export function hopsUntilLand(prev: GameState, next: GameState) {
  for (const token of next.tokens) {
    const before = prev.tokens.find((item) => item.id === token.id)
    if (!before) continue
    if (before.loc.kind === 'yard' && token.loc.kind !== 'yard') return 1
    if (before.loc.kind === 'track' && token.loc.kind === 'track') {
      return Math.max(1, Math.abs(token.loc.steps - before.loc.steps))
    }
    if (before.loc.kind === 'stretch' && token.loc.kind === 'stretch') {
      return Math.max(1, Math.abs(token.loc.steps - before.loc.steps))
    }
    if (before.loc.kind === 'track' && token.loc.kind === 'stretch') {
      return Math.max(1, token.loc.steps + 1)
    }
  }
  return 4
}
