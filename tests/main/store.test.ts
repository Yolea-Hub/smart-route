import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classify } from '../../src/core/classify'
import { EVENTS_MAX_BYTES, eventBytes } from '../../src/core/replay'
import type { TimedEvent } from '../../src/core/types'
import { HISTORY_KEEP, HISTORY_RESULT_TEXT_MAX, Store, defaultSettings, migrateSettings } from '../../src/main/store'
import { allAvailable, cls, opts } from '../core/helpers'
import { routeTask } from '../../src/core/route'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sr-store-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const entry = (id: string, text = 'r') => ({
  id,
  ts: 1,
  task: 't',
  classification: classify('t'),
  pipeline: routeTask(cls('other', 1), allAvailable(), opts),
  results: [{ stepId: 's1', ok: true, text, durationMs: 1 }]
})

describe('settings', () => {
  it('returns defaults, persists a patch with mode 0600, and rejects invalid values', async () => {
    const s = new Store(dir)
    expect(await s.getSettings()).toEqual(defaultSettings())
    const next = await s.setSettings({ lang: 'en', allowEdits: true, dailyCap: 5 })
    expect(next).toMatchObject({ lang: 'en', allowEdits: true, dailyCap: 5, v: 2 })
    expect((await new Store(dir).getSettings()).lang).toBe('en')
    if (process.platform !== 'win32') expect((await stat(join(dir, 'settings.json'))).mode & 0o777).toBe(0o600) // no POSIX modes on Windows
    await expect(s.setSettings({ dailyCap: 0 })).rejects.toThrow()
    await expect(s.setSettings({ codexModels: { '0': 'a', '1': '--add-dir', '2': 'c', '3': 'd' } })).rejects.toThrow()
  })

  it('falls back to defaults on a corrupt file', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'settings.json'), '{not json')
    expect(await new Store(dir).getSettings()).toEqual(defaultSettings())
  })

  it('upgrades a version 1 settings file in place: no job chosen yet, the first-run screen still to answer', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ v: 1, lang: 'en', allowEdits: true, auto: false, useClaudeConfig: false, codexModels: defaultSettings().codexModels, dailyCap: 7, timeoutSec: 900, webSignedIn: { anthropic: false, openai: false, google: false } }))
    const s = await new Store(dir).getSettings()
    expect(s).toMatchObject({ v: 2, lang: 'en', allowEdits: true, dailyCap: 7, role: 'none', roleAsked: false })
    const saved = await new Store(dir).setSettings({ role: 'marketing', roleAsked: true })
    expect(saved).toMatchObject({ role: 'marketing', roleAsked: true, dailyCap: 7 })
    await expect(new Store(dir).setSettings({ role: 'astronaut' })).rejects.toThrow()
    expect(migrateSettings(null)).toEqual({})
  })

  it('has the plan defaults', () => {
    expect(defaultSettings()).toMatchObject({ v: 2, role: 'none', roleAsked: false, lang: 'fr', allowEdits: false, auto: false, useClaudeConfig: false, dailyCap: 30, timeoutSec: 900 })
  })
})

describe('history', () => {
  it('appends (file mode 0600), cuts result text at 5 KB, rates and clears', async () => {
    const s = new Store(dir)
    await s.addHistory(entry('a', 'x'.repeat(20_000)))
    await s.addHistory(entry('b'))
    const list = await s.listHistory()
    expect(list.map((e) => e.id)).toEqual(['a', 'b'])
    expect(list[0]!.results[0]!.text.length).toBeLessThan(HISTORY_RESULT_TEXT_MAX + 10)
    if (process.platform !== 'win32') expect((await stat(join(dir, 'history.jsonl'))).mode & 0o777).toBe(0o600) // no POSIX modes on Windows
    expect(await s.rateHistory('a', 1)).toBe(true)
    expect((await s.listHistory())[0]!.rating).toBe(1)
    expect(await s.rateHistory('a', null)).toBe(true)
    expect((await s.listHistory())[0]!.rating).toBeUndefined()
    expect(await s.rateHistory('zzz', 1)).toBe(false)
    await s.clearHistory()
    expect(await s.listHistory()).toEqual([])
  })

  it('keeps only the last 500 entries', async () => {
    const s = new Store(dir)
    const writes: Promise<unknown>[] = []
    for (let i = 0; i < HISTORY_KEEP + 5; i++) writes.push(s.addHistory(entry(`e${i}`)))
    await Promise.all(writes)
    const list = await s.listHistory()
    expect(list).toHaveLength(HISTORY_KEEP)
    expect(list[0]!.id).toBe('e5')
    expect(list.at(-1)!.id).toBe(`e${HISTORY_KEEP + 4}`)
  })

  it('skips a corrupt line instead of losing the history', async () => {
    const { appendFile } = await import('node:fs/promises')
    const s = new Store(dir)
    await s.addHistory(entry('a'))
    await appendFile(join(dir, 'history.jsonl'), 'garbage\n')
    expect((await s.listHistory()).map((e) => e.id)).toEqual(['a'])
  })
})

