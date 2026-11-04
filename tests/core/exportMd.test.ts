import { describe, expect, it } from 'vitest'
import { EXPORT_LABELS, EXPORT_TOOL_NAMES, buildMarkdown, exportFileName } from '../../src/core/exportMd'
import { classify } from '../../src/core/classify'
import { TOOL_IDS } from '../../src/core/types'
import type { HistoryEntry } from '../../src/core/types'
import { mkStep } from '../main/helpers'

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  v: 2,
  id: 'ab12cd34ef56',
  ts: Date.UTC(2026, 10, 3, 12, 0, 0),
  task: 'Corrige le bug\n# pas un titre',
  classification: classify('corrige le bug'),
  pipeline: { pattern: 'plan-execute-review', steps: [mkStep('claude-code', 'execute', 2, { id: 's1' }), mkStep('codex', 'review', 1, { id: 's2' })], explanation: [] },
  results: [
    { stepId: 's1', ok: true, text: '## Résultat\nLe bug est corrigé.', durationMs: 12_345, role: 'execute', tool: 'claude-code' },
    { stepId: 's2', ok: true, text: 'RAS', durationMs: 2000, role: 'review', tool: 'codex', verdict: { pass: false, issues: ['test manquant'] } }
  ],
  events: [],
  ...over
})

describe('export labels', () => {
  it('French and English have the same keys and no empty string', () => {
    expect(Object.keys(EXPORT_LABELS.fr).sort()).toEqual(Object.keys(EXPORT_LABELS.en).sort())
    for (const lang of ['fr', 'en'] as const) for (const [k, v] of Object.entries(EXPORT_LABELS[lang])) expect(v.trim(), `${lang} ${k}`).not.toBe('')
  })
  it('names every tool', () => {
    for (const t of TOOL_IDS) expect(EXPORT_TOOL_NAMES[t]).toBeTruthy()
  })
})

describe('buildMarkdown', () => {
  it('writes the task quoted, the final answer, and what each tool did, in French', () => {
    const md = buildMarkdown(entry(), 'fr')
    expect(md).toContain('## Tâche\n\n> Corrige le bug\n> # pas un titre')
    expect(md).toContain('## Résultat\n\n## Résultat\nLe bug est corrigé.')
    expect(md).toContain('## Ce que chaque outil a fait')
    expect(md).toContain('1. **Claude Code** · Exécuter · Puissant (Claude Opus) · durée 12.3 s · terminé')
    expect(md).toContain('   - Relecture échouée')
    expect(md).toContain('test manquant')
    expect(md.endsWith('Exporté depuis Smart Route, un produit Yolea.\n')).toBe(true)
  })

  it('English uses its own words', () => {
    const md = buildMarkdown(entry(), 'en')
    expect(md).toContain('## Task')
    expect(md).toContain('## What each tool did')
    expect(md).toContain('Powerful (Claude Opus)')
    expect(md).toContain('Review failed')
    expect(md).not.toContain('Tâche')
  })

  it('says so when no step produced text', () => {
    expect(buildMarkdown(entry({ results: [] }), 'en')).toContain('No text produced.')
  })

  it('file name: date of the run and six characters of its id', () => {
    expect(exportFileName(entry())).toBe('smart-route-2026-11-03-ab12cd.md')
    expect(exportFileName({ id: '../../x', ts: 0 })).toBe('smart-route-1970-01-01-x.md')
    expect(exportFileName({ id: '///', ts: 0 })).toBe('smart-route-1970-01-01.md')
  })
})
