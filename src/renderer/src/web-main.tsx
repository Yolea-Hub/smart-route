import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Same entry as main.tsx (theme script, then Sogoma in the order of YOLEA.md, then the app's own parts), for the browser build.
import '@sogoma/web/sg-theme.js'
import '@sogoma/tokens/tokens.css'
import '@sogoma/fonts/fallbacks.css'
import '@sogoma/css/base.css'
import '@sogoma/css/icons.css'
import '@sogoma/css/components.css'
import './vendor.css'
import './styles.css'
import { WebGate } from './components/WebGate'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <WebGate />
  </StrictMode>
)
