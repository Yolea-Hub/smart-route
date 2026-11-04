import type { Lang } from './types'

const FR_WORDS = new Set(['le', 'la', 'les', 'des', 'un', 'une', 'est', 'pour', 'dans', 'avec', 'que', 'qui', 'pas', 'sur', 'du', 'et', 'ou', 'je', 'tu', 'nous', 'vous', 'mon', 'ma', 'mes', 'ce', 'cette', 'ces', 'au', 'aux', 'fais', 'corrige', 'redige', 'ecris', 'ajoute', 'comment', 'pourquoi', 'quel', 'quelle', 'peux', 'veux', 'moi', 'sans', 'plus', 'fichier', 'erreur', 'bonjour', 'merci'])
const EN_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'for', 'in', 'with', 'that', 'which', 'not', 'on', 'of', 'and', 'or', 'i', 'you', 'we', 'my', 'this', 'these', 'to', 'fix', 'write', 'add', 'how', 'why', 'what', 'can', 'want', 'me', 'without', 'more', 'file', 'error', 'hello', 'thanks', 'please', 'it', 'be', 'do', 'does'])

/** Simple FR/EN detection for the user's task: accents and common words; ties fall back to `fallback`. */
export function detectTaskLanguage(text: string, fallback: Lang): Lang {
  const sample = text.slice(0, 4000)
  let fr = (sample.match(/[éèêëàâçùûôîï]/gi) ?? []).length > 0 ? 2 : 0
  let en = 0
  const words = sample
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z]+/g) ?? []
  for (const w of words) {
    if (FR_WORDS.has(w)) fr++
    if (EN_WORDS.has(w)) en++
  }
  if (fr > en) return 'fr'
  if (en > fr) return 'en'
  return fallback
}
