// Capability atlas: what each tool is good at, in modest and checkable words. Pure data, shared by the application and the site.
// Every line is phrased « bon pour » / "good at": no ranking claim, no benchmark, no number that can go stale. Availability of a
// feature depends on the person's plan with the vendor, and the atlas says so.
import { TOOL_VENDOR } from './catalog'
import type { Bilingual } from './recipes'
import type { Category, Lang, Tier, ToolId, Vendor } from './types'
import { TOOL_IDS } from './types'

const NNBSP = ' '
const b = (f: string, e: string): Bilingual => ({
  fr: f.replace(/\s+([;:!?»])/g, `${NNBSP}$1`).replace(/«\s+/g, `«${NNBSP}`),
  en: e
})

export interface AtlasTip {
  /** Task categories for which this line is worth reading after a run. */
  cats: Category[]
  /** One sentence, « bon pour… » / "good at…". */
  text: Bilingual
}

export interface AtlasEntry {
  tool: ToolId
  vendor: Vendor
  /** Where it runs. */
  where: Bilingual
  strengths: Bilingual[]
  typicalTasks: Bilingual[]
  /** The tier to start with; the model it maps to is shown from the catalog. */
  bestTier: Tier
  limits: Bilingual[]
  tips: AtlasTip[]
}

export const ATLAS: readonly AtlasEntry[] = [
  {
    tool: 'claude-code', vendor: TOOL_VENDOR['claude-code'],
    where: b('Sur votre ordinateur, dans un dossier, avec votre abonnement Claude.', 'On your computer, in a folder, with your Claude subscription.'),
    strengths: [
      b('Bon pour lire un projet entier et le modifier avec méthode.', 'Good at reading a whole project and changing it step by step.'),
      b('Bon pour rédiger des textes structurés et longs.', 'Good at writing long, structured texts.'),
      b('Bon pour expliquer une démarche pas à pas.', 'Good at explaining an approach step by step.')
    ],
    typicalTasks: [
      b('Ajouter une fonction et ses tests.', 'Add a function and its tests.'),
      b('Écrire un rapport à partir de notes.', 'Write a report from notes.'),
      b('Relire un document et le critiquer.', 'Read a document and critique it.')
    ],
    bestTier: 1,
    limits: [
      b('Les paliers élevés consomment plus de votre quota.', 'The higher tiers use more of your quota.'),
      b('Ne crée ni image ni vidéo.', 'Does not create images or video.')
    ],
    tips: [
      { cats: ['writing', 'other', 'question'], text: b('Claude Code est bon pour mettre des notes en vrac au propre, en texte structuré.', 'Claude Code is good at turning loose notes into clean, structured text.') },
      { cats: ['code', 'debug', 'ops'], text: b('Claude Code est bon pour lire un dossier entier avant de proposer une modification.', 'Claude Code is good at reading a whole folder before suggesting a change.') },
      { cats: ['image', 'video'], text: b('Claude Code est bon pour détailler une idée en description précise ou en script, avant de passer par un outil d’image ou de vidéo.', 'Claude Code is good at turning an idea into a precise description or script before you go to an image or video tool.') },
      { cats: ['research', 'data'], text: b('Claude Code est bon pour ranger des faits dans un tableau et dire ce qui n’est pas établi.', 'Claude Code is good at setting facts in a table and saying what is not established.') }
    ]
  },
  {
    tool: 'codex', vendor: TOOL_VENDOR['codex'],
    where: b('Sur votre ordinateur, dans un dossier, avec votre abonnement ChatGPT.', 'On your computer, in a folder, with your ChatGPT subscription.'),
    strengths: [
      b('Bon pour relire du code avec un regard indépendant de celui de Claude.', 'Good at reviewing code with a view independent from Claude’s.'),
      b('Bon pour chercher la cause d’un bug.', 'Good at looking for the cause of a bug.'),
      b('Bon pour des modifications précises et ciblées.', 'Good at precise, targeted changes.')
    ],
    typicalTasks: [
      b('Relire une modification avant de la fusionner.', 'Review a change before merging it.'),
      b('Trouver pourquoi un test échoue.', 'Find why a test fails.'),
      b('Écrire un script court.', 'Write a short script.')
    ],
    bestTier: 2,
    limits: [
      b('Pensé pour le code : moins adapté aux textes de communication.', 'Made for code: less suited to communication texts.'),
      b('Le modèle utilisé se règle dans les Réglages.', 'The model used is set in Settings.')
    ],
    tips: [
      { cats: ['writing', 'research', 'question', 'other'], text: b('Codex est bon pour une seconde lecture de code ou de script, même si votre tâche n’est pas du code.', 'Codex is good at a second reading of code or scripts, even when your task is not code.') },
      { cats: ['code', 'debug', 'review', 'ops', 'data'], text: b('Codex est bon pour relire le travail d’un autre outil avec un regard indépendant.', 'Codex is good at reviewing another tool’s work with an independent view.') }
    ]
  },
  {
    tool: 'agy', vendor: TOOL_VENDOR['agy'],
    where: b('Sur votre ordinateur, avec votre compte Google (Antigravity, modèles Gemini).', 'On your computer, with your Google account (Antigravity, Gemini models).'),
    strengths: [
      b('Bon pour lire de longs documents et en tirer l’essentiel.', 'Good at reading long documents and pulling out the essentials.'),
      b('Bon pour répondre vite à une question simple.', 'Good at answering a simple question quickly.'),
      b('Bon pour lister des options, des risques, des questions.', 'Good at listing options, risks, questions.')
    ],
    typicalTasks: [
      b('Résumer un long rapport.', 'Summarise a long report.'),
      b('Préparer des questions de révision.', 'Prepare revision questions.'),
      b('Lister les risques d’un projet.', 'List the risks of a project.')
    ],
    bestTier: 1,
    limits: [
      b('Le palier le plus haut passe par un autre modèle que Gemini.', 'The highest tier goes through a model other than Gemini.'),
      b('La vérification de la connexion peut prendre plusieurs secondes.', 'Checking the sign-in can take several seconds.')
    ],
    tips: [
      { cats: ['code', 'debug', 'writing', 'other'], text: b('Antigravity est bon pour lire un long document et en faire un résumé fidèle.', 'Antigravity is good at reading a long document and making a faithful summary.') },
      { cats: ['research', 'question', 'review'], text: b('Antigravity est bon pour lister les risques et les contre-arguments d’un projet.', 'Antigravity is good at listing a project’s risks and counter-arguments.') }
    ]
  },
  {
    tool: 'cowork', vendor: TOOL_VENDOR['cowork'],
    where: b('Dans votre navigateur, sur claude.ai, avec votre abonnement Claude.', 'In your browser, on claude.ai, with your Claude subscription.'),
    strengths: [
      b('Bon pour travailler sur des documents et des fichiers que vous y déposez.', 'Good at working on documents and files you upload there.'),
      b('Bon pour rédiger et reformuler avec un échange en plusieurs tours.', 'Good at writing and rewording over several turns.')
    ],
    typicalTasks: [
      b('Reformuler un contrat en langage simple.', 'Reword a contract in plain language.'),
      b('Préparer une présentation à partir d’un document.', 'Prepare a presentation from a document.')
    ],
    bestTier: 1,
    limits: [
      b('Smart Route ouvre le site et prépare votre demande ; vous collez la réponse ici.', 'Smart Route opens the site and prepares your request; you paste the answer back here.'),
      b('Les fonctions disponibles dépendent de votre formule.', 'The available features depend on your plan.')
    ],
    tips: [
      { cats: ['code', 'data', 'ops', 'debug'], text: b('Claude sur le web est bon pour travailler sur un document que vous déposez, avec plusieurs allers-retours.', 'Claude on the web is good at working on a document you upload, over several turns.') },
      { cats: ['writing', 'design'], text: b('Claude sur le web est bon pour reformuler un texte en plusieurs tours, avec vos remarques.', 'Claude on the web is good at rewording a text over several turns, with your remarks.') }
    ]
  },
  {
    tool: 'chatgpt-work', vendor: TOOL_VENDOR['chatgpt-work'],
    where: b('Dans votre navigateur, sur chatgpt.com, avec votre abonnement ChatGPT.', 'In your browser, on chatgpt.com, with your ChatGPT subscription.'),
    strengths: [
      b('Bon pour créer des images à partir d’une description.', 'Good at creating images from a description.'),
      b('Bon pour chercher des faits sur le web et donner des liens.', 'Good at looking up facts on the web and giving links.'),
      b('Bon pour analyser un fichier que vous déposez.', 'Good at analysing a file you upload.')
    ],
    typicalTasks: [
      b('Créer l’image d’une affiche.', 'Create the image for a poster.'),
      b('Comparer trois produits avec leurs liens.', 'Compare three products with their links.'),
      b('Faire parler un tableau de chiffres.', 'Make a table of figures speak.')
    ],
    bestTier: 1,
    limits: [
      b('Smart Route prépare votre demande ; vous la collez sur le site et revenez avec la réponse.', 'Smart Route prepares your request; you paste it on the site and come back with the answer.'),
      b('Les fonctions et les limites d’images dépendent de votre formule.', 'Features and image limits depend on your plan.')
    ],
    tips: [
      { cats: ['writing', 'design', 'other', 'question'], text: b('ChatGPT sur le web est bon pour créer l’image qui accompagne votre texte.', 'ChatGPT on the web is good at creating the image that goes with your text.') },
      { cats: ['video'], text: b('ChatGPT sur le web est bon pour créer les images d’un storyboard avant la vidéo.', 'ChatGPT on the web is good at creating storyboard images before the video.') },
      { cats: ['research', 'data', 'code'], text: b('ChatGPT sur le web est bon pour chercher des faits sur le web et donner les liens.', 'ChatGPT on the web is good at looking up facts on the web and giving the links.') }
    ]
  },
  {
    tool: 'gemini-tasks', vendor: TOOL_VENDOR['gemini-tasks'],
    where: b('Dans votre navigateur, sur gemini.google.com, avec votre compte Google.', 'In your browser, on gemini.google.com, with your Google account.'),
    strengths: [
      b('Bon pour chercher sur le web et citer ses sources.', 'Good at searching the web and citing its sources.'),
      b('Bon pour créer des vidéos et des images, selon votre formule.', 'Good at creating videos and images, depending on your plan.')
    ],
    typicalTasks: [
      b('Étudier un marché avec des sources.', 'Study a market with sources.'),
      b('Créer un court clip à partir d’un découpage.', 'Create a short clip from a shot list.')
    ],
    bestTier: 1,
    limits: [
      b('La création de vidéo dépend de votre formule et de limites d’usage.', 'Video creation depends on your plan and on usage limits.'),
      b('Smart Route prépare votre demande ; vous collez la réponse ici.', 'Smart Route prepares your request; you paste the answer back here.')
    ],
    tips: [
      { cats: ['writing', 'design', 'image', 'other'], text: b('Gemini sur le web est bon pour créer un court clip vidéo à partir d’un script et d’un découpage.', 'Gemini on the web is good at creating a short video clip from a script and a shot list.') },
      { cats: ['code', 'debug', 'question', 'data', 'ops', 'review', 'research'], text: b('Gemini sur le web est bon pour chercher sur le web et citer ses sources.', 'Gemini on the web is good at searching the web and citing its sources.') }
    ]
  }
]

export function atlasEntry(tool: ToolId): AtlasEntry | undefined {
  return ATLAS.find((e) => e.tool === tool)
}

/** FNV-1a: a small stable hash, so the same task always gets the same line. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export interface DidYouKnow {
  tool: ToolId
  text: string
}

/**
 * The « Did you know? » line shown after a run: one tip about a tool the run did NOT use, relevant to the task category.
 * Deterministic: the same seed (the task text) always gives the same line. Undefined when no tool has a line for this category.
 */
export function didYouKnow(category: Category, usedTools: readonly ToolId[], seed: string, lang: Lang): DidYouKnow | undefined {
  const pool: Array<{ tool: ToolId; text: string }> = []
  for (const id of TOOL_IDS) {
    if (usedTools.includes(id)) continue
    for (const tip of atlasEntry(id)?.tips ?? []) if (tip.cats.includes(category)) pool.push({ tool: id, text: tip.text[lang] })
  }
  if (pool.length === 0) return undefined
  return pool[hashSeed(seed) % pool.length]
}
