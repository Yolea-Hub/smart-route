import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { HANDOFF_URLS, TOOL_KIND, TOOL_VENDOR } from '../core/catalog'
import { classify } from '../core/classify'
import { buildMarkdown, exportFileName } from '../core/exportMd'
import { EventRecorder } from '../core/replay'
import { IPC_CHANNELS, IPC_SCHEMAS, type IpcChannel } from '../core/schemas'
import { routeTask, sanitizePipeline } from '../core/route'
import type {
  Availability,
  BridgeStatus,
  Classification,
  Lang,
  Pipeline,
  CliAccountStatus,
  RunEvent,
  Settings,
  StepResult,
  ToolId,
  Vendor,
  VendorAccountStatus
} from '../core/types'
import { isSafeExternalUrl, VENDOR_HOME } from '../core/webPolicy'
import { VENDOR_CLI } from '../core/accounts'
import type { ExecFn } from './accounts'
import { checkCliStatus, connectCli, disconnectCli, getAccountsStatus, pollUntilConnected } from './accounts'
import { detectTools, toolPathsOf, type DetectedTool } from './detect'
import { PendingHub, retryStep, runPipeline, type CapStore, type RunSummary } from './orchestrator'
import { listCodexMcpServers } from './codexMcp'
import { detectTaskLanguage } from '../core/language'
import { runStep, type RunnerDeps } from './runner'
import type { BridgeControl } from './bridge'
import type { Store } from './store'
import type { Bounds } from './web'
import { siteLinkUrl } from '../core/siteLinks'

/** What ipc.ts needs from the Electron layer; everything is injectable. */
export interface WebPanelsLike {
  show(vendor: Vendor, bounds: Bounds): void
  hide(): void
  insertBrief(vendor: Vendor, text: string): Promise<void>
  isVisible(vendor: Vendor): boolean
  captureSelection(vendor: Vendor): Promise<string>
  /** Move the keyboard into the visible panel. Optional so that older test doubles stay valid. */
  focus?(vendor: Vendor): void
}

export interface IpcContext {
  store: Store
  env: NodeJS.ProcessEnv
  /** Directory for scratch work dirs and step temp files. */
  workRoot: string
  pickFolder: () => Promise<string | null>
  openExternal: (url: string) => void
  web: WebPanelsLike
  sendRunEvent: (e: RunEvent) => void
  /** Shows a save dialog and writes `text` to the chosen file. Resolves false when the person cancels. */
  saveFile?: (defaultName: string, text: string) => Promise<boolean>
  /** Shows a folder in the system file manager (shell.showItemInFolder). */
  showFolder?: (path: string) => void
  sendAccountUpdate: (u: { vendor: Vendor; cli: CliAccountStatus }) => void
  /** Browser access (desktop only). Absent in tests that do not need it. */
  bridge?: Pick<BridgeControl, 'status' | 'start' | 'stop' | 'newCode' | 'revokeAll'>
  detect?: () => Promise<DetectedTool[]>
  runStepFn?: typeof runStep
  runnerOverrides?: Partial<RunnerDeps>
  /** Injectable command runner for `codex mcp list` (tests). */
  exec?: ExecFn
}

interface FinishedRun {
  pipeline: Pipeline
  task: string
  cwd: string
  summary: RunSummary
  runnerDeps: RunnerDeps
  lang: Lang
  dailyCap: number
  recorder: EventRecorder
}

const bridgeOff = (): BridgeStatus => ({ enabled: false, port: null, url: null, code: null, codeExpiresAt: null, sessions: 0 })

