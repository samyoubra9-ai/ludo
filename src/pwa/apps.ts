export type PwaApp = 'game' | 'caisse' | 'admin'

export type PwaProfile = {
  id: PwaApp
  manifest: string
  title: string
  shortName: string
  theme: string
  icon: string
  hint: string
}

const PROFILES: Record<PwaApp, PwaProfile> = {
  game: {
    id: 'game',
    manifest: '/manifest.webmanifest',
    title: 'Petit paquet',
    shortName: 'Paquet',
    theme: '#071018',
    icon: '/pwa-192.png',
    hint: 'Sur l’écran d’accueil, comme une vraie appli.',
  },
  caisse: {
    id: 'caisse',
    manifest: '/caisse.webmanifest',
    title: 'Petit paquet Caisse',
    shortName: 'Caisse',
    theme: '#0f3d2c',
    icon: '/pwa-caisse-192.png',
    hint: 'Uniquement le comptoir. Pas le jeu.',
  },
  admin: {
    id: 'admin',
    manifest: '/admin.webmanifest',
    title: 'Petit paquet Admin',
    shortName: 'Admin',
    theme: '#0b1022',
    icon: '/pwa-admin-192.png',
    hint: 'Uniquement l’administration.',
  },
}

export function pwaAppFromPath(pathname = window.location.pathname): PwaApp {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/caisse' || path.startsWith('/caisse/')) return 'caisse'
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin'
  return 'game'
}

export function pwaProfile(app = pwaAppFromPath()): PwaProfile {
  return PROFILES[app]
}

export function bindPwaManifest() {
  const profile = pwaProfile()
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'manifest'
    document.head.appendChild(link)
  }
  link.href = profile.manifest

  let apple = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
  if (!apple) {
    apple = document.createElement('meta')
    apple.name = 'apple-mobile-web-app-title'
    document.head.appendChild(apple)
  }
  apple.content = profile.title
  document.title = profile.title

  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (theme) theme.content = profile.theme

  let appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (!appleIcon) {
    appleIcon = document.createElement('link')
    appleIcon.rel = 'apple-touch-icon'
    document.head.appendChild(appleIcon)
  }
  appleIcon.href = profile.icon
}
