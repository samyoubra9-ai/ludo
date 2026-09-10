import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import './App.css'
import App from './App.tsx'
import { AdminApp } from './admin/AdminApp.tsx'
import { KioskApp } from './kiosk/KioskApp.tsx'
import { bindPwaManifest } from './pwa/apps'
import { captureInstallPrompt } from './pwa/install'

bindPwaManifest()
captureInstallPrompt()

registerSW({ immediate: true })

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const Root =
  path === '/admin' || path.startsWith('/admin/')
    ? AdminApp
    : path === '/caisse' || path.startsWith('/caisse/')
      ? KioskApp
      : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
