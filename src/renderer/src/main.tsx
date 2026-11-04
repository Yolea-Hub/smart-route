import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The Sogoma theme button script runs here, before the first render, so a chosen Day or Night is applied at once. It is the vendored file.
import '@sogoma/web/sg-theme.js'
// Sogoma, in the order of YOLEA.md: tokens, fonts and their fallbacks, base, icons, components. Then the app's own parts.
import '@sogoma/tokens/tokens.css'
import '@sogoma/fonts/fallbacks.css'
import '@sogoma/css/base.css'
import '@sogoma/css/icons.css'
import '@sogoma/css/components.css'
import './vendor.css'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
