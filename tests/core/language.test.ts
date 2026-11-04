import { describe, expect, it } from 'vitest'
import { detectTaskLanguage } from '../../src/core/language'

describe('detectTaskLanguage', () => {
  it('detects French by accents and common words', () => {
    expect(detectTaskLanguage('corrige le bug de division par zéro dans calc.py', 'en')).toBe('fr')
    expect(detectTaskLanguage('Écris une fonction qui calcule la TVA', 'en')).toBe('fr')
    expect(detectTaskLanguage('peux-tu expliquer pourquoi ce fichier plante', 'en')).toBe('fr')
  })
  it('detects English', () => {
    expect(detectTaskLanguage('Fix the crash when the user clicks save', 'fr')).toBe('en')
    expect(detectTaskLanguage('write a function that validates IBAN numbers', 'fr')).toBe('en')
  })
  it('falls back to the UI language when unclear', () => {
    expect(detectTaskLanguage('calc.py', 'fr')).toBe('fr')
    expect(detectTaskLanguage('calc.py', 'en')).toBe('en')
    expect(detectTaskLanguage('', 'en')).toBe('en')
  })
})
