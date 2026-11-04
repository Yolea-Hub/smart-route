import { useRef, useState } from 'react'
import { useI18n } from '../i18n/i18n'
import { renderMarkdown } from '../markdown'

interface Segment {
  code: boolean
  lang: string
  text: string
}

/** Split text on ``` fences: code blocks are monospace, the rest keeps its line breaks. */
export function splitFences(text: string): Segment[] {
  const out: Segment[] = []
  const re = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push({ code: false, lang: '', text: text.slice(last, at) })
    out.push({ code: true, lang: m[1] ?? '', text: (m[2] ?? '').replace(/\n$/, '') })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ code: false, lang: '', text: text.slice(last) })
  return out.filter((s) => s.text.trim() !== '' || s.code)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

const LONG_CHARS = 900
const LONG_LINES = 16

/** `headingBase`: the level of a Markdown `#` inside this output, one below the heading that holds the block (4 under a step's « Output »). */
export function OutputBlock({ text, prominent = false, headingBase = 4 }: { text: string; prominent?: boolean; headingBase?: number }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(0)
  const long = text.length > LONG_CHARS || text.split('\n').length > LONG_LINES
  const segments = splitFences(text)

  const copy = async (): Promise<void> => {
    if (await copyText(text)) {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <div className={`output ${prominent ? 'output-prominent' : ''}`}>
      <div className="output-tools">
        <button type="button" className="sg-chip" onClick={() => void copy()}>
          {copied ? t('run.copied') : t('run.copy')}
        </button>
        {long && (
          <button type="button" className="sg-chip" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('run.showLess') : t('run.showAll')}
          </button>
        )}
        <span className="sg-visually-hidden" role="status">{copied ? t('run.copied') : ''}</span>
      </div>
      <div className={`output-body ${long && !expanded ? 'is-clamped' : ''}`}>
        {segments.map((s, i) =>
          s.code ? (
            <pre key={i} className="code" data-lang={s.lang || undefined}>
              <code>{s.text}</code>
            </pre>
          ) : (
            <div key={i} className="prose md">{renderMarkdown(s.text, `m${i}`, headingBase)}</div>
          )
        )}
      </div>
    </div>
  )
}
