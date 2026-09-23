import { useEffect, useMemo, useState } from 'react'
import {
  KIOSK_TOKEN_KEY,
  buybackLudo,
  clearToken,
  kioskLogin,
  kioskLogout,
  kioskMe,
  loadToken,
  lookupClient,
  parsePlayerId,
  saveToken,
  sellLudo,
  setKioskRates,
  type KioskClient,
  type KioskMe,
  type KioskOp,
} from '../api/desk'
import { shortAddress } from '../identity/mnemonic'
import { daFor, formatDa, formatLudo, formatStakeUnit, GAME_ASSET, ludoFromUnit, LUDO_PER_USD, STAKE_UNITS } from '../ludo/wallet'
import '../App.css'
import '../admin/admin.css'
import './kiosk.css'
import { InstallPwa } from '../components/InstallPwa'

type Gate = 'loading' | 'login' | 'desk'
type Page = 'counter' | 'overview' | 'clients' | 'journal' | 'profit'

const PAGES: Page[] = ['counter', 'overview', 'clients', 'journal', 'profit']

const NAV: { id: Page; label: string; hint: string }[] = [
  { id: 'counter', label: 'Guichet', hint: 'Vendre et racheter' },
  { id: 'overview', label: 'Vue d’ensemble', hint: 'Stock et volume' },
  { id: 'profit', label: 'Tarifs', hint: 'Prix DA au comptoir' },
  { id: 'clients', label: 'Clients', hint: 'Rattachés ici' },
  { id: 'journal', label: 'Mouvements', hint: 'Journal' },
]

function readPage(): Page {
  const raw = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return PAGES.includes(raw as Page) ? (raw as Page) : 'counter'
}

function go(page: Page) {
  window.location.hash = page
}

