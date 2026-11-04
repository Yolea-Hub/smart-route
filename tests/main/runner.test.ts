import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertSafeArgs } from '../../src/core/safety'
import type { Role, Tier, ToolId } from '../../src/core/types'
import { AGY_MAX_PROMPT_BYTES, AGY_READ_ONLY_SETTINGS, buildArgs, killAllLiveGroups, liveProcessGroups, meaningfulTail, runStep } from '../../src/main/runner'
import { BIN, FAKE_PATHS, IS_WIN, makeSandbox, mkStep, pidAlive, readPids, runnerDeps, sleep, type Sandbox } from './helpers'

let sb: Sandbox
beforeEach(async () => {
  sb = await makeSandbox()
})
afterEach(async () => {
  const pids = await readPids(sb)
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      /* gone */
    }
  }
  await sb.cleanup()
})

const run = (tool: ToolId, role: Role, prompt = 'do it', over: Parameters<typeof runnerDeps>[1] = {}, stepOver = {}, signal = new AbortController().signal) =>
  runStep(mkStep(tool, role, 1, stepOver), prompt, sb.cwd, signal, () => undefined, runnerDeps(sb, over))

describe('runStep: success paths', () => {
  it('claude: prompt goes through stdin, result comes from the result event', async () => {
    const events: string[] = []
    const r = await runStep(mkStep('claude-code', 'single'), 'hello prompt', sb.cwd, new AbortController().signal, (s, t) => events.push(`${s}:${t}`), runnerDeps(sb))
    expect(r).toMatchObject({ ok: true, text: 'OK from claude', stepId: 's1', tool: 'claude-code' })
    expect(await readFile(join(sb.cwd, '.fake-stdin'), 'utf8')).toBe('hello prompt')
    expect(events.some((e) => e.includes('working'))).toBe(true)
    const args = await readFile(join(sb.cwd, '.fake-args'), 'utf8')
    expect(args).toContain('--safe-mode')
    expect(args).toContain('--tools Read,Grep,Glob --permission-mode dontAsk')
    expect(args).not.toContain('--json-schema')
  })

  it('codex: prompt via stdin "-", result read from the -o file', async () => {
    const r = await run('codex', 'single', 'codex prompt')
    expect(r).toMatchObject({ ok: true, text: 'OK from codex' })
    expect(await readFile(join(sb.cwd, '.fake-stdin'), 'utf8')).toBe('codex prompt')
    const args = (await readFile(join(sb.cwd, '.fake-args'), 'utf8')).trim()
    expect(args.endsWith(' -')).toBe(true)
    expect(args).toContain('-s read-only')
    expect(args).toContain('model_reasoning_effort="medium"')
  })

  it('agy: prompt is the value of --print (one argv element), capped at 100 KB', async () => {
    const r = await run('agy', 'single', 'agy prompt')
    expect(r).toMatchObject({ ok: true, text: 'OK from agy' })
    expect(await readFile(join(sb.cwd, '.fake-prompt-arg'), 'utf8')).toBe('agy prompt')
    const big = 'é'.repeat(200_000)
    await run('agy', 'single', big)
    const sent = await readFile(join(sb.cwd, '.fake-prompt-arg'), 'utf8')
    expect(Buffer.byteLength(sent)).toBeLessThanOrEqual(AGY_MAX_PROMPT_BYTES + 40)
  })

  it('a brief starting with dashes or quoting forbidden flags stays the --print value and does not trip assertSafeArgs', async () => {
    for (const brief of ['--add-dir / please', '-p --model x', 'explain --dangerously-skip-permissions and --permission-mode auto']) {
      const r = await run('agy', 'single', brief)
      expect(r).toMatchObject({ ok: true, text: 'OK from agy' })
      expect(await readFile(join(sb.cwd, '.fake-prompt-arg'), 'utf8')).toBe(brief)
    }
    const calls = (await readFile(join(sb.cwd, '.fake-args'), 'utf8')).trim().split('\n')
    expect(calls[0]).toContain('--print=--add-dir / please')
    expect(calls[0]).not.toMatch(/(^| )-p( |$)/)
  })

  it('the fake agy reproduces the real CLI: a bare -p followed by a flag is rejected', async () => {
    expect(() => execFileSync(process.execPath, [join(BIN, 'agy.js'), '-p', '--model', 'x'], { cwd: sb.cwd, stdio: 'pipe' })).toThrow(/took "--model" as its prompt/)
  })

  it('a real forbidden flag in the flag list still throws before spawning (agy)', async () => {
    const { assertSafeArgs: check } = await import('../../src/core/safety')
    expect(() => check('agy', [...buildArgs(mkStep('agy', 'plan'), '/w', '/t'), '--mode', 'auto'])).toThrow(/unsafe argument/)
  })
})

