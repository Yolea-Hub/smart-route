import { defaultCodexModels, modelFor, TOOL_KIND, TOOL_VENDOR } from '../../../core/catalog'
import { ATLAS } from '../../../core/atlas'
import { VendorLogo } from '../components/VendorLogo'
import { useI18n } from '../i18n/i18n'

/** The capability atlas: one card per tool, with its official logo, in modest « good at » words. Static, so the browser build has it too. */
export function AtlasView({ onBack }: { onBack: () => void }) {
  const { t, lang } = useI18n()
  return (
    <section aria-labelledby="atlas-h" className="view">
      <h1 id="atlas-h">{t('atlas.title')}</h1>
      <p className="lead">{t('atlas.sub')}</p>
      <div className="recipe-grid">
        {ATLAS.map((e) => {
          const cli = TOOL_KIND[e.tool] === 'cli'
          const model = cli ? modelFor(e.tool, e.bestTier, defaultCodexModels()).label : ''
          return (
            <article key={e.tool} className={`sg-card sg-card--raised atlas-card v-${TOOL_VENDOR[e.tool]}`} aria-labelledby={`at-${e.tool}`}>
              <header className="atlas-head">
                <VendorLogo vendor={TOOL_VENDOR[e.tool]} tool={e.tool} size={32} />
                <h2 id={`at-${e.tool}`}>{t(`tool.${e.tool}`)}</h2>
              </header>
              <p className="muted">{e.where[lang]}</p>
              <h3>{t('atlas.strengths')}</h3>
              <ul>{e.strengths.map((s, i) => <li key={i}>{s[lang]}</li>)}</ul>
              <h3>{t('atlas.tasks')}</h3>
              <ul>{e.typicalTasks.map((s, i) => <li key={i}>{s[lang]}</li>)}</ul>
              {cli && <p className="small">{t('atlas.best', { tier: t(`tier.${e.bestTier}`), model })}</p>}
              <h3>{t('atlas.limits')}</h3>
              <ul className="muted">{e.limits.map((s, i) => <li key={i}>{s[lang]}</li>)}</ul>
            </article>
          )
        })}
      </div>
      <p className="muted small">{t('atlas.note')}</p>
      <div className="row">
        <button type="button" className="sg-button" onClick={onBack}>{t('recipes.back')}</button>
      </div>
    </section>
  )
}
