import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { IPC_CHANNELS } from '../../src/core/schemas'
import { classify } from '../../src/core/classify'
import type { HistoryEntry, RunEvent } from '../../src/core/types'
import { Broadcaster } from '../../src/main/broadcaster'
import { createBridge, type ChannelHandlers } from '../../src/main/bridge'
import { mkStep } from '../main/helpers'
import { createWebTransport, type TokenStore, type WebState, type WebTransport, type WsCtor, type WsLike } from '../../src/renderer/src/webTransport'

// The real browser client against the real server: only the socket class is swapped for `ws` (so the Origin header can be set).
let dir: string
const cleanup: Array<() => Promise<unknown> | void> = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sr-wt-'))
  await mkdir(join(dir, 'web'))
  await writeFile(join(dir, 'web', 'web.html'), 'x')
})
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  const s = {
    value: initial,
    get: () => s.value,
    set: (t: string) => void (s.value = t),
    clear: () => void (s.value = null)
  }
  return s
}

const ENTRY: HistoryEntry = {
  v: 2,
  id: 'ab12cd34ef56',
  ts: Date.UTC(2026, 10, 3, 12, 0, 0),
  task: 'Corrige le bug',
  classification: classify('corrige le bug'),
  pipeline: { pattern: 'single', steps: [mkStep('claude-code', 'single', 1, { id: 's1' })], explanation: [] },
  results: [{ stepId: 's1', ok: true, text: 'Fait.', durationMs: 1000, role: 'single', tool: 'claude-code' }],
  events: []
}

