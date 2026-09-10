import { useEffect, useRef, useState } from 'react'
import { playSfx } from '../audio/sfx'
import { PALETTE } from '../ludo/board'
import type { RoomSeat, RoomSnapshot } from '../api/client'
import { copyText } from '../identity/copy'
import { formatLudo } from '../ludo/wallet'
import { AudioToggle } from './AudioToggle'

function seatKey(seat: RoomSeat) {
  return seat.address || `${seat.color}:${seat.name}`
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
  const canStart = !match && isHost && (room.humans ?? 0) >= 2 && room.status === 'lobby'
  const urls = room.urls?.length ? room.urls : []
  const [copied, setCopied] = useState('')
  const [toast, setToast] = useState<{ text: string; tone: 'in' | 'out' } | null>(null)
  const [pop, setPop] = useState<string | null>(null)
  const seen = useRef<Map<string, string> | null>(null)
  const waiting = room.humans ?? 0

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
        <p className="logo__kicker">{match ? 'Matchmaking' : 'Salon privé'}</p>
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
            ? `Dès que ${room.count} joueurs réels sont à table, la partie lance. Tes LUDO restent en jeu.`
            : copied === 'code'
              ? 'Code copié.'
              : 'Partage le code. Tes amis tapent ces 4 lettres.'}
        </p>
      </header>

      <div className="lobby__card">
        <div className="room-fill" aria-hidden="true">
          <span style={{ width: `${(waiting / room.count) * 100}%` }} />
        </div>
        <p className="room-fill__label">
          {waiting}/{room.count} autour de la table · mise {formatLudo(room.stake)}
        </p>
        {match ? <p className="match-wait">Recherche de joueurs…</p> : null}
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

        <ul className="room-seats">
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
                <span className="room-seat__pawn" style={{ background: PALETTE[seat.color].hex }}>
                  {inSeat ? seat.name.slice(0, 1).toUpperCase() : '·'}
                </span>
                <div>
                  <strong>{inSeat ? seat.name : PALETTE[seat.color].name}</strong>
                  <small>{status}</small>
                </div>
                {seat.kind === 'human' && seat.online !== false && !seat.botPlay ? (
                  <em className="room-seat__live">Live</em>
                ) : null}
              </li>
            )
          })}
        </ul>

        {match ? (
          <p className="field__hint wait-note">
            Matchmaking entre joueurs réels uniquement. Aucun bot, tes pièces restent en jeu.
          </p>
        ) : isHost ? (
          <button type="button" className={`btn-play ${canStart ? 'is-ready' : ''}`} disabled={!canStart || busy} onClick={onStart}>
            {canStart ? 'Lancer la partie' : 'En attente d’un autre joueur…'}
          </button>
        ) : (
          <p className="field__hint wait-note">L’hôte lance dès que vous êtes au moins deux.</p>
        )}

        <button type="button" className="btn-ghost room-leave" onClick={onLeave}>
          {match ? 'Annuler la recherche' : 'Quitter la salle'}
        </button>
      </div>
    </section>
  )
}
