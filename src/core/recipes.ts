// Recipes: ready-made multi-tool workflows per job. Pure data and pure functions, shared by the application, the web app and the site
// (the site reads a JSON export of this file: `pnpm export:recipes`). A recipe never decides edit rights: its steps carry no `canEdit`,
// the pipeline it produces gets that flag from Settings only, like any routed pipeline, and `sanitizePipeline` still applies at run time.
import { TOOL_KIND } from './catalog'
import { pipelineFromSpecs, type RouteOptions, type StepSpec } from './route'
import type { Category, Classification, Difficulty, Lang, Pipeline, Role, Tier, ToolId, UserRole } from './types'

export type Bilingual = Record<Lang, string>

export interface RecipeStep extends StepSpec {
  role: Role
  tool: ToolId
  /** Handoff tools (web workspaces) always run at tier 1. */
  tier: Tier
  /** Short visible name of the step (« Chercher / Research »). */
  label: Bilingual
  /** What this step does, in the person's words. */
  instruction: Bilingual
}

export interface Recipe {
  id: string
  role: UserRole
  /** Category the plan is shown under (also decides the strengths shown in the explanation). */
  category: Category
  difficulty: Difficulty
  title: Bilingual
  desc: Bilingual
  /** Task text put in the box; square brackets mark what the person fills in. */
  task: Bilingual
  steps: RecipeStep[]
}

/** French composition (Sogoma): a narrow no-break space before ; : ! ? and inside « ». */
const NNBSP = ' '
function fr(s: string): string {
  return s.replace(/\s+([;:!?»])/g, `${NNBSP}$1`).replace(/«\s+/g, `«${NNBSP}`)
}
const b = (f: string, e: string): Bilingual => ({ fr: fr(f), en: e })

const S = (role: Role, tool: ToolId, tier: Tier, label: Bilingual, f: string, e: string): RecipeStep => ({ role, tool, tier, label, instruction: b(f, e) })

