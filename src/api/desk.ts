import { apiRequest } from './client'

export const ADMIN_TOKEN_KEY = 'ludo-admin-token'
export const KIOSK_TOKEN_KEY = 'ludo-kiosk-token'

export type DeskAgent = {
  id: number
  name: string
  address: string
  status: 'active' | 'frozen' | string
  coins: number
  clients: number
  sellDa: number
  buyDa: number
  profitDa: number
  created_at: string
}

export type CashPnl = {
  cashIn: number
  cashOut: number
  profit: number
  sold: number
  bought: number
  sell: number
  buyback: number
}

export type AdminOp = {
  id: string
  kind: 'sell' | 'buyback' | string
  coins: number
  da?: number
  client_address: string
  created_at: string
  agent_name: string
}

export type AdminOverview = {
  kiosks: { total: number; active: number; frozen: number; stock: number }
  players: {
    wallets: number
    tagged: number
    online?: number
    playing?: number
    lobby?: number
    rooms?: number
  }
  today: { sell: number; buyback: number; sellCoins: number; buybackCoins: number; sellDa?: number; buybackDa?: number }
  house: { rakeLudo: number; rakeLudoToday: number; wins: number; winsToday: number; unit: number }
  kiosk: CashPnl
  kioskToday: CashPnl
  recent: AdminOp[]
}

export type KioskOp = {
  id: string
  kind: 'sell' | 'buyback' | string
  client_address: string
  coins: number
  da?: number
  created_at: string
}

export type KioskClient = {
  address: string
  coins: number
  playing: boolean
  kioskId: number | null
  kioskName: string | null
  yours: boolean
  canSell: boolean
  canBuyback: boolean
}

export type KioskRoster = {
  address: string
  coins: number
  updated_at: string
}

export type KioskMe = {
  name: string
  address: string
  coins: number
  stakes: number[]
  clients: number
  sellDa: number
  buyDa: number
  unit: number
  today: { sell: number; buyback: number; sellCoins: number; buybackCoins: number }
  pnl: CashPnl
  pnlToday: CashPnl
  ops: KioskOp[]
  roster: KioskRoster[]
}

export function parsePlayerId(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  const matched = s.match(/0x[a-f0-9]{40}/)
  if (matched) return matched[0]
  if (/^[a-f0-9]{40}$/.test(s)) return `0x${s}`
  return null
}

export function loadToken(key: string) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

export function saveToken(key: string, token: string) {
  try {
    localStorage.setItem(key, token)
  } catch {
    /* ignore */
  }
}

export function clearToken(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function adminStatus() {
  return apiRequest<{ setupNeeded: boolean }>('/api/admin/status')
}

export function adminSetup(username: string, password: string) {
  return apiRequest<{ token: string; username: string }>('/api/admin/setup', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function adminLogin(username: string, password: string) {
  return apiRequest<{ token: string; username: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function adminMe(token: string) {
  return apiRequest<{ username: string }>('/api/admin/me', {}, token)
}

export function adminOverview(token: string) {
  return apiRequest<AdminOverview>('/api/admin/overview', {}, token)
}

export function listAdminOps(token: string) {
  return apiRequest<{ ops: AdminOp[] }>('/api/admin/ops', {}, token)
}

export function adminLogout(token: string) {
  return apiRequest<{ ok: boolean }>('/api/admin/logout', { method: 'POST' }, token).catch(() => undefined)
}

export function listAgents(token: string) {
  return apiRequest<{ agents: DeskAgent[] }>('/api/admin/agents', {}, token)
}

export function createAgent(token: string, payload: { name: string; address: string; password: string }) {
  return apiRequest<{ agent: DeskAgent }>('/api/admin/agents', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token)
}

export function setAgentFrozen(token: string, id: number, freeze: boolean) {
  return apiRequest<{ agent: DeskAgent }>(
    `/api/admin/agents/${id}/${freeze ? 'freeze' : 'unfreeze'}`,
    { method: 'POST' },
    token,
  )
}

export function deleteAgent(token: string, id: number) {
  return apiRequest<{ ok: boolean; name: string }>(`/api/admin/agents/${id}/delete`, { method: 'POST' }, token)
}

export type CenterApp = {
  id: number
  telegram_id: number
  address: string
  name: string
  city: string
  status: 'pending' | 'approved' | 'rejected' | string
  created_at: string
  decided_at?: string | null
}

export function listCenterApps(token: string) {
  return apiRequest<{ apps: CenterApp[] }>('/api/admin/center-apps', {}, token)
}

export function approveCenterApp(token: string, id: number) {
  return apiRequest<{ ok: boolean; status: string; password?: string; login?: string }>(
    `/api/admin/center-apps/${id}/approve`,
    { method: 'POST' },
    token,
  )
}

export function rejectCenterApp(token: string, id: number) {
  return apiRequest<{ ok: boolean; status: string }>(
    `/api/admin/center-apps/${id}/reject`,
    { method: 'POST' },
    token,
  )
}

export type AdminWallet = {
  address: string
  coins: number
  kioskName: string | null
  kioskStatus: string | null
  playing: boolean
}

export type AdminGrant = {
  id: string
  address: string
  coins: number
  note: string
  created_at: string
  username?: string | null
}

export function lookupAdminWallet(token: string, address: string) {
  return apiRequest<AdminWallet>(`/api/admin/wallet/${encodeURIComponent(address)}`, {}, token)
}

export function creditWallet(token: string, address: string, coins: number, note = '') {
  return apiRequest<{ address: string; coins: number; balance: number; kioskName: string | null; note: string }>(
    '/api/admin/credit',
    { method: 'POST', body: JSON.stringify({ address, coins, note }) },
    token,
  )
}

export function listGrants(token: string) {
  return apiRequest<{ grants: AdminGrant[] }>('/api/admin/grants', {}, token)
}

export function kioskLogin(username: string, password: string) {
  return apiRequest<{ token: string; name: string; address: string; coins: number }>('/api/kiosk/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function kioskMe(token: string) {
  return apiRequest<KioskMe>('/api/kiosk/me', {}, token)
}

export function setKioskRates(token: string, sellDa: number, buyDa: number) {
  return apiRequest<{ sellDa: number; buyDa: number }>('/api/kiosk/rates', {
    method: 'POST',
    body: JSON.stringify({ sellDa, buyDa }),
  }, token)
}

export function kioskLogout(token: string) {
  return apiRequest<{ ok: boolean }>('/api/kiosk/logout', { method: 'POST' }, token).catch(() => undefined)
}

export function lookupClient(token: string, address: string) {
  return apiRequest<KioskClient>(`/api/kiosk/client/${encodeURIComponent(address)}`, {}, token)
}

export function sellLudo(token: string, address: string, coins: number) {
  return apiRequest<{ kioskCoins: number; clientCoins: number; coins: number; da?: number; address: string; kind: string }>(
    '/api/kiosk/sell',
    { method: 'POST', body: JSON.stringify({ address, coins }) },
    token,
  )
}

export function buybackLudo(token: string, address: string, coins: number) {
  return apiRequest<{ kioskCoins: number; clientCoins: number; coins: number; da?: number; address: string; kind: string }>(
    '/api/kiosk/buyback',
    { method: 'POST', body: JSON.stringify({ address, coins }) },
    token,
  )
}
