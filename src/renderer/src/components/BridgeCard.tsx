import { useCallback, useEffect, useState } from 'react'
import type { BridgeStatus } from '../../../core/types'
import { api } from '../api'
import { useI18n } from '../i18n/i18n'

/** `ABCD-EFGH` for reading aloud or typing. */
const spaced = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`

/** Settings card « Browser access » (desktop only): state, address, pairing code, connected browsers, revoke. */
export function BridgeCard() {
  const { t, errorText } = useI18n()
  const [st, setSt] = useState<BridgeStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSt(await api.bridgeStatus())
    } catch {
      /* the next tick tries again */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      setNow(Date.now())
      void refresh()
    }, 2000)
    return () => window.clearInterval(id)
  }, [refresh])

  const act = async (fn: () => Promise<BridgeStatus>): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      setSt(await fn())
    } catch (e) {
      setErr(errorText(e))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const on = st?.enabled === true
  const minutes = st?.codeExpiresAt ? Math.max(1, Math.ceil((st.codeExpiresAt - now) / 60_000)) : 0

  return (
    <div className="sg-card sg-card--raised" role="group" aria-labelledby="bridge-h">
      <h2 id="bridge-h">{t('bridge.title')}</h2>
      <div className="sg-check">
        <input id="bridge-on" type="checkbox" checked={on} disabled={busy || st === null} onChange={(e) => void act(() => api.bridgeEnable(e.target.checked))} aria-describedby="bridge-help" />
        <label htmlFor="bridge-on">{t('bridge.toggle')}</label>
      </div>
      <p id="bridge-help" className="muted small">{t('bridge.help')}</p>
      <p className="sg-status" data-status={on ? 'ok' : 'unknown'} role="status">
        <span className="sg-status__mark" aria-hidden="true" />
        {on ? t('bridge.stateOn') : t('bridge.stateOff')}
      </p>
      {err && <p className="note" data-state="failure" role="alert">{err}</p>}
      {on && st && (
        <>
          <p className="muted small">{t('bridge.url')}</p>
          <p className="bridge-url">{st.url}</p>
          <p className="muted small">{t('bridge.code')}</p>
          {st.code ? (
            <>
              <p className="bridge-code">
                <span aria-hidden="true">{spaced(st.code)}</span>
                {/* A paragraph cannot carry a label: the spelled-out code is text for a screen reader, the code itself is hidden from it. */}
                <span className="sg-visually-hidden">{t('bridge.codeLabel', { code: st.code.split('').join(' ') })}</span>
              </p>
              <p className="muted small">{t('bridge.codeValid', { n: minutes })}</p>
            </>
          ) : (
            <p className="muted small">{t('bridge.noCode')}</p>
          )}
          <p>{t('bridge.sessions', { n: st.sessions })}</p>
          <div className="row">
            <button type="button" className="sg-button" disabled={busy} onClick={() => void act(() => api.bridgeNewCode())}>
              {t('bridge.newCode')}
            </button>
            <button type="button" className="sg-button" disabled={busy} onClick={() => void act(() => api.bridgeRevoke())}>
              {t('bridge.revoke')}
            </button>
          </div>
          <p className="muted small">{t('bridge.threat')}</p>
        </>
      )}
    </div>
  )
}
