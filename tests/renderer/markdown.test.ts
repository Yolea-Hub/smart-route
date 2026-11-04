import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/renderer/src/markdown'
import { isNoise } from '../../src/renderer/src/logFilter'

const html = (md: string): string => renderToStaticMarkup(createElement('div', null, renderMarkdown(md)))

describe('markdown', () => {
  it('renders bold, italic, inline code, headings and lists', () => {
    const out = html('# Titre\n\nUn **gras**, un *italique* et `code`.\n\n- a\n- b\n\n1. un\n2. deux')
    expect(out).toContain('<strong>gras</strong>')
    expect(out).toContain('<em>italique</em>')
    expect(out).toContain('<code class="md-code">code</code>')
    expect(out).toContain('<h2')
    expect(out).toContain('<ul')
    expect(out).toContain('<ol')
  })

  it('never emits raw HTML or clickable links', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> [clic](https://evil.example/x) [js](javascript:alert(1))')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('href')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('clic')
  })

  it('keeps snake_case identifiers untouched', () => {
    expect(html('use my_var_name here')).toContain('my_var_name')
  })
})

describe('live log noise filter', () => {
  it('hides bare event types, keeps text, tools and stderr', () => {
    expect(isNoise({ stream: 'event', text: 'system' })).toBe(true)
    expect(isNoise({ stream: 'event', text: 'rate_limit_event' })).toBe(true)
    expect(isNoise({ stream: 'event', text: 'thread.started' })).toBe(true)
    expect(isNoise({ stream: 'event', text: 'Yamoussoukro' })).toBe(false)
    expect(isNoise({ stream: 'event', text: 'tool: Read' })).toBe(false)
    expect(isNoise({ stream: 'stderr', text: 'system' })).toBe(false)
  })
})

describe('markdown heading levels', () => {
  const lvl = (md: string, base?: number): string[] =>
    [...renderToStaticMarkup(createElement('div', null, renderMarkdown(md, 'k', base))).matchAll(/<h(\d)/g)].map((m) => m[1] as string)

  it('a # is an h2 by default, then one level lower for each extra #, never below h6', () => {
    expect(lvl('# a\n\n## b\n\n###### c')).toEqual(['2', '3', '6'])
  })

  it('the caller sets the level under which the block sits: no level is skipped', () => {
    expect(lvl('# a\n\n## b', 4)).toEqual(['4', '5'])
    expect(lvl('# a', 3)).toEqual(['3'])
    expect(lvl('# a\n\n## b\n\n### c', 6)).toEqual(['6', '6', '6'])
  })

  it('a base outside 2 to 6 is brought back into it', () => {
    expect(lvl('# a', 1)).toEqual(['2'])
    expect(lvl('# a', 9)).toEqual(['6'])
  })
})
