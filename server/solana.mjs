import { execFile } from 'node:child_process'
import dns from 'node:dns'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

dns.setDefaultResultOrder('ipv4first')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotEnv() {
  const file = join(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key] || key.startsWith('SOLANA_')) process.env[key] = value
  }
}

loadDotEnv()

const execFileAsync = promisify(execFile)
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/

const RPCS = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  testnet: 'https://api.testnet.solana.com',
}

const RPC_FALLBACKS = {
  devnet: ['https://api.devnet.solana.com', 'https://solana-devnet.drpc.org'],
  'mainnet-beta': [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com',
  ],
  testnet: ['https://api.testnet.solana.com'],
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function otherCluster(cluster) {
  return cluster === 'devnet' ? 'mainnet-beta' : 'devnet'
}

function clusterLabel(cluster) {
  return cluster === 'mainnet-beta' ? 'Mainnet' : cluster === 'devnet' ? 'Devnet' : cluster
}

function urlsFor(cluster) {
  const sol = solanaConfig()
  const extra = sol.cluster === cluster ? [sol.rpc] : []
  return [...new Set([...extra, RPCS[cluster], ...(RPC_FALLBACKS[cluster] || [])].filter(Boolean))]
}

function rpcUrls() {
  return urlsFor(solanaConfig().cluster)
}

function isTransientRpc(error) {
  const msg = `${error?.message || ''} ${error?.cause?.code || ''} ${error?.cause?.message || ''}`
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|AbortError|timeout|429|502|503|504|HTTP 429|HTTP 5/i.test(
    msg,
  )
}

function rpcPublicError(error) {
  if (isTransientRpc(error)) {
    return Object.assign(
      new Error('Réseau Solana injoignable. La transaction est peut-être déjà confirmée : renvoyez la signature dans 10 s.'),
      { status: 502 },
    )
  }
  return error.status ? error : Object.assign(new Error(error.message || 'Réseau Solana indisponible.'), { status: 502 })
}

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const DEVNET_TEST_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

export function solanaConfig() {
  const cluster = process.env.SOLANA_CLUSTER || 'devnet'
  const mint = (process.env.SOLANA_MINT || (cluster === 'devnet' ? DEVNET_TEST_MINT : USDT_MINT)).trim()
  const treasury = (process.env.SOLANA_TREASURY || '').trim()
  const decimals = Number(process.env.SOLANA_DECIMALS || 6)
  const symbol = (process.env.SOLANA_TOKEN_SYMBOL || 'USDT').trim() || 'USDT'
  const rpc = (process.env.SOLANA_RPC || RPCS[cluster] || RPCS.devnet).trim()
  const keypair = keypairPath()
  const configured = BASE58.test(mint) && BASE58.test(treasury) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 12
  const payoutReady = configured && existsSync(keypair)
  return { cluster, mint, treasury, decimals, symbol, rpc, keypair, configured, payoutReady }
}

export function keypairPath() {
  const raw = (process.env.SOLANA_KEYPAIR_PATH || './ludo.json').trim()
  return raw.startsWith('/') ? raw : join(root, raw)
}

export function isSolanaPubkey(value) {
  return typeof value === 'string' && BASE58.test(value.trim()) && value.trim().length >= 32 && value.trim().length <= 44
}

export function isSolanaSig(value) {
  return typeof value === 'string' && BASE58.test(value.trim()) && value.trim().length >= 64
}

export function formatRaw(raw, decimals) {
  const digits = BigInt(raw).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, -decimals) || '0'
  const frac = digits.slice(-decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

export function packRaw(tokens, decimals) {
  const scale = 10 ** Number(decimals)
  return BigInt(Math.round(Number(tokens) * scale))
}

async function rpcOnce(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    throw Object.assign(new Error(`RPC HTTP ${res.status}`), { status: 502 })
  }
  const data = await res.json()
  if (data.error) {
    throw Object.assign(new Error(data.error.message || 'Réseau Solana indisponible.'), { status: 502 })
  }
  return data.result
}

async function rpcOn(cluster, method, params) {
  const urls = urlsFor(cluster)
  let last = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const url of urls) {
      try {
        return await rpcOnce(url, method, params)
      } catch (error) {
        last = error
        console.error(`Solana RPC ${method} @ ${url}:`, error.message, error.cause?.code || '')
        if (!isTransientRpc(error) && !/HTTP 429|HTTP 5/.test(error.message || '')) {
          throw rpcPublicError(error)
        }
      }
    }
    await sleep(400 * 2 ** attempt)
  }
  throw rpcPublicError(last || new Error('Réseau Solana indisponible.'))
}

