import { useMemo, useState } from 'react'
import { recipesFor, searchRecipes, type Recipe } from '../../../core/recipes'
import { USER_ROLES, type UserRole } from '../../../core/types'
import { RecipeCard } from '../components/RecipeCard'
import { useI18n } from '../i18n/i18n'
import { IS_WEB } from '../transport'

interface Props {
  /** The job chosen in Settings: the list opens on it. */
  role: UserRole | 'none'
  onUse: (r: Recipe) => void
  onBack: () => void
}

/** All recipes: filter by job, search, then « Use this recipe ». Also reachable from the browser build (read-only there). */
export function RecipesView({ role, onUse, onBack }: Props) {
  const { t, lang } = useI18n()
  const [filter, setFilter] = useState<UserRole | 'none'>(role)
  const [query, setQuery] = useState('')
  const list = useMemo(() => searchRecipes(recipesFor(filter), query, lang), [filter, query, lang])
  return (
    <section aria-labelledby="recipes-h" className="view">
      <h1 id="recipes-h">{t('recipes.title')}</h1>
      <p className="lead">{t('recipes.sub')}</p>
      {IS_WEB && <p className="sg-notice">{t('recipes.webNote')}</p>}
      <div className="chip-row" role="group" aria-label={t('recipes.filter')}>
        {(['none', ...USER_ROLES] as const).map((r) => (
          <button key={r} type="button" className="sg-chip" aria-pressed={filter === r} onClick={() => setFilter(r)}>
            {r === 'none' ? t('recipes.all') : t(`profile.${r}`)}
          </button>
        ))}
      </div>
      <div className="sg-field">
        <label htmlFor="recipes-q" className="sg-field__label">{t('recipes.search')}</label>
        <input id="recipes-q" type="search" className="sg-field__input" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="sg-visually-hidden" role="status">{t('recipes.count', { n: list.length })}</p>
      {list.length === 0 ? (
        <div data-state="empty"><p>{t('recipes.none')}</p></div>
      ) : (
        <div className="recipe-grid">
          {list.map((r) => (
            <RecipeCard key={r.id} recipe={r} onUse={onUse} detail heading="h2" />
          ))}
        </div>
      )}
      <div className="row">
        <button type="button" className="sg-button" onClick={onBack}>{t('recipes.back')}</button>
      </div>
    </section>
  )
}
