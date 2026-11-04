import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category, HistoryEntry, ToolId } from '../../../core/types'
import { api } from '../api'
import { isEscapeKey } from '../a11y'
import { Edge } from '../components/Edge'
import { OutputBlock } from '../components/OutputBlock'
import { Timeline } from '../components/Timeline'
import { stepRoleName, useI18n } from '../i18n/i18n'
import { IS_WEB } from '../transport'
import { formatElapsed } from '../runState'

interface Props {
  /** Changes whenever a run ends, so the list reloads. */
  refreshKey: string
}

interface Agg {
  runs: number
  ok: number
  ms: number
}

export function computeStats(entries: HistoryEntry[]) {
  const perTool = new Map<ToolId, Agg>()
  const perToolCat = new Map<string, Agg & { tool: ToolId; category: Category }>()
  for (const e of entries) {
    for (const r of e.results) {
      const tool = r.tool ?? e.pipeline.steps.find((s) => s.id === r.stepId)?.tool
      if (!tool) continue
      const success = r.ok && (r.verdict ? r.verdict.pass : true)
      const a = perTool.get(tool) ?? { runs: 0, ok: 0, ms: 0 }
      a.runs++
      a.ok += success ? 1 : 0
      a.ms += r.durationMs
      perTool.set(tool, a)
      const k = `${tool}|${e.classification.category}`
      const b = perToolCat.get(k) ?? { runs: 0, ok: 0, ms: 0, tool, category: e.classification.category }
      b.runs++
      b.ok += success ? 1 : 0
      b.ms += r.durationMs
      perToolCat.set(k, b)
    }
  }
  return { perTool, perToolCat }
}

