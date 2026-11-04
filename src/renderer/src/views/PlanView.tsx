import { useState } from 'react'
import { modelFor, TOOL_KIND, TOOL_VENDOR } from '../../../core/catalog'
import type { Category, Pipeline, Role, Settings, Step, Tier, ToolId, VendorAccountStatus } from '../../../core/types'
import { CATEGORIES } from '../../../core/types'
import { PrimaryButton } from '../components/PrimaryButton'
import { RouteConstellation } from '../components/RouteConstellation'
import { ToolPicker } from '../components/ToolPicker'
import { WhyChips } from '../components/WhyChips'
import { useI18n } from '../i18n/i18n'
import { describedBy } from '../a11y'
import { IS_WEB } from '../transport'
import { isEdited, liveExplanation, pendingNodes, stepFlags, type PlanState } from '../planUtils'

const ROLES: Role[] = ['plan', 'execute', 'review', 'single']

interface Props {
  analysis: PlanState | null
  statuses: VendorAccountStatus[]
  settings: Settings
  onPipeline: (p: Pipeline) => void
  onCategory: (c: Category) => Promise<string | null>
  onApprove: () => Promise<string | null>
  onAuto: (v: boolean) => void
  onGoTask: () => void
  onGoAccounts: () => void
  onRecheck: () => Promise<void>
  rechecking: boolean
}

