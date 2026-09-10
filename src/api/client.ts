import type { ColorId, GameState } from '../ludo/types'

export interface WalletSnapshot {
  address: string
  coins: number
  refilled?: boolean
  kioskName?: string | null
  token?: string
  playing?: { code: string; status: 'lobby' | 'playing' | 'ended' } | null
  telegramBot?: string | null
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new ApiError(data.error || `Erreur ${res.status}`, res.status)
  }
  return data
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  return apiRequest<T>(path, init, token)
}

export function loginWallet(address: string, loginToken: string) {
  return request<WalletSnapshot>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ address, loginToken }),
  })
}

export function fetchMe(token: string) {
  return request<WalletSnapshot>('/api/me', {}, token)
}

export function logoutWallet(token: string) {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }, token).catch(() => undefined)
}

export type RoomSeat = {
  color: ColorId
  name: string
  address: string | null
  kind: 'human' | 'bot' | 'empty'
  online?: boolean
  botPlay?: boolean
  forfeited?: boolean
}

export type RoomSnapshot = {
  code: string
  host: string
  count: 2 | 4
  stake: number
  status: 'lobby' | 'playing' | 'ended'
  you: ColorId | null
  seats: RoomSeat[]
  urls?: string[]
  rolling: boolean
  game: GameState | null
  coins?: number
  humans?: number
  left?: boolean
  rev?: number
  notice?: string | null
  forfeitWinAt?: number
  turnDueAt?: number
  kind?: 'private' | 'match'
}

export type RoomPoll = RoomSnapshot | { unchanged: true; rev: number }

export function isRoomUnchanged(next: RoomPoll): next is { unchanged: true; rev: number } {
  return 'unchanged' in next && next.unchanged === true
}

export function fetchLan(token?: string) {
  return request<{ urls: string[] }>('/api/lan', {}, token)
}

export function createRoom(
  token: string,
  payload: { name: string; color: ColorId; count: 2 | 4; stake: number },
) {
  return request<RoomSnapshot>('/api/rooms', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export function findMatch(
  token: string,
  payload: { name: string; color: ColorId; count: 2 | 4; stake: number },
) {
  return request<RoomSnapshot>('/api/rooms/match', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export function joinRoom(token: string, payload: { code: string; name: string; color?: ColorId }) {
  return request<RoomSnapshot>('/api/rooms/join', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export function fetchRoom(token: string, code: string, rev?: number) {
  const q = typeof rev === 'number' && rev >= 0 ? `?rev=${rev}` : ''
  return request<RoomPoll>(`/api/rooms/${code}${q}`, {}, token)
}

export function startRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/start`, { method: 'POST' }, token)
}

export function rollRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/roll`, { method: 'POST' }, token)
}

export function moveRoom(token: string, code: string, tokenId: string) {
  return request<RoomSnapshot>(
    `/api/rooms/${code}/move`,
    { method: 'POST', body: JSON.stringify({ tokenId }) },
    token,
  )
}

export function leaveRoom(token: string, code: string) {
  return request<RoomSnapshot | { left: boolean }>(`/api/rooms/${code}/leave`, { method: 'POST' }, token)
}