function when(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export function KioskApp() {
  const [gate, setGate] = useState<Gate>('loading')
  const [token, setToken] = useState(() => loadToken(KIOSK_TOKEN_KEY))
  const [me, setMe] = useState<KioskMe | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState<Page>(readPage)

  const enter = async (next: string) => {
    saveToken(KIOSK_TOKEN_KEY, next)
    setToken(next)
    setMe(await kioskMe(next))
    setGate('desk')
  }

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setGate('login')
      return
    }
    enter(token).catch(() => {
      clearToken(KIOSK_TOKEN_KEY)
      if (cancelled) return
      setToken('')
      setGate('login')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onHash = () => setPage(readPage())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app">
      <InstallPwa />
      {gate === 'loading' ? (
        <section className="dash-auth">
          <Brand tag="Ouverture de la caisse…" />
        </section>
      ) : null}
      {gate === 'login' ? (
        <Login
          busy={busy}
          error={error}
          onSubmit={async (name, password) => {
            setBusy(true)
            setError('')
            try {
              const next = await kioskLogin(name, password)
              await enter(next.token)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Connexion impossible.')
            }
            setBusy(false)
          }}
        />
      ) : null}
      {gate === 'desk' && me ? (
        <Dashboard
          me={me}
          token={token}
          page={page}
          error={error}
          busy={busy}
          onError={setError}
          onBusy={setBusy}
          onMe={setMe}
          onPage={(next) => {
            setError('')
            go(next)
          }}
          onRefresh={async () => {
            setBusy(true)
            setError('')
            try {
              setMe(await kioskMe(token))
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Rafraîchissement impossible.')
            }
            setBusy(false)
          }}
          onLogout={async () => {
            await kioskLogout(token)
            clearToken(KIOSK_TOKEN_KEY)
            setToken('')
            setMe(null)
            setGate('login')
          }}
        />
      ) : null}
    </div>
  )
}

function Brand({ tag }: { tag: string }) {
  return (
    <header className="logo desk__brand">
      <p className="logo__kicker">Petit paquet · caisse</p>
      <h1>
        <span className="c-yellow">Petit paquet</span>
      </h1>
      <p className="logo__tag">{tag}</p>
    </header>
  )
}

function Login({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean
  error: string
  onSubmit: (name: string, password: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  return (
    <section className="dash-auth">
      <Brand tag="Comptoir kiosque. Le client n’ouvre pas cette page : tu tapes son ID." />
      <form
        className="lobby__card desk__card"
        onSubmit={(e) => {
          e.preventDefault()
          void onSubmit(name.trim(), password)
        }}
      >
        <h2 className="desk__title">Connexion caisse</h2>
        <label className="field">
          <span>Nom du kiosque</span>
          <input
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            required
            placeholder="Karim"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Mot de passe</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="bank-note">{error}</p> : null}
        <button className="btn-play" type="submit" disabled={busy}>
          {busy ? 'Patiente…' : 'Ouvrir la caisse'}
        </button>
      </form>
    </section>
  )
}

function Dashboard({
  me,
  token,
  page,
  error,
  busy,
  onError,
  onBusy,
  onMe,
  onPage,
  onRefresh,
  onLogout,
}: {
  me: KioskMe
  token: string
  page: Page
  error: string
  busy: boolean
  onError: (value: string) => void
  onBusy: (value: boolean) => void
  onMe: (value: KioskMe) => void
  onPage: (page: Page) => void
  onRefresh: () => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [menu, setMenu] = useState(false)
  const [prefill, setPrefill] = useState('')
  const current = NAV.find((item) => item.id === page) || NAV[0]

  return (
    <div className="dash dash--till">
      {menu ? <button type="button" className="dash__scrim" aria-label="Fermer le menu" onClick={() => setMenu(false)} /> : null}
      <aside className={menu ? 'dash-side is-open' : 'dash-side'}>
        <div className="dash-side__brand">
          <p className="dash-side__mark" aria-hidden="true">
            <span className="c-red">L</span>
            <span className="c-green">U</span>
            <span className="c-yellow">D</span>
            <span className="c-blue">O</span>
          </p>
          <div>
            <strong>{me.name}</strong>
            <small>Caisse kiosque</small>
          </div>
        </div>
        <nav className="dash-nav" aria-label="Caisse">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === page ? 'dash-nav__item is-on' : 'dash-nav__item'}
              onClick={() => {
                onPage(item.id)
                setMenu(false)
              }}
            >
              <Icon name={item.id} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="dash-side__foot">
          <p>
            Envoyé
            <strong>{formatLudo(me.pnl?.sold ?? 0)}</strong>
          </p>
          <button type="button" className="dash-link" onClick={() => void onLogout()}>
            Fermer la caisse
          </button>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-top">
          <button type="button" className="dash-menu" aria-label="Menu" onClick={() => setMenu(true)}>
            <Icon name="menu" />
          </button>
          <div>
            <p className="dash-top__kicker">{me.name}</p>
            <h1>{current.label}</h1>
          </div>
          <p className="till-stock">{formatLudo(me.coins)}</p>
          <button type="button" className="dash-ghost" disabled={busy} onClick={() => void onRefresh()}>
            {busy ? 'Maj…' : 'Actualiser'}
          </button>
        </header>

        <div className="dash-body">
          {error ? <p className="dash-toast is-bad">{error}</p> : null}
          {page === 'counter' ? (
            <Counter
              me={me}
              token={token}
              busy={busy}
              prefill={prefill}
              onPrefill={setPrefill}
              onError={onError}
              onBusy={onBusy}
              onMe={onMe}
            />
          ) : null}
          {page === 'overview' ? <Overview me={me} onPage={onPage} /> : null}
          {page === 'profit' ? (
            <Rates
              me={me}
              token={token}
              busy={busy}
              onBusy={onBusy}
              onError={onError}
              onMe={onMe}
            />
          ) : null}
          {page === 'clients' ? (
            <Clients
              me={me}
              onOpen={(address) => {
                setPrefill(address)
                onPage('counter')
              }}
            />
          ) : null}
          {page === 'journal' ? <Journal ops={me.ops} /> : null}
        </div>
      </div>
    </div>
  )
}

function Overview({ me, onPage }: { me: KioskMe; onPage: (page: Page) => void }) {
  return (
    <>
      <section className="dash-kpis">
        <Kpi label="Stock caisse" value={formatLudo(me.coins)} hint="Ł disponibles à vendre" />
        <Kpi
          label="Ł envoyés"
          value={formatLudo(me.pnl?.sold ?? 0)}
          hint={`${me.pnl?.sell ?? 0} vente(s) · ${formatLudo(me.pnlToday?.sold ?? 0)} / 24 h`}
        />
        <Kpi
          label="Ł rachetés"
          value={formatLudo(me.pnl?.bought ?? 0)}
          hint={`${me.pnl?.buyback ?? 0} rachat(s) · ${formatLudo(me.pnlToday?.bought ?? 0)} / 24 h`}
        />
        <Kpi
          label="Tarifs"
          value={`${me.sellDa}/${me.buyDa}`}
          hint={`DA pour 1 ${GAME_ASSET}`}
        />
      </section>
      <section className="dash-split">
        <article className="dash-panel">
          <header className="dash-panel__head">
            <h2>Comptoir</h2>
            <button type="button" className="dash-primary" onClick={() => onPage('counter')}>
              Ouvrir le guichet
            </button>
          </header>
          <p className="dash-empty-line">
            Le client vient au comptoir. Tu colles son ID, tu crédites ou tu retires les Ł, tu gères les dinars en
            caisse. Tes tarifs : vente {formatDa(me.sellDa)} / rachat {formatDa(me.buyDa)} pour 1 {GAME_ASSET}.
          </p>
        </article>
        <article className="dash-panel">
          <header className="dash-panel__head">
            <h2>Derniers mouvements</h2>
            <button type="button" className="dash-link" onClick={() => onPage('journal')}>
              Journal
            </button>
          </header>
          <OpList ops={me.ops.slice(0, 8)} empty="Pas encore de vente ou de rachat." />
        </article>
      </section>
    </>
  )
}

function Rates({
  me,
  token,
  busy,
  onBusy,
  onError,
  onMe,
}: {
  me: KioskMe
  token: string
  busy: boolean
  onBusy: (value: boolean) => void
  onError: (value: string) => void
  onMe: (value: KioskMe) => void
}) {
  const unit = me.unit || LUDO_PER_USD
  const [sellDa, setSellDa] = useState(String(me.sellDa || unit))
  const [buyDa, setBuyDa] = useState(String(me.buyDa || unit))
  const sell = Math.floor(Number(sellDa))
  const buy = Math.floor(Number(buyDa))

  useEffect(() => {
    setSellDa(String(me.sellDa || unit))
    setBuyDa(String(me.buyDa || unit))
  }, [me.sellDa, me.buyDa, unit])

  return (
    <>
      <section className="dash-kpis">
        <Kpi label="Ł envoyés" value={formatLudo(me.pnl?.sold ?? 0)} hint={`${me.pnl?.sell ?? 0} vente(s)`} />
        <Kpi label="Ł rachetés" value={formatLudo(me.pnl?.bought ?? 0)} hint={`${me.pnl?.buyback ?? 0} rachat(s)`} />
        <Kpi label="Aujourd’hui" value={formatLudo(me.pnlToday?.sold ?? 0)} hint={`${me.today.sell} ventes · ${me.today.buyback} rachats`} />
        <Kpi label="Stock" value={formatLudo(me.coins)} hint="À recharger si ça baisse" />
      </section>
      <div className="dash-form-wrap">
        <ol className="dash-steps">
          <li>Tu vends 1 {GAME_ASSET} contre {formatDa(Number.isInteger(sell) ? sell : 0)} DA (le client paie).</li>
          <li>Tu rachètes 1 {GAME_ASSET} pour {formatDa(Number.isInteger(buy) ? buy : 0)} DA (tu paies le client).</li>
          <li>Ces prix servent au comptoir. Pas de calcul de gain ici.</li>
        </ol>
        <form
          className="dash-panel dash-form"
          onSubmit={(e) => {
            e.preventDefault()
            onBusy(true)
            onError('')
            void setKioskRates(token, sell, buy)
              .then(async () => onMe(await kioskMe(token)))
              .catch((err) => onError(err instanceof Error ? err.message : 'Tarifs non enregistrés.'))
              .finally(() => onBusy(false))
          }}
        >
          <h2>Tes prix au comptoir</h2>
          <label className="field">
            <span>Vente · DA pour 1 {GAME_ASSET}</span>
            <input
              inputMode="numeric"
              required
              min={1}
              value={sellDa}
              onChange={(e) => setSellDa(e.target.value.replace(/[^\d]/g, ''))}
            />
          </label>
          <label className="field">
            <span>Rachat · DA pour 1 {GAME_ASSET}</span>
            <input
              inputMode="numeric"
              required
              min={1}
              value={buyDa}
              onChange={(e) => setBuyDa(e.target.value.replace(/[^\d]/g, ''))}
            />
          </label>
          <button className="btn-play" type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer les tarifs'}
          </button>
        </form>
      </div>
    </>
  )
}

function Clients({ me, onOpen }: { me: KioskMe; onOpen: (address: string) => void }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return me.roster
    return me.roster.filter((row) => row.address.toLowerCase().includes(q))
  }, [me.roster, query])

  return (
    <article className="dash-panel dash-panel--full">
      <header className="dash-panel__head">
        <h2>{me.clients} client{me.clients > 1 ? 's' : ''}</h2>
        <input
          className="dash-search"
          placeholder="Filtrer un ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>
      {rows.length === 0 ? (
        <p className="dash-empty-line">
          {me.roster.length ? 'Aucun résultat.' : 'Personne n’est rattaché pour l’instant. Une vente attache le client à ce kiosque.'}
        </p>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Solde</th>
                <th>Maj</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.address}>
                  <td>
                    <strong>{shortAddress(row.address)}</strong>
                    <small className="dash-muted">{row.address}</small>
                  </td>
                  <td>{formatLudo(row.coins)}</td>
                  <td>{when(row.updated_at)}</td>
                  <td className="dash-table__act">
                    <button type="button" className="dash-ghost" onClick={() => onOpen(row.address)}>
                      Guichet
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}

function Journal({ ops }: { ops: KioskOp[] }) {
  return (
    <article className="dash-panel dash-panel--full">
      <header className="dash-panel__head">
        <h2>Journal de caisse</h2>
      </header>
      <OpList ops={ops} empty="Aucun mouvement pour l’instant." wide />
    </article>
  )
}

function Counter({
  me,
  token,
  busy,
  prefill,
  onPrefill,
  onError,
  onBusy,
  onMe,
}: {
  me: KioskMe
  token: string
  busy: boolean
  prefill: string
  onPrefill: (value: string) => void
  onError: (value: string) => void
  onBusy: (value: boolean) => void
  onMe: (value: KioskMe) => void
}) {
  const [rawId, setRawId] = useState(prefill)
  const [client, setClient] = useState<KioskClient | null>(null)
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState<'sell' | 'buyback' | null>(null)
  const [receipt, setReceipt] = useState('')

  const units = Number(String(amount).replace(',', '.'))
  const coins = ludoFromUnit(units)
  const amountOk = Number.isFinite(units) && units > 0 && Number.isInteger(coins) && coins > 0

  const findClient = async (value = rawId) => {
    const address = parsePlayerId(value)
    onError('')
    setReceipt('')
    setPending(null)
    if (!address) {
      setClient(null)
      onError('Colle un ID joueur 0x…')
      return
    }
    onBusy(true)
    try {
      const next = await lookupClient(token, address)
      setClient(next)
      setRawId(next.address)
    } catch (err) {
      setClient(null)
      onError(err instanceof Error ? err.message : 'Client introuvable.')
    }
    onBusy(false)
  }

  useEffect(() => {
    if (!prefill) return
    setRawId(prefill)
    void findClient(prefill).finally(() => onPrefill(''))
  }, [prefill])

  const run = async (kind: 'sell' | 'buyback') => {
    if (!client || !amountOk) return
    onBusy(true)
    onError('')
    try {
      const result =
        kind === 'sell'
          ? await sellLudo(token, client.address, coins)
          : await buybackLudo(token, client.address, coins)
      setClient(await lookupClient(token, client.address).catch(() => null))
      onMe(await kioskMe(token))
      setPending(null)
      setAmount('')
      setReceipt(
        kind === 'sell'
          ? `+${formatLudo(result.coins)} · encaisser ${formatDa(result.da ?? daFor(result.coins, me.sellDa, me.unit))}.`
          : `−${formatLudo(result.coins)} · rendre ${formatDa(result.da ?? daFor(result.coins, me.buyDa, me.unit))}.`,
      )
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Opération refusée.')
      setPending(null)
    }
    onBusy(false)
  }

  return (
    <>
      <form
        className="dash-panel till-lookup"
        onSubmit={(e) => {
          e.preventDefault()
          void findClient()
        }}
      >
        <h2>Client au guichet</h2>
        <label className="field">
          <span>ID joueur</span>
          <div className="till-id">
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="0x…"
              value={rawId}
              onChange={(e) => setRawId(e.target.value)}
            />
            <button
              type="button"
              className="dash-ghost"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText()
                  setRawId(text)
                  await findClient(text)
                } catch {
                  onError('Colle l’ID à la main.')
                }
              }}
            >
              Coller
            </button>
            <button className="dash-primary" type="submit" disabled={busy}>
              {busy && !pending ? 'Recherche…' : 'Ouvrir'}
            </button>
          </div>
        </label>
      </form>

      {receipt ? <p className="dash-toast is-ok">{receipt}</p> : null}

      {client ? (
        <section className="till-work">
          <article className="dash-panel">
            <p className="dash-top__kicker">Compte</p>
            <h2 className="till-id-title">{shortAddress(client.address)}</h2>
            <p className="till-full">{client.address}</p>
            <p className="till-balance">{formatLudo(client.coins)}</p>
            <div className="till-flags">
              {client.playing ? <span className="dash-pill">En partie</span> : null}
              {client.yours ? <span className="dash-pill is-on">Client de ce kiosque</span> : null}
              {client.kioskName && !client.yours ? <span className="dash-pill">Chez {client.kioskName}</span> : null}
              {!client.kioskName && !client.playing ? (
                <span className="dash-pill is-on">Libre — une vente l’attache ici</span>
              ) : null}
            </div>
            {client.playing ? (
              <p className="dash-empty-line">Attends la fin de la partie avant de vendre ou racheter.</p>
            ) : null}
            {client.kioskName && !client.yours ? (
              <p className="dash-empty-line">Tu peux lui vendre, mais le rachat se fait chez {client.kioskName}.</p>
            ) : null}
          </article>

          <article className="dash-panel">
            <h2>Opération</h2>
            <label className="field">
              <span>Montant {GAME_ASSET}</span>
              <input
                inputMode="decimal"
                placeholder="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              />
            </label>
            <div className="pills pills--stakes desk__pills">
              {STAKE_UNITS.map((unit) => (
                <button
                  key={unit}
                  type="button"
                  className={units === unit ? 'pill is-on' : 'pill'}
                  onClick={() => setAmount(String(unit))}
                >
                  {formatStakeUnit(unit)} {GAME_ASSET}
                </button>
              ))}
              {client.canBuyback && client.coins > 0 ? (
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    const exact = client.coins / LUDO_PER_USD
                    setAmount(Number.isInteger(exact) ? String(exact) : String(Math.round(exact * 1e6) / 1e6))
                  }}
                >
                  Tout
                </button>
              ) : null}
            </div>
            <p className="field__hint">
              {amountOk
                ? `Vente ${formatDa(daFor(coins, me.sellDa, me.unit))} · rachat ${formatDa(daFor(coins, me.buyDa, me.unit))}`
                : `Tarifs : vente ${formatDa(me.sellDa)} / rachat ${formatDa(me.buyDa)} pour 1 ${GAME_ASSET}`}
            </p>
            <div className="till-actions">
              <button
                type="button"
                className="till-act till-act--sell"
                disabled={busy || !client.canSell || !amountOk}
                onClick={() => setPending('sell')}
              >
                Vendre
                <small>Crédit Ł · encaisser DA</small>
              </button>
              <button
                type="button"
                className="till-act till-act--buy"
                disabled={busy || !client.canBuyback || !amountOk}
                onClick={() => setPending('buyback')}
              >
                Racheter
                <small>Retirer Ł · rendre DA</small>
              </button>
            </div>
            {pending && amountOk ? (
              <div className="till-confirm">
                <p>
                  {pending === 'sell' ? (
                    <>
                      Créditer <strong>{formatLudo(coins)}</strong> · encaisser{' '}
                      <strong>{formatDa(daFor(coins, me.sellDa, me.unit))}</strong>.
                    </>
                  ) : (
                    <>
                      Retirer <strong>{formatLudo(coins)}</strong> · rendre{' '}
                      <strong>{formatDa(daFor(coins, me.buyDa, me.unit))}</strong>.
                    </>
                  )}
                </p>
                <div className="till-confirm-row">
                  <button type="button" className="dash-ghost" onClick={() => setPending(null)} disabled={busy}>
                    Annuler
                  </button>
                  <button className="btn-play" type="button" disabled={busy} onClick={() => void run(pending)}>
                    {busy ? 'Validation…' : 'Confirmer'}
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        </section>
      ) : (
        <p className="dash-empty-line">Colle l’ID du client, ouvre le compte, puis vends ou rachète.</p>
      )}
    </>
  )
}

