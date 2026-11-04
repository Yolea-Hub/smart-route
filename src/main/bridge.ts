import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import { WEB_ALLOWED_CHANNELS } from '../core/channels'
import { buildMarkdown, exportFileName } from '../core/exportMd'
import { IPC_SCHEMAS, webSettingsPatchSchema, type IpcChannel } from '../core/schemas'
import type { BridgeStatus, HistoryEntry, Pipeline, Settings } from '../core/types'
import type { Broadcaster } from './broadcaster'
import { PairingManager, type AuthFailure } from './pairing'

export const BRIDGE_HOST = '127.0.0.1'
export const BRIDGE_PORTS: readonly number[] = [47821, 47822, 47823, 47824]
export const WS_PATH = '/ws'
/** The page of the web build (vite.web.config.ts keeps the name of its HTML entry). */
export const INDEX_FILE = 'web.html'
export const MAX_PAYLOAD = 1024 * 1024
export const MAX_SOCKETS = 8
/** WebSocket upgrades accepted per window, all clients together: a local process cannot churn connections to starve the slots. */
export const UPGRADE_LIMIT = 20
export const UPGRADE_WINDOW_MS = 60_000
export const HEARTBEAT_MS = 30_000
export const AUTH_TIMEOUT_MS = 5_000
/** Calls a single socket may have running at once. */
const MAX_INFLIGHT = 32
/** A socket that cannot keep up with pushes is dropped rather than buffered without limit. */
const MAX_BUFFERED = 8 * 1024 * 1024
/** Application close code for « pair again » (revoked, expired, wrong code). */
export const CLOSE_AUTH = 4401

/** Content-Security-Policy of the web page (also set as a header on every HTML answer). */
export const WEB_CSP =
  "default-src 'self'; connect-src ws://127.0.0.1:*; img-src 'self' data:; font-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const ALLOWED = new Set<string>(WEB_ALLOWED_CHANNELS)

export type ChannelHandlers = { [C in IpcChannel]: (payload: never) => Promise<unknown> }

export interface BridgeOptions {
  handlers: ChannelHandlers
  broadcaster: Broadcaster
  /** Directory of the web build (`out/web`). */
  webRoot: string
  /** Ports tried in order (tests pass `[0]` for an ephemeral port). */
  ports?: readonly number[]
  now?: () => number
  authTimeoutMs?: number
  heartbeatMs?: number
  pairing?: PairingManager
}

export interface BridgeControl {
  status(): BridgeStatus
  start(): Promise<BridgeStatus>
  stop(): Promise<BridgeStatus>
  newCode(): BridgeStatus
  revokeAll(): BridgeStatus
}

const authMsg = z
  .object({ type: z.literal('auth'), code: z.string().max(64).optional(), token: z.string().max(128).optional() })
  .strict()
  .refine((m) => (m.code === undefined) !== (m.token === undefined))
const callMsg = z
  .object({ type: z.literal('call'), id: z.union([z.number().int().min(0), z.string().max(64)]), channel: z.string().max(64), payload: z.unknown() })
  .strict()

const AUTH_ERROR: Record<AuthFailure, string> = {
  rate: 'err.bridgeRateLimited',
  bad: 'err.bridgeBadCode',
  expired: 'err.bridgeCodeExpired',
  session: 'err.sessionExpired'
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8'
}

interface Conn {
  ws: WebSocket
  alive: boolean
  tokenHash: string | null
  inflight: number
  authTimer: NodeJS.Timeout | null
}

/** The `err.*` key of a thrown error, or `err.generic`: internal messages never reach the browser. */
function errorKey(e: unknown): string {
  const m = e instanceof Error ? /^(err\.[A-Za-z]+)$/.exec(e.message) : null
  return m ? (m[1] as string) : 'err.generic'
}

/** Browser runs are read-only, whatever the page sends. */
function readOnly(p: Pipeline): Pipeline {
  return { ...p, steps: p.steps.map((s) => ({ ...s, canEdit: false })) }
}

