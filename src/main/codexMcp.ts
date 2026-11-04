import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultExec, type ExecFn } from './accounts'

const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/

/** Names of servers defined as a `[mcp_servers.<name>]` table (plain or quoted key) in a config.toml text. */
export function parseConfigMcpServerNames(toml: string): string[] {
  const names = new Set<string>()
  for (const line of toml.split(/\r?\n/)) {
    const m = /^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/.exec(line)
    const name = m && (m[1] ?? m[2] ?? m[3])
    if (name) names.add(name)
  }
  return [...names]
}

/** Path of the user's Codex config.toml, honouring CODEX_HOME. */
export function codexConfigPath(env: NodeJS.ProcessEnv, fallbackEnv: NodeJS.ProcessEnv = process.env): string {
  const home = env.CODEX_HOME ?? fallbackEnv.CODEX_HOME
  return home ? join(home, 'config.toml') : join(env.HOME ?? fallbackEnv.HOME ?? '', '.codex', 'config.toml')
}

/**
 * MCP servers to disable for a Codex step: those that `codex mcp list --json` reports as enabled AND that
 * are defined in the user's own config.toml. Plugin-provided servers (not in config.toml) are skipped:
 * an override would create a partial entry without transport and make codex refuse the config.
 * Names that are not plain identifiers are ignored. Returns [] on any failure.
 */
export async function listCodexMcpServers(
  exe: string | undefined,
  env: NodeJS.ProcessEnv,
  exec: ExecFn = defaultExec,
  configPath: string = codexConfigPath(env)
): Promise<string[]> {
  if (!exe) return []
  try {
    const r = await exec(exe, ['mcp', 'list', '--json'], env, 10_000)
    if (r.code !== 0) return []
    const data = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))) as Array<{ name?: unknown; enabled?: unknown }>
    const own = new Set(parseConfigMcpServerNames(await readFile(configPath, 'utf8')))
    return data
      .filter((d) => d.enabled === true && typeof d.name === 'string' && SAFE_NAME.test(d.name) && own.has(d.name))
      .map((d) => d.name as string)
  } catch {
    return []
  }
}
