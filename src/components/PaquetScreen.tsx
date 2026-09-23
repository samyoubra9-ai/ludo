import { useEffect, useRef, useState } from 'react'
import {
  actorOf,
  betOptions,
  cardLabel,
  chefOf,
  clampBet,
  coverCurrent,
  freePackets,
  handDelta,
  heirOf,
  houseTake,
  isOver,
  isRecap,
  minBet,
  peekChef,
  pickPacket,
  placeBet,
  offerChef,
  buyChef,
  cancelOffer,
  salePrices,
  startNextHand,
  stepAuto,
  suitRed,
  viewFor,
  waitingHuman,
  youOf,
  aceEaters,
  type Card,
  type DuelLog,
  type PaquetColor,
  type PaquetPlayer,
  type PaquetState,
} from '../paquet/engine'
import { formatLudo, formatStakeUnit, formatUnit, GAME_ASSET, ludoFromUnit, unitFromLudo } from '../ludo/wallet'
import { playSfx } from '../audio/sfx'
import { AudioToggle } from './AudioToggle'
import { Coins } from './Coins'
import { PaquetBoard } from './PaquetBoard'
import { PAQUET_PALETTE } from '../paquet/palette'

const AUTO_MS: Partial<Record<PaquetState['phase'], number>> = {
  elect: 2000,
  named: 2800,
  pick: 340,
  bet: 480,
  peek: 700,
  cover: 900,
  duel: 1450,
  runoff: 380,
  claim: 2600,
}

