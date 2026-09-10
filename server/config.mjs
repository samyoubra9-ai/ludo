import './solana.mjs'
import { networkInterfaces } from 'node:os'

export const PORT = Number(process.env.PORT || 8787)
export const PUBLIC_URL = String(process.env.PUBLIC_URL || '')
  .trim()
  .replace(/\/$/, '')
export const FRONT_PORT = Number(process.env.FRONT_PORT || 5173)

let botUsername = String(process.env.TELEGRAM_BOT_USERNAME || '')
  .trim()
  .replace(/^@/, '')

export function telegramBotUsername() {
  return botUsername || null
}

export function setTelegramBotUsername(name) {
  botUsername = String(name || '')
    .trim()
    .replace(/^@/, '')
}

export function publicUrls() {
  if (PUBLIC_URL) return [PUBLIC_URL]
  const urls = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue
      urls.push(`http://${net.address}:${FRONT_PORT}`)
    }
  }
  return urls
}

export function allowOrigin(origin) {
  if (!origin) return true
  if (!PUBLIC_URL) return true
  if (origin === PUBLIC_URL) return true
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true
  return publicUrls().includes(origin)
}