export const RECIPES: readonly Recipe[] = [
  // ---- Développeur / Developer ----
  {
    id: 'dev-feature', role: 'developer', category: 'code', difficulty: 2,
    title: b('Ajouter une fonctionnalité, relue par un autre éditeur', 'Add a feature, reviewed by another vendor'),
    desc: b('Un plan, le code, puis une relecture par un outil d’un autre éditeur.', 'A plan, the code, then a review by a tool from another vendor.'),
    task: b('Ajoute cette fonctionnalité au projet : [décrivez-la]. Contraintes : [langage, bibliothèques, tests à garder verts].', 'Add this feature to the project: [describe it]. Constraints: [language, libraries, tests to keep green].'),
    steps: [
      S('plan', 'claude-code', 2, b('Planifier', 'Plan'), 'Propose un plan court : fichiers touchés, cas limites, comment vérifier.', 'Propose a short plan: files involved, edge cases, how to verify.'),
      S('execute', 'claude-code', 1, b('Coder', 'Code'), 'Applique le plan, sans rien ajouter. Modifie des fichiers seulement si les modifications sont autorisées dans les Réglages.', 'Apply the plan, adding nothing. Edit files only if edits are allowed in Settings.'),
      S('review', 'codex', 2, b('Relire', 'Review'), 'Relis le résultat : correction, sécurité, tests. Rends un verdict avec les problèmes précis.', 'Review the result: correctness, security, tests. Give a verdict with the precise issues.')
    ]
  },
  {
    id: 'dev-bug', role: 'developer', category: 'debug', difficulty: 2,
    title: b('Trouver et corriger un bug', 'Find and fix a bug'),
    desc: b('Un outil cherche la cause, un autre corrige, un troisième vérifie.', 'One tool finds the cause, another fixes it, a third checks.'),
    task: b('Voici le bug : [ce qui se passe, le message d’erreur, comment le reproduire]. Trouve la cause et corrige-la.', 'Here is the bug: [what happens, the error message, how to reproduce it]. Find the cause and fix it.'),
    steps: [
      S('plan', 'codex', 1, b('Chercher la cause', 'Find the cause'), 'Cherche la cause probable et propose la correction minimale, sans modifier de fichier.', 'Look for the likely cause and propose the smallest fix, without editing any file.'),
      S('execute', 'claude-code', 1, b('Corriger', 'Fix'), 'Applique la correction proposée.', 'Apply the proposed fix.'),
      S('review', 'agy', 1, b('Vérifier', 'Check'), 'Vérifie que la correction règle le bug sans en créer un autre.', 'Check that the fix solves the bug without creating another.')
    ]
  },
  {
    id: 'dev-audit', role: 'developer', category: 'review', difficulty: 2,
    title: b('Revue de code en double lecture', 'Code review by two readers'),
    desc: b('Deux outils de deux éditeurs relisent le même code, en lecture seule.', 'Two tools from two vendors read the same code, read-only.'),
    task: b('Relis ce code et signale les risques de sécurité, les bugs probables et les points fragiles : [fichier ou dossier].', 'Review this code and point out security risks, likely bugs and fragile spots: [file or folder].'),
    steps: [
      S('review', 'codex', 2, b('Première lecture', 'First reading'), 'Première lecture : sécurité et cas limites.', 'First reading: security and edge cases.'),
      S('review', 'claude-code', 2, b('Seconde lecture', 'Second reading'), 'Seconde lecture, indépendante : ce que la première a manqué.', 'Second, independent reading: what the first one missed.')
    ]
  },

  // ---- Manager ----
  {
    id: 'mgr-meeting', role: 'manager', category: 'writing', difficulty: 1,
    title: b('De la réunion au plan d’action', 'From meeting to action plan'),
    desc: b('Un compte rendu clair, puis des actions avec responsable et date.', 'Clear minutes, then actions with an owner and a date.'),
    task: b('Voici mes notes de réunion : [collez-les]. Fais un compte rendu, puis la liste des actions.', 'Here are my meeting notes: [paste them]. Write the minutes, then the list of actions.'),
    steps: [
      S('plan', 'claude-code', 1, b('Mettre au propre', 'Tidy up'), 'Mets les notes au propre : décisions prises, points ouverts.', 'Tidy the notes: decisions made, open points.'),
      S('single', 'agy', 1, b('Lister les actions', 'List the actions'), 'Transforme-les en actions : qui, quoi, pour quand.', 'Turn them into actions: who, what, by when.')
    ]
  },
  {
    id: 'mgr-report', role: 'manager', category: 'writing', difficulty: 1,
    title: b('Le rapport hebdomadaire en une page', 'The weekly report on one page'),
    desc: b('Des notes en vrac deviennent un rapport court pour votre direction.', 'Loose notes become a short report for your leadership.'),
    task: b('Voici ce qui s’est passé cette semaine : [notes en vrac]. Écris un rapport d’une page pour [destinataire].', 'Here is what happened this week: [loose notes]. Write a one-page report for [reader].'),
    steps: [
      S('plan', 'claude-code', 1, b('Rédiger', 'Write'), 'Rédige le rapport : résultats, risques, prochaines étapes.', 'Write the report: results, risks, next steps.'),
      S('single', 'agy', 0, b('Resserrer', 'Tighten'), 'Resserre-le pour tenir sur une page, sans perdre un chiffre.', 'Tighten it to one page, without losing a figure.')
    ]
  },
  {
    id: 'mgr-decision', role: 'manager', category: 'research', difficulty: 1,
    title: b('Préparer une décision difficile', 'Prepare a hard decision'),
    desc: b('Les options et leurs risques, puis une note de décision qui joue l’avocat du diable.', 'The options and their risks, then a decision memo that plays devil’s advocate.'),
    task: b('Je dois décider : [la question]. Options envisagées : [liste]. Ce qui compte pour moi : [critères].', 'I must decide: [the question]. Options considered: [list]. What matters to me: [criteria].'),
    steps: [
      S('plan', 'agy', 1, b('Chercher les options', 'Research the options'), 'Liste les options, leurs avantages et leurs risques.', 'List the options, their advantages and their risks.'),
      S('single', 'claude-code', 1, b('Écrire la note', 'Write the memo'), 'Écris la note de décision, avec les objections les plus fortes.', 'Write the decision memo, with the strongest objections.')
    ]
  },

  // ---- Marketing ----
  {
    id: 'mkt-campaign', role: 'marketing', category: 'writing', difficulty: 1,
    title: b('Une campagne, du terrain au visuel', 'A campaign, from research to visual'),
    desc: b('Gemini cherche, Claude écrit les textes, ChatGPT prépare le visuel.', 'Gemini researches, Claude writes the copy, ChatGPT prepares the visual.'),
    task: b('Prépare une campagne pour [produit ou service], cible : [qui], marché : [pays ou ville], objectif : [ce que vous voulez obtenir].', 'Prepare a campaign for [product or service], audience: [who], market: [country or city], goal: [what you want to achieve].'),
    steps: [
      S('plan', 'gemini-tasks', 1, b('Chercher', 'Research'), 'Dans Gemini : recherche sur la cible et les concurrents, avec sources.', 'In Gemini: research the audience and competitors, with sources.'),
      S('single', 'claude-code', 1, b('Écrire', 'Write'), 'Écris le message, trois accroches et les textes de la campagne.', 'Write the message, three hooks and the campaign copy.'),
      S('single', 'chatgpt-work', 1, b('Préparer le visuel', 'Visual'), 'Dans ChatGPT : crée le visuel de la campagne.', 'In ChatGPT: create the campaign visual.')
    ]
  },
  {
    id: 'mkt-social', role: 'marketing', category: 'writing', difficulty: 1,
    title: b('Une semaine de publications', 'A week of posts'),
    desc: b('Sept publications écrites, puis une image pour les plus importantes.', 'Seven posts written, then an image for the most important ones.'),
    task: b('Écris sept publications pour [réseau social] sur [sujet], ton : [ton], pour [public].', 'Write seven posts for [social network] about [topic], tone: [tone], for [audience].'),
    steps: [
      S('plan', 'claude-code', 1, b('Écrire', 'Write'), 'Écris les sept publications, une par jour, avec un appel à l’action.', 'Write the seven posts, one per day, each with a call to action.'),
      S('single', 'chatgpt-work', 1, b('Préparer le visuel', 'Visual'), 'Dans ChatGPT : crée une image pour les deux publications clés.', 'In ChatGPT: create an image for the two key posts.')
    ]
  },
  {
    id: 'mkt-article', role: 'marketing', category: 'writing', difficulty: 1,
    title: b('Un article de blog qui répond à une vraie question', 'A blog article that answers a real question'),
    desc: b('Les questions du public d’abord, puis l’article.', 'The audience’s questions first, then the article.'),
    task: b('Écris un article de blog sur [sujet] pour [public]. Mot-clé principal : [mot-clé].', 'Write a blog article about [topic] for [audience]. Main keyword: [keyword].'),
    steps: [
      S('plan', 'agy', 1, b('Chercher', 'Research'), 'Liste les questions que le public se pose et les mots qu’il emploie.', 'List the questions the audience asks and the words it uses.'),
      S('single', 'claude-code', 1, b('Écrire', 'Write'), 'Écris l’article à partir de ces questions, avec un plan clair.', 'Write the article from those questions, with a clear outline.')
    ]
  },

  // ---- Création d’images / Image ----
  {
    id: 'img-prompt', role: 'image', category: 'image', difficulty: 1,
    title: b('Une idée devient une image précise', 'An idea becomes a precise image'),
    desc: b('Claude détaille votre idée en descriptions soignées, ChatGPT crée l’image.', 'Claude turns your idea into careful descriptions, ChatGPT creates the image.'),
    task: b('Je veux une image de [sujet], style : [style], ambiance : [ambiance], format : [format].', 'I want an image of [subject], style: [style], mood: [mood], format: [format].'),
    steps: [
      S('plan', 'claude-code', 1, b('Décrire', 'Describe'), 'Écris trois descriptions détaillées de l’image : sujet, lumière, cadrage, style.', 'Write three detailed descriptions of the image: subject, light, framing, style.'),
      S('single', 'chatgpt-work', 1, b('Créer l’image', 'Create the image'), 'Dans ChatGPT : colle la meilleure description et crée l’image.', 'In ChatGPT: paste the best description and create the image.')
    ]
  },
  {
    id: 'img-brand', role: 'image', category: 'image', difficulty: 1,
    title: b('Une série d’images cohérente pour une marque', 'A consistent image set for a brand'),
    desc: b('Une charte visuelle écrite, puis les images, avec Gemini en variante.', 'A written visual guide, then the images, with Gemini as a variant.'),
    task: b('Crée une série de quatre images pour la marque [nom], activité : [activité], couleurs : [couleurs].', 'Create a set of four images for the brand [name], activity: [activity], colours: [colours].'),
    steps: [
      S('plan', 'claude-code', 1, b('Définir la charte', 'Define the style'), 'Écris la ligne visuelle (couleurs, style, cadrage) et quatre descriptions d’images.', 'Write the visual line (colours, style, framing) and four image descriptions.'),
      S('single', 'chatgpt-work', 1, b('Créer les images', 'Create the images'), 'Dans ChatGPT : crée les quatre images.', 'In ChatGPT: create the four images.'),
      S('single', 'gemini-tasks', 1, b('Variante', 'Variant'), 'Dans Gemini : crée une variante de la meilleure image, pour comparer.', 'In Gemini: create a variant of the best image, to compare.')
    ]
  },
  {
    id: 'img-product', role: 'image', category: 'image', difficulty: 1,
    title: b('Une photo produit mise en scène', 'A staged product photo'),
    desc: b('La scène est décrite avec soin, puis Gemini crée l’image.', 'The scene is described with care, then Gemini creates the image.'),
    task: b('Je vends [produit]. Je veux une photo mise en scène : décor [décor], lumière [lumière].', 'I sell [product]. I want a staged photo: setting [setting], light [light].'),
    steps: [
      S('plan', 'claude-code', 1, b('Décrire la scène', 'Describe the scene'), 'Décris la scène pour une photo produit : décor, lumière, angle, accessoires.', 'Describe the scene for a product photo: setting, light, angle, props.'),
      S('single', 'gemini-tasks', 1, b('Créer l’image', 'Create the image'), 'Dans Gemini : crée l’image à partir de la description.', 'In Gemini: create the image from the description.')
    ]
  },

  // ---- Vidéo / Video ----
  {
    id: 'vid-script', role: 'video', category: 'video', difficulty: 1,
    title: b('Du script au clip', 'From script to clip'),
    desc: b('Claude écrit le script et le découpage plan par plan, Gemini crée la vidéo.', 'Claude writes the script and the shot list, Gemini creates the video.'),
    task: b('Je veux une vidéo de [durée] sur [sujet], pour [public], ton : [ton].', 'I want a [length] video about [topic], for [audience], tone: [tone].'),
    steps: [
      S('plan', 'claude-code', 1, b('Écrire le script', 'Write the script'), 'Écris le script et le découpage plan par plan.', 'Write the script and the shot-by-shot list.'),
      S('single', 'gemini-tasks', 1, b('Créer la vidéo', 'Create the video'), 'Dans Gemini : crée la vidéo à partir du découpage.', 'In Gemini: create the video from the shot list.')
    ]
  },
  {
    id: 'vid-short', role: 'video', category: 'video', difficulty: 1,
    title: b('Une vidéo courte pour les réseaux', 'A short video for social networks'),
    desc: b('Des idées d’accroche, un script de trente secondes, puis la vidéo.', 'Hook ideas, a thirty-second script, then the video.'),
    task: b('Je veux une vidéo courte pour [réseau] sur [sujet]. Public : [public].', 'I want a short video for [network] about [topic]. Audience: [audience].'),
    steps: [
      S('plan', 'agy', 1, b('Trouver l’accroche', 'Find the hook'), 'Propose dix idées d’accroche pour les trois premières secondes.', 'Suggest ten hook ideas for the first three seconds.'),
      S('single', 'claude-code', 1, b('Écrire le script', 'Write the script'), 'Écris le script de trente secondes avec la meilleure accroche.', 'Write the thirty-second script with the best hook.'),
      S('single', 'gemini-tasks', 1, b('Créer la vidéo', 'Create the video'), 'Dans Gemini : crée la vidéo.', 'In Gemini: create the video.')
    ]
  },
  {
    id: 'vid-explainer', role: 'video', category: 'video', difficulty: 1,
    title: b('Une vidéo qui explique', 'An explainer video'),
    desc: b('Un plan et une voix off, des images de storyboard, puis la vidéo.', 'An outline and a narration, storyboard images, then the video.'),
    task: b('Je veux une vidéo qui explique [sujet] à [public] en [durée].', 'I want a video that explains [topic] to [audience] in [length].'),
    steps: [
      S('plan', 'claude-code', 1, b('Écrire le plan', 'Write the outline'), 'Écris le plan, le texte de la voix off et la liste des plans.', 'Write the outline, the narration text and the list of shots.'),
      S('single', 'chatgpt-work', 1, b('Storyboard', 'Storyboard'), 'Dans ChatGPT : crée les images du storyboard.', 'In ChatGPT: create the storyboard images.'),
      S('single', 'gemini-tasks', 1, b('Créer la vidéo', 'Create the video'), 'Dans Gemini : crée la vidéo à partir du storyboard.', 'In Gemini: create the video from the storyboard.')
    ]
  },

  // ---- Recherche / Research ----
  {
    id: 'res-landscape', role: 'research', category: 'research', difficulty: 1,
    title: b('Faire le tour d’un sujet, sources à l’appui', 'Survey a topic, with sources'),
    desc: b('Gemini cherche sur le web, puis deux outils synthétisent et vérifient.', 'Gemini searches the web, then two tools synthesise and check.'),
    task: b('Fais le tour de [sujet] : état des connaissances, désaccords, sources. Période : [période].', 'Survey [topic]: state of knowledge, disagreements, sources. Period: [period].'),
    steps: [
      S('plan', 'gemini-tasks', 1, b('Chercher', 'Research'), 'Dans Gemini : cherche sur le web et note chaque source.', 'In Gemini: search the web and note every source.'),
      S('single', 'agy', 1, b('Synthétiser', 'Synthesise'), 'Synthétise ce qui a été trouvé et signale les contradictions.', 'Synthesise what was found and flag contradictions.'),
      S('single', 'claude-code', 1, b('Rédiger la note', 'Write the note'), 'Écris la note finale et dis ce qui reste à vérifier.', 'Write the final note and say what is left to verify.')
    ]
  },
  {
    id: 'res-reading', role: 'research', category: 'research', difficulty: 1,
    title: b('Lire un article scientifique de près', 'Read a scientific paper closely'),
    desc: b('Un résumé fidèle, puis une lecture critique : méthode, limites, suites.', 'A faithful summary, then a critical reading: method, limits, next steps.'),
    task: b('Voici un article : [collez le texte ou le résumé]. Résume-le, puis critique la méthode et les limites.', 'Here is a paper: [paste the text or abstract]. Summarise it, then critique the method and the limits.'),
    steps: [
      S('plan', 'agy', 1, b('Résumer', 'Summarise'), 'Résume l’article sans rien y ajouter : question, méthode, résultats.', 'Summarise the paper without adding anything: question, method, results.'),
      S('single', 'claude-code', 1, b('Lire en critique', 'Read critically'), 'Lis-le avec esprit critique : limites, biais possibles, questions ouvertes.', 'Read it critically: limits, possible biases, open questions.')
    ]
  },
  {
    id: 'res-compare', role: 'research', category: 'research', difficulty: 1,
    title: b('Comparer des options dans un tableau', 'Compare options in a table'),
    desc: b('ChatGPT cherche les faits, Claude les range dans un tableau honnête.', 'ChatGPT looks up the facts, Claude sets them in an honest table.'),
    task: b('Compare [option A], [option B] et [option C] selon ces critères : [critères].', 'Compare [option A], [option B] and [option C] on these criteria: [criteria].'),
    steps: [
      S('plan', 'chatgpt-work', 1, b('Rassembler les faits', 'Gather the facts'), 'Dans ChatGPT : rassemble les faits sur chaque option, avec liens.', 'In ChatGPT: gather the facts on each option, with links.'),
      S('single', 'claude-code', 1, b('Faire le tableau', 'Build the table'), 'Range-les dans un tableau et dis ce qui n’est pas établi.', 'Set them in a table and say what is not established.')
    ]
  },

  // ---- Étudiant / Student ----
  {
    id: 'stu-explain', role: 'student', category: 'question', difficulty: 1,
    title: b('Comprendre une notion, puis s’interroger', 'Understand a concept, then quiz yourself'),
    desc: b('Une explication à trois niveaux, puis des questions pour vérifier.', 'An explanation at three levels, then questions to check.'),
    task: b('Explique-moi [notion] de mon cours de [matière]. Mon niveau : [niveau].', 'Explain [concept] from my [subject] course. My level: [level].'),
    steps: [
      S('plan', 'claude-code', 1, b('Expliquer', 'Explain'), 'Explique la notion en trois niveaux : image simple, définition, exemple chiffré.', 'Explain the concept at three levels: simple picture, definition, worked example.'),
      S('single', 'agy', 0, b('S’interroger', 'Quiz yourself'), 'Pose cinq questions pour vérifier que c’est compris, avec les réponses à la fin.', 'Ask five questions to check understanding, with the answers at the end.')
    ]
  },
  {
    id: 'stu-revision', role: 'student', category: 'writing', difficulty: 1,
    title: b('Une fiche de révision et des cartes', 'A revision sheet and flashcards'),
    desc: b('Vos notes deviennent une fiche, puis des cartes de mémorisation.', 'Your notes become a sheet, then memory flashcards.'),
    task: b('Voici mes notes de cours : [collez-les]. Fais une fiche de révision et des cartes questions-réponses.', 'Here are my course notes: [paste them]. Make a revision sheet and question-and-answer flashcards.'),
    steps: [
      S('plan', 'claude-code', 1, b('Écrire la fiche', 'Write the sheet'), 'Écris la fiche : l’essentiel en une page, les formules et les définitions.', 'Write the sheet: the essentials on one page, formulas and definitions.'),
      S('single', 'agy', 1, b('Créer les cartes', 'Create the flashcards'), 'Crée vingt cartes question-réponse à partir de la fiche.', 'Create twenty question-and-answer cards from the sheet.')
    ]
  },
  {
    id: 'stu-essay', role: 'student', category: 'review', difficulty: 1,
    title: b('Améliorer sa dissertation sans la faire écrire', 'Improve your essay without having it written'),
    desc: b('Des contre-arguments, puis un retour sur la structure : le texte reste le vôtre.', 'Counter-arguments, then feedback on structure: the text stays yours.'),
    task: b('Voici ma dissertation sur [sujet] : [collez-la]. Donne-moi des retours, sans la réécrire.', 'Here is my essay on [topic]: [paste it]. Give me feedback, without rewriting it.'),
    steps: [
      S('plan', 'agy', 1, b('Contre-arguments', 'Counter-arguments'), 'Trouve les contre-arguments les plus sérieux à ma thèse.', 'Find the most serious counter-arguments to my thesis.'),
      S('single', 'claude-code', 1, b('Retour sur la structure', 'Structure feedback'), 'Donne un retour sur la structure et la clarté, sans réécrire le texte.', 'Give feedback on structure and clarity, without rewriting the text.')
    ]
  },

  // ---- Entrepreneur ----
  {
    id: 'ent-idea', role: 'entrepreneur', category: 'research', difficulty: 1,
    title: b('Tester une idée d’entreprise', 'Test a business idea'),
    desc: b('Le marché d’abord, puis un modèle économique d’une page, puis les risques.', 'The market first, then a one-page business model, then the risks.'),
    task: b('Mon idée : [décrivez-la]. Clients visés : [qui], lieu : [pays ou ville].', 'My idea: [describe it]. Target customers: [who], place: [country or city].'),
    steps: [
      S('plan', 'gemini-tasks', 1, b('Étudier le marché', 'Study the market'), 'Dans Gemini : cherche la taille du marché, les concurrents et les prix, avec sources.', 'In Gemini: look up market size, competitors and prices, with sources.'),
      S('single', 'claude-code', 1, b('Modèle économique', 'Business model'), 'Écris le modèle économique sur une page : clients, offre, revenus, coûts.', 'Write the business model on one page: customers, offer, revenue, costs.'),
      S('single', 'agy', 1, b('Risques', 'Risks'), 'Liste les dix risques les plus sérieux et comment les tester à peu de frais.', 'List the ten most serious risks and how to test them cheaply.')
    ]
  },
  {
    id: 'ent-pitch', role: 'entrepreneur', category: 'writing', difficulty: 1,
    title: b('Préparer un pitch et ses questions difficiles', 'Prepare a pitch and its tough questions'),
    desc: b('Un pitch d’une minute, puis les questions qu’un investisseur posera.', 'A one-minute pitch, then the questions an investor will ask.'),
    task: b('Je présente [entreprise] à [investisseur ou client]. Ce que nous faisons : [description]. Chiffres clés : [chiffres].', 'I present [company] to [investor or customer]. What we do: [description]. Key figures: [figures].'),
    steps: [
      S('plan', 'claude-code', 1, b('Écrire le pitch', 'Write the pitch'), 'Écris un pitch d’une minute, clair et sans jargon.', 'Write a one-minute pitch, clear and jargon-free.'),
      S('single', 'agy', 1, b('Questions difficiles', 'Tough questions'), 'Pose les dix questions les plus dures qu’on me fera, avec des pistes de réponse.', 'Ask the ten toughest questions I will be asked, with answer leads.')
    ]
  },
  {
    id: 'ent-offer', role: 'entrepreneur', category: 'writing', difficulty: 1,
    title: b('Une offre claire et son prix', 'A clear offer and its price'),
    desc: b('Trois formules de prix, puis la page de vente et son visuel.', 'Three pricing options, then the sales page and its visual.'),
    task: b('Je vends [produit ou service] à [clients]. Mes coûts : [coûts]. Monnaie : [monnaie]. Écris l’offre et propose des prix.', 'I sell [product or service] to [customers]. My costs: [costs]. Currency: [currency]. Write the offer and suggest prices.'),
    steps: [
      S('plan', 'claude-code', 1, b('Choisir les prix', 'Choose the prices'), 'Propose trois formules de prix et explique laquelle mettre en avant.', 'Suggest three pricing options and explain which to feature.'),
      S('single', 'claude-code', 1, b('Écrire la page', 'Write the page'), 'Écris la page de vente de la formule choisie.', 'Write the sales page for the chosen option.'),
      S('single', 'chatgpt-work', 1, b('Préparer le visuel', 'Visual'), 'Dans ChatGPT : crée l’image principale de la page.', 'In ChatGPT: create the main image of the page.')
    ]
  }
]

