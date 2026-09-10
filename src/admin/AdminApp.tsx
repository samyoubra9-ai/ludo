import { useEffect, useMemo, useState } from 'react'
import {
  ADMIN_TOKEN_KEY,
  adminLogin,
  adminLogout,
  adminMe,
  adminOverview,
  adminSetup,
  adminStatus,
  clearToken,
  createAgent,
  listAdminOps,
  listAgents,
  listCenterApps,
  loadToken,
  approveCenterApp,
  rejectCenterApp,
  saveToken,
  setAgentFrozen,
  type AdminOp,
  type AdminOverview,
  type CenterApp,
  type DeskAgent,
} from '../api/desk'
import { shortAddress } from '../identity/mnemonic'
import { formatCoins, formatDa, formatLudo, LUDO_PER_USD, rakePercent, usdFromLudo } from '../ludo/wallet'
import '../App.css'
import './admin.css'
import { InstallPwa } from '../components/InstallPwa'

type Gate = 'loading' | 'setup' | 'login' | 'desk'
type Page = 'overview' | 'kiosks' | 'apps' | 'new' | 'activity' | 'profit'

const PAGES: Page[] = ['overview', 'kiosks', 'apps', 'new', 'activity', 'profit']

const NAV: { id: Page; label: string; hint: string }[] = [
  { id: 'overview', label: 'Vue d’ensemble', hint: 'Stock et flux' },
  { id: 'kiosks', label: 'Centres', hint: 'Comptoirs validés' },
  { id: 'apps', label: 'Demandes', hint: 'Candidatures' },
  { id: 'profit', label: 'Bénéfices', hint: 'Maison et caisses' },
  { id: 'new', label: 'Nouveau centre', hint: 'Ouvrir un guichet' },
  { id: 'activity', label: 'Mouvements', hint: 'Ventes et rachats' },
]

function readPage(): Page {
  const raw = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return PAGES.includes(raw as Page) ? (raw as Page) : 'overview'
}

function go(page: Page) {
  window.location.hash = page
}

