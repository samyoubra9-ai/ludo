import { HOME_SLOTS, START_CELLS, STAR_CELLS, sameCell } from './board'
import type { ColorId, Token, TokenLoc } from './types'

export const TRACK: readonly (readonly [number, number])[] = [
  [6, 1],
  [6, 2],
  [6, 3],
  [6, 4],
  [6, 5],
  [5, 6],
  [4, 6],
  [3, 6],
  [2, 6],
  [1, 6],
  [0, 6],
  [0, 7],
  [0, 8],
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  [6, 9],
  [6, 10],
  [6, 11],
  [6, 12],
  [6, 13],
  [6, 14],
  [7, 14],
  [8, 14],
  [8, 13],
  [8, 12],
  [8, 11],
  [8, 10],
  [8, 9],
  [9, 8],
  [10, 8],
  [11, 8],
  [12, 8],
  [13, 8],
  [14, 8],
  [14, 7],
  [14, 6],
  [13, 6],
  [12, 6],
  [11, 6],
  [10, 6],
  [9, 6],
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2],
  [8, 1],
  [8, 0],
  [7, 0],
  [6, 0],
]

export const STRETCH: Record<ColorId, readonly (readonly [number, number])[]> = {
  green: [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
  ],
  yellow: [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
  ],
  blue: [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
  ],
  red: [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
  ],
}

export const TRACK_MAX = 50
export const STRETCH_MAX = 4

export function startIndex(color: ColorId): number {
  const start = START_CELLS[color]
  const i = TRACK.findIndex((cell) => sameCell(cell, start))
  if (i < 0) throw new Error(`Départ introuvable pour ${color}`)
  return i
}

export function trackCell(color: ColorId, steps: number): readonly [number, number] {
  return TRACK[(startIndex(color) + steps) % TRACK.length]
}

export function tokenCell(token: Token): readonly [number, number] {
  return cellOf(token.color, token.loc)
}

export function cellOf(color: ColorId, loc: TokenLoc): readonly [number, number] {
  switch (loc.kind) {
    case 'yard':
      return HOME_SLOTS[color][loc.slot]
    case 'track':
      return trackCell(color, loc.steps)
    case 'stretch':
      return STRETCH[color][loc.steps]
    case 'done':
      return [7, 7]
  }
}

export function isSafeCell(row: number, col: number): boolean {
  return (
    STAR_CELLS.some((cell) => sameCell(cell, [row, col])) ||
    Object.values(START_CELLS).some((cell) => sameCell(cell, [row, col]))
  )
}

export function occupantsOnCell(
  tokens: Token[],
  row: number,
  col: number,
  exceptId?: string,
): Partial<Record<ColorId, number>> {
  const counts: Partial<Record<ColorId, number>> = {}
  for (const token of tokens) {
    if (exceptId && token.id === exceptId) continue
    if (token.loc.kind === 'yard' || token.loc.kind === 'done') continue
    const [r, c] = tokenCell(token)
    if (r !== row || c !== col) continue
    counts[token.color] = (counts[token.color] || 0) + 1
  }
  return counts
}

export function stackSize(
  tokens: Token[],
  row: number,
  col: number,
  color: ColorId,
  exceptId?: string,
) {
  return occupantsOnCell(tokens, row, col, exceptId)[color] || 0
}
