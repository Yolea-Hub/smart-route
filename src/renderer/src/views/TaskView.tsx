import { useEffect, useRef, useState } from 'react'
import { examplesFor, homeRecipes, type Recipe } from '../../../core/recipes'
import type { UserRole, VendorAccountStatus } from '../../../core/types'
import { RecipeCard } from '../components/RecipeCard'
import { AccountStrip } from '../components/AccountStrip'
import { PrimaryButton } from '../components/PrimaryButton'
import { useI18n } from '../i18n/i18n'
import type { FolderChoice } from '../api'
import { api } from '../api'
import { IS_WEB } from '../transport'

const EXAMPLES = ['task.ex1', 'task.ex2', 'task.ex3', 'task.ex4', 'task.ex5']

interface Props {
  text: string
  onText: (v: string) => void
  folder: FolderChoice | null
  onFolder: (f: FolderChoice | null) => void
  onAnalyse: () => Promise<string | null>
  statuses: VendorAccountStatus[]
  checking: boolean
  onOpenAccounts: () => void
  role: UserRole | 'none'
  /** The recipe chosen for this task, if any: its plan is used instead of the router's. */
  recipe: Recipe | null
  onClearRecipe: () => void
  onUseRecipe: (r: Recipe) => void
  onOpenRecipes: () => void
  onOpenAtlas: () => void
}

export function TaskView({ text, onText, folder, onFolder, onAnalyse, statuses, checking, onOpenAccounts, role, recipe, onClearRecipe, onUseRecipe, onOpenRecipes, onOpenAtlas }: Props) {
  const { t, lang, errorText } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  // Browser build: no folder picker. The folders the desktop app already knows are offered by id and label.
  const [known, setKnown] = useState<FolderChoice[]>([])
  useEffect(() => {
    if (!IS_WEB) return
    let alive = true
    api
      .listFolders()
      .then((l) => alive && setKnown(l))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const roleExamples = examplesFor(role, lang)
  const examples = roleExamples.length > 0 ? roleExamples : EXAMPLES.map((k) => t(k))
  const shown = homeRecipes(role)

  const pick = async (): Promise<void> => {
    try {
      const f = await api.pickFolder()
      if (f) onFolder(f)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const err = await onAnalyse()
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <section aria-labelledby="task-h" className="view home">
      <header className="intro">
        <p className="positioning">{t('home.positioning')}</p>
        <h1 id="task-h">{t('task.hero')}</h1>
        <p className="lead">{t('task.heroSub')}</p>
      </header>

      <form
        className="console"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim() && !busy) void submit()
        }}
      >
        <label htmlFor="task-text" className="sg-visually-hidden">{t('task.label')}</label>
        <textarea
          id="task-text"
          ref={area}
          className="sg-field__input task-input"
          rows={6}
          value={text}
          maxLength={200000}
          placeholder={t('task.placeholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'task-err' : undefined}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim() && !busy) void submit()
          }}
        />
        <div className="console-bar">
          {IS_WEB ? (
            <div className="folder" role="group" aria-label={t('task.folder')}>
              <label htmlFor="web-folder" className="sg-visually-hidden">{t('task.folder')}</label>
              <select
                id="web-folder"
                aria-describedby="web-folder-hint"
                className="sg-field__input"
                value={folder?.id ?? ''}
                onChange={(e) => onFolder(known.find((f) => f.id === e.target.value) ?? null)}
              >
                <option value="">{t('task.folderNone')}</option>
                {known.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
              {known.length === 0 && <span className="folder-name">{t('web.noFolders')}</span>}
              <span id="web-folder-hint" className="muted small">{t('web.folderHint')}</span>
            </div>
          ) : (
          <div className="folder" role="group" aria-label={t('task.folder')}>
            <span className="folder-name">{folder ? folder.label : t('task.folderNone')}</span>
            <button type="button" className="sg-button" onClick={() => void pick()}>
              {folder ? t('task.changeFolder') : t('task.pickFolder')}
            </button>
            {folder && (
              <button type="button" className="sg-button sg-button--quiet" onClick={() => onFolder(null)}>
                {t('task.clearFolder')}
              </button>
            )}
          </div>
          )}
          <span className="muted small hint">{t('task.hint')}</span>
          <PrimaryButton type="submit" disabled={busy || !text.trim()}>
            {busy ? t('task.analysing') : t('task.analyse')}
          </PrimaryButton>
        </div>
        {error && <p id="task-err" className="note" data-state="failure" role="alert">{error}</p>}
      </form>
      {recipe && (
        <div className="sg-notice recipe-banner" role="status">
          <p><strong>{t('recipes.active', { recipe: recipe.title[lang] })}</strong></p>
          <p className="muted small">{t('recipes.fill')}</p>
          <button type="button" className="sg-button sg-button--quiet" onClick={onClearRecipe}>{t('recipes.remove')}</button>
        </div>
      )}

      <div className="examples" role="group" aria-label={role === 'none' ? t('task.examples') : t('home.examplesFor')}>
        <span className="examples-label">{role === 'none' ? t('task.examples') : t('home.examplesFor')}</span>
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            className="sg-chip example"
            onClick={() => {
              onText(ex)
              area.current?.focus()
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      <section aria-labelledby="home-recipes-h" className="home-recipes">
        <h2 id="home-recipes-h">{t('home.recipesTitle')}</h2>
        <p className="muted">{t('home.recipesSub')}</p>
        <div className="recipe-grid">
          {shown.map((r) => (
            <RecipeCard key={r.id} recipe={r} onUse={onUseRecipe} />
          ))}
        </div>
        <div className="row">
          <button id="home-all-recipes" type="button" className="sg-button" onClick={onOpenRecipes}>{t('home.allRecipes')}</button>
          <button id="home-open-atlas" type="button" className="sg-button sg-button--quiet" onClick={onOpenAtlas}>{t('home.openAtlas')}</button>
        </div>
      </section>

      <AccountStrip statuses={statuses} checking={checking} onOpen={onOpenAccounts} />
    </section>
  )
}
