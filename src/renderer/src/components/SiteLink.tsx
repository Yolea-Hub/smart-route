import type { ReactNode } from 'react'
import { siteLinkUrl, type SiteLinkId } from '../../../core/siteLinks'
import { api } from '../api'
import { useI18n } from '../i18n/i18n'
import { IS_WEB } from '../transport'

/**
 * A link to one page of the Smart Route site (or to a catalog address). In the browser build it is an ordinary link; in the desktop
 * window it asks the main process, which opens the exact catalog URL in the system browser (`link:open`) and nothing else.
 */
export function SiteLink({ id, className = 'sg-link', children }: { id: SiteLinkId; className?: string; children: ReactNode }) {
  const { lang } = useI18n()
  if (IS_WEB) {
    return (
      <a className={className} href={siteLinkUrl(id, lang)} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return (
    <button type="button" className={`${className} sitelink`} onClick={() => void api.openSiteLink(id, lang).catch(() => undefined)}>
      {children}
    </button>
  )
}
