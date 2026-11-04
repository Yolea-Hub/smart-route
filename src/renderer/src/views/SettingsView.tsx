import { useState } from 'react'
import { USER_ROLES, type Lang, type Settings, type Tier, type UserRole } from '../../../core/types'
import type { DetectedToolInfo } from '../api'
import { AboutPanel } from '../components/AboutPanel'
import { BridgeCard } from '../components/BridgeCard'
import { useI18n } from '../i18n/i18n'
import { IS_WEB, webTransport } from '../transport'

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const CLI: DetectedToolInfo['toolId'][] = ['claude-code', 'codex', 'agy']

interface Props {
  settings: Settings
  tools: DetectedToolInfo[]
  onChange: (patch: Partial<Omit<Settings, 'v'>>) => Promise<string | null>
}

export function SettingsView({ settings, tools, onChange }: Props) {
  const { t } = useI18n()
  const [saved, setSaved] = useState<string | null>(null)
  const [codex, setCodex] = useState(settings.codexModels)
  const [bad, setBad] = useState<Partial<Record<Tier, boolean>>>({})

  const save = async (patch: Partial<Omit<Settings, 'v'>>): Promise<void> => {
    const err = await onChange(patch)
    setSaved(err ?? t('settings.saved'))
  }
  // The two numbers keep what was typed, also when it is not valid: the field says so (aria-invalid, a sentence tied to it) and the
  // message is read out; nothing is silently put back (WCAG 3.3.1, 3.3.3, 4.1.3).
  const [typed, setTyped] = useState<Record<'dailyCap' | 'timeoutSec', string>>({ dailyCap: String(settings.dailyCap), timeoutSec: String(settings.timeoutSec) })
  const [badNum, setBadNum] = useState<Partial<Record<'dailyCap' | 'timeoutSec', boolean>>>({})
  const num = (id: string, key: 'dailyCap' | 'timeoutSec', min: number, max: number) => (
    <>
      <input
        id={id}
        type="number"
        className="sg-field__input"
        min={min}
        max={max}
        value={typed[key]}
        aria-invalid={badNum[key] === true ? true : undefined}
        aria-describedby={badNum[key] ? `${id}-err` : undefined}
        onChange={(e) => {
          setTyped((v) => ({ ...v, [key]: e.target.value }))
          if (badNum[key]) setBadNum((b) => ({ ...b, [key]: false }))
        }}
        onBlur={(e) => {
          const raw = e.target.value
          const n = Math.round(Number(raw))
          if (raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) {
            setBadNum((b) => ({ ...b, [key]: false }))
            setTyped((v) => ({ ...v, [key]: String(n) }))
            if (n !== settings[key]) void save({ [key]: n })
          } else {
            setBadNum((b) => ({ ...b, [key]: true }))
            setSaved(t('settings.numInvalid', { min, max }))
          }
        }}
      />
      {badNum[key] && <span id={`${id}-err`} className="sg-field__helper">{t('settings.numInvalid', { min, max })}</span>}
    </>
  )

  return (
    <section aria-labelledby="set-h" className="view view-narrow">
      <h1 id="set-h" tabIndex={-1}>{t('settings.title')}</h1>
      <p className="sg-visually-hidden" role="status" aria-live="polite">{saved}</p>
      {saved && <p className="sg-notice" aria-hidden="true">{saved}</p>}

      <div className="sg-card sg-card--raised">
        <h2>{t('settings.tools')}</h2>
        <ul className="statlist">
          {CLI.map((id) => {
            const found = tools.find((x) => x.toolId === id)
            return (
              <li key={id}>
                <span>{t(`tool.${id}`)}</span>
                {found ? <span className="muted small">{t('settings.version', { v: found.version })}</span> : <span className="tag tag-strong">{t('settings.notDetected')}</span>}
              </li>
            )
          })}
        </ul>
      </div>

      {!IS_WEB && (
        <div className="sg-card sg-card--raised">
          <h2>{t('settings.profile')}</h2>
          <div className="sg-field">
            <label className="sg-field__label" htmlFor="set-profile">{t('profile.group')}</label>
            <select
              id="set-profile"
              className="sg-field__input"
              value={settings.role}
              onChange={(e) => void save({ role: e.target.value as UserRole | 'none', roleAsked: true })}
            >
              <option value="none">{t('profile.none')}</option>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>{t(`profile.${r}`)}</option>
              ))}
            </select>
          </div>
          <p className="muted small">{t('settings.profileHelp')}</p>
        </div>
      )}

      {!IS_WEB && (
      <div className="sg-card sg-card--raised">
        <h2>{t('settings.behaviour')}</h2>
        <div className="sg-check">
          <input id="set-edits" type="checkbox" checked={settings.allowEdits} onChange={(e) => void save({ allowEdits: e.target.checked })} aria-describedby="h-edits" />
          <label htmlFor="set-edits">{t('settings.allowEdits')}</label>
        </div>
        <p id="h-edits" className="muted small">{t('settings.allowEditsHelp')}</p>
        <div className="sg-check">
          <input id="set-auto" type="checkbox" checked={settings.auto} onChange={(e) => void save({ auto: e.target.checked })} />
          <label htmlFor="set-auto">{t('settings.auto')}</label>
        </div>
        <div className="sg-check">
          <input id="set-cfg" type="checkbox" checked={settings.useClaudeConfig} onChange={(e) => void save({ useClaudeConfig: e.target.checked })} aria-describedby="h-cfg" />
          <label htmlFor="set-cfg">{t('settings.useClaudeConfig')}</label>
        </div>
        <p id="h-cfg" className="muted small">{t('settings.useClaudeConfigHelp')}</p>
      </div>
      )}

      {!IS_WEB && (
      <div className="sg-card sg-card--raised">
        <h2>{t('settings.codexModels')}</h2>
        <div className="step-fields">
          {([0, 1, 2, 3] as Tier[]).map((tier) => (
            <div className="sg-field" key={tier}>
              <label htmlFor={`cx-${tier}`} className="sg-field__label">{t('settings.codexTier', { tier: t(`tier.${tier}`) })}</label>
              <input
                id={`cx-${tier}`}
                type="text"
                className="sg-field__input"
                value={codex[String(tier) as '0']}
                aria-invalid={bad[tier] === true}
                aria-describedby={bad[tier] ? `cx-err-${tier}` : undefined}
                onChange={(e) => {
                  setCodex({ ...codex, [String(tier)]: e.target.value })
                  setBad({ ...bad, [tier]: !MODEL_RE.test(e.target.value) })
                }}
                onBlur={(e) => {
                  if (MODEL_RE.test(e.target.value) && e.target.value !== settings.codexModels[String(tier) as '0']) {
                    void save({ codexModels: { ...settings.codexModels, ...codex, [String(tier)]: e.target.value } })
                  }
                }}
              />
              {bad[tier] && <span id={`cx-err-${tier}`} className="sg-field__helper">{t('settings.codexInvalid')}</span>}
            </div>
          ))}
        </div>
      </div>
      )}

      <div className="sg-card sg-card--raised">
        <h2>{t('settings.limits')}</h2>
        <div className="step-fields">
          {!IS_WEB && (
            <>
              <div className="sg-field">
                <label className="sg-field__label" htmlFor="cap">{t('settings.dailyCap')}</label>
                {num('cap', 'dailyCap', 1, 1000)}
              </div>
              <div className="sg-field">
                <label className="sg-field__label" htmlFor="to">{t('settings.timeout')}</label>
                {num('to', 'timeoutSec', 10, 7200)}
              </div>
            </>
          )}
          <div className="sg-field">
            <label className="sg-field__label" htmlFor="lang">{t('settings.language')}</label>
            <select id="lang" className="sg-field__input" value={settings.lang} onChange={(e) => void save({ lang: e.target.value as Lang })}>
              <option value="fr">{t('lang.fr')}</option>
              <option value="en">{t('lang.en')}</option>
            </select>
          </div>
        </div>
      </div>

      {IS_WEB ? (
        <div className="sg-card sg-card--raised">
          <h2>{t('web.settingsTitle')}</h2>
          <p className="muted small">{t('web.settingsHelp')}</p>
          <div className="row">
            <button type="button" className="sg-button" onClick={() => webTransport?.forget()}>{t('web.disconnect')}</button>
          </div>
        </div>
      ) : (
        <BridgeCard />
      )}

      <AboutPanel />
    </section>
  )
}