export function PaquetScreen({
  initial,
  live,
  remote,
  onExit,
  onResign,
  onPark,
}: {
  initial: PaquetState
  live?: PaquetState | null
  remote?: {
    you: PaquetColor
    notice?: string | null
    pocket?: number
    onPick: (id: number) => void
    onBet: (amount: number) => void
    onPeek: () => void
    onCover: () => void
    onNext: () => void
    onOffer?: (amount: number) => void
    onBuy?: () => void
    onKeep?: () => void
    onRebuy?: () => void
    watching?: boolean
  }
  onExit: () => void
  onResign?: () => void
  onPark?: () => void
}) {
  const [local, setLocal] = useState(initial)
  const [askLeave, setAskLeave] = useState(false)
  const [rebuyBusy, setRebuyBusy] = useState(false)
  const game = remote ? (live ?? initial) : local
  const you = remote ? game.players.find((p) => p.color === remote.you) ?? game.players[0] : youOf(game)
  const chef = chefOf(game)
  const vs = game.players.find((p) => p.color === game.challenger) ?? null
  const actor = actorOf(game)
  const watching = Boolean(remote?.watching)
  const self = watching ? null : you.color
  const yourTurn = Boolean(self && waitingHuman(game, self))
  const canPick = (game.phase === 'pick' || game.phase === 'runoff') && yourTurn
  const canBet = game.phase === 'bet' && yourTurn
  const canPeek = game.phase === 'peek' && yourTurn
  const canCover = game.phase === 'cover' && yourTurn
  const selectable = canPick ? freePackets(game) : []
  const over = isOver(game)
  const recap = isRecap(game)
  const fight = game.phase === 'cover' || game.phase === 'duel'
  const pocket = remote?.pocket ?? 0
  const broke = you.coins < minBet(game) && you.bet <= 0
  const canRebuy = Boolean(remote?.onRebuy && game.paid && broke && pocket >= game.stake && !over)
  const needPocket = Boolean(remote && game.paid && broke && pocket < game.stake && !over)
  const bets = canBet ? betOptions(game, you.color) : []
  const duelPot = vs && fight ? vs.bet * 2 : game.pot
  const phaseRef = useRef(game.phase)

  useEffect(() => {
    if (remote) return
    const delay = AUTO_MS[local.phase]
    if (!delay) return
    if ((local.phase === 'pick' || local.phase === 'bet' || local.phase === 'runoff') && actorOf(local)?.isHuman) return
    if ((local.phase === 'peek' || local.phase === 'cover') && chefOf(local)?.isHuman) return
    const wait = window.setTimeout(() => {
      setLocal((cur) => stepAuto(cur))
    }, delay)
    return () => window.clearTimeout(wait)
  }, [remote, local])

  const duelRef = useRef('')
  const actorRef = useRef(game.actor)

  useEffect(() => {
    const mark = `${game.hand}-${(game.log ?? []).length}`
    if (game.lastDuel && duelRef.current !== mark) {
      duelRef.current = mark
      if (game.phase !== 'hand') {
        playSfx(game.lastDuel.winner === game.lastDuel.chef ? 'home' : 'capture')
      }
    }
  }, [game.lastDuel, game.hand, game.log, game.phase])

  useEffect(() => {
    const prev = phaseRef.current
    phaseRef.current = game.phase
    if (prev === game.phase) return
    if (game.phase === 'named' || game.phase === 'claim') playSfx('six')
  }, [game.phase])

  useEffect(() => {
    if (game.phase === 'bet' && game.actor && game.actor !== actorRef.current) playSfx('home')
    actorRef.current = game.actor
  }, [game.phase, game.actor])

  useEffect(() => {
    if (recap) playSfx('win', 120)
  }, [recap, game.hand])

  const choose = (id: number) => {
    if (remote) {
      remote.onPick(id)
      return
    }
    if (!canPick) return
    setLocal((cur) => pickPacket(cur, you.color, id))
  }

  const wager = (amount: number) => {
    if (remote) {
      remote.onBet(amount)
      return
    }
    if (!canBet) return
    setLocal((cur) => placeBet(cur, you.color, amount))
  }

  const look = () => {
    if (remote) {
      remote.onPeek()
      return
    }
    if (!canPeek) return
    setLocal((cur) => peekChef(cur, you.color))
  }

  const follow = () => {
    if (remote) {
      remote.onCover()
      return
    }
    if (!canCover) return
    setLocal((cur) => coverCurrent(cur, you.color))
  }

  const addChips = () => {
    if (!remote?.onRebuy || rebuyBusy) return
    setRebuyBusy(true)
    Promise.resolve(remote.onRebuy()).finally(() => setRebuyBusy(false))
  }

  const nextHand = () => {
    if (remote) {
      remote.onNext()
      return
    }
    setLocal((cur) => startNextHand(cur))
  }

  const leave = () => {
    if (over || recap || !onResign) {
      onExit()
      return
    }
    setAskLeave(true)
  }

  const confirmLeave = () => {
    setAskLeave(false)
    if (onResign) onResign()
    else if (onPark) onPark()
    else onExit()
  }

  return (
    <section className={`table table--paquet ${fight ? 'is-fight' : ''} ${game.phase === 'elect' || game.phase === 'named' || game.phase === 'claim' ? 'is-elect' : ''} ${game.phase === 'named' || game.phase === 'claim' ? 'is-named' : ''} ${game.phase === 'runoff' ? 'is-runoff' : ''} ${game.phase === 'bet' || game.phase === 'peek' ? 'is-bets' : ''}`}>
      <div className="table__stage">
        <PaquetBoard state={viewFor(game, self)} you={you.color} selectable={watching ? [] : selectable} onPick={choose} />
      </div>

      <header className="hud-top">
        <div className="hud-top__tools">
          <button type="button" className="btn-ghost" onClick={leave}>
            {over || recap ? 'Sortir' : 'Quitter'}
          </button>
          <AudioToggle />
        </div>
        <ChefBadge chef={chef} heir={heirOf(game)} you={self} phase={game.phase} />
        <div className="hud-bank">
          <Coins value={watching ? pocket : you.coins} label={watching ? 'poche' : game.paid ? 'table' : undefined} />
          {game.paid && remote ? (
            <small className="hud-pocket">poche {formatLudo(pocket)}</small>
          ) : null}
        </div>
      </header>

      <div className="hud-rail" aria-label="Joueurs">
        {game.players.map((player) => (
          <RailSeat
            key={player.color}
            player={player}
            chef={game.chef}
            nextChef={game.nextChef}
            you={self}
            actor={game.actor}
            challenger={game.challenger}
            elect={game.phase === 'elect' || game.phase === 'named'}
          />
        ))}
      </div>

      {vs && fight ? (
        <div className="hud-duel" role="status">
          <span className="hud-duel__kicker">1 contre 1</span>
          <span className="hud-duel__who">
            <b>{chef?.name}</b>
            <small>vs</small>
            <b>{vs.name}</b>
          </span>
          <strong>{formatLudo(duelPot)}</strong>
        </div>
      ) : null}

      {remote?.notice ? <p className="net-banner">{remote.notice}</p> : null}
      {watching ? <p className="net-banner">Tu joues au prochain coup. Regarde la table.</p> : null}

      {!recap && !over ? (
        <footer className="hud-dock">
          <p className="hud-dock__msg">{dockMessage(game, you, yourTurn, canPick, actor, vs)}</p>
          {canPick ? (
            <div className="hud-chips" aria-label="Paquets libres">
              {selectable.map((id) => (
                <button key={id} type="button" className="hud-chip" onClick={() => choose(id)}>
                  {id + 1}
                </button>
              ))}
            </div>
          ) : null}
          {canBet ? <BetPad game={game} you={you} quick={bets} onBet={wager} /> : null}
          {canPeek ? (
            <button type="button" className="hud-chip is-main" onClick={look}>
              Voir ma carte
            </button>
          ) : null}
          {canCover && vs ? (
            <button type="button" className="hud-chip is-main" onClick={follow}>
              Suivre {vs.name} · {formatLudo(vs.bet)}
            </button>
          ) : null}
          {canRebuy ? (
            <button type="button" className="hud-chip is-main" onClick={addChips} disabled={rebuyBusy}>
              {rebuyBusy ? 'Ajout…' : `Ajouter ${formatLudo(game.stake)}`}
            </button>
          ) : null}
          {needPocket ? (
            <p className="hud-dock__msg">Plus de jetons. Recharge ta poche à la caisse.</p>
          ) : null}
        </footer>
      ) : null}

      {recap ? (
        <RecapCard
          game={game}
          you={you}
          watching={watching}
          onNext={nextHand}
          onLeave={confirmLeave}
          canRebuy={canRebuy}
          rebuyBusy={rebuyBusy}
          onRebuy={addChips}
          onOffer={(amount) => {
            if (remote?.onOffer) remote.onOffer(amount)
            else setLocal((cur) => offerChef(cur, you.color, amount))
          }}
          onBuy={() => {
            if (remote?.onBuy) remote.onBuy()
            else setLocal((cur) => buyChef(cur, you.color))
          }}
          onKeep={() => {
            if (remote?.onKeep) remote.onKeep()
            else setLocal((cur) => cancelOffer(cur, you.color))
          }}
        />
      ) : null}

      {over ? (
        <div className="leave-scrim" role="dialog">
          <div className="leave-sheet">
            <p className="leave-sheet__kicker">Table</p>
            <h2>Partie terminée</h2>
            <p>{game.message}</p>
            <div className="leave-actions">
              <button type="button" className="btn-play" onClick={onExit}>
                Table
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {askLeave ? (
        <div className="leave-scrim" role="dialog">
          <div className="leave-sheet">
            <p className="leave-sheet__kicker">Un instant</p>
            <h2>Tu quittes la table ?</h2>
            <p>
              {remote
                ? 'Si tu as déjà misé, ça reste en jeu jusqu’au duel.'
                : 'Partie d’entraînement, rien n’est misé sur le vrai solde.'}
            </p>
            <div className="leave-actions">
              <button type="button" className="btn-ghost btn-ghost--wide" onClick={() => setAskLeave(false)}>
                Rester
              </button>
              <button type="button" className="btn-danger" onClick={confirmLeave}>
                Quitter
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function RecapCard({
  game,
  you,
  watching,
  onNext,
  onLeave,
  canRebuy,
  rebuyBusy,
  onRebuy,
  onOffer,
  onBuy,
  onKeep,
}: {
  game: PaquetState
  you: PaquetPlayer
  watching?: boolean
  onNext: () => void
  onLeave: () => void
  canRebuy?: boolean
  rebuyBusy?: boolean
  onRebuy?: () => void
  onOffer: (amount: number) => void
  onBuy: () => void
  onKeep: () => void
}) {
  const chef = chefOf(game)
  const house = houseTake(game)
  const board = [...game.players].sort((a, b) => handDelta(b) - handDelta(a) || a.name.localeCompare(b.name))
  const yours = handDelta(you)
  const asTaken = aceEaters(game.log)
  const isChef = chef?.color === you.color
  const prices = salePrices(game)
  const canBuy = Boolean(game.offer && !isChef && !watching && you.coins >= game.offer)
  const title = chef
    ? chef.color === you.color
      ? 'Tu es chef'
      : `${chef.name} est chef`
    : 'Coup terminé'
  const sub = asTaken.length
    ? asTaken.length > 1
      ? 'Barrage joué. La plus haute carte a pris le chef.'
      : `${asTaken[0] === you.color ? 'Tu as' : 'On a'} pris le chef avec un as.`
    : yours > 0
      ? `Toi · ${formatDelta(yours)}`
      : yours < 0
        ? `Toi · ${formatDelta(yours)}`
        : 'Le chef reste. Seul un as le prend.'
  return (
    <div className="recap-scrim" role="dialog" aria-label="Résumé du coup">
      <div className="recap-card">
        <p className="recap-card__kicker">La table a parlé · Coup {game.hand}</p>
        <div className="recap-hero">
          <span className="recap-medal" aria-hidden="true" />
          <div>
            <h2>{title}</h2>
            <p>{sub}</p>
          </div>
        </div>

        <div className="recap-scroll">
          {(game.log ?? []).length ? (
            <ul className="recap-duels">
              {(game.log ?? []).map((line, i) => (
                <li key={`${line.vs}-${i}`}>
                  <DuelLine line={line} players={game.players} you={you.color} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="recap-empty">Personne n’a misé ce coup.</p>
          )}

          <div className="recap-board">
            {board.map((player) => {
              const delta = handDelta(player)
              return (
                <div
                  key={player.color}
                  className={`recap-row ${player.color === you.color ? 'is-you' : ''} ${
                    player.color === chef?.color ? 'is-chef' : ''
                  } ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}
                >
                  <i style={{ background: PAQUET_PALETTE[player.color].hex }} />
                  <span>
                    {player.color === you.color ? 'Toi' : player.name}
                    {player.color === chef?.color ? <em>Chef</em> : null}
                  </span>
                  <b>{formatDelta(delta)}</b>
                  <small>{formatLudo(player.coins)}</small>
                </div>
              )
            })}
            {house > 0 ? (
              <div className="recap-row is-house">
                <i />
                <span>Maison</span>
                <b>{formatLudo(house)}</b>
                <small>10 %</small>
              </div>
            ) : null}
          </div>
        </div>

        {!watching ? (
          <div className="recap-sale">
            <p className="recap-sale__label">
              {game.offer
                ? `Chef à vendre · ${formatLudo(game.offer)}`
                : isChef
                  ? 'Tu peux vendre le chef'
                  : 'Le chef peut vendre son rôle'}
            </p>
            {isChef && !game.offer ? (
              <div className="hud-chips" aria-label="Prix du chef">
                {prices.map((price) => (
                  <button key={price} type="button" className="hud-chip" onClick={() => onOffer(price)}>
                    {formatLudo(price)}
                  </button>
                ))}
              </div>
            ) : null}
            {isChef && game.offer ? (
              <button type="button" className="btn-ghost btn-ghost--wide" onClick={onKeep}>
                Garder le chef
              </button>
            ) : null}
            {canBuy ? (
              <button type="button" className="btn-play" onClick={onBuy}>
                Acheter le chef · {formatLudo(game.offer!)}
              </button>
            ) : null}
            {game.offer && !isChef && !canBuy ? (
              <p className="recap-sale__wait">Pas assez sur la table pour acheter.</p>
            ) : null}
          </div>
        ) : null}

        <div className="recap-actions">
          {canRebuy ? (
            <button type="button" className="btn-play" onClick={onRebuy} disabled={rebuyBusy}>
              {rebuyBusy ? 'Ajout…' : `Ajouter ${formatLudo(game.stake)}`}
            </button>
          ) : null}
          {!watching ? (
            <button type="button" className="btn-play" onClick={onNext}>
              Prochain coup
            </button>
          ) : (
            <p className="field__hint">Tu t’assois au prochain coup.</p>
          )}
          <button type="button" className="btn-ghost btn-ghost--wide" onClick={onLeave}>
            Quitter
          </button>
        </div>
      </div>
    </div>
  )
}

function DuelLine({
  line,
  players,
  you,
}: {
  line: DuelLog
  players: PaquetPlayer[]
  you: PaquetColor
}) {
  const chef = players.find((p) => p.color === line.chef)
  const vs = players.find((p) => p.color === line.vs)
  const chefWon = line.winner === line.chef
  const chefName = line.chef === you ? 'Toi' : chef?.name ?? 'Chef'
  const vsName = line.vs === you ? 'Toi' : vs?.name ?? 'Joueur'
  return (
    <>
      <span className="recap-duel__who">
        {chefWon ? `${chefName} mange ${vsName}` : `${vsName} mange ${chefName}`}
      </span>
      <span className="recap-duel__cards">
        <MiniCard card={chefWon ? line.chefCard : line.playerCard} />
        <small>&gt;</small>
        <MiniCard card={chefWon ? line.playerCard : line.chefCard} />
      </span>
      <strong>{formatLudo(line.payout)}</strong>
    </>
  )
}

function MiniCard({ card }: { card: Card }) {
  return <em className={`mini-card ${suitRed(card.suit) ? 'is-red' : ''}`}>{cardLabel(card)}</em>
}

function formatDelta(n: number) {
  if (n > 0) return `+${formatLudo(n)}`
  if (n < 0) return `−${formatLudo(-n)}`
  return '—'
}

function parseUnit(raw: string) {
  const n = Number(raw.trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function BetPad({
  game,
  you,
  quick,
  onBet,
}: {
  game: PaquetState
  you: PaquetPlayer
  quick: number[]
  onBet: (amount: number) => void
}) {
  const min = minBet(game)
  const max = you.coins
  const [draft, setDraft] = useState(() => min)
  const [typed, setTyped] = useState<string | null>(null)

  const apply = (amount: number) => {
    setDraft(clampBet(game, you.color, amount))
    setTyped(null)
  }

  const fromText = (raw: string) => {
    const unit = parseUnit(raw)
    if (unit == null) return
    apply(ludoFromUnit(unit))
  }

  const shown = typed ?? formatStakeUnit(unitFromLudo(draft))
  const canSend = draft >= min && draft <= max

  return (
    <div className="bet-pad">
      <div className="hud-chips" aria-label="Mises rapides">
        {quick.map((amount) => (
          <button
            key={amount}
            type="button"
            className={`hud-chip ${amount === max ? 'is-all' : amount === min ? 'is-main' : ''} ${
              amount === draft && typed == null ? 'is-on' : ''
            }`}
            onClick={() => apply(amount)}
          >
            {amount === max && amount !== min ? `Tapis ${formatUnit(amount)}` : formatLudo(amount)}
          </button>
        ))}
      </div>
      <div className="bet-well">
        <button type="button" className="bet-step" aria-label="Baisser" onClick={() => apply(draft - min)}>
          −
        </button>
        <label className="bet-amount">
          <input
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            aria-label="Mise"
            value={shown}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => {
              if (typed != null) fromText(typed)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (typed != null) fromText(typed)
              }
            }}
          />
          <span>{GAME_ASSET}</span>
        </label>
        <button type="button" className="bet-step" aria-label="Monter" onClick={() => apply(draft + min)}>
          +
        </button>
      </div>
      <button type="button" className="hud-chip is-main bet-go" disabled={!canSend} onClick={() => onBet(draft)}>
        Miser {formatLudo(draft)}
      </button>
    </div>
  )
}

function ChefBadge({
  chef,
  heir,
  you,
  phase,
}: {
  chef: PaquetPlayer | null
  heir: PaquetPlayer | null
  you: PaquetColor | null
  phase: PaquetState['phase']
}) {
  if (!chef || phase === 'elect') {
    return (
      <div className="chef-badge is-wait">
        <span className="chef-badge__mark">Table</span>
        <strong>Qui est chef ?</strong>
      </div>
    )
  }
  if (phase === 'runoff') {
    return (
      <div className="chef-badge is-named">
        <span className="chef-badge__mark">As</span>
        <strong>Barrage pour le chef</strong>
      </div>
    )
  }
  const pass = heir && heir.color !== chef.color
  return (
    <div className={`chef-badge ${chef.color === you ? 'is-you' : ''} ${phase === 'named' ? 'is-named' : ''}`}>
      <span className="chef-badge__mark">Chef</span>
      <strong>{chef.name}</strong>
      {phase === 'named' && chef.electCard ? <em>{cardLabel(chef.electCard)}</em> : null}
      {chef.color === you && phase !== 'named' ? <em>c’est toi</em> : null}
      {pass && heir ? (
        <em className="chef-badge__next">{heir.color === you ? 'toi ensuite' : `${heir.name} ensuite`}</em>
      ) : null}
    </div>
  )
}

function RailSeat({
  player,
  chef,
  nextChef,
  you,
  actor,
  challenger,
  elect,
}: {
  player: PaquetPlayer
  chef: PaquetColor | null
  nextChef: PaquetColor | null
  you: PaquetColor | null
  actor: PaquetColor | null
  challenger: PaquetColor | null
  elect: boolean
}) {
  const isChef = player.color === chef
  const isHeir = Boolean(nextChef && player.color === nextChef && !isChef)
  const tone = PAQUET_PALETTE[player.color]
  return (
    <div
      className={`rail-seat ${isChef ? 'is-chef' : ''} ${isHeir ? 'is-heir' : ''} ${player.color === you ? 'is-you' : ''} ${
        player.color === challenger || player.color === actor ? 'is-hot' : ''
      } ${player.settled && !isChef ? 'is-out' : ''} ${player.bet > 0 ? 'has-bet' : ''}`}
    >
      <i style={{ background: tone.hex }} />
      <span>{player.color === you ? 'Toi' : player.name}</span>
      <b>
        {elect && player.electCard
          ? cardLabel(player.electCard)
          : player.bet
            ? `${formatUnit(player.bet)} ${GAME_ASSET}`
            : isChef
            ? 'Chef'
            : isHeir
              ? 'Ensuite'
              : player.settled
                  ? 'Mangé'
                  : '—'}
      </b>
    </div>
  )
}

function dockMessage(
  game: PaquetState,
  you: PaquetPlayer,
  yourTurn: boolean,
  canPick: boolean,
  actor: PaquetPlayer | null,
  vs: PaquetPlayer | null,
) {
  const chef = chefOf(game)
  const isChef = chef?.color === you.color
  if (game.phase === 'elect') return 'Une carte chacun. La plus haute est chef.'
  if (game.phase === 'named') {
    return chef
      ? `${chef.name} est chef${chef.electCard ? ` · ${cardLabel(chef.electCard)}` : ''}.`
      : game.message
  }
  if (game.phase === 'runoff' && yourTurn) return 'Barrage. Prends un paquet. La plus haute est chef.'
  if (game.phase === 'runoff' && actor) return `${actor.name} choisit. Barrage à l’as.`
  if (game.phase === 'claim') return chef ? `${chef.name} prend le chef.` : game.message
  if (canPick) return 'Prends un paquet. Tu ne vois rien.'
  if (game.phase === 'pick' && isChef) return 'Ils choisissent. Toi, le dernier.'
  if (game.phase === 'pick' && actor) return `${actor.name} choisit.`
  if (game.phase === 'bet' && yourTurn) return 'Mise ce que tu veux. À l’aveugle.'
  if (game.phase === 'bet' && isChef) return 'Ils misent. Tu suis après.'
  if (game.phase === 'bet' && actor) return `${actor.name} mise.`
  if (game.phase === 'peek' && yourTurn) return 'Regarde ta carte. Toi seul.'
  if (game.phase === 'peek' && chef) return `${chef.name} regarde. Lui seul.`
  if (game.phase === 'cover' && yourTurn && vs) return `Aligne ${vs.name}. On continue.`
  if (game.phase === 'cover' && vs) return `${chef?.name ?? 'Chef'} reste chef · ${vs.name}.`
  if (game.phase === 'duel') return 'On compare.'
  return game.message
}