export function PlanView({ analysis, statuses, settings, onPipeline, onCategory, onApprove, onAuto, onGoTask, onGoAccounts, onRecheck, rechecking }: Props) {
  const { t, errorText, lang } = useI18n()
  const [tier3Ok, setTier3Ok] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!analysis) {
    return (
      <section aria-labelledby="plan-h" className="view view-narrow">
        <h1 id="plan-h">{t('plan.title')}</h1>
        <div data-state="empty">
          <p>{t('plan.empty')}</p>
        </div>
        <button type="button" className="sg-button" onClick={onGoTask}>
          {t('plan.goTask')}
        </button>
      </section>
    )
  }
  const { classification: c, pipeline } = analysis
  const flags = pipeline.steps.map((s) => stepFlags(s, statuses))
  const hasTier3 = flags.some((f) => f.tier3)
  const blocked = pipeline.steps.length === 0 || flags.some((f) => f.cliMissing) || (hasTier3 && !tier3Ok)

  const update = (id: string, patch: (s: Step) => Step): void =>
    onPipeline({ ...pipeline, steps: pipeline.steps.map((s) => (s.id === id ? patch(s) : s)) })

  const setTool = (s: Step, tool: ToolId): Step => {
    const tier = (TOOL_KIND[tool] === 'handoff' ? 1 : s.model.tier) as Tier
    return {
      ...s,
      tool,
      model: modelFor(tool, tier, settings.codexModels),
      canEdit: s.role === 'execute' && settings.allowEdits && TOOL_KIND[tool] === 'cli'
    }
  }
  const setRole = (s: Step, role: Role): Step => ({ ...s, role, canEdit: role === 'execute' && settings.allowEdits && TOOL_KIND[s.tool] === 'cli' })

  // Why « Approve » cannot be used yet, in words (the button stays reachable by keyboard so that this can be read).
  const why = pipeline.steps.length === 0 ? t('plan.noSteps') : flags.some((f) => f.cliMissing) ? t('plan.blocked.connect') : hasTier3 && !tier3Ok ? t('plan.blocked.tier3') : ''
  const approve = async (): Promise<void> => {
    if (blocked || busy) return
    setBusy(true)
    setError(null)
    const err = await onApprove()
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <section aria-labelledby="plan-h" className="view view-narrow">
      <h1 id="plan-h">{t('plan.title')}</h1>

      {pipeline.steps.length > 0 && (
        <>
          <h2 className="section-h">{t('plan.preview')}</h2>
          <RouteConstellation key={analysis.seq} nodes={pendingNodes(pipeline)} reveal />
        </>
      )}

      <div className="sg-card sg-card--raised">
        <h2>{t('plan.classification')}</h2>
        <p className="tags">
          <span className="tag">{t(`cat.${c.category}`)}</span>
          <span className="tag">{t(`diff.${c.difficulty}`)}</span>
          <span className={`tag ${c.risk === 'high' ? 'tag-strong' : ''}`}>{t(`risk.${c.risk}`)}</span>
          <span className="tag tag-quiet">{t('plan.confidence', { n: Math.round(c.confidence * 100) })}</span>
          <span className="tag tag-quiet">{t(`pattern.${pipeline.pattern}`)}</span>
        </p>
        {c.needsConfirm && (
          <div className="sg-field">
            <label htmlFor="cat-pick" className="sg-field__label">{t('plan.confirmCategory')}</label>
            <select
              id="cat-pick"
              className="sg-field__input"
              value={c.category}
              onChange={(e) => {
                void onCategory(e.target.value as Category).then((err) => setError(err))
              }}
            >
              {CATEGORIES.map((k) => (
                <option key={k} value={k}>{t(`cat.${k}`)}</option>
              ))}
            </select>
          </div>
        )}
        <h3>{t('plan.why')}</h3>
        <WhyChips entries={[...c.reasons, ...liveExplanation(analysis)]} />
      </div>

      <h2 className="section-h">{t('plan.steps')}</h2>
      {pipeline.steps.length === 0 && <p className="sg-notice" role="status">{t('plan.noSteps')}</p>}
      <ol className="steps">
        {pipeline.steps.map((s, i) => {
          const f = flags[i]
          const cli = TOOL_KIND[s.tool] === 'cli'
          return (
            <li key={s.id} className={`sg-card sg-card--raised step v-${TOOL_VENDOR[s.tool]}`}>
              <div className="step-head">
                <h3>{t('plan.step', { n: i + 1 })}{s.label ? ` · ${s.label[lang]}` : ''}</h3>
                {isEdited(s, analysis.original) && <span className="tag tag-strong">{t('plan.edited')}</span>}
                <span className="tag">{t(`tier.${s.model.tier}`)}</span>
                <span className={`tag ${s.canEdit ? 'tag-strong' : 'tag-quiet'}`}>{s.canEdit ? t('plan.edits') : t('plan.readOnly')}</span>
              </div>
              <div className="step-fields">
                <div className="sg-field field-wide">
                  <span id={`tool-${s.id}-label`} className="sg-field__label">{t('plan.toolLabel')}</span>
                  <ToolPicker id={`tool-${s.id}`} value={s.tool} onChange={(tool) => update(s.id, (x) => setTool(x, tool))} />
                </div>
                <div className="sg-field">
                  <label htmlFor={`model-${s.id}`} className="sg-field__label">{t('plan.modelLabel')}</label>
                  <select
                    id={`model-${s.id}`}
                    className="sg-field__input"
                    value={s.model.tier}
                    disabled={!cli}
                    onChange={(e) => update(s.id, (x) => ({ ...x, model: modelFor(x.tool, Number(e.target.value) as Tier, settings.codexModels) }))}
                  >
                    {cli ? (
                      ([0, 1, 2, 3] as Tier[]).map((tier) => (
                        <option key={tier} value={tier}>{t(`tier.${tier}`)} · {modelFor(s.tool, tier, settings.codexModels).label}</option>
                      ))
                    ) : (
                      <option value={s.model.tier}>{s.model.label}</option>
                    )}
                  </select>
                </div>
                <div className="sg-field">
                  <label htmlFor={`role-${s.id}`} className="sg-field__label">{t('plan.roleLabel')}</label>
                  <select id={`role-${s.id}`} className="sg-field__input" value={s.role} onChange={(e) => update(s.id, (x) => setRole(x, e.target.value as Role))}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{t(`role.${r}`)}</option>
                    ))}
                  </select>
                </div>
              </div>
              {f.cliMissing && (
                <p className="sg-notice">
                  {t('plan.connectCta', { tool: t(`tool.${s.tool}`) })}{' '}
                  <button type="button" className="sg-button" onClick={onGoAccounts}>{t('plan.connect')}</button>
                </p>
              )}
              {f.cliUnknown && !f.cliMissing && (
                <p className="sg-notice" role="status">
                  {t('plan.unknownCta', { tool: t(`tool.${s.tool}`) })}{' '}
                  <button type="button" className="sg-button" disabled={rechecking} onClick={() => void onRecheck()}>
                    {rechecking ? t('accounts.rechecking') : t('plan.recheck')}
                  </button>
                </p>
              )}
              {f.webNotSigned && (
                <p className="sg-notice">
                  {t('plan.webNotSigned')}{' '}
                  <button type="button" className="sg-button" onClick={onGoAccounts}>{t('plan.connect')}</button>
                </p>
              )}
              {f.costly && <p className="sg-notice">{t('plan.costWarn', { tier: t(`tier.${s.model.tier}`), tool: t(`tool.${s.tool}`) })}</p>}
              {s.role === 'execute' && !settings.allowEdits && cli && <p className="muted small">{t(IS_WEB ? 'web.readOnly' : 'plan.editsOff')}</p>}
            </li>
          )
        })}
      </ol>

      {hasTier3 && (
        <div className="sg-check">
          <input id="tier3-ok" type="checkbox" checked={tier3Ok} onChange={(e) => setTier3Ok(e.target.checked)} />
          <label htmlFor="tier3-ok">{t('plan.tier3Confirm')}</label>
        </div>
      )}
      {error && <p id="plan-err" className="note" data-state="failure" role="alert">{error}</p>}
      <div className="row actions sticky-actions">
        <PrimaryButton aria-disabled={blocked || busy ? true : undefined} aria-describedby={describedBy(blocked && why !== '' && 'approve-why', error !== null && 'plan-err')} onClick={() => void approve()}>
          {t('plan.approve')}
        </PrimaryButton>
        {blocked && why !== '' && <span id="approve-why" className="sg-visually-hidden">{why}</span>}
        {!IS_WEB && (
          <div className="sg-check">
            <input id="plan-auto" type="checkbox" checked={settings.auto} onChange={(e) => onAuto(e.target.checked)} aria-describedby="auto-help" />
            <label htmlFor="plan-auto">{t('plan.auto')}</label>
          </div>
        )}
      </div>
      {!IS_WEB && <p id="auto-help" className="muted small">{t('plan.autoHelp')}</p>}
    </section>
  )
}
