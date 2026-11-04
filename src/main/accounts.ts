import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECT_ARGS, DISCONNECT_ARGS, STATUS_COMMANDS, VENDOR_CLI } from '../core/accounts'
import type { CliAccountStatus, Settings, ToolId, Vendor, VendorAccountStatus } from '../core/types'
import { findOnPath, resolveLaunch } from './detect'
import { buildTerminalEnv } from './env'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}
export type ExecFn = (file: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<ExecResult>

export const defaultExec: ExecFn = (file, args, env, timeoutMs) =>
  new Promise((resolve) => {
    const launch = resolveLaunch(file, { pathEnv: env.PATH ?? env.Path })
    if (!launch) {
      resolve({ stdout: '', stderr: 'err.notACliTool', code: 1 })
      return
    }
    execFile(launch.file, [...launch.args, ...args], { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 2_000_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : 1) : 0
      resolve({ stdout: String(stdout), stderr: String(stderr), code })
    })
  })

export interface AccountsDeps {
  toolPaths: Partial<Record<ToolId, string>>
  env: NodeJS.ProcessEnv
  exec?: ExecFn
  timeoutMs?: number
}

/** Status-check timeout: `agy models` reaches Google and is slow on bad networks. */
export const STATUS_TIMEOUT_MS: Record<'claude-code' | 'codex' | 'agy', number> = { 'claude-code': 15_000, codex: 15_000, agy: 30_000 }

/** Last known-good 'connected' answer per vendor (timestamp, epoch ms). In memory only. */
const lastConnected = new Map<Vendor, number>()
export function resetLastConnected(): void {
  lastConnected.clear()
}

/**
 * Check one vendor's command-line account. Never reads a token or password.
 * 'unknown' = the check timed out or failed for a network/other reason (not an explicit logged-out answer);
 * it carries `lastConnectedAt` when a previous check in this session answered 'connected'.
 */
export async function checkCliStatus(vendor: Vendor, deps: AccountsDeps): Promise<CliAccountStatus> {
  const tool = VENDOR_CLI[vendor]
  const exe = deps.toolPaths[tool]
  if (!exe) return { state: 'not_installed' }
  const cmd = STATUS_COMMANDS[tool]
  const res = await (deps.exec ?? defaultExec)(exe, cmd.args, deps.env, deps.timeoutMs ?? STATUS_TIMEOUT_MS[tool])
  const status = cmd.parse(`${res.stdout}\n${res.stderr}`, res.code)
  if (status.state === 'connected') lastConnected.set(vendor, Date.now())
  if (status.state === 'unknown') {
    const at = lastConnected.get(vendor)
    return at === undefined ? status : { ...status, lastConnectedAt: at }
  }
  return status
}

export async function getAccountsStatus(deps: AccountsDeps, webSignedIn: Settings['webSignedIn']): Promise<VendorAccountStatus[]> {
  const vendors: Vendor[] = ['anthropic', 'openai', 'google']
  return Promise.all(
    vendors.map(async (vendor) => ({ vendor, cli: await checkCliStatus(vendor, deps), webSignedIn: webSignedIn[vendor] }))
  )
}

export interface TerminalLauncher {
  file: string
  args: string[]
}

/** Terminal candidates in order of preference: `gnome-terminal --`, then `x-terminal-emulator -e`. */
export function buildTerminalCommands(argv: string[]): TerminalLauncher[] {
  return [
    { file: 'gnome-terminal', args: ['--', ...argv] },
    { file: 'x-terminal-emulator', args: ['-e', ...argv] }
  ]
}

export interface TerminalSpawnOptions {
  /** Windows: the sign-in needs a visible console window. */
  windowsHide?: boolean
}
export type TerminalSpawn = (file: string, args: string[], env: NodeJS.ProcessEnv, opts?: TerminalSpawnOptions) => void

const defaultTerminalSpawn: TerminalSpawn = (file, args, env, opts) => {
  const child = spawn(file, args, { shell: false, detached: true, stdio: 'ignore', env, windowsHide: opts?.windowsHide ?? true })
  child.on('error', () => undefined)
  child.unref()
}

