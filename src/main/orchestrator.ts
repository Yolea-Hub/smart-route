import { buildBrief, type BriefOptions } from '../core/brief'
import { TOOL_KIND } from '../core/catalog'
import { decideEscalation } from '../core/escalate'
import type { Availability, Lang, Pipeline, RunEvent, RunStatus, Settings, Step, StepResult, ToolId } from '../core/types'

export const HANDOFF_MAX_BYTES = 50_000
/** agy takes the prompt as an argument: keep the brief under its 100 KB cap (runner re-checks). */
export const AGY_BRIEF_BUDGET = 100 * 1024 - 512

/** Resolves pending promises keyed by run + step (handoff results, cost confirmations). */
export class PendingHub<T> {
  private readonly waiting = new Map<string, (v: T) => void>()
  private static key(runId: string, stepId: string): string {
    return `${runId}:${stepId}`
  }
  wait(runId: string, stepId: string, signal: AbortSignal, onAbort: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const key = PendingHub.key(runId, stepId)
      const done = (v: T): void => {
        this.waiting.delete(key)
        signal.removeEventListener('abort', abort)
        resolve(v)
      }
      const abort = (): void => done(onAbort)
      if (signal.aborted) return done(onAbort)
      signal.addEventListener('abort', abort, { once: true })
      this.waiting.set(key, done)
    })
  }
  /** Returns false when nothing was waiting for this key. */
  submit(runId: string, stepId: string, value: T): boolean {
    const fn = this.waiting.get(PendingHub.key(runId, stepId))
    if (!fn) return false
    fn(value)
    return true
  }
  has(runId: string, stepId: string): boolean {
    return this.waiting.has(PendingHub.key(runId, stepId))
  }
}

/** Daily per-tool run counter (persisted by store.ts). */
export interface CapStore {
  count(tool: ToolId): number
  increment(tool: ToolId): void
}

export interface OrchestratorDeps {
  runId: string
  lang: Lang
  dailyCap: number
  codexModels?: Settings['codexModels']
  runStep: (step: Step, prompt: string, cwd: string, signal: AbortSignal, onEvent: (stream: 'event' | 'stderr', text: string, delta?: boolean) => void) => Promise<StepResult>
  /** The run works in a folder the user chose (not the empty temporary one). */
  userFolder?: boolean
  caps: CapStore
  /** null = the user skipped the handoff step. */
  handoffs: PendingHub<string | null>
  confirms: PendingHub<boolean>
  /** Brief of each pending handoff + its tool, for `web:insertBrief` (text never comes from the renderer). */
  briefs: Map<string, { tool: ToolId; text: string }>
  /** Used to re-pick the reviewer when an escalation would make executor and reviewer share a vendor. */
  availability?: Availability
  now?: () => number
}

/** Brief options of a step: read-only unless it may edit, its own recipe instruction, and the budget for agy. */
function briefOpts(step: Step, userFolder: boolean | undefined): BriefOptions {
  return {
    readOnly: !step.canEdit,
    // The agy read-only steps get no read_url permission when a folder of the user is open (see buildArgs): the brief says so.
    ...(userFolder && step.tool === 'agy' && !step.canEdit ? { noWeb: true } : {}),
    step: { label: step.label, instruction: step.instruction },
    ...(step.tool === 'agy' ? { maxBytes: AGY_BRIEF_BUDGET } : {})
  }
}

export interface RunSummary {
  status: RunStatus
  results: StepResult[]
  escalated: boolean
  /** Every step actually executed, in order (includes escalated steps), for step retries. */
  executedSteps: Step[]
}

/**
 * Run a pipeline sequentially. Only this function escalates (once per pipeline).
 * Handoff steps wait until the user submits a result or skips.
 */
