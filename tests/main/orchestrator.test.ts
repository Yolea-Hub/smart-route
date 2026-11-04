import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recipePipeline, RECIPES } from '../../src/core/recipes'
import { routeTask } from '../../src/core/route'
import type { Pipeline, RunEvent, Step, StepResult } from '../../src/core/types'
import { PendingHub, retryStep, runPipeline, type CapStore, type OrchestratorDeps } from '../../src/main/orchestrator'
import { runStep } from '../../src/main/runner'
import { allAvailable, cls, opts } from '../core/helpers'
import { makeSandbox, runnerDeps, sleep, type Sandbox } from './helpers'

let sb: Sandbox
beforeEach(async () => {
  sb = await makeSandbox()
})
afterEach(async () => {
  await sb.cleanup()
})

function memoryCaps(initial: Record<string, number> = {}): CapStore & { counts: Record<string, number> } {
  const counts = { ...initial }
  return { counts, count: (t) => counts[t] ?? 0, increment: (t) => void (counts[t] = (counts[t] ?? 0) + 1) }
}

function makeDeps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    runId: 'r1',
    lang: 'en',
    dailyCap: 30,
    runStep: (step, prompt, cwd, signal, onEvent) => runStep(step, prompt, cwd, signal, onEvent, runnerDeps(sb)),
    caps: memoryCaps(),
    handoffs: new PendingHub<string | null>(),
    confirms: new PendingHub<boolean>(),
    briefs: new Map(),
    ...over
  }
}

const ok = (step: Step, text = 'out', extra: Partial<StepResult> = {}): StepResult => ({ stepId: step.id, role: step.role, tool: step.tool, ok: true, text, durationMs: 1, ...extra })

const pipeline = (): Pipeline => routeTask(cls('code', 1), allAvailable(), opts)
const collect = (): { events: RunEvent[]; emit: (e: RunEvent) => void } => {
  const events: RunEvent[] = []
  return { events, emit: (e) => events.push(e) }
}

describe('agy read-only brief and the user folder', () => {
  const agyStep = (): Step => ({ id: 's1', role: 'single', tool: 'agy', model: { id: 'gemini-3.8-flash-high', vendor: 'google', tier: 2, label: 'g' }, canEdit: false, timeoutSec: 60 })
  const prompts = async (userFolder: boolean | undefined): Promise<string[]> => {
    const seen: string[] = []
    const deps = makeDeps({ userFolder, runStep: async (step, prompt) => (seen.push(prompt), ok(step)) })
    await runPipeline(deps, { pattern: 'single', steps: [agyStep()], explanation: [] }, 'question', sb.cwd, () => undefined, new AbortController().signal)
    return seen
  }
  it('with a user folder the agy read-only brief says web reading is unavailable; without one it does not', async () => {
    expect((await prompts(true))[0]).toContain('Web reading is unavailable, for privacy')
    expect((await prompts(false))[0]).not.toContain('unavailable')
    expect((await prompts(undefined))[0]).toContain('page reading')
  })
})

