// Timed events of a run, for the replay. Pure TypeScript: used by the main process (history) and by the renderer (live run).
import type { RunEvent, Step, TimedEvent } from './types'

/** A replay text is one short sentence or one output line. */
export const TIMED_TEXT_MAX = 500
/** The events of one run weigh 200 KB at most in the history file. */
export const EVENTS_MAX_BYTES = 200 * 1024
/** Log lines go first when the budget runs out: structure (start, end, verdict...) keeps the last 50 KB. */
export const LOG_BUDGET_BYTES = 150 * 1024

const KINDS: readonly string[] = ['start', 'log', 'end', 'verdict', 'handoff', 'confirm', 'escalation', 'run-end']

function clip(text: string): string {
  return text.length > TIMED_TEXT_MAX ? text.slice(0, TIMED_TEXT_MAX) : text
}

/** Weight of one event in the history file: its JSON plus the separator. */
export function eventBytes(e: TimedEvent): number {
  return utf8Length(JSON.stringify(e)) + 1
}

/** UTF-8 length without Node's Buffer, so that this file also runs in the renderer. */
function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** The timed events that one run event produces (zero, one or two). `t` is ms since the run started. */
export function timedFromRunEvent(e: RunEvent, t: number): TimedEvent[] {
  const at = Math.max(0, Math.round(t))
  switch (e.type) {
    case 'step-start':
      return [{ t: at, stepId: e.stepId, kind: 'start', text: e.escalated ? 'escalated' : '' }]
    case 'log':
      return e.text.trim() === '' ? [] : [{ t: at, stepId: e.stepId, kind: 'log', text: clip(e.text) }]
    case 'step-end': {
      const out: TimedEvent[] = [{ t: at, stepId: e.result.stepId, kind: 'end', text: e.result.ok ? 'ok' : (e.result.error ?? 'failed') }]
      if (e.result.verdict) out.push({ t: at, stepId: e.result.stepId, kind: 'verdict', text: e.result.verdict.pass ? 'pass' : 'fail' })
      return out
    }
    case 'handoff':
      return [{ t: at, stepId: e.stepId, kind: 'handoff', text: e.tool }]
    case 'confirm-costly':
      return [{ t: at, stepId: e.stepId, kind: 'confirm', text: e.step.tool }]
    case 'escalation':
      return [{ t: at, stepId: e.step.id, kind: 'escalation', text: escalationText(e.fromStepId, e.step) }]
    case 'run-end':
      return [{ t: at, stepId: '', kind: 'run-end', text: e.status }]
    default:
      return []
  }
}

/** Text of an escalation event: the step it came from and the new step, as compact JSON (well under 500 characters). */
export function escalationText(from: string, step: Step): string {
  return JSON.stringify({ from, step })
}

function isStep(x: unknown): x is Step {
  if (!x || typeof x !== 'object') return false
  const s = x as Record<string, unknown>
  const m = s['model'] as Record<string, unknown> | undefined
  return (
    typeof s['id'] === 'string' &&
    typeof s['role'] === 'string' &&
    typeof s['tool'] === 'string' &&
    typeof s['canEdit'] === 'boolean' &&
    !!m &&
    typeof m['id'] === 'string' &&
    typeof m['vendor'] === 'string' &&
    typeof m['label'] === 'string' &&
    typeof m['tier'] === 'number'
  )
}

/** Read an escalation event back. Null when the text is not what `escalationText` writes. */
export function parseEscalation(text: string): { from: string; step: Step } | null {
  try {
    const v = JSON.parse(text) as { from?: unknown; step?: unknown }
    return typeof v.from === 'string' && isStep(v.step) ? { from: v.from, step: v.step } : null
  } catch {
    return null
  }
}

/** True when `x` has the shape of a stored timed event (used when reading the history file). */
export function isTimedEvent(x: unknown): x is TimedEvent {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e['t'] === 'number' &&
    Number.isFinite(e['t']) &&
    e['t'] >= 0 &&
    typeof e['stepId'] === 'string' &&
    (e['stepId'] as string).length <= 64 &&
    typeof e['kind'] === 'string' &&
    KINDS.includes(e['kind'] as string) &&
    typeof e['text'] === 'string' &&
    (e['text'] as string).length <= TIMED_TEXT_MAX
  )
}

/**
 * Keep the events of one run under the byte budget: log lines are accepted up to LOG_BUDGET_BYTES, any other event up to
 * EVENTS_MAX_BYTES. Order is kept. Deterministic, so the same input always gives the same history row.
 */
export function capEvents(events: TimedEvent[], maxBytes: number = EVENTS_MAX_BYTES, logBytes: number = LOG_BUDGET_BYTES): TimedEvent[] {
  const out: TimedEvent[] = []
  let total = 0
  let logs = 0
  for (const raw of events) {
    const e: TimedEvent = { ...raw, text: clip(raw.text) }
    const size = eventBytes(e)
    if (e.kind === 'log') {
      if (logs + size > logBytes || total + size > maxBytes) continue
      logs += size
    } else if (total + size > maxBytes) continue
    total += size
    out.push(e)
  }
  return out
}

/** Collects the timed events of a run as its events go by; the same caps as `capEvents`, applied as they arrive. */
export class EventRecorder {
  private readonly list: TimedEvent[] = []
  private total = 0
  private logs = 0
  constructor(private readonly startedAt: number, private readonly maxBytes: number = EVENTS_MAX_BYTES, private readonly logBytes: number = LOG_BUDGET_BYTES) {}

  push(e: RunEvent, now: number): void {
    for (const te of timedFromRunEvent(e, now - this.startedAt)) {
      const size = eventBytes(te)
      if (te.kind === 'log') {
        if (this.logs + size > this.logBytes || this.total + size > this.maxBytes) continue
        this.logs += size
      } else if (this.total + size > this.maxBytes) continue
      this.total += size
      this.list.push(te)
    }
  }

  get events(): TimedEvent[] {
    return [...this.list]
  }
}
