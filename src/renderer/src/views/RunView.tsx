import { useEffect, useRef, useState } from 'react'
import { HANDOFF_URLS, TOOL_VENDOR } from '../../../core/catalog'
import { finalResultOf, summariesOf } from '../../../core/result'
import type { Category, RunErrorCode, StepResult } from '../../../core/types'
import { api } from '../api'
import { isEscapeKey } from '../a11y'
import { LiveLog } from '../components/LiveLog'
import { OutputBlock, copyText } from '../components/OutputBlock'
import { PrimaryButton } from '../components/PrimaryButton'
import { ReadingPage } from '../components/ReadingPage'
import { SigninBlockedCard } from '../components/SigninBlockedCard'
import { RouteConstellation } from '../components/RouteConstellation'
import { Timeline } from '../components/Timeline'
import { WebPane, webPaneEntryId } from '../components/WebPane'
import { stepRoleName, useI18n } from '../i18n/i18n'
import { formatElapsed, type RunState } from '../runState'
import { useNow } from '../useNow'
import { IS_WEB } from '../transport'
import { isSafeExternalUrl } from '../../../core/webPolicy'

function HandoffCard({ run }: { run: RunState }) {
  const { t, errorText } = useI18n()
  const h = run.handoff
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  if (!h) return null
  const vendor = TOOL_VENDOR[h.tool]
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      setMsg(errorText(e))
    }
  }
  return (
    <div className={`sg-card sg-card--raised handoff v-${vendor}`} role="group" aria-labelledby="handoff-h">
      <h2 id="handoff-h">{t('handoff.title', { tool: t(`tool.${h.tool}`) })}</h2>
      <p>{t('handoff.help')}</p>
      <p className="muted small">{t('handoff.neverSends')}</p>
      <details className="sg-details">
        <summary>{t('handoff.brief')}</summary>
        <pre className="pre">{h.brief}</pre>
      </details>
      {IS_WEB ? (
        <div className="row">
          <button
            type="button"
            className="sg-button"
            onClick={() =>
              void guard(async () => {
                setMsg((await copyText(h.brief)) ? t('run.copied') : t('reading.copyFailed'))
              })
            }
          >
            {t('web.copyBrief')}
          </button>
          {isSafeExternalUrl(HANDOFF_URLS[h.tool as 'cowork' | 'gemini-tasks' | 'chatgpt-work']) && (
            <a className="sg-button sg-button--quiet" href={HANDOFF_URLS[h.tool as 'cowork' | 'gemini-tasks' | 'chatgpt-work']} target="_blank" rel="noopener noreferrer">
              {t('handoff.open')}
            </a>
          )}
        </div>
      ) : (
      <div className="row">
        <button
          id="handoff-insert"
          type="button"
          className="sg-button"
          onClick={() =>
            void guard(async () => {
              await api.insertBrief(vendor, run.runId, h.stepId)
              setMsg(t('handoff.inserted'))
            })
          }
        >
          {t('handoff.insertBrief')}
        </button>
        <button
          type="button"
          className="sg-button"
          aria-describedby="capture-help"
          onClick={() =>
            void guard(async () => {
              const sel = await api.captureSelection(vendor)
              if (sel.trim()) {
                setText(sel)
                setMsg(t('handoff.captured'))
              } else setMsg(t('handoff.emptyCapture'))
            })
          }
        >
          {t('handoff.capture')}
        </button>
        <button type="button" className="sg-button sg-button--quiet" onClick={() => void guard(() => api.openLink(h.tool as 'cowork' | 'gemini-tasks' | 'chatgpt-work').then(() => undefined))}>
          {t('handoff.open')}
        </button>
      </div>
      )}
      {!IS_WEB && <p id="capture-help" className="muted small">{t('handoff.captureHelp')}</p>}
      <label htmlFor="handoff-text" className="sg-field__label">{t('handoff.paste')}</label>
      <textarea id="handoff-text" className="sg-field__input" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={1_000_000} />
      <p className="muted small" role="status">{msg}</p>
      <div className="row">
        <PrimaryButton disabled={!text.trim()} onClick={() => void guard(() => api.handoffResult(run.runId, h.stepId, text).then(() => setText('')))}>
          {t('handoff.continue')}
        </PrimaryButton>
        <button type="button" className="sg-button" onClick={() => void guard(() => api.handoffResult(run.runId, h.stepId, null).then(() => setText('')))}>
          {t('handoff.skip')}
        </button>
      </div>
    </div>
  )
}

