import { db } from './db.mjs'
import { setTelegramBotUsername } from './config.mjs'
import { GAME_ASSET, PACKS, formatLudo, ludoFromUnit } from './economy.mjs'
import { connectRedis } from './redis.mjs'
import {
  confirmInvoice,
  createInvoice,
  getPendingInvoice,
  listPacks,
} from './shop.mjs'
import { isActiveAgent, pendingCenterApp, submitCenterApp } from './desk.mjs'
import { isSolanaPubkey, solanaConfig } from './solana.mjs'
import { quoteWithdraw, requestWithdraw, withdrawInfo } from './withdraw.mjs'

const TOKEN = () => String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
const ADDR_RE = /0x[a-f0-9]{40}/i
const SIG_RE = /[1-9A-HJ-NP-Za-km-z]{64,88}/
const flows = new Map()

function flowOf(telegramId) {
  return flows.get(Number(telegramId)) || { kind: 'idle' }
}

function setFlow(telegramId, next) {
  const id = Number(telegramId)
  if (!next || next.kind === 'idle') flows.delete(id)
  else flows.set(id, next)
}

function clearFlow(telegramId) {
  flows.delete(Number(telegramId))
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${TOKEN()}/${method}`
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function telegram(method, body) {
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.ok) {
    throw new Error(data.description || `Telegram ${method} a échoué.`)
  }
  return data.result
}

function send(chatId, html, extra = {}) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  })
}

export function notifyTelegram(telegramId, html) {
  return send(telegramId, html)
}

function edit(chatId, messageId, html, extra = {}) {
  return telegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  })
}

async function walletByTelegram(telegramId) {
  return db.prepare('SELECT address, coins, telegram_id FROM wallets WHERE telegram_id = ?').get(telegramId)
}

async function walletByAddress(address) {
  return db.prepare('SELECT address, coins, telegram_id FROM wallets WHERE address = ?').get(address)
}

async function linkTelegram(address, telegramId) {
  const wallet = await walletByAddress(address)
  if (!wallet) {
    throw Object.assign(new Error('Compte introuvable. Créez d’abord un compte dans le jeu, puis envoyez votre identifiant ici.'), {
      status: 404,
    })
  }
  const mine = Number(wallet.telegram_id || 0)
  if (mine && mine !== Number(telegramId)) {
    throw new Error('Ce compte est déjà lié à un autre Telegram.')
  }
  const taken = await walletByTelegram(telegramId)
  if (taken && taken.address !== address) {
    throw new Error('Ce Telegram est déjà lié à un autre compte. Envoyez /unlink, puis réessayez.')
  }
  if (!mine) {
    await db.prepare('UPDATE wallets SET telegram_id = ? WHERE address = ?').run(telegramId, address)
  }
  return walletByAddress(address)
}

async function unlinkTelegram(telegramId) {
  const wallet = await walletByTelegram(telegramId)
  if (!wallet) return null
  await db.prepare('UPDATE wallets SET telegram_id = NULL WHERE telegram_id = ?').run(telegramId)
  return wallet
}

function packKeyboard() {
  return {
    inline_keyboard: PACKS.map((pack) => [
      {
        text: `${pack.name} · +${pack.usd} ${GAME_ASSET} · ${pack.usd} USDT`,
        callback_data: `pack:${pack.id}`,
      },
    ]),
  }
}

function amountKeyboard(info) {
  const rows = []
  let row = []
  for (const tier of info.tiers) {
    if (info.coins < tier.coins) continue
    row.push({
      text: `${tier.usd} ${GAME_ASSET} → ${tier.netUi} USDT`,
      callback_data: `wd:c:${tier.coins}`,
    })
    if (row.length === 2) {
      rows.push(row)
      row = []
    }
  }
  if (row.length) rows.push(row)
  if (info.coins >= 1) {
    rows.push([{ text: `Tout · ${formatLudo(info.coins)}`, callback_data: 'wd:all' }])
  }
  rows.push([{ text: 'Annuler', callback_data: 'wd:x' }])
  return { inline_keyboard: rows }
}

function confirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Confirmer le retrait', callback_data: 'wd:ok' },
        { text: 'Annuler', callback_data: 'wd:x' },
      ],
    ],
  }
}

function explorerTx(cluster, sig) {
  const q = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`
  return `https://solscan.io/tx/${encodeURIComponent(sig)}${q}`
}

