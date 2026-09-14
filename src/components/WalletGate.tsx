import { useMemo, useState } from 'react'
import { copyText } from '../identity/copy'
import {
  generateMnemonic,
  isValidMnemonic,
  mnemonicToAddress,
  mnemonicToLoginToken,
  normalizeWords,
} from '../identity/mnemonic'

type Step = 'welcome' | 'backup' | 'confirm' | 'recover'

function quiz(words: string[]) {
  const picks = [2, 6, 10]
  return picks.map((index) => {
    const answer = words[index]
    const decoys = words.filter((w) => w !== answer).sort(() => Math.random() - 0.5).slice(0, 3)
    const options = [...decoys, answer].sort(() => Math.random() - 0.5)
    return { index, answer, options }
  })
}

export function WalletGate({
  onReady,
}: {
  onReady: (payload: { address: string; loginToken: string }) => Promise<void>
}) {
  const [step, setStep] = useState<Step>('welcome')
  const [words, setWords] = useState<string[]>([])
  const [checks, setChecks] = useState<string[]>(['', '', ''])
  const [recover, setRecover] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const questions = useMemo(() => (words.length === 12 ? quiz(words) : []), [words])

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await generateMnemonic()
      setWords(next)
      setChecks(['', '', ''])
      setCopied(false)
      setStep('backup')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer le compte.')
    }
    setBusy(false)
  }

  const openRecovered = async () => {
    const parsed = normalizeWords(recover)
    setBusy(true)
    setError('')
    if (!(await isValidMnemonic(parsed))) {
      setError('Phrase invalide. 12 mots, dans l’ordre.')
      setBusy(false)
      return
    }
    const address = await mnemonicToAddress(parsed)
    const loginToken = await mnemonicToLoginToken(parsed)
    try {
      await onReady({ address, loginToken })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Serveur injoignable.')
    }
    setBusy(false)
  }

  const confirm = async () => {
    const ok = questions.every((q, i) => checks[i] === q.answer)
    if (!ok) {
      setError('Ce n’est pas la bonne combinaison. Revois tes mots.')
      return
    }
    setBusy(true)
    const address = await mnemonicToAddress(words)
    const loginToken = await mnemonicToLoginToken(words)
    try {
      await onReady({ address, loginToken })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Serveur injoignable.')
      setBusy(false)
      return
    }
    setBusy(false)
  }

  return (
    <section className="lobby gate">
      <div className="lobby__glow" aria-hidden="true" />
      <header className="logo">
        <p className="logo__kicker">Ludo · sans email</p>
        <h1 aria-label="Ludo">
          <span className="c-red">L</span>
          <span className="c-green">U</span>
          <span className="c-yellow">D</span>
          <span className="c-blue">O</span>
        </h1>
      </header>

      {step === 'welcome' && (
        <div className="lobby__card">
          <p className="logo__tag" style={{ marginTop: 0 }}>
            Pas d’e-mail. Tes 12 mots, c’est ton compte — une fois sur cet appareil, tu restes connecté.
          </p>
          <ol className="how-steps">
            <li>Crée ton compte (1 minute).</li>
            <li>Note tes 12 mots : uniquement si tu changes de téléphone.</li>
            <li>Le solo est gratuit. En match, tu joues avec tes Ł.</li>
          </ol>
          {error && <p className="bank-note">{error}</p>}
          <div className="home__actions" style={{ display: 'grid', gap: '0.6rem', marginTop: '1.05rem' }}>
            <button type="button" className="btn-play" onClick={() => void create()} disabled={busy}>
              {busy ? 'Préparation…' : 'Créer mon compte'}
            </button>
            <button type="button" className="btn-ghost btn-ghost--wide" onClick={() => setStep('recover')}>
              J’ai déjà un compte
            </button>
          </div>
          <p className="field__hint">Le solo contre les bots est gratuit, sans mise.</p>
        </div>
      )}

      {step === 'backup' && (
        <div className="lobby__card">
          <p className="field">
            <span>Tes 12 mots — note-les maintenant</span>
          </p>
          <p className="field__hint">Sans ça, si tu perds le téléphone, le compte est perdu. On ne les garde pas.</p>
          <ol className="seed">
            {words.map((word, i) => (
              <li key={`${word}-${i}`}>
                <em>{i + 1}</em>
                {word}
              </li>
            ))}
          </ol>
          <p className="bank-note">Ne les envoie à personne. Pas au kiosque, pas à un « admin ».</p>
          <button
            type="button"
            className="btn-ghost btn-ghost--wide"
            style={{ marginBottom: '0.65rem' }}
            onClick={() => {
              void copyText(words.join(' ')).then((ok) => {
                setCopied(ok)
                window.setTimeout(() => setCopied(false), 1800)
              })
            }}
          >
            {copied ? 'Phrase copiée' : 'Copier les 12 mots'}
          </button>
          <button type="button" className="btn-play" onClick={() => setStep('confirm')}>
            Je les ai notés
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="lobby__card">
          <p className="field">
            <span>Confirme trois mots</span>
          </p>
          {questions.map((q, i) => (
            <fieldset key={q.index} className="field">
              <legend>Mot n°{q.index + 1}</legend>
              <div className="pills">
                {q.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={checks[i] === option ? 'pill is-on' : 'pill'}
                    onClick={() => {
                      const next = [...checks]
                      next[i] = option
                      setChecks(next)
                      setError('')
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          {error && <p className="bank-note">{error}</p>}
          <button type="button" className="btn-play" onClick={() => void confirm()} disabled={busy || checks.some((c) => !c)}>
            {busy ? 'Ouverture…' : 'Entrer dans Ludo'}
          </button>
        </div>
      )}

      {step === 'recover' && (
        <form
          className="lobby__card"
          onSubmit={(e) => {
            e.preventDefault()
            void openRecovered()
          }}
        >
          <p className="logo__tag" style={{ marginTop: 0 }}>
            Nouveau téléphone ? Colle tes 12 mots. Ton ID et tes Ł reviennent.
          </p>
          <label className="field">
            <span>Tes 12 mots</span>
            <textarea
              className="seed-input"
              rows={4}
              placeholder="abandon ability able …"
              value={recover}
              onChange={(e) => setRecover(e.target.value)}
            />
          </label>
          {error && <p className="bank-note">{error}</p>}
          <button type="submit" className="btn-play" disabled={busy}>
            {busy ? 'Ouverture…' : 'Ouvrir mon compte'}
          </button>
          <button
            type="button"
            className="btn-ghost btn-ghost--wide room-leave"
            onClick={() => {
              setStep('welcome')
              setError('')
            }}
          >
            Retour
          </button>
        </form>
      )}
    </section>
  )
}
