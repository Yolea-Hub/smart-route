import { describe, expect, it } from 'vitest'
import { EVENTS_MAX_BYTES, EventRecorder, LOG_BUDGET_BYTES, TIMED_TEXT_MAX, capEvents, escalationText, eventBytes, isTimedEvent, parseEscalation, timedFromRunEvent } from '../../src/core/replay'
import type { RunEvent, StepResult, TimedEvent } from '../../src/core/types'
import { mkStep } from '../main/helpers'

const log = (t: number, text: string): TimedEvent => ({ t, stepId: 's1', kind: 'log', text })

describe('timedFromRunEvent', () => {
  it('maps each run event to its timed form', () => {
    const step = mkStep('claude-code', 'execute', 1, { id: 's2' })
    const ok: StepResult = { stepId: 's1', ok: true, text: 'x', durationMs: 5, verdict: { pass: false, issues: ['a'] } }
    const bad: StepResult = { stepId: 's1', ok: false, text: '', durationMs: 5, error: 'timeout' }
    expect(timedFromRunEvent({ type: 'step-start', runId: 'r', stepId: 's1' }, 12.6)).toEqual([{ t: 13, stepId: 's1', kind: 'start', text: '' }])
    expect(timedFromRunEvent({ type: 'step-start', runId: 'r', stepId: 's2', escalated: true }, 1)[0]?.text).toBe('escalated')
    expect(timedFromRunEvent({ type: 'step-end', runId: 'r', result: ok }, 100).map((e) => [e.kind, e.text])).toEqual([['end', 'ok'], ['verdict', 'fail']])
    expect(timedFromRunEvent({ type: 'step-end', runId: 'r', result: bad }, 100).map((e) => [e.kind, e.text])).toEqual([['end', 'timeout']])
    expect(timedFromRunEvent({ type: 'handoff', runId: 'r', stepId: 's1', tool: 'cowork', brief: 'secret brief' }, 1)).toEqual([{ t: 1, stepId: 's1', kind: 'handoff', text: 'cowork' }])
    expect(timedFromRunEvent({ type: 'confirm-costly', runId: 'r', stepId: 's2', step }, 1)[0]?.kind).toBe('confirm')
    expect(timedFromRunEvent({ type: 'run-end', runId: 'r', status: 'done', results: [] }, 9)).toEqual([{ t: 9, stepId: '', kind: 'run-end', text: 'done' }])
    expect(timedFromRunEvent({ type: 'run-start', runId: 'r', pipeline: { pattern: 'single', steps: [step], explanation: [] } }, 0)).toEqual([])
  })

  it('cuts a log line at 500 characters, skips blank lines, never goes below 0 ms', () => {
    const long = timedFromRunEvent({ type: 'log', runId: 'r', stepId: 's1', stream: 'event', text: 'x'.repeat(2000) }, -5)
    expect(long[0]?.text).toHaveLength(TIMED_TEXT_MAX)
    expect(long[0]?.t).toBe(0)
    expect(timedFromRunEvent({ type: 'log', runId: 'r', stepId: 's1', stream: 'stderr', text: '   ' }, 1)).toEqual([])
  })

  it('an escalation carries the new step so the replay can draw the branch', () => {
    const step = mkStep('codex', 'execute', 2, { id: 's9' })
    const [e] = timedFromRunEvent({ type: 'escalation', runId: 'r', fromStepId: 's2', step, issues: [] }, 5)
    expect(e?.stepId).toBe('s9')
    expect((e?.text.length ?? 0) < TIMED_TEXT_MAX).toBe(true)
    expect(parseEscalation(e?.text ?? '')).toEqual({ from: 's2', step })
    expect(parseEscalation(escalationText('s1', step))?.step.model.label).toBe(step.model.label)
    expect(parseEscalation('not json')).toBeNull()
    expect(parseEscalation('{"from":"s1","step":{"id":3}}')).toBeNull()
  })
})

describe('isTimedEvent', () => {
  it('accepts a well-formed event and rejects the rest', () => {
    expect(isTimedEvent({ t: 1, stepId: 's1', kind: 'log', text: 'a' })).toBe(true)
    expect(isTimedEvent({ t: -1, stepId: 's1', kind: 'log', text: 'a' })).toBe(false)
    expect(isTimedEvent({ t: 1, stepId: 's1', kind: 'nope', text: 'a' })).toBe(false)
    expect(isTimedEvent({ t: 1, stepId: 's1', kind: 'log', text: 'x'.repeat(501) })).toBe(false)
    expect(isTimedEvent(null)).toBe(false)
    expect(isTimedEvent({ t: 'a', stepId: 's1', kind: 'log', text: '' })).toBe(false)
  })
})

describe('capEvents and EventRecorder', () => {
  it('keeps a run under 200 KB and gives log lines the first 150 KB only', () => {
    const many: TimedEvent[] = []
    for (let i = 0; i < 5000; i++) many.push(log(i, 'y'.repeat(200)))
    many.push({ t: 6000, stepId: 's1', kind: 'end', text: 'ok' }, { t: 6001, stepId: '', kind: 'run-end', text: 'done' })
    const capped = capEvents(many)
    const bytes = capped.reduce((n, e) => n + eventBytes(e), 0)
    expect(bytes).toBeLessThanOrEqual(EVENTS_MAX_BYTES)
    expect(capped.filter((e) => e.kind === 'log').reduce((n, e) => n + eventBytes(e), 0)).toBeLessThanOrEqual(LOG_BUDGET_BYTES)
    // the structure of the run survives however many lines were dropped
    expect(capped.at(-1)?.kind).toBe('run-end')
    expect(capped.at(-2)?.kind).toBe('end')
    expect(capEvents(many)).toEqual(capped) // deterministic
  })

  it('counts multi-byte characters by their UTF-8 size', () => {
    expect(eventBytes(log(1, 'é'))).toBe(eventBytes(log(1, 'e')) + 1)
    expect(eventBytes(log(1, '😀'))).toBe(eventBytes(log(1, 'e')) + 3)
  })

  it('the recorder applies the same budget as events arrive, with times relative to its start', () => {
    const rec = new EventRecorder(1000, 2000, 500)
    rec.push({ type: 'step-start', runId: 'r', stepId: 's1' }, 1250)
    for (let i = 0; i < 100; i++) rec.push({ type: 'log', runId: 'r', stepId: 's1', stream: 'event', text: 'z'.repeat(100) }, 1300 + i)
    rec.push({ type: 'run-end', runId: 'r', status: 'failed', results: [] }, 2000)
    const ev = rec.events
    expect(ev[0]).toEqual({ t: 250, stepId: 's1', kind: 'start', text: '' })
    expect(ev.at(-1)).toEqual({ t: 1000, stepId: '', kind: 'run-end', text: 'failed' })
    expect(ev.filter((e) => e.kind === 'log').reduce((n, e) => n + eventBytes(e), 0)).toBeLessThanOrEqual(500)
    expect(ev.reduce((n, e) => n + eventBytes(e), 0)).toBeLessThanOrEqual(2000)
  })
})
