import { modelFor } from './catalog'
import { pickOtherVendorReviewer } from './route'
import type { Availability, Pipeline, RunErrorCode, Settings, Step, StepResult, Tier } from './types'

export interface EscalationDecision {
  /** Index in pipeline.steps of the execute step to re-run. */
  executeIndex: number
  /** Index of the review step to run again afterwards, or -1 when the pipeline has none. */
  reviewIndex: number
  /** The execute step at tier + 1 (same tool, new id). */
  step: Step
  /** Review issues (or the failure) to append, fenced, to the new brief. */
  issues: string[]
  /**
   * Review step to run after the escalation. Normally the pipeline's own; re-picked when the escalated
   * executor's model vendor would equal the reviewer's (e.g. agy tier 3 = Claude Opus reviewed by Claude).
   */
  reviewStep: Step | null
  /** True when the vendors collide and no other reviewer is available: the orchestrator must not escalate. */
  sameVendorBlocked: boolean
  /** Tier 3 is costly: the UI must confirm explicitly. */
  needsConfirm: boolean
}

const NON_ESCALATABLE: RunErrorCode[] = ['not_installed', 'not_logged_in', 'cancelled', 'cap_reached', 'network', 'tool_permission_denied']

/**
 * Decide whether to escalate after the pipeline's steps ran once.
 * Execute step fails (error) or review verdict pass:false -> re-run execute once at tier + 1.
 * At most one escalation per pipeline: pass `alreadyEscalated = true` after the first one.
 * Only the orchestrator calls this.
 */
export function decideEscalation(
  pipeline: Pipeline,
  results: StepResult[],
  alreadyEscalated: boolean,
  codexModels?: Settings['codexModels'],
  avail?: Availability
): EscalationDecision | null {
  if (alreadyEscalated || pipeline.pattern !== 'plan-execute-review') return null
  const executeIndex = pipeline.steps.findIndex((s) => s.role === 'execute')
  if (executeIndex < 0) return null
  const reviewIndex = pipeline.steps.findIndex((s) => s.role === 'review')
  const exec = pipeline.steps[executeIndex] as Step
  const execResult = results.find((r) => r.stepId === exec.id)
  const reviewResult = reviewIndex >= 0 ? results.find((r) => r.stepId === (pipeline.steps[reviewIndex] as Step).id) : undefined

  let issues: string[] | null = null
  if (execResult && !execResult.ok) {
    if (execResult.error && NON_ESCALATABLE.includes(execResult.error)) return null
    issues = [execResult.error ?? 'exit_nonzero']
  } else if (reviewResult?.ok && reviewResult.verdict && !reviewResult.verdict.pass) {
    issues = reviewResult.verdict.issues
  }
  if (!issues) return null

  const nextTier = exec.model.tier + 1
  if (nextTier > 3) return null
  const step: Step = {
    ...exec,
    id: `${exec.id}-esc`,
    model: modelFor(exec.tool, nextTier as Tier, codexModels)
  }
  let reviewStep: Step | null = reviewIndex >= 0 ? (pipeline.steps[reviewIndex] as Step) : null
  let sameVendorBlocked = false
  if (reviewStep && reviewStep.model.vendor === step.model.vendor) {
    const alt = avail ? pickOtherVendorReviewer(avail, step.model.vendor, reviewStep.model.tier, [step.tool], codexModels) : undefined
    if (alt) reviewStep = { ...reviewStep, tool: alt, model: modelFor(alt, reviewStep.model.tier, codexModels) }
    else sameVendorBlocked = true
  }
  return { executeIndex, reviewIndex, reviewStep, sameVendorBlocked, step, issues, needsConfirm: nextTier === 3 }
}
