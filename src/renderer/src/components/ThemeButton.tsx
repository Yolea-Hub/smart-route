import { useLayoutEffect, useRef } from 'react'
import { useI18n } from '../i18n/i18n'

/**
 * The Sogoma theme button: Auto, Day, Night. The click and the storage (`sogoma-theme`) belong to the vendored kit/web/sg-theme.js,
 * which rewrites this button's text on every click. React only sets the words, in the interface language, and the first text.
 */
export function ThemeButton() {
  const { t, lang } = useI18n()
  const ref = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const theme = document.documentElement.getAttribute('data-theme')
    el.textContent = el.getAttribute(`data-${theme === 'day' || theme === 'night' ? theme : 'auto'}`) ?? ''
    el.hidden = false
  }, [lang])
  return (
    <button
      ref={ref}
      type="button"
      className="sg-theme"
      data-auto={t('theme.named', { theme: t('theme.auto') })}
      data-day={t('theme.named', { theme: t('theme.day') })}
      data-night={t('theme.named', { theme: t('theme.night') })}
      hidden
    />
  )
}