/** Example tasks per job for the home page chips (four each, in both languages). */
export const ROLE_EXAMPLES: Record<UserRole, readonly Bilingual[]> = {
  developer: [
    b('Corrige le bug de division par zéro dans calc.py', 'Fix the division-by-zero bug in calc.py'),
    b('Ajoute des tests pour la fonction de validation des e-mails', 'Add tests for the e-mail validation function'),
    b('Relis ce script et signale les risques de sécurité', 'Review this script and point out security risks'),
    b('Explique ce que fait cette expression régulière', 'Explain what this regular expression does')
  ],
  manager: [
    b('Résume mes notes de réunion en décisions et actions', 'Summarise my meeting notes into decisions and actions'),
    b('Rédige un e-mail pour annoncer un changement d’organisation', 'Write an e-mail announcing a change of organisation'),
    b('Prépare les questions d’un entretien annuel', 'Prepare the questions for an annual review'),
    b('Compare deux outils de gestion de projet pour mon équipe', 'Compare two project-management tools for my team')
  ],
  marketing: [
    b('Écris trois accroches pour le lancement de notre produit', 'Write three hooks for our product launch'),
    b('Rédige un e-mail de relance pour un client en retard de paiement', 'Write a reminder e-mail for a customer late on payment'),
    b('Compare trois concurrents et leur façon de communiquer', 'Compare three competitors and how they communicate'),
    b('Propose un calendrier de publications pour un mois', 'Suggest a posting calendar for a month')
  ],
  image: [
    b('Génère une image d’un marché à Abidjan au coucher du soleil', 'Generate an image of a market in Abidjan at sunset'),
    b('Fais-moi une affiche pour un concert de samedi', 'Make me a poster for a Saturday concert'),
    b('Dessine une mascotte pour mon café', 'Draw a mascot for my café'),
    b('Écris une description précise pour une photo de produit', 'Write a precise description for a product photo')
  ],
  video: [
    b('Génère une vidéo de quinze secondes pour présenter ma boutique', 'Generate a fifteen-second video presenting my shop'),
    b('Écris le scénario d’une vidéo sur la cuisine ivoirienne', 'Write the script of a video about Ivorian cooking'),
    b('Propose dix idées d’accroche pour une vidéo courte', 'Suggest ten hook ideas for a short video'),
    b('Découpe ce texte en plans pour une vidéo explicative', 'Split this text into shots for an explainer video')
  ],
  research: [
    b('Compare trois approches de ce problème, avec les sources', 'Compare three approaches to this problem, with sources'),
    b('Résume cet article et critique sa méthode', 'Summarise this paper and critique its method'),
    b('Fais l’état de l’art sur ce sujet', 'Survey the state of the art on this topic'),
    b('Quelle est la définition exacte de ce terme ?', 'What is the exact definition of this term?')
  ],
  student: [
    b('Explique-moi cette notion avec un exemple chiffré', 'Explain this concept with a worked example'),
    b('Fais une fiche de révision à partir de mes notes', 'Make a revision sheet from my notes'),
    b('Quelle est la capitale de la Côte d’Ivoire ?', 'What is the capital of Côte d’Ivoire?'),
    b('Relis ma dissertation et dis-moi ce qui manque', 'Read my essay and tell me what is missing')
  ],
  entrepreneur: [
    b('Compare trois outils de facturation pour une petite entreprise', 'Compare three invoicing tools for a small business'),
    b('Écris un pitch d’une minute pour mon entreprise', 'Write a one-minute pitch for my company'),
    b('Propose trois formules de prix pour mon service', 'Suggest three pricing options for my service'),
    b('Rédige un e-mail de relance pour un client en retard de paiement', 'Write a reminder e-mail for a customer late on payment')
  ]
}

