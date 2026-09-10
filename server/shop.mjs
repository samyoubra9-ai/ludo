import { randomBytes } from 'node:crypto'
import { db, tx } from './db.mjs'
import { GAME_ASSET, LUDO_PER_USD, PACKS, ludoForUsd } from './economy.mjs'
import { formatRaw, isSolanaSig, packRaw, solanaConfig, verifyTokenPayment } from './solana.mjs'

function nowIso() {
  return new Date().toISOString()
}

function uniqueRaw(baseRaw, decimals) {
  const cap = 10n ** BigInt(Math.max(1, Math.min(3, decimals - 2))) - 1n
  const dust = BigInt(`0x${randomBytes(3).toString('hex')}`) % cap
  return baseRaw + (dust === 0n ? 1n : dust)
}

function packView(pack) {
  return {
    id: pack.id,
    name: pack.name,
    usd: pack.usd,
    coins: ludoForUsd(pack.usd),
    tokens: pack.usd,
    tag: pack.tag,
  }
}

export function listPacks() {
  const sol = solanaConfig()
  return {
    configured: sol.configured,
    network: `Solana ${sol.cluster}`,
    cluster: sol.cluster,
    asset: sol.symbol,
    gameAsset: GAME_ASSET,
    ludoPerUsd: LUDO_PER_USD,
    mint: sol.mint,
    treasury: sol.treasury,
    decimals: sol.decimals,
    packs: PACKS.map(packView),
  }
}

export async function listOrders(address) {
  return db
    .prepare(
      `SELECT id, pack_id, coins, usdt AS tokens, status, expected_raw, tx_hash, tx_sig, created_at
       FROM shop_orders WHERE address = ? ORDER BY created_at DESC LIMIT 12`,
    )
    .all(address)
}

export async function getPendingInvoice(address) {
  return db
    .prepare(
      `SELECT * FROM shop_orders WHERE address = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(address)
}

export async function createInvoice(address, packId) {
  const sol = solanaConfig()
  if (!sol.configured) {
    throw Object.assign(new Error(`${sol.symbol} non configuré. Renseigne SOLANA_MINT et SOLANA_TREASURY.`), {
      status: 400,
    })
  }

  const pack = PACKS.find((item) => item.id === packId)
  if (!pack) throw Object.assign(new Error('Pack introuvable.'), { status: 404 })

  const wallet = await db.prepare('SELECT address FROM wallets WHERE address = ?').get(address)
  if (!wallet) throw Object.assign(new Error('Compte introuvable.'), { status: 404 })

  await db.prepare("UPDATE shop_orders SET status = 'expired' WHERE address = ? AND status = 'pending'").run(address)

  const coins = ludoForUsd(pack.usd)
  const expectedRaw = uniqueRaw(packRaw(pack.usd, sol.decimals), sol.decimals)
  const id = randomBytes(16).toString('hex')
  const amountUi = formatRaw(expectedRaw, sol.decimals)

  await db
    .prepare(
      `INSERT INTO shop_orders (id, address, pack_id, coins, usdt, tx_hash, created_at, status, expected_raw, tx_sig)
     VALUES (?, ?, ?, ?, ?, '', ?, 'pending', ?, '')`,
    )
    .run(id, address, pack.id, coins, pack.usd, nowIso(), expectedRaw.toString())

  return {
    invoice: {
      id,
      packId: pack.id,
      name: pack.name,
      coins,
      usd: pack.usd,
      tokens: pack.usd,
      amountUi,
      expectedRaw: expectedRaw.toString(),
      mint: sol.mint,
      treasury: sol.treasury,
      cluster: sol.cluster,
      asset: sol.symbol,
      gameAsset: GAME_ASSET,
      ludoPerUsd: LUDO_PER_USD,
      network: `Solana ${sol.cluster}`,
    },
  }
}

export async function confirmInvoice(address, invoiceId, signature) {
  const sol = solanaConfig()
  if (!sol.configured) {
    throw Object.assign(new Error(`${sol.symbol} non configuré.`), { status: 400 })
  }
  if (!isSolanaSig(signature)) {
    throw Object.assign(new Error('Signature Solana invalide.'), { status: 400 })
  }

  const order = await db.prepare('SELECT * FROM shop_orders WHERE id = ? AND address = ?').get(invoiceId, address)
  if (!order) throw Object.assign(new Error('Facture introuvable.'), { status: 404 })
  if (order.status === 'paid') {
    const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
    return receiptOf(order, wallet.coins, sol, address)
  }
  if (order.status !== 'pending') {
    throw Object.assign(new Error('Cette facture n’est plus valable. Recrée un pack.'), { status: 400 })
  }

  const used = await db.prepare("SELECT id FROM shop_orders WHERE tx_sig = ? AND status = 'paid'").get(signature.trim())
  if (used) throw Object.assign(new Error('Cette transaction a déjà été utilisée.'), { status: 400 })

  await verifyTokenPayment(signature, order.expected_raw)

  const txSig = signature.trim()
  try {
    const paid = await tx(async () => {
      const locked = await db
        .prepare('SELECT * FROM shop_orders WHERE id = ? AND address = ? FOR UPDATE')
        .get(invoiceId, address)
      if (!locked) throw Object.assign(new Error('Facture introuvable.'), { status: 404 })
      if (locked.status === 'paid') {
        const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
        return { coins: wallet.coins, order: locked }
      }
      if (locked.status !== 'pending') {
        throw Object.assign(new Error('Cette facture n’est plus valable. Recrée un pack.'), { status: 400 })
      }

      const used = await db
        .prepare("SELECT id FROM shop_orders WHERE tx_sig = ? AND status = 'paid'")
        .get(txSig)
      if (used) throw Object.assign(new Error('Cette transaction a déjà été utilisée.'), { status: 400 })

      await db.prepare('SELECT address FROM wallets WHERE address = ? FOR UPDATE').get(address)
      await db
        .prepare('UPDATE wallets SET coins = coins + ?, updated_at = ? WHERE address = ?')
        .run(locked.coins, nowIso(), address)
      const marked = await db
        .prepare("UPDATE shop_orders SET status = 'paid', tx_hash = ?, tx_sig = ? WHERE id = ? AND status = 'pending'")
        .run(txSig, txSig, locked.id)
      if (!marked.changes) {
        throw Object.assign(new Error('Cette facture n’est plus valable. Recrée un pack.'), { status: 400 })
      }
      const wallet = await db.prepare('SELECT coins FROM wallets WHERE address = ?').get(address)
      return {
        coins: wallet.coins,
        order: { ...locked, tx_hash: txSig, tx_sig: txSig, status: 'paid' },
      }
    })
    return receiptOf(paid.order, paid.coins, sol, address)
  } catch (error) {
    if (error?.code === '23505') {
      throw Object.assign(new Error('Cette transaction a déjà été utilisée.'), { status: 400 })
    }
    throw error
  }
}

function receiptOf(order, coins, sol, address) {
  return {
    coins,
    order: {
      id: order.id,
      packId: order.pack_id,
      name: PACKS.find((p) => p.id === order.pack_id)?.name || order.pack_id,
      coins: order.coins,
      usd: order.usdt,
      tokens: order.usdt,
      amountUi: formatRaw(order.expected_raw || '0', sol.decimals),
      txHash: order.tx_sig || order.tx_hash,
      network: `Solana ${sol.cluster}`,
      asset: sol.symbol,
      gameAsset: GAME_ASSET,
      mint: sol.mint,
      treasury: sol.treasury,
      from: address,
    },
  }
}