describe('runStep: verdicts', () => {
  it('claude review: structured verdict validated', async () => {
    await sb.setMode('review=verdict_fail')
    const r = await run('claude-code', 'review')
    expect(r.ok).toBe(true)
    expect(r.verdict).toEqual({ pass: false, issues: ['missing edge case', 'no test'] })
    expect((await readFile(join(sb.cwd, '.fake-args'), 'utf8'))).toContain('--json-schema')
  })

  it('codex review: verdict from the -o file, schema file passed', async () => {
    await sb.setMode('review=verdict_pass')
    const r = await run('codex', 'review')
    expect(r.verdict).toEqual({ pass: true, issues: [] })
    expect(await readFile(join(sb.cwd, '.fake-args'), 'utf8')).toContain('--output-schema')
  })

  it('agy review: verdict parsed from the result text', async () => {
    await sb.setMode('review=verdict_fail')
    const r = await run('agy', 'review')
    expect(r.verdict?.pass).toBe(false)
  })

  it('claude and agy accept only structured_output: a JSON verdict in free text is bad_json', async () => {
    await sb.setMode('review=verdict_textonly')
    expect(await run('claude-code', 'review')).toMatchObject({ ok: false, error: 'bad_json' })
    expect(await run('agy', 'review')).toMatchObject({ ok: false, error: 'bad_json' })
  })

  it('codex parses the whole last message: prose around the JSON is bad_json', async () => {
    await sb.setMode('review=verdict_prose')
    expect(await run('codex', 'review')).toMatchObject({ ok: false, error: 'bad_json' })
  })

  it('an invalid verdict is bad_json, never a pass', async () => {
    await sb.setMode('review=verdict_invalid')
    for (const tool of ['claude-code', 'codex'] as const) {
      const r = await run(tool, 'review')
      expect(r).toMatchObject({ ok: false, error: 'bad_json' })
      expect(r.verdict).toBeUndefined()
    }
  })

  it('an executor printing PASS gives no verdict, and a review without verdict is not a pass', async () => {
    await sb.setMode('run=pass_text\nreview=pass_text')
    const exec = await run('claude-code', 'execute')
    expect(exec.ok).toBe(true)
    expect(exec.text).toContain('PASS')
    expect(exec.verdict).toBeUndefined()
    const review = await run('claude-code', 'review')
    expect(review.ok).toBe(false)
    expect(review.error).toBe('bad_json')
  })
})

