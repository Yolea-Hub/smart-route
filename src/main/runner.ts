import { spawn as nodeSpawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { VERDICT_JSON_SCHEMA, verdictSchema } from '../core/schemas'
import { assertSafeArgs } from '../core/safety'
import type { Lang, RunErrorCode, Step, StepResult, ToolId, Verdict } from '../core/types'
import { resolveLaunch } from './detect'

export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
export const AGY_MAX_PROMPT_BYTES = 100 * 1024
/** Windows limits a whole command line to 32 767 characters; the prompt travels in it for agy. */
export const AGY_MAX_PROMPT_CHARS_WIN32 = 30_000
const KILL_GRACE_MS = 5000

/** Absolute path of taskkill, never resolved through PATH. */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'taskkill.exe')
}
export const taskkillArgs = (pid: number): string[] => ['/PID', String(pid), '/T', '/F']

/** Windows: kill the whole process tree, asynchronously (no console window). */
function taskkillAsync(pid: number): void {
  try {
    const c = nodeSpawn(taskkillPath(), taskkillArgs(pid), { shell: false, windowsHide: true, stdio: 'ignore' })
    c.on('error', () => undefined)
    c.unref()
  } catch {
    /* taskkill unavailable: nothing more to do */
  }
}

/** Process groups (POSIX) or process trees (Windows) of steps currently running, so app quit can kill whatever is left. */
const livePgids = new Set<number>()
export function liveProcessGroups(): number[] {
  return [...livePgids]
}
export interface KillAllOptions {
  platform?: NodeJS.Platform
  /** Windows: synchronous tree kill of one pid (the process is about to exit, async would be lost). */
  taskkillSync?: (pid: number) => void
}
export function killAllLiveGroups(opts: KillAllOptions = {}): void {
  const platform = opts.platform ?? process.platform
  const taskkillSync =
    opts.taskkillSync ??
    ((pid: number): void => {
      try {
        spawnSync(taskkillPath(), taskkillArgs(pid), { shell: false, windowsHide: true, stdio: 'ignore', timeout: 5000 })
      } catch {
        /* already gone */
      }
    })
  for (const pgid of livePgids) {
    if (platform === 'win32') {
      taskkillSync(pgid)
      continue
    }
    try {
      process.kill(-pgid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  livePgids.clear()
}

export interface RunnerDeps {
  /** Absolute path of each detected CLI. A missing entry means "not installed". */
  toolPaths: Partial<Record<ToolId, string>>
  env: NodeJS.ProcessEnv
  /** Directory under which a private temp dir is created per step. */
  tmpRoot: string
  useClaudeConfig?: boolean
  /** Codex MCP servers to disable (see BuildArgsOptions). */
  codexDisableMcp?: string[]
  /** Language of the user's task. */
  language?: Lang
  /** The run works in a folder the user chose: agy read-only steps then get no read_url permission. */
  userFolder?: boolean
  spawnFn?: typeof nodeSpawn
  /** Defaults to process.platform; injectable so the Windows paths are unit-tested on Linux. */
  platform?: NodeJS.Platform
  /** Windows tree kill (taskkill /T /F); injectable for tests. */
  killTree?: (pid: number) => void
  killGraceMs?: number
  maxOutputBytes?: number
}

export interface BuildArgsOptions {
  useClaudeConfig?: boolean
  /** Names of the user's Codex MCP servers to disable for this step (isolation like claude --safe-mode). */
  disableMcp?: string[]
  /** Language the answer must be in (overrides the language set in the user's own Claude settings). */
  language?: Lang
  /** The step runs in a folder the user chose (not the empty temporary one). */
  userFolder?: boolean
}

const SAFE_MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Exact argument table of the plan. The prompt is NEVER included here: it goes through stdin
 * (claude, codex) or as the last argument (agy fallback, see AGY_PROMPT_VIA_ARG).
 * Flags confirmed with `claude --help`, `codex exec --help`, `agy --help` on 3 Nov 2026.
 */
export function buildArgs(step: Step, cwd: string, tmp: string, opts: BuildArgsOptions = {}): string[] {
  const edit = step.canEdit && step.role === 'execute'
  const review = step.role === 'review'
  switch (step.tool) {
    case 'claude-code': {
      const args = [
        '-p',
        '--model',
        step.model.id,
        '--output-format',
        'stream-json',
        '--verbose',
        '--tools',
        edit ? 'Read,Grep,Glob,Edit,Write,Bash' : 'Read,Grep,Glob',
        '--permission-mode',
        edit ? 'acceptEdits' : 'dontAsk'
      ]
      // Read-only steps: --restricted confines the file tools to the working directory (claude --help).
      if (!edit) args.push('--restricted')
      // acceptEdits does not approve shell commands in -p mode: allow Bash explicitly so tests can run.
      if (edit) args.push('--allowedTools', 'Bash')
      if (!opts.useClaudeConfig) args.push('--safe-mode')
      // The user's ~/.claude/settings.json "language" still applies under --safe-mode: override it per task.
      if (opts.language) args.push('--settings', JSON.stringify({ language: opts.language === 'fr' ? 'French' : 'English' }))
      args.push('--no-session-persistence', '--strict-mcp-config')
      if (review) args.push('--json-schema', JSON.stringify(VERDICT_JSON_SCHEMA))
      return args
    }
    case 'codex': {
      const args = ['exec', '-m', step.model.id]
      if (step.model.effort) args.push('-c', `model_reasoning_effort="${step.model.effort}"`)
      // `-c mcp_servers={}` does NOT remove configured servers (checked with `codex mcp list --json`);
      // only a per-server `enabled=false` override does.
      for (const name of (opts.disableMcp ?? []).filter((n) => SAFE_MCP_NAME.test(n)).slice(0, 50)) {
        args.push('-c', `mcp_servers.${name}.enabled=false`)
      }
      args.push(
        '-s',
        edit ? 'workspace-write' : 'read-only',
        '-C',
        cwd,
        '--json',
        '-o',
        join(tmp, 'last.txt'),
        '--skip-git-repo-check',
        '--ephemeral'
      )
      if (review) args.push('--output-schema', join(tmp, 'verdict.json'))
      args.push('-')
      return args
    }
    case 'agy': {
      const args = [
        // No '-p' here: in agy print mode the prompt is the VALUE of the flag, added as one
        // `--print=<prompt>` argument by runStep (a lone '-p' swallows the next flag as its prompt).
        '--model',
        step.model.id,
        '--output-format',
        'stream-json',
        '--mode',
        edit ? 'accept-edits' : 'plan',
        '--sandbox',
        '--print-timeout',
        `${Math.max(1, Math.floor(step.timeoutSec))}s`
      ]
      // Read-only steps: a per-run allow-list (agy --settings, never saved) of reading tools only, so the agent can read
      // pages without a prompt that headless mode cannot answer. No command, no write, never --dangerously-skip-permissions.
      // Only without a user folder: with one, a prompt-injected agent could read local files and send them out through read_url.
      if (!edit && !opts.userFolder) args.push('--settings', AGY_READ_ONLY_SETTINGS)
      if (review) args.push('--json-schema', join(tmp, 'verdict.json'))
      return args
    }
    default:
      throw new Error('err.notACliTool')
  }
}

/**
 * Inline settings of read-only agy steps. Rule syntax from agy's own guides (~/.gemini/antigravity-cli/builtin/skills):
 * `read_url(<domain>)` for pages; the file reads of the workspace and the web search need no grant. Nothing for command,
 * write_file, execute_url, mcp or the browser actions.
 */
export const AGY_READ_ONLY_SETTINGS = JSON.stringify({ permissions: { allow: ['read_url(*)'] } })

/** agy headless: a tool asked for a permission nobody can grant, so the call was auto-denied. */
const TOOL_PERMISSION_RE = /(required the "?(command|run_command)"? permission|headless mode cannot prompt for|auto-denied)/i

/**
 * In agy print mode the prompt is the value of `--print` (`-p` is its alias): passed as a single
 * `--print=<prompt>` argument (capped at 100 KB), never through stdin.
 */
export const AGY_PROMPT_VIA_ARG = true

const NETWORK_RE = /(error sending request|dial tcp|i\/o timeout|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|context deadline exceeded|network is unreachable|failed to lookup address|getaddrinfo|unable to connect|network issue|TLS handshake timeout|Post "https?:[^"]*": .*EOF|EOF.*https?:\/\/)/i

/** Last `max` meaningful lines of a noisy stderr: blank and punctuation-only lines dropped, repeats collapsed. */
export function meaningfulTail(raw: string, max = 20): string {
  const out: string[] = []
  for (const l of raw.split(/\r?\n/)) {
    const t = l.trimEnd()
    if (!/[A-Za-z0-9]/.test(t)) continue
    if (out.length > 0 && out[out.length - 1] === t) continue
    out.push(t.length > 400 ? t.slice(0, 400) + '...' : t)
  }
  return out.slice(-max).join('\n')
}

const NOT_LOGGED_IN_RE = /(not (logged|signed) in|please (sign|log) ?in|login required|\/login|auth login|authentication (required|failed)|unauthenticated|invalid api key|401 unauthorized)/i

interface ParseState {
  sawJson: boolean
  badLines: number
  result?: string
  structured?: unknown
  isError: boolean
  assistantText: string
  rawText: string
  /** agy: step indexes whose tool use was already logged. */
  seenSteps: Set<number>
  /** Set by handleLine when the text it returns is a streamed fragment (agy text_delta). */
  delta: boolean
}

function capBytes(text: string, max: number): { text: string; cut: boolean } {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= max) return { text, cut: false }
  return { text: buf.subarray(0, max).toString('utf8').replace(/�+$/, '') + '\n[output truncated]', cut: true }
}

/** Cap a string at `max` UTF-16 units without cutting a surrogate pair. */
function capChars(text: string, max: number): string {
  let end = max
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end)
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
      .join('')
  }
  return ''
}

