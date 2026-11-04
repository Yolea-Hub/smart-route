import { useEffect, useState } from 'react'
import { describedBy } from '../a11y'
import { useI18n } from '../i18n/i18n'
import type { WebState } from '../transport'
import { Edge } from './Edge'
import { LangSwitch } from './LangSwitch'
import { PrimaryButton } from './PrimaryButton'
import { ShellFooter } from './ShellFooter'
import { SkyBand } from './SkyBand'
import { ThemeButton } from './ThemeButton'
import type { Lang } from '../../../core/types'

/** Browser build: where the pairing code from the desktop app is typed. Also the page shown while the first connection is tried. */
export function ConnectScreen({ state, lang, onLang, onPair, onForget }: { state: WebState; lang: Lang; onLang: (l: Lang) => void; onPair: (code: string) => void; onForget: () => void }) {
  const { t, errorText } = useI18n()
  const [code, setCode] = useState('')
  const waiting = state.kind === 'connecting' || state.kind === 'reconnecting'
  const error = state.kind === 'needs-code' && state.error ? errorText(new Error(state.error)) : null
  const trimmed = code.replace(/[\s-]/g, '')

  useEffect(() => {
    document.title = `${t('web.connectTitle')} · ${t('app.name')}`
  }, [t])

  return (
    <div className="app">
      <a className="sg-skip" href="#main">{t('a11y.skip')}</a>
      <SkyBand section={t('web.connectTitle')}>
        <LangSwitch lang={lang} onLang={onLang} />
        <ThemeButton />
      </SkyBand>
      <Edge active={waiting} label={t('edge.label')} />
      <main id="main" className="view view-narrow" tabIndex={-1}>
        <h1>{t('web.connectTitle')}</h1>
        <p className="lead">{t('web.connectHelp')}</p>
        {state.kind === 'reconnecting' ? (
          <>
            <p className="sg-notice" role="status">{t('web.connecting')}</p>
            <div className="row">
              <button type="button" className="sg-button" onClick={onForget}>{t('web.useCode')}</button>
            </div>
          </>
        ) : (
          <form
            className="sg-card sg-card--raised"
            onSubmit={(e) => {
              e.preventDefault()
              if (trimmed.length > 0 && !waiting) onPair(trimmed)
            }}
          >
            <div className="sg-field connect-field">
              <label htmlFor="pair-code" className="sg-field__label">{t('web.codeLabel')}</label>
              <input
                id="pair-code"
                className="sg-field__input connect-code"
                type="text"
                value={code}
                maxLength={16}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
                aria-invalid={error !== null}
                aria-describedby={describedBy('pair-hint', error !== null && 'pair-err')}
                onChange={(e) => setCode(e.target.value)}
              />
              <span id="pair-hint" className="sg-field__helper">{t('web.codeHint')}</span>
            </div>
            {error && <p id="pair-err" className="note" data-state="failure" role="alert">{error}</p>}
            <div className="row actions">
              <PrimaryButton type="submit" disabled={waiting || trimmed.length === 0}>
                {waiting ? t('web.connecting') : t('web.connect')}
              </PrimaryButton>
            </div>
          </form>
        )}
        <p className="muted small">{t('web.localOnly')}</p>
      </main>
      <ShellFooter lang={lang} onLang={onLang} />
    </div>
  )
}
