import { useRef, useState } from 'react'
import { didYouKnow } from '../../../core/atlas'
import type { StepSummary } from '../../../core/result'
import type { Category, ToolId } from '../../../core/types'
import { TOOL_VENDOR } from '../../../core/catalog'
import { api } from '../api'
import { IS_WEB } from '../transport'
import { stepRoleName, useI18n } from '../i18n/i18n'
import { renderMarkdown } from '../markdown'
import { formatElapsed } from '../runState'
import { copyText, splitFences } from './OutputBlock'
import { VendorLogo } from './VendorLogo'

interface Props {
  /** The final answer, as the tools wrote it. */
  text: string
  /** One entry per step, for the panel « What each tool did ». */
  steps: StepSummary[]
  /** Id of the saved run (history): enables the export. Null while the run is not saved. */
  historyId: string | null
  /** Id of the folder the run worked in: enables « Open folder ». Null for a run in the temporary folder. */
  folderId: string | null
  /** Category and task text of the run: they pick the « Did you know? » line (same task, same line). */
  category?: Category
  seed?: string
}

/**
 * The result as a page to read: Newsreader, 560 px measure, the existing markdown renderer, then Copy, Export .md, Open folder,
 * and what each tool did. Nothing here sends anything anywhere.
 */
export function ReadingPage({ text, steps, historyId, folderId, category, seed }: Props) {
  const { t, lang, errorText } = useI18n()
  const [msg, setMsg] = useState('')
  const timer = useRef(0)
  const say = (m: string): void => {
    setMsg(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(''), 4000)
  }
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      say(errorText(e))
    }
  }
  const segments = splitFences(text)
  const used = steps.map((s) => s.tool).filter((x): x is ToolId => x !== undefined)
  const tip = category ? didYouKnow(category, used, seed ?? text.slice(0, 200), lang) : undefined

  return (
    <article className="reading" aria-labelledby="reading-h">
      <h2 id="reading-h" className="reading-title">{t('run.finalResult')}</h2>
      <div className="reading-body sg-measure">
        {segments.map((s, i) =>
          s.code ? (
            <pre key={i} className="code" data-lang={s.lang || undefined}>
              <code>{s.text}</code>
            </pre>
          ) : (
            <div key={i} className="prose md">{renderMarkdown(s.text, `m${i}`, 3)}</div>
          )
        )}
      </div>

      <div className="reading-tools" role="group" aria-label={t('reading.actions')}>
        <button
          type="button"
          className="sg-button"
          onClick={() => void guard(async () => say((await copyText(text)) ? t('run.copied') : t('reading.copyFailed')))}
        >
          {t('run.copy')}
        </button>
        <button
          type="button"
          className="sg-button"
          disabled={!historyId}
          onClick={() =>
            void guard(async () => {
              if (!historyId) return
              const r = await api.exportHistory(historyId)
              say(r.saved ? t('reading.exported', { name: r.name }) : t('reading.exportCancelled'))
            })
          }
        >
          {t('reading.export')}
        </button>
        {folderId && !IS_WEB && (
          <button type="button" className="sg-button" onClick={() => void guard(async () => void (await api.openFolder(folderId)))}>
            {t('reading.openFolder')}
          </button>
        )}
      </div>
      <p className="muted small" role="status" aria-live="polite">{msg}</p>

      {tip && (
        <aside className="dyk" aria-labelledby="dyk-h">
          <VendorLogo vendor={TOOL_VENDOR[tip.tool]} tool={tip.tool} size={24} />
          <p>
            <strong id="dyk-h">{t('dyk.title')}</strong> {tip.text}
          </p>
        </aside>
      )}

      <section className="did" aria-labelledby="did-h">
        <h3 id="did-h">{t('reading.whatTools')}</h3>
        <ol className="did-list">
          {steps.map((s) => (
            <li key={s.stepId} className={s.tool ? `did-item v-${TOOL_VENDOR[s.tool]}` : 'did-item'}>
              {s.tool && <VendorLogo vendor={TOOL_VENDOR[s.tool]} tool={s.tool} size={28} />}
              <div className="did-main">
                <p className="did-head">
                  <strong>{s.tool ? t(`tool.${s.tool}`) : s.stepId}</strong>
                  {s.role ? ` · ${stepRoleName(lang, { role: s.role, label: s.label })}` : ''}
                  {s.tier !== undefined ? ` · ${t(`tier.${s.tier}`)}` : ''}
                  {` · ${formatElapsed(s.durationMs)}`}
                  {` · ${s.ok ? t('run.node.ok') : t('run.node.failed')}`}
                </p>
                {s.error && <p className="did-line">{t(`runerr.${s.error}`)}</p>}
                {s.verdict && (
                  <p className="did-line">
                    {s.verdict.pass ? t('run.verdict.pass') : t('run.verdict.fail')}
                    {s.verdict.issues.length > 0 ? ` · ${s.verdict.issues.join(' / ')}` : ''}
                  </p>
                )}
                {s.line && <p className="did-line">{s.line}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </article>
  )
}
