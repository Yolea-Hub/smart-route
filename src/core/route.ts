import { TOOL_KIND, allowedModelIds, modelFor, strength } from './catalog'
import type {
  Availability,
  Classification,
  ExplainEntry,
  Pipeline,
  Role,
  Settings,
  Step,
  Tier,
  ToolId
} from './types'
import { CLI_TOOLS, HANDOFF_TOOLS, TOOL_IDS } from './types'

export interface RouteOptions {
  allowEdits: boolean
  timeoutSec: number
  codexModels?: Settings['codexModels']
}

const HANDOFF_TIMEOUT_SEC = 3600

/** A CLI tool is usable when installed AND connected; handoff tools open a web workspace, always usable. */
export function isUsable(avail: Availability, tool: ToolId): boolean {
  if (TOOL_KIND[tool] === 'handoff') return true
  return avail[tool].installed && avail[tool].connected
}

function pickBest(
  category: Classification['category'],
  avail: Availability,
  candidates: readonly ToolId[],
  exclude: ToolId[] = []
): ToolId | undefined {
  let best: ToolId | undefined
  let bestScore = 0
  for (const tool of candidates) {
    if (exclude.includes(tool) || !isUsable(avail, tool)) continue
    const s = strength(category, tool)
    if (s > bestScore) {
      best = tool
      bestScore = s
    }
  }
  return best
}

/** One step: only execute steps on a CLI tool may edit, and only when the user allowed edits in Settings. */
function makeStep(id: string, role: Role, tool: ToolId, tier: Tier, opts: RouteOptions): Step {
  const handoff = TOOL_KIND[tool] === 'handoff'
  return {
    id,
    role,
    tool,
    model: modelFor(tool, handoff ? 1 : tier, opts.codexModels),
    canEdit: role === 'execute' && opts.allowEdits && !handoff,
    timeoutSec: handoff ? HANDOFF_TIMEOUT_SEC : opts.timeoutSec
  }
}

export interface StepSpec {
  role: Role
  tool: ToolId
  tier: Tier
  /** Visible name of the step (recipes). */
  label?: { fr: string; en: string }
  /** What the step must do (recipes); added to its brief. */
  instruction?: { fr: string; en: string }
}

/**
 * A pipeline from a fixed list of steps (a recipe), through the same step maker as the router: edit rights come from Settings only,
 * handoff tools are always tier 1. The pattern follows the shape: plan + execute + review, any handoff step, else single.
 */
export function pipelineFromSpecs(specs: readonly StepSpec[], category: Classification['category'], opts: RouteOptions, lead: ExplainEntry[] = []): Pipeline {
  const steps = specs.map((s, i): Step => {
    const step = makeStep(`s${i + 1}`, s.role, s.tool, s.tier, opts)
    if (s.label) step.label = { fr: s.label.fr, en: s.label.en }
    if (s.instruction) step.instruction = { fr: s.instruction.fr, en: s.instruction.en }
    return step
  })
  const roles = steps.map((s) => s.role)
  const pattern: Pipeline['pattern'] = roles.includes('plan') && roles.includes('execute') && roles.includes('review')
    ? 'plan-execute-review'
    : steps.some((s) => TOOL_KIND[s.tool] === 'handoff') ? 'handoff' : 'single'
  const explanation: ExplainEntry[] = [
    ...lead,
    ...steps.map((s): ExplainEntry => ({
      key: 'route.why',
      params: { role: s.role, tool: s.tool, model: s.model.label, tier: s.model.tier, score: Math.round(strength(category, s.tool) * 100) }
    }))
  ]
  return { pattern, steps, explanation }
}

class Builder {
  steps: Step[] = []
  explanation: ExplainEntry[] = []
  constructor(
    private readonly c: Classification,
    private readonly avail: Availability,
    private readonly opts: RouteOptions
  ) {}

  add(role: Role, tool: ToolId, tier: Tier): Step {
    const step = makeStep(`s${this.steps.length + 1}`, role, tool, tier, this.opts)
    this.steps.push(step)
    this.explanation.push({
      key: 'route.why',
      params: { role, tool, model: step.model.label, tier, score: Math.round(strength(this.c.category, tool) * 100) }
    })
    return step
  }

