/**
 * WebSocket client of the browser build: same `invoke` / `on` shape as the Electron preload, plus the pairing state.
 * No DOM globals here: the page's environment (socket class, storage, URL, download) is injected so tests can run it.
 */
import type { CliAccountStatus, RunEvent, Vendor } from '../../core/types'

export type PushChannel = 'run:event' | 'accounts:update'
export type PushData = RunEvent | { vendor: Vendor; cli: CliAccountStatus }
export type PushListener = (data: PushData) => void

export interface Transport {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  on(channel: PushChannel, listener: PushListener): () => void
}

export type WebState =
  | { kind: 'connecting' }
  /** Waiting for a pairing code. `error` is the `err.*` key of why the last try failed (or null on a fresh start). */
  | { kind: 'needs-code'; error: string | null }
  | { kind: 'ready' }
  /** The socket dropped: retrying with the token. `wasReady` is true when the app was already on screen. */
  | { kind: 'reconnecting'; wasReady: boolean }

export interface WsLike {
  readyState: number
  send(data: string): void
  close(code?: number): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
}
export type WsCtor = new (url: string) => WsLike

export interface TokenStore {
  get(): string | null
  set(token: string): void
  clear(): void
}

export interface WebTransportOptions {
  url: string
  WebSocketImpl: WsCtor
  tokenStore: TokenStore
  /** Called with the Markdown of an export: the browser saves it as a file. */
  download?: (name: string, text: string) => void
  /** Delays between reconnection tries (the last one repeats). */
  backoffMs?: number[]
}

export interface WebTransport extends Transport {
  getState(): WebState
  subscribe(fn: (s: WebState) => void): () => void
  /** Reconnect with the stored token, or ask for a code when there is none. */
  resume(): void
  /** Pair with the code shown in the desktop app. */
  pair(code: string): void
  /** Forget the token and ask for a code. */
  forget(): void
  close(): void
}

type AttemptResult = { ok: true; token?: string } | { ok: false; error: string; unreachable: boolean }

const DEFAULT_BACKOFF = [500, 1000, 2000, 5000, 10_000, 15_000]
const OPEN = 1