function when(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export function AdminApp() {
  const [gate, setGate] = useState<Gate>('loading')
  const [token, setToken] = useState(() => loadToken(ADMIN_TOKEN_KEY))
  const [username, setUsername] = useState('')
  const [agents, setAgents] = useState<DeskAgent[]>([])
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [ops, setOps] = useState<AdminOp[]>([])
  const [apps, setApps] = useState<CenterApp[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState<Page>(readPage)

  const enter = async (next: string) => {
    saveToken(ADMIN_TOKEN_KEY, next)
    setToken(next)
    const me = await adminMe(next)
    setUsername(me.username)
    const [listed, dash, candidatures] = await Promise.all([listAgents(next), adminOverview(next), listCenterApps(next)])
    setAgents(listed.agents)
    setOverview(dash)
    setOps(dash.recent)
    setApps(candidatures.apps)
    setGate('desk')
  }

  const refresh = async (nextToken = token) => {
    const [listed, dash, activity, candidatures] = await Promise.all([
      listAgents(nextToken),
      adminOverview(nextToken),
      listAdminOps(nextToken),
      listCenterApps(nextToken),
    ])
    setAgents(listed.agents)
    setOverview(dash)
    setOps(activity.ops)
    setApps(candidatures.apps)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (token) {
          await enter(token)
          return
        }
        const status = await adminStatus()
        if (!cancelled) setGate(status.setupNeeded ? 'setup' : 'login')
      } catch {
        clearToken(ADMIN_TOKEN_KEY)
        if (cancelled) return
        setToken('')
        try {
          const status = await adminStatus()
          setGate(status.setupNeeded ? 'setup' : 'login')
        } catch {
          setError('Serveur injoignable.')
          setGate('login')
        }
      }
    })()
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
          <Brand tag="Ouverture du bureau…" />
        </section>
      ) : null}
      {gate === 'setup' ? (
        <AuthCard
          title="Premier accès"
          tag="Aucun compte admin en base. Crée-le une seule fois. Ensuite, tu te connectes."
          submitLabel="Créer l’admin"
          busy={busy}
          error={error}
          onSubmit={async (user, password) => {
            setBusy(true)
            setError('')
            try {
              const next = await adminSetup(user, password)
              await enter(next.token)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Impossible de créer l’admin.')
            }
            setBusy(false)
          }}
        />
      ) : null}
      {gate === 'login' ? (
        <AuthCard
          title="Connexion"
          tag="Identifiant et mot de passe. Pas d’e-mail."
          submitLabel="Entrer"
          busy={busy}
          error={error}
          onSubmit={async (user, password) => {
            setBusy(true)
            setError('')
            try {
              const next = await adminLogin(user, password)
              await enter(next.token)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Connexion impossible.')
            }
            setBusy(false)
          }}
        />
      ) : null}
      {gate === 'desk' ? (
        <Dashboard
          username={username}
          page={page}
          agents={agents}
          overview={overview}
          ops={ops}
          apps={apps}
          error={error}
          notice={notice}
          busy={busy}
          onPage={(next) => {
            setError('')
            setNotice('')
            go(next)
          }}
          onRefresh={async () => {
            setBusy(true)
            setError('')
            try {
              await refresh()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Rafraîchissement impossible.')
            }
            setBusy(false)
          }}
          onCreate={async (payload) => {
            setBusy(true)
            setError('')
            setNotice('')
            try {
              await createAgent(token, payload)
              await refresh()
              setNotice(`${payload.name} est ouvert. Il peut se connecter sur /caisse.`)
              go('kiosks')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Création impossible.')
              throw err
            } finally {
              setBusy(false)
            }
          }}
          onFreeze={async (id, freeze) => {
            setError('')
            try {
              await setAgentFrozen(token, id, freeze)
              await refresh()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Action impossible.')
            }
          }}
          onApproveApp={async (id) => {
            setBusy(true)
            setError('')
            setNotice('')
            try {
              const result = await approveCenterApp(token, id)
              await refresh()
              setNotice(
                result.password
                  ? `Centre validé. Mot de passe envoyé sur Telegram : ${result.password}`
                  : 'Centre validé. Le candidat est notifié sur Telegram.',
              )
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Validation impossible.')
              throw err
            } finally {
              setBusy(false)
            }
          }}
          onRejectApp={async (id) => {
            setBusy(true)
            setError('')
            try {
              await rejectCenterApp(token, id)
              await refresh()
              setNotice('Demande refusée.')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Refus impossible.')
            } finally {
              setBusy(false)
            }
          }}
          onLogout={async () => {
            await adminLogout(token)
            clearToken(ADMIN_TOKEN_KEY)
            setToken('')
            setAgents([])
            setOverview(null)
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
      <p className="logo__kicker">Ludo · administration</p>
      <h1>
        <span className="c-red">L</span>
        <span className="c-green">U</span>
        <span className="c-yellow">D</span>
        <span className="c-blue">O</span>
      </h1>
      <p className="logo__tag">{tag}</p>
    </header>
  )
}

function AuthCard({
  title,
  tag,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  title: string
  tag: string
  submitLabel: string
  busy: boolean
  error: string
  onSubmit: (username: string, password: string) => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const setup = title === 'Premier accès'

  return (
    <section className="dash-auth">
      <Brand tag={tag} />
      <form
        className="lobby__card desk__card"
        onSubmit={(e) => {
          e.preventDefault()
          if (setup && password !== confirm) return
          void onSubmit(username.trim(), password)
        }}
      >
        <h2 className="desk__title">{title}</h2>
        <label className="field">
          <span>Identifiant</span>
          <input
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            minLength={3}
            maxLength={32}
            required
            placeholder="admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Mot de passe</span>
          <input
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            minLength={8}
            required
            placeholder="8 caractères min."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {setup ? (
          <label className="field">
            <span>Confirmation</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              placeholder="Retape le mot de passe"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        ) : null}
        {setup && password && confirm && password !== confirm ? (
          <p className="bank-note">Les mots de passe ne correspondent pas.</p>
        ) : null}
        {error ? <p className="bank-note">{error}</p> : null}
        <button className="btn-play" type="submit" disabled={busy || (setup && password !== confirm)}>
          {busy ? 'Patiente…' : submitLabel}
        </button>
      </form>
    </section>
  )
}

function Dashboard({
  username,
  page,
  agents,
  overview,
  ops,
  apps,
  error,
  notice,
  busy,
  onPage,
  onRefresh,
  onCreate,
  onFreeze,
  onApproveApp,
  onRejectApp,
  onLogout,
}: {
  username: string
  page: Page
  agents: DeskAgent[]
  overview: AdminOverview | null
  ops: AdminOp[]
  apps: CenterApp[]
  error: string
  notice: string
  busy: boolean
  onPage: (page: Page) => void
  onRefresh: () => Promise<void>
  onCreate: (payload: { name: string; address: string; password: string }) => Promise<void>
  onFreeze: (id: number, freeze: boolean) => Promise<void>
  onApproveApp: (id: number) => Promise<void>
  onRejectApp: (id: number) => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [menu, setMenu] = useState(false)
  const current = NAV.find((item) => item.id === page) || NAV[0]

  return (
    <div className="dash">
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
            <strong>Administration</strong>
            <small>Réseau kiosques</small>
          </div>
        </div>
        <nav className="dash-nav" aria-label="Sections">
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
            Connecté
            <strong>{username}</strong>
          </p>
          <button type="button" className="dash-link" onClick={() => void onLogout()}>
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-top">
          <button type="button" className="dash-menu" aria-label="Menu" onClick={() => setMenu(true)}>
            <Icon name="menu" />
          </button>
          <div>
            <p className="dash-top__kicker">Bureau</p>
            <h1>{current.label}</h1>
          </div>
          <button type="button" className="dash-ghost" disabled={busy} onClick={() => void onRefresh()}>
            {busy ? 'Maj…' : 'Actualiser'}
          </button>
        </header>

        <div className="dash-body">
          {notice ? <p className="dash-toast is-ok">{notice}</p> : null}
          {error ? <p className="dash-toast is-bad">{error}</p> : null}
          {page === 'overview' ? (
            <Overview agents={agents} overview={overview} onPage={onPage} />
          ) : null}
          {page === 'kiosks' ? <KioskTable agents={agents} onFreeze={onFreeze} onPage={onPage} /> : null}
          {page === 'apps' ? (
            <Applications apps={apps} busy={busy} onApprove={onApproveApp} onReject={onRejectApp} />
          ) : null}
          {page === 'profit' ? <Profit agents={agents} overview={overview} onPage={onPage} /> : null}
          {page === 'new' ? <NewKiosk busy={busy} onCreate={onCreate} /> : null}
          {page === 'activity' ? <Activity ops={ops} /> : null}
        </div>
      </div>
    </div>
  )
}

function Overview({
  agents,
  overview,
  onPage,
}: {
  agents: DeskAgent[]
  overview: AdminOverview | null
  onPage: (page: Page) => void
}) {
  const top = useMemo(
    () => [...agents].sort((a, b) => b.coins - a.coins).slice(0, 5),
    [agents],
  )
  const kiosks = overview?.kiosks

  return (
    <>
      <section className="dash-kpis">
        <Kpi label="Kiosques actifs" value={String(kiosks?.active ?? 0)} hint={`${kiosks?.frozen ?? 0} gelé(s) · ${kiosks?.total ?? 0} au total`} />
        <Kpi label="Stock réseau" value={formatCoins(kiosks?.stock ?? 0)} hint="LUDO chez les kiosques" />
        <Kpi
          label="Maison (rake)"
          value={formatLudo(overview?.house?.rakeLudo ?? 0)}
          hint={`${formatCoins(overview?.house?.rakeLudoToday ?? 0)} LUDO / 24 h · ${overview?.house?.wins ?? 0} victoires`}
        />
        <Kpi
          label="Bénéfice kiosques"
          value={formatDa(overview?.kiosk?.profit ?? 0)}
          hint={`${formatDa(overview?.kioskToday?.profit ?? 0)} / 24 h`}
        />
      </section>

      <section className="dash-split">
        <article className="dash-panel">
          <header className="dash-panel__head">
            <h2>Kiosques</h2>
            <button type="button" className="dash-link" onClick={() => onPage('kiosks')}>
              Voir tout
            </button>
          </header>
          {top.length === 0 ? (
            <Empty
              title="Aucun kiosque"
              text="Le gérant crée son compte dans le jeu, tu l’enregistres ici, il ouvre /caisse."
              action="Ouvrir un kiosque"
              onAction={() => onPage('new')}
            />
          ) : (
            <ul className="dash-mini">
              {top.map((agent) => (
                <li key={agent.id}>
                  <div>
                    <strong>{agent.name}</strong>
                    <small>
                      {agent.status === 'active' ? `${agent.clients} client(s)` : 'Gelé'} · {formatDa(agent.profitDa || 0)}
                    </small>
                  </div>
                  <span>{formatLudo(agent.coins)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="dash-panel">
          <header className="dash-panel__head">
            <h2>Derniers mouvements</h2>
            <button type="button" className="dash-link" onClick={() => onPage('activity')}>
              Journal
            </button>
          </header>
          <OpList ops={overview?.recent || []} empty="Pas encore de vente ou de rachat." />
        </article>
      </section>
    </>
  )
}

function Profit({
  agents,
  overview,
  onPage,
}: {
  agents: DeskAgent[]
  overview: AdminOverview | null
  onPage: (page: Page) => void
}) {
  const ranked = useMemo(
    () => [...agents].sort((a, b) => (b.profitDa || 0) - (a.profitDa || 0)),
    [agents],
  )
  const house = overview?.house
  const kiosk = overview?.kiosk
  const kioskToday = overview?.kioskToday
  const rakeUsd = usdFromLudo(house?.rakeLudo ?? 0)

  return (
    <>
      <section className="dash-kpis">
        <Kpi
          label="Rake maison"
          value={formatLudo(house?.rakeLudo ?? 0)}
          hint={`≈ ${rakeUsd.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} USDT · ${rakePercent()} % des pots`}
        />
        <Kpi
          label="Rake 24 h"
          value={formatLudo(house?.rakeLudoToday ?? 0)}
          hint={`${house?.winsToday ?? 0} victoire(s) aujourd’hui`}
        />
        <Kpi
          label="Marge kiosques"
          value={formatDa(kiosk?.profit ?? 0)}
          hint={`Encaissé ${formatDa(kiosk?.cashIn ?? 0)} · rendu ${formatDa(kiosk?.cashOut ?? 0)}`}
        />
        <Kpi
          label="Marge 24 h"
          value={formatDa(kioskToday?.profit ?? 0)}
          hint={`${kioskToday?.sell ?? 0} ventes · ${kioskToday?.buyback ?? 0} rachats`}
        />
      </section>
      <article className="dash-panel">
        <p className="dash-empty-line">
          La maison gagne le rake des parties (LUDO brûlés, les kiosques doivent se restocker). Le kiosque gagne en
          dinars : il vend plus cher qu’il ne rachète. Les tarifs se règlent dans chaque caisse.
        </p>
      </article>
      <article className="dash-panel dash-panel--full">
        <header className="dash-panel__head">
          <h2>Classement des caisses</h2>
          <button type="button" className="dash-link" onClick={() => onPage('kiosks')}>
            Kiosques
          </button>
        </header>
        {ranked.length === 0 ? (
          <p className="dash-empty-line">Aucun kiosque.</p>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Kiosque</th>
                  <th>Vente / rachat</th>
                  <th>Bénéfice</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <strong>{agent.name}</strong>
                      <small className="dash-muted">{agent.status === 'active' ? 'Actif' : 'Gelé'}</small>
                    </td>
                    <td>
                      {formatDa(agent.sellDa || 0)} / {formatDa(agent.buyDa || 0)}
                      <small className="dash-muted">pour {LUDO_PER_USD} LUDO</small>
                    </td>
                    <td>{formatDa(agent.profitDa || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </>
  )
}

function KioskTable({
  agents,
  onFreeze,
  onPage,
}: {
  agents: DeskAgent[]
  onFreeze: (id: number, freeze: boolean) => Promise<void>
  onPage: (page: Page) => void
}) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(
      (agent) => agent.name.toLowerCase().includes(q) || agent.address.toLowerCase().includes(q),
    )
  }, [agents, query])

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(address)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      /* ignore */
    }
  }

  return (
    <article className="dash-panel dash-panel--full">
      <header className="dash-panel__head">
        <h2>{agents.length} kiosque{agents.length > 1 ? 's' : ''}</h2>
        <div className="dash-toolbar">
          <input
            className="dash-search"
            placeholder="Filtrer nom ou ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="dash-primary" onClick={() => onPage('new')}>
            Nouveau
          </button>
        </div>
      </header>
      {filtered.length === 0 ? (
        <Empty
          title={agents.length ? 'Aucun résultat' : 'Aucun kiosque'}
          text={agents.length ? 'Essaie un autre nom ou un autre ID.' : 'Ouvre le premier comptoir pour commencer le réseau.'}
          action={agents.length ? undefined : 'Ouvrir un kiosque'}
          onAction={agents.length ? undefined : () => onPage('new')}
        />
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Kiosque</th>
                <th>ID</th>
                <th>Clients</th>
                <th>Stock</th>
                <th>Tarifs</th>
                <th>Bénéfice</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((agent) => (
                <tr key={agent.id}>
                  <td>
                    <strong>{agent.name}</strong>
                    <small className="dash-muted">{when(agent.created_at)}</small>
                  </td>
                  <td>
                    <button type="button" className="dash-id" title={agent.address} onClick={() => void copy(agent.address)}>
                      {copied === agent.address ? 'Copié' : shortAddress(agent.address)}
                    </button>
                  </td>
                  <td>{agent.clients}</td>
                  <td>{formatLudo(agent.coins)}</td>
                  <td>
                    <small className="dash-muted">
                      {agent.sellDa}/{agent.buyDa} DA
                    </small>
                  </td>
                  <td>{formatDa(agent.profitDa || 0)}</td>
                  <td>
                    <span className={agent.status === 'active' ? 'dash-pill is-on' : 'dash-pill'}>
                      {agent.status === 'active' ? 'Actif' : 'Gelé'}
                    </span>
                  </td>
                  <td className="dash-table__act">
                    <button type="button" className="dash-ghost" onClick={() => void onFreeze(agent.id, agent.status === 'active')}>
                      {agent.status === 'active' ? 'Geler' : 'Dégeler'}
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

function NewKiosk({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (payload: { name: string; address: string; password: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="dash-form-wrap">
      <ol className="dash-steps">
        <li>Le gérant ouvre le jeu et crée son compte (comme un joueur).</li>
        <li>Tu colles son ID 0x… et tu choisis un mot de passe caisse.</li>
        <li>Il se connecte sur /caisse — le joueur, lui, reste au comptoir.</li>
      </ol>
      <form
        className="dash-panel dash-form"
        onSubmit={(e) => {
          e.preventDefault()
          void onCreate({ name: name.trim(), address: address.trim(), password })
            .then(() => {
              setName('')
              setAddress('')
              setPassword('')
            })
            .catch(() => undefined)
        }}
      >
        <h2>Fiche kiosque</h2>
        <label className="field">
          <span>Nom du comptoir</span>
          <input
            required
            minLength={3}
            maxLength={32}
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Karim"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>ID joueur du kiosque</span>
          <input
            required
            autoCapitalize="off"
            spellCheck={false}
            placeholder="0x…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Mot de passe caisse</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="8 caractères min."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn-play" type="submit" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Ouvrir le kiosque'}
        </button>
      </form>
    </div>
  )
}

function Activity({ ops }: { ops: AdminOp[] }) {
  return (
    <article className="dash-panel dash-panel--full">
      <header className="dash-panel__head">
        <h2>Journal des caisses</h2>
      </header>
      <OpList ops={ops} empty="Aucun mouvement pour l’instant." wide />
    </article>
  )
}

function OpList({ ops, empty, wide }: { ops: AdminOp[]; empty: string; wide?: boolean }) {
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
              {op.agent_name} · {shortAddress(op.client_address)}
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

function Empty({
  title,
  text,
  action,
  onAction,
}: {
  title: string
  text: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="dash-empty">
      <strong>{title}</strong>
      <p>{text}</p>
      {action && onAction ? (
        <button type="button" className="dash-primary" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  )
}

function Applications({
  apps,
  busy,
  onApprove,
  onReject,
}: {
  apps: CenterApp[]
  busy: boolean
  onApprove: (id: number) => Promise<void>
  onReject: (id: number) => Promise<void>
}) {
  const pending = apps.filter((row) => row.status === 'pending')
  const done = apps.filter((row) => row.status !== 'pending')

  return (
    <article className="dash-panel dash-panel--full">
      <header className="dash-panel__head">
        <h2>
          {pending.length} demande{pending.length > 1 ? 's' : ''} en attente
        </h2>
      </header>
      {pending.length === 0 ? (
        <p className="dash-empty-line">Aucune candidature. Les demandes arrivent via /centre sur le bot.</p>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Centre</th>
                <th>Ville</th>
                <th>Identifiant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <small className="dash-muted">{when(row.created_at)}</small>
                  </td>
                  <td>{row.city || '—'}</td>
                  <td>
                    <small className="dash-muted">{row.address}</small>
                  </td>
                  <td className="dash-table__act">
                    <button
                      type="button"
                      className="dash-primary"
                      disabled={busy}
                      onClick={() => void onApprove(row.id)}
                    >
                      Valider
                    </button>
                    <button type="button" className="dash-ghost" disabled={busy} onClick={() => void onReject(row.id)}>
                      Refuser
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {done.length ? (
        <ul className="dash-mini" style={{ marginTop: '1.2rem' }}>
          {done.slice(0, 12).map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <small>
                  {row.status === 'approved' ? 'Validé' : 'Refusé'} · {when(row.decided_at || row.created_at)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function Icon({ name }: { name: Page | 'menu' }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true as const }
  if (name === 'menu') {
    return (
      <svg {...common}>
        <path d="M4 7h16M4 12h16M4 17h16" />
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
  if (name === 'apps') {
    return (
      <svg {...common}>
        <path d="M8 7h8M8 12h8M8 17h5" />
        <rect x="4" y="4" width="16" height="16" rx="2.2" />
      </svg>
    )
  }
  if (name === 'kiosks') {
    return (
      <svg {...common}>
        <path d="M4 10h16l-1.2 9.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 10Z" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    )
  }
  if (name === 'new') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 8.5v7M8.5 12h7" />
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
