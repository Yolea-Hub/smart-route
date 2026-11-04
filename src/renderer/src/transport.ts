import { createWebTransport, type Transport, type TokenStore, type WebTransport, type WsCtor } from './webTransport'

export type { PushChannel, PushData, Transport, WebState } from './webTransport'

/** True in the browser build, false in the desktop build (replaced when the bundle is built). */
export const IS_WEB: boolean = typeof __WEB__ !== 'undefined' && __WEB__

const TOKEN_KEY = 'smartroute.web.token'

/** The token lives in sessionStorage: closing the tab forgets it, and no other tab or site can read it. */
const tokenStore: TokenStore = {
  get() {
    try {
      return sessionStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* storage unavailable: pairing is asked again after a reload */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* nothing to clear */
    }
  }
}

function saveAsFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Browser build: the WebSocket client of the desktop app. Created only when the page is the web build. */
export const webTransport: WebTransport | null = IS_WEB
  ? createWebTransport({ url: `ws://${location.host}/ws`, WebSocketImpl: WebSocket as unknown as WsCtor, tokenStore, download: saveAsFile })
  : null

/** Desktop build: the preload bridge to the main process. */
const ipcTransport: Transport = {
  invoke: (channel, payload) => window.smartRoute.invoke(channel, payload),
  on: (channel, listener) => window.smartRoute.on(channel, listener as Parameters<Window['smartRoute']['on']>[1])
}

/** Chosen when the bundle is built. */
export const transport: Transport = webTransport ?? ipcTransport
