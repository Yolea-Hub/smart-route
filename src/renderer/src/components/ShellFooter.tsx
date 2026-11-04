import type { Lang } from '../../../core/types'
import { YOLEA_DAY_URL, YOLEA_NIGHT_URL } from '../brandAssets'
import { useI18n } from '../i18n/i18n'
import { SiteLink } from './SiteLink'

/**
 * The footer of every Yolea product shell (docs/IDENTITE-PRODUIT): the Yolea logo, the house sentence, the links (including one calm
 * link to the support page), the languages, the trademark notice, and « Yolea, Abidjan. ». No popup, no nag.
 */
export function ShellFooter({ lang, onLang, onAbout }: { lang: Lang; onLang: (l: Lang) => void; onAbout?: () => void }) {
  const { t } = useI18n()
  return (
    <footer className="app-foot">
      <div className="foot-top">
        {YOLEA_DAY_URL && <img className="foot-logo foot-day" src={YOLEA_DAY_URL} alt={t('shell.yoleaAlt')} height={36} />}
        {YOLEA_NIGHT_URL && <img className="foot-logo foot-night" src={YOLEA_NIGHT_URL} alt={t('shell.yoleaAlt')} height={36} />}
        <p className="foot-line">{t('shell.footer.line')}</p>
      </div>
      <div className="foot-nav">
        <nav aria-label={t('shell.footer.nav')}>
          <ul className="foot-links">
            <li><SiteLink id="support">{t('shell.footer.support')}</SiteLink></li>
            {onAbout && (
              <li>
                <button type="button" className="sg-link sitelink" onClick={onAbout}>{t('shell.footer.about')}</button>
              </li>
            )}
            <li><SiteLink id="site">{t('shell.footer.site')}</SiteLink></li>
            <li><SiteLink id="legal">{t('shell.footer.legal')}</SiteLink></li>
            <li><SiteLink id="privacy">{t('shell.footer.privacy')}</SiteLink></li>
          </ul>
        </nav>
        <nav aria-label={t('shell.footer.languages')}>
          <ul className="foot-links">
            {(['fr', 'en'] as Lang[]).map((l) => (
              <li key={l}>
                {l === lang ? (
                  <span aria-current="true">{t(`lang.${l}`)}</span>
                ) : (
                  <button type="button" className="sg-link sitelink" lang={l} onClick={() => onLang(l)}>{t(`lang.${l}`)}</button>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="sg-caption">{t('legal.trademarks')}</p>
      <p className="sg-caption">{t('legal.owner')}</p>
    </footer>
  )
}
