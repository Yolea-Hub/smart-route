import { describe, expect, it } from 'vitest'
import { buildChildEnv } from '../../src/main/env'
import { detectTools, findOnPath, toolPathsOf } from '../../src/main/detect'
import { clampSelection, SELECTION_MAX_BYTES } from '../../src/main/webText'
import { BIN, IS_WIN } from './helpers'

describe('detect', () => {
  it.skipIf(IS_WIN)('walks PATH in code and returns absolute paths', () => {
    expect(findOnPath('claude', `/nonexistent:${BIN}`)).toBe(`${BIN}/claude`)
    expect(findOnPath('does-not-exist', BIN)).toBeUndefined()
    expect(findOnPath('claude', 'relative/dir')).toBeUndefined()
  })

  it.skipIf(IS_WIN)('detects the three fake CLIs with versions', async () => {
    const found = await detectTools({ pathEnv: BIN, home: '/nonexistent', env: { PATH: `${BIN}:${process.env.PATH}`, HOME: '/nonexistent' } })
    expect(found.map((f) => f.toolId)).toEqual(['claude-code', 'codex', 'agy'])
    expect(found[0]?.version).toContain('2.1.317')
    expect(toolPathsOf(found).codex).toBe(`${BIN}/codex`)
  })

  it('skips missing tools and tolerates a failing --version', async () => {
    expect(await detectTools({ pathEnv: '/nonexistent', home: '/nonexistent' })).toEqual([])
    const found = await detectTools({ pathEnv: BIN, home: '/nonexistent', runVersion: async () => { throw new Error('timeout') } })
    expect(found).toHaveLength(3)
    expect(found.every((f) => f.version === '')).toBe(true)
  })
})

describe('detect on Windows', () => {
  it.skipIf(!IS_WIN)('finds the fake .cmd shims through PATHEXT and reads their version through node', async () => {
    const found = await detectTools({ pathEnv: BIN, home: 'C:\\nonexistent', env: { PATH: `${BIN};${process.env.PATH}`, HOME: 'C:\\nonexistent' } })
    expect(found.map((f) => f.toolId)).toEqual(['claude-code', 'codex', 'agy'])
    expect(found[0]?.path.endsWith('claude.cmd')).toBe(true)
    expect(found[0]?.version).toContain('2.1.317')
  })
})

describe('buildChildEnv', () => {
  it('passes the session-bus and XDG variables agy needs, but never ELECTRON_* or NODE_OPTIONS', () => {
    const env = buildChildEnv(
      { PATH: '/usr/bin', HOME: '/h', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_CONFIG_HOME: '/h/.config', XDG_DATA_HOME: '/h/.local/share', ELECTRON_RUN_AS_NODE: '1', ELECTRON_ENABLE_LOGGING: '1', NODE_OPTIONS: '--x' },
      '/h',
      'linux'
    )
    expect(env.XDG_RUNTIME_DIR).toBe('/run/user/1000')
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus')
    expect(env.XDG_CONFIG_HOME).toBe('/h/.config')
    expect(env.XDG_DATA_HOME).toBe('/h/.local/share')
    expect(Object.keys(env).some((k) => k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS')).toBe(false)
    expect(buildChildEnv({ PATH: '/usr/bin' }, '/h', 'linux').XDG_RUNTIME_DIR).toBeUndefined()
  })

  it('keeps only PATH (+ ~/.local/bin), HOME, LANG, USER, NO_COLOR', () => {
    const env = buildChildEnv(
      { PATH: '/usr/bin', HOME: '/home/u', LANG: 'fr_FR.UTF-8', USER: 'u', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1', OPENAI_API_KEY: 'sk-secret' },
      '/home/u',
      'linux'
    )
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'NO_COLOR', 'PATH', 'USER'])
    expect(env.PATH).toBe('/usr/bin:/home/u/.local/bin')
    expect(env.NO_COLOR).toBe('1')
    expect(JSON.stringify(env)).not.toContain('sk-secret')
  })
})

describe('clampSelection', () => {
  it('caps at 50 KB and coerces non-strings to empty', () => {
    expect(Buffer.byteLength(clampSelection('é'.repeat(40_000)))).toBeLessThanOrEqual(SELECTION_MAX_BYTES)
    expect(clampSelection(undefined)).toBe('')
    expect(clampSelection({ a: 1 })).toBe('')
    expect(clampSelection('abc')).toBe('abc')
  })
})