export function createBridge(opts: BridgeOptions): BridgeControl & { port(): number | null } {
  const now = opts.now ?? Date.now
  const pairing = opts.pairing ?? new PairingManager({ now })
  const ports = opts.ports ?? BRIDGE_PORTS
  const authTimeoutMs = opts.authTimeoutMs ?? AUTH_TIMEOUT_MS
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS
  const webRoot = resolve(opts.webRoot)
  const handlers = opts.handlers as unknown as Record<string, (payload: unknown) => Promise<unknown>>

  let server: Server | null = null
  let wss: WebSocketServer | null = null
  let port: number | null = null
  let lastError: string | undefined
  let heartbeat: NodeJS.Timeout | null = null
  let removeSink: (() => void) | null = null
  const conns = new Set<Conn>()

  const status = (): BridgeStatus => {
    const c = server ? pairing.currentCode() : null
    return {
      enabled: server !== null,
      port,
      url: server && port !== null ? `http://${BRIDGE_HOST}:${port}` : null,
      code: c?.code ?? null,
      codeExpiresAt: c?.expiresAt ?? null,
      sessions: pairing.sessionCount(),
      ...(lastError ? { error: lastError } : {})
    }
  }

  const send = (ws: WebSocket, msg: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }
  const closeConn = (c: Conn, code: number, reason: string): void => {
    if (c.authTimer) clearTimeout(c.authTimer)
    c.authTimer = null
    if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) c.ws.close(code, reason)
  }

  // ---- HTTP: static files only ----
  const hostOk = (req: IncomingMessage): boolean => port !== null && req.headers.host === `${BRIDGE_HOST}:${port}`
  const originOk = (req: IncomingMessage): boolean => port !== null && req.headers.origin === `http://${BRIDGE_HOST}:${port}`

  const plain = (res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra })
    res.end(text)
  }

  const serveStatic = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') return plain(res, 405, 'Method Not Allowed', { Allow: 'GET' })
    if (!hostOk(req)) return plain(res, 403, 'Forbidden')
    const raw = req.url ?? ''
    if (!raw.startsWith('/') || raw.startsWith('//')) return plain(res, 400, 'Bad Request')
    let pathname: string
    try {
      pathname = decodeURIComponent(raw.split('?')[0]?.split('#')[0] ?? '/')
    } catch {
      return plain(res, 400, 'Bad Request')
    }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) return plain(res, 404, 'Not Found')
    if (pathname === '/') pathname = `/${INDEX_FILE}`
    const file = resolve(webRoot, `.${pathname}`)
    if (!file.startsWith(webRoot + sep)) return plain(res, 404, 'Not Found')
    try {
      // A symbolic link must not lead out of the web folder.
      const real = await realpath(file)
      const realRoot = await realpath(webRoot)
      if (!real.startsWith(realRoot + sep)) return plain(res, 404, 'Not Found')
      if (!(await stat(real)).isFile()) return plain(res, 404, 'Not Found')
      const body = await readFile(real)
      const type = MIME[extname(real).toLowerCase()] ?? 'application/octet-stream'
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Frame-Options': 'DENY',
        ...(type.startsWith('text/html') ? { 'Content-Security-Policy': WEB_CSP } : {})
      })
      res.end(body)
    } catch {
      plain(res, 404, 'Not Found')
    }
  }

  // ---- WebSocket ----
  const dispatch = async (channel: string, payload: unknown): Promise<unknown> => {
    const ch = channel as IpcChannel
    const schema = ch === 'settings:set' ? webSettingsPatchSchema : IPC_SCHEMAS[ch]
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error('err.invalidInput')
    const data = parsed.data as unknown
    const call = (c: string, p: unknown): Promise<unknown> => (handlers[c] as (p: unknown) => Promise<unknown>)(p)

    if (ch === 'run:start') {
      const d = data as { pipeline: Pipeline }
      return call(ch, { ...d, pipeline: readOnly(d.pipeline) })
    }
    if (ch === 'task:analyse') {
      const r = (await call(ch, data)) as { pipeline: Pipeline }
      return { ...r, pipeline: readOnly(r.pipeline) }
    }
    if (ch === 'history:export') {
      // The browser downloads the text itself: nothing is written on this computer.
      const { id } = data as { id: string }
      const entry = ((await call('history:list', undefined)) as HistoryEntry[]).find((e) => e.id === id)
      if (!entry) throw new Error('err.notFound')
      const settings = (await call('settings:get', undefined)) as Settings
      return { name: exportFileName(entry), text: buildMarkdown(entry, settings.lang) }
    }
    return call(ch, data)
  }

  const handleAuth = (c: Conn, msg: unknown): void => {
    if (c.authTimer) clearTimeout(c.authTimer)
    c.authTimer = null
    const parsed = authMsg.safeParse(msg)
    if (!parsed.success) return closeConn(c, 1008, 'auth required')
    const m = parsed.data
    const r = m.code !== undefined ? pairing.redeemCode(m.code) : pairing.checkToken(m.token as string)
    if (!r.ok) {
      send(c.ws, { type: 'auth', ok: false, error: AUTH_ERROR[r.reason] })
      return closeConn(c, CLOSE_AUTH, 'auth failed')
    }
    c.tokenHash = r.tokenHash
    send(c.ws, r.kind === 'code' ? { type: 'auth', ok: true, token: r.token } : { type: 'auth', ok: true })
  }

  const handleCall = async (c: Conn, msg: unknown): Promise<void> => {
    const parsed = callMsg.safeParse(msg)
    if (!parsed.success) return closeConn(c, 1008, 'bad message')
    const { id, channel, payload } = parsed.data
    const reply = (m: { ok: true; data: unknown } | { ok: false; error: string }): void => send(c.ws, { type: 'result', id, ...m })
    if (!c.tokenHash || !pairing.touch(c.tokenHash)) {
      reply({ ok: false, error: 'err.sessionExpired' })
      return closeConn(c, CLOSE_AUTH, 'session expired')
    }
    if (!ALLOWED.has(channel)) return reply({ ok: false, error: 'err.channelDenied' })
    if (c.inflight >= MAX_INFLIGHT) return reply({ ok: false, error: 'err.bridgeBusy' })
    c.inflight++
    try {
      reply({ ok: true, data: (await dispatch(channel, payload)) ?? null })
    } catch (e) {
      reply({ ok: false, error: errorKey(e) })
    } finally {
      c.inflight--
    }
  }

  const onConnection = (ws: WebSocket): void => {
    const c: Conn = { ws, alive: true, tokenHash: null, inflight: 0, authTimer: null }
    conns.add(c)
    c.authTimer = setTimeout(() => {
      if (!c.tokenHash) closeConn(c, CLOSE_AUTH, 'auth timeout')
    }, authTimeoutMs)
    ws.on('pong', () => {
      c.alive = true
    })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return closeConn(c, 1003, 'text only')
      let msg: unknown
      try {
        msg = JSON.parse((data as Buffer).toString('utf8'))
      } catch {
        return closeConn(c, 1008, 'bad message')
      }
      if (!c.tokenHash) handleAuth(c, msg)
      else void handleCall(c, msg)
    })
    ws.on('error', () => ws.terminate())
    ws.on('close', () => {
      if (c.authTimer) clearTimeout(c.authTimer)
      conns.delete(c)
    })
  }

  const upgradeTimes: number[] = []
  /** Records one upgrade attempt; false when the window already holds UPGRADE_LIMIT of them. */
  const upgradeAllowed = (): boolean => {
    const t = now()
    while (upgradeTimes.length > 0 && t - (upgradeTimes[0] as number) >= UPGRADE_WINDOW_MS) upgradeTimes.shift()
    if (upgradeTimes.length >= UPGRADE_LIMIT) return false
    upgradeTimes.push(t)
    return true
  }

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const refuse = (code: number, text: string): void => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      socket.destroy()
    }
    socket.on('error', () => socket.destroy())
    // Before anything else: Host (stops DNS rebinding) and Origin (stops other web pages). A missing Origin is refused too.
    if (!hostOk(req)) return refuse(403, 'Forbidden')
    if (!originOk(req)) return refuse(403, 'Forbidden')
    if ((req.url ?? '').split('?')[0] !== WS_PATH) return refuse(404, 'Not Found')
    if (!upgradeAllowed()) return refuse(429, 'Too Many Requests')
    if (!wss || wss.clients.size >= MAX_SOCKETS) return refuse(503, 'Service Unavailable')
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws))
  }

  const sink = (channel: string, data: unknown): void => {
    for (const c of conns) {
      if (!c.tokenHash) continue
      if (c.ws.bufferedAmount > MAX_BUFFERED) {
        c.ws.terminate()
        continue
      }
      send(c.ws, { type: 'event', channel, data })
    }
  }

  const listenOn = (p: number): Promise<{ srv: Server; port: number }> =>
    new Promise((resolveP, reject) => {
      const srv = createServer((req, res) => {
        serveStatic(req, res).catch(() => {
          if (!res.headersSent) plain(res, 500, 'Internal Server Error')
          else res.end()
        })
      })
      srv.maxConnections = 64
      srv.headersTimeout = 10_000
      srv.requestTimeout = 15_000
      srv.on('upgrade', onUpgrade)
      srv.once('error', reject)
      srv.listen({ port: p, host: BRIDGE_HOST, exclusive: true }, () => {
        srv.off('error', reject)
        srv.on('error', () => undefined)
        resolveP({ srv, port: (srv.address() as AddressInfo).port })
      })
    })

  const start = async (): Promise<BridgeStatus> => {
    if (server) return status()
    lastError = undefined
    let bound: { srv: Server; port: number } | null = null
    for (const p of ports) {
      try {
        bound = await listenOn(p)
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
          lastError = 'err.bridgeStartFailed'
          throw new Error('err.bridgeStartFailed')
        }
      }
    }
    if (!bound) {
      lastError = 'err.bridgePortBusy'
      throw new Error('err.bridgePortBusy')
    }
    server = bound.srv
    port = bound.port
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false })
    pairing.newCode()
    removeSink = opts.broadcaster.addSink(sink)
    heartbeat = setInterval(() => {
      const gone = new Set(pairing.sweep())
      for (const c of conns) if (c.tokenHash !== null && gone.has(c.tokenHash)) closeConn(c, CLOSE_AUTH, 'session expired')
      for (const c of conns) {
        if (!c.alive) {
          c.ws.terminate()
          continue
        }
        c.alive = false
        c.ws.ping()
      }
    }, heartbeatMs)
    heartbeat.unref()
    return status()
  }

  const stop = async (): Promise<BridgeStatus> => {
    const srv = server
    if (!srv) return status()
    server = null
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    removeSink?.()
    removeSink = null
    pairing.revokeAll()
    for (const c of conns) {
      if (c.authTimer) clearTimeout(c.authTimer)
      c.ws.terminate()
    }
    conns.clear()
    wss?.close()
    wss = null
    await new Promise<void>((r) => {
      srv.close(() => r())
      srv.closeAllConnections()
    })
    port = null
    return status()
  }

  return {
    status,
    start,
    stop,
    port: () => port,
    newCode: () => {
      if (server) pairing.newCode()
      return status()
    },
    revokeAll: () => {
      pairing.revokeAll()
      for (const c of conns) closeConn(c, CLOSE_AUTH, 'revoked')
      return status()
    }
  }
}

/** Where the packaged app finds the web build, next to the main bundle (`out/main` -> `out/web`). */
export function defaultWebRoot(mainDir: string): string {
  return join(mainDir, '..', 'web')
}