describe('runPipeline with fake CLIs', () => {
  it('plan -> execute -> review passes without escalation', async () => {
    await sb.setMode('run=success\nreview=verdict_pass')
    const { events, emit } = collect()
    const s = await runPipeline(makeDeps(), pipeline(), 'fix bug', sb.cwd, emit, new AbortController().signal)
    expect(s.status).toBe('done')
    expect(s.escalated).toBe(false)
    expect(s.results.map((r) => r.stepId)).toEqual(['s1', 's2', 's3'])
    expect(s.results[2]?.verdict?.pass).toBe(true)
    expect(events.filter((e) => e.type === 'step-end')).toHaveLength(3)
  })

  it('an executor printing PASS does not make the review pass; escalation happens exactly once', async () => {
    await sb.setMode('run=pass_text\nreview=verdict_fail')
    const { events, emit } = collect()
    const s = await runPipeline(makeDeps(), pipeline(), 'fix bug', sb.cwd, emit, new AbortController().signal)
    expect(s.status).toBe('failed')
    expect(s.escalated).toBe(true)
    expect(events.filter((e) => e.type === 'escalation')).toHaveLength(1)
    expect(s.results.map((r) => r.stepId)).toEqual(['s1', 's2', 's3', 's2-esc', 's3-2'])
    expect(s.results[1]?.text).toContain('PASS')
    expect(s.results[2]?.verdict?.pass).toBe(false)
    expect(s.results[4]?.verdict?.pass).toBe(false)
  })

  it('escalation re-runs the executor one tier up with the review issues fenced, then the review passes', async () => {
    await sb.setMode('run=success\nreview=verdict_fail_then_pass')
    const { emit } = collect()
    const s = await runPipeline(makeDeps(), pipeline(), 'fix bug', sb.cwd, emit, new AbortController().signal)
    expect(s.status).toBe('done')
    expect(s.escalated).toBe(true)
    const stdinOfLastExec = await readFile(join(sb.cwd, '.fake-stdin'), 'utf8').catch(() => '')
    expect(stdinOfLastExec.length).toBeGreaterThan(0)
    const args = await readFile(join(sb.cwd, '.fake-args'), 'utf8')
    expect(args).toContain('--model opus')
  })

  it('cancel during a run ends as cancelled and leaves no process', async () => {
    await sb.setMode('run=hang')
    const ac = new AbortController()
    const { emit } = collect()
    const p = runPipeline(makeDeps(), pipeline(), 'x', sb.cwd, emit, ac.signal)
    await sleep(600)
    ac.abort()
    const s = await p
    expect(s.status).toBe('cancelled')
    expect(s.results.at(-1)?.error).toBe('cancelled')
  })

  it('a missing tool surfaces as not_installed and stops the run', async () => {
    const deps = makeDeps({ runStep: (st, pr, cwd, sig, ev) => runStep(st, pr, cwd, sig, ev, runnerDeps(sb, { toolPaths: {} })) })
    const s = await runPipeline(deps, routeTask(cls('other', 1), allAvailable(), opts), 'x', sb.cwd, () => undefined, new AbortController().signal)
    expect(s.status).toBe('failed')
    expect(s.results[0]?.error).toBe('not_installed')
  })
})

