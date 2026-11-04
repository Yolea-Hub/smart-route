import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultCodexModels, modelFor } from '../../src/core/catalog'
import type { Role, Step, Tier, ToolId } from '../../src/core/types'
import type { RunnerDeps } from '../../src/main/runner'

export const BIN = resolve(__dirname, '../fixtures/bin')

export const IS_WIN = process.platform === 'win32'

/** POSIX: extensionless sh launcher of the Node fake; Windows: the npm-style .cmd shim (parsed by resolveLaunch). */
const fake = (name: string): string => join(BIN, IS_WIN ? `${name}.cmd` : name)

export const FAKE_PATHS: Partial<Record<ToolId, string>> = {
  'claude-code': fake('claude'),
  codex: fake('codex'),
  agy: fake('agy')
}

export interface Sandbox {
  cwd: string
  tmpRoot: string
  setMode(lines: string): Promise<void>
  cleanup(): Promise<void>
}

export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'sr-test-'))
  const cwd = join(root, 'cwd')
  const tmpRoot = join(root, 'tmp')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(cwd, { recursive: true })
  await writeFile(join(cwd, '.fake-mode'), 'default=success\n')
  return {
    cwd,
    tmpRoot,
    setMode: (lines) => writeFile(join(cwd, '.fake-mode'), lines),
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

export function runnerDeps(sb: Sandbox, over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    toolPaths: FAKE_PATHS,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: sb.cwd, NO_COLOR: '1' },
    tmpRoot: sb.tmpRoot,
    killGraceMs: 300,
    ...over
  }
}

export function mkStep(tool: ToolId, role: Role, tier: Tier = 1, over: Partial<Step> = {}): Step {
  return {
    id: over.id ?? 's1',
    role,
    tool,
    model: modelFor(tool, tier, defaultCodexModels()),
    canEdit: false,
    timeoutSec: 20,
    ...over
  }
}

export function pidAlive(pid: number): boolean {
  if (process.platform !== 'linux') {
    try {
      process.kill(pid, 0)
    } catch {
      return false
    }
    // No /proc here (macOS, Windows): a zombie still answers kill(0), so ask ps on POSIX.
    if (process.platform === 'win32') return true
    const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
    return !(r.status === 0 && r.stdout.trim().startsWith('Z'))
  }
  return existsSync(`/proc/${pid}`) && !isZombie(pid)
}

function isZombie(pid: number): boolean {
  try {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) === 'Z'
  } catch {
    return false
  }
}

export async function readPids(sb: Sandbox): Promise<number[]> {
  const { readFile } = await import('node:fs/promises')
  try {
    return (await readFile(join(sb.cwd, '.fake-pids'), 'utf8')).split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
