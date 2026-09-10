import type { ColorId, Player, PlayerCount } from './types'

export const PALETTE: Record<ColorId, { name: string; hex: string; deep: string }> = {
  red: { name: 'Rouge', hex: '#ef3b2d', deep: '#b71c1c' },
  green: { name: 'Vert', hex: '#21c45a', deep: '#15803d' },
  yellow: { name: 'Jaune', hex: '#f5c400', deep: '#c49200' },
  blue: { name: 'Bleu', hex: '#2b7fff', deep: '#1d4ed8' },
}

export const START_CELLS: Record<ColorId, readonly [number, number]> = {
  green: [6, 1],
  yellow: [1, 8],
  blue: [8, 13],
  red: [13, 6],
}

export const STAR_CELLS: readonly (readonly [number, number])[] = [
  [8, 2],
  [2, 6],
  [6, 12],
  [12, 8],
]

export const HOME_SLOTS: Record<ColorId, readonly (readonly [number, number])[]> = {
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

export function sameCell(a: readonly [number, number], b: readonly [number, number]) {
  return a[0] === b[0] && a[1] === b[1]
}

export function isStar(row: number, col: number) {
  return STAR_CELLS.some((cell) => sameCell(cell, [row, col]))
}

export function startColor(row: number, col: number): ColorId | null {
  for (const color of Object.keys(START_CELLS) as ColorId[]) {
    if (sameCell(START_CELLS[color], [row, col])) return color
  }
  return null
}

export function homeColor(row: number, col: number): ColorId | null {
  if (col === 7 && row >= 1 && row <= 5) return 'yellow'
  if (row === 7 && col >= 9 && col <= 13) return 'blue'
  if (col === 7 && row >= 9 && row <= 13) return 'red'
  if (row === 7 && col >= 1 && col <= 5) return 'green'
  return null
}

export function yardColor(row: number, col: number): ColorId | null {
  if (row < 6 && col < 6) return 'green'
  if (row < 6 && col > 8) return 'yellow'
  if (row > 8 && col < 6) return 'red'
  if (row > 8 && col > 8) return 'blue'
  return null
}

export function isCenter(row: number, col: number) {
  return row >= 6 && row <= 8 && col >= 6 && col <= 8
}

export function isPath(row: number, col: number) {
  if (isCenter(row, col)) return false
  if (homeColor(row, col)) return false
  return (row >= 6 && row <= 8) || (col >= 6 && col <= 8)
}

export function seatPlayers(
  count: PlayerCount,
  humanColor: ColorId,
  humanName: string,
): Omit<Player, 'coins'>[] {
  const order: ColorId[] = ['red', 'green', 'yellow', 'blue']
  const opposite: Record<ColorId, ColorId> = {
    red: 'yellow',
    yellow: 'red',
    green: 'blue',
    blue: 'green',
  }
  const active = count === 2 ? [humanColor, opposite[humanColor]] : order
  let bot = 0
  return active.map((color) => {
    const isHuman = color === humanColor
    if (!isHuman) bot += 1
    return {
      color,
      isHuman,
      name: isHuman ? humanName || 'Toi' : `Bot ${bot}`,
    }
  })
}

export const YARD_COLORS: ColorId[] = ['green', 'yellow', 'red', 'blue']
