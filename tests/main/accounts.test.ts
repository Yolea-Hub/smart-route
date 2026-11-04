import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildTerminalCommands,
  checkCliStatus,
  connectCli,
  disconnectCli,
  getAccountsStatus,
  pollUntilConnected,
  resetLastConnected,
  STATUS_TIMEOUT_MS
} from '../../src/main/accounts'
import type { CliAccountStatus } from '../../src/core/types'
import { FAKE_PATHS, IS_WIN } from './helpers'

const env = (auth: 'in' | 'out'): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, FAKE_AUTH: auth })

describe('checkCliStatus: unknown state and last-known-good', () => {
  const netFail = async (): Promise<{ stdout: string; stderr: string; code: number | null }> => ({
    stdout: '',
    stderr: 'Post https://daily-cloudcode-pa.googleapis.com/x: EOF',
    code: 1
  })
  const ok = async (): Promise<{ stdout: string; stderr: string; code: number | null }> => ({
    stdout: 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n',
    stderr: '',
    code: 0
  })

  it('a network failure is unknown, not disconnected; carries lastConnectedAt after a good check', async () => {
    resetLastConnected()
    const base = { toolPaths: { agy: '/bin/agy' }, env: {} }
    const first = await checkCliStatus('google', { ...base, exec: netFail })
    expect(first).toEqual({ state: 'unknown' })
    expect((await checkCliStatus('google', { ...base, exec: ok })).state).toBe('connected')
    const again = await checkCliStatus('google', { ...base, exec: netFail })
    expect(again.state).toBe('unknown')
    expect(typeof again.lastConnectedAt).toBe('number')
  })

  it('an explicit sign-in answer stays disconnected', async () => {
    const r = await checkCliStatus('google', {
      toolPaths: { agy: '/bin/agy' },
      env: {},
      exec: async () => ({ stdout: '', stderr: 'Please sign in to continue', code: 1 })
    })
    expect(r.state).toBe('disconnected')
  })

  it('uses 30 s for agy and 15 s for the other CLIs', async () => {
    const seen: number[] = []
    const exec = async (_f: string, _a: string[], _e: NodeJS.ProcessEnv, ms: number) => {
      seen.push(ms)
      return { stdout: '', stderr: '', code: 1 as number | null }
    }
    const toolPaths = { agy: '/bin/agy', codex: '/bin/codex', 'claude-code': '/bin/claude' }
    await checkCliStatus('google', { toolPaths, env: {}, exec })
    await checkCliStatus('openai', { toolPaths, env: {}, exec })
    await checkCliStatus('anthropic', { toolPaths, env: {}, exec })
    expect(seen).toEqual([30_000, 15_000, 15_000])
    expect(STATUS_TIMEOUT_MS.agy).toBe(30_000)
  })
})

describe('checkCliStatus with fake CLIs', () => {
  it('logged in', async () => {
    expect(await checkCliStatus('anthropic', { toolPaths: FAKE_PATHS, env: env('in') })).toEqual({ state: 'connected', method: 'claude.ai' })
    expect(await checkCliStatus('openai', { toolPaths: FAKE_PATHS, env: env('in') })).toEqual({ state: 'connected', method: 'ChatGPT' })
    expect((await checkCliStatus('google', { toolPaths: FAKE_PATHS, env: env('in') })).state).toBe('connected')
  })

  it('logged out', async () => {
    for (const v of ['anthropic', 'openai', 'google'] as const) {
      expect((await checkCliStatus(v, { toolPaths: FAKE_PATHS, env: env('out') })).state).toBe('disconnected')
    }
  })

  it('not installed', async () => {
    for (const v of ['anthropic', 'openai', 'google'] as const) {
      expect(await checkCliStatus(v, { toolPaths: {}, env: env('in') })).toEqual({ state: 'not_installed' })
    }
  })

  it('getAccountsStatus combines CLI state and the web "signed in" flags', async () => {
    const s = await getAccountsStatus({ toolPaths: FAKE_PATHS, env: env('out') }, { anthropic: true, openai: false, google: false })
    expect(s.map((x) => [x.vendor, x.cli.state, x.webSignedIn])).toEqual([
      ['anthropic', 'disconnected', true],
      ['openai', 'disconnected', false],
      ['google', 'disconnected', false]
    ])
  })
})