/** Single-quote a string for bash (`'` becomes `'\\''`). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Body of the macOS `.command` file: removes itself, exports PATH (Terminal starts a fresh login shell), then
 * runs the CLI. Every value is single-quoted and the executable is an absolute path.
 */
export function buildCommandFileBody(argv: string[], pathValue: string | undefined): string {
  const lines = ['#!/bin/bash', 'rm -f -- "$0"; rmdir -- "$(dirname -- "$0")" 2>/dev/null']
  if (pathValue) lines.push(`export PATH=${shellQuote(pathValue)}`)
  lines.push('cd -- "$HOME" 2>/dev/null', `exec ${argv.map(shellQuote).join(' ')}`)
  return lines.join('\n') + '\n'
}

/**
 * Open the vendor's own sign-in in a system terminal. Returns false when no terminal is available
 * or the vendor CLI is not installed. The app never sees what is typed there.
 * Linux: gnome-terminal / x-terminal-emulator. Windows: the CLI itself, detached, in its own console window.
 * macOS: a private `.command` file (mode 0700) opened with `open`.
 */
export function connectCli(
  vendor: Vendor,
  deps: AccountsDeps & { pathEnv?: string; openTerminal?: TerminalSpawn; srcEnv?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; tmpDir?: string }
): boolean {
  const tool = VENDOR_CLI[vendor]
  const exe = deps.toolPaths[tool]
  if (!exe) return false
  const platform = deps.platform ?? process.platform
  const pathEnv = deps.pathEnv ?? deps.env.PATH ?? ''
  const open = deps.openTerminal ?? defaultTerminalSpawn

  if (platform === 'win32') {
    const launch = resolveLaunch(exe, { platform, pathEnv })
    if (!launch) return false
    open(launch.file, [...launch.args, ...CONNECT_ARGS[tool]], buildTerminalEnv(deps.env, deps.srcEnv), { windowsHide: false })
    return true
  }

  if (platform === 'darwin') {
    try {
      const dir = mkdtempSync(join(deps.tmpDir ?? tmpdir(), 'sr-signin-'))
      const file = join(dir, 'sign-in.command')
      writeFileSync(file, buildCommandFileBody([exe, ...CONNECT_ARGS[tool]], deps.env.PATH), { mode: 0o700 })
      open('/usr/bin/open', [file], buildTerminalEnv(deps.env, deps.srcEnv))
      return true
    } catch {
      return false
    }
  }

  const argv = [exe, ...CONNECT_ARGS[tool]]
  for (const t of buildTerminalCommands(argv)) {
    const abs = findOnPath(t.file, pathEnv)
    if (abs) {
      open(abs, t.args, buildTerminalEnv(deps.env, deps.srcEnv))
      return true
    }
  }
  return false
}

/** Sign out through the CLI's own command. Returns 'unsupported' when the CLI has none (agy). */
export async function disconnectCli(vendor: Vendor, deps: AccountsDeps): Promise<'ok' | 'unsupported' | 'not_installed' | 'failed'> {
  const tool = VENDOR_CLI[vendor]
  const args = DISCONNECT_ARGS[tool]
  if (!args) return 'unsupported'
  const exe = deps.toolPaths[tool]
  if (!exe) return 'not_installed'
  const res = await (deps.exec ?? defaultExec)(exe, args, deps.env, deps.timeoutMs ?? 15_000)
  return res.code === 0 ? 'ok' : 'failed'
}

export interface PollOptions {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  onTick?: (status: CliAccountStatus) => void
}

/** Re-check every 3 s for up to 5 min; resolves with the final status ('connected' ends early). */
export async function pollUntilConnected(check: () => Promise<CliAccountStatus>, opts: PollOptions = {}): Promise<CliAccountStatus> {
  const interval = opts.intervalMs ?? 3000
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000)
  let last: CliAccountStatus = { state: 'unknown' }
  while (Date.now() < deadline && !opts.signal?.aborted) {
    last = await check()
    opts.onTick?.(last)
    if (last.state === 'connected' || last.state === 'not_installed') return last
    await new Promise<void>((r) => {
      const onAbort = (): void => {
        clearTimeout(t)
        r()
      }
      const t = setTimeout(() => {
        opts.signal?.removeEventListener('abort', onAbort)
        r()
      }, interval)
      opts.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
  return last
}
