import type { Category, Classification, Difficulty, ExplainEntry, Risk } from './types'

/**
 * Keyword lists (FR + EN) per category. Matching is accent-insensitive, case-insensitive and
 * word-bounded. A trailing "*" means "prefix" (corrig* matches corrige, corriger, corrigez).
 * `strong` keywords weigh 2, `weak` keywords weigh 1.
 */
const KEYWORDS: Record<Exclude<Category, 'other'>, { strong: string[]; weak: string[] }> = {
  debug: {
    strong: ['bug*', 'erreur*', 'error*', 'crash*', 'plante*', 'stack trace', 'exception*', 'corrig*', 'repar*', 'fix*', 'debug*', 'regression*'],
    weak: ['ne marche pas', 'ne fonctionne pas', 'fails', 'failing', 'broken', 'casse*', 'traceback', 'segfault']
  },
  research: {
    strong: ['recherche*', 'research*', 'compare*', 'comparaison', 'marche', 'sources', 'etat de l art', 'state of the art', 'benchmark*', 'veille', 'concurrent*', 'competitor*', 'survey', 'tendances', 'trends'],
    weak: ['documente', 'investigate', 'etude', 'study', 'analyse de marche', 'market']
  },
  writing: {
    strong: ['redige*', 'ecris', 'ecrire', 'write', 'email*', 'mail', 'article*', 'rapport*', 'report', 'lettre*', 'letter', 'blog', 'newsletter', 'discours', 'speech', 'resume*', 'summar*', 'traduis*', 'translate'],
    weak: ['relance', 'texte', 'text', 'post', 'communique', 'presentation', 'slogan']
  },
  data: {
    strong: ['csv', 'excel', 'tableau croise', 'dataset*', 'sql', 'graphique*', 'chart*', 'dataframe', 'pandas', 'requete sql', 'xlsx', 'statistique*', 'statistics'],
    weak: ['tableau', 'colonne*', 'column*', 'donnees', 'data', 'moyenne', 'average', 'pivot']
  },
  design: {
    strong: ['maquette*', 'logo*', 'ui', 'ux', 'design*', 'figma', 'mockup*', 'wireframe*', 'palette', 'icone*', 'icon*', 'charte graphique', 'branding'],
    weak: ['couleurs', 'colors', 'typographie', 'typography', 'interface', 'banniere', 'banner']
  },
  image: {
    strong: ['image*', 'photo*', 'illustration*', 'affiche*', 'dessin*', 'dessine*', 'picture*', 'artwork', 'poster*', 'genere une image', 'generate an image', 'portrait*', 'wallpaper*', 'fond d ecran'],
    weak: ['visuel*', 'logo*', 'pixel*', 'render', 'rendu', 'sticker*', 'meme*', 'mascotte', 'mascot']
  },
  video: {
    strong: ['video*', 'clip*', 'montage*', 'animation*', 'animer', 'reel', 'reels', 'shorts', 'film*', 'tiktok', 'genere une video', 'generate a video', 'teaser*', 'publicite video'],
    weak: ['youtube', 'storyboard*', 'tournage', 'sous titre*', 'subtitle*', 'voix off', 'voiceover', 'scenario', 'short']
  },
  ops: {
    strong: ['deploy*', 'deploie*', 'serveur*', 'server*', 'docker*', 'kubernetes', 'k8s', 'ci', 'cd', 'pipeline ci', 'dns', 'nginx', 'terraform', 'ansible', 'systemd', 'ssl', 'certificat*', 'infrastructure', 'monitoring'],
    weak: ['logs', 'ssh', 'cron', 'backup', 'sauvegarde*', 'vps', 'cloud', 'conteneur*', 'container*']
  },
  question: {
    strong: ['quel', 'quels', 'quelle', 'quelles', 'combien', 'how many', 'explique*', 'explain*', 'definition', 'definis', 'define'],
    weak: ['qui', 'who', 'what', 'pourquoi', 'why', 'comment', '?']
  },
  review: {
    strong: ['relis', 'relire', 'relecture', 'review*', 'audit*', 'revue de code', 'code review', 'passe en revue', 'critique'],
    weak: ['verifie', 'check', 'inspect*', 'evalue*', 'evaluate', 'feedback']
  },
  code: {
    strong: ['code', 'function*', 'fonction*', 'api', 'implement*', 'ajoute*', 'feature', 'fonctionnalite*', 'refactor*', 'test*', 'script', 'classe', 'class', 'endpoint*', 'composant*', 'component*', 'programme', 'module'],
    weak: ['python', 'javascript', 'typescript', 'rust', 'java', 'react', 'node', 'bibliotheque', 'library', 'cree', 'create', 'build', 'construis']
  }
}

