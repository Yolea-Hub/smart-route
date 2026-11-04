// The replay of a run: from timed events to the state of the constellation at a given moment. Pure.
import { parseEscalation } from '../../core/replay'
import type { Pipeline, RunStatus, StepResult, TimedEvent } from '../../core/types'
import type { NodeState } from './runState'

/** A gap longer than this between two events is shortened, so that a replay of a ten-minute run does not sit idle. */
export const MAX_GAP_MS = 2500
const GAP_TO_MS = 1200

export interface Compressed {
  /** The events with `t` on the replay clock. */
  events: TimedEvent[]
  /** The real `t` of each event, same order. */
  real: number[]
  /** Length of the replay clock in ms. */
  duration: number
}

export function compressGaps(events: TimedEvent[]): Compressed {
  const sorted = [...events].sort((a, b) => a.t - b.t)
  const out: TimedEvent[] = []
  const real: number[] = []
  let prevReal = 0
  let clock = 0
  for (const e of sorted) {
    const dt = e.t - prevReal
    clock += dt > MAX_GAP_MS ? GAP_TO_MS : dt
    prevReal = e.t
    out.push({ ...e, t: clock })
    real.push(e.t)
  }
  return { events: out, real, duration: clock }
}

export interface ReplayState {
  nodes: NodeState[]
  status: 'idle' | 'running' | RunStatus
}

/** The nodes and the run status after every event up to `t` (replay clock) has happened. */
export function nodesAtTime(pipeline: Pipeline, events: TimedEvent[], t: number): ReplayState {
  const nodes: NodeState[] = pipeline.steps.map((step) => ({ step, status: 'pending' as const }))
  let status: ReplayState['status'] = 'idle'
  const find = (id: string): NodeState | undefined => nodes.find((n) => n.step.id === id)
  const patch = (id: string, f: (n: NodeState) => NodeState): void => {
    const i = nodes.findIndex((n) => n.step.id === id)
    if (i >= 0) nodes[i] = f(nodes[i] as NodeState)
  }
  for (const e of events) {
    if (e.t > t) break
    switch (e.kind) {
      case 'start':
        status = 'running'
        patch(e.stepId, (n) => ({ ...n, status: 'running', startedAt: e.t, endedAt: undefined }))
        break
      case 'handoff':
        patch(e.stepId, (n) => ({ ...n, status: 'waiting', startedAt: n.startedAt ?? e.t }))
        break
      case 'end': {
        const ok = e.text === 'ok'
        patch(e.stepId, (n) => {
          const result: StepResult = { stepId: e.stepId, ok, text: '', durationMs: e.t - (n.startedAt ?? e.t), ...(ok ? {} : { error: e.text as StepResult['error'] }) }
          return { ...n, status: ok ? 'ok' : 'failed', endedAt: e.t, result: { ...n.result, ...result } }
        })
        break
      }
      case 'verdict':
        patch(e.stepId, (n) => ({
          ...n,
          result: { stepId: e.stepId, ok: n.result?.ok ?? true, text: '', durationMs: n.result?.durationMs ?? 0, ...n.result, verdict: { pass: e.text === 'pass', issues: [] } }
        }))
        break
      case 'escalation': {
        const esc = parseEscalation(e.text)
        if (esc && !find(esc.step.id)) nodes.push({ step: esc.step, status: 'pending', escalatedFrom: esc.from })
        break
      }
      case 'run-end':
        status = e.text === 'done' || e.text === 'failed' || e.text === 'cancelled' ? e.text : 'failed'
        break
      default:
        break
    }
  }
  return { nodes, status }
}

/** The last `max` events at or before `t`, oldest first. */
export function feedAt(events: TimedEvent[], t: number, max: number): number[] {
  const idx: number[] = []
  for (let i = 0; i < events.length; i++) if ((events[i] as TimedEvent).t <= t) idx.push(i)
  return idx.slice(-max)
}
