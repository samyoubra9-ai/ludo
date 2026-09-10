import type { ColorId, GameState, Token } from './types'

/** Failed entry rolls before the next one is a guaranteed 6. */
export const HARD_PITY = 3

export function needsEntry(tokens: Token[], color: ColorId): boolean {
  const mine = tokens.filter((token) => token.color === color)
  const stillHome = mine.some((token) => token.loc.kind === 'yard')
  const onBoard = mine.some((token) => token.loc.kind === 'track' || token.loc.kind === 'stretch')
  return stillHome && !onBoard
}

function fairD6(): number {
  return 1 + Math.floor(Math.random() * 6)
}

function weightedD6(misses: number): number {
  const sixWeight = 1 + misses
  const total = 5 + sixWeight
  let pick = Math.random() * total
  for (let face = 1; face <= 5; face += 1) {
    pick -= 1
    if (pick <= 0) return face
  }
  return 6
}

export function rollDie(state: GameState): { value: number; pity: boolean } {
  if (!needsEntry(state.tokens, state.turn)) {
    return { value: fairD6(), pity: false }
  }

  const misses = state.boxedMisses[state.turn] ?? 0
  if (misses >= HARD_PITY) {
    return { value: 6, pity: true }
  }

  return { value: weightedD6(misses), pity: false }
}
