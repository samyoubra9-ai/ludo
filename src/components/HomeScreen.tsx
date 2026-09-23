import { useEffect, useState } from 'react'
import { copyText, canShareText, shareText } from '../identity/copy'
import { shortAddress } from '../identity/mnemonic'
import { formatLudo, rakePercent, TABLE_STAKE } from '../ludo/wallet'
import { AudioToggle } from './AudioToggle'
import { Coins } from './Coins'
import { PAQUET_PALETTE } from '../paquet/palette'

export type PlayMode = 'solo' | 'match' | 'lan'

const MODES: { id: PlayMode; title: string; hint: string }[] = [
  { id: 'solo', title: 'Solo', hint: 'Vs ordi' },
  { id: 'match', title: 'Table', hint: 'En ligne · 8' },
  { id: 'lan', title: 'Salon', hint: 'Entre amis' },
]

function ModeIcon({ id }: { id: PlayMode }) {
  if (id === 'solo') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="11" r="6" fill="currentColor" />
        <path fill="currentColor" d="M6 27c1.2-6 5-9 10-9s8.8 3 10 9z" />
      </svg>
    )
  }
  if (id === 'match') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <ellipse cx="16" cy="16" rx="5" ry="11" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path fill="none" stroke="currentColor" strokeWidth="2.2" d="M5 16h22M7.2 10h17.6M7.2 22h17.6" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path fill="currentColor" d="M7 14.5 16 6l9 8.5V26H20v-7h-8v7H7z" />
    </svg>
  )
}

function MiniTable() {
  const seats = Object.values(PAQUET_PALETTE).map((tone, i) => {
    const a = -Math.PI / 2 + (i / 8) * Math.PI * 2
    return {
      hex: tone.hex,
      left: `${50 + Math.cos(a) * 40}%`,
      top: `${52 + Math.sin(a) * 34}%`,
    }
  })
  const packs = Array.from({ length: 8 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 8) * Math.PI * 2
    return {
      left: `${50 + Math.cos(a) * 15}%`,
      top: `${52 + Math.sin(a) * 12}%`,
    }
  })
  return (
    <div className="mini-table" aria-hidden="true">
      <span className="mini-table__rail" />
      <span className="mini-table__felt" />
      {packs.map((pack, i) => (
        <b key={i} className="mini-table__pack" style={{ left: pack.left, top: pack.top }} />
      ))}
      {seats.map((seat, i) => (
        <i key={i} className="mini-table__seat" style={{ left: seat.left, top: seat.top, background: seat.hex }} />
      ))}
    </div>
  )
}

