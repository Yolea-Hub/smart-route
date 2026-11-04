import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/src/i18n/en.json'
import fr from '../../src/renderer/src/i18n/fr.json'
import { explain, translate } from '../../src/renderer/src/i18n/i18n'

const ROOT = join(__dirname, '..', '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const MAIN_FILES = [...walk(join(ROOT, 'src', 'core')), ...walk(join(ROOT, 'src', 'main')), ...walk(join(ROOT, 'src', 'preload'))].filter((f) => /\.ts$/.test(f))

/** String literals that look like an i18n key emitted by main/core. */
function emittedKeys(): Set<string> {
  const keys = new Set<string>()
  const re = /['"`]((?:err|route|classify)\.[A-Za-z0-9_.]*[A-Za-z0-9_])['"`]/g
  for (const f of MAIN_FILES) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(re)) keys.add(m[1])
  }
  return keys
}

describe('i18n', () => {
  it('fr and en have exactly the same keys', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no empty strings and the same {params} in both languages', () => {
    const params = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[k].trim(), k).not.toBe('')
      expect(fr[k].trim(), k).not.toBe('')
      expect(params(fr[k]), k).toEqual(params(en[k]))
    }
  })

  it('finds the keys emitted by main/core (scan sanity)', () => {
    const keys = emittedKeys()
    expect(keys.size).toBeGreaterThanOrEqual(15)
    expect(keys.has('err.invalidInput')).toBe(true)
    expect(keys.has('route.why')).toBe(true)
  })

  it('every err.*, route.*, classify.* key used in main/core exists in both languages', () => {
    for (const key of emittedKeys()) {
      expect(key in fr, `fr: ${key}`).toBe(true)
      expect(key in en, `en: ${key}`).toBe(true)
    }
  })

  it('every run error code has a message', () => {
    const codes = ['not_installed', 'not_logged_in', 'exit_nonzero', 'empty_output', 'bad_json', 'timeout', 'cancelled', 'stdin_epipe', 'cap_reached', 'network', 'tool_permission_denied']
    for (const c of codes) {
      expect(`runerr.${c}` in fr).toBe(true)
      expect(`runerr.${c}` in en).toBe(true)
    }
  })

  it('every literal t(...) key in the renderer exists in both languages', () => {
    const files = walk(join(ROOT, 'src', 'renderer', 'src')).filter((f) => /\.tsx?$/.test(f))
    const re = /\bt\(\s*'([a-z0-9.-]+)'/g
    let count = 0
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(re)) {
        count++
        expect(m[1] in fr, `fr: ${m[1]} (${f})`).toBe(true)
        expect(m[1] in en, `en: ${m[1]} (${f})`).toBe(true)
      }
    }
    expect(count).toBeGreaterThan(50)
  })

  it('dynamic key families are complete (tool, role, cat, diff, risk, pattern, vendor, run.status, run.node)', () => {
    const fams: Record<string, string[]> = {
      tool: ['claude-code', 'codex', 'agy', 'cowork', 'gemini-tasks', 'chatgpt-work'],
      role: ['plan', 'execute', 'review', 'single'],
      cat: ['code', 'debug', 'review', 'research', 'question', 'writing', 'data', 'design', 'ops', 'image', 'video', 'other'],
      diff: ['0', '1', '2', '3'],
      risk: ['low', 'high'],
      pattern: ['single', 'plan-execute-review', 'handoff'],
      vendor: ['anthropic', 'openai', 'google'],
      'run.status': ['running', 'done', 'failed', 'cancelled'],
      'run.node': ['pending', 'running', 'ok', 'failed', 'handoff'],
      'accounts.cli': ['connected', 'disconnected', 'not_installed', 'unknown'],
      task: ['ex1', 'ex2', 'ex3', 'ex4', 'ex5'],
      nav: ['accounts', 'task', 'plan', 'run', 'history', 'settings'],
      tier: ['0', '1', '2', '3'],
      theme: ['label', 'auto', 'day', 'night'],
      'replay.kind': ['start', 'end', 'verdict', 'handoff', 'confirm', 'escalation', 'run-end']
    }
    for (const [fam, ids] of Object.entries(fams)) {
      for (const id of ids) {
        expect(`${fam}.${id}` in fr, `fr ${fam}.${id}`).toBe(true)
        expect(`${fam}.${id}` in en, `en ${fam}.${id}`).toBe(true)
      }
    }
  })

  it('the tier words are Économe / Standard / Puissant / Maximum and Light / Standard / Powerful / Maximum', () => {
    expect(['0', '1', '2', '3'].map((i) => fr[`tier.${i}` as keyof typeof fr])).toEqual(['Économe', 'Standard', 'Puissant', 'Maximum'])
    expect(['0', '1', '2', '3'].map((i) => en[`tier.${i}` as keyof typeof en])).toEqual(['Light', 'Standard', 'Powerful', 'Maximum'])
    // the old « Niveau n » is gone from both languages
    for (const dict of [fr, en] as Record<string, string>[]) for (const [k, v] of Object.entries(dict)) expect(v, k).not.toMatch(/\b(niveau|tier) \{?\d/i)
  })

  it('a tier given as a number to a main-process message shows as its word', () => {
    expect(explain('fr', { key: 'route.why', params: { role: 'execute', tool: 'claude-code', model: 'Claude Opus', tier: 2, score: 90 } })).toContain('palier Puissant')
    expect(explain('en', { key: 'route.why', params: { role: 'execute', tool: 'claude-code', model: 'Claude Opus', tier: 2, score: 90 } })).toContain('Powerful tier')
  })

  it('the trademark line is in both languages, complete', () => {
    expect(fr['legal.trademarks']).toBe("Claude et Claude Code sont des marques d\u2019Anthropic, PBC. ChatGPT et Codex sont des marques d\u2019OpenAI. Gemini et Antigravity sont des marques de Google LLC. Smart Route est un produit indépendant de Yolea, sans lien avec ces sociétés.")
    expect(en['legal.trademarks']).toBe('Claude and Claude Code are trademarks of Anthropic, PBC. ChatGPT and Codex are trademarks of OpenAI. Gemini and Antigravity are trademarks of Google LLC. Smart Route is an independent Yolea product, not affiliated with these companies.')
  })

  it('French follows the Sogoma composition: a narrow no-break space before ; : ! ?', () => {
    for (const [k, v] of Object.entries(fr as Record<string, string>)) expect(v, k).not.toMatch(/\S[ \u00a0][;:!?]/)
  })

  it('interpolates params and falls back to the key', () => {
    expect(translate('fr', 'classify.category', { category: 'code', keywords: 'bug' })).toContain('code')
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })
})
