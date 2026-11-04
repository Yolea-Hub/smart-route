import { describe, expect, it } from 'vitest'

interface Audit {
  parseArgs(argv: string[]): { mode: string; urls: string[]; port: number; themes: string[]; widths: number[]; failOn: string; views: string[] | null; focusCheck: boolean; json: boolean }
  atLeast(impact: string | null, failOn: string): boolean
  summarise(
    result: { violations: { id: string; impact: string | null; help: string; helpUrl: string; nodes: { target: string[] }[] }[] },
    failOn: string
  ): { violations: { id: string; impact: string; count: number; targets: string[] }[]; failing: { id: string }[] }
}
const url = new URL('../../scripts/a11y-audit.mjs', import.meta.url).href
const audit = (await import(/* @vite-ignore */ url)) as Audit

describe('a11y-audit script', () => {
  it('parses the app mode with its defaults (both themes, serious or worse, port 9222)', () => {
    const o = audit.parseArgs(['app'])
    expect(o).toMatchObject({ mode: 'app', port: 9222, failOn: 'serious', themes: ['day', 'night'], views: null, focusCheck: true, json: false })
  })

  it('parses views, themes, port and the focus switch', () => {
    const o = audit.parseArgs(['app', '--port', '9333', '--views', 'task,plan', '--themes', 'night', '--no-focus-check', '--json'])
    expect(o).toMatchObject({ port: 9333, views: ['task', 'plan'], themes: ['night'], focusCheck: false, json: true })
  })

  it('parses the urls mode with widths', () => {
    const o = audit.parseArgs(['urls', 'http://127.0.0.1:8080/', 'http://127.0.0.1:8080/en/', '--widths', '1280,320'])
    expect(o.urls).toHaveLength(2)
    expect(o.widths).toEqual([1280, 320])
  })

  it('refuses what it cannot audit safely or sensibly', () => {
    expect(() => audit.parseArgs([])).toThrow(/app|urls/)
    expect(() => audit.parseArgs(['urls'])).toThrow(/URL/)
    expect(() => audit.parseArgs(['urls', 'javascript:alert(1)'])).toThrow(/http/)
    expect(() => audit.parseArgs(['urls', 'ftp://example.org/'])).toThrow(/http/)
    expect(() => audit.parseArgs(['app', '--host', 'example.org'])).toThrow(/local/)
    expect(() => audit.parseArgs(['app', '--port', '0'])).toThrow(/port/)
    expect(() => audit.parseArgs(['app', '--views', 'nope'])).toThrow(/unknown view/)
    expect(() => audit.parseArgs(['app', '--themes', 'blue'])).toThrow(/themes/)
    expect(() => audit.parseArgs(['app', '--fail-on', 'huge'])).toThrow(/fail-on/)
    expect(() => audit.parseArgs(['app', '--wat'])).toThrow(/unknown option/)
    expect(() => audit.parseArgs(['app', '--port'])).toThrow(/needs a value/)
  })

  it('atLeast orders minor < moderate < serious < critical', () => {
    expect(audit.atLeast('critical', 'serious')).toBe(true)
    expect(audit.atLeast('serious', 'serious')).toBe(true)
    expect(audit.atLeast('moderate', 'serious')).toBe(false)
    expect(audit.atLeast(null, 'serious')).toBe(false)
    expect(audit.atLeast('minor', 'minor')).toBe(true)
  })

  it('summarise keeps every violation and marks the ones at or above the threshold as failing', () => {
    const r = audit.summarise(
      {
        violations: [
          { id: 'color-contrast', impact: 'serious', help: 'h', helpUrl: 'u', nodes: [{ target: ['.a'] }, { target: ['main', '.b'] }] },
          { id: 'region', impact: 'moderate', help: 'h', helpUrl: 'u', nodes: [{ target: ['p'] }] }
        ]
      },
      'serious'
    )
    expect(r.violations.map((v) => v.id)).toEqual(['color-contrast', 'region'])
    expect(r.violations[0]).toMatchObject({ count: 2, targets: ['.a', 'main .b'] })
    expect(r.failing.map((v) => v.id)).toEqual(['color-contrast'])
    expect(audit.summarise({ violations: [] }, 'serious').failing).toEqual([])
  })
})