export function createIpcHandlers(ctx: IpcContext) {
  const folders = new Map<string, string>()
  const runs = new Map<string, AbortController>()
  /** Runs in progress at once, desktop window and browser together (they share this map): a local process cannot pile up CLI processes. */
  const MAX_RUNS = 3
  const polls = new Map<Vendor, AbortController>()
  const handoffs = new PendingHub<string | null>()
  const confirms = new PendingHub<boolean>()
  const briefs = new Map<string, { tool: ToolId; text: string }>()
  const runPromises = new Set<Promise<void>>()
  const finished = new Map<string, FinishedRun>()
  let tools: DetectedTool[] | null = null
  let statusCache: { at: number; value: VendorAccountStatus[] } | null = null
  let capStorePromise: Promise<CapStore> | null = null

  const getTools = async (force = false): Promise<DetectedTool[]> => {
    if (!tools || force) tools = await (ctx.detect ?? (() => detectTools({ env: ctx.env })))()
    return tools
  }
  const getStatuses = async (force = false): Promise<VendorAccountStatus[]> => {
    if (!force && statusCache && Date.now() - statusCache.at < 30_000) return statusCache.value
    const paths = toolPathsOf(await getTools())
    const settings = await ctx.store.getSettings()
    const value = await getAccountsStatus({ toolPaths: paths, env: ctx.env, exec: ctx.exec }, settings.webSignedIn)
    statusCache = { at: Date.now(), value }
    return value
  }
  let refreshing: Promise<unknown> | null = null
  /**
   * Availability for planning. NEVER waits for a CLI status check: it uses the last known statuses
   * (an 'unknown' answer with a lastConnectedAt counts as connected) and refreshes them in the background
   * when missing or older than 30 s. With no status at all yet, installed CLIs are assumed connected
   * (the runner reports not_logged_in if that is wrong).
   */
  const getAvailability = async (): Promise<Availability> => {
    const paths = toolPathsOf(await getTools())
    const settings = await ctx.store.getSettings()
    const cached = statusCache
    if ((!cached || Date.now() - cached.at >= 30_000) && !refreshing) {
      refreshing = getStatuses(true)
        .catch(() => undefined)
        .finally(() => {
          refreshing = null
        })
    }
    const statuses = cached?.value
    const connectedOf = (v: Vendor): boolean => {
      if (!statuses) return true
      const cli = statuses.find((s) => s.vendor === v)?.cli
      // A check that could not answer (timeout/network) keeps a vendor that was connected earlier in the session.
      return cli?.state === 'connected' || (cli?.state === 'unknown' && cli.lastConnectedAt !== undefined)
    }
    const webOf = (v: Vendor): boolean => settings.webSignedIn[v] === true
    const a = {} as Availability
    for (const t of ['claude-code', 'codex', 'agy'] as const) {
      const vendor = (Object.keys(VENDOR_CLI) as Vendor[]).find((v) => VENDOR_CLI[v] === t) as Vendor
      a[t] = { installed: Boolean(paths[t]), connected: connectedOf(vendor) }
    }
    a.cowork = { installed: true, connected: webOf('anthropic') }
    a['gemini-tasks'] = { installed: true, connected: webOf('google') }
    a['chatgpt-work'] = { installed: true, connected: webOf('openai') }
    return a
  }
  const caps = (): Promise<CapStore> => (capStorePromise ??= ctx.store.capStore())

  const handlers: { [C in IpcChannel]: (payload: import('zod').infer<(typeof IPC_SCHEMAS)[C]>) => Promise<unknown> } = {
    'tools:detect': async () => getTools(true),

    'folder:pick': async () => {
      const p = await ctx.pickFolder()
      if (!p) return null
      const id = randomBytes(8).toString('hex')
      folders.set(id, p)
      return { id, label: basename(p) }
    },

    'task:analyse': async ({ text, category }) => {
      const settings = await ctx.store.getSettings()
      let classification: Classification = classify(text)
      if (category) classification = { ...classification, category, needsConfirm: false }
      const pipeline = routeTask(classification, await getAvailability(), {
        allowEdits: settings.allowEdits,
        timeoutSec: settings.timeoutSec,
        codexModels: settings.codexModels
      })
      return { classification, pipeline }
    },

    'run:start': async ({ pipeline: rawPipeline, text, folderId, classification }) => {
      const settings = await ctx.store.getSettings()
      const pipeline = sanitizePipeline(rawPipeline, settings)
      let cwd: string
      if (folderId) {
        const p = folders.get(folderId)
        if (!p) throw new Error('err.unknownFolder')
        cwd = p
      } else {
        cwd = join(ctx.workRoot, 'scratch')
        await mkdir(cwd, { recursive: true, mode: 0o700 })
      }
      const paths = toolPathsOf(await getTools())
      const runId = randomBytes(8).toString('hex')
      const controller = new AbortController()
      // Checked right before the insertion, after every await, so two simultaneous starts cannot both pass.
      if (runs.size >= MAX_RUNS) throw new Error('err.tooManyRuns')
      runs.set(runId, controller)
      const cls = (classification as Classification | undefined) ?? classify(text)
      const run = ctx.runStepFn ?? runStep
      const runnerDeps: RunnerDeps = {
        toolPaths: paths,
        env: ctx.env,
        tmpRoot: join(ctx.workRoot, 'tmp'),
        useClaudeConfig: settings.useClaudeConfig,
        language: detectTaskLanguage(text, settings.lang),
        userFolder: Boolean(folderId),
        codexDisableMcp: pipeline.steps.some((s) => s.tool === 'codex') ? await listCodexMcpServers(paths.codex, ctx.env, ctx.exec) : [],
        ...ctx.runnerOverrides
      }
      // Every event of the run goes to the renderer and, with its time, to the replay record kept in the history.
      const recorder = new EventRecorder(Date.now())
      const emit = (e: RunEvent): void => {
        recorder.push(e, Date.now())
        ctx.sendRunEvent(e)
      }
      emit({ type: 'run-start', runId, pipeline })
      const availability = await getAvailability()
      const tracked = (async () => {
        const summary = await runPipeline(
          {
            runId,
            lang: settings.lang,
            dailyCap: settings.dailyCap,
            codexModels: settings.codexModels,
            userFolder: Boolean(folderId),
            runStep: (step, prompt, dir, signal, onEvent) => run(step, prompt, dir, signal, onEvent, runnerDeps),
            caps: await caps(),
            handoffs,
            confirms,
            briefs,
            availability
          },
          pipeline,
          text,
          cwd,
          emit,
          controller.signal
        ).catch(
          (): RunSummary => ({ status: 'failed', results: [], escalated: false, executedSteps: [] })
        )
        runs.delete(runId)
        finished.set(runId, { pipeline, task: text, cwd, summary, runnerDeps, lang: settings.lang, dailyCap: settings.dailyCap, recorder })
        while (finished.size > 20) finished.delete(finished.keys().next().value as string)
        const end: RunEvent = { type: 'run-end', runId, status: summary.status, results: summary.results }
        recorder.push(end, Date.now())
        await ctx.store
          .addHistory({ id: runId, ts: Date.now(), task: text, classification: cls, pipeline, results: summary.results, events: recorder.events })
          .catch(() => undefined)
        ctx.sendRunEvent(end)
      })()
      runPromises.add(tracked)
      void tracked.finally(() => runPromises.delete(tracked))
      return runId
    },

    'run:retryStep': async ({ runId, stepId }) => {
      const f = finished.get(runId)
      if (!f || runs.has(runId)) throw new Error('err.cannotRetry')
      const idx = f.summary.results.findIndex((r) => r.stepId === stepId)
      const old = f.summary.results[idx]
      const step = f.summary.executedSteps.find((s) => s.id === stepId)
      if (!old || !step || (old.error !== 'network' && old.error !== 'tool_permission_denied')) throw new Error('err.cannotRetry')
      const controller = new AbortController()
      if (runs.size >= MAX_RUNS) throw new Error('err.tooManyRuns')
      runs.set(runId, controller)
      const run = ctx.runStepFn ?? runStep
      const tracked = (async () => {
        let fresh: StepResult
        try {
          fresh = await retryStep(
            { runId, lang: f.lang, dailyCap: f.dailyCap, userFolder: f.runnerDeps.userFolder, caps: await caps(), runStep: (st, pr, dir, sig, ev) => run(st, pr, dir, sig, ev, f.runnerDeps) },
            step,
            f.task,
            f.cwd,
            f.summary.results.slice(0, idx),
            (e) => {
              f.recorder.push(e, Date.now())
              ctx.sendRunEvent(e)
            },
            controller.signal
          )
        } catch {
          fresh = { ...old, error: 'exit_nonzero' }
        }
        runs.delete(runId)
        const results = f.summary.results.map((r, i) => (i === idx ? fresh : r))
        const allOk = results.every((r) => r.ok && !(r.verdict && !r.verdict.pass))
        const status = controller.signal.aborted ? 'cancelled' : allOk ? 'done' : 'failed'
        f.summary = { ...f.summary, results, status }
        const end: RunEvent = { type: 'run-end', runId, status, results }
        f.recorder.push(end, Date.now())
        await ctx.store.updateHistoryResults(runId, results, f.recorder.events).catch(() => undefined)
        ctx.sendRunEvent(end)
      })()
      runPromises.add(tracked)
      void tracked.finally(() => runPromises.delete(tracked))
      return { ok: true }
    },

    'run:cancel': async ({ runId }) => {
      runs.get(runId)?.abort()
      return { ok: runs.has(runId) }
    },

    'run:handoffResult': async ({ runId, stepId, text }) => ({ ok: handoffs.submit(runId, stepId, text) }),
    'run:confirm': async ({ runId, stepId, accept }) => ({ ok: confirms.submit(runId, stepId, accept) }),

    'accounts:status': async () => getStatuses(true),

    'accounts:connect': async ({ vendor }) => {
      const paths = toolPathsOf(await getTools())
      const opened = connectCli(vendor, { toolPaths: paths, env: ctx.env })
      if (!opened) return { opened: false }
      polls.get(vendor)?.abort()
      const ac = new AbortController()
      polls.set(vendor, ac)
      void pollUntilConnected(() => checkCliStatus(vendor, { toolPaths: paths, env: ctx.env }), {
        signal: ac.signal,
        onTick: (cli) => ctx.sendAccountUpdate({ vendor, cli })
      }).then(() => {
        statusCache = null
      })
      return { opened: true }
    },

    'accounts:disconnect': async ({ vendor }) => {
      const result = await disconnectCli(vendor, { toolPaths: toolPathsOf(await getTools()), env: ctx.env })
      statusCache = null
      return { result }
    },

    'web:show': async ({ vendor, bounds }) => {
      ctx.web.show(vendor, bounds)
      return { ok: true }
    },
    'web:hide': async () => {
      ctx.web.hide()
      return { ok: true }
    },
    'web:insertBrief': async ({ vendor, runId, stepId }) => {
      const brief = briefs.get(`${runId}:${stepId}`)
      if (!brief) throw new Error('err.noBrief')
      if (TOOL_VENDOR[brief.tool] !== vendor) throw new Error('err.vendorMismatch')
      if (!ctx.web.isVisible(vendor)) throw new Error('err.panelNotVisible')
      await ctx.web.insertBrief(vendor, brief.text)
      return { ok: true }
    },
    // Keyboard way in to a visible panel (the way out is F6, handled in web.ts).
    'web:focus': async ({ vendor }) => {
      if (!ctx.web.isVisible(vendor)) throw new Error('err.panelNotVisible')
      ctx.web.focus?.(vendor)
      return { ok: true }
    },
    'web:captureSelection': async ({ vendor }) => ctx.web.captureSelection(vendor),
    // Opens the vendor's catalog URL only (never a URL from the renderer), in the default browser. Desktop only.
    'web:openInBrowser': async ({ vendor }) => {
      ctx.openExternal(VENDOR_HOME[vendor])
      return { ok: true }
    },
    'web:markSignedIn': async ({ vendor, value }) => {
      const s = await ctx.store.getSettings()
      const next = await ctx.store.setSettings({ webSignedIn: { ...s.webSignedIn, [vendor]: value } })
      statusCache = null
      return next.webSignedIn
    },

    'history:list': async () => ctx.store.listHistory(),
    'history:rate': async ({ id, rating }) => ({ ok: await ctx.store.rateHistory(id, rating) }),
    'history:clear': async () => {
      await ctx.store.clearHistory()
      return { ok: true }
    },
    'history:export': async ({ id }) => {
      const entry = (await ctx.store.listHistory()).find((e) => e.id === id)
      if (!entry) throw new Error('err.notFound')
      if (!ctx.saveFile) throw new Error('err.notAvailable')
      const settings = await ctx.store.getSettings()
      const name = exportFileName(entry)
      const saved = await ctx.saveFile(name, buildMarkdown(entry, settings.lang))
      return { saved, name }
    },

    'folder:open': async ({ folderId }) => {
      const p = folders.get(folderId)
      if (!p) throw new Error('err.unknownFolder')
      if (!ctx.showFolder) throw new Error('err.notAvailable')
      ctx.showFolder(p)
      return { ok: true }
    },
    // Ids and labels only: a path never leaves the main process.
    'folder:list': async () => [...folders].map(([id, p]) => ({ id, label: basename(p) })),

    'settings:get': async () => ctx.store.getSettings(),
    'settings:set': async (patch) => {
      const next: Settings = await ctx.store.setSettings(patch)
      return next
    },

    'link:open': async (payload) => {
      if ('link' in payload) {
        const site = siteLinkUrl(payload.link, payload.lang)
        if (!isSafeExternalUrl(site)) throw new Error('err.invalidInput')
        ctx.openExternal(site)
        return { ok: true }
      }
      const { toolId } = payload
      const url = HANDOFF_URLS[toolId]
      if (TOOL_KIND[toolId as ToolId] !== 'handoff' || !isSafeExternalUrl(url)) throw new Error('err.invalidInput')
      ctx.openExternal(url)
      return { ok: true }
    },

    // Browser access: desktop window only, never in the socket allowlist.
    'bridge:status': async () => (ctx.bridge ? ctx.bridge.status() : bridgeOff()),
    'bridge:enable': async ({ enabled }) => {
      if (!ctx.bridge) throw new Error('err.notAvailable')
      return enabled ? ctx.bridge.start() : ctx.bridge.stop()
    },
    'bridge:newCode': async () => {
      if (!ctx.bridge) throw new Error('err.notAvailable')
      return ctx.bridge.newCode()
    },
    'bridge:revoke': async () => {
      if (!ctx.bridge) throw new Error('err.notAvailable')
      return ctx.bridge.revokeAll()
    }
  }

  const abortAll = (): void => {
    for (const c of runs.values()) c.abort()
    for (const c of polls.values()) c.abort()
  }
  const activeRuns = (): number => runs.size
  const whenIdle = async (): Promise<void> => {
    await Promise.allSettled([...runPromises])
  }
  return { handlers, abortAll, activeRuns, whenIdle }
}

/** True when the frame that sent a message is the app's own renderer page. */
export type SenderCheck = (event: IpcMainInvokeEvent) => boolean

export function registerIpc(
  ipcMain: IpcMain,
  ctx: IpcContext,
  isTrustedSender: SenderCheck
): { handlers: ReturnType<typeof createIpcHandlers>['handlers']; abortAll: () => void; activeRuns: () => number; whenIdle: () => Promise<void> } {
  const { handlers, abortAll, activeRuns, whenIdle } = createIpcHandlers(ctx)
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('err.untrustedSender')
      const parsed = IPC_SCHEMAS[channel].safeParse(payload)
      if (!parsed.success) throw new Error('err.invalidInput')
      return (handlers[channel] as (p: unknown) => Promise<unknown>)(parsed.data)
    })
  }
  return { handlers, abortAll, activeRuns, whenIdle }
}
