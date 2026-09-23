import { useEffect, useRef, useState } from 'react'
import { playSfx } from '../audio/sfx'
import { seatTone } from '../paquet/palette'
import type { RoomSeat, RoomSnapshot } from '../api/client'
import { copyText } from '../identity/copy'
import { formatLudo } from '../ludo/wallet'
import { AudioToggle } from './AudioToggle'

const MATCH_COUNTDOWN_MS = 3000
const BEAT_COLORS = ['c-red', 'c-green', 'c-yellow', 'c-blue'] as const

function seatKey(seat: RoomSeat) {
  return seat.address || `${seat.color}:${seat.name}`
}

function matchBeat(startAt: number) {
  if (!startAt) return -1
  const remaining = startAt - Date.now()
  if (remaining <= 0) return 0
  const elapsed = Math.max(0, MATCH_COUNTDOWN_MS - remaining)
  return Math.min(3, Math.floor(elapsed / 1000) + 1)
}

export function RoomLobby({
  room,
  isHost,
  error,
  busy,
  onStart,
  onLeave,
}: {
  room: RoomSnapshot
  isHost: boolean
  error?: string
  busy?: boolean
  onStart: () => void
  onLeave: () => void
}) {
  const match = room.kind === 'match'
  const canStart = room.status === 'lobby' && (room.humans ?? 0) >= 1
  const urls = room.urls?.length ? room.urls : []
  const [copied, setCopied] = useState('')
  const [toast, setToast] = useState<{ text: string; tone: 'in' | 'out' } | null>(null)
  const [pop, setPop] = useState<string | null>(null)
  const [askLeave, setAskLeave] = useState(false)
  const [beat, setBeat] = useState(() => matchBeat(room.startAt || 0))
  const seen = useRef<Map<string, string> | null>(null)
  const heardBeat = useRef(-1)
  const waiting = room.humans ?? 0
  const counting = match && room.status === 'lobby' && Boolean(room.startAt)

  useEffect(() => {
    const startAt = room.startAt || 0
    if (!startAt) {
      setBeat(-1)
      heardBeat.current = -1
      return
    }
    const tick = () => setBeat(matchBeat(startAt))
    tick()
    const id = window.setInterval(tick, 80)
    return () => window.clearInterval(id)
  }, [room.startAt])

  useEffect(() => {
    if (!counting || beat < 0) return
    if (heardBeat.current === beat) return
    heardBeat.current = beat
    if (beat === 0) playSfx('six')
    else if (beat > 0) playSfx('join')
  }, [counting, beat])

  useEffect(() => {
    const humans = room.seats.filter((seat) => seat.kind === 'human')
    const next = new Map(humans.map((seat) => [seatKey(seat), seat.name]))
    if (!seen.current) {
      seen.current = next
      return
    }
    const prev = seen.current
    for (const seat of humans) {
      const id = seatKey(seat)
      if (prev.has(id)) continue
      if (seat.color !== room.you) {
        setToast({ text: `${seat.name} a rejoint le salon`, tone: 'in' })
        playSfx('join')
      }
      setPop(seat.color)
    }
    for (const [id, name] of prev) {
      if (next.has(id)) continue
      setToast({ text: `${name} a quitté le salon`, tone: 'out' })
      playSfx('leave')
    }
    seen.current = next
  }, [room.seats, room.you])

  useEffect(() => {
    if (!toast && !pop) return
    const id = window.setTimeout(() => {
      setToast(null)
      setPop(null)
    }, 2200)
    return () => window.clearTimeout(id)
  }, [toast, pop])

  const copy = async (value: string, label: string) => {
    const ok = await copyText(value)
    if (!ok) return
    setCopied(label)
    window.setTimeout(() => setCopied(''), 1600)
  }

  return (
    <section className="lobby lobby--room">
      <div className="lobby__glow" aria-hidden="true" />
      {toast ? (
        <p className={`room-toast is-${toast.tone}`} role="status">
          {toast.text}
        </p>
      ) : null}
      <header className="lobby__wallet">
        <AudioToggle />
      </header>
      <header className="logo">
        <p className="logo__kicker">{match ? 'La table' : 'Salon privé'}</p>
        {match ? (
          <h1 className="match-wait__title">
            <span className="c-red">{waiting}</span>
            <span className="match-wait__slash">/</span>
            <span className="c-blue">{room.count}</span>
          </h1>
        ) : (
          <button
            type="button"
            className="room-code"
            onClick={() => void copy(room.code, 'code')}
            aria-label={`Code ${room.code}, copier`}
          >
            <span className="c-red">{room.code[0]}</span>
            <span className="c-green">{room.code[1]}</span>
            <span className="c-yellow">{room.code[2]}</span>
            <span className="c-blue">{room.code[3]}</span>
          </button>
        )}
        <p className="logo__tag">
          {match
            ? counting
              ? 'Table complète. Ça commence.'
              : `Entrée ${formatLudo(room.stake)}. Une personne lance. Les places vides : ordis.`
            : copied === 'code'
              ? 'Code copié.'
              : 'Partage le code. Une personne lance. Les autres jouent au prochain coup.'}
        </p>
      </header>

      <div className="lobby__card">
        <div className="room-fill" aria-hidden="true">
          <span style={{ width: `${(waiting / room.count) * 100}%` }} />
        </div>
        <p className="room-fill__label">
          {waiting}/{room.count} autour de la table · entrée {formatLudo(room.stake)}
        </p>
        {match ? (
          <p className="match-wait">{counting ? 'Tout le monde est là' : 'Recherche de joueurs…'}</p>
        ) : null}
        {!match && isHost && urls.length ? (
          urls.map((url) => (
            <button
              key={url}
              type="button"
              className="lan-link"
              onClick={() => void copy(url, url)}
            >
              {url}
              <small>{copied === url ? 'Copié' : 'Appuie pour copier'}</small>
            </button>
          ))
        ) : null}
        {!match && isHost && !urls.length ? (
          <p className="bank-note">Pas de lien public. En local : même réseau. En ligne : mets PUBLIC_URL dans le .env.</p>
        ) : null}
        {error && <p className="bank-note">{error}</p>}

          <ul className={`room-seats ${room.count === 8 ? 'room-seats--oct' : ''}`}>
          {room.seats.map((seat) => {
            const inSeat = seat.kind === 'human' || seat.kind === 'bot'
            const status =
              seat.color === room.you
                ? 'Toi'
                : seat.kind === 'bot'
                  ? 'Bot'
                  : seat.kind === 'human'
                    ? seat.botPlay
                      ? 'Hors ligne · bot'
                      : seat.online === false
                        ? 'Hors ligne'
                        : 'En ligne'
                    : match
                      ? 'En recherche'
                      : 'Place libre'
            return (
              <li
                key={seat.color}
                className={`room-seat ${inSeat ? 'is-in' : 'is-wait'} ${pop === seat.color ? 'is-pop' : ''}`}
              >
                <span className="room-seat__pawn" style={{ background: seatTone(seat.color).hex }}>
                  {inSeat ? seat.name.slice(0, 1).toUpperCase() : '·'}
                </span>
                <div>
                  <strong>{inSeat ? seat.name : seatTone(seat.color).name}</strong>
                  <small>{status}</small>
                </div>
                {seat.kind === 'human' && seat.online !== false && !seat.botPlay ? (
                  <em className="room-seat__live">Live</em>
                ) : null}
              </li>
            )
          })}
        </ul>

        <button type="button" className={`btn-play ${canStart ? 'is-ready' : ''}`} disabled={!canStart || busy} onClick={onStart}>
          {busy ? 'Lancement…' : canStart ? 'Lancer la partie' : 'Un instant…'}
        </button>
        <p className="field__hint wait-note">
          N’importe qui à table peut lancer. Un arrivant attend la fin du coup, puis s’assoit.
        </p>

        <button type="button" className="btn-ghost room-leave" onClick={() => setAskLeave(true)}>
          {match ? 'Quitter la table' : 'Quitter le salon'}
        </button>
      </div>
      {askLeave ? (
        <div className="leave-scrim" role="dialog" aria-modal="true" aria-labelledby="lobby-leave-title">
          <div className="leave-sheet">
            <p className="leave-sheet__kicker">Un instant</p>
            <h2 id="lobby-leave-title">{match ? 'Quitter la table ?' : 'Quitter le salon ?'}</h2>
            <p>
              {match
                ? counting
                  ? 'Le compte à rebours s’annule. Tes Ł restent sur ton compte.'
                  : 'Tu sors de la file. Tes Ł restent sur ton compte.'
                : 'Tu quittes ce salon. Tes Ł restent sur ton compte, la partie n’a pas encore commencé.'}
            </p>
            <div className="leave-actions">
              <button type="button" className="btn-ghost btn-ghost--wide" onClick={() => setAskLeave(false)}>
                Rester
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  setAskLeave(false)
                  onLeave()
                }}
              >
                Quitter
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {counting ? (
        <div className="go-count" role="status" aria-live="assertive">
          <p className="go-count__kicker">{beat === 0 ? 'C’est parti' : 'La partie commence'}</p>
          <p key={beat} className={`go-count__beat ${BEAT_COLORS[beat === 0 ? 3 : beat - 1]}`}>
            {beat === 0 ? 'GO' : beat}
          </p>
          <button type="button" className="btn-ghost go-count__leave" onClick={() => setAskLeave(true)}>
            Annuler
          </button>
        </div>
      ) : null}
    </section>
  )
}
