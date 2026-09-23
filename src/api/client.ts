import type { PaquetState } from '../paquet/engine'

export type PlayingInfo = {
  code: string
  status: 'lobby' | 'playing' | 'ended'
  leaving?: boolean
}

export interface WalletSnapshot {
  address: string
  coins: number
  refilled?: boolean
  kioskName?: string | null
  token?: string
  playing?: PlayingInfo | null
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
  color: string
  name: string
  address: string | null
  kind: 'human' | 'bot' | 'empty'
  online?: boolean
  botPlay?: boolean
  forfeited?: boolean
  leaving?: boolean
}

export type RoomSnapshot = {
  code: string
  host: string
  count: 8
  stake: number
  status: 'lobby' | 'playing' | 'ended'
  you: string | null
  seats: RoomSeat[]
  urls?: string[]
  rolling: boolean
  game: PaquetState | null
  coins?: number
  humans?: number
  left?: boolean
  rev?: number
  notice?: string | null
  forfeitWinAt?: number
  turnDueAt?: number
  startAt?: number
  kind?: 'private' | 'match'
  waiting?: { name: string; address: string }[]
  watching?: boolean
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
  payload: { name: string; color: string; count: 8; stake: number },
) {
  return request<RoomSnapshot>('/api/rooms', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export function findMatch(
  token: string,
  payload: { name: string; color: string; count: 8; stake: number },
) {
  return request<RoomSnapshot>('/api/rooms/match', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export function joinRoom(token: string, payload: { code: string; name: string; color?: string }) {
  return request<RoomSnapshot>('/api/rooms/join', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export function fetchRoom(token: string, code: string, rev?: number) {
  const q = typeof rev === 'number' && rev >= 0 ? `?rev=${rev}` : ''
  return request<RoomPoll>(`/api/rooms/${code}${q}`, {}, token)
}

export function startRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/start`, { method: 'POST' }, token)
}

export function pickRoom(token: string, code: string, packetId: number) {
  return request<RoomSnapshot>(
    `/api/rooms/${code}/pick`,
    { method: 'POST', body: JSON.stringify({ packetId }) },
    token,
  )
}

export function betRoom(token: string, code: string, amount: number) {
  return request<RoomSnapshot>(
    `/api/rooms/${code}/bet`,
    { method: 'POST', body: JSON.stringify({ amount }) },
    token,
  )
}

export function peekRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/peek`, { method: 'POST' }, token)
}

export function coverRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/cover`, { method: 'POST' }, token)
}

export function nextRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/next`, { method: 'POST' }, token)
}

export function rebuyRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/rebuy`, { method: 'POST' }, token)
}

export function offerRoom(token: string, code: string, amount: number) {
  return request<RoomSnapshot>(
    `/api/rooms/${code}/offer`,
    { method: 'POST', body: JSON.stringify({ amount }) },
    token,
  )
}

export function buyRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/buy`, { method: 'POST' }, token)
}

export function keepChefRoom(token: string, code: string) {
  return request<RoomSnapshot>(`/api/rooms/${code}/keep`, { method: 'POST' }, token)
}

export function leaveRoom(token: string, code: string) {
  return request<RoomSnapshot | { left: boolean }>(`/api/rooms/${code}/leave`, { method: 'POST' }, token)
}
