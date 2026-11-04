import { Fragment } from 'react'
import { TOOL_VENDOR } from '../../../core/catalog'
import type { RecipeStep } from '../../../core/recipes'
import { useI18n } from '../i18n/i18n'
import { VendorLogo } from './VendorLogo'

/** A recipe as a mini route: the logos of its tools, in order, joined by a short line. The tool names are read by screen readers. */
export function RecipeRoute({ steps, size = 28 }: { steps: readonly RecipeStep[]; size?: number }) {
  const { t } = useI18n()
  return (
    <ol className="mini-route" aria-label={t('recipes.route', { tools: steps.map((s) => t(`tool.${s.tool}`)).join(', ') })}>
      {steps.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <li className="mini-link" aria-hidden="true" />}
          <li className={`mini-node v-${TOOL_VENDOR[s.tool]}`} title={t(`tool.${s.tool}`)}>
            <VendorLogo vendor={TOOL_VENDOR[s.tool]} tool={s.tool} size={size} short />
          </li>
        </Fragment>
      ))}
    </ol>
  )
}