const RISK_WORDS = [
  'prod', 'production', 'paiement*', 'payment*', 'auth', 'authentification', 'authentication', 'secret*', 'token*', 'migration*', 'supprime*', 'delete*', 'deploy*', 'deploie*', 'mot de passe', 'password*', 'credential*'
]
const COMPLEX_WORDS = ['architecture', 'migration', 'refonte', 'multi', 'integration', 'securite', 'security', 'microservice*', 'scalab*', 'overhaul', 'redesign']
const SMALL_WORDS = ['typo', 'renomme*', 'rename', 'petit', 'petite modification', 'small', 'quick', 'rapide', 'simple', 'mineur', 'minor']

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, ' ')
}

const regexCache = new Map<string, RegExp>()
function keywordRegex(kw: string): RegExp {
  let re = regexCache.get(kw)
  if (!re) {
    const prefix = kw.endsWith('*')
    const body = (prefix ? kw.slice(0, -1) : kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- kw comes from the static KEYWORDS constants and is regex-escaped
    re = new RegExp(`(?<![a-z0-9])${body}${prefix ? '[a-z0-9]*' : ''}(?![a-z0-9])`, 'g')
    regexCache.set(kw, re)
  }
  return re
}

function matchesOf(norm: string, kws: string[]): string[] {
  const out: string[] = []
  for (const kw of kws) {
    const m = norm.match(keywordRegex(kw))
    if (m) out.push(kw.replace(/\*$/, ''))
  }
  return out
}

export function detectRisk(text: string): { risk: Risk; matched: string[] } {
  const matched = matchesOf(normalize(text), RISK_WORDS)
  return { risk: matched.length > 0 ? 'high' : 'low', matched }
}

export function classify(text: string): Classification {
  const norm = normalize(text)
  const reasons: ExplainEntry[] = []

  const scores = new Map<Category, number>()
  const matched = new Map<Category, string[]>()
  for (const cat of Object.keys(KEYWORDS) as Exclude<Category, 'other'>[]) {
    const strong = matchesOf(norm, KEYWORDS[cat].strong)
    const weak = matchesOf(norm, KEYWORDS[cat].weak)
    const score = strong.length * 2 + weak.length
    if (score > 0) {
      scores.set(cat, score)
      matched.set(cat, [...strong, ...weak])
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const top = ranked[0]
  const topScore = top?.[1] ?? 0
  const secondScore = ranked[1]?.[1] ?? 0
  const confidence = topScore / (topScore + secondScore + 1)
  const needsConfirm = confidence < 0.4
  const category: Category = top && !needsConfirm ? top[0] : 'other'

  if (category === 'other') {
    reasons.push({ key: 'classify.lowConfidence', params: { confidence: Math.round(confidence * 100) } })
  } else {
    reasons.push({
      key: 'classify.category',
      params: { category, keywords: (matched.get(category) ?? []).slice(0, 4).join(', ') }
    })
  }

  // Risk
  const { risk, matched: riskWords } = detectRisk(text)
  if (risk === 'high') reasons.push({ key: 'classify.riskHigh', params: { keywords: riskWords.slice(0, 3).join(', ') } })

  // Difficulty
  let difficulty = 1
  const complex = matchesOf(norm, COMPLEX_WORDS)
  if (text.length > 600 || complex.length > 0) {
    difficulty += 1
    reasons.push({ key: 'classify.complex', params: { keywords: complex.slice(0, 3).join(', '), length: text.length } })
  }
  if (risk === 'high' && (category === 'code' || category === 'ops')) {
    difficulty += 1
    reasons.push({ key: 'classify.riskBump' })
  }
  const small = matchesOf(norm, SMALL_WORDS)
  if (small.length > 0) {
    difficulty -= 1
    reasons.push({ key: 'classify.small', params: { keywords: small.slice(0, 3).join(', ') } })
  }
  difficulty = Math.max(0, Math.min(3, difficulty))

  return { category, difficulty: difficulty as Difficulty, risk, confidence, reasons, needsConfirm }
}
