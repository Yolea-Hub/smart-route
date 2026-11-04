import type { ExplainEntry } from '../../../core/types'
import { useI18n } from '../i18n/i18n'

export function WhyChips({ entries }: { entries: ExplainEntry[] }) {
  const { explain } = useI18n()
  if (entries.length === 0) return null
  return (
    <ul className="whys">
      {entries.map((e, i) => (
        <li key={i} className={`why ${e.key.startsWith('route.skip') || e.key === 'route.noTool' ? 'why-strong' : ''}`}>
          {explain(e)}
        </li>
      ))}
    </ul>
  )
}
