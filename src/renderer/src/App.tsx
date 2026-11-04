import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Category, Lang, Pipeline, RunEvent, Settings, UserRole, Vendor, VendorAccountStatus } from '../../core/types'
import { recipeClassification, recipePipeline, type Recipe } from '../../core/recipes'
import { api, type DetectedToolInfo, type FolderChoice } from './api'
import { AccountDots } from './components/AccountDots'
import { Edge } from './components/Edge'
import { RoleScreen } from './components/RoleScreen'
import { LangSwitch } from './components/LangSwitch'
import { ShellFooter } from './components/ShellFooter'
import { SkyBand } from './components/SkyBand'
import { ThemeButton } from './components/ThemeButton'
import { I18nProvider, useI18n } from './i18n/i18n'
import { IS_WEB } from './transport'
import { useFocusOnNav } from './useFocusOnNav'
import { canAutoRun, type PlanState } from './planUtils'
import { reduceRun, type RunState } from './runState'
import { AccountsView } from './views/AccountsView'
import { AtlasView } from './views/AtlasView'
import { RecipesView } from './views/RecipesView'
import { HistoryView } from './views/HistoryView'
import { PlanView } from './views/PlanView'
import { RunView } from './views/RunView'
import { SettingsView } from './views/SettingsView'
import { TaskView } from './views/TaskView'

type Tab = 'accounts' | 'task' | 'plan' | 'run' | 'history' | 'settings' | 'recipes' | 'atlas'
/** Sogoma allows four destinations: task, plan and run are the three stages of one flow, shown under « Task ». */
const NAV: Tab[] = ['task', 'history', 'accounts', 'settings']
const FLOW: Tab[] = ['task', 'plan', 'run']
/** Recipes and the atlas are pages of the task destination: they open from its home page. */
const navOf = (tab: Tab): Tab => (FLOW.includes(tab) || tab === 'recipes' || tab === 'atlas' ? 'task' : tab)
/** After this long a status check that has not answered shows its fallback instead of waiting (Edge ceiling). */
const EDGE_CEILING_MS = 10_000
const ONBOARD_KEY = 'smartroute.onboarded'

function readOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARD_KEY) === '1'
  } catch {
    return false
  }
}
function writeOnboarded(): void {
  try {
    localStorage.setItem(ONBOARD_KEY, '1')
  } catch {
    /* storage unavailable: onboarding shows again next launch */
  }
}

const DEFAULT_SETTINGS: Settings = {
  v: 2,
  lang: 'fr',
  allowEdits: false,
  auto: false,
  useClaudeConfig: false,
  codexModels: { '0': 'gpt-6.1-sol', '1': 'gpt-6.1-sol', '2': 'gpt-6.1-sol', '3': 'gpt-6.1-sol' },
  dailyCap: 30,
  timeoutSec: 900,
  webSignedIn: { anthropic: false, openai: false, google: false },
  role: 'none',
  roleAsked: false
}

/** In the browser, runs are always read-only and always asked first: the settings the page sees say so. */
const forPage = (s: Settings): Settings => (IS_WEB ? { ...s, allowEdits: false, auto: false } : s)

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  return (
    <I18nProvider lang={settings.lang}>
      <Shell settings={settings} setSettings={setSettings} loaded={loaded} setLoaded={setLoaded} />
    </I18nProvider>
  )
}

interface ShellProps {
  settings: Settings
  setSettings: (s: Settings) => void
  loaded: boolean
  setLoaded: (v: boolean) => void
}

