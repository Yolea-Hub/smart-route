import { describe, expect, it } from 'vitest'
import { ATLAS, atlasEntry, didYouKnow, hashSeed } from '../../src/core/atlas'
import { CODEX_EFFORT, TOOL_KIND } from '../../src/core/catalog'
import { RECIPES, homeRecipes, ROLE_EXAMPLES, examplesFor, recipeClassification, recipePipeline, recipesFor, searchRecipes } from '../../src/core/recipes'
import { sanitizePipeline } from '../../src/core/route'
import { CATEGORIES, TOOL_IDS, USER_ROLES } from '../../src/core/types'
import { opts } from './helpers'

const settings = { allowEdits: false, codexModels: opts.codexModels as NonNullable<typeof opts.codexModels> }

describe('recipes', () => {
  it('has three recipes for each of the eight jobs, 24 in all, with unique ids', () => {
    expect(RECIPES).toHaveLength(24)
    for (const r of USER_ROLES) expect(recipesFor(r), r).toHaveLength(3)
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(24)
    expect(recipesFor('none')).toHaveLength(24)
  })

  it('every text exists in both languages, French with the Sogoma composition', () => {
    const all = RECIPES.flatMap((r) => [r.title, r.desc, r.task, ...r.steps.map((s) => s.instruction), ...r.steps.map((s) => s.label)])
    for (const t of all) {
      expect(t.fr.trim()).not.toBe('')
      expect(t.en.trim()).not.toBe('')
      expect(t.fr).not.toMatch(/\S[  ][;:!?]/)
    }
    for (const r of RECIPES) expect(r.task.fr.match(/\[/g)?.length, r.id).toBe(r.task.en.match(/\[/g)?.length)
  })

  it('every step names an existing tool, a valid tier and a valid role; handoff tools run at tier 1; 1 to 8 steps; known category', () => {
    for (const r of RECIPES) {
      expect(r.steps.length, r.id).toBeGreaterThanOrEqual(1)
      expect(r.steps.length, r.id).toBeLessThanOrEqual(8)
      expect(CATEGORIES, r.id).toContain(r.category)
      for (const s of r.steps) {
        expect(TOOL_IDS, `${r.id} tool`).toContain(s.tool)
        expect([0, 1, 2, 3], `${r.id} tier`).toContain(s.tier)
        expect(['plan', 'execute', 'review', 'single'], `${r.id} role`).toContain(s.role)
        if (TOOL_KIND[s.tool] === 'handoff') expect(s.tier, `${r.id} handoff tier`).toBe(1)
        expect(s.tier, `${r.id} no maximum tier by default`).toBeLessThan(3)
        expect(Object.keys(s)).not.toContain('canEdit')
      }
    }
  })

  it('a hand-off to a web workspace appears only through the web tools, and image and video recipes end in one', () => {
    for (const r of RECIPES) {
      const web = r.steps.filter((s) => TOOL_KIND[s.tool] === 'handoff')
      for (const s of web) expect(['cowork', 'gemini-tasks', 'chatgpt-work']).toContain(s.tool)
      if (r.role === 'image' || r.role === 'video') expect(TOOL_KIND[r.steps[r.steps.length - 1]!.tool], r.id).toBe('handoff')
    }
  })

  it('every step has a visible label in both languages, kept by the pipeline and by the sanitiser', () => {
    for (const r of RECIPES) {
      const p = recipePipeline(r, opts, 'en')
      const clean = sanitizePipeline(p, settings)
      r.steps.forEach((rs, i) => {
        expect(rs.label.fr.trim(), `${r.id} ${i}`).not.toBe('')
        expect(rs.label.en.trim(), `${r.id} ${i}`).not.toBe('')
        expect(p.steps[i]?.label).toEqual(rs.label)
        expect(p.steps[i]?.instruction).toEqual(rs.instruction)
        expect(clean.steps[i]?.label).toEqual(rs.label)
        expect(clean.steps[i]?.instruction).toEqual(rs.instruction)
      })
    }
  })

  it('the sanitiser drops a malformed label and caps long ones', () => {
    const p = recipePipeline(RECIPES[0]!, opts, 'en')
    const bad = { ...p, steps: p.steps.map((s, i) => (i === 0 ? { ...s, label: { fr: 1 } as never, instruction: { fr: 'x'.repeat(5000), en: 'y' } } : s)) }
    const clean = sanitizePipeline(bad, settings)
    expect(clean.steps[0]?.label).toBeUndefined()
    expect(clean.steps[0]?.instruction?.fr.length).toBe(800)
  })

  it('chained text steps start with a plan / research role and never edit; tiers are the cheapest adequate', () => {
    for (const r of RECIPES.filter((x) => x.role !== 'developer' && x.steps.length >= 2)) {
      expect(r.steps[0]!.role, r.id).toBe('plan')
      for (const s of r.steps) {
        expect(s.tier, `${r.id} tier`).toBeLessThanOrEqual(1)
        expect(s.role, r.id).not.toBe('execute')
      }
      expect(r.difficulty, r.id).toBeLessThanOrEqual(1)
    }
    for (const r of RECIPES) for (const s of r.steps) if (s.tier === 2) expect(r.role, r.id).toBe('developer')
  })

  it('a recipe is not classified as complex just because it is a recipe', () => {
    for (const r of RECIPES.filter((x) => x.role !== 'developer')) expect(recipeClassification(r, 'en').difficulty, r.id).toBeLessThan(2)
  })

  it('a recipe makes an ordinary pipeline that sanitizePipeline accepts unchanged, read-only unless Settings allow edits', () => {
    for (const r of RECIPES) {
      for (const lang of ['fr', 'en'] as const) {
        const p = recipePipeline(r, opts, lang)
        expect(p.steps).toHaveLength(r.steps.length)
        expect(p.steps.every((s) => !s.canEdit), `${r.id} read-only`).toBe(true)
        expect(p.explanation[0]?.key).toBe('route.recipe')
        expect(p.explanation.filter((e) => e.key === 'route.why')).toHaveLength(r.steps.length)
        const clean = sanitizePipeline(p, settings)
        expect(clean.steps.map((s) => [s.tool, s.model.id, s.role])).toEqual(p.steps.map((s) => [s.tool, s.model.id, s.role]))
      }
      // with edits allowed: only an execute step on a CLI tool may edit, and the sanitiser keeps that rule
      const edit = recipePipeline(r, { ...opts, allowEdits: true }, 'en')
      for (const s of edit.steps) expect(s.canEdit).toBe(s.role === 'execute' && TOOL_KIND[s.tool] === 'cli')
    }
  })

  it('edit rights cannot be forced from a recipe: the sanitiser refuses them when Settings forbid edits', () => {
    const p = recipePipeline(RECIPES.find((r) => r.id === 'dev-feature')!, { ...opts, allowEdits: true }, 'en')
    expect(p.steps.some((s) => s.canEdit)).toBe(true)
    expect(sanitizePipeline(p, settings).steps.every((s) => !s.canEdit)).toBe(true)
  })

  it('pattern: plan + execute + review is the router pattern, a web step is a hand-off, else single', () => {
    const pat = (id: string) => recipePipeline(RECIPES.find((r) => r.id === id)!, opts, 'en').pattern
    expect(pat('dev-feature')).toBe('plan-execute-review')
    expect(pat('mkt-campaign')).toBe('handoff')
    expect(pat('mgr-meeting')).toBe('single')
  })

  it('codex steps use the configured model and effort of their tier', () => {
    const p = recipePipeline(RECIPES.find((r) => r.id === 'dev-feature')!, opts, 'en')
    const codex = p.steps.find((s) => s.tool === 'codex')!
    expect(codex.model.effort).toBe(CODEX_EFFORT[codex.model.tier])
  })

  it('the classification of a recipe is sure, low risk, and never asks to confirm', () => {
    const c = recipeClassification(RECIPES[0]!, 'fr')
    expect(c).toMatchObject({ category: RECIPES[0]!.category, risk: 'low', needsConfirm: false, confidence: 1 })
    expect(c.reasons[0]?.key).toBe('classify.recipe')
  })

  it('examples: four per job, in both languages; none without a job', () => {
    for (const r of USER_ROLES) {
      expect(ROLE_EXAMPLES[r]).toHaveLength(4)
      expect(examplesFor(r, 'fr')).toHaveLength(4)
    }
    expect(examplesFor('none', 'en')).toEqual([])
  })

  it('the home page shows three recipes: the job’s own, or a mixed trio without a job', () => {
    for (const r of USER_ROLES) expect(homeRecipes(r).map((x) => x.role)).toEqual([r, r, r])
    const mix = homeRecipes('none')
    expect(mix).toHaveLength(3)
    expect(new Set(mix.map((x) => x.role)).size).toBe(3)
  })

  it('search is accent- and case-insensitive over title, description and tools', () => {
    expect(searchRecipes(RECIPES, 'REUNION', 'fr').map((r) => r.id)).toContain('mgr-meeting')
    expect(searchRecipes(RECIPES, 'video gemini', 'en').length).toBeGreaterThan(0)
    expect(searchRecipes(RECIPES, 'zzzzzz', 'en')).toEqual([])
    expect(searchRecipes(RECIPES, '  ', 'en')).toHaveLength(24)
  })
})

describe('atlas', () => {
  it('has one entry per tool, with strengths, tasks, limits and a valid best tier, in both languages', () => {
    expect(ATLAS.map((e) => e.tool).sort()).toEqual([...TOOL_IDS].sort())
    for (const e of ATLAS) {
      expect(e.strengths.length, e.tool).toBeGreaterThan(0)
      expect(e.typicalTasks.length, e.tool).toBeGreaterThan(0)
      expect(e.limits.length, e.tool).toBeGreaterThan(0)
      expect([0, 1, 2, 3]).toContain(e.bestTier)
      for (const t of [e.where, ...e.strengths, ...e.typicalTasks, ...e.limits, ...e.tips.map((x) => x.text)]) {
        expect(t.fr.trim()).not.toBe('')
        expect(t.en.trim()).not.toBe('')
        expect(t.fr).not.toMatch(/\S[  ][;:!?]/)
      }
      for (const s of e.strengths) expect(s.en, e.tool).toMatch(/^Good at/)
      for (const s of e.strengths) expect(s.fr, e.tool).toMatch(/^Bon pour/)
    }
    expect(atlasEntry('codex')?.tool).toBe('codex')
  })

  it('"Did you know" is deterministic, names another tool, and fits the category', () => {
    for (const cat of CATEGORIES) {
      const tip = didYouKnow(cat, ['claude-code'], 'corrige le bug', 'en')
      expect(tip, cat).toBeDefined()
      expect(tip!.tool).not.toBe('claude-code')
      expect(tip).toEqual(didYouKnow(cat, ['claude-code'], 'corrige le bug', 'en'))
      expect(atlasEntry(tip!.tool)!.tips.some((x) => x.cats.includes(cat) && x.text.en === tip!.text)).toBe(true)
    }
  })

  it('different tasks can get different lines; no line when every candidate tool was used', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) seen.add(didYouKnow('writing', [], `task ${i}`, 'fr')!.text)
    expect(seen.size).toBeGreaterThan(1)
    expect(didYouKnow('video', [...TOOL_IDS], 'x', 'en')).toBeUndefined()
    expect(hashSeed('a')).toBe(hashSeed('a'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
  })
})