describe('runStep: failures', () => {
  it('non-zero exit', async () => {
    await sb.setMode('default=fail')
    for (const tool of ['claude-code', 'codex', 'agy'] as const) {
      const r = await run(tool, 'single')
      expect(r).toMatchObject({ ok: false, error: 'exit_nonzero' })
      expect(r.text).toContain('boom')
    }
  })

  it('malformed JSON', async () => {
    await sb.setMode('default=badjson')
    expect(await run('claude-code', 'single')).toMatchObject({ ok: false, error: 'bad_json' })
    // agy's stream-json shape is unverified (no paid call allowed): plain text output is accepted as-is.
    expect(await run('agy', 'single')).toMatchObject({ ok: true })
  })

  it('empty output', async () => {
    await sb.setMode('default=empty')
    for (const tool of ['claude-code', 'codex', 'agy'] as const) {
      expect(await run(tool, 'single')).toMatchObject({ ok: false, error: 'empty_output' })
    }
  })

  it('oversized output is cut at the cap', async () => {
    await sb.setMode('default=huge')
    for (const tool of ['claude-code', 'codex'] as const) {
      const r = await run(tool, 'single', 'x', { maxOutputBytes: 200_000 })
      expect(r.ok).toBe(true)
      expect(r.truncated).toBe(true)
      expect(r.text.length).toBeLessThan(200_100)
      expect(r.text).toContain('[output truncated]')
    }
  })

  it('a single line larger than twice the cap is dropped, not buffered forever', async () => {
    await sb.setMode('default=huge')
    const r = await run('claude-code', 'single', 'x', { maxOutputBytes: 50_000 })
    expect(r.ok).toBe(false)
  })

  it('not logged in', async () => {
    await sb.setMode('default=notlogged')
    for (const tool of ['claude-code', 'codex', 'agy'] as const) {
      expect(await run(tool, 'single')).toMatchObject({ ok: false, error: 'not_logged_in' })
    }
  })

  it('missing tool: not_installed, with or without a path', async () => {
    expect(await run('claude-code', 'single', 'x', { toolPaths: {} })).toMatchObject({ ok: false, error: 'not_installed' })
    expect(await run('claude-code', 'single', 'x', { toolPaths: { 'claude-code': join(sb.cwd, 'nope') } })).toMatchObject({ ok: false, error: 'not_installed' })
  })

  // Windows: a child that exits without reading stdin does not raise EPIPE on the parent's pipe the way POSIX does (the run ends as exit_nonzero).
  it.skipIf(IS_WIN)('EPIPE on stdin is reported as stdin_epipe', async () => {
    await sb.setMode('default=epipe')
    const r = await run('claude-code', 'single', 'z'.repeat(6_000_000))
    expect(r).toMatchObject({ ok: false, error: 'stdin_epipe' })
  })

  it('an already aborted signal does not spawn anything', async () => {
    const ac = new AbortController()
    ac.abort()
    const r = await run('claude-code', 'single', 'x', {}, {}, ac.signal)
    expect(r.error).toBe('cancelled')
    await expect(readFile(join(sb.cwd, '.fake-args'), 'utf8')).rejects.toThrow()
  })
})

describe('runStep: no live child after cancel or timeout', () => {
  it('cancel kills the whole process group', async () => {
    await sb.setMode('default=hang')
    const ac = new AbortController()
    const p = run('claude-code', 'single', 'x', {}, {}, ac.signal)
    // Wait for both fake processes to report their pid instead of a fixed delay (flaky under load).
    let pids: number[] = []
    await vi.waitFor(async () => {
      pids = await readPids(sb)
      expect(pids.length).toBe(2)
    }, { timeout: 5000, interval: 100 })
    expect(pids.every(pidAlive)).toBe(true)
    ac.abort()
    const r = await p
    expect(r.error).toBe('cancelled')
    await sleep(300)
    expect(pids.some(pidAlive)).toBe(false)
  })

  // POSIX process groups (SIGTERM ignored + SIGKILL via the group). The Windows taskkill /T /F path is covered in platform.test.ts (spawns without shell ... taskkill).
  it.skipIf(IS_WIN)('registers live process groups and killAllLiveGroups reaps them (app quit)', async () => {
    await sb.setMode('default=stubborn')
    const ac = new AbortController()
    const p = run('claude-code', 'single', 'x', { killGraceMs: 60_000 }, { timeoutSec: 60 }, ac.signal)
    await sleep(600)
    expect(liveProcessGroups().length).toBe(1)
    ac.abort() // SIGTERM is ignored by the child, the grace period is long
    await sleep(200)
    const pids = await readPids(sb)
    expect(pids.some(pidAlive)).toBe(true)
    killAllLiveGroups()
    const r = await p
    expect(r.error).toBe('cancelled')
    await sleep(300)
    expect(pids.some(pidAlive)).toBe(false)
    expect(liveProcessGroups()).toEqual([])
  })

  it('timeout kills the group', async () => {
    await sb.setMode('default=hang')
    const r = await run('codex', 'single', 'x', {}, { timeoutSec: 1 })
    expect(r.error).toBe('timeout')
    await sleep(300)
    const pids = await readPids(sb)
    expect(pids.length).toBe(2)
    expect(pids.some(pidAlive)).toBe(false)
  })

  it('a child ignoring SIGTERM is killed with SIGKILL after the grace period', async () => {
    await sb.setMode('default=stubborn')
    const r = await run('claude-code', 'single', 'x', {}, { timeoutSec: 1 })
    expect(r.error).toBe('timeout')
    await sleep(600)
    const pids = await readPids(sb)
    expect(pids.some(pidAlive)).toBe(false)
  })
})

