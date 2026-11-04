import { describe, expect, it } from 'vitest'
import { finalResultOf, summariesOf, summaryLine } from '../../src/core/result'
import type { StepResult } from '../../src/core/types'
import { mkStep } from '../main/helpers'

const r = (over: Partial<StepResult>): StepResult => ({ stepId: 's1', ok: true, text: 'x', durationMs: 1000, ...over })

describe('finalResultOf', () => {
  it('prefers the last successful non-review step, falls back to a review, ignores failures and empty text', () => {
    expect(finalResultOf([r({ stepId: 'a', text: 'plan', role: 'plan' }), r({ stepId: 'b', text: 'answer', role: 'execute' }), r({ stepId: 'c', text: 'ok', role: 'review' })])?.stepId).toBe('b')
    expect(finalResultOf([r({ stepId: 'a', text: 'only review', role: 'review' })])?.stepId).toBe('a')
    expect(finalResultOf([r({ ok: false }), r({ text: '  ' })])).toBeUndefined()
  })
})

describe('summaryLine', () => {
  it('takes the first meaningful line, without markdown marks, cut at the limit', () => {
    expect(summaryLine('\n\n## **Titre** du résultat\nsuite')).toBe('Titre du résultat')
    expect(summaryLine('- 1. item\nb')).toBe('item')
    expect(summaryLine('2026 est une année')).toBe('2026 est une année')
    expect(summaryLine('```js\ncode\n```\nafter')).toBe('code')
    expect(summaryLine('a'.repeat(300), 10)).toBe('aaaaaaaaa…')
    expect(summaryLine('   \n')).toBe('')
  })
})

describe('summariesOf', () => {
  it('carries the recipe label of the step', () => {
    const labelled = [{ ...mkStep('claude-code', 'single', 1, { id: 's1' }), label: { fr: 'Chercher', en: 'Research' } }]
    expect(summariesOf(labelled, [r({ stepId: 's1' })])[0]?.label).toEqual({ fr: 'Chercher', en: 'Research' })
  })

  it('joins results with their step, and still works for a step added by escalation', () => {
    const steps = [mkStep('claude-code', 'plan', 0, { id: 's1' })]
    const out = summariesOf(steps, [r({ stepId: 's1', text: 'Plan\nsecond', verdict: { pass: true, issues: [] } }), r({ stepId: 's9', tool: 'codex', role: 'execute', ok: false, error: 'timeout' })])
    expect(out[0]).toMatchObject({ stepId: 's1', tool: 'claude-code', role: 'plan', tier: 0, modelLabel: 'Claude Haiku', line: 'Plan', verdict: { pass: true } })
    expect(out[1]).toMatchObject({ stepId: 's9', tool: 'codex', role: 'execute', ok: false, error: 'timeout', tier: undefined })
  })
})
