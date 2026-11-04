import { describe, expect, it } from 'vitest'
import { routeTask, sanitizePipeline } from '../../src/core/route'
import { allAvailable, cls, opts } from './helpers'

describe('routeTask', () => {
  it('code d0 -> single, best cli, tier 0', () => {
    const p = routeTask(cls('code', 0), allAvailable(), opts)
    expect(p.pattern).toBe('single')
    expect(p.steps).toHaveLength(1)
    expect(p.steps[0]).toMatchObject({ role: 'single', tool: 'claude-code', canEdit: false })
    expect(p.steps[0]?.model.tier).toBe(0)
  })

  it('code d1 -> plan-execute-review with reviewer of another vendor', () => {
    const p = routeTask(cls('code', 1), allAvailable(), opts)
    expect(p.pattern).toBe('plan-execute-review')
    expect(p.steps.map((s) => s.role)).toEqual(['plan', 'execute', 'review'])
    const exec = p.steps[1]!
    const review = p.steps[2]!
    expect(review.model.vendor).not.toBe(exec.model.vendor)
    expect(p.steps.map((s) => s.model.tier)).toEqual([1, 1, 1])
  })

  it('d2 or high risk -> plan tier 2, execute tier 1, review tier 2', () => {
    for (const c of [cls('debug', 2), cls('ops', 1, 'high'), cls('data', 3)]) {
      const p = routeTask(c, allAvailable(), opts)
      expect(p.steps.map((s) => s.model.tier)).toEqual([2, 1, 2])
    }
  })

  it('vendor rule: executor and reviewer vendors differ, across availability combinations', () => {
    const tools = ['claude-code', 'codex', 'agy'] as const
    for (const off of tools) {
      const a = allAvailable()
      a[off] = { installed: false, connected: false }
      const p = routeTask(cls('code', 2), a, opts)
      expect(p.steps.length).toBe(3)
      expect(p.steps[2]!.model.vendor).not.toBe(p.steps[1]!.model.vendor)
    }
  })

  it('same vendor fallback is explained when only one cli is usable', () => {
    const a = allAvailable()
    a.codex = { installed: true, connected: false }
    a.agy = { installed: false, connected: false }
    const p = routeTask(cls('code', 1), a, opts)
    expect(p.steps.map((s) => s.tool)).toEqual(['claude-code', 'claude-code', 'claude-code'])
    expect(p.explanation.some((e) => e.key === 'route.reviewSameVendor')).toBe(true)
    // disconnected tool is reported so the UI can offer "Connect"
    expect(p.explanation.some((e) => e.key === 'route.skip.notConnected' && e.params?.tool === 'codex')).toBe(true)
    expect(p.explanation.some((e) => e.key === 'route.skip.notInstalled' && e.params?.tool === 'agy')).toBe(true)
  })

  it('only execute steps get canEdit, and only with allowEdits', () => {
    const on = routeTask(cls('code', 2), allAvailable(), { ...opts, allowEdits: true })
    expect(on.steps.map((s) => s.canEdit)).toEqual([false, true, false])
    const off = routeTask(cls('code', 2), allAvailable(), opts)
    expect(off.steps.every((s) => !s.canEdit)).toBe(true)
  })

  it('review: single tier 1; heavy adds a second reviewer of another vendor at tier 2', () => {
    const light = routeTask(cls('review', 1), allAvailable(), opts)
    expect(light.steps).toHaveLength(1)
    expect(light.steps[0]).toMatchObject({ role: 'review' })
    expect(light.steps[0]!.model.tier).toBe(1)
    const heavy = routeTask(cls('review', 2), allAvailable(), opts)
    expect(heavy.steps).toHaveLength(2)
    expect(heavy.steps.every((s) => s.role === 'review' && s.model.tier === 2)).toBe(true)
    expect(heavy.steps[1]!.model.vendor).not.toBe(heavy.steps[0]!.model.vendor)
  })

  it('research: agy tier 1/2, heavy -> handoff + agy summary', () => {
    expect(routeTask(cls('research', 0), allAvailable(), opts).steps[0]).toMatchObject({ tool: 'agy' })
    expect(routeTask(cls('research', 1), allAvailable(), opts).steps[0]!.model.tier).toBe(2)
    const h = routeTask(cls('research', 3), allAvailable(), opts)
    expect(h.pattern).toBe('handoff')
    expect(h.steps.map((s) => s.tool)).toEqual(['gemini-tasks', 'agy'])
    expect(h.steps[1]!.model.tier).toBe(2)
  })

  it('writing and design -> handoff to a web workspace', () => {
    const w = routeTask(cls('writing', 1), allAvailable(), opts)
    expect(w.pattern).toBe('handoff')
    expect(w.steps[0]!.tool).toBe('cowork')
    expect(routeTask(cls('design', 1), allAvailable(), opts).steps[0]!.tool).toBe('cowork')
  })

  it('image -> handoff to ChatGPT web (Gemini web as the alternative); video -> handoff to Gemini web', () => {
    const i = routeTask(cls('image', 1), allAvailable(), opts)
    expect(i.pattern).toBe('handoff')
    expect(i.steps.map((s) => s.tool)).toEqual(['chatgpt-work'])
    expect(i.steps[0]!.canEdit).toBe(false)
    expect(i.explanation.map((e) => e.key)).toContain('route.image')
    const v = routeTask(cls('video', 2), allAvailable(), opts)
    expect(v.pattern).toBe('handoff')
    expect(v.steps.map((s) => s.tool)).toEqual(['gemini-tasks'])
    expect(v.explanation.map((e) => e.key)).toContain('route.video')
  })

  it('other -> single claude-code tier 1, or best cli when claude is unusable', () => {
    expect(routeTask(cls('other', 1), allAvailable(), opts).steps[0]).toMatchObject({ tool: 'claude-code' })
    const a = allAvailable()
    a['claude-code'] = { installed: true, connected: false }
    expect(routeTask(cls('other', 1), a, opts).steps[0]!.tool).not.toBe('claude-code')
  })

  it('other d0 uses tier 0, d1 keeps tier 1', () => {
    expect(routeTask(cls('other', 0), allAvailable(), opts).steps[0]!.model.tier).toBe(0)
    expect(routeTask(cls('other', 1), allAvailable(), opts).steps[0]!.model.tier).toBe(1)
  })

  it('question -> single cheapest connected cli at tier 0, whatever the difficulty', () => {
    for (const d of [0, 1, 3] as const) {
      const p = routeTask(cls('question', d), allAvailable(), opts)
      expect(p.pattern).toBe('single')
      expect(p.steps).toHaveLength(1)
      expect(p.steps[0]).toMatchObject({ tool: 'claude-code', role: 'single' })
      expect(p.steps[0]!.model.tier).toBe(0)
    }
    const a = allAvailable()
    a['claude-code'] = { installed: true, connected: false }
    expect(routeTask(cls('question', 1), a, opts).steps[0]).toMatchObject({ tool: 'agy' })
    expect(routeTask(cls('question', 1), a, opts).steps[0]!.model.tier).toBe(0)
  })

  it('no usable cli -> empty pipeline with an explanation', () => {
    const a = allAvailable()
    for (const t of ['claude-code', 'codex', 'agy'] as const) a[t] = { installed: false, connected: false }
    const p = routeTask(cls('code', 1), a, opts)
    expect(p.steps).toHaveLength(0)
    expect(p.explanation.some((e) => e.key === 'route.noTool')).toBe(true)
  })

  it('every decision pushes a route.why explanation with i18n key', () => {
    const p = routeTask(cls('code', 1), allAvailable(), opts)
    expect(p.explanation.filter((e) => e.key === 'route.why')).toHaveLength(3)
  })
})

