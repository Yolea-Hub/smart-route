import type { Role, RunErrorCode, Step, StepResult, Tier, ToolId, Verdict } from './types'

/** Last successful non-review step with text (the answer); falls back to any last step with text. */
export function finalResultOf(results: StepResult[]): StepResult | undefined {
  const withText = results.filter((r) => r.ok && r.text.trim() !== '')
  return [...withText].reverse().find((r) => r.role !== 'review') ?? withText[withText.length - 1]
}

/** First meaningful line of a step output, markdown marks removed, cut to `max` characters. Empty when there is none. */
export function summaryLine(text: string, max = 160): string {
  for (const raw of text.split('\n')) {
    if (raw.trim().startsWith('```')) continue
    const line = raw
      .replace(/^\s*(?:(?:[>#]+|[-*+]|\d+[.)])\s+)*/, '')
      .replace(/[*_`]/g, '')
      .trim()
    if (line) return line.length > max ? line.slice(0, max - 1) + '…' : line
  }
  return ''
}

/** What the panel « What each tool did » shows for one step. */
export interface StepSummary {
  stepId: string
  tool?: ToolId
  role?: Role
  /** The recipe's own bilingual name for the step (« Chercher / Research »), when it has one. */
  label?: { fr: string; en: string }
  tier?: Tier
  modelLabel?: string
  ok: boolean
  durationMs: number
  error?: RunErrorCode
  /** First line of the output, or empty. */
  line: string
  verdict?: Verdict
}

/** One summary per result, in order. `steps` gives the model of each step; a step added by escalation falls back to what the result says. */
export function summariesOf(steps: Step[], results: StepResult[]): StepSummary[] {
  return results.map((r) => {
    const step = steps.find((s) => s.id === r.stepId)
    return {
      stepId: r.stepId,
      tool: r.tool ?? step?.tool,
      role: r.role ?? step?.role,
      label: step?.label,
      tier: step?.model.tier,
      modelLabel: step?.model.label,
      ok: r.ok,
      durationMs: r.durationMs,
      error: r.error,
      line: summaryLine(r.text),
      verdict: r.verdict
    }
  })
}