describe('runPipeline with a stubbed runner', () => {
  it('daily cap: no spawn once reached, result cap_reached', async () => {
    let calls = 0
    const deps = makeDeps({
      dailyCap: 2,
      caps: memoryCaps({ 'claude-code': 2 }),
      runStep: async (step) => {
        calls++
        return ok(step)
      }
    })
    const s = await runPipeline(deps, routeTask(cls('other', 1), allAvailable(), opts), 'x', sb.cwd, () => undefined, new AbortController().signal)
    expect(calls).toBe(0)
    expect(s.status).toBe('failed')
    expect(s.results[0]?.error).toBe('cap_reached')
  })

  it('every real run increments the tool counter', async () => {
    const caps = memoryCaps()
    const deps = makeDeps({ caps, runStep: async (step) => ok(step, 'x', step.role === 'review' ? { verdict: { pass: true, issues: [] } } : {}) })
    await runPipeline(deps, pipeline(), 'x', sb.cwd, () => undefined, new AbortController().signal)
    expect(Object.values(caps.counts).reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('execute failure escalates once; a second failure ends the run', async () => {
    const executed: string[] = []
    const deps = makeDeps({
      runStep: async (step) => {
        executed.push(step.id)
        if (step.role === 'execute') return { ...ok(step), ok: false, error: 'exit_nonzero' }
        return ok(step)
      }
    })
    const s = await runPipeline(deps, pipeline(), 'x', sb.cwd, () => undefined, new AbortController().signal)
    expect(executed).toEqual(['s1', 's2', 's2-esc'])
    expect(s.status).toBe('failed')
    expect(s.escalated).toBe(true)
  })

  it('a plan failure stops the pipeline', async () => {
    const executed: string[] = []
    const deps = makeDeps({
      runStep: async (step) => {
        executed.push(step.id)
        return { ...ok(step), ok: false, error: 'timeout' }
      }
    })
    const s = await runPipeline(deps, pipeline(), 'x', sb.cwd, () => undefined, new AbortController().signal)
    expect(executed).toEqual(['s1'])
    expect(s.status).toBe('failed')
  })

  it('tier 3 escalation waits for an explicit confirmation', async () => {
    const p = pipeline()
    p.steps[1]!.model = { ...p.steps[1]!.model, tier: 2 }
    const run = (accept: boolean) => {
      const deps = makeDeps({
        runStep: async (step) => (step.role === 'review' ? ok(step, 'v', { verdict: { pass: step.id.endsWith('-2'), issues: ['x'] } }) : ok(step))
      })
      const { events, emit } = collect()
      const promise = runPipeline(deps, p, 'x', sb.cwd, emit, new AbortController().signal)
      return { promise, events, deps }
    }
    const declined = run(false)
    await sleep(50)
    expect(declined.events.some((e) => e.type === 'confirm-costly')).toBe(true)
    expect(declined.deps.confirms.submit('r1', 's2-esc', false)).toBe(true)
    expect((await declined.promise).status).toBe('failed')

    const accepted = run(true)
    await sleep(50)
    accepted.deps.confirms.submit('r1', 's2-esc', true)
    const s = await accepted.promise
    expect(s.status).toBe('done')
    expect(s.results.some((r) => r.stepId === 's2-esc')).toBe(true)
  })

  it('handoff: waits for the pasted result, fenced later, capped at 50 KB', async () => {
    const wp = routeTask(cls('writing', 1), allAvailable(), opts)
    const deps = makeDeps({ runStep: async () => { throw new Error('must not run') } })
    const { events, emit } = collect()
    const promise = runPipeline(deps, wp, 'write an email', sb.cwd, emit, new AbortController().signal)
    await sleep(30)
    const hand = events.find((e) => e.type === 'handoff')
    expect(hand).toMatchObject({ type: 'handoff', tool: 'cowork' })
    expect(deps.briefs.get('r1:s1')).toMatchObject({ tool: 'cowork' })
    expect(deps.briefs.get('r1:s1')?.text).toContain('write an email')
    expect(deps.handoffs.submit('r1', 's1', 'é'.repeat(60_000))).toBe(true)
    const s = await promise
    expect(s.status).toBe('done')
    expect(Buffer.byteLength(s.results[0]!.text)).toBeLessThanOrEqual(50_000)
    expect(deps.briefs.size).toBe(0)
  })

  it('handoff skipped continues the pipeline; cancel while waiting is cancelled', async () => {
    const wp = routeTask(cls('research', 3), allAvailable(), opts)
    const deps = makeDeps({ runStep: async (step) => ok(step, 'summary') })
    const promise = runPipeline(deps, wp, 'research it', sb.cwd, () => undefined, new AbortController().signal)
    await sleep(30)
    deps.handoffs.submit('r1', 's1', null)
    const s = await promise
    expect(s.status).toBe('done')
    expect(s.results.map((r) => r.stepId)).toEqual(['s1', 's2'])

    const ac = new AbortController()
    const deps2 = makeDeps()
    const p2 = runPipeline(deps2, routeTask(cls('writing', 1), allAvailable(), opts), 'x', sb.cwd, () => undefined, ac.signal)
    await sleep(30)
    ac.abort()
    expect((await p2).status).toBe('cancelled')
  })
})

describe('recipe pipelines', () => {
  it('a later step receives the earlier output as fenced context, and each step its own instruction and the no-command rule', async () => {
    const recipe = RECIPES.find((r) => r.id === 'mkt-article')!
    const prompts: string[] = []
    const deps = makeDeps({
      runStep: async (step, prompt) => {
        prompts.push(prompt)
        return ok(step, `OUT-${step.id}`)
      }
    })
    const p = recipePipeline(recipe, { ...opts, allowEdits: true }, 'en')
    const s = await runPipeline(deps, p, 'Write about X', sb.cwd, () => undefined, new AbortController().signal)
    expect(s.status).toBe('done')
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain(recipe.steps[0]!.instruction.en)
    expect(prompts[0]).not.toContain('OUT-s1')
    expect(prompts[1]).toContain(recipe.steps[1]!.instruction.en)
    expect(prompts[1]).toMatch(/UNTRUSTED-[0-9a-f]{16}[\s\S]*OUT-s1/)
    for (const pr of prompts) expect(pr).toContain('Do not run any terminal command')
  })
})

describe('PendingHub', () => {
  it('returns false when nothing waits', () => {
    expect(new PendingHub<string>().submit('a', 'b', 'x')).toBe(false)
  })
})

describe('runPipeline: agy budget and escalation guard', () => {
  it('truncates the brief for agy within its argument budget', async () => {
    const p = routeTask(cls('research', 1), allAvailable(), opts)
    let prompt = ''
    const deps = makeDeps({ runStep: async (step, pr) => { prompt = pr; return ok(step) } })
    await runPipeline(deps, p, 'q'.repeat(300_000), sb.cwd, () => undefined, new AbortController().signal)
    expect(p.steps[0]!.tool).toBe('agy')
    expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(100 * 1024)
    expect(prompt).toContain('task truncated')
  })

  it('does not escalate when the escalated executor and the reviewer would share a vendor', async () => {
    const a = allAvailable()
    a.codex = { installed: false, connected: false }
    const p = routeTask(cls('code', 1), a, opts) // claude plan/execute, agy review? (google) -> make executor agy tier 2
    p.steps[1] = { ...p.steps[1]!, tool: 'agy', model: { id: 'gemini-3.8-flash-high', vendor: 'google', tier: 2, label: 'g' } }
    p.steps[2] = { ...p.steps[2]!, tool: 'claude-code', model: { id: 'sonnet', vendor: 'anthropic', tier: 1, label: 'c' } }
    const executed: string[] = []
    const { events, emit } = collect()
    const deps = makeDeps({
      availability: a,
      runStep: async (step) => {
        executed.push(step.id)
        return step.role === 'review' ? ok(step, 'v', { verdict: { pass: false, issues: ['x'] } }) : ok(step)
      }
    })
    const s = await runPipeline(deps, p, 'x', sb.cwd, emit, new AbortController().signal)
    expect(executed).toEqual(['s1', 's2', 's3'])
    expect(s.status).toBe('failed')
    expect(s.escalated).toBe(false)
    expect(events.some((e) => e.type === 'log' && e.text === 'escalate.sameVendorBlocked')).toBe(true)
  })
})

describe('network errors: no escalation, single-step retry', () => {
  it('a network failure on the execute step ends the run without escalating', async () => {
    const executed: string[] = []
    const deps = makeDeps({
      runStep: async (step) => {
        executed.push(step.id)
        return step.role === 'execute' ? { ...ok(step), ok: false, error: 'network' } : ok(step)
      }
    })
    const s = await runPipeline(deps, pipeline(), 'x', sb.cwd, () => undefined, new AbortController().signal)
    expect(executed).toEqual(['s1', 's2'])
    expect(s.status).toBe('failed')
    expect(s.escalated).toBe(false)
    expect(s.executedSteps.map((x) => x.id)).toEqual(['s1', 's2'])
  })

  it('retryStep re-runs only that step with the same model, using a fake CLI that fails once', async () => {
    await sb.setMode('review=network_once')
    const p = pipeline()
    const reviewStep = p.steps[2]!
    const { events, emit } = collect()
    const deps = makeDeps()
    const first = await runStep(reviewStep, 'x', sb.cwd, new AbortController().signal, () => undefined, runnerDeps(sb))
    expect(first.error).toBe('network')
    await sb.setMode('review=verdict_pass')
    const again = await retryStep(deps, reviewStep, 'task', sb.cwd, [ok(p.steps[0]!)], emit, new AbortController().signal)
    expect(again.ok).toBe(true)
    expect(again.verdict?.pass).toBe(true)
    expect(events.map((e) => e.type)).toEqual(['step-start', 'log', 'step-end'].filter((t) => events.some((e) => e.type === t)))
    expect(events.filter((e) => e.type === 'step-start')).toHaveLength(1)
    const args = await readFile(join(sb.cwd, '.fake-args'), 'utf8')
    expect(args.trim().split('\n').filter((l) => l.includes('--output-schema'))).toHaveLength(2)
  })
})
