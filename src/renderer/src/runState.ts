import { appendLog, type LogLine } from './logFilter'
import { capEvents, timedFromRunEvent } from '../../core/replay'
import type { RunEvent, RunStatus, Step, StepResult, TimedEvent, ToolId, Pipeline } from '../../core/types'

export type NodeStatus = 'pending' | 'running' | 'ok' | 'failed' | 'waiting'

export interface NodeState {
  step: Step
  status: NodeStatus
  startedAt?: number
  endedAt?: number
  result?: StepResult
  /** Set for steps added by escalation. */
  escalatedFrom?: string
  issues?: string[]
}

export interface RunState {
  runId: string
  pipeline: Pipeline
  nodes: NodeState[]
  logs: Record<string, LogLine[]>
  handoff?: { stepId: string; tool: ToolId; brief: string }
  confirm?: { stepId: string; step: Step }
  status: 'running' | RunStatus
  startedAt: number
  /** Timed events of the run so far, for the replay (same shape as the history record). */
  events: TimedEvent[]
  /** Last status change, for the aria-live region (key + params). */
  announce?: { key: string; params?: Record<string, string | number>; seq: number }
}

const MAX_LOG_LINES = 400

export function initialRun(runId: string, pipeline: Pipeline, now = Date.now()): RunState {
  return {
    runId,
    pipeline,
    nodes: pipeline.steps.map((step) => ({ step, status: 'pending' })),
    logs: {},
    status: 'running',
    startedAt: now,
    events: []
  }
}

function announce(s: RunState, key: string, params?: Record<string, string | number>): RunState['announce'] {
  return { key, params, seq: (s.announce?.seq ?? 0) + 1 }
}

/** Longest event list kept while a run streams; above it the same caps as the history record are applied. */
const LIVE_EVENTS_MAX = 4000

export function reduceRun(state: RunState | null, e: RunEvent, now = Date.now()): RunState | null {
  const next = reduceNodes(state, e, now)
  if (!state || !next || e.type === 'run-start' || next.runId !== e.runId) return next
  const added = timedFromRunEvent(e, now - state.startedAt)
  if (added.length === 0) return next
  const events = [...state.events, ...added]
  return { ...next, events: events.length > LIVE_EVENTS_MAX ? capEvents(events) : events }
}

function reduceNodes(state: RunState | null, e: RunEvent, now: number): RunState | null {
  if (e.type === 'run-start') return initialRun(e.runId, e.pipeline, now)
  if (!state || state.runId !== e.runId) return state
  switch (e.type) {
    case 'step-start': {
      const nodes = state.nodes.map((n) => {
        if (n.step.id !== e.stepId) return n
        return { ...n, status: 'running' as const, startedAt: now, endedAt: undefined }
      })
      const idx = nodes.findIndex((n) => n.step.id === e.stepId)
      return {
        ...state,
        nodes,
        // A step retry restarts a finished run without resetting its logs and results.
        status: 'running' as const,
        confirm: undefined,
        announce: announce(state, 'run.announce.start', { n: idx + 1, tool: state.nodes[idx]?.step.tool ?? '' })
      }
    }
    case 'log': {
      const list = state.logs[e.stepId] ?? []
      const next = appendLog(list, { stream: e.stream, text: e.text, delta: e.delta }).slice(-MAX_LOG_LINES)
      return { ...state, logs: { ...state.logs, [e.stepId]: next } }
    }
    case 'step-end': {
      const idx = state.nodes.findIndex((n) => n.step.id === e.result.stepId)
      const nodes = state.nodes.map((n) =>
        n.step.id === e.result.stepId
          ? { ...n, status: e.result.ok ? ('ok' as const) : ('failed' as const), endedAt: now, result: e.result }
          : n
      )
      const handoff = state.handoff?.stepId === e.result.stepId ? undefined : state.handoff
      return {
        ...state,
        nodes,
        handoff,
        announce: announce(state, 'run.announce.end', { n: idx + 1, tool: state.nodes[idx]?.step.tool ?? '' })
      }
    }
    case 'handoff': {
      const nodes = state.nodes.map((n) => (n.step.id === e.stepId ? { ...n, status: 'waiting' as const, startedAt: n.startedAt ?? now } : n))
      return {
        ...state,
        nodes,
        handoff: { stepId: e.stepId, tool: e.tool, brief: e.brief },
        announce: announce(state, 'run.announce.handoff', { tool: e.tool })
      }
    }
    case 'confirm-costly':
      return { ...state, confirm: { stepId: e.stepId, step: e.step } }
    case 'escalation': {
      if (state.nodes.some((n) => n.step.id === e.step.id)) return state
      return {
        ...state,
        nodes: [...state.nodes, { step: e.step, status: 'pending', escalatedFrom: e.fromStepId, issues: e.issues }],
        announce: announce(state, 'run.announce.escalation')
      }
    }
    case 'run-end': {
      const key = e.status === 'done' ? 'run.announce.done' : e.status === 'failed' ? 'run.announce.failed' : 'run.announce.cancelled'
      // run-end carries every result: fill any step whose step-end event was missed.
      const nodes = state.nodes.map((n) => {
        if (n.result) return n
        const r = e.results.find((x) => x.stepId === n.step.id)
        return r ? { ...n, result: r, status: r.ok ? ('ok' as const) : ('failed' as const), endedAt: n.endedAt ?? now } : n
      })
      return { ...state, nodes, status: e.status, handoff: undefined, confirm: undefined, announce: announce(state, key) }
    }
    default:
      return state
  }
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
