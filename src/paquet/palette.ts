export const PAQUET_COLORS = ['crimson', 'amber', 'lime', 'teal', 'azure', 'violet', 'rose', 'sand'] as const
export type PaquetColor = (typeof PAQUET_COLORS)[number]

export const PAQUET_PALETTE: Record<PaquetColor, { name: string; hex: string; deep: string }> = {
  crimson: { name: 'Rubis', hex: '#e23d4a', deep: '#9b1c28' },
  amber: { name: 'Ambre', hex: '#f0b429', deep: '#b45309' },
  lime: { name: 'Lime', hex: '#7cdb4c', deep: '#3f8f1f' },
  teal: { name: 'Sarcelle', hex: '#2dd4bf', deep: '#0f766e' },
  azure: { name: 'Azur', hex: '#38bdf8', deep: '#0369a1' },
  violet: { name: 'Violet', hex: '#a78bfa', deep: '#6d28d9' },
  rose: { name: 'Rose', hex: '#fb7185', deep: '#be123c' },
  sand: { name: 'Sable', hex: '#e7d3a3', deep: '#a16207' },
}

export function seatTone(color: string): { name: string; hex: string; deep: string } {
  if (color in PAQUET_PALETTE) return PAQUET_PALETTE[color as PaquetColor]
  return { name: color, hex: '#94a3b8', deep: '#334155' }
}
