export const LUDO_PER_USD = 230
export const STARTING_COINS = 0
export const GAME_ASSET = 'Ł'
export const STAKE_UNITS = [0.25, 0.5, 1, 2, 5, 10, 20] as const
export const STAKES = [58, 115, 230, 460, 1150, 2300, 4600] as const
export const TABLE_UNIT = 3.5
export const TABLE_STAKE = 805
export const TABLE_MIN_BET = 58
export type Stake = number
export const MIN_STAKE = TABLE_STAKE
export const DEFAULT_STAKE = TABLE_STAKE
export const MIN_UNIT = 0.25

export const GAME_RAKE_BPS = 1000

export function rakeOf(pot: number) {
  return Math.floor((pot * GAME_RAKE_BPS) / 10000)
}

export function rakePercent() {
  return GAME_RAKE_BPS / 100
}

export function winnerPayout(pot: number) {
  return pot - rakeOf(pot)
}

export function usdFromLudo(ludo: number) {
  return ludo / LUDO_PER_USD
}

export function unitFromLudo(ludo: number) {
  return (Number.isFinite(ludo) ? ludo : 0) / LUDO_PER_USD
}

export function ludoFromUnit(unit: number) {
  return Math.round(Number(unit) * LUDO_PER_USD)
}

export function formatUnit(value: number): string {
  const rounded = Math.round(unitFromLudo(value) * 100) / 100
  if (!Number.isFinite(rounded)) return '0'
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return Math.round(rounded).toLocaleString('fr-FR')
  }
  return rounded.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatStakeUnit(unit: number): string {
  const n = Number(unit)
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return n.toLocaleString('fr-FR')
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const KEY = 'ludo-wallet-v1'

export function loadCoins(): number {
  try {
    const raw = localStorage.getItem(KEY)
    const value = raw ? Number(raw) : STARTING_COINS
    if (!Number.isFinite(value)) return STARTING_COINS
    return Math.max(0, Math.floor(value))
  } catch {
    return STARTING_COINS
  }
}

export function saveCoins(coins: number) {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.floor(coins))))
  } catch {
    /* ignore quota / private mode */
  }
}

export function ensurePlayable(coins: number): { coins: number; refilled: boolean } {
  if (coins >= MIN_STAKE) return { coins, refilled: false }
  return { coins: MIN_STAKE, refilled: true }
}

export function formatCoins(value: number): string {
  const n = Number.isFinite(value) ? value : 0
  return n.toLocaleString('fr-FR')
}

export function formatLudo(value: number): string {
  return `${formatUnit(value)} ${GAME_ASSET}`
}

export function daFor(coins: number, rateDa: number, unit = LUDO_PER_USD) {
  return Math.floor((Math.max(0, coins) * Math.max(0, rateDa)) / Math.max(1, unit))
}

export function formatDa(value: number) {
  return `${formatCoins(value)} DA`
}
