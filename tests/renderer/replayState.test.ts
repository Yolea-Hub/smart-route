import { describe, expect, it } from 'vitest'
import { escalationText } from '../../src/core/replay'
import type { Pipeline, TimedEvent } from '../../src/core/types'
import { MAX_GAP_MS, compressGaps, feedAt, nodesAtTime } from '../../src/renderer/src/replayState'
import { sunPosition } from '../../src/renderer/src/sun'
import { mkStep } from '../main/helpers'

const pipeline: Pipeline = {
  pattern: 'plan-execute-review',
  steps: [mkStep('claude-code', 'execute', 1, { id: 's1' }), mkStep('codex', 'review', 1, { id: 's2' })],
  explanation: []
}
const ev = (t: number, stepId: string, kind: TimedEvent['kind'], text = ''): TimedEvent => ({ t, stepId, kind, text })
const esc = mkStep('claude-code', 'execute', 2, { id: 's3' })

const events: TimedEvent[] = [
  ev(100, 's1', 'start'),
  ev(5000, 's1', 'end', 'timeout'),
  ev(5100, 's3', 'escalation', escalationText('s1', esc)),
  ev(5200, 's3', 'start', 'escalated'),
  ev(9000, 's3', 'end', 'ok'),
  ev(9100, 's2', 'start'),
  ev(12_000, 's2', 'end', 'ok'),
  ev(12_000, 's2', 'verdict', 'pass'),
  ev(12_100, '', 'run-end', 'done')
]

describe('compressGaps', () => {
  it('shortens silences longer than the limit, keeps order, remembers the real times', () => {
    const c = compressGaps(events)
    expect(c.events).toHaveLength(events.length)
    expect(c.real).toEqual(events.map((e) => e.t))
    expect(c.duration).toBeLessThan(12_100)
    for (let i = 1; i < c.events.length; i++) {
      const dt = c.events[i]!.t - c.events[i - 1]!.t
      expect(dt).toBeGreaterThanOrEqual(0)
      expect(dt).toBeLessThanOrEqual(MAX_GAP_MS)
    }
    expect(c.events[0]!.t).toBeLessThanOrEqual(MAX_GAP_MS)
  })
  it('an empty run has no length', () => {
    expect(compressGaps([])).toEqual({ events: [], real: [], duration: 0 })
  })
  it('sorts events that arrive out of order', () => {
    expect(compressGaps([ev(50, 's1', 'end', 'ok'), ev(10, 's1', 'start')]).events.map((e) => e.kind)).toEqual(['start', 'end'])
  })
})

describe('nodesAtTime', () => {
  const at = (t: number) => nodesAtTime(pipeline, events, t)
  it('everything waits before the first event', () => {
    const s = at(50)
    expect(s.status).toBe('idle')
    expect(s.nodes.map((n) => n.status)).toEqual(['pending', 'pending'])
  })
  it('a step works between its start and its end', () => {
    const s = at(1000)
    expect(s.status).toBe('running')
    expect(s.nodes[0]?.status).toBe('running')
  })
  it('a failed step, then the escalation appears as a branch node and runs', () => {
    const failed = at(5050)
    expect(failed.nodes[0]).toMatchObject({ status: 'failed' })
    expect(failed.nodes).toHaveLength(2)
    const branch = at(5150)
    expect(branch.nodes).toHaveLength(3)
    expect(branch.nodes[2]).toMatchObject({ escalatedFrom: 's1', status: 'pending' })
    expect(at(6000).nodes[2]?.status).toBe('running')
  })
  it('the verdict seal and the final status come at the end', () => {
    const s = at(12_100)
    expect(s.status).toBe('done')
    expect(s.nodes[1]?.result?.verdict).toEqual({ pass: true, issues: [] })
    expect(s.nodes[1]?.status).toBe('ok')
  })
  it('a verdict before any end event still builds a result', () => {
    const s = nodesAtTime(pipeline, [ev(1, 's2', 'verdict', 'fail')], 10)
    expect(s.nodes[1]?.result?.verdict?.pass).toBe(false)
  })
  it('ignores events for unknown steps and a bad escalation', () => {
    const s = nodesAtTime(pipeline, [ev(1, 'zzz', 'start'), ev(2, 's9', 'escalation', 'garbage')], 10)
    expect(s.nodes).toHaveLength(2)
  })
  it('a handoff waits for the person', () => {
    expect(nodesAtTime(pipeline, [ev(1, 's1', 'handoff', 'cowork')], 10).nodes[0]?.status).toBe('waiting')
  })
})

describe('feedAt and sunPosition', () => {
  it('feedAt gives the indexes of the last events up to a time, oldest first', () => {
    expect(feedAt(events, 5200, 3)).toEqual([1, 2, 3])
    expect(feedAt(events, 0, 3)).toEqual([])
  })
  it('the sun is at the left at 06:00 and the right at 18:00, absent at night', () => {
    const at = (h: number, m = 0) => sunPosition(new Date(2026, 10, 3, h, m))
    expect(at(6)).toBe(0)
    expect(at(12)).toBe(0.5)
    expect(at(18)).toBe(1)
    expect(at(5, 59)).toBeNull()
    expect(at(18, 1)).toBeNull()
    expect(at(23)).toBeNull()
  })
})
