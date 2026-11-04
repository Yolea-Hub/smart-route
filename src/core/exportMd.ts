// Markdown export of a finished run. Pure: the main process writes the text, the web build downloads it.
import { finalResultOf, summaryLine } from './result'
import type { HistoryEntry, Lang, Role, Tier, ToolId } from './types'

type Labels = Record<
  | 'title'
  | 'task'
  | 'result'
  | 'tools'
  | 'duration'
  | 'verdictPass'
  | 'verdictFail'
  | 'issues'
  | 'ok'
  | 'failed'
  | 'noText'
  | 'footer'
  | `role.${Role}`
  | `tier.${Tier}`,
  string
>

/** Every label exists in French and in English: tests/core/exportMd.test.ts checks the two tables have the same keys. */
export const EXPORT_LABELS: Record<Lang, Labels> = {
  fr: {
    title: 'Smart Route',
    task: 'Tâche',
    result: 'Résultat',
    tools: 'Ce que chaque outil a fait',
    duration: 'durée',
    verdictPass: 'Relecture réussie',
    verdictFail: 'Relecture échouée',
    issues: 'Problèmes relevés',
    ok: 'terminé',
    failed: 'échec',
    noText: 'Aucun texte produit.',
    footer: 'Exporté depuis Smart Route, un produit Yolea.',
    'role.plan': 'Planifier',
    'role.execute': 'Exécuter',
    'role.review': 'Relire',
    'role.single': 'Étape unique',
    'tier.0': 'Économe',
    'tier.1': 'Standard',
    'tier.2': 'Puissant',
    'tier.3': 'Maximum'
  },
  en: {
    title: 'Smart Route',
    task: 'Task',
    result: 'Result',
    tools: 'What each tool did',
    duration: 'duration',
    verdictPass: 'Review passed',
    verdictFail: 'Review failed',
    issues: 'Issues found',
    ok: 'done',
    failed: 'failed',
    noText: 'No text produced.',
    footer: 'Exported from Smart Route, a Yolea product.',
    'role.plan': 'Plan',
    'role.execute': 'Execute',
    'role.review': 'Review',
    'role.single': 'Single step',
    'tier.0': 'Light',
    'tier.1': 'Standard',
    'tier.2': 'Powerful',
    'tier.3': 'Maximum'
  }
}

/** Product names are the same in both languages. */
export const EXPORT_TOOL_NAMES: Record<ToolId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  agy: 'Antigravity',
  cowork: 'Claude (claude.ai)',
  'gemini-tasks': 'Gemini (gemini.google.com)',
  'chatgpt-work': 'ChatGPT (chatgpt.com)'
}

/** Quote a block with `> ` so a task that contains markdown cannot break the layout of the export. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
}

/** `smart-route-2026-11-03-ab12cd.md`: date of the run and the first characters of its id (letters and digits only). */
export function exportFileName(entry: Pick<HistoryEntry, 'id' | 'ts'>): string {
  const day = new Date(entry.ts).toISOString().slice(0, 10)
  const id = entry.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 6)
  return `smart-route-${day}${id ? `-${id}` : ''}.md`
}

export function buildMarkdown(entry: HistoryEntry, lang: Lang): string {
  const L = EXPORT_LABELS[lang]
  const final = finalResultOf(entry.results)
  const out: string[] = [`# ${L.title}`, '', `## ${L.task}`, '', quote(entry.task.trim() || '-'), '', `## ${L.result}`, '', final ? final.text.trim() : L.noText, '', `## ${L.tools}`, '']
  entry.results.forEach((r, i) => {
    const step = entry.pipeline.steps.find((s) => s.id === r.stepId)
    const tool = r.tool ?? step?.tool
    const role = r.role ?? step?.role
    const name = tool ? EXPORT_TOOL_NAMES[tool] : r.stepId
    const bits = [role ? step?.label?.[lang] || L[`role.${role}`] : '', step ? `${L[`tier.${step.model.tier}`]} (${step.model.label})` : '', `${L.duration} ${(r.durationMs / 1000).toFixed(1)} s`, r.ok ? L.ok : L.failed].filter(Boolean)
    out.push(`${i + 1}. **${name}** · ${bits.join(' · ')}`)
    const line = summaryLine(r.text)
    if (line) out.push(`   - ${line}`)
    if (r.verdict) {
      out.push(`   - ${r.verdict.pass ? L.verdictPass : L.verdictFail}`)
      if (r.verdict.issues.length > 0) out.push(`   - ${L.issues}: ${r.verdict.issues.join(' / ')}`)
    }
  })
  out.push('', '---', '', L.footer, '')
  return out.join('\n')
}
