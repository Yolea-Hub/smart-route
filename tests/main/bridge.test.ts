import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { IPC_CHANNEL_NAMES, WEB_ALLOWED_CHANNELS } from '../../src/core/channels'
import { IPC_CHANNELS, type IpcChannel } from '../../src/core/schemas'
import type { HistoryEntry, Pipeline, RunEvent, Settings } from '../../src/core/types'
import { classify } from '../../src/core/classify'
import { Broadcaster } from '../../src/main/broadcaster'
import { AUTH_TIMEOUT_MS, CLOSE_AUTH, HEARTBEAT_MS, MAX_PAYLOAD, MAX_SOCKETS, UPGRADE_LIMIT, UPGRADE_WINDOW_MS, WEB_CSP, createBridge, type ChannelHandlers } from '../../src/main/bridge'
import { createIpcHandlers } from '../../src/main/ipc'
import { RATE_WINDOW_MS } from '../../src/main/pairing'
import { Store } from '../../src/main/store'
import { detectTools } from '../../src/main/detect'
import { BIN, mkStep, sleep } from './helpers'

// ---- helpers ----
type Msg = Record<string, unknown>

class Client {
  readonly msgs: Msg[] = []
  private waiters: Array<(m: Msg) => void> = []
  closed: { code: number } | null = null
  private closeWaiters: Array<(c: { code: number }) => void> = []
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as Msg
      const w = this.waiters.shift()
      if (w) w(m)
      else this.msgs.push(m)
    })
    ws.on('close', (code) => {
      this.closed = { code }
      for (const w of this.closeWaiters.splice(0)) w(this.closed)
    })
    ws.on('error', () => undefined)
  }
  send(o: unknown): void {
    this.ws.send(JSON.stringify(o))
  }
  next(ms = 3000): Promise<Msg> {
    const q = this.msgs.shift()
    if (q) return Promise.resolve(q)
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no message')), ms)
      this.waiters.push((m) => {
        clearTimeout(t)
        res(m)
      })
    })
  }
  waitClose(ms = 3000): Promise<{ code: number }> {
    if (this.closed) return Promise.resolve(this.closed)
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('still open')), ms)
      this.closeWaiters.push((c) => {
        clearTimeout(t)
        res(c)
      })
    })
  }
  private id = 1
  async call(channel: string, payload?: unknown): Promise<Msg> {
    const id = this.id++
    this.send({ type: 'call', id, channel, payload: payload ?? null })
    for (;;) {
      const m = await this.next()
      if (m['type'] === 'result' && m['id'] === id) return m
      this.msgs.push(m) // an event: keep it for the test
      await sleep(5)
    }
  }
}

type Opened = { client: Client } | { status: number }

function tryOpen(port: number, origin: string | null | undefined): Promise<Opened> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin === null ? {} : { origin: origin ?? `http://127.0.0.1:${port}` })
    ws.once('open', () => resolve({ client: new Client(ws) }))
    ws.once('unexpected-response', (_req, res) => {
      res.resume()
      resolve({ status: res.statusCode ?? 0 })
    })
    ws.once('error', () => resolve({ status: 0 }))
  })
}
async function open(port: number): Promise<Client> {
  const r = await tryOpen(port, undefined)
  if (!('client' in r)) throw new Error(`refused ${r.status}`)
  return r.client
}

/** Raw HTTP over a TCP socket: nothing normalises the request line or the headers. */
function raw(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = createConnection({ host: '127.0.0.1', port }, () => s.write(request))
    let out = ''
    s.on('data', (d) => (out += d.toString('utf8')))
    s.on('close', () => resolve(out))
    s.on('error', reject)
    setTimeout(() => {
      s.destroy()
      resolve(out)
    }, 1500)
  })
}

function wsUpgrade(port: number, host: string, origin: string | null): string {
  return (
    `GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n` +
    (origin ? `Origin: ${origin}\r\n` : '') +
    '\r\n'
  )
}

