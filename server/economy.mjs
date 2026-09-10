import './solana.mjs'

export const LUDO_PER_USD = Math.max(1, Math.floor(Number(process.env.LUDO_PER_USD || 230)))
export const WITHDRAW_FEE_BPS = Math.min(2000, Math.max(0, Math.floor(Number(process.env.WITHDRAW_FEE_BPS || 0))))
export const GAME_RAKE_BPS = Math.min(2000, Math.max(0, Math.floor(Number(process.env.GAME_RAKE_BPS || 1000))))
export const GAME_ASSET = 'LUDO'
export const WITHDRAW_TIERS_USD = [1, 2, 5, 10, 20]
export const STAKES = [100, 200, 500, 1000, 2000]

export const PACKS = [
  { id: 'mini', name: '1 $', usd: 1, tag: null },
  { id: 'starter', name: 'Starter', usd: 2, tag: null },
  { id: 'plus', name: 'Plus', usd: 5, tag: 'Populaire' },
  { id: 'pro', name: 'Pro', usd: 10, tag: null },
  { id: 'vault', name: 'Coffre', usd: 20, tag: null },
]

export function ludoForUsd(usd) {
  return Number(usd) * LUDO_PER_USD
}

export function isAllowedStake(value) {
  return STAKES.includes(Number(value))
}

export function rakeOf(pot) {
  return Math.floor((Number(pot) * GAME_RAKE_BPS) / 10000)
}

export function rakePercent() {
  return GAME_RAKE_BPS / 100
}

export function winnerPayout(pot) {
  return Number(pot) - rakeOf(pot)
}

export function netPayoutRaw(grossRaw, feeBps = WITHDRAW_FEE_BPS) {
  return (BigInt(grossRaw) * BigInt(10000 - feeBps)) / 10000n
}

export function feePercent() {
  return WITHDRAW_FEE_BPS / 100
}