  /** Report relevant CLI tools that cannot be used so the UI can show "Connect". */
  noteSkipped(): void {
    for (const tool of CLI_TOOLS) {
      if (strength(this.c.category, tool) <= 0 || isUsable(this.avail, tool)) continue
      this.explanation.push({
        key: this.avail[tool].installed ? 'route.skip.notConnected' : 'route.skip.notInstalled',
        params: { tool }
      })
    }
  }
}

export function routeTask(c: Classification, avail: Availability, opts: RouteOptions): Pipeline {
  const b = new Builder(c, avail, opts)
  const heavy = c.difficulty >= 2 || c.risk === 'high'
  b.noteSkipped()

  const cliBest = (exclude: ToolId[] = []): ToolId | undefined => pickBest(c.category, avail, CLI_TOOLS, exclude)
  const none = (): Pipeline => ({
    pattern: 'single',
    steps: [],
    explanation: [...b.explanation, { key: 'route.noTool' }]
  })

  switch (c.category) {
    case 'code':
    case 'debug':
    case 'ops':
    case 'data': {
      const lead = cliBest()
      if (!lead) return none()
      if (c.difficulty === 0 && !heavy) {
        b.add('single', lead, 0)
        return { pattern: 'single', steps: b.steps, explanation: b.explanation }
      }
      const planTier: Tier = heavy ? 2 : 1
      const execTier: Tier = 1
      const reviewTier: Tier = heavy ? 2 : 1
      b.add('plan', lead, planTier)
      const executor = b.add('execute', lead, execTier)
      const reviewer = pickReviewer(c, avail, executor.model.vendor, reviewTier, opts, b)
      b.add('review', reviewer, reviewTier)
      return { pattern: 'plan-execute-review', steps: b.steps, explanation: b.explanation }
    }

    case 'review': {
      const first = cliBest()
      if (!first) return none()
      const tier: Tier = heavy ? 2 : 1
      const firstStep = b.add('review', first, tier)
      if (heavy) {
        const second = pickReviewer(c, avail, firstStep.model.vendor, tier, opts, b)
        if (second !== first) b.add('review', second, tier)
      }
      return { pattern: 'single', steps: b.steps, explanation: b.explanation }
    }

    case 'research': {
      const cli = pickBest('research', avail, CLI_TOOLS)
      if (heavy) {
        const web = pickBest('research', avail, ['gemini-tasks', 'chatgpt-work'])
        if (web) {
          b.add('execute', web, 1)
          if (cli) b.add('single', cli, 2)
          return { pattern: 'handoff', steps: b.steps, explanation: b.explanation }
        }
      }
      if (!cli) return none()
      b.add('single', cli, c.difficulty === 0 ? 1 : 2)
      return { pattern: 'single', steps: b.steps, explanation: b.explanation }
    }

    case 'question': {
      // Quick factual Q&A: cheapest connected CLI (claude haiku first), always tier 0.
      const tool = cliBest()
      if (!tool) return none()
      b.add('single', tool, 0)
      return { pattern: 'single', steps: b.steps, explanation: b.explanation }
    }

    case 'writing':
    case 'design': {
      const web = pickBest(c.category, avail, HANDOFF_TOOLS)
      if (web) {
        b.add('single', web, 1)
        return { pattern: 'handoff', steps: b.steps, explanation: b.explanation }
      }
      return none()
    }

    case 'image': {
      // Image generation happens in a web workspace: ChatGPT first, Gemini as the alternative.
      b.add('single', 'chatgpt-work', 1)
      b.explanation.push({ key: 'route.image', params: { tool: 'chatgpt-work', alt: 'gemini-tasks' } })
      return { pattern: 'handoff', steps: b.steps, explanation: b.explanation }
    }

    case 'video': {
      b.add('single', 'gemini-tasks', 1)
      b.explanation.push({ key: 'route.video', params: { tool: 'gemini-tasks' } })
      return { pattern: 'handoff', steps: b.steps, explanation: b.explanation }
    }

    default: {
      const tool: ToolId | undefined = isUsable(avail, 'claude-code') ? 'claude-code' : cliBest()
      if (!tool) return none()
      b.add('single', tool, c.difficulty === 0 ? 0 : 1)
      return { pattern: 'single', steps: b.steps, explanation: b.explanation }
    }
  }
}

