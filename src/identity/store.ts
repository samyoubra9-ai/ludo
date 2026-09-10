export interface LocalSession {
  address: string
  token: string
}

const SESSION_KEY = 'ludo-session-v2'

export function loadSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as LocalSession
    if (!data.address?.startsWith('0x') || !data.token) return null
    return data
  } catch {
    return null
  }
}

export function saveSession(session: LocalSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}
