import { describe, expect, it } from 'vitest'
import type { Pipeline, RunEvent } from '../../src/core/types'
import { reduceRun } from '../../src/renderer/src/runState'
import { mkStep } from '../main/helpers'

const pipeline: Pipeline = { pattern: 'single', steps: [mkStep('claude-code', 'single', 1, { id: 's1' })], explanation: [] }

describe('reduceRun keeps the timed events for the replay', () => {
  it('records start, log, end, verdict and run-end with times relative to the run start', () => {
    let s = reduceRun(null, { type: 'run-start', runId: 'r', pipeline } as RunEvent, 1000)
    expect(s?.events).toEqual([])
    s = reduceRun(s, { type: 'step-start', runId: 'r', stepId: 's1' }, 1100)
    s = reduceRun(s, { type: 'log', runId: 'r', stepId: 's1', stream: 'event', text: 'hello' }, 1200)
    s = reduceRun(s, { type: 'step-end', runId: 'r', result: { stepId: 's1', ok: true, text: 'x', durationMs: 5, verdict: { pass: true, issues: [] } } }, 1300)
    s = reduceRun(s, { type: 'run-end', runId: 'r', status: 'done', results: [] }, 1400)
    expect(s?.events.map((e) => [e.t, e.kind, e.text])).toEqual([
      [100, 'start', ''],
      [200, 'log', 'hello'],
      [300, 'end', 'ok'],
      [300, 'verdict', 'pass'],
      [400, 'run-end', 'done']
    ])
    expect(s?.status).toBe('done')
  })

  it('ignores events of another run', () => {
    const s = reduceRun(null, { type: 'run-start', runId: 'r', pipeline } as RunEvent, 0)
    expect(reduceRun(s, { type: 'step-start', runId: 'other', stepId: 's1' }, 5)).toBe(s)
  })

  it('a flood of log lines stays bounded in memory', () => {
    let s = reduceRun(null, { type: 'run-start', runId: 'r', pipeline } as RunEvent, 0)
    for (let i = 0; i < 12_000; i++) s = reduceRun(s, { type: 'log', runId: 'r', stepId: 's1', stream: 'event', text: 'line ' + i }, i)
    expect((s?.events.length ?? 0) < 8000).toBe(true)
  })
})
