import { createElement, type ReactNode } from 'react'

/**
 * Minimal, safe Markdown renderer. It builds React elements only (React escapes all text), so raw model
 * output can never inject HTML or scripts. Links are shown as plain text with their URL in parentheses:
 * nothing is clickable, which keeps the app's link policy intact. Why not a library: no dependency to
 * pin or audit, and the subset the models actually use is small.
 */

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*)/

export function renderInline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = s
  let n = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const tok = m[0]
    const k = `${key}-${n++}`
    if (m[1]) out.push(createElement('code', { key: k, className: 'md-code' }, tok.slice(1, -1)))
    else if (m[2] || m[3]) out.push(createElement('strong', { key: k }, renderInline(tok.slice(2, -2), k)))
    else if (m[4]) {
      const close = tok.indexOf('](')
      const label = tok.slice(1, close)
      const url = tok.slice(close + 2, -1)
      out.push(createElement('span', { key: k, className: 'md-link' }, renderInline(label, k), ` (${url})`))
    } else out.push(createElement('em', { key: k }, renderInline(tok.slice(1, -1), k)))
    rest = rest.slice(m.index + tok.length)
  }
  return out
}

const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

/**
 * Render the non-code part of a message (code fences are handled by the caller). `headingBase` is the HTML level given to a `#`
 * heading (so `##` is one more, up to 6): the caller passes the level that follows the heading its block sits under, so that the
 * page never skips a level. Default 2 (under the page title).
 */
export function renderMarkdown(text: string, keyPrefix = 'md', headingBase = 2): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let b = 0
  const flushPara = (buf: string[]): void => {
    if (buf.length === 0) return
    const k = `${keyPrefix}-p${b++}`
    out.push(createElement('p', { key: k, className: 'md-p' }, renderInline(buf.join('\n'), k)))
    buf.length = 0
  }
  const para: string[] = []
  while (i < lines.length) {
    const line = lines[i]
    const h = HEADING.exec(line)
    if (h) {
      flushPara(para)
      const level = Math.min(h[1].length - 1 + Math.max(2, Math.min(headingBase, 6)), 6) // the page's own headings come first: shift down
      const k = `${keyPrefix}-h${b++}`
      out.push(createElement(`h${level}`, { key: k, className: 'md-h' }, renderInline(h[2], k)))
      i++
    } else if (BULLET.test(line) || ORDERED.test(line)) {
      flushPara(para)
      const ordered = ORDERED.test(line) && !BULLET.test(line)
      const items: ReactNode[] = []
      const k = `${keyPrefix}-l${b++}`
      while (i < lines.length) {
        const m = (ordered ? ORDERED : BULLET).exec(lines[i])
        if (!m) break
        items.push(createElement('li', { key: `${k}-${items.length}` }, renderInline(m[1], `${k}-${items.length}`)))
        i++
      }
      out.push(createElement(ordered ? 'ol' : 'ul', { key: k, className: 'md-list' }, items))
    } else if (QUOTE.test(line)) {
      flushPara(para)
      const buf: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1])
        i++
      }
      const k = `${keyPrefix}-q${b++}`
      out.push(createElement('blockquote', { key: k, className: 'md-quote' }, renderInline(buf.join('\n'), k)))
    } else if (line.trim() === '') {
      flushPara(para)
      i++
    } else {
      para.push(line)
      i++
    }
  }
  flushPara(para)
  return out
}