/** Update the parse state with one stdout line; returns a short summary for the live log (or ''). */
function handleLine(tool: ToolId, line: string, st: ParseState, maxBytes: number): string {
  let ev: unknown
  try {
    ev = JSON.parse(line)
  } catch {
    st.badLines++
    if (st.rawText.length < maxBytes) st.rawText += line + '\n'
    return ''
  }
  if (!ev || typeof ev !== 'object') {
    st.badLines++
    return ''
  }
  st.sawJson = true
  const e = ev as Record<string, unknown>
  const type = typeof e.type === 'string' ? e.type : ''

  if (tool === 'codex') {
    const item = e.item as { type?: string; text?: string } | undefined
    if (item?.type === 'agent_message' && typeof item.text === 'string') return item.text
    return type
  }

  // agy 1.4.12 stream-json: {"event":"init"|"step_update"|"result", ...}
  if (tool === 'agy' && typeof e.event === 'string') {
    if (e.event === 'step_update') {
      const su = (e.step_update ?? {}) as { step_index?: number; state?: string; step_type?: string; text_delta?: unknown }
      const stepType = typeof su.step_type === 'string' ? su.step_type : ''
      if (stepType === 'agent_response') {
        const d = typeof su.text_delta === 'string' ? su.text_delta : ''
        if (d && st.assistantText.length < maxBytes) st.assistantText += d
        st.delta = d !== ''
        return d
      }
      if (stepType && !['user_input', 'unknown'].includes(stepType)) {
        const idx = typeof su.step_index === 'number' ? su.step_index : -1
        if (idx >= 0 && st.seenSteps.has(idx)) return ''
        if (idx >= 0) st.seenSteps.add(idx)
        return `🔧 ${stepType}`
      }
      return ''
    }
    if (e.event === 'result') {
      const r = (e.result ?? {}) as { status?: unknown; response?: unknown; error?: unknown; message?: unknown; structured?: unknown; structured_output?: unknown }
      const body = [r.response, r.error, r.message].find((x) => typeof x === 'string')
      if (typeof body === 'string') st.result = body
      const structured = r.structured_output ?? r.structured
      if (structured !== undefined) st.structured = structured
      st.isError = r.status !== 'SUCCESS'
    }
    return ''
  }

  // claude-code (and a generic stream-json fallback)
  if (type === 'result') {
    const r = e.result ?? e.text ?? e.response
    if (typeof r === 'string') st.result = r
    if (e.structured_output !== undefined) st.structured = e.structured_output
    st.isError = e.is_error === true || (typeof e.subtype === 'string' && e.subtype.startsWith('error'))
    return ''
  }
  if (type === 'assistant') {
    const msg = e.message as { content?: unknown } | undefined
    const t = textOfContent(msg?.content ?? e.content)
    if (t) {
      if (st.assistantText.length < maxBytes) st.assistantText += t
      return t
    }
    const blocks = Array.isArray(msg?.content) ? (msg?.content as Array<{ type?: string; name?: string }>) : []
    const tu = blocks.find((b) => b.type === 'tool_use')
    return tu ? `tool: ${tu.name ?? '?'}` : ''
  }
  return type
}

