import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultCodexModels } from '../core/catalog'
import { settingsPatchSchema, settingsSchema } from '../core/schemas'
import { capEvents, isTimedEvent } from '../core/replay'
import type { HistoryEntry, Settings, StepResult, TimedEvent, ToolId } from '../core/types'
import type { CapStore } from './orchestrator'

export const HISTORY_KEEP = 500
export const HISTORY_RESULT_TEXT_MAX = 5 * 1024
export const HISTORY_TASK_MAX = 5 * 1024

export function defaultSettings(): Settings {
  return {
    v: 2,
    lang: 'fr',
    allowEdits: false,
    auto: false,
    useClaudeConfig: false,
    codexModels: defaultCodexModels(),
    dailyCap: 30,
    timeoutSec: 900,
    webSignedIn: { anthropic: false, openai: false, google: false },
    role: 'none',
    roleAsked: false
  }
}

/** Settings written by an older version are upgraded in memory: version 1 had no job (role) and no first-run answer. */
export function migrateSettings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const r = { ...(raw as Record<string, unknown>) }
  if (r['v'] === 1) {
    r['v'] = 2
    r['role'] = 'none'
    r['roleAsked'] = false
  }
  return r
}

function cutText(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')
  return buf.length <= maxBytes ? text : buf.subarray(0, maxBytes).toString('utf8').replace(/�+$/, '') + '\n[...]'
}

/** Keep only well-formed events, within the 200 KB budget of one run. */
export function cleanEvents(events: unknown): TimedEvent[] {
  return Array.isArray(events) ? capEvents(events.filter(isTimedEvent)) : []
}

/** A row as written by an older version is upgraded in memory: version 1 had no events. Null when it is not a history row. */
export function upgradeRow(raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e['id'] !== 'string') return null
  if (e['v'] === 1) return { ...(e as unknown as Omit<HistoryEntry, 'v' | 'events'>), v: 2, events: [] }
  if (e['v'] === 2) return { ...(e as unknown as HistoryEntry), events: cleanEvents(e['events']) }
  return null
}

export function trimResults(results: StepResult[]): StepResult[] {
  return results.map((r) => ({ ...r, text: cutText(r.text, HISTORY_RESULT_TEXT_MAX) }))
}

async function writePrivate(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, path)
  await chmod(path, 0o600).catch(() => undefined)
}

/** File-backed store in `dir` (Electron's userData). All paths are injected so tests use a temp dir. */
export class Store {
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private readonly dir: string, private readonly today: () => string = () => new Date().toISOString().slice(0, 10)) {}

  /** Serialise file operations so concurrent IPC calls cannot interleave writes. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => undefined)
    return next
  }

  private get historyPath(): string {
    return join(this.dir, 'history.jsonl')
  }
  private get settingsPath(): string {
    return join(this.dir, 'settings.json')
  }
  private get capsPath(): string {
    return join(this.dir, 'caps.json')
  }

  // ---- settings ----
  async getSettings(): Promise<Settings> {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, 'utf8')) as unknown
      const merged = { ...defaultSettings(), ...migrateSettings(raw) }
      const parsed = settingsSchema.safeParse(merged)
      return parsed.success ? (parsed.data as Settings) : defaultSettings()
    } catch {
      return defaultSettings()
    }
  }

  setSettings(patch: unknown): Promise<Settings> {
    return this.serial(async () => {
      const p = settingsPatchSchema.parse(patch)
      const current = await this.getSettings()
      const next: Settings = {
        ...current,
        ...p,
        codexModels: p.codexModels ?? current.codexModels,
        webSignedIn: p.webSignedIn ?? current.webSignedIn,
        v: 2
      }
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      await writePrivate(this.settingsPath, JSON.stringify(next, null, 2))
      return next
    })
  }

  // ---- history ----
  async listHistory(): Promise<HistoryEntry[]> {
    let raw = ''
    try {
      raw = await readFile(this.historyPath, 'utf8')
    } catch {
      return []
    }
    const out: HistoryEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = upgradeRow(JSON.parse(line) as unknown)
        if (e) out.push(e)
      } catch {
        /* skip a corrupt line */
      }
    }
    return out.slice(-HISTORY_KEEP)
  }

  addHistory(entry: Omit<HistoryEntry, 'v' | 'results' | 'events'> & { results: StepResult[]; events?: TimedEvent[] }): Promise<HistoryEntry> {
    return this.serial(async () => {
      const full: HistoryEntry = {
        ...entry,
        v: 2,
        task: cutText(entry.task, HISTORY_TASK_MAX),
        results: trimResults(entry.results),
        events: cleanEvents(entry.events ?? [])
      }
      const all = [...(await this.listHistory()), full].slice(-HISTORY_KEEP)
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      await writePrivate(this.historyPath, all.map((e) => JSON.stringify(e)).join('\n') + '\n')
      return full
    })
  }

  rateHistory(id: string, rating: 1 | -1 | null): Promise<boolean> {
    return this.serial(async () => {
      const all = await this.listHistory()
      const e = all.find((x) => x.id === id)
      if (!e) return false
      if (rating === null) delete e.rating
      else e.rating = rating
      await writePrivate(this.historyPath, all.map((x) => JSON.stringify(x)).join('\n') + '\n')
      return true
    })
  }

  /** Replace the results (and, when given, the events) of a finished run after a step retry. */
  updateHistoryResults(id: string, results: StepResult[], events?: TimedEvent[]): Promise<boolean> {
    return this.serial(async () => {
      const all = await this.listHistory()
      const e = all.find((x) => x.id === id)
      if (!e) return false
      e.results = trimResults(results)
      if (events) e.events = cleanEvents(events)
      await writePrivate(this.historyPath, all.map((x) => JSON.stringify(x)).join('\n') + '\n')
      return true
    })
  }

  clearHistory(): Promise<void> {
    return this.serial(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      await writePrivate(this.historyPath, '')
    })
  }

  // ---- daily caps ----
  /** Counters are loaded in memory per day and flushed to caps.json on every increment. */
  async capStore(): Promise<CapStore> {
    let state: { date: string; counts: Partial<Record<ToolId, number>> } = { date: this.today(), counts: {} }
    try {
      const raw = JSON.parse(await readFile(this.capsPath, 'utf8')) as typeof state
      if (raw && raw.date === this.today() && raw.counts && typeof raw.counts === 'object') state = raw
    } catch {
      /* fresh day or first run */
    }
    const roll = (): void => {
      if (state.date !== this.today()) state = { date: this.today(), counts: {} }
    }
    return {
      count: (tool) => {
        roll()
        return state.counts[tool] ?? 0
      },
      increment: (tool) => {
        roll()
        state.counts[tool] = (state.counts[tool] ?? 0) + 1
        void this.serial(async () => {
          await mkdir(this.dir, { recursive: true, mode: 0o700 })
          await writePrivate(this.capsPath, JSON.stringify(state))
        })
      }
    }
  }
}
