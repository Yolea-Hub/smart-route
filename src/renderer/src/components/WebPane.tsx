import { useEffect, useRef } from 'react'
import type { Vendor } from '../../../core/types'
import { api, boundsOf } from '../api'
import { useI18n } from '../i18n/i18n'

/** Id of the button that sends the keyboard into the panel of `vendor` (and where F6 brings it back, unless the caller names another). */
export const webPaneEntryId = (vendor: Vendor): string => `webpane-go-${vendor}`

/**
 * Placeholder div whose measured bounds position the native web panel (WebContentsView) in the main process.
 * The panel is hidden again as soon as this component unmounts or `active` turns false.
 *
 * Keyboard (WCAG 2.1.2): the panel is another page and keeps the keyboard once it has it. « Go to the panel » is the way in,
 * F6 is the way out (handled in the main process); the hint says so. When F6 brings the keyboard back, the focus goes to
 * `returnFocusId` (default: the entry button), so it is never lost on the page.
 */
export function WebPane({ vendor, label, empty, className = '', id, returnFocusId }: { vendor: Vendor; label: string; empty: string; className?: string; id?: string; returnFocusId?: string }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const entry = webPaneEntryId(vendor)

  useEffect(
    () =>
      api.onFocusReturned((u) => {
        if (u.vendor !== vendor) return
        const target = (returnFocusId ? document.getElementById(returnFocusId) : null) ?? document.getElementById(entry)
        target?.focus()
      }),
    [vendor, returnFocusId, entry]
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const push = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const b = boundsOf(el)
        if (b.width > 0 && b.height > 0) void api.webShow(vendor, b).catch(() => undefined)
      })
    }
    push()
    const ro = new ResizeObserver(push)
    ro.observe(el)
    ro.observe(document.body)
    window.addEventListener('resize', push)
    window.addEventListener('scroll', push, true)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', push)
      window.removeEventListener('scroll', push, true)
      void api.webHide().catch(() => undefined)
    }
  }, [vendor])

  return (
    <div className="webpane-wrap">
      <div className="row webpane-keys">
        <button id={entry} type="button" className="sg-button" aria-describedby={`${entry}-hint`} onClick={() => void api.webFocus(vendor).catch(() => undefined)}>
          {t('webpane.goIn')}
        </button>
        <span id={`${entry}-hint`} className="muted small">{t('webpane.hint')}</span>
      </div>
      <div ref={ref} id={id} className={`webpane v-${vendor} ${className}`} role="region" aria-label={label}>
        <p className="webpane-empty">{empty}</p>
      </div>
    </div>
  )
}