function Shell({ settings, setSettings, loaded, setLoaded }: ShellProps) {
  const { t, errorText } = useI18n()
  const [tab, setTab] = useState<Tab>('task')
  /** Every change the person asks for goes through this one: the new view's heading takes the focus. `setTab` stays for the app's own redirects. */
  const go = useFocusOnNav<Tab>(tab, setTab)
  const [onboarded, setOnboarded] = useState(readOnboarded)
  const [statuses, setStatuses] = useState<VendorAccountStatus[]>([])
  const [statusesReady, setStatusesReady] = useState(false)
  const [tools, setTools] = useState<DetectedToolInfo[]>([])
  const [text, setText] = useState('')
  const [folder, setFolder] = useState<FolderChoice | null>(null)
  /** Folder the displayed run works in (the folder state can change while a run is on screen). */
  const [runFolder, setRunFolder] = useState<FolderChoice | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [ceiling, setCeiling] = useState(false)
  const [analysis, setAnalysis] = useState<PlanState | null>(null)
  const textRef = useRef('')
  textRef.current = text
  const [run, dispatch] = useReducer((s: RunState | null, e: RunEvent) => reduceRun(s, e), null)
  const [historyKey, setHistoryKey] = useState('init')
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  /** Category and text of the displayed run: they pick its « Did you know? » line. */
  const [runInfo, setRunInfo] = useState<{ category: Category; seed: string } | null>(null)

  const [rechecking, setRechecking] = useState(false)
  const inflight = useRef<Promise<void> | null>(null)
  const lastRefresh = useRef(Date.now())

  /** Re-check the accounts. Concurrent calls share one check (agy can take 30 s). Never throws. */
  const refreshStatuses = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current
    setRechecking(true)
    const p = (async (): Promise<void> => {
      try {
        setStatuses(await api.accountsStatus())
        setStatusesReady(true)
      } catch {
        /* keep the previous statuses */
      } finally {
        lastRefresh.current = Date.now()
        inflight.current = null
        setRechecking(false)
      }
    })()
    inflight.current = p
    return p
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => setCeiling(true), EDGE_CEILING_MS)
    return () => window.clearTimeout(id)
  }, [])

  // Window regains focus: re-check, at most once every 30 s.
  useEffect(() => {
    const onFocus = (): void => {
      if (Date.now() - lastRefresh.current >= 30_000) void refreshStatuses()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshStatuses])

  // Initial load: settings first (fast, unblocks the UI), then account statuses and tools in the background.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await api.getSettings()
        if (alive) setSettings(forPage(s))
      } catch {
        /* the main process is not reachable (e.g. plain browser): defaults stay */
      }
      if (alive) setLoaded(true)
    })()
    void api
      .detectTools()
      .then((tl) => alive && setTools(tl))
      .catch(() => undefined)
    void api
      .accountsStatus()
      .then((st) => {
        if (!alive) return
        setStatuses(st)
        const anyConnected = st.some((x) => x.cli.state === 'connected' || x.webSignedIn)
        // First launch with nothing connected: open Accounts, unless the user already started typing.
        if (!readOnboarded() && !anyConnected && !textRef.current) setTab((cur) => (cur === 'task' ? 'accounts' : cur))
      })
      .catch(() => undefined)
      .finally(() => {
        lastRefresh.current = Date.now()
        if (alive) setStatusesReady(true)
      })
    return () => {
      alive = false
    }
  }, [setLoaded, setSettings])

  useEffect(() => {
    document.documentElement.lang = settings.lang
  }, [settings.lang])

  // The window title names the view (WCAG 2.4.2): « Historique · Smart Route ».
  const roleScreen = loaded && !IS_WEB && !settings.roleAsked
  useEffect(() => {
    document.title = `${roleScreen ? t('profile.title') : t(`nav.${tab}`)} · ${t('app.name')}`
  }, [tab, roleScreen, t])

  useEffect(() => {
    const offRun = api.onRunEvent((e) => {
      dispatch(e)
      if (e.type === 'run-end') setHistoryKey(e.runId)
    })
    const offAcc = api.onAccountUpdate((u) =>
      setStatuses((list) => list.map((s) => (s.vendor === u.vendor ? { ...s, cli: u.cli } : s)))
    )
    return () => {
      offRun()
      offAcc()
    }
  }, [])

  const updateSettings = useCallback(
    async (patch: Partial<Omit<Settings, 'v'>>): Promise<string | null> => {
      try {
        setSettings(forPage(await api.setSettings(patch)))
        return null
      } catch (e) {
        return errorText(e)
      }
    },
    [errorText, setSettings]
  )

  const startRun = useCallback(
    async (a: PlanState): Promise<string | null> => {
      try {
        await api.startRun(a.pipeline, text, folder?.id ?? null, a.classification)
        setRunFolder(folder)
        setRunInfo({ category: a.classification.category, seed: text.slice(0, 200) })
        setRecipe(null)
        go('run')
        return null
      } catch (e) {
        return errorText(e)
      }
    },
    [text, folder, errorText, go]
  )

  const analyse = async (): Promise<string | null> => {
    void refreshStatuses() // non-blocking: the plan screen updates when the check answers
    if (recipe) {
      // A recipe brings its own plan (same step maker as the router). It never runs by itself: the brackets still need filling in.
      const pipeline = recipePipeline(recipe, { allowEdits: settings.allowEdits, timeoutSec: settings.timeoutSec, codexModels: settings.codexModels }, settings.lang)
      setAnalysis({ classification: recipeClassification(recipe, settings.lang), pipeline, original: pipeline, seq: Date.now() })
      go('plan')
      return null
    }
    setAnalysing(true)
    try {
      const res = await api.analyse(text)
      const a: PlanState = { ...res, original: res.pipeline, seq: Date.now() }
      setAnalysis(a)
      if (settings.auto && statusesReady && canAutoRun(a.classification, a.pipeline, statuses)) return await startRun(a)
      go('plan')
      return null
    } catch (e) {
      return errorText(e)
    } finally {
      setAnalysing(false)
    }
  }
  const recategorise = async (c: Category): Promise<string | null> => {
    try {
      const res = await api.analyse(text, c)
      setAnalysis({ ...res, original: res.pipeline, seq: Date.now() })
      return null
    } catch (e) {
      return errorText(e)
    }
  }
  const pickRecipe = (r: Recipe): void => {
    setRecipe(r)
    setText(r.task[settings.lang])
    setTab('task') // the text box takes the focus just below, which is the useful place
    window.setTimeout(() => document.getElementById('task-text')?.focus(), 60)
  }
  const chooseRole = (role: UserRole | 'none'): void => void updateSettings({ role, roleAsked: true })
  const setPipeline = (p: Pipeline): void => setAnalysis((a) => (a ? { ...a, pipeline: p } : a))
  const setLang = (lang: Lang): void => void updateSettings({ lang })
  const markSignedIn = async (vendor: Vendor, value: boolean): Promise<void> => {
    try {
      const w = await api.markSignedIn(vendor, value)
      setSettings({ ...settings, webSignedIn: w })
      setStatuses((list) => list.map((s) => (s.vendor === vendor ? { ...s, webSignedIn: value } : s)))
    } catch {
      /* the checkbox reverts because state did not change */
    }
  }
  const leaveOnboarding = (): void => {
    writeOnboarded()
    setOnboarded(true)
    go('task')
  }

  const checking = !statusesReady && !ceiling
  const waiting = !loaded || checking || analysing || rechecking || run?.status === 'running'
  const inFlow = FLOW.includes(tab)

  return (
    <div className="app">
      <a className="sg-skip" href="#main">{t('a11y.skip')}</a>
      <SkyBand section={t(`nav.${tab}`)}>
        <LangSwitch lang={settings.lang} onLang={setLang} />
        <ThemeButton />
      </SkyBand>
      <Edge active={waiting} label={t('edge.label')} />

      {/* While the first-run job question is on screen, the bar behind it is inert: Tab stays in what can be answered. */}
      <div className="app-bar" inert={roleScreen}>
        <nav className="sg-tabs" aria-label={t('nav.label')}>
          {NAV.map((k) => (
            <button key={k} id={`tab-${k}`} type="button" className="sg-tab" aria-current={navOf(tab) === k ? 'page' : undefined} onClick={() => go(k)}>
              {t(`nav.${k}`)}
            </button>
          ))}
        </nav>
        <AccountDots statuses={statuses} checking={checking} onOpen={() => go('accounts')} />
      </div>

      <main id="main" tabIndex={-1}>
        {inFlow && (
          <nav className="flow-steps" aria-label={t('flow.label')}>
            <ol className="sg-breadcrumb">
              {FLOW.map((k) => {
                const reachable = k === 'task' || (k === 'plan' && analysis !== null) || (k === 'run' && run !== null)
                return (
                  <li key={k}>
                    {k === tab ? (
                      <span aria-current="step"><strong>{t(`nav.${k}`)}</strong></span>
                    ) : reachable ? (
                      <button type="button" className="sg-link crumb" onClick={() => go(k)}>{t(`nav.${k}`)}</button>
                    ) : (
                      <span className="muted">
                        {t(`nav.${k}`)}
                        <span className="sg-visually-hidden"> {t('a11y.unavailable')}</span>
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}
        {!loaded ? (
          <div className="view" aria-hidden="true">
            <div className="sg-skeleton skel skel-title" />
            <div className="sg-skeleton skel" />
            <div className="sg-skeleton skel" />
          </div>
        ) : !IS_WEB && !settings.roleAsked ? (
          <RoleScreen onChoose={chooseRole} onSkip={() => chooseRole('none')} />
        ) : (
          <>
            {tab === 'accounts' && (
              <AccountsView
                statuses={statuses}
                onboarding={!onboarded}
                onRefresh={refreshStatuses}
                rechecking={rechecking}
                onSignedIn={markSignedIn}
                onContinue={leaveOnboarding}
              />
            )}
            {tab === 'task' && (
              <TaskView
                text={text}
                onText={setText}
                folder={folder}
                onFolder={setFolder}
                onAnalyse={analyse}
                statuses={statuses}
                checking={checking}
                onOpenAccounts={() => go('accounts')}
                role={settings.role}
                recipe={recipe}
                onClearRecipe={() => setRecipe(null)}
                onUseRecipe={pickRecipe}
                onOpenRecipes={() => go('recipes')}
                onOpenAtlas={() => go('atlas')}
              />
            )}
            {tab === 'recipes' && <RecipesView role={settings.role} onUse={pickRecipe} onBack={() => go('task')} />}
            {tab === 'atlas' && <AtlasView onBack={() => go('task')} />}
            {tab === 'plan' && (
              <PlanView
                analysis={analysis}
                statuses={statuses}
                settings={settings}
                onPipeline={setPipeline}
                onCategory={recategorise}
                onApprove={() => (analysis ? startRun(analysis) : Promise.resolve(null))}
                onAuto={(v) => void updateSettings({ auto: v })}
                onGoTask={() => go('task')}
                onGoAccounts={() => go('accounts')}
                onRecheck={refreshStatuses}
                rechecking={rechecking}
              />
            )}
            {tab === 'run' && <RunView run={run} folderId={runFolder?.id ?? null} onNew={() => go('task')} category={runInfo?.category} seed={runInfo?.seed} />}
            {tab === 'history' && <HistoryView refreshKey={historyKey} />}
            {tab === 'settings' && <SettingsView settings={settings} tools={tools} onChange={updateSettings} />}
          </>
        )}
      </main>

      <ShellFooter lang={settings.lang} onLang={setLang} onAbout={() => go('settings', '#about')} />
    </div>
  )
}
