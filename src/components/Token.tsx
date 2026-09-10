import { PALETTE } from '../ludo/board'
import type { ColorId } from '../ludo/types'

export function Token({
  color,
  selected,
  hot,
  mark = 't',
}: {
  color: ColorId
  selected?: boolean
  hot?: boolean
  mark?: string
}) {
  const fill = PALETTE[color].hex
  const deep = PALETTE[color].deep
  const uid = `${mark}-${color}-${fill.replace('#', '')}`

  return (
    <svg
      className={`token token--${color} ${selected ? 'is-selected' : ''} ${hot ? 'is-hot' : ''}`}
      viewBox="0 0 48 64"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`pawn-head-${uid}`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="28%" stopColor={fill} />
          <stop offset="100%" stopColor={deep} />
        </radialGradient>
        <linearGradient id={`pawn-body-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor={deep} />
        </linearGradient>
      </defs>
      <ellipse cx="24" cy="59.5" rx="14" ry="3.2" fill="rgba(0,0,0,0.38)" />
      <ellipse cx="24" cy="51" rx="12" ry="4.4" fill={deep} />
      <ellipse cx="24" cy="49.2" rx="10.5" ry="3.4" fill={fill} />
      <path
        d="M17.2 24c-.4 10-3.4 17.2 6.8 25.2 10.2-8 7.2-15.2 6.8-25.2Z"
        fill={`url(#pawn-body-${uid})`}
      />
      <path d="M20 27c2.2 9.5 2.6 14 4 17.5 1.4-3.5 1.8-8 4-17.5Z" fill="rgba(255,255,255,0.2)" />
      <circle cx="24" cy="17.5" r="13.4" fill={`url(#pawn-head-${uid})`} />
      <circle cx="19.2" cy="13" r="4.4" fill="rgba(255,255,255,0.55)" />
    </svg>
  )
}