describe('buildArgs', () => {
  const tools: ToolId[] = ['claude-code', 'codex', 'agy']
  const roles: Role[] = ['plan', 'execute', 'review', 'single']

  it('every output passes assertSafeArgs (all tools, roles, tiers, edit on/off)', () => {
    for (const tool of tools)
      for (const role of roles)
        for (const tier of [0, 1, 2, 3] as Tier[])
          for (const canEdit of [false, true])
            for (const useClaudeConfig of [false, true]) {
              const args = buildArgs(mkStep(tool, role, tier, { canEdit }), '/work', '/tmp/x', { useClaudeConfig })
              expect(() => assertSafeArgs(tool, args)).not.toThrow()
            }
  })

  it('edit flags appear only for an execute step with canEdit', () => {
    for (const tool of tools)
      for (const role of roles)
        for (const canEdit of [false, true]) {
          const args = buildArgs(mkStep(tool, role, 1, { canEdit }), '/work', '/tmp/x').join(' ')
          const edits = /acceptEdits|workspace-write|accept-edits|Edit,Write,Bash|allowedTools/.test(args)
          expect(edits).toBe(role === 'execute' && canEdit)
        }
  })

  it('claude args follow the plan table', () => {
    const a = buildArgs(mkStep('claude-code', 'review', 2), '/w', '/t').join(' ')
    expect(a).toContain('-p --model opus --output-format stream-json --verbose --tools Read,Grep,Glob --permission-mode dontAsk --restricted --safe-mode --no-session-persistence --strict-mcp-config --json-schema {')
    const e = buildArgs(mkStep('claude-code', 'execute', 1, { canEdit: true }), '/w', '/t').join(' ')
    expect(e).toContain('--tools Read,Grep,Glob,Edit,Write,Bash --permission-mode acceptEdits')
  })

  it('read-only claude steps are --restricted; edit steps allow Bash explicitly', () => {
    const ro = buildArgs(mkStep('claude-code', 'review'), '/w', '/t')
    expect(ro).toContain('--restricted')
    expect(ro).not.toContain('--allowedTools')
    const rw = buildArgs(mkStep('claude-code', 'execute', 1, { canEdit: true }), '/w', '/t')
    expect(rw).not.toContain('--restricted')
    expect(rw.slice(rw.indexOf('--allowedTools'), rw.indexOf('--allowedTools') + 2)).toEqual(['--allowedTools', 'Bash'])
  })

  it('"Use my Claude configuration" drops --safe-mode', () => {
    const a = buildArgs(mkStep('claude-code', 'single'), '/w', '/t', { useClaudeConfig: true })
    expect(a).not.toContain('--safe-mode')
  })

  it('codex args follow the plan table', () => {
    const a = buildArgs(mkStep('codex', 'review', 2), '/w', '/t')
    expect(a.slice(0, 3)).toEqual(['exec', '-m', 'gpt-6.1-sol'])
    expect(a).toContain('model_reasoning_effort="high"')
    expect(a.slice(a.indexOf('-s'), a.indexOf('-s') + 4)).toEqual(['-s', 'read-only', '-C', '/w'])
    expect(a).toContain('--json')
    expect(a).toContain('--skip-git-repo-check')
    expect(a).toContain('--ephemeral')
    expect(a).toContain(join('/t', 'verdict.json'))
    expect(a.at(-1)).toBe('-')
  })

  it('agy args follow the plan table', () => {
    const a = buildArgs(mkStep('agy', 'plan', 2, { timeoutSec: 120 }), '/w', '/t').join(' ')
    expect(a).toBe(`--model gemini-3.8-flash-high --output-format stream-json --mode plan --sandbox --print-timeout 120s --settings ${AGY_READ_ONLY_SETTINGS}`)
    expect(buildArgs(mkStep('agy', 'execute', 1, { canEdit: true }), '/w', '/t')).toContain('accept-edits')
  })

  it('agy read-only steps get a per-run allow-list of reading tools only; edit steps keep their behaviour', () => {
    const ro = buildArgs(mkStep('agy', 'single'), '/w', '/t')
    const settings = JSON.parse(ro[ro.indexOf('--settings') + 1] as string) as { permissions: { allow: string[] } }
    expect(settings.permissions.allow).toEqual(['read_url(*)'])
    for (const rule of settings.permissions.allow) expect(rule).not.toMatch(/command|write|execute|mcp|browser|send|schedule|manage/i)
    expect(ro.join(' ')).not.toMatch(/dangerously/)
    const edit = buildArgs(mkStep('agy', 'execute', 1, { canEdit: true }), '/w', '/t')
    expect(edit).not.toContain('--settings')
  })

  it('agy read-only steps get NO read_url rule when a folder of the user is open (no exfiltration path)', () => {
    const ro = buildArgs(mkStep('agy', 'single'), '/w', '/t', { userFolder: true })
    expect(ro).not.toContain('--settings')
    expect(ro.join(' ')).not.toMatch(/read_url/)
    // without a user folder (temporary work dir) the rule is still there
    expect(buildArgs(mkStep('agy', 'single'), '/w', '/t', { userFolder: false })).toContain('--settings')
  })

  it('the runner never uses a forbidden flag even for tier 3', () => {
    for (const tool of tools) {
      const all = buildArgs(mkStep(tool, 'execute', 3, { canEdit: true }), '/w', '/t').join(' ')
      expect(all).not.toMatch(/dangerous|bypass|danger-full-access|--add-dir|--mode auto|permission-mode auto/)
    }
  })
})

