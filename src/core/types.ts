// Core domain types for Smart Route. Pure TypeScript, no Electron, no Node-only imports.

export type Category =
  | 'code'
  | 'debug'
  | 'review'
  | 'research'
  | 'question'
  | 'writing'
  | 'data'
  | 'design'
  | 'ops'
  | 'image'
  | 'video'
  | 'other'
export type Difficulty = 0 | 1 | 2 | 3 // trivial, standard, complex, critical
export type Risk = 'low' | 'high' // high: prod, payment, auth, secrets, migration, delete, deploy
export type ToolId = 'claude-code' | 'codex' | 'agy' | 'cowork' | 'gemini-tasks' | 'chatgpt-work'
export type Vendor = 'anthropic' | 'openai' | 'google'
export type Role = 'plan' | 'execute' | 'review' | 'single'
export type Lang = 'fr' | 'en'
/** The person's job, chosen at first run (optional): it tailors the examples and the recipes. */
export type UserRole = 'developer' | 'manager' | 'marketing' | 'image' | 'video' | 'research' | 'student' | 'entrepreneur'
export type Tier = 0 | 1 | 2 | 3
export type Effort = 'low' | 'medium' | 'high' | 'xhigh'

export interface ModelChoice {
  id: string
  vendor: Vendor
  tier: Tier
  label: string
  /** Codex only: reasoning effort passed as `-c model_reasoning_effort`. */
  effort?: Effort
}

/** A user-facing message: an i18n key plus optional parameters. Never literal text. */
export interface ExplainEntry {
  key: string
  params?: Record<string, string | number>
}

export interface Classification {
  category: Category
  difficulty: Difficulty
  risk: Risk
  confidence: number
  /** i18n keys with parameters (matched keywords, difficulty bumps...). */
  reasons: ExplainEntry[]
  /** True when confidence < 0.4: the UI asks the user to confirm the category. */
  needsConfirm: boolean
}

export interface Step {
  id: string
  role: Role
  tool: ToolId
  model: ModelChoice
  canEdit: boolean
  timeoutSec: number
  /** Visible name of the step in both languages (recipes: « Chercher / Research »); absent for routed steps. */
  label?: { fr: string; en: string }
  /** What this step must do, in both languages (recipes); added to the brief of the step. */
  instruction?: { fr: string; en: string }
}

export type Pattern = 'single' | 'plan-execute-review' | 'handoff'

export interface Pipeline {
  pattern: Pattern
  steps: Step[]
  /** i18n keys + params. */
  explanation: ExplainEntry[]
}

export interface Verdict {
  pass: boolean
  issues: string[]
}

export type RunErrorCode =
  | 'not_installed'
  | 'not_logged_in'
  | 'exit_nonzero'
  | 'empty_output'
  | 'bad_json'
  | 'timeout'
  | 'cancelled'
  | 'stdin_epipe'
  | 'network'
  | 'cap_reached'
  | 'tool_permission_denied'

export interface StepResult {
  stepId: string
  ok: boolean
  text: string
  verdict?: Verdict
  error?: RunErrorCode
  durationMs: number
  role?: Role
  tool?: ToolId
  /** True when the output was cut at the buffer cap. */
  truncated?: boolean
}

export type Availability = Record<
  ToolId,
  {
    installed: boolean
    connected: boolean
  }
>

export interface Settings {
  v: 2
  lang: Lang
  allowEdits: boolean
  auto: boolean
  useClaudeConfig: boolean
  /** Codex model id per tier (index 0..3). Only the default is known. */
  codexModels: Record<'0' | '1' | '2' | '3', string>
  dailyCap: number
  timeoutSec: number
  /** "Signed in" flags the user ticked for the web workspaces. */
  webSignedIn: Record<Vendor, boolean>
  /** Chosen job; 'none' until chosen or when skipped. */
  role: UserRole | 'none'
  /** True once the first-run role screen has been answered or skipped. */
  roleAsked: boolean
}

export type CliAccountState = 'connected' | 'disconnected' | 'not_installed' | 'unknown'

export interface CliAccountStatus {
  state: CliAccountState
  /** Sign-in method reported by the CLI (e.g. "claude.ai", "ChatGPT"). Never a secret. */
  method?: string
  /** With state 'unknown': epoch ms of the last check that answered 'connected' (this app session). */
  lastConnectedAt?: number
}

export interface VendorAccountStatus {
  vendor: Vendor
  cli: CliAccountStatus
  webSignedIn: boolean
}

/** What a timed replay event describes (see core/replay.ts). */
export type TimedKind = 'start' | 'log' | 'end' | 'verdict' | 'handoff' | 'confirm' | 'escalation' | 'run-end'

/** One moment of a run: ms since the run started, the step it belongs to, a short text (500 characters at most). */
export interface TimedEvent {
  t: number
  stepId: string
  kind: TimedKind
  text: string
}

export interface HistoryEntry {
  /** 2 since the replay events; version 1 rows are upgraded when read (no events). */
  v: 2
  id: string
  ts: number
  task: string
  classification: Classification
  pipeline: Pipeline
  results: StepResult[]
  /** Timed events of the run, for the replay. At most 200 KB per run. */
  events: TimedEvent[]
  rating?: 1 | -1
}

/** Events streamed from the main process to the renderer during a run (`run:event`). */
export type RunEvent =
  | { type: 'run-start'; runId: string; pipeline: Pipeline }
  | { type: 'step-start'; runId: string; stepId: string; escalated?: boolean }
  | { type: 'log'; runId: string; stepId: string; stream: 'event' | 'stderr'; text: string; delta?: boolean }
  | { type: 'step-end'; runId: string; result: StepResult }
  | { type: 'handoff'; runId: string; stepId: string; tool: ToolId; brief: string }
  | { type: 'confirm-costly'; runId: string; stepId: string; step: Step }
  | { type: 'escalation'; runId: string; fromStepId: string; step: Step; issues: string[] }
  | { type: 'run-end'; runId: string; status: RunStatus; results: StepResult[] }

export type RunStatus = 'done' | 'failed' | 'cancelled'

export const TOOL_IDS: readonly ToolId[] = [
  'claude-code',
  'codex',
  'agy',
  'cowork',
  'gemini-tasks',
  'chatgpt-work'
]
export const CLI_TOOLS: readonly ToolId[] = ['claude-code', 'codex', 'agy']
export const HANDOFF_TOOLS: readonly ToolId[] = ['cowork', 'gemini-tasks', 'chatgpt-work']
export const USER_ROLES: readonly UserRole[] = ['developer', 'manager', 'marketing', 'image', 'video', 'research', 'student', 'entrepreneur']
export const VENDORS: readonly Vendor[] = ['anthropic', 'openai', 'google']
export const CATEGORIES: readonly Category[] = [
  'code',
  'debug',
  'review',
  'research',
  'question',
  'writing',
  'data',
  'design',
  'ops',
  'image',
  'video',
  'other'
]

/** State of the browser-access bridge (desktop only; the pairing code is shown on the desktop screen, never sent to a socket). */
export interface BridgeStatus {
  enabled: boolean
  port: number | null
  /** `http://127.0.0.1:<port>` when on. */
  url: string | null
  /** The 8-character pairing code while one is valid; null when none (expired, cancelled, used). */
  code: string | null
  codeExpiresAt: number | null
  /** Authenticated pairing sessions (browsers that hold a valid token). */
  sessions: number
  /** Set when the last start failed: an `err.*` key. */
  error?: string
}