export function recipesFor(role: UserRole | 'none'): Recipe[] {
  return role === 'none' ? [...RECIPES] : RECIPES.filter((r) => r.role === role)
}

/** The three recipes shown on the home page: the job's own, or a mixed trio when no job is chosen. */
export function homeRecipes(role: UserRole | 'none'): Recipe[] {
  if (role !== 'none') return recipesFor(role).slice(0, 3)
  return ['mgr-meeting', 'mkt-campaign', 'res-landscape'].map((id) => recipeById(id)).filter((r): r is Recipe => r !== undefined)
}

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id)
}

/** The example chips of a job; empty when no job is chosen (the application then shows its neutral examples). */
export function examplesFor(role: UserRole | 'none', lang: Lang): string[] {
  return role === 'none' ? [] : ROLE_EXAMPLES[role].map((e) => e[lang])
}

/** Search in the title, description and tool names, accent- and case-insensitive. */
export function searchRecipes(list: readonly Recipe[], query: string, lang: Lang): Recipe[] {
  const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...list]
  return list.filter((r) => {
    const hay = norm([r.title[lang], r.desc[lang], ...r.steps.map((s) => s.tool)].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

/** The ordinary pipeline of a recipe (same step maker as the router; edit rights come from Settings only). */
export function recipePipeline(recipe: Recipe, opts: RouteOptions, lang: Lang): Pipeline {
  return pipelineFromSpecs(
    recipe.steps,
    recipe.category,
    opts,
    [{ key: 'route.recipe', params: { recipe: recipe.title[lang] } }]
  )
}

/** The classification a recipe starts the plan screen with: sure of itself, since the person chose the recipe. */
export function recipeClassification(recipe: Recipe, lang: Lang): Classification {
  return {
    category: recipe.category,
    difficulty: recipe.difficulty,
    risk: 'low',
    confidence: 1,
    reasons: [{ key: 'classify.recipe', params: { recipe: recipe.title[lang] } }],
    needsConfirm: false
  }
}

/** Is this step a hand-off to a web workspace (image and video are made there)? */
export const isHandoffStep = (s: RecipeStep): boolean => TOOL_KIND[s.tool] === 'handoff'
