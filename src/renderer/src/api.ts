import type {
  BridgeStatus,
  Category,
  Classification,
  CliAccountStatus,
  HistoryEntry,
  Lang,
  Pipeline,
  RunEvent,
  Settings,
  Vendor,
  VendorAccountStatus
} from '../../core/types'
import type { SiteLinkId } from '../../core/siteLinks'
import { IS_WEB, transport } from './transport'

export interface DetectedToolInfo {
  toolId: 'claude-code' | 'codex' | 'agy'
  path: string
  version: string
}
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
export interface Analysis {
  classification: Classification
  pipeline: Pipeline
}
export interface FolderChoice {
  id: string
  label: string
}

const inv = <T>(channel: string, payload?: unknown): Promise<T> => transport.invoke(channel, payload) as Promise<T>

export const api = {
  detectTools: () => inv<DetectedToolInfo[]>('tools:detect'),
  pickFolder: () => inv<FolderChoice | null>('folder:pick'),
  analyse: (text: string, category?: Category) => inv<Analysis>('task:analyse', category ? { text, category } : { text }),
  startRun: (pipeline: Pipeline, text: string, folderId: string | null, classification: Classification) =>
    inv<string>('run:start', { pipeline, text, folderId, classification }),
  cancelRun: (runId: string) => inv<{ ok: boolean }>('run:cancel', { runId }),
  handoffResult: (runId: string, stepId: string, text: string | null) =>
    inv<{ ok: boolean }>('run:handoffResult', { runId, stepId, text }),
  confirm: (runId: string, stepId: string, accept: boolean) => inv<{ ok: boolean }>('run:confirm', { runId, stepId, accept }),
  retryStep: (runId: string, stepId: string) => inv<{ ok: boolean }>('run:retryStep', { runId, stepId }),
  accountsStatus: () => inv<VendorAccountStatus[]>('accounts:status'),
  connect: (vendor: Vendor) => inv<{ opened: boolean }>('accounts:connect', { vendor }),
  disconnect: (vendor: Vendor) =>
    inv<{ result: 'ok' | 'unsupported' | 'not_installed' | 'failed' }>('accounts:disconnect', { vendor }),
  webShow: (vendor: Vendor, bounds: Bounds) => inv<{ ok: boolean }>('web:show', { vendor, bounds }),
  webHide: () => inv<{ ok: boolean }>('web:hide'),
  insertBrief: (vendor: Vendor, runId: string, stepId: string) =>
    inv<{ ok: boolean }>('web:insertBrief', { vendor, runId, stepId }),
  /** Desktop only: moves the keyboard into the visible panel (F6 brings it back). */
  webFocus: (vendor: Vendor) => inv<{ ok: boolean }>('web:focus', { vendor }),
  captureSelection: (vendor: Vendor) => inv<string>('web:captureSelection', { vendor }),
  markSignedIn: (vendor: Vendor, value: boolean) => inv<Settings['webSignedIn']>('web:markSignedIn', { vendor, value }),
  historyList: () => inv<HistoryEntry[]>('history:list'),
  historyRate: (id: string, rating: 1 | -1 | null) => inv<{ ok: boolean }>('history:rate', { id, rating }),
  historyClear: () => inv<{ ok: boolean }>('history:clear'),
  /** Main shows a save dialog and writes the Markdown file; `saved` is false when the person cancels. */
  exportHistory: (id: string) => inv<{ saved: boolean; name: string }>('history:export', { id }),
  openFolder: (folderId: string) => inv<{ ok: boolean }>('folder:open', { folderId }),
  listFolders: () => inv<FolderChoice[]>('folder:list'),
  getSettings: () => inv<Settings>('settings:get'),
  setSettings: (patch: Partial<Omit<Settings, 'v'>>) => inv<Settings>('settings:set', patch),
  bridgeStatus: () => inv<BridgeStatus>('bridge:status'),
  bridgeEnable: (enabled: boolean) => inv<BridgeStatus>('bridge:enable', { enabled }),
  bridgeNewCode: () => inv<BridgeStatus>('bridge:newCode'),
  bridgeRevoke: () => inv<BridgeStatus>('bridge:revoke'),
  openLink: (toolId: 'cowork' | 'gemini-tasks' | 'chatgpt-work') => inv<{ ok: boolean }>('link:open', { toolId }),
  /** Opens one page of the Smart Route site (exact catalog URL, looked up in main) in the system browser. */
  openSiteLink: (link: SiteLinkId, lang: Lang) => inv<{ ok: boolean }>('link:open', { link, lang }),
  /** Desktop only: opens the vendor's site in the default browser (Google refuses sign-in inside an embedded panel). */
  openInBrowser: (vendor: Vendor) => inv<{ ok: boolean }>('web:openInBrowser', { vendor }),
  /** Desktop only (panels do not exist in the browser build): a panel cancelled a Google sign-in. */
  onSigninBlocked: (fn: (u: { vendor: Vendor }) => void): (() => void) =>
    IS_WEB ? () => undefined : window.smartRoute.on('web:signinBlocked', (d) => fn(d as { vendor: Vendor })),
  /** Desktop only: F6 took the keyboard out of a panel and back to the window. */
  onFocusReturned: (fn: (u: { vendor: Vendor }) => void): (() => void) =>
    IS_WEB ? () => undefined : window.smartRoute.on('web:focusReturned', (d) => fn(d as { vendor: Vendor })),
  onRunEvent: (fn: (e: RunEvent) => void) => transport.on('run:event', (d) => fn(d as RunEvent)),
  onAccountUpdate: (fn: (u: { vendor: Vendor; cli: CliAccountStatus }) => void) =>
    transport.on('accounts:update', (d) => fn(d as { vendor: Vendor; cli: CliAccountStatus }))
}

/** Bounds of an element in integer window coordinates, clamped to >= 0. */
export function boundsOf(el: Element): Bounds {
  const r = el.getBoundingClientRect()
  return {
    x: Math.max(0, Math.round(r.left)),
    y: Math.max(0, Math.round(r.top)),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height))
  }
}