/**
 * claude and agy: only the structured_output of the result event counts (schema enforced by the CLI).
 * codex: the whole last message file must be the JSON verdict. No guessing inside free text.
 */
function extractVerdict(tool: ToolId, structured: unknown, text: string): Verdict | null {
  let candidate: unknown
  if (tool === 'codex') {
    try {
      candidate = JSON.parse(text.trim())
    } catch {
      return null
    }
  } else if (tool === 'agy' && structured === undefined) {
    // agy: the whole response must be the JSON verdict (no substring search).
    try {
      candidate = JSON.parse(text.trim())
    } catch {
      return null
    }
  } else {
    candidate = structured
  }
  const parsed = verdictSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/** `delta` marks a streamed text fragment (agy text_delta): the reader joins consecutive fragments of a step into one block. */
export type LogEmitter = (stream: 'event' | 'stderr', text: string, delta?: boolean) => void

/**
 * Run one step. `spawn(absPath, args, {shell:false, detached:true, cwd, env})`, prompt via stdin,
 * stdout parsed line by line, whole process group killed on cancel/timeout.
 * Never throws: every failure is a StepResult with an error code.
 */
async function runStepOnce(
  step: Step,
  prompt: string,
  cwd: string,
  signal: AbortSignal,
  onEvent: LogEmitter,
  deps: RunnerDeps
): Promise<StepResult> {
  const started = Date.now()
  const base = { stepId: step.id, role: step.role, tool: step.tool }
  const fail = (error: RunErrorCode, text = ''): StepResult => ({ ...base, ok: false, text, error, durationMs: Date.now() - started })

  if (signal.aborted) return fail('cancelled')
  const exe = deps.toolPaths[step.tool]
  if (!exe) return fail('not_installed')
  const platform = deps.platform ?? process.platform
  // Windows: .exe directly, npm .cmd shim -> node <entry.js>. Never through a shell.
  const launch = resolveLaunch(exe, { platform, pathEnv: deps.env.PATH ?? deps.env.Path })
  if (!launch) return fail('not_installed')
  const killTree = deps.killTree ?? taskkillAsync

  const maxBytes = deps.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const grace = deps.killGraceMs ?? KILL_GRACE_MS
  const spawnFn = deps.spawnFn ?? nodeSpawn

  await mkdir(deps.tmpRoot, { recursive: true, mode: 0o700 })
  const tmp = await mkdtemp(join(deps.tmpRoot, 'sr-'))
  try {
    if (step.role === 'review') await writeFile(join(tmp, 'verdict.json'), JSON.stringify(VERDICT_JSON_SCHEMA), { mode: 0o600 })

    const args = buildArgs(step, cwd, tmp, { useClaudeConfig: deps.useClaudeConfig, disableMcp: deps.codexDisableMcp, language: deps.language, userFolder: deps.userFolder })
    assertSafeArgs(step.tool, args)
    const promptViaArg = step.tool === 'agy' && AGY_PROMPT_VIA_ARG
    if (promptViaArg) {
      let p = Buffer.byteLength(prompt) > AGY_MAX_PROMPT_BYTES ? capBytes(prompt, AGY_MAX_PROMPT_BYTES).text : prompt
      if (platform === 'win32' && p.length > AGY_MAX_PROMPT_CHARS_WIN32) p = capChars(p, AGY_MAX_PROMPT_CHARS_WIN32)
      // One argv element: even a brief starting with '-' stays the value of --print. Flags were checked above.
      // A leading "/" would be expanded as a slash command (needed enabled so --mode plan takes effect).
      if (p.trimStart().startsWith('/')) throw new Error('err.invalidInput')
      args.push(`--print=${p}`)
    }

    return await new Promise<StepResult>((resolve) => {
      let child: ChildProcess
      try {
        child = spawnFn(launch.file, [...launch.args, ...args], {
          shell: false,
          // POSIX: own process group, killed as a whole. Windows: tree kill by pid, no detached console.
          detached: platform !== 'win32',
          windowsHide: true,
          cwd,
          env: deps.env,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch {
        resolve(fail('not_installed'))
        return
      }

      if (child.pid !== undefined) livePgids.add(child.pid)
      const st: ParseState = { sawJson: false, badLines: 0, isError: false, assistantText: '', rawText: '', seenSteps: new Set(), delta: false }
      let stderrBuf = ''
      let lineBuf = ''
      let lineOverflow = false
      let cancelled = false
      let timedOut = false
      let epipe = false
      let settled = false
      let killTimer: NodeJS.Timeout | undefined
      let exitTimer: NodeJS.Timeout | undefined
      let timeoutTimer: NodeJS.Timeout | undefined

      const killGroup = (sig: NodeJS.Signals): void => {
        if (child.pid === undefined) return
        if (platform === 'win32') {
          // /T /F in one go; a pid that already exited is never targeted (it could be reused).
          if (child.exitCode === null && child.signalCode === null) killTree(child.pid)
          return
        }
        try {
          process.kill(-child.pid, sig)
        } catch {
          /* group already gone */
        }
      }
      const stop = (): void => {
        killGroup('SIGTERM')
        if (!killTimer) {
          killTimer = setTimeout(() => killGroup('SIGKILL'), grace)
          killTimer.unref?.()
        }
      }
      const onAbort = (): void => {
        cancelled = true
        stop()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      timeoutTimer = setTimeout(() => {
        timedOut = true
        stop()
      }, Math.max(1, step.timeoutSec) * 1000)

      const finish = async (code: number | null): Promise<void> => {
        if (settled) return
        settled = true
        if (child.pid !== undefined) livePgids.delete(child.pid)
        clearTimeout(timeoutTimer)
        clearTimeout(exitTimer)
        signal.removeEventListener('abort', onAbort)
        // Reap stragglers of the group, then make sure nothing survives the grace period.
        killGroup('SIGTERM')
        if (killTimer) clearTimeout(killTimer)
        setTimeout(() => killGroup('SIGKILL'), 200).unref?.()
        child.stdout?.destroy()
        child.stderr?.destroy()

        if (lineBuf.trim() && !lineOverflow) handleLine(step.tool, lineBuf, st, maxBytes)
        const durationMs = Date.now() - started
        const done = (r: Partial<StepResult> & { ok: boolean }): void =>
          resolve({ ...base, text: '', durationMs, ...r })

        if (cancelled) return done({ ok: false, error: 'cancelled' })
        if (timedOut) return done({ ok: false, error: 'timeout' })

        const stderrTail = stderrBuf.slice(-8000)
        let text = ''
        let truncated = false

        if (step.tool === 'codex') {
          try {
            text = (await readFile(join(tmp, 'last.txt'), 'utf8')).trim()
          } catch {
            text = ''
          }
        } else {
          text = st.result ?? ''
          if (!text && st.structured !== undefined) text = JSON.stringify(st.structured)
          if (!text && st.result === undefined && !st.isError) text = st.assistantText
          if (!text && step.tool === 'agy' && !st.sawJson) text = st.rawText.trim()
        }
        const capped = capBytes(text, maxBytes)
        text = capped.text
        truncated = capped.cut

        const failed = code !== 0 || st.isError || !text
        if (failed && (NETWORK_RE.test(stderrTail) || ((st.isError || code !== 0) && NETWORK_RE.test(text)))) {
          return done({ ok: false, error: 'network', text: meaningfulTail(stderrTail || text) })
        }
        if (failed && step.tool === 'agy' && (TOOL_PERMISSION_RE.test(stderrTail) || TOOL_PERMISSION_RE.test(text))) {
          return done({ ok: false, error: 'tool_permission_denied', text: meaningfulTail(stderrTail || text) })
        }
        const loginProblem = NOT_LOGGED_IN_RE.test(stderrTail)
        if (loginProblem && (code !== 0 || st.isError || !text)) return done({ ok: false, error: 'not_logged_in', text: meaningfulTail(stderrTail || text) })
        if (code !== 0) return done({ ok: false, error: epipe ? 'stdin_epipe' : 'exit_nonzero', text: meaningfulTail(stderrTail || text) })
        if (st.isError) return done({ ok: false, error: 'exit_nonzero', text })

        if (step.tool !== 'codex' && !st.sawJson && st.badLines > 0 && !(step.tool === 'agy' && text)) {
          return done({ ok: false, error: 'bad_json', text: stderrTail })
        }
        if (!text.trim()) return done({ ok: false, error: 'empty_output', text: stderrTail })

        if (step.role === 'review') {
          const verdict = extractVerdict(step.tool, st.structured, text)
          if (!verdict) return done({ ok: false, error: 'bad_json', text })
          return done({ ok: true, text, verdict, truncated })
        }
        return done({ ok: true, text, truncated })
      }

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        if (child.pid !== undefined) livePgids.delete(child.pid)
        clearTimeout(timeoutTimer)
        signal.removeEventListener('abort', onAbort)
        resolve(fail(err.code === 'ENOENT' || err.code === 'EACCES' ? 'not_installed' : 'exit_nonzero', ''))
      })
      child.on('exit', (code) => {
        // A grandchild may keep the pipes open: do not wait forever for 'close'.
        exitTimer = setTimeout(() => void finish(code), 1500)
        exitTimer.unref?.()
      })
      child.on('close', (code) => void finish(code))

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        lineBuf += chunk
        let idx: number
        while ((idx = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, idx)
          lineBuf = lineBuf.slice(idx + 1)
          if (lineOverflow) {
            lineOverflow = false
            continue
          }
          if (!line.trim()) continue
          st.delta = false
          const summary = handleLine(step.tool, line, st, maxBytes)
          if (summary) onEvent('event', summary.slice(0, 2000), st.delta || undefined)
        }
        if (lineBuf.length > maxBytes * 2) {
          // A single line larger than twice the cap is dropped.
          lineBuf = ''
          lineOverflow = true
        }
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        const clean = chunk
          .split('\n')
          .filter((l) => !/has no effect while slash command expansion/i.test(l))
          .join('\n')
        if (!clean.trim()) return
        stderrBuf = (stderrBuf + clean).slice(-20_000)
        onEvent('stderr', clean.slice(0, 2000))
      })

      if (child.stdin) {
        child.stdin.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') epipe = true
        })
        if (promptViaArg) child.stdin.end()
        else child.stdin.end(prompt)
      }
    })
  } catch (e) {
    return fail('exit_nonzero', e instanceof Error ? e.message : '')
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
}

const CONFIG_ERROR_RE = /Error loading config\.toml/i

/**
 * Run one step. Safety net: if codex refuses its config because of our mcp_servers overrides, run the
 * step once more without any of them (and say so in the live log).
 */
export async function runStep(
  step: Step,
  prompt: string,
  cwd: string,
  signal: AbortSignal,
  onEvent: LogEmitter,
  deps: RunnerDeps
): Promise<StepResult> {
  const first = await runStepOnce(step, prompt, cwd, signal, onEvent, deps)
  if (step.tool === 'codex' && !first.ok && first.error === 'exit_nonzero' && (deps.codexDisableMcp?.length ?? 0) > 0 && CONFIG_ERROR_RE.test(first.text)) {
    onEvent('event', 'codex: config rejected the MCP overrides, retrying once without them')
    return runStepOnce(step, prompt, cwd, signal, onEvent, { ...deps, codexDisableMcp: [] })
  }
  return first
}