function shortSol(value) {
  const s = String(value || '')
  if (s.length < 12) return s
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

function withdrawQuoteText(dest, quote, sol) {
  return [
    '<b>Confirmation de retrait</b>',
    `−${formatLudo(quote.coins)}`,
    `Vous recevez <b>${esc(quote.netUi)} ${esc(sol.asset || 'USDT')}</b>`,
    'Sans frais : 1 pour 1.',
    '',
    'Portefeuille Solana :',
    `<code>${esc(dest)}</code>`,
    sol.cluster && sol.cluster !== 'mainnet-beta' ? `\nRéseau : ${esc(sol.cluster)}` : '',
    '',
    'Confirmez uniquement si cette adresse vous appartient.',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
}

function helpText() {
  return [
    '<b>Guichet Ł</b>',
    'Les paiements se font ici. Le jeu ne traite pas l’argent.',
    '',
    '1. Envoyez votre identifiant du jeu (0x…)',
    '2. /recharge — créditer votre compte en USDT',
    '3. /retrait — recevoir l’USDT sur votre portefeuille Solana',
    '',
    '/compte — solde',
    '/centre — devenir centre de recharge',
    '/annuler — annuler une opération',
    '/unlink — détacher ce Telegram',
    '',
    'Espèces uniquement : un centre de recharge.',
  ].join('\n')
}

function accountText(wallet) {
  return [
    '<b>Compte lié</b>',
    `Identifiant : <code>${esc(wallet.address)}</code>`,
    `Solde : <b>${formatLudo(wallet.coins)}</b>`,
    '',
    '/recharge pour créditer · /retrait pour recevoir l’USDT.',
    '/centre pour ouvrir un centre de recharge.',
  ].join('\n')
}

function invoiceText(invoice) {
  const sol = solanaConfig()
  const lines = [
    `<b>Offre ${esc(invoice.name)}</b>`,
    `Vous recevez <b>${formatLudo(invoice.coins)}</b>`,
    '',
    'Versez <b>exactement</b> ce montant :',
    `<code>${esc(invoice.amountUi)}</code> ${esc(invoice.asset || 'USDT')}`,
    '',
    'Vers :',
    `<code>${esc(invoice.treasury)}</code>`,
    '',
    'USDT sur Solana uniquement, pas de SOL.',
  ]
  if (sol.cluster && sol.cluster !== 'mainnet-beta') {
    lines.push('', `Réseau : ${esc(sol.cluster)}`, `Contrat USDT : <code>${esc(sol.mint)}</code>`)
  }
  lines.push('', 'Après le paiement, envoyez ici la <b>signature</b> de la transaction.')
  return lines.join('\n')
}

async function showPacks(chatId, wallet) {
  const catalog = listPacks()
  if (!catalog.configured) {
    await send(chatId, 'Guichet USDT non configuré. Contactez l’administration.')
    return
  }
  await send(
    chatId,
    [
      `<b>Offres</b> · 1 ${GAME_ASSET} = 1 ${catalog.asset}`,
      `Compte : <code>${esc(wallet.address)}</code>`,
      `Solde : ${formatLudo(wallet.coins)}`,
      '',
      'Sélectionnez une offre :',
    ].join('\n'),
    { reply_markup: packKeyboard() },
  )
}

async function requireWallet(telegramId, chatId) {
  const wallet = await walletByTelegram(telegramId)
  if (wallet) return wallet
  await send(
    chatId,
    'Liez d’abord votre compte. Copiez votre <b>identifiant joueur</b> dans le jeu (0x…) et envoyez-le ici.',
  )
  return null
}

async function startWithdraw(telegramId, chatId) {
  const wallet = await requireWallet(telegramId, chatId)
  if (!wallet) return
  const info = await withdrawInfo(wallet.address)
  if (!info.payoutReady) {
    await send(chatId, 'Guichet non prêt. Vérifiez la configuration USDT auprès de l’administration.')
    return
  }
  if (info.coins < 1) {
    await send(chatId, `Solde insuffisant (${formatLudo(info.coins)}). Utilisez /recharge.`)
    return
  }
  setFlow(telegramId, { kind: 'withdraw_dest' })
  await send(
    chatId,
    [
      '<b>Retrait USDT</b>',
      `Solde : <b>${formatLudo(info.coins)}</b>`,
      `1 ${GAME_ASSET} = 1 ${info.asset} · retrait sans frais`,
      '',
      'Envoyez l’adresse de votre <b>portefeuille Solana</b> (pas l’identifiant 0x du jeu).',
    ].join('\n'),
  )
}

async function askWithdrawAmount(telegramId, chatId, dest) {
  const wallet = await walletByTelegram(telegramId)
  if (!wallet) {
    clearFlow(telegramId)
    await send(chatId, 'Compte non lié.')
    return
  }
  const info = await withdrawInfo(wallet.address)
  setFlow(telegramId, { kind: 'withdraw_amount', dest })
  await send(
    chatId,
    [
      `Adresse : <code>${esc(dest)}</code>`,
      `Solde : ${formatLudo(info.coins)}`,
      '',
      `Choisissez un montant, ou envoyez un nombre en ${GAME_ASSET}.`,
    ].join('\n'),
    { reply_markup: amountKeyboard(info) },
  )
}

async function previewWithdraw(telegramId, chatId, coins, messageId) {
  const wallet = await walletByTelegram(telegramId)
  const flow = flowOf(telegramId)
  if (!wallet || !flow.dest) {
    clearFlow(telegramId)
    await send(chatId, 'Session expirée. Reprenez avec /retrait.')
    return
  }
  const amount = Math.floor(Number(coins))
  if (!Number.isInteger(amount) || amount < 1) {
    await send(chatId, `Montant invalide. Envoyez un nombre en ${GAME_ASSET}, ou utilisez un bouton.`)
    return
  }
  if (amount > Number(wallet.coins)) {
    await send(chatId, `Solde disponible : ${formatLudo(wallet.coins)}.`)
    return
  }
  const quote = quoteWithdraw(amount)
  if (quote.grossRaw <= 0n || quote.netRaw <= 0n) {
    await send(chatId, 'Montant trop petit après frais.')
    return
  }
  const sol = solanaConfig()
  setFlow(telegramId, { kind: 'withdraw_confirm', dest: flow.dest, coins: amount, busy: false })
  const html = withdrawQuoteText(flow.dest, quote, { ...sol, asset: sol.symbol })
  if (messageId) {
    try {
      await edit(chatId, messageId, html, { reply_markup: confirmKeyboard() })
      return
    } catch {
      /* fall through */
    }
  }
  await send(chatId, html, { reply_markup: confirmKeyboard() })
}

async function executeWithdraw(telegramId, chatId, messageId) {
  const wallet = await walletByTelegram(telegramId)
  const flow = flowOf(telegramId)
  if (!wallet || flow.kind !== 'withdraw_confirm' || !flow.dest || !flow.coins) {
    clearFlow(telegramId)
    await send(chatId, 'Session expirée. Reprenez avec /retrait.')
    return
  }
  if (flow.busy) return
  setFlow(telegramId, { ...flow, busy: true })
  if (messageId) {
    try {
      await edit(chatId, messageId, 'Virement USDT en cours…')
    } catch {
      await send(chatId, 'Virement USDT en cours…')
    }
  } else {
    await send(chatId, 'Virement USDT en cours…')
  }
  try {
    const receipt = await requestWithdraw(wallet.address, flow.dest, { coins: flow.coins })
    clearFlow(telegramId)
    const sol = solanaConfig()
    const sig = receipt.withdrawal.txHash
    await send(
      chatId,
      [
        '<b>Retrait effectué</b>',
        `−${formatLudo(receipt.withdrawal.coins)}`,
        `${esc(receipt.withdrawal.netUi)} ${esc(receipt.withdrawal.asset)} vers <code>${esc(receipt.withdrawal.dest)}</code>`,
        `Nouveau solde : <b>${formatLudo(receipt.coins)}</b>`,
        '',
        `Tx : <a href="${esc(explorerTx(sol.cluster, sig))}">${esc(shortSol(sig))}</a>`,
      ].join('\n'),
    )
  } catch (error) {
    setFlow(telegramId, { ...flow, busy: false })
    console.error('Telegram withdraw:', error.message)
    await send(chatId, esc(error.message || 'Retrait refusé. Le solde n’a pas été modifié, ou a été rétabli.'))
  }
}

async function handlePack(telegramId, chatId, packId, messageId) {
  const wallet = await walletByTelegram(telegramId)
  if (!wallet) {
    await send(chatId, 'Compte non lié. Envoyez votre identifiant 0x… du jeu.')
    return
  }
  try {
    const { invoice } = await createInvoice(wallet.address, packId)
    const html = invoiceText(invoice)
    if (messageId) {
      try {
        await edit(chatId, messageId, html)
        return
      } catch {
        /* fall through */
      }
    }
    await send(chatId, html)
  } catch (error) {
    await send(chatId, esc(error.message || 'Impossible de créer la facture.'))
  }
}

async function handleSignature(telegramId, chatId, signature) {
  const wallet = await walletByTelegram(telegramId)
  if (!wallet) {
    await send(chatId, 'Compte non lié. Envoyez d’abord votre identifiant 0x… du jeu.')
    return
  }
  const pending = await getPendingInvoice(wallet.address)
  if (!pending) {
    await send(chatId, 'Aucune facture en attente. Envoyez /recharge et sélectionnez une offre.')
    return
  }
  try {
    const receipt = await confirmInvoice(wallet.address, pending.id, signature)
    const next = await walletByAddress(wallet.address)
    await send(
      chatId,
      [
        '<b>Paiement confirmé</b>',
        `+${formatLudo(receipt.order.coins)}`,
        `Nouveau solde : <b>${formatLudo(next?.coins ?? receipt.coins)}</b>`,
        '',
        'Le crédit est disponible dans le jeu.',
      ].join('\n'),
    )
  } catch (error) {
    console.error('Telegram confirm:', error.message, error.cause?.code || '')
    await send(chatId, esc(error.message || 'Paiement non reconnu. Vérifiez la signature et réessayez.'))
  }
}

async function handleAddress(telegramId, chatId, address) {
  try {
    const wallet = await linkTelegram(address, telegramId)
    await send(chatId, accountText(wallet))
    await showPacks(chatId, wallet)
  } catch (error) {
    await send(chatId, esc(error.message || 'Liaison impossible.'))
  }
}

async function handleCommand(telegramId, chatId, command) {
  if (command === '/start' || command === '/aide' || command === '/help') {
    const wallet = await walletByTelegram(telegramId)
    await send(chatId, helpText())
    if (wallet) await send(chatId, accountText(wallet))
    return
  }
  if (command === '/compte' || command === '/solde') {
    const wallet = await requireWallet(telegramId, chatId)
    if (wallet) await send(chatId, accountText(wallet))
    return
  }
  if (command === '/unlink') {
    clearFlow(telegramId)
    const wallet = await unlinkTelegram(telegramId)
    await send(
      chatId,
      wallet
        ? 'Telegram détaché. Renvoyez votre identifiant 0x… pour relier un compte.'
        : 'Rien n’était lié.',
    )
    return
  }
  if (command === '/annuler' || command === '/cancel') {
    const had = flowOf(telegramId).kind !== 'idle'
    clearFlow(telegramId)
    await send(chatId, had ? 'Opération annulée.' : 'Rien à annuler.')
    return
  }
  if (command === '/recharge' || command === '/buy' || command === '/packs') {
    clearFlow(telegramId)
    const wallet = await requireWallet(telegramId, chatId)
    if (wallet) await showPacks(chatId, wallet)
    return
  }
  if (command === '/retrait' || command === '/withdraw' || command === '/cashout') {
    await startWithdraw(telegramId, chatId)
    return
  }
  if (command === '/centre' || command === '/agence' || command === '/devenir') {
    await startCenterApp(telegramId, chatId)
  }
}

async function startCenterApp(telegramId, chatId) {
  const wallet = await requireWallet(telegramId, chatId)
  if (!wallet) return
  if (await isActiveAgent(wallet.address)) {
    await send(
      chatId,
      'Ce compte est déjà un centre de recharge. Connexion : page /caisse du site, avec le nom du centre.',
    )
    return
  }
  const open = await pendingCenterApp(wallet.address)
  if (open) {
    await send(chatId, `Demande déjà en cours : <b>${esc(open.name)}</b>. L’administration la traite.`)
    return
  }
  setFlow(telegramId, { kind: 'center_name' })
  await send(
    chatId,
    [
      '<b>Demande de centre de recharge</b>',
      'Envoyez le <b>nom du centre</b> (3 à 32 caractères : lettres, chiffres, tiret).',
      'Ce nom servira à vous connecter à la caisse.',
    ].join('\n'),
  )
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id
  const fromId = msg.from?.id
  if (!chatId || !fromId || msg.from?.is_bot) return
  const text = String(msg.text || '').trim()
  if (!text) {
    await send(chatId, 'Envoyez un identifiant 0x…, /recharge, /retrait, ou une signature de paiement.')
    return
  }

  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase()
  if (command.startsWith('/')) {
    const space = text.indexOf(' ')
    const rest = space >= 0 ? text.slice(space).trim() : ''
    const solInCmd = rest.split(/\s+/).find((part) => isSolanaPubkey(part))
    if (solInCmd && (command === '/retrait' || command === '/withdraw' || command === '/cashout')) {
      const wallet = await requireWallet(fromId, chatId)
      if (wallet) await askWithdrawAmount(fromId, chatId, solInCmd.trim())
      return
    }
    await handleCommand(fromId, chatId, command)
    const addrInCmd = rest.match(ADDR_RE)?.[0]?.toLowerCase()
    if (addrInCmd && (command === '/start' || command === '/recharge')) {
      await handleAddress(fromId, chatId, addrInCmd)
    }
    return
  }

  const flow = flowOf(fromId)
  if (flow.kind === 'withdraw_dest') {
    const dest = text.replace(/\s+/g, '')
    if (ADDR_RE.test(dest)) {
      await send(chatId, 'Ceci est l’identifiant du jeu. Envoyez l’adresse <b>Solana</b> de votre portefeuille.')
      return
    }
    if (!isSolanaPubkey(dest)) {
      await send(chatId, 'Adresse Solana invalide. Copiez-la depuis votre portefeuille, puis envoyez-la ici.')
      return
    }
    await askWithdrawAmount(fromId, chatId, dest)
    return
  }
  if (flow.kind === 'center_name') {
    const name = text.trim()
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(name)) {
      await send(chatId, 'Nom invalide. 3 à 32 caractères : lettres, chiffres, point ou tiret. Sans espace.')
      return
    }
    setFlow(fromId, { kind: 'center_city', name })
    await send(chatId, 'Ville du centre (ou envoyez <b>-</b> si vous ne souhaitez pas la préciser).')
    return
  }
  if (flow.kind === 'center_city') {
    const raw = text.trim()
    const city = !raw || raw === '-' || raw.toLowerCase() === 'aucune' ? '' : raw.slice(0, 48)
    if (city && city.length < 2) {
      await send(chatId, 'Ville trop courte. Envoyez le nom de la ville, ou <b>-</b>.')
      return
    }
    const wallet = await walletByTelegram(fromId)
    if (!wallet) {
      clearFlow(fromId)
      await send(chatId, 'Compte non lié.')
      return
    }
    try {
      const app = await submitCenterApp({
        telegramId: fromId,
        address: wallet.address,
        name: flow.name,
        city,
      })
      clearFlow(fromId)
      await send(
        chatId,
        [
          '<b>Demande enregistrée</b>',
          `Centre : <b>${esc(app.name)}</b>${app.city ? ` · ${esc(app.city)}` : ''}`,
          'L’administration valide ensuite. Vous serez notifié ici.',
        ].join('\n'),
      )
    } catch (error) {
      clearFlow(fromId)
      await send(chatId, esc(error.message || 'Demande impossible.'))
    }
    return
  }
  if (flow.kind === 'withdraw_amount' || flow.kind === 'withdraw_confirm') {
    const destMaybe = text.replace(/\s+/g, '')
    if (isSolanaPubkey(destMaybe) && destMaybe.length <= 44) {
      await askWithdrawAmount(fromId, chatId, destMaybe)
      return
    }
    const asNumber = Number(String(text).replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(asNumber) && asNumber >= 1) {
      await previewWithdraw(fromId, chatId, ludoFromUnit(asNumber))
      return
    }
    await send(chatId, `Envoyez un montant en ${GAME_ASSET}, ou utilisez un bouton. /annuler pour arrêter.`)
    return
  }

  const address = text.match(ADDR_RE)?.[0]?.toLowerCase()
  if (address) {
    await handleAddress(fromId, chatId, address)
    return
  }

  const signature = text.match(SIG_RE)?.[0]
  if (signature && signature.length >= 64) {
    await handleSignature(fromId, chatId, signature)
    return
  }

  await send(chatId, helpText())
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id
  const fromId = query.from?.id
  const data = String(query.data || '')
  try {
    await telegram('answerCallbackQuery', { callback_query_id: query.id })
  } catch {
    /* already answered */
  }
  if (!chatId || !fromId) return
  if (data.startsWith('pack:')) {
    clearFlow(fromId)
    await handlePack(fromId, chatId, data.slice(5), query.message?.message_id)
    return
  }
  if (data === 'wd:x') {
    clearFlow(fromId)
    if (query.message?.message_id) {
      try {
        await edit(chatId, query.message.message_id, 'Retrait annulé.')
        return
      } catch {
        /* fall through */
      }
    }
    await send(chatId, 'Retrait annulé.')
    return
  }
  if (data === 'wd:all') {
    const wallet = await walletByTelegram(fromId)
    await previewWithdraw(fromId, chatId, wallet?.coins || 0, query.message?.message_id)
    return
  }
  if (data.startsWith('wd:c:')) {
    await previewWithdraw(fromId, chatId, Number(data.slice(5)), query.message?.message_id)
    return
  }
  if (data === 'wd:ok') {
    await executeWithdraw(fromId, chatId, query.message?.message_id)
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query)
    return
  }
  if (update.message) {
    await handleMessage(update.message)
  }
}

