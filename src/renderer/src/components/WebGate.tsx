import { useEffect, useState } from 'react'
import type { Lang } from '../../../core/types'
import { App } from '../App'
import { I18nProvider, useI18n } from '../i18n/i18n'
import { webTransport, type WebState } from '../transport'
import { ConnectScreen } from './ConnectScreen'

function browserLang(): Lang {
  try {
    return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en'
  } catch {
    return 'fr'
  }
}

function Banner({ lang }: { lang: Lang }) {
  const { t } = useI18n()
  // The banner is in the language of the connect screen, which may differ from the one of the page behind it: it says so.
  return <p className="sg-notice" role="status" lang={lang}>{t('web.reconnecting')}</p>
}

/** Browser build entry: the connect screen until a pairing is accepted, then the same app as the desktop window. */
export function WebGate() {
  const wt = webTransport
  const [state, setState] = useState<WebState>(wt?.getState() ?? { kind: 'needs-code', error: null })
  const [lang, setLang] = useState<Lang>(browserLang)

  useEffect(() => {
    if (!wt) return
    const off = wt.subscribe(setState)
    wt.resume()
    return () => {
      off()
      wt.close()
    }
  }, [wt])

  const showApp = state.kind === 'ready' || (state.kind === 'reconnecting' && state.wasReady)
  // While the connect screen is shown, the page language is the one of that screen (also when coming back to it from the app,
  // whose own language setting had set it). The app sets it again when it is on screen.
  useEffect(() => {
    if (!showApp) document.documentElement.lang = lang
  }, [lang, showApp])

  if (!wt) return null
  return (
    <>
      {showApp && state.kind === 'reconnecting' && (
        <I18nProvider lang={lang}>
          <Banner lang={lang} />
        </I18nProvider>
      )}
      {showApp ? (
        <App />
      ) : (
        <I18nProvider lang={lang}>
          <ConnectScreen state={state} lang={lang} onLang={setLang} onPair={(c) => wt.pair(c)} onForget={() => wt.forget()} />
        </I18nProvider>
      )}
    </>
  )
}