async function setup() {
  const sockets: WsLike[] = []
  const handlers = Object.fromEntries(
    IPC_CHANNELS.map((c) => [
      c,
      async (p: unknown) => (c === 'history:list' ? [ENTRY] : c === 'settings:get' ? { lang: 'en' } : c === 'tools:detect' ? [{ toolId: 'codex' }] : { channel: c, payload: p })
    ])
  ) as unknown as ChannelHandlers
  const broadcaster = new Broadcaster()
  const bridge = createBridge({ handlers, broadcaster, webRoot: join(dir, 'web'), ports: [0] })
  await bridge.start()
  cleanup.push(() => bridge.stop())
  const port = bridge.port() as number
  const Impl = class {
    constructor(_url: string) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` }) as unknown as WsLike
      sockets.push(ws)
      return ws
    }
  } as unknown as WsCtor
  const make = (store: TokenStore, extra: { download?: (n: string, t: string) => void } = {}): WebTransport => {
    const t = createWebTransport({ url: 'ws://ignored/ws', WebSocketImpl: Impl, tokenStore: store, backoffMs: [20], ...extra })
    cleanup.push(() => t.close())
    return t
  }
  return { bridge, broadcaster, port, make, sockets }
}

function waitFor(t: WebTransport, pred: (s: WebState) => boolean, ms = 4000): Promise<WebState> {
  if (pred(t.getState())) return Promise.resolve(t.getState())
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`state never reached: ${JSON.stringify(t.getState())}`)), ms)
    const off = t.subscribe((s) => {
      if (pred(s)) {
        clearTimeout(timer)
        off()
        res(s)
      }
    })
  })
}

describe('web transport against the real bridge', () => {
  it('pairs with the code, stores the token, calls channels and receives pushed events', async () => {
    const { bridge, broadcaster, make } = await setup()
    const store = memoryStore()
    const t = make(store)
    t.resume()
    expect((await waitFor(t, (s) => s.kind === 'needs-code')).kind).toBe('needs-code')
    t.pair(bridge.status().code as string)
    await waitFor(t, (s) => s.kind === 'ready')
    expect(store.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await t.invoke('tools:detect')).toEqual([{ toolId: 'codex' }])
    const got: unknown[] = []
    const off = t.on('run:event', (d) => void got.push(d))
    const ev: RunEvent = { type: 'step-start', runId: 'r1', stepId: 's1' }
    broadcaster.runEvent(ev)
    await new Promise((r) => setTimeout(r, 100))
    expect(got).toEqual([ev])
    off()
    broadcaster.runEvent(ev)
    await new Promise((r) => setTimeout(r, 100))
    expect(got).toHaveLength(1)
    // a channel outside the allowlist is an error with a translatable key
    await expect(t.invoke('folder:pick')).rejects.toThrow('err.channelDenied')
  })

  it('a wrong code gives a key and asks again; typing the code in lower case with a hyphen works', async () => {
    const { bridge, make } = await setup()
    const t = make(memoryStore())
    t.pair('ZZZZZZZZ')
    const s = await waitFor(t, (x) => x.kind === 'needs-code')
    expect(s).toEqual({ kind: 'needs-code', error: 'err.bridgeBadCode' })
    const code = bridge.status().code as string
    t.pair(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase())
    await waitFor(t, (x) => x.kind === 'ready')
  })

  it('after a reload the token in the store resumes the session without a code', async () => {
    const { bridge, make } = await setup()
    const store = memoryStore()
    const first = make(store)
    first.pair(bridge.status().code as string)
    await waitFor(first, (s) => s.kind === 'ready')
    first.close()
    const second = make(store)
    second.resume()
    await waitFor(second, (s) => s.kind === 'ready')
    expect(await second.invoke('tools:detect')).toEqual([{ toolId: 'codex' }])
  })

  it('Revoke all: pending calls fail, the app reconnects once, then asks for a new code with the expiry message and forgets the token', async () => {
    const { bridge, make } = await setup()
    const store = memoryStore()
    const t = make(store)
    t.pair(bridge.status().code as string)
    await waitFor(t, (s) => s.kind === 'ready')
    bridge.revokeAll()
    const s = await waitFor(t, (x) => x.kind === 'needs-code')
    expect(s).toEqual({ kind: 'needs-code', error: 'err.sessionExpired' })
    expect(store.value).toBeNull()
    await expect(t.invoke('tools:detect')).rejects.toThrow('err.connectionLost')
  })

  it('reconnects with the token when the socket drops but the session lives', async () => {
    const { bridge, make, sockets } = await setup()
    const t = make(memoryStore())
    t.pair(bridge.status().code as string)
    await waitFor(t, (s) => s.kind === 'ready')
    const pendingBefore = t.invoke('tools:detect')
    await pendingBefore
    ;(sockets[0] as unknown as WebSocket).terminate()
    const mid = await waitFor(t, (s) => s.kind === 'reconnecting')
    expect(mid).toEqual({ kind: 'reconnecting', wasReady: true })
    await expect(t.invoke('tools:detect')).rejects.toThrow('err.connectionLost')
    await waitFor(t, (s) => s.kind === 'ready')
    expect(sockets).toHaveLength(2)
    expect(await t.invoke('tools:detect')).toEqual([{ toolId: 'codex' }])
    expect(bridge.status().sessions).toBe(1)
  })

  it('history:export is saved by the browser (download callback) and reports saved', async () => {
    const { bridge, make } = await setup()
    const saved: Array<{ name: string; text: string }> = []
    const t = make(memoryStore(), { download: (name, text) => void saved.push({ name, text }) })
    t.pair(bridge.status().code as string)
    await waitFor(t, (s) => s.kind === 'ready')
    const r = (await t.invoke('history:export', { id: ENTRY.id })) as { saved: boolean; name: string }
    expect(r.saved).toBe(true)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe(r.name)
    expect(saved[0]!.name).toMatch(/\.md$/)
    expect(saved[0]!.text).toContain('Corrige le bug')
    await expect(t.invoke('history:export', { id: 'unknown1' })).rejects.toThrow('err.notFound')
  })

  it('the app not running: the stored token keeps the page in « reconnecting » rather than losing the session', async () => {
    const store = memoryStore('some-token')
    const Dead = class {
      constructor() {
        return new WebSocket('ws://127.0.0.1:1/ws', { origin: 'http://127.0.0.1:1' }) as unknown as WsLike
      }
    } as unknown as WsCtor
    const t = createWebTransport({ url: 'ws://x/ws', WebSocketImpl: Dead, tokenStore: store, backoffMs: [20] })
    cleanup.push(() => t.close())
    t.resume()
    await waitFor(t, (s) => s.kind === 'reconnecting')
    await new Promise((r) => setTimeout(r, 150))
    expect(t.getState().kind).toBe('reconnecting')
    expect(store.value).toBe('some-token')
    t.forget()
    expect(t.getState()).toEqual({ kind: 'needs-code', error: null })
    expect(store.value).toBeNull()
  })
})
