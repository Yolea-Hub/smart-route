import type { Lang } from '../../../core/types'
import { translate } from '../i18n/i18n'

/**
 * As on yolea.ai: one control that names the other language (FR or EN) and switches to it. Its name is written in that other
 * language (the button carries `lang`), and starts with the visible letters (WCAG 2.5.3).
 */
export function LangSwitch({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const other: Lang = lang === 'fr' ? 'en' : 'fr'
  return (
    <button type="button" className="lang-btn" lang={other} aria-label={translate(other, `lang.switchTo.${other}`)} onClick={() => onLang(other)}>
      {other.toUpperCase()}
    </button>
  )
}
