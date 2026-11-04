import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classify, normalize } from '../../src/core/classify'

interface Sample {
  text: string
  category: string
}
const samples = JSON.parse(readFileSync(new URL('../fixtures/classify.json', import.meta.url), 'utf8')) as Sample[]

describe('classify', () => {
  it('has at least 40 labelled samples', () => {
    expect(samples.length).toBeGreaterThanOrEqual(40)
  })

  it('gets at least 85 percent of the categories right', () => {
    const wrong = samples.filter((s) => classify(s.text).category !== s.category)
    const accuracy = 1 - wrong.length / samples.length
    if (accuracy < 0.85) console.log('wrong:', wrong.map((w) => `${w.category} <- ${classify(w.text).category}: ${w.text}`))
    expect(accuracy).toBeGreaterThanOrEqual(0.85)
  })

  it('has at least 10 image and video samples, and gets every one of them right', () => {
    const media = samples.filter((s) => s.category === 'image' || s.category === 'video')
    expect(media.length).toBeGreaterThanOrEqual(10)
    const wrong = media.filter((s) => classify(s.text).category !== s.category)
    expect(wrong.map((w) => w.text)).toEqual([])
  })

  it('is accent-insensitive', () => {
    expect(normalize('Déploie à l’instant')).toBe('deploie a l instant')
    expect(classify('deploie le serveur').category).toBe('ops')
    expect(classify('déploie le serveur').category).toBe('ops')
  })

  it('flags low confidence and falls back to other', () => {
    const c = classify('bonjour')
    expect(c.category).toBe('other')
    expect(c.needsConfirm).toBe(true)
    expect(c.confidence).toBeLessThan(0.4)
  })

  it('computes difficulty: base 1, long text bumps, small words lower, clamp 0..3', () => {
    expect(classify('corrige le bug dans calc.py').difficulty).toBe(1)
    expect(classify('corrige un petit bug dans calc.py').difficulty).toBe(0)
    expect(classify('refonte de l architecture du module api').difficulty).toBe(2)
    expect(classify('implement api ' + 'x'.repeat(700)).difficulty).toBe(2)
    expect(classify('migration de la base de donnees en production, refonte de l architecture, deploie le code').difficulty).toBeLessThanOrEqual(3)
  })

  it('small keywords match whole words only: "petite entreprise" does not lower difficulty', () => {
    expect(classify('redige un plan pour une petite entreprise').difficulty).toBe(1)
    expect(classify('fais une petite modification dans calc.py').difficulty).toBe(0)
  })

  it('sets risk high on production-like words and bumps code/ops difficulty', () => {
    const c = classify('deploie le correctif en production sur le serveur')
    expect(c.risk).toBe('high')
    expect(c.category).toBe('ops')
    expect(c.difficulty).toBe(2)
    expect(classify('ajoute une fonction utilitaire').risk).toBe('low')
  })

  it('returns i18n reason entries, never literal sentences', () => {
    const c = classify('corrige le bug de division par zéro dans calc.py')
    expect(c.reasons.length).toBeGreaterThan(0)
    for (const r of c.reasons) expect(r.key).toMatch(/^classify\./)
  })
})
