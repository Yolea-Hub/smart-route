import type { CSSProperties, ReactNode } from 'react'
import { useI18n } from '../i18n/i18n'
import { MARK_URL, YOLEA_SKY_URL } from '../brandAssets'
import { sunPosition } from '../sun'

/**
 * The Sogoma Sky, as on yolea.ai (docs/IDENTITE-PRODUIT): Oasis deep band, the Yolea lockup made for the Sky on the left, a thin divider,
 * then the product: the Smart Route mark, « Smart Route » and « par Yolea » / « by Yolea » as text from the i18n files. Then the section
 * name and the controls. The sun disc sits at the place of the sun over the day (absent at night). The Line closes it.
 */
export function SkyBand({ section, children }: { section: string; children?: ReactNode }) {
  const { t } = useI18n()
  const sun = sunPosition(new Date())
  return (
    <>
      <header className="sg-sky app-sky" style={sun === null ? undefined : ({ '--sun-x': `${(sun * 100).toFixed(2)}%` } as CSSProperties)}>
        <div className="app-brand">
          {YOLEA_SKY_URL ? (
            <img className="app-yolea" src={YOLEA_SKY_URL} alt={t('shell.yoleaAlt')} width={100} height={28} />
          ) : (
            <span className="app-wordmark">{t('shell.yoleaAlt')}</span>
          )}
          <span className="app-divider" aria-hidden="true" />
          <span className="app-product">
            {MARK_URL && <img className="app-mark" src={MARK_URL} alt="" width={28} height={28} />}
            <span className="app-product-text">
              <span className="app-product-name">{t('app.name')}</span>
              <span className="app-by">{t('shell.by')}</span>
            </span>
          </span>
          <span className="sg-sky__name">{section}</span>
        </div>
        <div className="app-sky-tools">{children}</div>
        {sun !== null && <span className="sg-sky__sun" aria-hidden="true" />}
      </header>
      <div className="sg-line" />
    </>
  )
}
