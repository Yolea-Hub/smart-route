import { classify } from '../../src/core/classify'
import { defaultCodexModels } from '../../src/core/catalog'
import type { Availability, Category, Classification, Difficulty, Risk, ToolId } from '../../src/core/types'
import type { RouteOptions } from '../../src/core/route'

export function allAvailable(): Availability {
  const a = {} as Availability
  for (const t of ['claude-code', 'codex', 'agy', 'cowork', 'gemini-tasks', 'chatgpt-work'] as ToolId[]) a[t] = { installed: true, connected: true }
  return a
}

export const opts: RouteOptions = { allowEdits: false, timeoutSec: 900, codexModels: defaultCodexModels() }

export function cls(category: Category, difficulty: Difficulty, risk: Risk = 'low'): Classification {
  return { ...classify('x'), category, difficulty, risk, confidence: 0.9, needsConfirm: false, reasons: [] }
}
