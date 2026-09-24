import { useEffect, useRef, useState } from 'react'
import {
  actorOf,
  betOptions,
  cardLabel,
  chefOf,
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
import { formatLudo, formatUnit, GAME_ASSET } from '../ludo/wallet'
import { playSfx } from '../audio/sfx'
import { AudioToggle } from './AudioToggle'
import { Coins } from './Coins'
import { PaquetBoard } from './PaquetBoard'
import { PAQUET_PALETTE } from '../paquet/palette'

const AUTO_MS: Partial<Record<PaquetState['phase'], number>> = {
  elect: 6200,
  named: 5200,
  pick: 340,
  bet: 480,
  peek: 700,
  cover: 900,
  duel: 1700,
  runoff: 380,
  claim: 3600,
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
    const openingDeal =
      (local.phase === 'pick' || local.phase === 'runoff') &&
      local.packets.length > 0 &&
      local.packets.every((p) => !p.takenBy)
    const wait = window.setTimeout(() => {
      setLocal((cur) => stepAuto(cur))
    }, openingDeal ? Math.max(delay, 2400) : delay)
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
        <button type="button" className="hud-leave" onClick={leave}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M10 5v2H6v10h4v2H4V5h6zm3.8 3.2 1.4-1.4L21 12l-5.8 5.2-1.4-1.4 2.7-2.3H10v-2h6.5l-2.7-2.3z"
            />
          </svg>
          <span>{over || recap ? 'Sortir' : 'Quitter'}</span>
        </button>
        <ChefBadge chef={chef} heir={heirOf(game)} you={self} phase={game.phase} />
        <div className="hud-end">
          <div className="hud-bank">
            <Coins value={watching ? pocket : you.coins} label={watching ? 'poche' : game.paid ? 'table' : undefined} />
            {game.paid && remote ? (
              <small className="hud-pocket">poche {formatLudo(pocket)}</small>
            ) : null}
          </div>
          <AudioToggle />
        </div>
      </header>

      <div className={`hud-rail hud-rail--${game.players.length}`} aria-label="Joueurs">
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
        <footer className={`hud-dock ${canBet || canPeek || canCover || canRebuy || needPocket ? 'is-act' : 'is-wait'}`}>
          <p className="hud-dock__msg">{dockMessage(game, you, yourTurn, canPick, actor, vs)}</p>
          {canBet ? <BetPad quick={bets} onBet={wager} /> : null}
          {canPeek ? (
            <button type="button" className="hud-chip is-main" onClick={look}>
              Voir ma carte
            </button>
          ) : null}
          {canCover && vs ? (
            <button type="button" className="hud-chip is-main" onClick={follow}>
              Suivre · {formatLudo(vs.bet)}
            </button>
          ) : null}
          {canRebuy ? (
            <button type="button" className="hud-chip is-main" onClick={addChips} disabled={rebuyBusy}>
              {rebuyBusy ? 'Ajout…' : `Ajouter ${formatLudo(game.stake)}`}
            </button>
          ) : null}
          {needPocket ? <p className="hud-dock__hint">Plus de jetons. Passe à la caisse.</p> : null}
        </footer>
      ) : null}

      {recap ? (
        <RecapCard
          game={game}
          you={you}
          watching={watching}
          onNext={nextHand}
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
  const [sellOpen, setSellOpen] = useState(false)
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
                    {player.color === you.color ? <em className="recap-row__you">Toi</em> : player.name}
                    {player.color === chef?.color ? <em className="recap-row__chef">Chef</em> : null}
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

        {!watching && (isChef || game.offer) ? (
          <div className="recap-sale">
            {isChef && !game.offer && !sellOpen ? (
              <button type="button" className="btn-ghost btn-ghost--wide" onClick={() => setSellOpen(true)}>
                Vendre le chef
              </button>
            ) : null}
            {isChef && !game.offer && sellOpen ? (
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
                Garder · {formatLudo(game.offer)}
              </button>
            ) : null}
            {canBuy ? (
              <button type="button" className="btn-play" onClick={onBuy}>
                Acheter le chef · {formatLudo(game.offer!)}
              </button>
            ) : null}
            {game.offer && !isChef && !canBuy ? (
              <p className="recap-sale__wait">Chef à {formatLudo(game.offer)}. Pas assez sur la table.</p>
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

function BetPad({ quick, onBet }: { quick: number[]; onBet: (amount: number) => void }) {
  const max = quick[quick.length - 1] ?? 0
  const min = quick[0] ?? 0
  const chips = quick.length > 4 ? [...quick.slice(0, 3), max] : quick
  return (
    <div className="bet-pad" aria-label="Mise">
      {chips.map((amount) => {
        const allIn = amount === max && amount !== min
        return (
          <button
            key={amount}
            type="button"
            className={`hud-chip ${amount === min ? 'is-main' : ''} ${allIn ? 'is-all' : ''}`}
            onClick={() => onBet(amount)}
          >
            {allIn ? 'Tapis' : formatLudo(amount)}
          </button>
        )
      })}
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
      <strong>{chef.color === you ? 'Toi' : chef.name}</strong>
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
      {player.color === you && isChef ? (
        <em className="rail-seat__you">Toi · Chef</em>
      ) : player.color === you ? (
        <em className="rail-seat__you">Toi</em>
      ) : isChef ? (
        <em className="rail-seat__chef">Chef</em>
      ) : null}
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
  if (canPick) return 'Touche un paquet'
  if (game.phase === 'pick' && isChef) return 'Ils choisissent. Toi, le dernier.'
  if (game.phase === 'pick' && actor) return `${actor.name} choisit`
  if (game.phase === 'bet' && yourTurn) return 'Ta mise'
  if (game.phase === 'bet' && isChef) return 'Ils misent. Tu suis après.'
  if (game.phase === 'bet' && actor) return `${actor.name} mise`
  if (game.phase === 'peek' && yourTurn) return 'Ta carte. Toi seul.'
  if (game.phase === 'peek' && chef) return `${chef.name} regarde`
  if (game.phase === 'cover' && yourTurn && vs) return `Suivre ${vs.name}`
  if (game.phase === 'cover' && vs) return `${chef?.name ?? 'Chef'} vs ${vs.name}`
  if (game.phase === 'duel') return 'On compare.'
  return game.message
}
