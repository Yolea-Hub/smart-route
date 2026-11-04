import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/i18n'

import { isNoise, type LogLine } from '../logFilter'

/** Streamed events of one step. Sticks to the bottom unless the reader scrolled up. */
export function LiveLog({ lines }: { lines: LogLine[] }) {
  const { t } = useI18n()
  const rawId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [raw, setRaw] = useState(false)
  const shown = useMemo(() => (raw ? lines : lines.filter((l) => !isNoise(l))), [lines, raw])
  const hidden = lines.length - lines.filter((l) => !isNoise(l)).length

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown.length])

  if (lines.length === 0) return <p className="muted small">{t('run.logEmpty')}</p>
  return (
    <div>
      <div
        ref={ref}
        className="livelog"
        tabIndex={0}
        role="log"
        aria-live="off"
        aria-label={t('run.log')}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {shown.length === 0 && <div className="muted">{t('run.logEmpty')}</div>}
        {shown.map((l, i) => {
          const tool = !raw && l.stream === 'event' ? /^tool:\s*(.+)$/.exec(l.text) : null
          return (
            <div key={i} className={`logline ${l.stream === 'stderr' ? 'logline-err' : ''} ${tool ? 'logline-tool' : ''}`}>
              {l.stream === 'stderr' && <span className="logtag">{t('run.logStderr')}</span>}
              {tool ? t('run.logTool', { name: tool[1] }) : !raw && l.stream === 'event' && l.text === 'escalate.sameVendorBlocked' ? t('run.sameVendorBlocked') : l.text}
            </div>
          )
        })}
      </div>
      <div className="row">
        <div className="sg-check">
          <input id={rawId} type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          <label htmlFor={rawId}>{t('run.logRaw')}</label>
        </div>
        {!raw && hidden > 0 && <span className="muted small">{t('run.logHidden', { n: hidden })}</span>}
      </div>
    </div>
  )
}
