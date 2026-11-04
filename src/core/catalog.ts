import type { Category, Effort, ModelChoice, Settings, Tier, ToolId, Vendor } from './types'

export type ToolKind = 'cli' | 'handoff'

export const TOOL_KIND: Record<ToolId, ToolKind> = {
  'claude-code': 'cli',
  codex: 'cli',
  agy: 'cli',
  cowork: 'handoff',
  'gemini-tasks': 'handoff',
  'chatgpt-work': 'handoff'
}

/** Vendor account that a tool depends on. */
export const TOOL_VENDOR: Record<ToolId, Vendor> = {
  'claude-code': 'anthropic',
  codex: 'openai',
  agy: 'google',
  cowork: 'anthropic',
  'gemini-tasks': 'google',
  'chatgpt-work': 'openai'
}

/** Exact URLs opened for handoff tools. */
export const HANDOFF_URLS: Record<'cowork' | 'gemini-tasks' | 'chatgpt-work', string> = {
  cowork: 'https://claude.ai',
  'gemini-tasks': 'https://gemini.google.com',
  'chatgpt-work': 'https://chatgpt.com'
}

export const DEFAULT_CODEX_MODEL = 'gpt-6.1-sol'
export const CODEX_EFFORT: Record<Tier, Effort> = { 0: 'low', 1: 'medium', 2: 'high', 3: 'xhigh' }

const CLAUDE_MODELS: Record<Tier, ModelChoice> = {
  0: { id: 'haiku', vendor: 'anthropic', tier: 0, label: 'Claude Haiku' },
  1: { id: 'sonnet', vendor: 'anthropic', tier: 1, label: 'Claude Sonnet' },
  2: { id: 'opus', vendor: 'anthropic', tier: 2, label: 'Claude Opus' },
  3: { id: 'fable', vendor: 'anthropic', tier: 3, label: 'Claude Fable' }
}

const AGY_MODELS: Record<Tier, ModelChoice> = {
  0: { id: 'gemini-3.8-flash-low', vendor: 'google', tier: 0, label: 'Gemini 3.8 Flash (low)' },
  1: { id: 'gemini-3.8-flash-medium', vendor: 'google', tier: 1, label: 'Gemini 3.8 Flash (medium)' },
  2: { id: 'gemini-3.8-flash-high', vendor: 'google', tier: 2, label: 'Gemini 3.8 Flash (high)' },
  3: { id: 'claude-opus-4-6-thinking', vendor: 'anthropic', tier: 3, label: 'Claude Opus 4.6 (thinking)' }
}

export function defaultCodexModels(): Settings['codexModels'] {
  return {
    '0': DEFAULT_CODEX_MODEL,
    '1': DEFAULT_CODEX_MODEL,
    '2': DEFAULT_CODEX_MODEL,
    '3': DEFAULT_CODEX_MODEL
  }
}

const WEB_MODEL = (vendor: Vendor): ModelChoice => ({ id: 'web', vendor, tier: 1, label: 'Web' })

/** The model offered by `tool` at `tier`. Codex ids come from settings (fallback: default). */
export function modelFor(tool: ToolId, tier: Tier, codexModels?: Settings['codexModels']): ModelChoice {
  switch (tool) {
    case 'claude-code':
      return { ...CLAUDE_MODELS[tier] }
    case 'agy':
      return { ...AGY_MODELS[tier] }
    case 'codex': {
      const id = codexModels?.[String(tier) as '0' | '1' | '2' | '3'] ?? DEFAULT_CODEX_MODEL
      const effort = CODEX_EFFORT[tier]
      return { id, vendor: 'openai', tier, label: `Codex ${id} (${effort})`, effort }
    }
    default:
      return WEB_MODEL(TOOL_VENDOR[tool])
  }
}

/** All model ids the user may pick for a CLI tool (used to validate edited pipelines). */
export function allowedModelIds(tool: ToolId, codexModels?: Settings['codexModels']): string[] {
  if (TOOL_KIND[tool] === 'handoff') return ['web']
  return ([0, 1, 2, 3] as Tier[]).map((t) => modelFor(tool, t, codexModels).id)
}

/** Static strength per category, 0..1. Missing = not suited. */
export const STRENGTH: Record<Category, Partial<Record<ToolId, number>>> = {
  code: { 'claude-code': 0.9, codex: 0.9, agy: 0.7 },
  debug: { 'claude-code': 0.9, codex: 0.85, agy: 0.7 },
  review: { 'claude-code': 0.9, codex: 0.8, agy: 0.7 },
  research: { agy: 0.9, 'chatgpt-work': 0.8, 'gemini-tasks': 0.85, 'claude-code': 0.6, codex: 0.5 },
  question: { 'claude-code': 0.9, agy: 0.8, codex: 0.7 },
  writing: { cowork: 0.9, 'chatgpt-work': 0.8, 'claude-code': 0.6, agy: 0.5 },
  data: { codex: 0.8, 'claude-code': 0.8, agy: 0.6 },
  design: { cowork: 0.8, 'chatgpt-work': 0.6, 'gemini-tasks': 0.5 },
  image: { 'chatgpt-work': 0.9, 'gemini-tasks': 0.8 },
  video: { 'gemini-tasks': 0.85 },
  ops: { 'claude-code': 0.8, codex: 0.7, agy: 0.5 },
  other: { 'claude-code': 0.7, codex: 0.6, agy: 0.6 }
}

export function strength(category: Category, tool: ToolId): number {
  return STRENGTH[category][tool] ?? 0
}
