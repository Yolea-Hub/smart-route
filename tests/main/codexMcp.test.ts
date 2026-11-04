import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexConfigPath, listCodexMcpServers, parseConfigMcpServerNames } from '../../src/main/codexMcp'
import { FAKE_PATHS } from './helpers'

const TOML = `
model = "x"
[mcp_servers.ctx7]
command = "a"
[mcp_servers.ctx7.env]
K = "v"
[ mcp_servers."bad name" ]
command = "b"
[mcp_servers.semgrep] # comment
command = "c"
[mcp_servers.off_srv]
command = "d"
# [mcp_servers.commented]
[other.table]
`

describe('parseConfigMcpServerNames', () => {
  it('reads [mcp_servers.<name>] headers only (not sub-tables, comments or other tables)', () => {
    expect(parseConfigMcpServerNames(TOML).sort()).toEqual(['bad name', 'ctx7', 'off_srv', 'semgrep'])
    expect(parseConfigMcpServerNames('')).toEqual([])
  })
})

describe('codexConfigPath', () => {
  it('honours CODEX_HOME, else HOME/.codex', () => {
    expect(codexConfigPath({ CODEX_HOME: '/c' }, {})).toBe(join('/c', 'config.toml'))
    expect(codexConfigPath({ HOME: '/h' }, {})).toBe(join('/h', '.codex', 'config.toml'))
    expect(codexConfigPath({ HOME: '/h' }, { CODEX_HOME: '/z' })).toBe(join('/z', 'config.toml'))
  })
})

describe('listCodexMcpServers', () => {
  async function withConfig(toml: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const d = await mkdtemp(join(tmpdir(), 'sr-codexcfg-'))
    await writeFile(join(d, 'config.toml'), toml)
    return { path: join(d, 'config.toml'), cleanup: () => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  }

  it('keeps servers that are enabled AND defined in the user config: plugin and disabled ones are skipped', async () => {
    const c = await withConfig(TOML)
    const names = await listCodexMcpServers(FAKE_PATHS.codex, { PATH: process.env.PATH }, undefined, c.path)
    // codex_app: disabled + plugin; plugin_srv: enabled but not in config.toml; off_srv: already disabled; "bad name": unsafe
    expect(names).toEqual(['ctx7', 'semgrep'])
    await c.cleanup()
  })

  it('returns [] when config.toml is missing, codex is missing, fails or prints garbage', async () => {
    expect(await listCodexMcpServers(FAKE_PATHS.codex, { PATH: process.env.PATH }, undefined, '/nonexistent/config.toml')).toEqual([])
    expect(await listCodexMcpServers(undefined, {})).toEqual([])
    expect(await listCodexMcpServers('/x', {}, async () => ({ stdout: '', stderr: '', code: 1 }))).toEqual([])
    expect(await listCodexMcpServers('/x', {}, async () => ({ stdout: 'nope', stderr: '', code: 0 }))).toEqual([])
  })
})