const SETTINGS: Settings = {
  v: 2,
  lang: 'fr',
  allowEdits: false,
  auto: false,
  useClaudeConfig: false,
  codexModels: { '0': 'm', '1': 'm', '2': 'm', '3': 'm' },
  dailyCap: 30,
  timeoutSec: 900,
  webSignedIn: { anthropic: false, openai: false, google: false },
  role: 'none',
  roleAsked: false
}

function stubHandlers(over: Partial<Record<IpcChannel, (p: unknown) => Promise<unknown>>> = {}) {
  const calls: Array<{ channel: string; payload: unknown }> = []
  const handlers = Object.fromEntries(
    IPC_CHANNELS.map((c) => [
      c,
      async (p: unknown) => {
        calls.push({ channel: c, payload: p })
        return over[c] ? over[c]!(p) : { channel: c }
      }
    ])
  ) as unknown as ChannelHandlers
  return { handlers, calls }
}

let dir: string
let webRoot: string
let clockMs: number
const stops: Array<() => Promise<unknown>> = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sr-bridge-'))
  webRoot = join(dir, 'web')
  await mkdir(join(webRoot, 'assets'), { recursive: true })
  await writeFile(join(webRoot, 'web.html'), '<!doctype html><title>Smart Route</title>')
  await writeFile(join(webRoot, 'assets', 'a.js'), 'console.log(1)')
  await writeFile(join(dir, 'secret.txt'), 'TOP-SECRET')
  clockMs = 1_000_000
})
afterEach(async () => {
  for (const s of stops.splice(0)) await s()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function boot(over: Partial<Parameters<typeof createBridge>[0]> = {}, handlerOver: Parameters<typeof stubHandlers>[0] = {}) {
  const stub = stubHandlers(handlerOver)
  const broadcaster = new Broadcaster()
  const bridge = createBridge({ handlers: stub.handlers, broadcaster, webRoot, ports: [0], now: () => clockMs, authTimeoutMs: 3000, ...over })
  await bridge.start()
  stops.push(() => bridge.stop())
  const port = bridge.port() as number
  /** Opens a socket and pairs it with the current code; returns the client and its token. */
  const pair = async (): Promise<{ client: Client; token: string }> => {
    const client = await open(port)
    client.send({ type: 'auth', code: bridge.status().code })
    const m = await client.next()
    if (m['ok'] !== true) throw new Error(`pairing failed: ${JSON.stringify(m)}`)
    bridge.newCode()
    return { client, token: m['token'] as string }
  }
  return { bridge, port, broadcaster, ...stub, pair }
}

// ---- tests ----
describe('constants of the plan', () => {
  it('uses the documented limits', () => {
    expect(AUTH_TIMEOUT_MS).toBe(5000)
    expect(HEARTBEAT_MS).toBe(30_000)
    expect(MAX_PAYLOAD).toBe(1024 * 1024)
    expect(MAX_SOCKETS).toBe(8)
    expect(UPGRADE_LIMIT).toBe(20)
    expect(WEB_CSP).toContain("default-src 'self'")
    expect(WEB_CSP).toContain('connect-src ws://127.0.0.1:*')
    expect(WEB_CSP).toContain("img-src 'self' data:")
    expect(WEB_CSP).toContain("font-src 'self'")
  })

  it('the allowlist is exactly the planned one, and every channel of the app is classified', () => {
    expect([...WEB_ALLOWED_CHANNELS].sort()).toEqual(
      ['tools:detect', 'accounts:status', 'task:analyse', 'run:start', 'run:cancel', 'run:confirm', 'run:retryStep', 'run:handoffResult', 'history:list', 'history:rate', 'settings:get', 'settings:set', 'folder:list', 'history:export'].sort()
    )
    expect([...IPC_CHANNEL_NAMES].sort()).toEqual([...IPC_CHANNELS].sort())
    for (const c of WEB_ALLOWED_CHANNELS) expect(IPC_CHANNELS).toContain(c)
  })

  it('binds 127.0.0.1 only', async () => {
    const { bridge } = await boot()
    expect(bridge.status()).toMatchObject({ enabled: true, url: `http://127.0.0.1:${bridge.port()}` })
  })
})

describe('upgrade gate', () => {
  it('refuses a foreign Origin', async () => {
    const { port } = await boot()
    expect(await tryOpen(port, 'http://evil.example')).toEqual({ status: 403 })
    expect(await tryOpen(port, 'http://localhost:' + port)).toEqual({ status: 403 })
    expect(await tryOpen(port, 'https://127.0.0.1:' + port)).toEqual({ status: 403 })
    expect(await tryOpen(port, 'http://127.0.0.1:1')).toEqual({ status: 403 })
  })

  it('refuses a missing Origin', async () => {
    const { port } = await boot()
    expect(await tryOpen(port, null)).toEqual({ status: 403 })
  })

  it('refuses a forged Host (raw upgrade request), even with the right Origin', async () => {
    const { port } = await boot()
    for (const host of ['evil.example', `localhost:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `evil.example:${port}`]) {
      const out = await raw(port, wsUpgrade(port, host, `http://127.0.0.1:${port}`))
      expect(out.startsWith('HTTP/1.1 403'), `${host}: ${out.slice(0, 40)}`).toBe(true)
    }
    const ok = await raw(port, wsUpgrade(port, `127.0.0.1:${port}`, `http://127.0.0.1:${port}`))
    expect(ok.startsWith('HTTP/1.1 101')).toBe(true)
  })

  it('only the /ws path upgrades', async () => {
    const { port } = await boot()
    const out = await raw(port, wsUpgrade(port, `127.0.0.1:${port}`, `http://127.0.0.1:${port}`).replace('GET /ws', 'GET /other'))
    expect(out.startsWith('HTTP/1.1 404')).toBe(true)
  })

  it('refuses the socket after MAX_SOCKETS', async () => {
    const { port } = await boot()
    const open4: Client[] = []
    for (let i = 0; i < MAX_SOCKETS; i++) open4.push(await open(port))
    expect(await tryOpen(port, undefined)).toEqual({ status: 503 })
    open4[0]!.ws.close()
    await open4[0]!.waitClose()
    await sleep(50)
    const again = await tryOpen(port, undefined)
    expect('client' in again).toBe(true)
  })
})

describe('upgrade rate limit', () => {
  it('answers 429 after UPGRADE_LIMIT upgrades in a window, then accepts again once the window has passed', async () => {
    const { port } = await boot()
    for (let i = 0; i < UPGRADE_LIMIT; i++) {
      const c = await open(port)
      c.ws.close()
      await c.waitClose()
    }
    expect(await tryOpen(port, undefined)).toEqual({ status: 429 })
    clockMs += UPGRADE_WINDOW_MS
    expect('client' in (await tryOpen(port, undefined))).toBe(true)
  })

  it('a refused host or origin does not use up the budget', async () => {
    const { port } = await boot()
    for (let i = 0; i < UPGRADE_LIMIT + 5; i++) {
      const out = await raw(port, wsUpgrade(port, `127.0.0.1:${port}`, 'http://evil.example'))
      expect(out.startsWith('HTTP/1.1 403')).toBe(true)
    }
    expect('client' in (await tryOpen(port, undefined))).toBe(true)
  })
})

describe('authentication', () => {
  it('closes a socket that sends no auth within the delay (default 5 s)', async () => {
    const stub = stubHandlers()
    const bridge = createBridge({ handlers: stub.handlers, broadcaster: new Broadcaster(), webRoot, ports: [0] })
    await bridge.start()
    stops.push(() => bridge.stop())
    const c = await open(bridge.port() as number)
    const t0 = Date.now()
    const closed = await c.waitClose(7000)
    const dt = Date.now() - t0
    expect(closed.code).toBe(CLOSE_AUTH)
    expect(dt).toBeGreaterThanOrEqual(4800)
    expect(dt).toBeLessThan(6500)
  })

  it('closes a socket whose first message is not an auth, and refuses calls before auth', async () => {
    const { port, calls } = await boot()
    const c = await open(port)
    c.send({ type: 'call', id: 1, channel: 'settings:get', payload: null })
    expect((await c.waitClose()).code).toBe(1008)
    expect(calls).toHaveLength(0)
  })

  it('refuses binary frames and invalid JSON', async () => {
    const { port } = await boot()
    const a = await open(port)
    a.ws.send(Buffer.from([1, 2, 3]))
    expect((await a.waitClose()).code).toBe(1003)
    const b = await open(port)
    b.ws.send('{not json')
    expect((await b.waitClose()).code).toBe(1008)
  })

  it('wrong code: refused with a key, socket closed; the right code still works afterwards', async () => {
    const { port, bridge } = await boot()
    const c = await open(port)
    c.send({ type: 'auth', code: 'ZZZZZZZZ' === bridge.status().code ? 'YYYYYYYY' : 'ZZZZZZZZ' })
    expect(await c.next()).toEqual({ type: 'auth', ok: false, error: 'err.bridgeBadCode' })
    expect((await c.waitClose()).code).toBe(CLOSE_AUTH)
    const d = await open(port)
    d.send({ type: 'auth', code: bridge.status().code })
    const m = await d.next()
    expect(m['ok']).toBe(true)
    expect(typeof m['token']).toBe('string')
    expect(Buffer.from(m['token'] as string, 'base64url')).toHaveLength(32)
  })

  it('ten wrong codes cancel the code (clock moved so the rate limit does not interfere)', async () => {
    const { port, bridge } = await boot()
    const good = bridge.status().code as string
    for (let i = 0; i < 10; i++) {
      const c = await open(port)
      c.send({ type: 'auth', code: i % 2 ? 'ZZZZZZZZ' : 'YYYYYYYY' })
      expect((await c.next())['error']).toBe('err.bridgeBadCode')
      if (i % 5 === 4) clockMs += RATE_WINDOW_MS
    }
    clockMs += RATE_WINDOW_MS
    expect(bridge.status().code).toBeNull()
    const c = await open(port)
    c.send({ type: 'auth', code: good })
    expect(await c.next()).toEqual({ type: 'auth', ok: false, error: 'err.bridgeCodeExpired' })
    // a fresh code from the desktop works again
    bridge.newCode()
    const d = await open(port)
    d.send({ type: 'auth', code: bridge.status().code })
    expect((await d.next())['ok']).toBe(true)
  })

  it('an expired code is refused', async () => {
    const { port, bridge } = await boot()
    const code = bridge.status().code
    clockMs += 5 * 60_000 + 1
    const c = await open(port)
    c.send({ type: 'auth', code })
    expect(await c.next()).toEqual({ type: 'auth', ok: false, error: 'err.bridgeCodeExpired' })
  })

  it('rate limit: 5 attempts a minute, the 6th is refused even with the right code', async () => {
    const { port, bridge } = await boot()
    for (let i = 0; i < 5; i++) {
      const c = await open(port)
      c.send({ type: 'auth', code: 'ZZZZZZZZ' === bridge.status().code ? 'YYYYYYYY' : 'ZZZZZZZZ' })
      expect((await c.next())['error']).toBe('err.bridgeBadCode')
    }
    const c = await open(port)
    c.send({ type: 'auth', code: bridge.status().code })
    expect(await c.next()).toEqual({ type: 'auth', ok: false, error: 'err.bridgeRateLimited' })
    clockMs += RATE_WINDOW_MS
    const d = await open(port)
    d.send({ type: 'auth', code: bridge.status().code })
    expect((await d.next())['ok']).toBe(true)
  })

  it('the token reconnects a browser; a code is used once', async () => {
    const { port, pair, bridge } = await boot()
    const { client, token } = await pair()
    client.ws.close()
    await client.waitClose()
    const again = await open(port)
    again.send({ type: 'auth', token })
    expect(await again.next()).toEqual({ type: 'auth', ok: true })
    const bad = await open(port)
    bad.send({ type: 'auth', token: token + 'A' })
    expect(await bad.next()).toEqual({ type: 'auth', ok: false, error: 'err.sessionExpired' })
    expect(bridge.status().sessions).toBe(1)
  })

  it('a session idle for 12 h is refused', async () => {
    const { port, pair } = await boot()
    const { token } = await pair()
    clockMs += 12 * 3_600_000 + 1
    const c = await open(port)
    c.send({ type: 'auth', token })
    expect(await c.next()).toEqual({ type: 'auth', ok: false, error: 'err.sessionExpired' })
  })

  it('an auth message with both a code and a token, or neither, closes the socket', async () => {
    const { port } = await boot()
    const a = await open(port)
    a.send({ type: 'auth', code: 'AAAAAAAA', token: 'x' })
    expect((await a.waitClose()).code).toBe(1008)
    const b = await open(port)
    b.send({ type: 'auth' })
    expect((await b.waitClose()).code).toBe(1008)
  })
})

describe('calls', () => {
  it('after a valid pairing the allowed calls work', async () => {
    const { pair, calls } = await boot({}, { 'settings:get': async () => SETTINGS, 'folder:list': async () => [{ id: 'ab', label: 'proj' }] })
    const { client } = await pair()
    const s = await client.call('settings:get')
    expect(s).toMatchObject({ type: 'result', ok: true, data: { lang: 'fr' } })
    expect(await client.call('folder:list')).toMatchObject({ ok: true, data: [{ id: 'ab', label: 'proj' }] })
    expect(await client.call('history:rate', { id: 'abc', rating: 1 })).toMatchObject({ ok: true })
    expect(calls.map((c) => c.channel)).toEqual(['settings:get', 'folder:list', 'history:rate'])
  })

  it('every channel outside the allowlist is refused and never reaches a handler', async () => {
    const { pair, calls } = await boot()
    const { client } = await pair()
    const denied = IPC_CHANNEL_NAMES.filter((c) => !(WEB_ALLOWED_CHANNELS as readonly string[]).includes(c))
    expect(denied).toEqual(expect.arrayContaining(['web:show', 'web:hide', 'web:insertBrief', 'web:captureSelection', 'web:markSignedIn', 'link:open', 'folder:pick', 'folder:open', 'accounts:connect', 'accounts:disconnect', 'history:clear', 'bridge:status', 'bridge:enable', 'bridge:newCode', 'bridge:revoke']))
    for (const ch of [...denied, 'nope:nothing', '__proto__', 'constructor']) {
      expect(await client.call(ch, { vendor: 'anthropic', enabled: true }), ch).toMatchObject({ ok: false, error: 'err.channelDenied' })
    }
    expect(calls).toHaveLength(0)
  })

  it('invalid payloads are refused with err.invalidInput', async () => {
    const { pair, calls } = await boot()
    const { client } = await pair()
    expect(await client.call('run:cancel', { runId: '../../etc' })).toMatchObject({ ok: false, error: 'err.invalidInput' })
    expect(await client.call('task:analyse', { text: '' })).toMatchObject({ ok: false, error: 'err.invalidInput' })
    expect(calls).toHaveLength(0)
  })

  it('internal errors never leak: only err.* keys go out', async () => {
    const { pair } = await boot({}, { 'tools:detect': async () => { throw new Error('ENOENT /home/someone/secret') }, 'accounts:status': async () => { throw new Error('err.cannotRetry') } })
    const { client } = await pair()
    expect(await client.call('tools:detect')).toMatchObject({ ok: false, error: 'err.generic' })
    expect(await client.call('accounts:status')).toMatchObject({ ok: false, error: 'err.cannotRetry' })
  })

  it('settings:set accepts a { lang } patch only', async () => {
    const { pair, calls } = await boot({}, { 'settings:set': async (p) => ({ ...SETTINGS, ...(p as object) }) })
    const { client } = await pair()
    expect(await client.call('settings:set', { lang: 'en' })).toMatchObject({ ok: true, data: { lang: 'en' } })
    expect(calls.at(-1)).toEqual({ channel: 'settings:set', payload: { lang: 'en' } })
    const n = calls.length
    for (const bad of [{ allowEdits: true }, { lang: 'en', allowEdits: true }, { lang: 'en', auto: true }, { dailyCap: 5 }, {}, { lang: 'de' }, { codexModels: { '0': 'x', '1': 'x', '2': 'x', '3': 'x' } }, null]) {
      expect(await client.call('settings:set', bad), JSON.stringify(bad)).toMatchObject({ ok: false, error: 'err.invalidInput' })
    }
    expect(calls).toHaveLength(n)
  })

  it('history:export returns the text for the browser to download and never calls the desktop save dialog', async () => {
    const entry: HistoryEntry = {
      v: 2,
      id: 'ab12cd34ef56',
      ts: Date.UTC(2026, 10, 3, 12, 0, 0),
      task: 'Corrige le bug',
      classification: classify('corrige le bug'),
      pipeline: { pattern: 'single', steps: [mkStep('claude-code', 'single', 1, { id: 's1' })], explanation: [] },
      results: [{ stepId: 's1', ok: true, text: 'Fait.', durationMs: 1000, role: 'single', tool: 'claude-code' }],
      events: []
    }
    const { pair, calls } = await boot({}, { 'history:list': async () => [entry], 'settings:get': async () => SETTINGS })
    const { client } = await pair()
    const r = await client.call('history:export', { id: 'ab12cd34ef56' })
    expect(r).toMatchObject({ ok: true })
    const data = r['data'] as { name: string; text: string }
    expect(data.name).toMatch(/\.md$/)
    expect(data.text).toContain('Corrige le bug')
    expect(calls.some((c) => c.channel === 'history:export')).toBe(false)
    expect(await client.call('history:export', { id: 'unknown1' })).toMatchObject({ ok: false, error: 'err.notFound' })
  })

  it('a payload over 1 MB closes the socket (1009)', async () => {
    const { pair } = await boot()
    const { client } = await pair()
    client.ws.send('x'.repeat(MAX_PAYLOAD + 1))
    // Windows and macOS loopback may reset the TCP connection before the 1009 close frame is read (reported as 1006).
    const { code } = await client.waitClose()
    expect(process.platform !== 'linux' ? [1009, 1006] : [1009]).toContain(code)
  })

  it('a message just under the limit is still served', async () => {
    const { pair } = await boot({}, { 'run:handoffResult': async () => ({ ok: true }) })
    const { client } = await pair()
    const r = await client.call('run:handoffResult', { runId: 'r1', stepId: 's1', text: 'y'.repeat(990_000) })
    expect(r).toMatchObject({ ok: true })
  })

  it('sends a ping on the heartbeat', async () => {
    const { port } = await boot({ heartbeatMs: 60 })
    const c = await open(port)
    const pinged = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 2000)
      c.ws.once('ping', () => {
        clearTimeout(t)
        res(true)
      })
    })
    expect(pinged).toBe(true)
  })
})