export function HistoryView({ refreshKey }: Props) {
  const { t, lang, errorText } = useI18n()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [exported, setExported] = useState<Record<string, string>>({})
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)

  // The « Delete everything? » question takes the focus (on Cancel, the safe answer); when it is answered, the focus goes back to
  // the button that asked it, or to the page title when that button is gone (the history is empty).
  useEffect(() => {
    if (confirmClear) cancelRef.current?.focus()
    else if (wasConfirming.current) (document.getElementById('hist-clear') ?? document.getElementById('hist-h'))?.focus()
    wasConfirming.current = confirmClear
  }, [confirmClear])

  useEffect(() => {
    let alive = true
    api
      .historyList()
      .then((l) => alive && setEntries([...l].sort((a, b) => b.ts - a.ts)))
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [refreshKey, errorText])

  const stats = useMemo(() => computeStats(entries ?? []), [entries])

  const rate = async (e: HistoryEntry, value: 1 | -1): Promise<void> => {
    const next = e.rating === value ? null : value
    try {
      await api.historyRate(e.id, next)
      setEntries((l) => l && l.map((x) => (x.id === e.id ? { ...x, rating: next ?? undefined } : x)))
    } catch (err) {
      setError(errorText(err))
    }
  }
  const exportEntry = async (id: string): Promise<void> => {
    try {
      const r = await api.exportHistory(id)
      setExported((m) => ({ ...m, [id]: r.saved ? t('reading.exported', { name: r.name }) : t('reading.exportCancelled') }))
    } catch (err) {
      setExported((m) => ({ ...m, [id]: errorText(err) }))
    }
  }
  const clear = async (): Promise<void> => {
    try {
      await api.historyClear()
      setEntries([])
      setConfirmClear(false)
    } catch (err) {
      setError(errorText(err))
    }
  }
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' })
  const secs = (ms: number): string => t('common.seconds', { n: (ms / 1000).toFixed(1) })

  return (
    <section aria-labelledby="hist-h" className="view view-narrow">
      <header className="view-head row">
        <h1 id="hist-h" tabIndex={-1}>{t('history.title')}</h1>
        <div className="grow" />
        {!IS_WEB && entries && entries.length > 0 &&
          (confirmClear ? (
            <span
              className="row"
              role="alertdialog"
              aria-labelledby="hist-clear-q"
              onKeyDown={(e) => {
                if (isEscapeKey(e)) {
                  e.stopPropagation()
                  setConfirmClear(false)
                }
              }}
            >
              <span id="hist-clear-q">{t('history.clearConfirm')}</span>
              <button type="button" className="sg-button" onClick={() => void clear()}>{t('history.clearYes')}</button>
              <button ref={cancelRef} type="button" className="sg-button" onClick={() => setConfirmClear(false)}>{t('common.cancel')}</button>
            </span>
          ) : (
            <button id="hist-clear" type="button" className="sg-button" onClick={() => setConfirmClear(true)}>{t('history.clear')}</button>
          ))}
      </header>
      {error && <p className="note" data-state="failure" role="alert">{error}</p>}
      <Edge active={entries === null && !error} label={t('edge.label')} announce={false} />
      {entries && entries.length === 0 && (
        <div data-state="empty">
          <p>{t('history.empty')}</p>
        </div>
      )}

      {entries && entries.length > 0 && (
        <>
          <div className="sg-card sg-card--raised">
            <h2>{t('history.stats')}</h2>
            <h3>{t('history.statsRuns')}</h3>
            <ul className="statlist">
              {[...stats.perTool.entries()].map(([tool, a]) => (
                <li key={tool}>
                  <span>{t(`tool.${tool}`)}</span>
                  <strong>{a.runs}</strong>
                  <span className="muted small">{t('history.statsDuration')}: {secs(a.ms / a.runs)}</span>
                </li>
              ))}
            </ul>
            <h3>{t('history.statsPass')}</h3>
            {stats.perToolCat.size === 0 ? (
              <p className="muted">{t('history.statsNone')}</p>
            ) : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t('history.statsPass')}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('history.tool')}</th>
                      <th scope="col">{t('history.category')}</th>
                      <th scope="col">{t('history.runs')}</th>
                      <th scope="col">{t('history.rate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...stats.perToolCat.values()].map((a) => (
                      <tr key={`${a.tool}${a.category}`}>
                        <td>{t(`tool.${a.tool}`)}</td>
                        <td>{t(`cat.${a.category}`)}</td>
                        <td>{a.runs}</td>
                        <td>{Math.round((a.ok / a.runs) * 100)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <ul className="history">
            {entries.map((e) => {
              const failed = e.results.some((r) => !r.ok)
              const open = openId === e.id
              return (
                <li key={e.id} className="sg-card sg-card--raised hist-item">
                  <div className="hist-row">
                    <div className="hist-main">
                      <p id={`ht-${e.id}`} className="hist-task">{e.task.length > 220 ? e.task.slice(0, 220) + '…' : e.task}</p>
                      <p className="tags">
                        <span className="tag tag-quiet">{fmt.format(e.ts)}</span>
                        <span className="tag">{t(`cat.${e.classification.category}`)}</span>
                        <span className="tag tag-quiet">{t(`pattern.${e.pipeline.pattern}`)}</span>
                        <span className={`tag ${failed ? 'tag-strong' : ''}`}>{failed ? t('run.status.failed') : t('run.status.done')}</span>
                      </p>
                    </div>
                    <div className="rate" role="group" aria-label={t('history.rate')}>
                      <button type="button" className="sg-chip" aria-describedby={`ht-${e.id}`} aria-pressed={e.rating === 1} onClick={() => void rate(e, 1)}>
                        {t('history.rateUp')}
                      </button>
                      <button type="button" className="sg-chip" aria-describedby={`ht-${e.id}`} aria-pressed={e.rating === -1} onClick={() => void rate(e, -1)}>
                        {t('history.rateDown')}
                      </button>
                    </div>
                  </div>
                  <button type="button" className="sg-button" aria-describedby={`ht-${e.id}`} aria-expanded={open} aria-controls={`hist-${e.id}`} onClick={() => setOpenId(open ? null : e.id)}>
                    {open ? t('history.hideDetails') : t('history.details')}
                  </button>
                  {open && (
                    <div id={`hist-${e.id}`} className="hist-detail">
                      <div className="row">
                        <button type="button" className="sg-button" aria-describedby={`ht-${e.id}`} onClick={() => void exportEntry(e.id)}>
                          {t('reading.export')}
                        </button>
                        <span className="muted small" role="status" aria-live="polite">{exported[e.id] ?? ''}</span>
                      </div>
                      <details className="sg-details replay">
                        <summary>{t('replay.title')}</summary>
                        <Timeline pipeline={e.pipeline} events={e.events} />
                      </details>
                      {e.results.length === 0 && <p className="muted">{t('history.noResults')}</p>}
                      {e.results.map((r) => {
                        const step = e.pipeline.steps.find((s) => s.id === r.stepId)
                        const tool = r.tool ?? step?.tool
                        const role = r.role ?? step?.role
                        return (
                          <div key={r.stepId} className="hist-step">
                            <p className="tags">
                              {tool && <span className="tag">{t(`tool.${tool}`)}</span>}
                              {role && <span className="tag tag-quiet">{stepRoleName(lang, { role, label: step?.label })}</span>}
                              <span className={`tag ${r.ok ? '' : 'tag-strong'}`}>{r.ok ? t('run.node.ok') : t('run.node.failed')}</span>
                              <span className="tag tag-quiet">{t('history.duration', { time: formatElapsed(r.durationMs) })}</span>
                            </p>
                            {r.error && <p className="sg-notice">{t(`runerr.${r.error}`)}</p>}
                            {r.verdict && (
                              <div className="sg-notice">
                                {r.verdict.pass ? t('run.verdict.pass') : t('run.verdict.fail')}
                                {r.verdict.issues.length > 0 && (
                                  <ul className="issues">
                                    {r.verdict.issues.map((x, k) => (
                                      <li key={k}>{x}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                            {r.text.trim() ? <OutputBlock text={r.text} headingBase={3} /> : <p className="muted small">{t('run.noOutput')}</p>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
