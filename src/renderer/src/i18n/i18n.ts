import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from 'react'
import en from './en.json'
import fr from './fr.json'
import type { ExplainEntry, Lang } from '../../../core/types'

const DICTS: Record<Lang, Record<string, string>> = { fr, en }

export type Params = Record<string, string | number>
export type TFunction = (key: string, params?: Params) => string

export function translate(lang: Lang, key: string, params?: Params): string {
  const raw = DICTS[lang][key] ?? DICTS.fr[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

/** Params whose value is itself an id that has a translated label. */
const LABELLED: Record<string, string> = { role: 'role', tool: 'tool', category: 'cat', vendor: 'vendor', tier: 'tier' }

/** Render a main-process message (key + params) with id-like params translated. */
export function explain(lang: Lang, entry: ExplainEntry): string {
  const params: Params = {}
  for (const [name, value] of Object.entries(entry.params ?? {})) {
    const prefix = LABELLED[name]
    const labelKey = prefix ? `${prefix}.${String(value)}` : undefined
    params[name] = labelKey && labelKey in DICTS[lang] ? translate(lang, labelKey) : value
  }
  return translate(lang, entry.key, params)
}

/** Visible name of a step's role: the recipe's own label when it has one (« Chercher / Research »), else the generic role. */
export function stepRoleName(lang: Lang, step: { role: string; label?: { fr: string; en: string } }): string {
  return step.label?.[lang] || translate(lang, `role.${step.role}`)
}

/** Turn any thrown IPC error into a translated message (main throws `err.*` keys). */
export function errorText(lang: Lang, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = /err\.[A-Za-z]+/.exec(msg)
  if (m && m[0] in DICTS[lang]) return translate(lang, m[0])
  return translate(lang, 'err.generic')
}

interface I18nValue {
  lang: Lang
  t: TFunction
  explain: (e: ExplainEntry) => string
  errorText: (e: unknown) => string
}
const Ctx = createContext<I18nValue>({
  lang: 'fr',
  t: (k, p) => translate('fr', k, p),
  explain: (e) => explain('fr', e),
  errorText: (e) => errorText('fr', e)
})

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = useCallback<TFunction>((k, p) => translate(lang, k, p), [lang])
  const value = useMemo<I18nValue>(
    () => ({ lang, t, explain: (e) => explain(lang, e), errorText: (e) => errorText(lang, e) }),
    [lang, t]
  )
  return createElement(Ctx.Provider, { value }, children)
}

export function useI18n(): I18nValue {
  return useContext(Ctx)
}