export function HomeScreen({
  name,
  coins,
  address,
  error,
  mode,
  joinCode,
  resume,
  onName,
  onPlay,
  onLock,
  onMode,
  onJoinCode,
  onCreateRoom,
  onJoinRoom,
  onFindMatch,
  onResumeRoom,
}: {
  name: string
  coins: number
  address: string
  error?: string
  mode: PlayMode
  joinCode: string
  resume?: { code: string; status: 'lobby' | 'playing' | 'ended'; leaving?: boolean } | null
  onName: (value: string) => void
  onPlay: () => void
  onLock: () => void
  onMode: (value: PlayMode) => void
  onJoinCode: (value: string) => void
  onCreateRoom: () => void
  onJoinRoom: () => void
  onFindMatch: () => void
  onResumeRoom: () => void
}) {
  const [settings, setSettings] = useState(false)
  const [idNote, setIdNote] = useState('')
  const shareable = canShareText()

  useEffect(() => {
    if (!settings) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [settings])

  const flashId = (text: string) => {
    setIdNote(text)
    window.setTimeout(() => setIdNote(''), 2200)
  }

  const copyId = async () => {
    const ok = await copyText(address)
    flashId(ok ? 'Identifiant copié.' : 'Maintenez l’identifiant, puis Copier.')
  }

  const shareId = async () => {
    const sent = await shareText('Mon ID Petit paquet', address)
    if (!sent) await copyId()
  }

  const needsStake = mode !== 'solo'
  const canPlay = !needsStake || coins >= TABLE_STAKE
  const extra = Math.max(0, coins - TABLE_STAKE)
  const playLabel =
    mode === 'solo' ? 'Jouer maintenant' : mode === 'match' ? 'S’asseoir à la table' : 'Créer un salon'

  return (
    <section className="lobby lobby--menu lobby--play">
      <div className="lobby__glow" aria-hidden="true" />
      <div className="play-spark play-spark--a" aria-hidden="true" />
      <div className="play-spark play-spark--b" aria-hidden="true" />
      <div className="play-spark play-spark--c" aria-hidden="true" />

      <header className="lobby__wallet">
        <Coins value={coins} />
        <button type="button" className="address hash-btn" title={address} onClick={() => void copyId()}>
          {idNote.startsWith('Identifiant') ? 'Copié' : shortAddress(address)}
        </button>
        <AudioToggle />
        <button type="button" className="gear-btn" aria-label="Paramètres" onClick={() => setSettings(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.1 12.9a7.6 7.6 0 0 0 .1-.9 7.6 7.6 0 0 0-.1-.9l2-1.5a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7 7 0 0 0-1.6-.9l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7 7 0 0 0-1.6.9l-2.4-1a.5.5 0 0 0-.6.2L2.7 9a.5.5 0 0 0 .1.6l2 1.5a7.6 7.6 0 0 0-.1.9 7.6 7.6 0 0 0 .1.9l-2 1.5a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1a7 7 0 0 0 1.6.9l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7 7 0 0 0 1.6-.9l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
            />
          </svg>
        </button>
      </header>

      <header className="logo logo--play">
        <MiniTable />
        <p className="logo__kicker">La table</p>
        <h1 aria-label="Petit paquet">
          <span className="c-yellow">Petit paquet</span>
        </h1>
        <p className="hero__line">Une table. 8 places. Le chef jusqu’à l’as.</p>
      </header>

      <form
        className="lobby__card lobby__card--play"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canPlay) return
          if (mode === 'solo') onPlay()
          else if (mode === 'match') onFindMatch()
          else onCreateRoom()
        }}
      >
        {resume?.code ? (
          <p className="resume-banner">
            <span>
              {resume.leaving
                ? 'Tu as 20 s pour revenir'
                : resume.status === 'playing'
                  ? 'Partie en cours'
                  : 'Salon en attente'}{' '}
              · {resume.code}
            </span>
            <button type="button" className="hash-btn" onClick={onResumeRoom}>
              {resume.leaving ? 'Revenir' : 'Reprendre'}
            </button>
          </p>
        ) : null}
        {error ? <p className="bank-note">{error}</p> : null}
        {needsStake && !canPlay ? (
          <p className="bank-note">Il faut 3,50 Ł pour rejoindre la table.</p>
        ) : null}

        <div className="mode-grid">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === mode ? 'mode-card is-on' : 'mode-card'}
              onClick={() => onMode(item.id)}
            >
              <span className="mode-card__icon">
                <ModeIcon id={item.id} />
              </span>
              <strong>{item.title}</strong>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>

        <label className="play-field">
          <span>Ton nom</span>
          <input
            className="play-name"
            maxLength={16}
            placeholder="Surnom"
            autoComplete="nickname"
            enterKeyHint="done"
            value={name}
            onChange={(e) => onName(e.currentTarget.value)}
          />
        </label>

        <p className="play-pot play-pot--free">Table de 8 · à l’aveugle · le chef aligne</p>

        {needsStake ? (
          <p className="play-pot">
            Entrée {formatLudo(TABLE_STAKE)}. Tu poses ça sur la table
            {extra > 0 ? ` · ${formatLudo(extra)} restent en poche` : ''}. Une personne lance.
            Les autres s’assoient au prochain coup.
          </p>
        ) : (
          <p className="play-pot play-pot--free">Entraînement · le solde ne bouge pas</p>
        )}

        {mode === 'lan' ? (
          <>
            <button type="button" className={`btn-play ${canPlay ? 'is-ready' : ''}`} disabled={!canPlay} onClick={onCreateRoom}>
              {canPlay ? playLabel : 'Solde insuffisant'}
            </button>
            <div className="join-box">
              <span>Rejoindre avec un code</span>
              <div className="join-row">
                <input
                  className="code-input"
                  maxLength={4}
                  placeholder="CODE"
                  value={joinCode}
                  onChange={(e) => onJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="go"
                  aria-label="Code de salle"
                />
                <button type="button" className="btn-play join-row__go" disabled={joinCode.length !== 4} onClick={onJoinRoom}>
                  OK
                </button>
              </div>
            </div>
          </>
        ) : (
          <button type="submit" className={`btn-play ${canPlay ? 'is-ready' : ''}`} disabled={!canPlay}>
            {canPlay ? playLabel : 'Solde insuffisant'}
          </button>
        )}
      </form>

      {settings ? (
        <div className="set-scrim" role="presentation" onClick={() => setSettings(false)}>
          <aside className="set-sheet" role="dialog" aria-label="Paramètres" onClick={(e) => e.stopPropagation()}>
            <header className="set-sheet__head">
              <h2>Paramètres</h2>
              <button type="button" className="gear-btn" aria-label="Fermer" onClick={() => setSettings(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"
                  />
                </svg>
              </button>
            </header>

            <p className="set-label">Identifiant</p>
            <input
              className="id-pass__value"
              readOnly
              value={address}
              inputMode="none"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Identifiant joueur"
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
            />
            <div className={shareable ? 'id-pass__actions is-split' : 'id-pass__actions'}>
              <button type="button" className="btn-play" onClick={() => void copyId()}>
                {idNote || 'Copier'}
              </button>
              {shareable ? (
                <button type="button" className="btn-ghost btn-ghost--wide" onClick={() => void shareId()}>
                  Envoyer
                </button>
              ) : null}
            </div>

            {needsStake ? (
              <p className="field__hint">Maison {rakePercent()} % du pot en match et salon.</p>
            ) : (
              <p className="field__hint">Solo : le solde ne bouge pas.</p>
            )}

            <button type="button" className="btn-ghost btn-ghost--wide set-lock" onClick={onLock}>
              Verrouiller le compte
            </button>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
