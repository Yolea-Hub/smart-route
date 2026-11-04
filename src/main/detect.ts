import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter as hostDelimiter, dirname, isAbsolute, join, win32 } from 'node:path'
import type { ToolId } from '../core/types'
import { extraToolDirs } from './env'

export const CLI_BINARIES: Record<'claude-code' | 'codex' | 'agy', string> = {
  'claude-code': 'claude',
  codex: 'codex',
  agy: 'agy'
}

export interface DetectedTool {
  toolId: 'claude-code' | 'codex' | 'agy'
  path: string
  version: string
}

function isExecutableFile(p: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(p).isFile()) return false
    // Windows has no execute bit: a file with the right extension is enough.
    if (platform !== 'win32') accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Extensions a process can be started from without a shell, in preference order (.exe first). */
export function windowsExtensions(pathExt?: string): string[] {
  const wanted = ['.exe', '.com', '.cmd', '.bat']
  if (!pathExt) return wanted
  const listed = pathExt
    .toLowerCase()
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
  const usable = listed.filter((e) => wanted.includes(e))
  return ['.exe', ...usable.filter((e) => e !== '.exe')]
}

/**
 * Walk PATH (+ extra dirs) in code, never through a shell. Returns an absolute path or undefined.
 * On Windows each directory is tried with the PATHEXT extensions, `.exe` first (the bare name is never a program there).
 */
export function findOnPath(
  name: string,
  pathEnv: string,
  extraDirs: string[] = [],
  platform: NodeJS.Platform = process.platform,
  pathExt: string | undefined = process.env.PATHEXT
): string | undefined {
  const sep = platform === 'win32' ? ';' : hostDelimiter
  const abs = (d: string): boolean => isAbsolute(d) || (platform === 'win32' && win32.isAbsolute(d))
  const dirs = [...pathEnv.split(sep), ...extraDirs].filter((d) => d && abs(d))
  const names = platform === 'win32' ? windowsExtensions(pathExt).map((e) => name + e) : [name]
  for (const d of dirs) {
    for (const n of names) {
      const candidate = join(d, n)
      if (isExecutableFile(candidate, platform)) return candidate
    }
  }
  return undefined
}

/** What to spawn for a tool: the file plus arguments that come before the caller's own. */
export interface Launch {
  file: string
  args: string[]
}

export interface LaunchOptions {
  platform?: NodeJS.Platform
  pathEnv?: string
  /** Read a small text file (the shim); injectable for tests. */
  readText?: (path: string) => string | undefined
  exists?: (path: string) => boolean
}

const defaultReadText = (p: string): string | undefined => {
  try {
    const st = statSync(p)
    if (!st.isFile() || st.size > 64 * 1024) return undefined
    return readFileSync(p, 'utf8')
  } catch {
    return undefined
  }
}

const SCRIPT_RE = /\.(?:c|m)?js$/i

/**
 * Parse a standard npm cmd-shim (the `.cmd` that npm writes for a global package): its last command line runs
 * `"%_prog%" "%dp0%\path\to\entry.js" %*` (or `"%~dp0\node.exe" "%~dp0\...entry.js" %*`, or the native exe).
 * Returns the program to start without any shell: `node <entry.js>` or the native `.exe`.
 */
export function parseCmdShim(text: string, shimPath: string, opts: LaunchOptions = {}): Launch | undefined {
  const platform = opts.platform ?? process.platform
  const exists = opts.exists ?? existsSync
  const dir = dirname(shimPath)
  const lines = text.split(/\r?\n/).filter((l) => /dp0/i.test(l) && /%\*/.test(l))
  const line = lines[lines.length - 1]
  if (!line) return undefined
  const quoted = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string)
  const targets = quoted.filter((q) => /%~?dp0%?/i.test(q) && !/%_prog%/i.test(q))
  const resolveTarget = (q: string): string => {
    const parts = q.replace(/%~?dp0%?/i, '').split(/[\\/]+/).filter(Boolean)
    return join(dir, ...parts)
  }
  for (const t of targets) {
    const full = resolveTarget(t)
    if (/\.(?:exe|com)$/i.test(full) && !/(?:^|[\\/])node\.exe$/i.test(full)) return exists(full) ? { file: full, args: [] } : undefined
  }
  const entry = targets.map(resolveTarget).find((t) => SCRIPT_RE.test(t))
  if (!entry || !exists(entry)) return undefined
  // node: next to the shim when npm put one there, otherwise the one on PATH.
  const localNode = join(dir, 'node.exe')
  const node = exists(localNode) ? localNode : findOnPath('node', opts.pathEnv ?? '', [], platform)
  return node ? { file: node, args: [entry] } : undefined
}

/**
 * How to start a detected tool without a shell. POSIX: the file itself. Windows: an `.exe` directly; a `.cmd`
 * npm shim is parsed into `node <entry.js>` (or its native exe); anything else cannot be started safely.
 */
export function resolveLaunch(toolPath: string, opts: LaunchOptions = {}): Launch | undefined {
  const platform = opts.platform ?? process.platform
  if (platform !== 'win32') return { file: toolPath, args: [] }
  if (/\.(?:exe|com)$/i.test(toolPath)) return { file: toolPath, args: [] }
  if (/\.(?:cmd|bat)$/i.test(toolPath)) {
    const text = (opts.readText ?? defaultReadText)(toolPath)
    return text === undefined ? undefined : parseCmdShim(text, toolPath, opts)
  }
  return undefined
}

export type VersionRunner = (file: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<string>

export const defaultVersionRunner: VersionRunner = (file, args, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const launch = resolveLaunch(file, { pathEnv: env.PATH ?? env.Path })
    if (!launch) {
      reject(new Error('err.notACliTool'))
      return
    }
    execFile(launch.file, [...launch.args, ...args], { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 1_000_000 }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve(`${stdout}${stderr}`)
    })
  })

export interface DetectOptions {
  pathEnv?: string
  home?: string
  env?: NodeJS.ProcessEnv
  runVersion?: VersionRunner
  timeoutMs?: number
  platform?: NodeJS.Platform
}

/** Detect installed CLIs: `{toolId, path, version}` (version "" when `--version` fails or times out). */
export async function detectTools(opts: DetectOptions = {}): Promise<DetectedTool[]> {
  const home = opts.home ?? homedir()
  const platform = opts.platform ?? process.platform
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? ''
  const run = opts.runVersion ?? defaultVersionRunner
  const env = opts.env ?? { PATH: pathEnv, HOME: home, NO_COLOR: '1' }
  const found: DetectedTool[] = []
  for (const toolId of Object.keys(CLI_BINARIES) as DetectedTool['toolId'][]) {
    const path = findOnPath(CLI_BINARIES[toolId], pathEnv, extraToolDirs(platform, home, opts.env ?? process.env), platform)
    if (!path) continue
    let version = ''
    try {
      version = (await run(path, ['--version'], env, opts.timeoutMs ?? 5000)).trim().split(/\r?\n/)[0] ?? ''
    } catch {
      version = ''
    }
    found.push({ toolId, path, version })
  }
  return found
}

export function toolPathsOf(tools: DetectedTool[]): Partial<Record<ToolId, string>> {
  const out: Partial<Record<ToolId, string>> = {}
  for (const t of tools) out[t.toolId] = t.path
  return out
}
