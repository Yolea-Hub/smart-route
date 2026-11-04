import { Fragment, useEffect, useRef, useState } from 'react'
import type { Vendor, VendorAccountStatus } from '../../../core/types'
import { VENDORS } from '../../../core/types'
import { api } from '../api'
import { PrimaryButton } from '../components/PrimaryButton'
import { VendorBadge } from '../components/VendorLogo'
import { WebPane } from '../components/WebPane'
import { useI18n } from '../i18n/i18n'
import { IS_WEB } from '../transport'

const CLI_OF: Record<Vendor, 'claude-code' | 'codex' | 'agy'> = { anthropic: 'claude-code', openai: 'codex', google: 'agy' }
const SITE: Record<Vendor, string> = { anthropic: 'claude.ai', openai: 'chatgpt.com', google: 'gemini.google.com' }

interface Props {
  statuses: VendorAccountStatus[]
  onboarding: boolean
  onRefresh: () => Promise<void>
  rechecking: boolean
  onSignedIn: (vendor: Vendor, value: boolean) => Promise<void>
  onContinue: () => void
}

export function AccountsView({ statuses, onboarding, onRefresh, rechecking, onSignedIn, onContinue }: Props) {
  const { t, errorText, lang } = useI18n()
  const [connecting, setConnecting] = useState<Partial<Record<Vendor, boolean>>>({})
  const [notes, setNotes] = useState<Partial<Record<Vendor, string>>>({})
  const [panel, setPanel] = useState<Vendor | null>(null)
  const timers = useRef<Partial<Record<Vendor, number>>>({})

  // A connection poll ends when the status turns to connected.
  useEffect(() => {
    for (const v of VENDORS) {
      if (connecting[v] && statuses.find((s) => s.vendor === v)?.cli.state === 'connected') {
        setConnecting((c) => ({ ...c, [v]: false }))
      }
    }
  }, [statuses, connecting])
  useEffect(() => {
    const ts = timers.current
    return () => {
      for (const id of Object.values(ts)) if (id) window.clearTimeout(id)
    }
  }, [])

  const note = (v: Vendor, text: string | undefined): void => setNotes((n) => ({ ...n, [v]: text }))

  const connect = async (v: Vendor): Promise<void> => {
    note(v, undefined)
    try {
      const r = await api.connect(v)
      if (!r.opened) return note(v, t('accounts.noTerminal'))
      setConnecting((c) => ({ ...c, [v]: true }))
      // The main process polls for 5 minutes; stop showing the waiting state then.
      timers.current[v] = window.setTimeout(() => setConnecting((c) => ({ ...c, [v]: false })), 5 * 60_000)
    } catch (e) {
      note(v, errorText(e))
    }
  }
  const disconnect = async (v: Vendor): Promise<void> => {
    note(v, undefined)
    try {
      const r = await api.disconnect(v)
      if (r.result === 'unsupported') note(v, t('accounts.disconnectUnsupported'))
      else if (r.result === 'failed') note(v, t('accounts.disconnectFailed'))
      await onRefresh()
    } catch (e) {
      note(v, errorText(e))
    }
  }

  return (
    <section aria-labelledby="accounts-h" className="view">
      <header className="view-head">
        <h1 id="accounts-h" tabIndex={-1}>{onboarding ? t('accounts.onboardingTitle') : t('accounts.title')}</h1>
        {onboarding && <p className="lead">{t('accounts.onboardingBody')}</p>}
        <p className="muted">{t('accounts.privacy')}</p>
      </header>

      <div className="cards">
        {VENDORS.map((v) => {
          const s = statuses.find((x) => x.vendor === v)
          const state = s?.cli.state ?? 'unknown'
          const tool = CLI_OF[v]
          const connected = state === 'connected'
          const unknown = state === 'unknown'
          return (
            <Fragment key={v}>
            <article className={`sg-card sg-card--raised account v-${v}`} aria-labelledby={`acc-${v}`}>
              <h2 id={`acc-${v}`} className="account-name">
                <VendorBadge vendor={v} size={36} />
              </h2>

              <div className="account-block">
                <h3>{t('accounts.cli.title')}</h3>
                <p className="muted small">{t('accounts.cli.help', { tool: t(`tool.${tool}`) })}</p>
                <p className="sg-status" data-status={connected ? 'ok' : unknown ? 'surveillance' : 'unknown'} aria-live="polite">
                  <span className="sg-status__mark" aria-hidden="true" />
                  {connected && s?.cli.method
                    ? t('accounts.cli.connectedVia', { method: s.cli.method })
                    : unknown
                      ? s?.cli.lastConnectedAt !== undefined
                        ? t('accounts.cli.unknownSince', {
                            time: new Date(s.cli.lastConnectedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
                          })
                        : t('accounts.cli.unknownCheck')
                      : t(`accounts.cli.${state}`)}
                </p>
                {IS_WEB ? (
                  <p className="muted small">{t('web.desktopOnly')}</p>
                ) : (
                <div className="row">
                  {connected ? (
                    <button type="button" className="sg-button" onClick={() => void disconnect(v)}>
                      {t('accounts.disconnect')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sg-button"
                      disabled={state === 'not_installed' || connecting[v] === true}
                      onClick={() => void connect(v)}
                    >
                      {t('accounts.connect')}
                    </button>
                  )}
                </div>
                )}
                {connecting[v] && !connected && <p className="sg-notice" role="status">{t('accounts.connecting')}</p>}
                {notes[v] && <p className="note" data-state="failure" role="alert">{notes[v]}</p>}
              </div>

              {!IS_WEB && (
              <div className="account-block">
                <h3>{t('accounts.web.title')}</h3>
                <p className="muted small">{t('accounts.web.help', { site: SITE[v] })}</p>
                <div className="row">
                  <button
                    id={`panel-toggle-${v}`}
                    type="button"
                    className="sg-button"
                    aria-expanded={panel === v}
                    aria-controls={`panel-${v}`}
                    onClick={() => setPanel((p) => (p === v ? null : v))}
                  >
                    {panel === v ? t('accounts.web.closePanel') : t('accounts.web.openPanel')}
                  </button>
                </div>
                <div className="sg-check">
                  <input id={`signed-${v}`} type="checkbox" checked={s?.webSignedIn === true} onChange={(e) => void onSignedIn(v, e.target.checked)} />
                  <label htmlFor={`signed-${v}`}>{t('accounts.web.signedIn')}</label>
                </div>
              </div>
              )}
            </article>
            {/* The panel opens right after the card whose button opened it, so that Tab reaches it in the natural order. */}
            {!IS_WEB && panel === v && (
              <div className="panel-row">
                <WebPane
                  key={panel}
                  id={`panel-${v}`}
                  vendor={panel}
                  className="webpane-wide"
                  returnFocusId={`panel-toggle-${v}`}
                  label={t('accounts.web.panelOf', { vendor: t(`vendor.${panel}`) })}
                  empty={t('accounts.web.panelEmpty')}
                />
              </div>
            )}
            </Fragment>
          )
        })}
      </div>

      <div className="row actions">
        <button type="button" className="sg-button" disabled={rechecking} onClick={() => void onRefresh()}>
          {rechecking ? t('accounts.rechecking') : t('accounts.recheck')}
        </button>
        {onboarding && <PrimaryButton onClick={onContinue}>{t('accounts.continue')}</PrimaryButton>}
      </div>
    </section>
  )
}

