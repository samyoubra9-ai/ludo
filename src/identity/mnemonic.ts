import wordlistRaw from './english.txt?raw'
import { sha256 } from './sha256'

const WORDS = wordlistRaw.trim().split(/\n/)

function bytesToBits(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(2).padStart(8, '0')).join('')
}

export async function generateMnemonic(): Promise<string[]> {
  const entropy = new Uint8Array(16)
  crypto.getRandomValues(entropy)
  const checksum = await sha256(entropy)
  const bits = bytesToBits(entropy) + bytesToBits(checksum).slice(0, 4)
  const words: string[] = []
  for (let i = 0; i < 12; i += 1) {
    const index = Number.parseInt(bits.slice(i * 11, i * 11 + 11), 2)
    words.push(WORDS[index])
  }
  return words
}

export function normalizeWords(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input.join(' ') : input
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export async function isValidMnemonic(words: string[]): Promise<boolean> {
  if (words.length !== 12) return false
  if (words.some((w) => !WORDS.includes(w))) return false

  const bits = words
    .map((word) => WORDS.indexOf(word).toString(2).padStart(11, '0'))
    .join('')
  const entropyBits = bits.slice(0, 128)
  const checksumBits = bits.slice(128)
  const entropy = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) {
    entropy[i] = Number.parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2)
  }
  const hash = await sha256(entropy)
  return bytesToBits(hash).slice(0, 4) === checksumBits
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function mnemonicToAddress(words: string[]): Promise<string> {
  const hash = await sha256(new TextEncoder().encode(words.join(' ')))
  return `0x${toHex(hash).slice(0, 40)}`
}

export async function mnemonicToLoginToken(words: string[]): Promise<string> {
  const hash = await sha256(new TextEncoder().encode(`ludo-login-v1:${words.join(' ')}`))
  return toHex(hash)
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