/** Strict variant: best usable tool (other than `exclude`) whose model vendor differs, or undefined. */
export function pickOtherVendorReviewer(
  avail: Availability,
  vendor: Step['model']['vendor'],
  tier: Tier,
  exclude: ToolId[],
  codexModels?: Settings['codexModels']
): ToolId | undefined {
  return CLI_TOOLS.filter((t) => !exclude.includes(t) && isUsable(avail, t) && strength('review', t) > 0)
    .slice()
    .sort((x, y) => strength('review', y) - strength('review', x))
    .find((t) => modelFor(t, tier, codexModels).vendor !== vendor)
}

/** Reviewer: best tool whose model vendor differs from the executor's; else best tool, with a note. */
function pickReviewer(
  c: Classification,
  avail: Availability,
  executorVendor: Step['model']['vendor'],
  tier: Tier,
  opts: RouteOptions,
  b: Builder
): ToolId {
  const ranked = CLI_TOOLS.filter((t) => isUsable(avail, t) && strength('review', t) > 0 && strength(c.category, t) > 0)
    .slice()
    .sort((x, y) => strength('review', y) - strength('review', x))
  const other = ranked.find((t) => modelFor(t, tier, opts.codexModels).vendor !== executorVendor)
  if (other) return other
  b.explanation.push({ key: 'route.reviewSameVendor' })
  // ranked is never empty here: the executor's tool is usable and has strength.
  return ranked[0] ?? 'claude-code'
}

/** A {fr, en} pair of plain strings within a length limit, else undefined (the text is only displayed or added to a brief). */
function cleanBilingual(v: unknown, max: number): { fr: string; en: string } | undefined {
  if (!v || typeof v !== 'object') return undefined
  const { fr, en } = v as { fr?: unknown; en?: unknown }
  if (typeof fr !== 'string' || typeof en !== 'string') return undefined
  const f = fr.trim().slice(0, max)
  const e = en.trim().slice(0, max)
  return f && e ? { fr: f, en: e } : undefined
}

/**
 * Validate and normalise a pipeline coming from the renderer (the user may have edited it).
 * Model ids are checked against the catalog so no free text ever reaches a CLI argument,
 * and edit rights are forced from Settings. Throws Error('err.invalidPipeline').
 */
export function sanitizePipeline(input: Pipeline, settings: Pick<Settings, 'allowEdits' | 'codexModels'>): Pipeline {
  const bad = (): never => {
    throw new Error('err.invalidPipeline')
  }
  if (!input || !Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 8) bad()
  const seen = new Set<string>()
  const steps: Step[] = input.steps.map((s) => {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(s.id) || /(-esc|-2)$/.test(s.id) || seen.has(s.id)) bad()
    seen.add(s.id)
    if (!TOOL_IDS.includes(s.tool)) bad()
    const tiers: Tier[] = [s.model.tier, 0, 1, 2, 3].filter((t): t is Tier => t === 0 || t === 1 || t === 2 || t === 3)
    const tier = tiers.find((t) => modelFor(s.tool, t, settings.codexModels).id === s.model.id)
    if (tier === undefined || !allowedModelIds(s.tool, settings.codexModels).includes(s.model.id)) bad()
    const handoff = TOOL_KIND[s.tool] === 'handoff'
    const label = cleanBilingual(s.label, 80)
    const instruction = cleanBilingual(s.instruction, 800)
    return {
      id: s.id,
      role: s.role,
      tool: s.tool,
      model: modelFor(s.tool, tier as Tier, settings.codexModels),
      canEdit: s.role === 'execute' && settings.allowEdits && s.canEdit === true && !handoff,
      timeoutSec: handoff ? HANDOFF_TIMEOUT_SEC : Math.max(10, Math.min(7200, Math.floor(s.timeoutSec) || 900)),
      ...(label ? { label } : {}),
      ...(instruction ? { instruction } : {})
    }
  })
  return { pattern: input.pattern, steps, explanation: input.explanation ?? [] }
}
