import type { KeyboardEvent } from 'react'
import { TOOL_VENDOR } from '../../../core/catalog'
import type { ToolId } from '../../../core/types'
import { TOOL_IDS } from '../../../core/types'
import { nextGroupIndex } from '../a11y'
import { useI18n } from '../i18n/i18n'
import { VendorLogo } from './VendorLogo'

/** The tool choice of a plan step: a grid of logos (one choice, arrow keys move it, Home and End jump to the ends), in place of a drop-down. */
export function ToolPicker({ id, value, onChange }: { id: string; value: ToolId; onChange: (tool: ToolId) => void }) {
  const { t } = useI18n()
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const at = nextGroupIndex(e.key, i, TOOL_IDS.length)
    if (at === null) return
    e.preventDefault()
    const next = TOOL_IDS[at] as ToolId
    onChange(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }
  return (
    <div className="picker" role="radiogroup" aria-labelledby={`${id}-label`}>
      {TOOL_IDS.map((k, i) => (
        <button
          key={k}
          id={`${id}-${k}`}
          type="button"
          role="radio"
          aria-checked={value === k}
          tabIndex={value === k ? 0 : -1}
          className={`sg-chip picker-item v-${TOOL_VENDOR[k]}`}
          onClick={() => onChange(k)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <VendorLogo vendor={TOOL_VENDOR[k]} tool={k} size={24} short />
          <span>{t(`tool.${k}`)}</span>
        </button>
      ))}
    </div>
  )
}