describe('sanitizePipeline', () => {
  const base = routeTask(cls('code', 1), allAvailable(), { ...opts, allowEdits: true })

  it('accepts a generated pipeline and forces edit rights from settings', () => {
    const s = sanitizePipeline(base, { allowEdits: false, codexModels: opts.codexModels! })
    expect(s.steps.every((x) => !x.canEdit)).toBe(true)
    const s2 = sanitizePipeline(base, { allowEdits: true, codexModels: opts.codexModels! })
    expect(s2.steps.map((x) => x.canEdit)).toEqual([false, true, false])
  })

  it('rejects a model id that is not in the catalog (argument injection)', () => {
    const evil = structuredClone(base)
    evil.steps[0]!.model.id = '--add-dir=/'
    expect(() => sanitizePipeline(evil, { allowEdits: true, codexModels: opts.codexModels! })).toThrow('err.invalidPipeline')
  })

  it('rejects step ids reserved for escalation (-esc, -2)', () => {
    for (const id of ['s2-esc', 's3-2']) {
      const p = structuredClone(base)
      p.steps[0]!.id = id
      expect(() => sanitizePipeline(p, { allowEdits: false, codexModels: opts.codexModels! })).toThrow('err.invalidPipeline')
    }
  })

  it('rejects duplicate ids, unknown tools and empty pipelines', () => {
    const dup = structuredClone(base)
    dup.steps[1]!.id = dup.steps[0]!.id
    expect(() => sanitizePipeline(dup, { allowEdits: false, codexModels: opts.codexModels! })).toThrow()
    const unk = structuredClone(base) as any
    unk.steps[0].tool = 'rm'
    expect(() => sanitizePipeline(unk, { allowEdits: false, codexModels: opts.codexModels! })).toThrow()
    expect(() => sanitizePipeline({ ...base, steps: [] }, { allowEdits: false, codexModels: opts.codexModels! })).toThrow()
  })
})
