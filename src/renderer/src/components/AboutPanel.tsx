import { useI18n } from '../i18n/i18n'
import { SiteLink } from './SiteLink'

/**
 * About: the founder text of yolea.ai (approved FR/EN wording, copied), one line on why Smart Route exists, and the calm link to the
 * support page. No photo: a working screen carries no people image (YOLEA.md, the images rule).
 */
export function AboutPanel() {
  const { t } = useI18n()
  return (
    <section className="sg-card sg-card--raised about" id="about" aria-labelledby="about-h" tabIndex={-1}>
      <h2 id="about-h">{t('settings.about.title')}</h2>
      <p className="about-kicker muted small">{t('about.kicker')}</p>
      <p className="about-name">{t('about.name')}</p>
      <p className="about-title muted">{t('about.title')}</p>
      <p>{t('about.text')}</p>
      <p><SiteLink id="linkedin">{t('about.link')}</SiteLink> <span className="muted small">{t('about.opensBrowser')}</span></p>
      <p>{t('about.why')}</p>
      <p>{t('about.support')}</p>
      <p><SiteLink id="support">{t('about.supportLink')}</SiteLink> <span className="muted small">{t('about.opensBrowser')}</span></p>
    </section>
  )
}
