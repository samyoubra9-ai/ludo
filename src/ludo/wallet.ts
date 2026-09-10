export const LUDO_PER_USD = 230
export const STARTING_COINS = 0
export const MIN_STAKE = 100
export const STAKES = [100, 200, 500, 1000, 2000] as const
export type Stake = (typeof STAKES)[number]

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
  return `${formatCoins(value)} LUDO`
}

export function daFor(coins: number, rateDa: number, unit = LUDO_PER_USD) {
  return Math.floor((Math.max(0, coins) * Math.max(0, rateDa)) / Math.max(1, unit))
}

export function formatDa(value: number) {
  return `${formatCoins(value)} DA`
}