void FAKE_PATHS

describe('network errors, language and MCP isolation', () => {
  it('network failures are classified for all three CLIs, with a trimmed stderr', async () => {
    await sb.setMode('default=network')
    for (const tool of ['claude-code', 'codex', 'agy'] as const) {
      const r = await run(tool, 'single')
      expect(r).toMatchObject({ ok: false, error: 'network' })
      expect(r.text).toContain('error sending request')
      expect(r.text.split('\n').every((l) => l.trim().length > 0)).toBe(true)
    }
  })

  it.skipIf(IS_WIN).each(['dial tcp 1.2.3.4:443: i/o timeout', 'getaddrinfo ENOTFOUND api.openai.com', 'connect ECONNREFUSED 127.0.0.1:1', 'getaddrinfo EAI_AGAIN x', 'context deadline exceeded', 'Post "https://api.openai.com/v1": EOF'])('NETWORK pattern: %s', async (msg) => {
    const { writeFile, chmod } = await import('node:fs/promises')
    const exe = join(sb.cwd, 'claude')
    await writeFile(exe, `#!/usr/bin/env bash\ncat >/dev/null\necho ${JSON.stringify(msg)} >&2\nexit 1\n`)
    await chmod(exe, 0o755)
    const r = await run('claude-code', 'single', 'x', { toolPaths: { 'claude-code': exe } })
    expect(r.error).toBe('network')
  })

  it.skipIf(IS_WIN)('agy real network messages map to NETWORK (TLS handshake timeout, network issue)', async () => {
    const { writeFile, chmod } = await import('node:fs/promises')
    const msgs = [
      'error: There was a network issue connecting to the server, please try again.',
      'AGY_ERROR: {"short_error":"... net/http: TLS handshake timeout","status":"UNKNOWN"}',
    ]
    for (const msg of msgs) {
      const exe = join(sb.cwd, 'claude')
      await writeFile(exe, `#!/usr/bin/env bash\ncat >/dev/null\necho ${JSON.stringify(msg)} >&2\nexit 1\n`)
      await chmod(exe, 0o755)
      const r = await run('claude-code', 'single', 'x', { toolPaths: { 'claude-code': exe } })
      expect(r.error).toBe('network')
    }
  })

  it('a plain failure is still exit_nonzero', async () => {
    await sb.setMode('default=fail')
    expect((await run('codex', 'single')).error).toBe('exit_nonzero')
  })

  it('meaningfulTail keeps the last 20 non-blank lines and collapses repeats', () => {
    const raw = Array.from({ length: 50 }, (_, i) => `line ${i}\n\n---\n`).join('') + 'line 49\n'
    const t = meaningfulTail(raw, 20).split('\n')
    expect(t).toHaveLength(20)
    expect(t.at(-1)).toBe('line 49')
    expect(t.some((l) => l === '---')).toBe(false)
  })

  it('claude gets --settings with the task language; Settings JSON is inline', () => {
    const fr = buildArgs(mkStep('claude-code', 'single'), '/w', '/t', { language: 'fr' })
    expect(fr[fr.indexOf('--settings') + 1]).toBe('{"language":"French"}')
    const en = buildArgs(mkStep('claude-code', 'single'), '/w', '/t', { language: 'en' })
    expect(en[en.indexOf('--settings') + 1]).toBe('{"language":"English"}')
    expect(buildArgs(mkStep('claude-code', 'single'), '/w', '/t')).not.toContain('--settings')
    expect(buildArgs(mkStep('codex', 'single'), '/w', '/t', { language: 'fr' })).not.toContain('--settings')
    expect(() => assertSafeArgs('claude-code', fr)).not.toThrow()
  })

  it('codex disables each configured MCP server by name; unsafe names are dropped', async () => {
    const a = buildArgs(mkStep('codex', 'single'), '/w', '/t', { disableMcp: ['ctx7', 'semgrep', 'a.b', 'x"y', '--add-dir'] })
    expect(a).toContain('mcp_servers.ctx7.enabled=false')
    expect(a).toContain('mcp_servers.semgrep.enabled=false')
    expect(a.filter((x) => x.startsWith('mcp_servers.'))).toHaveLength(3) // '--add-dir' matches the safe charset but stays a -c value
    expect(a.filter((x) => x === '--add-dir')).toHaveLength(0)
    expect(() => assertSafeArgs('codex', a)).not.toThrow()
    await run('codex', 'single', 'x', { codexDisableMcp: ['ctx7'], language: 'fr' })
    expect(await readFile(join(sb.cwd, '.fake-args'), 'utf8')).toContain('-c mcp_servers.ctx7.enabled=false')
  })
})