describe('revoking', () => {
  it('Revoke all closes every socket, forgets the tokens and the code', async () => {
    const { bridge, port, pair } = await boot()
    const a = await pair()
    const b = await pair()
    const waiting = await open(port) // not paired yet
    expect(bridge.status().sessions).toBe(2)
    bridge.revokeAll()
    expect((await a.client.waitClose()).code).toBe(CLOSE_AUTH)
    expect((await b.client.waitClose()).code).toBe(CLOSE_AUTH)
    expect((await waiting.waitClose()).code).toBe(CLOSE_AUTH)
    expect(bridge.status()).toMatchObject({ sessions: 0, code: null })
    const c = await open(port)
    c.send({ type: 'auth', token: a.token })
    expect(await c.next()).toEqual({ type: 'auth', ok: false, error: 'err.sessionExpired' })
  })

  it('a call on a revoked session is refused and the socket closed', async () => {
    const { bridge, pair } = await boot()
    const a = await pair()
    clockMs += 12 * 3_600_000 + 1 // the session goes stale between two calls
    expect(await a.client.call('settings:get')).toMatchObject({ ok: false, error: 'err.sessionExpired' })
    expect((await a.client.waitClose()).code).toBe(CLOSE_AUTH)
    expect(bridge.status().sessions).toBe(0)
  })

  it('stopping the bridge closes sockets and frees the port', async () => {
    const { bridge, port, pair } = await boot()
    const a = await pair()
    await bridge.stop()
    await a.client.waitClose()
    expect(bridge.status()).toMatchObject({ enabled: false, url: null, code: null, sessions: 0 })
    expect(await tryOpen(port, undefined)).toEqual({ status: 0 })
  })
})