describe('connect / disconnect', () => {
  it('builds gnome-terminal first, x-terminal-emulator second, without a shell', () => {
    const c = buildTerminalCommands(['/bin/claude', 'auth', 'login'])
    expect(c[0]).toEqual({ file: 'gnome-terminal', args: ['--', '/bin/claude', 'auth', 'login'] })
    expect(c[1]).toEqual({ file: 'x-terminal-emulator', args: ['-e', '/bin/claude', 'auth', 'login'] })
  })

  async function terminalDir(names: string[]): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'sr-term-'))
    for (const n of names) {
      await writeFile(join(d, n), '#!/bin/sh\n')
      await chmod(join(d, n), 0o755)
    }
    return d
  }

  it.skipIf(IS_WIN)('opens the vendor sign-in in the preferred terminal', async () => {
    const d = await terminalDir(['gnome-terminal', 'x-terminal-emulator'])
    const calls: Array<[string, string[], NodeJS.ProcessEnv]> = []
    const ok = connectCli('anthropic', { toolPaths: FAKE_PATHS, env: {}, pathEnv: d, platform: 'linux', openTerminal: (f, a, e) => calls.push([f, a, e]) })
    expect(ok).toBe(true)
    expect(calls[0]?.slice(0, 2)).toEqual([join(d, 'gnome-terminal'), ['--', FAKE_PATHS['claude-code'], 'auth', 'login', '--claudeai']])
    await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it.skipIf(IS_WIN)('falls back to x-terminal-emulator, and reports failure without any terminal or CLI', async () => {
    const d = await terminalDir(['x-terminal-emulator'])
    const calls: Array<[string, string[], NodeJS.ProcessEnv]> = []
    expect(connectCli('openai', { toolPaths: FAKE_PATHS, env: {}, pathEnv: d, platform: 'linux', openTerminal: (f, a, e) => calls.push([f, a, e]) })).toBe(true)
    expect(calls[0]?.slice(0, 2)).toEqual([join(d, 'x-terminal-emulator'), ['-e', FAKE_PATHS.codex, 'login']])
    const empty = await terminalDir([])
    expect(connectCli('openai', { toolPaths: FAKE_PATHS, env: {}, pathEnv: empty, platform: 'linux', openTerminal: () => undefined })).toBe(false)
    expect(connectCli('openai', { toolPaths: {}, env: {}, pathEnv: d, platform: 'linux', openTerminal: () => undefined })).toBe(false)
    await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    await rm(empty, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it.skipIf(IS_WIN)('terminal env = child env + display and session-bus variables only', async () => {
    const d = await terminalDir(['gnome-terminal'])
    const calls: Array<[string, string[], NodeJS.ProcessEnv]> = []
    connectCli('anthropic', {
      toolPaths: FAKE_PATHS,
      env: { PATH: '/usr/bin', HOME: '/h', NO_COLOR: '1' },
      pathEnv: d,
      platform: 'linux',
      srcEnv: { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus', XDG_RUNTIME_DIR: '/run/u', NODE_OPTIONS: '--inspect', SECRET: 'x' },
      openTerminal: (f, a, e) => calls.push([f, a, e])
    })
    expect(calls[0]?.[2]).toEqual({ PATH: '/usr/bin', HOME: '/h', NO_COLOR: '1', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus', XDG_RUNTIME_DIR: '/run/u' })
    await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it.skipIf(IS_WIN)('agy connect launches the interactive CLI (no arguments)', async () => {
    const d = await terminalDir(['gnome-terminal'])
    const calls: Array<[string, string[], NodeJS.ProcessEnv]> = []
    connectCli('google', { toolPaths: FAKE_PATHS, env: {}, pathEnv: d, platform: 'linux', openTerminal: (f, a, e) => calls.push([f, a, e]) })
    expect(calls[0]?.[1]).toEqual(['--', FAKE_PATHS.agy])
    await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('disconnect uses the CLI logout; agy has none', async () => {
    expect(await disconnectCli('anthropic', { toolPaths: FAKE_PATHS, env: env('in') })).toBe('ok')
    expect(await disconnectCli('openai', { toolPaths: FAKE_PATHS, env: env('in') })).toBe('ok')
    expect(await disconnectCli('google', { toolPaths: FAKE_PATHS, env: env('in') })).toBe('unsupported')
    expect(await disconnectCli('anthropic', { toolPaths: {}, env: env('in') })).toBe('not_installed')
  })
})

describe('pollUntilConnected', () => {
  it('stops as soon as the account is connected', async () => {
    const seq: CliAccountStatus[] = [{ state: 'disconnected' }, { state: 'disconnected' }, { state: 'connected', method: 'x' }]
    let i = 0
    const ticks: string[] = []
    const r = await pollUntilConnected(async () => seq[Math.min(i++, 2)] as CliAccountStatus, { intervalMs: 5, timeoutMs: 5000, onTick: (s) => ticks.push(s.state) })
    expect(r.state).toBe('connected')
    expect(ticks).toEqual(['disconnected', 'disconnected', 'connected'])
  })

  it('gives up at the timeout and honours abort', async () => {
    const r = await pollUntilConnected(async () => ({ state: 'disconnected' }), { intervalMs: 5, timeoutMs: 60 })
    expect(r.state).toBe('disconnected')
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 20)
    const t0 = Date.now()
    await pollUntilConnected(async () => ({ state: 'disconnected' }), { intervalMs: 1000, timeoutMs: 60_000, signal: ac.signal })
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
