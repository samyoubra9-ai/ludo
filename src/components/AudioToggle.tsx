import { useAudioPrefs } from '../audio/useAudioOn'

export function AudioToggle() {
  const { music, sfx, setMusic, setSfx } = useAudioPrefs()

  return (
    <div className="audio-btns">
      <button
        type="button"
        className={`audio-btn ${music ? 'is-on' : ''}`}
        onClick={() => setMusic(!music)}
        aria-pressed={music}
        aria-label={music ? 'Couper la musique' : 'Activer la musique'}
        title={music ? 'Musique allumée' : 'Musique coupée'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M9 18V6.3L20 4v11.7c0 1.8-1.6 3.3-3.5 3.3S13 17.5 13 15.7s1.6-3.3 3.5-3.3c.5 0 1 .1 1.5.3V8.2L11 9.7V18c0 1.8-1.6 3.3-3.5 3.3S4 19.8 4 18s1.6-3.3 3.5-3.3c.5 0 1 .1 1.5.3z"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`audio-btn ${sfx ? 'is-on' : ''}`}
        onClick={() => setSfx(!sfx)}
        aria-pressed={sfx}
        aria-label={sfx ? 'Couper les effets' : 'Activer les effets'}
        title={sfx ? 'Effets allumés' : 'Effets coupés'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"
          />
        </svg>
      </button>
    </div>
  )
}