describe('broadcaster fan-out', () => {
  it('run:event and accounts:update reach authenticated sockets only', async () => {
    const { broadcaster, pair, port } = await boot()
    const a = await pair()
    const b = await pair()
    const anon = await open(port)
    const ev: RunEvent = { type: 'step-start', runId: 'r1', stepId: 's1' }
    broadcaster.runEvent(ev)
    broadcaster.accountUpdate({ vendor: 'anthropic', cli: { state: 'connected' } })
    for (const c of [a.client, b.client]) {
      expect(await c.next()).toEqual({ type: 'event', channel: 'run:event', data: ev })
      expect(await c.next()).toEqual({ type: 'event', channel: 'accounts:update', data: { vendor: 'anthropic', cli: { state: 'connected' } } })
    }
    await sleep(100)
    expect(anon.msgs).toHaveLength(0)
  })

  it('a failing sink does not stop the others', () => {
    const b = new Broadcaster()
    const got: string[] = []
    b.addSink(() => {
      throw new Error('boom')
    })
    const off = b.addSink((c) => void got.push(c))
    b.runEvent({ type: 'step-start', runId: 'r', stepId: 's' })
    off()
    b.runEvent({ type: 'step-start', runId: 'r', stepId: 's' })
    expect(got).toEqual(['run:event'])
  })
})

