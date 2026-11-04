import { TOOL_KIND } from '../../../core/catalog'
import type { Recipe } from '../../../core/recipes'
import { useI18n } from '../i18n/i18n'
import { RecipeRoute } from './RecipeRoute'

/** One recipe: title, one line, its route as logos, and « Use this recipe ». With `detail`, the steps are listed too. `heading` is the title's level. */
export function RecipeCard({ recipe, onUse, detail = false, heading = 'h3' }: { recipe: Recipe; onUse: (r: Recipe) => void; detail?: boolean; heading?: 'h2' | 'h3' }) {
  const { t, lang } = useI18n()
  const Heading = heading
  const web = recipe.steps.some((s) => TOOL_KIND[s.tool] === 'handoff')
  return (
    <article className="sg-card sg-card--raised recipe" aria-labelledby={`rc-${recipe.id}`}>
      <Heading id={`rc-${recipe.id}`}>{recipe.title[lang]}</Heading>
      <p className="muted">{recipe.desc[lang]}</p>
      <RecipeRoute steps={recipe.steps} />
      <p className="tags">
        <span className="tag tag-quiet">{t(`profile.${recipe.role}`)}</span>
        <span className="tag tag-quiet">{t('recipes.stepsCount', { n: recipe.steps.length })}</span>
        {web && <span className="tag tag-quiet">{t('recipes.web')}</span>}
      </p>
      {detail && (
        <details className="sg-details">
          <summary>{t('recipes.steps')}</summary>
          <ol className="recipe-steps">
            {recipe.steps.map((s, i) => (
              <li key={i}>
                <strong>{t(`tool.${s.tool}`)}</strong> · {s.instruction[lang]}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="row">
        <button type="button" className="sg-button" aria-describedby={`rc-${recipe.id}`} onClick={() => onUse(recipe)}>
          {t('recipes.use')}
        </button>
      </div>
    </article>
  )
}
