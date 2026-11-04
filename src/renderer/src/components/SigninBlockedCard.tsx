import { useEffect, useState } from 'react'
import type { Vendor } from '../../../core/types'
import { api } from '../api'
import { useI18n } from '../i18n/i18n'

/**
 * Shown above a web panel when the main process cancelled a Google sign-in in it (Google refuses OAuth in embedded app windows).
 * Keyed to the visible vendor; a new attempt while the card is open changes nothing; « Got it » closes it until the next attempt.
 */
export function SigninBlockedCard({ vendor, returnFocusId }: { vendor: Vendor; returnFocusId: string }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setShown(false)
    return api.onSigninBlocked((u) => {
      if (u.vendor === vendor) setShown(true)
    })
  }, [vendor])
  // The card moves the panel below it: tell the panel host to measure again.
  useEffect(() => {
    window.dispatchEvent(new Event('resize'))
  }, [shown])
  // The wrapper is always there, so that the card is announced when it appears; it is a named region while it is shown.
  if (!shown) return <div aria-live="polite" />
  return (
    <div aria-live="polite">
      <section className="sg-card sg-card--raised signin-blocked" aria-labelledby="signin-blocked-h">
        <h3 id="signin-blocked-h">{t('web.signinBlocked.title')}</h3>
        <p>{t(vendor === 'google' ? 'web.signinBlocked.body.google' : 'web.signinBlocked.body')}</p>
        <div className="row">
          <button type="button" className="sg-button" onClick={() => void api.openInBrowser(vendor).catch(() => undefined)}>
            {t('web.signinBlocked.openBrowser')}
          </button>
          <button
            type="button"
            className="sg-button sg-button--quiet"
            onClick={() => {
              setShown(false)
              // The card goes away with the button: the focus goes to the panel's entry button, not to the page.
              window.setTimeout(() => document.getElementById(returnFocusId)?.focus(), 0)
            }}
          >
            {t('web.signinBlocked.dismiss')}
          </button>
        </div>
      </section>
    </div>
  )
}