export async function runPipeline(
  deps: OrchestratorDeps,
  pipeline: Pipeline,
  task: string,
  cwd: string,
  emit: (e: RunEvent) => void,
  signal: AbortSignal
): Promise<RunSummary> {
  const now = deps.now ?? Date.now
  const results: StepResult[] = []
  const executedSteps: Step[] = []
  let escalated = false

  const runOne = async (step: Step, extraIssues: string[] = [], isEscalation = false): Promise<StepResult> => {
    executedSteps.push(step)
    emit({ type: 'step-start', runId: deps.runId, stepId: step.id, ...(isEscalation ? { escalated: true } : {}) })
    const started = now()
    const prompt = buildBrief(step.role, task, results, deps.lang, extraIssues, briefOpts(step, deps.userFolder))
    let result: StepResult

    if (TOOL_KIND[step.tool] === 'handoff') {
      const key = `${deps.runId}:${step.id}`
      deps.briefs.set(key, { tool: step.tool, text: prompt })
      emit({ type: 'handoff', runId: deps.runId, stepId: step.id, tool: step.tool, brief: prompt })
      const text = await deps.handoffs.wait(deps.runId, step.id, signal, null)
      deps.briefs.delete(key)
      if (signal.aborted) {
        result = { stepId: step.id, role: step.role, tool: step.tool, ok: false, text: '', error: 'cancelled', durationMs: now() - started }
      } else {
        result = {
          stepId: step.id,
          role: step.role,
          tool: step.tool,
          ok: true,
          text: Buffer.from(text ?? '', 'utf8').subarray(0, HANDOFF_MAX_BYTES).toString('utf8').replace(/�+$/, ''),
          durationMs: now() - started
        }
      }
    } else if (deps.caps.count(step.tool) >= deps.dailyCap) {
      result = { stepId: step.id, role: step.role, tool: step.tool, ok: false, text: '', error: 'cap_reached', durationMs: 0 }
    } else {
      deps.caps.increment(step.tool)
      result = await deps.runStep(step, prompt, cwd, signal, (stream, text, delta) =>
        emit({ type: 'log', runId: deps.runId, stepId: step.id, stream, text, ...(delta ? { delta: true } : {}) })
      )
    }
    results.push(result)
    emit({ type: 'step-end', runId: deps.runId, result })
    return result
  }

  const end = (status: RunStatus): RunSummary => ({ status: signal.aborted ? 'cancelled' : status, results, escalated, executedSteps })

  for (const step of pipeline.steps) {
    const r = await runOne(step)
    if (signal.aborted) return end('cancelled')
    if (!r.ok) {
      // An execute failure may still be escalated below; anything else stops the run.
      if (pipeline.pattern === 'plan-execute-review' && step.role === 'execute') break
      return end('failed')
    }
  }

  if (pipeline.pattern === 'plan-execute-review') {
    const decision = decideEscalation(pipeline, results, escalated, deps.codexModels, deps.availability)
    if (decision && decision.sameVendorBlocked) {
      // Same-vendor executor and reviewer would defeat the independent review: do not escalate.
      emit({ type: 'log', runId: deps.runId, stepId: decision.step.id, stream: 'event', text: 'escalate.sameVendorBlocked' })
      return end('failed')
    }
    if (decision) {
      if (decision.needsConfirm) {
        emit({ type: 'confirm-costly', runId: deps.runId, stepId: decision.step.id, step: decision.step })
        const accepted = await deps.confirms.wait(deps.runId, decision.step.id, signal, false)
        if (signal.aborted) return end('cancelled')
        if (!accepted) return end('failed')
      }
      escalated = true
      emit({ type: 'escalation', runId: deps.runId, fromStepId: (pipeline.steps[decision.executeIndex] as Step).id, step: decision.step, issues: decision.issues })
      const exec = await runOne(decision.step, decision.issues, true)
      if (signal.aborted) return end('cancelled')
      if (!exec.ok) return end('failed')
      if (decision.reviewStep) {
        const reviewStep = decision.reviewStep
        const again = await runOne({ ...reviewStep, id: `${reviewStep.id}-2` })
        if (signal.aborted) return end('cancelled')
        if (!again.ok || (again.verdict && !again.verdict.pass)) return end('failed')
      }
      return end('done')
    }
    // No escalation: a failed execute (non-escalatable) or a failing review ends the run as failed.
    const execStep = pipeline.steps.find((s) => s.role === 'execute')
    const execResult = execStep ? results.find((r) => r.stepId === execStep.id) : undefined
    if (execResult && !execResult.ok) return end('failed')
    const reviewResult = results.find((r) => r.role === 'review')
    if (reviewResult && (!reviewResult.ok || (reviewResult.verdict && !reviewResult.verdict.pass))) return end('failed')
  }
  return end('done')
}


/**
 * Re-run ONE failed step (same model, no escalation) with the results that preceded it as context.
 * Used by the Retry button after a network error. Handoff steps are not retried here.
 */
export async function retryStep(
  deps: Pick<OrchestratorDeps, 'runId' | 'lang' | 'dailyCap' | 'runStep' | 'caps' | 'userFolder'>,
  step: Step,
  task: string,
  cwd: string,
  prior: StepResult[],
  emit: (e: RunEvent) => void,
  signal: AbortSignal
): Promise<StepResult> {
  emit({ type: 'step-start', runId: deps.runId, stepId: step.id })
  let result: StepResult
  if (TOOL_KIND[step.tool] === 'handoff') {
    result = { stepId: step.id, role: step.role, tool: step.tool, ok: false, text: '', error: 'cancelled', durationMs: 0 }
  } else if (deps.caps.count(step.tool) >= deps.dailyCap) {
    result = { stepId: step.id, role: step.role, tool: step.tool, ok: false, text: '', error: 'cap_reached', durationMs: 0 }
  } else {
    deps.caps.increment(step.tool)
    const prompt = buildBrief(step.role, task, prior, deps.lang, [], briefOpts(step, deps.userFolder))
    result = await deps.runStep(step, prompt, cwd, signal, (stream, text, delta) =>
      emit({ type: 'log', runId: deps.runId, stepId: step.id, stream, text, ...(delta ? { delta: true } : {}) })
    )
  }
  emit({ type: 'step-end', runId: deps.runId, result })
  return result
}
