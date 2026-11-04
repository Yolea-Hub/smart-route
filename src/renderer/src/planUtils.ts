import { strength, TOOL_KIND, TOOL_VENDOR } from '../../core/catalog'
import type { Classification, ExplainEntry, Pipeline, Step, VendorAccountStatus } from '../../core/types'
import type { NodeState } from './runState'
import type { Analysis } from './api'

/** An analysis plus what the plan screen needs: the pipeline as routed, and a counter that replays the reveal. */
export interface PlanState extends Analysis {
  original: Pipeline
  seq: number
}

export function isEdited(step: Step, original: Pipeline): boolean {
  const o = original.steps.find((s) => s.id === step.id)
  return !o || o.tool !== step.tool || o.model.id !== step.model.id || o.role !== step.role
}

/**
 * Explanation for the CURRENT steps. The main process emits one `route.why` entry per step, in step order;
 * those are rebuilt from the edited steps so they never go stale, and edited steps get an extra note.
 */
export function liveExplanation(plan: PlanState): ExplainEntry[] {
  const { pipeline, classification, original } = plan
  let i = 0
  const out: ExplainEntry[] = []
  for (const e of pipeline.explanation) {
    if (e.key !== 'route.why') {
      out.push(e)
      continue
    }
    const s = pipeline.steps[i++]
    if (!s) continue
    out.push({
      key: 'route.why',
      params: { role: s.role, tool: s.tool, model: s.model.label, tier: s.model.tier, score: Math.round(strength(classification.category, s.tool) * 100) }
    })
  }
  pipeline.steps.forEach((s, n) => {
    if (isEdited(s, original)) out.push({ key: 'plan.editedChip', params: { n: n + 1, tool: s.tool, model: s.model.label } })
  })
  return out
}

export function pendingNodes(p: Pipeline): NodeState[] {
  return p.steps.map((step) => ({ step, status: 'pending' as const }))
}


export interface StepFlags {
  /** CLI tool installed but not signed in (or not installed). */
  cliMissing: boolean
  /** The status check could not answer (timeout / network). Not blocking: a warning is shown instead. */
  cliUnknown: boolean
  notInstalled: boolean
  /** Web workspace the user has not ticked as signed in. */
  webNotSigned: boolean
  /** Tier >= 2 on a quota-metered CLI tool. */
  costly: boolean
  tier3: boolean
}

export function stepFlags(step: Step, statuses: VendorAccountStatus[]): StepFlags {
  const vendor = TOOL_VENDOR[step.tool]
  const st = statuses.find((s) => s.vendor === vendor)
  const cli = TOOL_KIND[step.tool] === 'cli'
  return {
    cliMissing: cli && (st?.cli.state === 'disconnected' || st?.cli.state === 'not_installed'),
    cliUnknown: cli && (!st || st.cli.state === 'unknown'),
    notInstalled: cli && st?.cli.state === 'not_installed',
    webNotSigned: !cli && st?.webSignedIn !== true,
    costly: (step.tool === 'claude-code' || step.tool === 'codex') && step.model.tier >= 2,
    tier3: step.model.tier === 3
  }
}

/** Auto mode only runs plans that need no decision from the user. */
export function canAutoRun(c: Classification, p: Pipeline, statuses: VendorAccountStatus[]): boolean {
  if (c.needsConfirm || p.steps.length === 0) return false
  return p.steps.every((s) => {
    const f = stepFlags(s, statuses)
    return !f.cliMissing && !f.cliUnknown && !f.costly && !f.tier3
  })
}