describe('static files', () => {
  it('serves the page with the CSP, only on GET and only with the right Host', async () => {
    const { port } = await boot()
    const get = (path: string, host = `127.0.0.1:${port}`, method = 'GET') => raw(port, `${method} ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
    const page = await get('/')
    expect(page.startsWith('HTTP/1.1 200')).toBe(true)
    expect(page).toContain('<title>Smart Route</title>')
    expect(page.toLowerCase()).toContain(`content-security-policy: ${WEB_CSP.toLowerCase()}`)
    expect(page.toLowerCase()).toContain('x-content-type-options: nosniff')
    expect((await get('/assets/a.js')).toLowerCase()).toContain('text/javascript')
    expect((await get('/?x=1')).startsWith('HTTP/1.1 200')).toBe(true)

    // wrong Host (DNS rebinding) is refused for static files too
    for (const host of ['evil.example', `localhost:${port}`, '127.0.0.1']) {
      const out = await get('/', host)
      expect(out.startsWith('HTTP/1.1 403'), host).toBe(true)
      expect(out).not.toContain('Smart Route')
    }
    // only GET
    for (const m of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']) expect((await get('/', undefined, m)).startsWith('HTTP/1.1 405'), m).toBe(true)
  })

  it('refuses path traversal in every spelling', async () => {
    const { port } = await boot()
    const paths = ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/assets/../../secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/..\\secret.txt', '/%5c..%5csecret.txt', '/assets/..%2f..%2fsecret.txt', '//etc/passwd', '/a%00.js', '/%2e%2e/%2e%2e/etc/passwd', '/assets/../web.html']
    for (const p of paths) {
      const out = await raw(port, `GET ${p} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)
      expect(out, p).not.toContain('TOP-SECRET')
      expect(out, p).not.toContain('root:')
      expect(/^HTTP\/1\.1 (400|404)/.test(out), `${p}: ${out.slice(0, 30)}`).toBe(true)
    }
  })

  it('a symbolic link inside the web folder cannot lead out of it', async () => {
    await symlink(join(dir, 'secret.txt'), join(webRoot, 'assets', 'link.txt'))
    const { port } = await boot()
    const out = await raw(port, `GET /assets/link.txt HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)
    expect(out).not.toContain('TOP-SECRET')
    expect(out.startsWith('HTTP/1.1 404')).toBe(true)
  })

  it('a directory and a missing file are 404', async () => {
    const { port } = await boot()
    for (const p of ['/assets', '/assets/', '/missing.js']) {
      const out = await raw(port, `GET ${p} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)
      expect(out.startsWith('HTTP/1.1 404'), p).toBe(true)
    }
  })
})