async function rpc(method, params) {
  return rpcOn(solanaConfig().cluster, method, params)
}

async function fetchTransaction(signature, cluster) {
  const query = [
    signature.trim(),
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]
  for (let i = 0; i < 6; i += 1) {
    const tx = await rpcOn(cluster, 'getTransaction', query)
    if (tx) return tx
    await sleep(700)
  }
  return null
}

export async function verifyTokenPayment(signature, expectedRaw) {
  const { mint, treasury, cluster, symbol } = solanaConfig()

  let tx = await fetchTransaction(signature, cluster)
  if (!tx) {
    const other = otherCluster(cluster)
    const elsewhere = await fetchTransaction(signature, other)
    if (elsewhere) {
      throw Object.assign(
        new Error(
          `Transaction trouvée sur Solana ${clusterLabel(other)}, pas sur ${clusterLabel(cluster)}. Réglez le réseau du portefeuille, puis renvoyez la signature.`,
        ),
        { status: 400 },
      )
    }
    throw Object.assign(
      new Error('Transaction introuvable. Attendez la confirmation on-chain, puis renvoyez la signature.'),
      { status: 404 },
    )
  }
  if (tx.meta?.err) {
    throw Object.assign(new Error('Cette transaction a échoué on-chain.'), { status: 400 })
  }

  const pre = new Map((tx.meta?.preTokenBalances || []).map((row) => [row.accountIndex, row]))
  const posts = tx.meta?.postTokenBalances || []
  const expected = BigInt(expectedRaw)

  for (const post of posts) {
    if (post.mint !== mint) continue
    if (post.owner !== treasury) continue
    const before = pre.get(post.accountIndex)
    const after = BigInt(post.uiTokenAmount?.amount || '0')
    const prev = BigInt(before?.uiTokenAmount?.amount || '0')
    if (after - prev === expected) return { mint, treasury, amount: expected.toString() }
  }

  throw Object.assign(
    new Error(`La transaction ne verse pas le bon ${symbol}, le bon montant, ou vers la bonne caisse.`),
    { status: 400 },
  )
}

export async function sendTokens(destination, amountUi) {
  const sol = solanaConfig()
  if (!sol.payoutReady) {
    throw Object.assign(new Error('Caisse non prête. Vérifie ludo.json et le .env.'), { status: 400 })
  }
  if (!isSolanaPubkey(destination) || destination === sol.mint) {
    throw Object.assign(new Error('Adresse Solana invalide (pas le mint).'), { status: 400 })
  }
  const amount = String(amountUi || '').trim()
  if (!amount || Number(amount) <= 0) {
    throw Object.assign(new Error(`Montant ${sol.symbol} invalide.`), { status: 400 })
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      'spl-token',
      [
        'transfer',
        sol.mint,
        amount,
        destination.trim(),
        '--owner',
        sol.keypair,
        '--fee-payer',
        sol.keypair,
        '--url',
        sol.rpc,
        '--allow-unfunded-recipient',
        '--fund-recipient',
        '--output',
        'json',
      ],
      { timeout: 120000, env: process.env },
    )
    const text = `${stdout}\n${stderr}`
    let txSig = ''
    try {
      const parsed = JSON.parse(String(stdout || '').trim())
      txSig = String(parsed.signature || parsed.Signature || '').trim()
    } catch {
      /* text fallback below */
    }
    const match = text.match(/Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,88})/)
    txSig = txSig || match?.[1] || ''
    if (!isSolanaSig(txSig)) {
      throw new Error(text.trim() || 'Envoi Solana sans signature.')
    }
    return txSig
  } catch (error) {
    if (error.status) throw error
    const detail = [error.stderr, error.stdout, error.message]
      .map((part) => (part ? String(part) : ''))
      .filter(Boolean)
      .join('\n')
    throw Object.assign(new Error(detail.trim().slice(0, 280) || 'Envoi Solana échoué.'), { status: 502 })
  }
}