export function RunView({ run, folderId, onNew, category, seed }: { run: RunState | null; folderId: string | null; onNew: () => void; category?: Category; seed?: string }) {
  const { t, errorText, lang } = useI18n()
  const now = useNow(run?.status === 'running')
  const [err, setErr] = useState<string | null>(null)
  const declineRef = useRef<HTMLButtonElement>(null)
  const askedBefore = useRef<string | null>(null)
  const askedId = run?.confirm?.stepId ?? null
  // The expensive-step question takes the focus (on « Skip it », the safe answer) and gives it back to the page title when answered.
  useEffect(() => {
    if (askedId) declineRef.current?.focus()
    else if (askedBefore.current) document.getElementById('run-h')?.focus()
    askedBefore.current = askedId
  }, [askedId])
  if (!run) {
    return (
      <section aria-labelledby="run-h" className="view view-narrow">
        <h1 id="run-h" tabIndex={-1}>{t('run.title')}</h1>
        <div data-state="empty">
          <p>{t('run.empty')}</p>
        </div>
      </section>
    )
  }
  const running = run.status === 'running'
  const handoffTool = run.handoff?.tool
  const guard = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      setErr(errorText(e))
    }
  }
  const results = run.nodes.map((n) => n.result).filter((r): r is StepResult => Boolean(r))
  const final = finalResultOf(results)
  const reviews = run.nodes.filter((n) => n.result?.verdict)
  const steps = run.nodes.map((n) => n.step)

  return (
    <section aria-labelledby="run-h" className="view">
      <header className="run-head">
        <h1 id="run-h" tabIndex={-1}>{t('run.title')}</h1>
        <span className={`tag st-${run.status}`}>{t(`run.status.${run.status}`)}</span>
        <span className="timer sg-tnum" aria-hidden="true">{formatElapsed((running ? now : (run.nodes.reduce((m, n) => Math.max(m, n.endedAt ?? 0), 0) || now)) - run.startedAt)}</span>
        <div className="grow" />
        {running ? (
          <button type="button" className="sg-button" onClick={() => void guard(() => api.cancelRun(run.runId))}>
            {t('run.cancel')}
          </button>
        ) : (
          <PrimaryButton onClick={onNew}>{t('run.new')}</PrimaryButton>
        )}
      </header>
      <div className="sg-visually-hidden" role="status" aria-live="polite">
        {run.announce ? t(run.announce.key, run.announce.params ? { ...run.announce.params, tool: t(`tool.${String(run.announce.params.tool)}`) } : undefined) : ''}
      </div>
      {err && <p className="note" data-state="failure" role="alert">{err}</p>}

      <div className={`run-grid ${handoffTool ? 'with-panel' : ''}`}>
        <div className="run-main">
          <RouteConstellation nodes={run.nodes} now={now} showElapsed />

          {run.confirm && (
            <div
              className="sg-readback"
              role="alertdialog"
              aria-labelledby="confirm-h"
              aria-describedby="confirm-b"
              onKeyDown={(e) => {
                if (isEscapeKey(e)) {
                  e.stopPropagation()
                  const id = run.confirm!.stepId
                  void guard(() => api.confirm(run.runId, id, false))
                }
              }}
            >
              <h2 id="confirm-h" className="sg-readback__label">{t('run.confirm.title')}</h2>
              <p id="confirm-b" className="sg-readback__sentence">
                {t('run.confirm.body', { tool: t(`tool.${run.confirm.step.tool}`), tier: t(`tier.${run.confirm.step.model.tier}`) })}
              </p>
              <div className="sg-readback__actions">
                <PrimaryButton onClick={() => void guard(() => api.confirm(run.runId, run.confirm!.stepId, true))}>
                  {t('run.confirm.accept')}
                </PrimaryButton>
                <button ref={declineRef} type="button" className="sg-button" onClick={() => void guard(() => api.confirm(run.runId, run.confirm!.stepId, false))}>
                  {t('run.confirm.decline')}
                </button>
              </div>
            </div>
          )}

          <HandoffCard key={run.handoff?.stepId ?? 'none'} run={run} />

          {final && (
            <>
              <ReadingPage text={final.text} steps={summariesOf(steps, results)} historyId={running ? null : run.runId} folderId={folderId} category={category} seed={seed} />
              {reviews.map((n) => {
                const vd = n.result?.verdict
                if (!vd) return null
                return (
                  <div key={n.step.id} className="verdict" data-pass={vd.pass ? 'true' : 'false'}>
                    <strong>{vd.pass ? t('run.verdict.pass') : t('run.verdict.fail')}</strong>{' '}
                    <span className="muted small">{t('run.reviewBy', { tool: t(`tool.${n.step.tool}`) })}</span>
                    {vd.issues.length > 0 && (
                      <>
                        <p className="small">{t('run.issues')}</p>
                        <ul className="issues">
                          {vd.issues.map((x, k) => (
                            <li key={k}>{x}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {!running && run.events.length > 0 && (
            <details className="sg-details replay">
              <summary>{t('replay.title')}</summary>
              <Timeline pipeline={run.pipeline} events={run.events} />
            </details>
          )}

          <h2 className="section-h">{t('run.log')}</h2>
          {run.nodes.map((n, i) => {
            const lines = run.logs[n.step.id] ?? []
            const r = n.result
            return (
              <details key={n.step.id} className="sg-details logcard" open={n.status !== 'pending'}>
                <summary>
                  {t('plan.step', { n: i + 1 })} · {t(`tool.${n.step.tool}`)} · {stepRoleName(lang, n.step)} ·{' '}
                  {t(n.status === 'waiting' ? 'run.node.handoff' : `run.node.${n.status}`)}
                </summary>
                {r?.error && (
                  <p className="note" data-state="failure" role="alert">
                    {t('run.stepFailedWith', { reason: t(`runerr.${r.error as RunErrorCode}`) })}
                    {(r.error === 'network' || r.error === 'tool_permission_denied') && run.status !== 'running' && (
                      <>
                        {' '}
                        <button type="button" className="sg-button" onClick={() => void api.retryStep(run.runId, n.step.id).catch(() => undefined)}>
                          {t('run.retry')}
                        </button>
                      </>
                    )}
                  </p>
                )}
                {n.issues && n.issues.length > 0 && (
                  <ul className="muted small">
                    {n.issues.map((x, k) => (
                      <li key={k}>{x}</li>
                    ))}
                  </ul>
                )}
                {(n.status === 'running' || lines.length > 0) && <LiveLog lines={lines} />}
                {r && (
                  <>
                    <h3>{t('run.output')}</h3>
                    {r.text.trim() ? <OutputBlock text={r.text} /> : <p className="muted small">{t('run.noOutput')}</p>}
                  </>
                )}
              </details>
            )
          })}
        </div>

        {handoffTool && !IS_WEB && (
          <div className="run-side">
            <SigninBlockedCard vendor={TOOL_VENDOR[handoffTool]} returnFocusId={webPaneEntryId(TOOL_VENDOR[handoffTool])} />
            <WebPane
              key={handoffTool}
              returnFocusId="handoff-insert"
              vendor={TOOL_VENDOR[handoffTool]}
              label={t('handoff.panelOf', { tool: t(`tool.${handoffTool}`) })}
              empty={t('handoff.panelEmpty')}
            />
          </div>
        )}
      </div>
    </section>
  )
}