export function createWebTransport(opts: WebTransportOptions): WebTransport {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF
  let state: WebState = { kind: 'connecting' }
  const stateListeners = new Set<(s: WebState) => void>()
  const listeners: Record<PushChannel, Set<PushListener>> = { 'run:event': new Set(), 'accounts:update': new Set() }
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let ws: WsLike | null = null
  let nextId = 1
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryCount = 0
  let wasReady = false

  const setState = (s: WebState): void => {
    state = s
    for (const fn of [...stateListeners]) fn(s)
  }
  const failPending = (key: string): void => {
    for (const p of pending.values()) p.reject(new Error(key))
    pending.clear()
  }
  const clearRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }

  const handleServerMessage = (raw: unknown): void => {
    let m: { type?: unknown; id?: unknown; ok?: unknown; data?: unknown; error?: unknown; channel?: unknown }
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (m.type === 'result' && typeof m.id === 'number') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok === true) p.resolve(m.data)
      else p.reject(new Error(typeof m.error === 'string' ? m.error : 'err.generic'))
    } else if (m.type === 'event' && (m.channel === 'run:event' || m.channel === 'accounts:update')) {
      for (const fn of [...listeners[m.channel]]) fn(m.data as PushData)
    }
  }

  /** Opens a socket and authenticates with a code or a token; on success the socket stays open. */
  const attempt = (auth: { code: string } | { token: string }): Promise<AttemptResult> =>
    new Promise((resolve) => {
      let settled = false
      let authed = false
      let sock: WsLike
      const settle = (r: AttemptResult): void => {
        if (settled) return
        settled = true
        resolve(r)
      }
      try {
        sock = new opts.WebSocketImpl(opts.url)
      } catch {
        return resolve({ ok: false, error: 'err.bridgeUnreachable', unreachable: true })
      }
      sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', ...auth }))
      sock.onerror = () => undefined
      sock.onmessage = (ev) => {
        if (!authed) {
          let m: { type?: unknown; ok?: unknown; token?: unknown; error?: unknown }
          try {
            m = JSON.parse(String(ev.data))
          } catch {
            return
          }
          if (m.type !== 'auth') return
          if (m.ok === true) {
            authed = true
            ws = sock
            settle({ ok: true, ...(typeof m.token === 'string' ? { token: m.token } : {}) })
          } else settle({ ok: false, error: typeof m.error === 'string' ? m.error : 'err.generic', unreachable: false })
          return
        }
        handleServerMessage(ev.data)
      }
      sock.onclose = () => {
        if (!authed) return settle({ ok: false, error: 'err.bridgeUnreachable', unreachable: true })
        if (ws === sock) {
          ws = null
          onLost()
        }
      }
    })

  const onLost = (): void => {
    failPending('err.connectionLost')
    startReconnect()
  }

  const startReconnect = (): void => {
    clearRetry()
    setState({ kind: 'reconnecting', wasReady })
    const delay = backoff[Math.min(retryCount, backoff.length - 1)] ?? 15_000
    retryCount++
    retryTimer = setTimeout(() => {
      retryTimer = null
      const token = opts.tokenStore.get()
      if (!token) return setState({ kind: 'needs-code', error: null })
      void attempt({ token }).then((r) => {
        if (r.ok) {
          retryCount = 0
          wasReady = true
          setState({ kind: 'ready' })
        } else if (!r.unreachable && r.error !== 'err.bridgeRateLimited') {
          // The desktop app no longer knows this token (restart, revoke, 12 h idle): pair again.
          opts.tokenStore.clear()
          wasReady = false
          setState({ kind: 'needs-code', error: r.error })
        } else startReconnect()
      })
    }, delay)
  }

  const closeSocket = (): void => {
    const s = ws
    ws = null
    if (s) {
      s.onclose = null
      try {
        s.close(1000)
      } catch {
        /* already closed */
      }
    }
    failPending('err.connectionLost')
  }

  const api: WebTransport = {
    getState: () => state,
    subscribe(fn) {
      stateListeners.add(fn)
      return () => {
        stateListeners.delete(fn)
      }
    },
    resume() {
      clearRetry()
      closeSocket()
      const token = opts.tokenStore.get()
      if (!token) return setState({ kind: 'needs-code', error: null })
      setState({ kind: 'connecting' })
      void attempt({ token }).then((r) => {
        if (r.ok) {
          retryCount = 0
          wasReady = true
          setState({ kind: 'ready' })
        } else if (r.unreachable || r.error === 'err.bridgeRateLimited') {
          startReconnect()
        } else {
          opts.tokenStore.clear()
          setState({ kind: 'needs-code', error: r.error })
        }
      })
    },
    pair(code) {
      clearRetry()
      closeSocket()
      setState({ kind: 'connecting' })
      void attempt({ code }).then((r) => {
        if (r.ok && r.token) {
          opts.tokenStore.set(r.token)
          retryCount = 0
          wasReady = true
          setState({ kind: 'ready' })
        } else {
          setState({ kind: 'needs-code', error: r.ok ? 'err.generic' : r.error })
        }
      })
    },
    forget() {
      clearRetry()
      closeSocket()
      opts.tokenStore.clear()
      wasReady = false
      setState({ kind: 'needs-code', error: null })
    },
    close() {
      clearRetry()
      closeSocket()
    },
    invoke(channel, payload) {
      const sock = ws
      if (state.kind !== 'ready' || !sock || sock.readyState !== OPEN) return Promise.reject(new Error('err.connectionLost'))
      const id = nextId++
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try {
          sock.send(JSON.stringify({ type: 'call', id, channel, payload: payload ?? null }))
        } catch {
          pending.delete(id)
          reject(new Error('err.connectionLost'))
        }
      }).then((data) => {
        // The browser saves the export itself: the desktop app writes nothing.
        if (channel === 'history:export' && data && typeof data === 'object') {
          const d = data as { name?: unknown; text?: unknown }
          if (typeof d.name === 'string' && typeof d.text === 'string' && opts.download) {
            opts.download(d.name, d.text)
            return { saved: true, name: d.name }
          }
        }
        return data
      })
    },
    on(channel, listener) {
      listeners[channel].add(listener)
      return () => {
        listeners[channel].delete(listener)
      }
    }
  }
  return api
}
