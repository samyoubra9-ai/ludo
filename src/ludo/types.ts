export type ColorId = 'red' | 'green' | 'yellow' | 'blue'
export type PlayerCount = 2 | 4
export type Phase = 'to-roll' | 'to-move' | 'ended'

export interface Player {
  color: ColorId
  name: string
  isHuman: boolean
  coins: number
  out?: boolean
}

export type TokenLoc =
  | { kind: 'yard'; slot: number }
  | { kind: 'track'; steps: number }
  | { kind: 'stretch'; steps: number }
  | { kind: 'done' }

export interface Token {
  id: string
  color: ColorId
  loc: TokenLoc
}

export interface GameState {
  id: string
  players: Player[]
  tokens: Token[]
  turn: ColorId
  phase: Phase
  dice: number
  sixes: number
  movable: string[]
  message: string
  winner: ColorId | null
  boxedMisses: Record<ColorId, number>
  stake: number
  pot: number
}
