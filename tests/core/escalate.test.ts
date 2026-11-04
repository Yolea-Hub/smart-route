import { describe, expect, it } from 'vitest'
import { decideEscalation } from '../../src/core/escalate'
import { routeTask } from '../../src/core/route'
import type { StepResult } from '../../src/core/types'
import { allAvailable, cls, opts } from './helpers'

const pipeline = routeTask(cls('code', 1), allAvailable(), opts)
const ok = (stepId: string, extra: Partial<StepResult> = {}): StepResult => ({ stepId, ok: true, text: 'x', durationMs: 1, ...extra })

describe('decideEscalation', () => {
  it('escalates the execute step one tier when the review fails', () => {
    const d = decideEscalation(
      pipeline,
      [ok('s1'), ok('s2'), ok('s3', { verdict: { pass: false, issues: ['missing test'] } })],
      false
    )
    expect(d).not.toBeNull()
    expect(d!.step.tool).toBe(pipeline.steps[1]!.tool)
    expect(d!.step.model.tier).toBe(2)
    expect(d!.issues).toEqual(['missing test'])
    expect(d!.needsConfirm).toBe(false)
    expect(d!.reviewIndex).toBe(2)
  })

  it('escalates when the execute step errors', () => {
    const d = decideEscalation(pipeline, [ok('s1'), ok('s2', { ok: false, error: 'exit_nonzero' })], false)
    expect(d?.step.model.tier).toBe(2)
  })

  it('never escalates twice', () => {
    expect(
      decideEscalation(pipeline, [ok('s1'), ok('s2'), ok('s3', { verdict: { pass: false, issues: ['x'] } })], true)
    ).toBeNull()
  })

  it('does not escalate on a passing review or non-escalatable errors', () => {
    expect(decideEscalation(pipeline, [ok('s1'), ok('s2'), ok('s3', { verdict: { pass: true, issues: [] } })], false)).toBeNull()
    expect(decideEscalation(pipeline, [ok('s1'), ok('s2', { ok: false, error: 'not_logged_in' })], false)).toBeNull()
    expect(decideEscalation(pipeline, [ok('s1'), ok('s2', { ok: false, error: 'cancelled' })], false)).toBeNull()
  })

  it('requires confirmation to reach tier 3 and stops after tier 3', () => {
    const heavy = routeTask(cls('code', 1), allAvailable(), opts)
    heavy.steps[1]!.model = { ...heavy.steps[1]!.model, tier: 2 }
    const d = decideEscalation(heavy, [ok('s1'), ok('s2'), ok('s3', { verdict: { pass: false, issues: ['x'] } })], false)
    expect(d?.step.model.tier).toBe(3)
    expect(d?.needsConfirm).toBe(true)
    heavy.steps[1]!.model = { ...heavy.steps[1]!.model, tier: 3 }
    expect(decideEscalation(heavy, [ok('s1'), ok('s2'), ok('s3', { verdict: { pass: false, issues: ['x'] } })], false)).toBeNull()
  })

  it('ignores non plan-execute-review pipelines', () => {
    const single = routeTask(cls('code', 0), allAvailable(), opts)
    expect(decideEscalation(single, [ok('s1', { ok: false, error: 'exit_nonzero' })], false)).toBeNull()
  })
})

describe('decideEscalation: reviewer vendor collision', () => {
  const agyExec = () => {
    // executor agy tier 2 -> escalates to agy tier 3 = Claude Opus (anthropic); reviewer is claude (anthropic)
    const p = routeTask(cls('code', 1), allAvailable(), opts)
    p.steps[1] = { ...p.steps[1]!, tool: 'agy', model: { id: 'gemini-3.8-flash-high', vendor: 'google', tier: 2, label: 'g' } }
    p.steps[2] = { ...p.steps[2]!, tool: 'claude-code', model: { id: 'sonnet', vendor: 'anthropic', tier: 1, label: 'c' } }
    return p
  }
  const failed = [ok('s1'), ok('s2'), ok('s3', { verdict: { pass: false, issues: ['x'] } })]

  it('re-picks a reviewer of another vendor when available', () => {
    const d = decideEscalation(agyExec(), failed, false, opts.codexModels, allAvailable())
    expect(d?.step.model.vendor).toBe('anthropic')
    expect(d?.sameVendorBlocked).toBe(false)
    expect(d?.reviewStep?.model.vendor).not.toBe('anthropic')
    expect(d?.reviewStep?.tool).toBe('codex')
  })

  it('blocks the escalation when no other vendor can review', () => {
    const a = allAvailable()
    a.codex = { installed: false, connected: false }
    expect(decideEscalation(agyExec(), failed, false, opts.codexModels, a)?.sameVendorBlocked).toBe(true)
    expect(decideEscalation(agyExec(), failed, false, opts.codexModels)?.sameVendorBlocked).toBe(true)
  })

  it('no collision for a normal escalation', () => {
    const d = decideEscalation(pipeline, failed, false, opts.codexModels, allAvailable())
    expect(d?.sameVendorBlocked).toBe(false)
    expect(d?.reviewStep?.id).toBe(pipeline.steps[2]!.id)
  })
})

describe('decideEscalation: network errors', () => {
  it('never escalates after a network failure', () => {
    expect(decideEscalation(pipeline, [ok('s1'), ok('s2', { ok: false, error: 'network' })], false)).toBeNull()
  })
})
