import { useEffect, useState } from 'react'
import { pwaProfile } from '../pwa/apps'
import {
  hasInstallPrompt,
  isIosDevice,
  isSecureInstallContext,
  isStandaloneDisplay,
  promptInstall,
  subscribeInstall,
} from '../pwa/install'

export function InstallPwa() {
  const profile = pwaProfile()
  const [hidden, setHidden] = useState(isStandaloneDisplay)
  const [canPrompt, setCanPrompt] = useState(hasInstallPrompt)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    const sync = () => {
      const standalone = isStandaloneDisplay()
      setHidden(standalone)
      setCanPrompt(hasInstallPrompt())
      document.documentElement.classList.toggle('is-install-offer', !standalone)
    }
    sync()
    const off = subscribeInstall(sync)
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener('change', sync)
    return () => {
      off()
      mq.removeEventListener('change', sync)
      document.documentElement.classList.remove('is-install-offer')
    }
  }, [])

  if (hidden) return null

  const install = async () => {
    if (canPrompt) {
      const ok = await promptInstall()
      if (ok) setHidden(true)
      return
    }
    setHelp(true)
  }

  return (
    <>
      <div className="install-bar">
        <img className="install-bar__icon" src={profile.icon} alt="" width={40} height={40} />
        <div className="install-bar__copy">
          <strong>Installer {profile.shortName}</strong>
          <span>{profile.hint}</span>
        </div>
        <button type="button" className="install-bar__go" onClick={() => void install()}>
          Installer
        </button>
      </div>
      {help ? (
        <div className="install-scrim" role="presentation" onClick={() => setHelp(false)}>
          <aside className="install-sheet" role="dialog" aria-label="Installer l’application" onClick={(e) => e.stopPropagation()}>
            <header className="install-sheet__head">
              <h2>Installer {profile.title}</h2>
              <button type="button" className="gear-btn" aria-label="Fermer" onClick={() => setHelp(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"
                  />
                </svg>
              </button>
            </header>
            {isIosDevice() ? (
              <ol className="how-steps how-steps--set">
                <li>
                  Touche <strong>Partager</strong> (carré avec flèche) en bas de Safari.
                </li>
                <li>
                  Choisis <strong>Sur l’écran d’accueil</strong>.
                </li>
              </ol>
            ) : (
              <ol className="how-steps how-steps--set">
                <li>
                  Touche <strong>Installer</strong> dans la barre jaune — Chrome ouvre la vraie appli, pas un raccourci.
                </li>
                {!isSecureInstallContext() ? (
                  <li>
                    Ici le site est en <strong>http</strong>. L’icône dans l’URL n’apparaît qu’en <strong>https</strong> (ou sur localhost).
                  </li>
                ) : (
                  <li>
                    Tu peux aussi utiliser l’icône <strong>Installer</strong> dans la barre d’adresse Chrome.
                  </li>
                )}
              </ol>
            )}
            <button type="button" className="btn-play" onClick={() => setHelp(false)}>
              OK
            </button>
          </aside>
        </div>
      ) : null}
    </>
  )
}
