type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Listener = () => void

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const fn of listeners) fn()
}

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

export function subscribeInstall(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function hasInstallPrompt() {
  return Boolean(deferred)
}

export async function promptInstall() {
  if (!deferred) return false
  const event = deferred
  await event.prompt()
  const choice = await event.userChoice
  deferred = null
  emit()
  return choice.outcome === 'accepted'
}

export function isStandaloneDisplay() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function isIosDevice() {
  const ua = window.navigator.userAgent
  const iPhone = /iPhone|iPad|iPod/i.test(ua)
  const iPadOs = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1
  return iPhone || iPadOs
}

export function isSecureInstallContext() {
  return window.isSecureContext
}
