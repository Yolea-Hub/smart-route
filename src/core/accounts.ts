import type { CliAccountStatus, ToolId, Vendor } from './types'

/** Pure parsers for the status commands of each CLI. Input is the combined output and exit code. */

const SIGN_IN_RE = /(not (logged|signed) in|please (sign|log) ?in|sign in required|login required|run .*(\/login|auth login|login)|unauthenticated)/i

/** `claude auth status` prints JSON: {loggedIn, authMethod, ...}. */
export function parseClaudeStatus(output: string, _exitCode: number | null): CliAccountStatus {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(output.slice(start, end + 1)) as { loggedIn?: unknown; authMethod?: unknown }
      if (typeof j.loggedIn === 'boolean') {
        return j.loggedIn
          ? { state: 'connected', method: typeof j.authMethod === 'string' ? j.authMethod : undefined }
          : { state: 'disconnected' }
      }
    } catch {
      /* fall through */
    }
  }
  if (SIGN_IN_RE.test(output)) return { state: 'disconnected' }
  return { state: 'unknown' }
}

/** `codex login status` prints "Logged in using ChatGPT" (or an API key notice) / "Not logged in". */
export function parseCodexStatus(output: string, _exitCode: number | null): CliAccountStatus {
  if (/not logged in/i.test(output)) return { state: 'disconnected' }
  const m = output.match(/logged in using ([^\r\n]+)/i)
  if (m) return { state: 'connected', method: (m[1] as string).trim() }
  if (/logged in/i.test(output)) return { state: 'connected' }
  if (SIGN_IN_RE.test(output)) return { state: 'disconnected' }
  return { state: 'unknown' }
}

/** `agy models` lists "<id>\t<label>" lines when signed in, and asks to sign in otherwise. */
export function parseAgyModels(output: string, exitCode: number | null): CliAccountStatus {
  if (SIGN_IN_RE.test(output)) return { state: 'disconnected' }
  const hasModels = output.split(/\r?\n/).some((l) => /^[a-z0-9][a-z0-9._-]+\s+\S/i.test(l.trim()) && /gemini|claude|gpt/i.test(l))
  if (hasModels && (exitCode === 0 || exitCode === null)) return { state: 'connected', method: 'Google' }
  return { state: 'unknown' }
}

export const STATUS_COMMANDS: Record<'claude-code' | 'codex' | 'agy', { args: string[]; parse: (o: string, c: number | null) => CliAccountStatus }> = {
  'claude-code': { args: ['auth', 'status'], parse: parseClaudeStatus },
  codex: { args: ['login', 'status'], parse: parseCodexStatus },
  agy: { args: ['models'], parse: parseAgyModels }
}

export const VENDOR_CLI: Record<Vendor, 'claude-code' | 'codex' | 'agy'> = {
  anthropic: 'claude-code',
  openai: 'codex',
  google: 'agy'
}

/** Arguments of the command run in a system terminal to sign in / out. `null` = not supported. */
export const CONNECT_ARGS: Record<'claude-code' | 'codex' | 'agy', string[]> = {
  'claude-code': ['auth', 'login', '--claudeai'],
  codex: ['login'],
  agy: []
}
export const DISCONNECT_ARGS: Record<'claude-code' | 'codex' | 'agy', string[] | null> = {
  'claude-code': ['auth', 'logout'],
  codex: ['logout'],
  agy: null
}

export function cliToolOfVendor(vendor: Vendor): ToolId {
  return VENDOR_CLI[vendor]
}
