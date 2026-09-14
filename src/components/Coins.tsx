import { formatUnit, GAME_ASSET } from '../ludo/wallet'

export function CoinMark() {
  return (
    <svg className="coin-mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#f0c400" />
      <circle cx="12" cy="12" r="7.2" fill="#ffe36a" />
      <path fill="#b38600" d="M11 7h2v10h-2zM8.4 9.2h7.2v1.7H8.4zm0 4h7.2v1.7H8.4z" />
    </svg>
  )
}

export function Coins({ value, label }: { value: number; label?: string }) {
  return (
    <span className="coins">
      <CoinMark />
      <strong>{formatUnit(value)}</strong>
      <small>{label ? `${label} · ${GAME_ASSET}` : GAME_ASSET}</small>
    </span>
  )
}
