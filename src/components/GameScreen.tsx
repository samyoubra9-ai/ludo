import { useCallback, useEffect, useRef, useState } from 'react'
import { hopsUntilLand, moveCue } from '../audio/cues'
import { playSfx, unlockSfx } from '../audio/sfx'
import { PALETTE } from '../ludo/board'
import { rollDie } from '../ludo/dice'
import { applyMove, applyRoll, currentPlayer, pickBotMove } from '../ludo/engine'
import type { ColorId, GameState } from '../ludo/types'
import { formatCoins, formatLudo, rakeOf, rakePercent, winnerPayout } from '../ludo/wallet'
import { AudioToggle } from './AudioToggle'
import { Board } from './Board'
import { Coins } from './Coins'
import { Dice } from './Dice'

const TURN_MS = 15_000
const RING_R = 42
const RING_C = 2 * Math.PI * RING_R

function DiceTimer({ dueAt, color }: { dueAt: number; color: string }) {
  const [ratio, setRatio] = useState(1)

  useEffect(() => {
    if (!dueAt) {
      setRatio(1)
      return
    }
    const tick = () => setRatio(Math.max(0, Math.min(1, (dueAt - Date.now()) / TURN_MS)))
    tick()
    const id = window.setInterval(tick, 50)
    return () => window.clearInterval(id)
  }, [dueAt])

  if (!dueAt || ratio <= 0) return null
  const urgent = ratio < 0.22

  return (
    <svg className={`dice-ring ${urgent ? 'is-urgent' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
      <circle className="dice-ring__track" cx="50" cy="50" r={RING_R} />
      <circle
        className="dice-ring__value"
        cx="50"
        cy="50"
        r={RING_R}
        style={{
          stroke: urgent ? '#ff3b3b' : color,
          strokeDasharray: RING_C,
          strokeDashoffset: RING_C * (1 - ratio),
        }}
      />
    </svg>
  )
}

export function GameScreen({
  initial,
  live,
  remote,
  onExit,
}: {
  initial: GameState
  live?: GameState | null
  remote?: {
    myColor: ColorId
    rolling: boolean
    notice?: string | null
    forfeitWinAt?: number
    turnDueAt?: number
    abandoned?: boolean
    onRoll: () => void
    onMove: (id: string) => void
  }
  onExit: () => void
}) {
  const [localGame, setLocalGame] = useState(initial)
  const [localRolling, setLocalRolling] = useState(false)
  const [forfeitSecs, setForfeitSecs] = useState(0)
  const [localDueAt, setLocalDueAt] = useState(0)
  const rollTimer = useRef<number | null>(null)
  const game = remote ? (live ?? initial) : localGame
  const rolling = remote ? Boolean(remote.rolling) : localRolling
  const gameRef = useRef(game)
  const player = currentPlayer(game) ?? game.players[0]
  const you =
    game.players.find((p) => (remote ? p.color === remote.myColor : p.isHuman)) ?? game.players[0]
  const waitingForfeit = forfeitSecs > 0
  const abandoned = Boolean(remote?.abandoned) || (game.phase === 'ended' && !game.winner)
  const youPlay = !game.winner && !waitingForfeit && !abandoned && player.color === you.color && player.isHuman
  const notice = waitingForfeit
    ? `Adversaire a quitté. Forfait dans ${forfeitSecs} s si tu restes. Si tu quittes aussi, personne ne gagne.`
    : remote?.notice

  const roll = useCallback(() => {
    unlockSfx()
    if (remote) {
      remote.onRoll()
      return
    }
    const now = gameRef.current
    if (now.phase !== 'to-roll' || now.winner || rollTimer.current) return
    const outcome = rollDie(now)
    setLocalRolling(true)
    rollTimer.current = window.setTimeout(() => {
      rollTimer.current = null
      setLocalGame((current) => applyRoll(current, outcome.value, outcome.pity))
      setLocalRolling(false)
    }, 720)
  }, [remote])

  const playToken = (id: string) => {
    unlockSfx()
    if (remote) {
      remote.onMove(id)
      return
    }
    setLocalGame((current) => {
      if (!current.movable.includes(id)) return current
      return applyMove(current, id)
    })
  }

  useEffect(() => {
    gameRef.current = game
  }, [game])

  const heard = useRef({
    ready: false,
    id: initial.id,
    rolling: false,
    tokens: initial.tokens,
    winner: initial.winner,
  })

  useEffect(() => {
    const prev = heard.current
    if (!prev.ready || prev.id !== game.id) {
      heard.current = { ready: true, id: game.id, rolling, tokens: game.tokens, winner: game.winner }
      return
    }

    if (rolling && !prev.rolling) playSfx('roll')
    if (!rolling && prev.rolling) {
      playSfx('land')
      if (game.dice === 6 && !game.winner) playSfx('six')
    }
    if (game.winner && !prev.winner) playSfx(game.winner === you.color ? 'win' : 'lose')
    else if (game.tokens !== prev.tokens && !rolling) {
      const snapshot = { ...game, tokens: prev.tokens }
      const cue = moveCue(snapshot, game)
      if (cue === 'capture') {
        window.setTimeout(() => playSfx('capture'), hopsUntilLand(snapshot, game) * 95)
      } else if (cue) {
        playSfx(cue)
      }
    }

    heard.current = { ready: true, id: game.id, rolling, tokens: game.tokens, winner: game.winner }
  }, [game, rolling, you.color])

  useEffect(() => {
    if (remote || game.winner || player.isHuman || rolling) return

    if (game.phase === 'to-roll') {
      const wait = window.setTimeout(roll, 700)
      return () => window.clearTimeout(wait)
    }

    if (game.phase === 'to-move') {
      const wait = window.setTimeout(() => {
        const id = pickBotMove(game)
        if (id) setLocalGame((current) => applyMove(current, id))
      }, 650)
      return () => window.clearTimeout(wait)
    }
  }, [remote, game, player.isHuman, rolling, roll])

  useEffect(() => {
    if (remote) return
    if (game.winner || rolling || abandoned || !player.isHuman) {
      setLocalDueAt(0)
      return
    }
    if (game.phase !== 'to-roll' && game.phase !== 'to-move') {
      setLocalDueAt(0)
      return
    }
    setLocalDueAt(Date.now() + TURN_MS)
  }, [remote, game.turn, game.phase, game.sixes, game.dice, rolling, player.isHuman, game.winner, abandoned])

  useEffect(() => {
    if (remote || !localDueAt) return
    const delay = Math.max(0, localDueAt - Date.now())
    const id = window.setTimeout(() => {
      const now = gameRef.current
      if (now.winner || now.phase === 'ended') return
      if (now.phase === 'to-roll') {
        roll()
        return
      }
      if (now.phase === 'to-move') {
        const tokenId = pickBotMove(now) || now.movable[0]
        if (tokenId) setLocalGame((current) => applyMove(current, tokenId))
      }
    }, delay)
    return () => window.clearTimeout(id)
  }, [remote, localDueAt, roll])

  useEffect(() => {
    const until = remote?.forfeitWinAt || 0
    if (!until) {
      setForfeitSecs(0)
      return
    }
    const tick = () => setForfeitSecs(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [remote?.forfeitWinAt])

  useEffect(() => {
    return () => {
      if (rollTimer.current) window.clearTimeout(rollTimer.current)
    }
  }, [])

  const won = game.winner === you.color
  const free = game.stake <= 0
  const turnDueAt = rolling || waitingForfeit || abandoned || game.winner ? 0 : remote ? remote.turnDueAt || 0 : localDueAt

  return (
    <section className="table">
      <div className="table__felt" aria-hidden="true" />
      <header className="table__bar">
        <div className="table__bar-left">
          <button type="button" className="btn-ghost" onClick={onExit}>
            Quitter
          </button>
          <AudioToggle />
        </div>
        <div className={`turn ${game.winner ? 'is-win' : ''}`}>
          <span className="turn__dot" style={{ background: PALETTE[player.color].hex }} />
          <div>
            <p className="turn__kicker">{game.winner ? 'Gagnant' : abandoned ? 'Fin' : 'Tour de'}</p>
            <p className="turn__name">{game.winner ? player.name : abandoned ? 'Personne' : player.name}</p>
          </div>
        </div>
        <Coins value={you.coins} />
      </header>
      {notice ? <p className="net-banner">{notice}</p> : null}

      <div className="table__stage">
        <div className="table__board-wrap">
          <div className="table__seats">
            {game.players.map((seat) => (
              <article
                key={seat.color}
                className={`seat seat--${seat.color} ${seat.color === game.turn ? 'is-turn' : ''} ${seat.color === you.color ? 'is-you' : ''}`}
              >
                <span className="seat__pawn" style={{ background: PALETTE[seat.color].hex }}>
                  {seat.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="seat__meta">
                  <strong>{seat.name}</strong>
                  <small>{formatCoins(seat.coins)}</small>
                </div>
              </article>
            ))}
          </div>
          <Board
            tokens={game.tokens}
            selectedId={null}
            movable={youPlay ? game.movable : []}
            pot={game.pot}
            onSelect={playToken}
          />
        </div>
      </div>

      {abandoned && (
        <div className="result is-draw">
          <span className="result__medal" aria-hidden="true" />
          <p className="result__kicker">Match nul</p>
          <h2>{free ? '0' : `−${formatLudo(game.stake)}`}</h2>
          <p>Tout le monde a quitté.{free ? '' : ' Le pot reste à la maison.'}</p>
          <button type="button" className="btn-play" onClick={onExit}>
            Retour au lobby
          </button>
        </div>
      )}

      {game.winner && (
        <div className={`result ${won ? 'is-win' : 'is-loss'}`}>
          <span className="result__medal" aria-hidden="true" />
          <p className="result__kicker">{won ? 'Victoire' : 'Défaite'}</p>
          <h2>
            {free
              ? won
                ? 'Bien joué'
                : 'Perdu'
              : won
                ? `+${formatLudo(winnerPayout(game.pot))}`
                : `−${formatLudo(game.stake)}`}
          </h2>
          {free ? (
            <p>Partie libre — aucune pièce en jeu.</p>
          ) : (
            <>
              <dl className="result__sheet">
                <div>
                  <dt>Pot de la table</dt>
                  <dd>{formatLudo(game.pot)}</dd>
                </div>
                <div>
                  <dt>Maison ({rakePercent()} %)</dt>
                  <dd>−{formatLudo(rakeOf(game.pot))}</dd>
                </div>
                <div className="is-net">
                  <dt>Crédit gagnant</dt>
                  <dd>{formatLudo(winnerPayout(game.pot))}</dd>
                </div>
              </dl>
              <p>
                {won
                  ? game.message?.includes('forfait')
                    ? 'Victoire par forfait. Le net est crédité sur ton solde.'
                    : 'Le net est crédité sur ton solde.'
                  : 'Ta mise alimente le pot. Le gagnant encaisse le net, la maison sa commission.'}
              </p>
            </>
          )}
          <button type="button" className="btn-play" onClick={onExit}>
            Retour au lobby
          </button>
        </div>
      )}

      <footer className="table__dock">
        <button
          type="button"
          className={`dice-hit ${youPlay && game.phase === 'to-roll' && !rolling && !game.winner ? 'is-ready' : ''} ${turnDueAt ? 'has-timer' : ''}`}
          onClick={roll}
          disabled={!youPlay || game.phase !== 'to-roll' || rolling || Boolean(game.winner) || abandoned}
          aria-label="Lancer le dé"
        >
          <DiceTimer dueAt={turnDueAt} color={PALETTE[player.color].hex} />
          <Dice value={game.dice} rolling={rolling} />
        </button>
        <div className="dock__copy">
          <p>
            {rolling
              ? 'Le dé tourne…'
              : game.winner || abandoned
                ? 'Partie finie'
                : youPlay && game.phase === 'to-roll'
                  ? 'Touche le dé pour lancer'
                  : youPlay && game.phase === 'to-move'
                    ? 'Choisis un pion qui brille'
                    : game.message}
          </p>
          <p className="muted">
            {free ? 'Partie libre · sans mise' : `Mise ${formatLudo(game.stake)} · pot ${formatLudo(game.pot)}`}
          </p>
        </div>
      </footer>
    </section>
  )
}