function OpList({ ops, empty, wide }: { ops: KioskOp[]; empty: string; wide?: boolean }) {
  if (!ops.length) return <p className="dash-empty-line">{empty}</p>
  return (
    <ul className={wide ? 'dash-ops is-wide' : 'dash-ops'}>
      {ops.map((op) => (
        <li key={op.id}>
          <span className={op.kind === 'sell' ? 'dash-chip is-sell' : 'dash-chip is-buy'}>
            {op.kind === 'sell' ? 'Vente' : 'Rachat'}
          </span>
          <div>
            <strong>{formatLudo(op.coins)}</strong>
            <small>
              {shortAddress(op.client_address)}
              {op.da != null ? ` · ${formatDa(op.da)}` : ''}
            </small>
          </div>
          <time dateTime={op.created_at}>{when(op.created_at)}</time>
        </li>
      ))}
    </ul>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="dash-kpi">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function Icon({ name }: { name: Page | 'menu' }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true as const,
  }
  if (name === 'menu') {
    return (
      <svg {...common}>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    )
  }
  if (name === 'counter') {
    return (
      <svg {...common}>
        <rect x="3.5" y="6" width="17" height="12" rx="2" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    )
  }
  if (name === 'overview') {
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
      </svg>
    )
  }
  if (name === 'clients') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M4.5 18c.6-3 2.5-4.5 4.5-4.5S13 15 13.6 18" />
        <circle cx="16.5" cy="9" r="2.4" />
        <path d="M15 18c.4-2.2 1.7-3.3 3.2-3.3 1.2 0 2.2.6 2.8 1.6" />
      </svg>
    )
  }
  if (name === 'profit') {
    return (
      <svg {...common}>
        <path d="M4 16.5 10 10l3.5 3.5L20 7" />
        <path d="M14.5 7H20v5.5" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M4 6h16M4 12h10M4 18h16" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  )
}