describe('port fallback', () => {
  it('moves to the next port when the first is taken, and reports a busy range', async () => {
    const first = await boot()
    const taken = first.port
    const stub = stubHandlers()
    const second = createBridge({ handlers: stub.handlers, broadcaster: new Broadcaster(), webRoot, ports: [taken, 0] })
    await second.start()
    stops.push(() => second.stop())
    expect(second.port()).not.toBe(taken)
    const third = createBridge({ handlers: stub.handlers, broadcaster: new Broadcaster(), webRoot, ports: [taken] })
    await expect(third.start()).rejects.toThrow('err.bridgePortBusy')
    expect(third.status()).toMatchObject({ enabled: false, error: 'err.bridgePortBusy' })
  })
})

describe('browser runs are read-only (real handlers)', () => {
  it('canEdit is false in the plan and in the run-start event even when Settings allow edits and the page asks for edits', async () => {
    const env = { PATH: `${BIN}:${process.env.PATH}`, HOME: dir, NO_COLOR: '1', FAKE_AUTH: 'in' }
    const events: RunEvent[] = []
    const ctx = {
      store: new Store(join(dir, 'ud')),
      env,
      workRoot: join(dir, 'work'),
      pickFolder: async () => dir,
      openExternal: () => undefined,
      web: { show() {}, hide() {}, insertBrief: async () => undefined, captureSelection: async () => '', isVisible: () => true },
      sendRunEvent: (e: RunEvent) => void events.push(e),
      sendAccountUpdate: () => undefined,
      detect: () => detectTools({ pathEnv: BIN, home: dir, env }),
      runnerOverrides: { killGraceMs: 300 }
    }
    const ipc = createIpcHandlers(ctx)
    await ipc.handlers['settings:set']({ allowEdits: true })
    // the desktop itself would plan edits...
    const direct = (await ipc.handlers['task:analyse']({ text: 'corrige le bug dans calc.py' })) as { pipeline: Pipeline }
    expect(direct.pipeline.steps.some((s) => s.canEdit)).toBe(true)

    const { pair } = await boot({ handlers: ipc.handlers as unknown as ChannelHandlers })
    const { client } = await pair()
    const planned = await client.call('task:analyse', { text: 'corrige le bug dans calc.py' })
    const { pipeline, classification } = planned['data'] as { pipeline: Pipeline; classification: unknown }
    expect(pipeline.steps.length).toBeGreaterThan(1)
    expect(pipeline.steps.every((s) => s.canEdit === false)).toBe(true)

    // ... and a tampered page asks for edits anyway
    const tampered = structuredClone(pipeline)
    for (const s of tampered.steps) s.canEdit = true
    const started = await client.call('run:start', { pipeline: tampered, text: 'corrige le bug dans calc.py', folderId: null, classification })
    expect(started).toMatchObject({ ok: true })
    const runStart = events.find((e) => e.type === 'run-start') as Extract<RunEvent, { type: 'run-start' }>
    expect(runStart.pipeline.steps.length).toBeGreaterThan(1)
    expect(runStart.pipeline.steps.every((s) => s.canEdit === false)).toBe(true)
    await client.call('run:cancel', { runId: started['data'] })
    await ipc.whenIdle()
  })
})
