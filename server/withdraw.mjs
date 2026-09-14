import { randomBytes } from 'node:crypto'
import { db, tx } from './db.mjs'
import {
  GAME_ASSET,
  LUDO_PER_USD,
  WITHDRAW_FEE_BPS,
  WITHDRAW_TIERS_USD,
  feePercent,
  ludoForUsd,
  netPayoutRaw,
} from './economy.mjs'
import { isPlaying } from './rooms.mjs'
import { isSolanaPubkey, sendTokens, solanaConfig } from './solana.mjs'

function nowIso() {
  return new Date().toISOString()
}

function quoteCoins(coins, sol = solanaConfig()) {
  const amount = Math.floor(Number(coins))
  const grossRaw = (BigInt(amount) * 10n ** BigInt(sol.decimals)) / BigInt(LUDO_PER_USD)
  const netRaw = netPayoutRaw(grossRaw)
  return {
    usd: amount / LUDO_PER_USD,
    coins: amount,
    grossRaw,
    netRaw,
    grossUi: formatRaw(grossRaw, sol.decimals),
    netUi: formatRaw(netRaw, sol.decimals),
    feeUi: formatRaw(grossRaw - netRaw, sol.decimals),
  }
}

function quoteUsd(usd, sol = solanaConfig()) {
  return quoteCoins(ludoForUsd(usd), sol)
}

export function quoteWithdraw(coins) {
  return quoteCoins(Math.floor(Number(coins)))
}

export async function withdrawInfo(address) {
  const sol = solanaConfig()
  const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
  const history = await db
    .prepare(
      `SELECT id, dest, tokens, coins, status, tx_sig, created_at
       FROM withdrawals WHERE address = ? ORDER BY created_at DESC LIMIT 8`,
    )
    .all(address)
  return {
    payoutReady: Boolean(sol.payoutReady),
    configured: sol.configured,
    network: `Solana ${sol.cluster}`,
    cluster: sol.cluster,
    asset: sol.symbol,
    gameAsset: GAME_ASSET,
    ludoPerUsd: LUDO_PER_USD,
    feeBps: WITHDRAW_FEE_BPS,
    feePercent: feePercent(),
    mint: sol.mint,
    treasury: sol.treasury,
    pointsPerToken: LUDO_PER_USD,
    tiers: WITHDRAW_TIERS_USD.map((usd) => {
      const quote = quoteUsd(usd, sol)
      return { usd, tokens: usd, coins: quote.coins, netUi: quote.netUi, feeUi: quote.feeUi }
    }),
    coins: wallet?.coins ?? 0,
    history,
  }
}

export async function requestWithdraw(address, dest, amount) {
  const sol = solanaConfig()
  if (!sol.payoutReady) {
    throw Object.assign(new Error('Guichet non prêt. Vérifiez la configuration USDT.'), { status: 400 })
  }

  const destClean = String(dest || '').trim()
  if (!isSolanaPubkey(destClean) || destClean === sol.mint) {
    throw Object.assign(new Error('Adresse Solana invalide (portefeuille, pas le contrat du jeton).'), { status: 400 })
  }

  const raw = amount && typeof amount === 'object' ? amount : { usd: amount }
  const fromCoins = raw.coins != null && raw.coins !== ''
  const coins = fromCoins
    ? Math.floor(Number(raw.coins))
    : ludoForUsd(Math.floor(Number(raw.usd ?? raw.tokens)))
  if (!Number.isInteger(coins) || coins < 1) {
    throw Object.assign(new Error('Choisis un montant à retirer.'), { status: 400 })
  }

  const quote = quoteCoins(coins, sol)
  if (quote.grossRaw <= 0n || quote.netRaw <= 0n) {
    throw Object.assign(new Error('Montant trop petit après frais.'), { status: 400 })
  }
  if (await isPlaying(address)) {
    throw Object.assign(new Error('Impossible de retirer pendant une partie.'), { status: 400 })
  }

  const id = randomBytes(16).toString('hex')
  let nextCoins = 0

  try {
    await tx(async () => {
      const openMatch = await db.prepare('SELECT id FROM matches WHERE address = ? AND settled = 0').get(address)
      if (openMatch) {
        throw Object.assign(new Error('Termine ta partie avant de retirer.'), { status: 400 })
      }

      await db.prepare('SELECT address FROM wallets WHERE address = ? FOR UPDATE').get(address)

      const pending = await db
        .prepare("SELECT id FROM withdrawals WHERE address = ? AND status = 'pending' FOR UPDATE")
        .get(address)
      if (pending) {
        throw Object.assign(new Error('Un retrait est déjà en cours.'), { status: 400 })
      }

      const cut = await db
        .prepare('UPDATE wallets SET coins = coins - ?, updated_at = ? WHERE address = ? AND coins >= ?')
        .run(coins, nowIso(), address, coins)
      if (!cut.changes) {
        throw Object.assign(new Error('Solde insuffisant.'), { status: 400 })
      }

      const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
      nextCoins = wallet.coins
      await db
        .prepare(
          `INSERT INTO withdrawals (id, address, dest, tokens, coins, status, tx_sig, error, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', '', '', ?)`,
        )
        .run(id, address, destClean, quote.usd, coins, nowIso())
    })
  } catch (error) {
    if (error?.code === '23505') {
      throw Object.assign(new Error('Un retrait est déjà en cours.'), { status: 400 })
    }
    throw error
  }

  try {
    const txSig = await sendTokens(destClean, quote.netUi)
    await db.prepare("UPDATE withdrawals SET status = 'paid', tx_sig = ? WHERE id = ?").run(txSig, id)
    return {
      coins: nextCoins,
      withdrawal: {
        id,
        dest: destClean,
        usd: quote.usd,
        tokens: quote.usd,
        coins,
        netUi: quote.netUi,
        feeUi: quote.feeUi,
        status: 'paid',
        txHash: txSig,
        network: `Solana ${sol.cluster}`,
        asset: sol.symbol,
        gameAsset: GAME_ASSET,
      },
    }
  } catch (error) {
    await tx(async () => {
      await db.prepare('SELECT address FROM wallets WHERE address = ? FOR UPDATE').get(address)
      await db
        .prepare('UPDATE wallets SET coins = coins + ?, updated_at = ? WHERE address = ?')
        .run(coins, nowIso(), address)
      await db
        .prepare("UPDATE withdrawals SET status = 'failed', error = ? WHERE id = ?")
        .run(String(error.message || 'échec').slice(0, 280), id)
    })
    throw Object.assign(new Error(error.message || 'Retrait échoué, solde rétabli.'), {
      status: error.status || 502,
    })
  }
}