describe('codex config safety net', () => {
  it('retries once without mcp_servers overrides when codex rejects its config, and logs it', async () => {
    await sb.setMode('default=badconfig')
    const logs: string[] = []
    const r = await runStep(mkStep('codex', 'single'), 'x', sb.cwd, new AbortController().signal, (s, t) => logs.push(`${s}:${t}`), runnerDeps(sb, { codexDisableMcp: ['ctx7'] }))
    expect(r).toMatchObject({ ok: true, text: 'OK from codex' })
    expect(logs.some((l) => l.includes('retrying once without them'))).toBe(true)
    const calls = (await readFile(join(sb.cwd, '.fake-args'), 'utf8')).trim().split('\n')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('mcp_servers.ctx7.enabled=false')
    expect(calls[1]).not.toContain('mcp_servers.')
  })

  it('does not retry without overrides, nor for other failures', async () => {
    await sb.setMode('default=badconfig')
    const r = await run('codex', 'single') // no overrides configured: nothing to drop
    expect(r.ok).toBe(true) // fake only fails when mcp_servers flags are present
    await sb.setMode('default=fail')
    await run('codex', 'single', 'x', { codexDisableMcp: ['ctx7'] })
    const calls = (await readFile(join(sb.cwd, '.fake-args'), 'utf8')).trim().split('\n')
    expect(calls.filter((c) => c.includes('mcp_servers.')).length).toBe(1) // the failing run was not repeated
  })
})