async function pollLoop() {
  let offset = 0
  let backoff = 1000
  while (TOKEN()) {
    try {
      const updates = await telegram('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message', 'callback_query'],
      })
      backoff = 1000
      for (const update of updates) {
        offset = update.update_id + 1
        try {
          await handleUpdate(update)
        } catch (error) {
          console.error('Telegram update:', error.message)
        }
      }
    } catch (error) {
      console.error('Telegram poll:', error.message)
      await new Promise((resolve) => setTimeout(resolve, backoff))
      backoff = Math.min(30_000, backoff * 2)
    }
  }
}

export async function startTelegramBot() {
  if (!TOKEN()) {
    console.log('Telegram : pas de TELEGRAM_BOT_TOKEN — bot inactif.')
    return false
  }
  if (process.env.TELEGRAM_DISABLE === '1') return false

  await connectRedis()
  const me = await telegram('getMe')
  setTelegramBotUsername(me.username)
  await telegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'Aide et liaison du compte' },
      { command: 'recharge', description: 'Approvisionnement USDT' },
      { command: 'retrait', description: 'Virement USDT' },
      { command: 'centre', description: 'Demander un centre de recharge' },
      { command: 'compte', description: 'Consulter le solde' },
      { command: 'annuler', description: 'Annuler une opération' },
      { command: 'unlink', description: 'Détacher ce Telegram' },
    ],
  }).catch(() => undefined)
  const sol = solanaConfig()
  console.log(`Telegram bot @${me.username} prêt · recharge + retrait ${sol.symbol} · ${sol.cluster}`)
  void pollLoop()
  return true
}

const isMain = Boolean(process.argv[1]?.includes('telegram.mjs'))
if (isMain) {
  const { initDb } = await import('./db.mjs')
  await initDb()
  const ok = await startTelegramBot()
  if (!ok) process.exit(TOKEN() ? 1 : 0)
}