describe('daily caps', () => {
  it('counts per tool, persists, and resets on a new day', async () => {
    let day = '2026-11-03'
    const s = new Store(dir, () => day)
    const caps = await s.capStore()
    caps.increment('codex')
    caps.increment('codex')
    expect(caps.count('codex')).toBe(2)
    expect(caps.count('agy')).toBe(0)
    await new Promise((r) => setTimeout(r, 50))
    const reloaded = await new Store(dir, () => day).capStore()
    expect(reloaded.count('codex')).toBe(2)
    expect(JSON.parse(await readFile(join(dir, 'caps.json'), 'utf8')).date).toBe('2026-11-03')
    day = '2026-11-04'
    expect(caps.count('codex')).toBe(0)
    expect((await new Store(dir, () => day).capStore()).count('codex')).toBe(0)
  })
})

describe('history task cap', () => {
  it('cuts the stored task at 5 KB', async () => {
    const s = new Store(dir)
    await s.addHistory({ ...entry('t'), task: 'é'.repeat(20_000) })
    expect(Buffer.byteLength((await s.listHistory())[0]!.task)).toBeLessThan(5 * 1024 + 10)
  })
})

describe('history schema v2: timed events and the migration of v1 rows', () => {
  const ev = (t: number, kind: TimedEvent['kind'], text = '', stepId = 's1'): TimedEvent => ({ t, stepId, kind, text })

  it('stores the events with the row, as version 2', async () => {
    const s = new Store(dir)
    const events = [ev(0, 'start'), ev(500, 'end', 'ok'), ev(501, 'run-end', 'done', '')]
    const saved = await s.addHistory({ ...entry('a'), events })
    expect(saved.v).toBe(2)
    const [row] = await s.listHistory()
    expect(row).toMatchObject({ v: 2, id: 'a', events })
    expect(JSON.parse((await readFile(join(dir, 'history.jsonl'), 'utf8')).trim()).v).toBe(2)
  })

  it('a row added without events gets an empty list', async () => {
    const s = new Store(dir)
    await s.addHistory(entry('a'))
    expect((await s.listHistory())[0]!.events).toEqual([])
  })

  it('reads a version 1 row (no events), upgrades it in memory and writes it back as version 2 on the next change', async () => {
    const v1 = { v: 1, id: 'old', ts: 5, task: 't', classification: classify('t'), pipeline: routeTask(cls('other', 1), allAvailable(), opts), results: [{ stepId: 's1', ok: true, text: 'r', durationMs: 1 }], rating: 1 }
    await writeFile(join(dir, 'history.jsonl'), JSON.stringify(v1) + '\n')
    const s = new Store(dir)
    const [row] = await s.listHistory()
    expect(row).toMatchObject({ v: 2, id: 'old', rating: 1, events: [] })
    await s.rateHistory('old', -1)
    const lines = (await readFile(join(dir, 'history.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ v: 2, id: 'old', rating: -1, events: [] })
  })

  it('mixed v1 and v2 rows, and unknown versions or garbage, in one file', async () => {
    const s = new Store(dir)
    await s.addHistory({ ...entry('new'), events: [ev(1, 'start')] })
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(dir, 'history.jsonl'), JSON.stringify({ v: 1, id: 'v1row', ts: 1, task: 'x', classification: classify('x'), pipeline: entry('x').pipeline, results: [] }) + '\n')
    await appendFile(join(dir, 'history.jsonl'), JSON.stringify({ v: 3, id: 'future' }) + '\n' + JSON.stringify([1, 2]) + '\n' + JSON.stringify({ v: 2 }) + '\n')
    expect((await s.listHistory()).map((e) => e.id)).toEqual(['new', 'v1row'])
  })

  it('drops malformed events when reading and caps a run at 200 KB when writing', async () => {
    const s = new Store(dir)
    const big: TimedEvent[] = []
    for (let i = 0; i < 4000; i++) big.push(ev(i, 'log', 'q'.repeat(300)))
    big.push(ev(5000, 'run-end', 'done', ''))
    const saved = await s.addHistory({ ...entry('big'), events: big })
    expect(saved.events.reduce((n, e) => n + eventBytes(e), 0)).toBeLessThanOrEqual(EVENTS_MAX_BYTES)
    expect(saved.events.at(-1)?.kind).toBe('run-end')
    const file = join(dir, 'history.jsonl')
    const row = JSON.parse((await readFile(file, 'utf8')).trim())
    row.events = [ev(1, 'start'), { t: 'x' }, 7, { t: 2, stepId: 's1', kind: 'evil', text: '' }]
    await writeFile(file, JSON.stringify(row) + '\n')
    expect((await s.listHistory())[0]!.events).toEqual([ev(1, 'start')])
  })

  it('updateHistoryResults can replace the events after a step retry', async () => {
    const s = new Store(dir)
    await s.addHistory({ ...entry('a'), events: [ev(1, 'start')] })
    await s.updateHistoryResults('a', [{ stepId: 's1', ok: true, text: 'again', durationMs: 2 }], [ev(1, 'start'), ev(9, 'end', 'ok')])
    const [row] = await s.listHistory()
    expect(row!.results[0]!.text).toBe('again')
    expect(row!.events).toHaveLength(2)
    await s.updateHistoryResults('a', [{ stepId: 's1', ok: true, text: 'third', durationMs: 2 }])
    expect((await s.listHistory())[0]!.events).toHaveLength(2) // events untouched when none are given
  })
})