describe('agy real stream-json format', () => {
  it('text comes from result.response; live log has the delta and the tool line', async () => {
    await sb.setMode('default=success_tool')
    const logs: string[] = []
    const deltas: boolean[] = []
    const r = await runStep(mkStep('agy', 'single'), 'q', sb.cwd, new AbortController().signal, (s, t, d) => { logs.push(`${s}:${t}`); if (d) deltas.push(d) }, runnerDeps(sb))
    expect(r).toMatchObject({ ok: true, text: 'OK from agy' })
    expect(logs).toContain('event:OK from agy')
    expect(deltas).toEqual([true, true]) // the text fragment and the closing newline are streamed fragments, the tool line is not
    expect(logs).toContain('event:🔧 run_command')
    expect(logs.filter((l) => l.includes('🔧'))).toHaveLength(1)
  })

  it('a non-SUCCESS status is an error: exit_nonzero, or network when the text says so', async () => {
    await sb.setMode('default=status_error')
    expect(await run('agy', 'single')).toMatchObject({ ok: false, error: 'exit_nonzero', text: 'boom' })
    await sb.setMode('default=status_error_network')
    expect(await run('agy', 'single')).toMatchObject({ ok: false, error: 'network' })
  })

  it('agy "command permission auto-denied" is tool_permission_denied, from stderr or from the result', async () => {
    await sb.setMode('default=tool_permission')
    expect(await run('agy', 'single')).toMatchObject({ ok: false, error: 'tool_permission_denied' })
    await sb.setMode('default=tool_permission_result')
    expect(await run('agy', 'single')).toMatchObject({ ok: false, error: 'tool_permission_denied' })
  })

  it('the fake agy accepts the read-only --settings JSON of a real step and rejects a broken one', async () => {
    expect(await run('agy', 'single')).toMatchObject({ ok: true })
    expect(await readFile(join(sb.cwd, '.fake-args'), 'utf8')).toContain('--settings {"permissions":{"allow":["read_url(*)"]}}')
    expect(() => execFileSync(process.execPath, [join(BIN, 'agy.js'), '--settings', '{bad', '--print=x'], { cwd: sb.cwd, stdio: 'pipe' })).toThrow(/must be a JSON object/)
  })

  it('an empty response is empty_output', async () => {
    await sb.setMode('default=empty')
    expect(await run('agy', 'single')).toMatchObject({ ok: false, error: 'empty_output' })
  })

  it('review: whole response parsed as the verdict; a structured field wins; prose around JSON is bad_json', async () => {
    await sb.setMode('review=verdict_pass')
    expect((await run('agy', 'review')).verdict).toEqual({ pass: true, issues: [] })
    await sb.setMode('review=verdict_structured')
    expect((await run('agy', 'review')).verdict).toEqual({ pass: false, issues: ['agy structured'] })
    await sb.setMode('review=verdict_textonly')
    expect(await run('agy', 'review')).toMatchObject({ ok: false, error: 'bad_json' })
  })

  it('slash commands stay enabled so --mode plan / accept-edits take effect', async () => {
    expect(buildArgs(mkStep('agy', 'plan'), '/w', '/t')).not.toContain('--disable-slash-commands')
    expect(buildArgs(mkStep('agy', 'plan'), '/w', '/t')).toContain('plan')
    expect(buildArgs(mkStep('agy', 'execute', 1, { canEdit: true }), '/w', '/t')).toContain('accept-edits')
  })

  it('a brief starting with "/" is refused before spawning', async () => {
    const r = await run('agy', 'single', '/help me')
    expect(r.ok).toBe(false)
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(sb.cwd, '.fake-prompt-arg'))).toBe(false)
  })

  it('the agy "mode has no effect" stderr warning never reaches logs or results', async () => {
    await sb.setMode('default=warn')
    const logs: string[] = []
    const r = await runStep(mkStep('agy', 'single'), 'q', sb.cwd, new AbortController().signal, (s, t) => logs.push(`${s}:${t}`), runnerDeps(sb))
    expect(r.ok).toBe(true)
    expect(logs.some((l) => l.includes('no effect'))).toBe(false)
    expect(r.text).not.toContain('no effect')
  })
})
