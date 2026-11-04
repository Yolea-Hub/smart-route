import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../src/core/schemas'
import type { Pipeline, RunEvent } from '../../src/core/types'
import { defaultExec } from '../../src/main/accounts'
import { detectTools } from '../../src/main/detect'
import { createIpcHandlers, registerIpc, type IpcContext } from '../../src/main/ipc'
import { Store } from '../../src/main/store'
import { BIN, sleep } from './helpers'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sr-ipc-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function makeCtx(auth: 'in' | 'out', events: RunEvent[] = [], extra: Partial<IpcContext> = {}): IpcContext {
  const env = { PATH: `${BIN}${delimiter}${process.env.PATH}`, HOME: dir, NO_COLOR: '1', FAKE_AUTH: auth }
  return {
    store: new Store(join(dir, 'ud')),
    env,
    workRoot: join(dir, 'work'),
    pickFolder: async () => dir,
    openExternal: () => undefined,
    web: { show() {}, hide() {}, insertBrief: async () => undefined, captureSelection: async () => '', isVisible: () => true },
    sendRunEvent: (e) => events.push(e),
    sendAccountUpdate: () => undefined,
    detect: () => detectTools({ pathEnv: BIN, home: dir, env }),
    ...extra
  }
}

describe('task:analyse and accounts', () => {
  it('logged-out fake CLIs: the plan has no CLI step and says "Connect" for each skipped tool', async () => {
    const { handlers } = createIpcHandlers(makeCtx('out'))
    await handlers['accounts:status'](undefined) // statuses known (analyse itself never waits for a check)
    const r = (await handlers['task:analyse']({ text: 'corrige le bug de division par zéro dans calc.py' })) as { classification: { category: string }; pipeline: Pipeline }
    expect(r.classification.category).toBe('debug')
    expect(r.pipeline.steps).toHaveLength(0)
    const skips = r.pipeline.explanation.filter((e) => e.key === 'route.skip.notConnected').map((e) => e.params?.tool)
    expect(skips.sort()).toEqual(['agy', 'claude-code', 'codex'])
  })

  it('logged-in fake CLIs: plan-execute-review with two vendors', async () => {
    const { handlers } = createIpcHandlers(makeCtx('in'))
    const r = (await handlers['task:analyse']({ text: 'corrige le bug de division par zéro dans calc.py' })) as { pipeline: Pipeline }
    expect(r.pipeline.pattern).toBe('plan-execute-review')
    expect(new Set(r.pipeline.steps.map((s) => s.model.vendor)).size).toBe(2)
  })

  it('category override from the user is applied', async () => {
    const { handlers } = createIpcHandlers(makeCtx('in'))
    const r = (await handlers['task:analyse']({ text: 'bonjour', category: 'writing' })) as { classification: { category: string; needsConfirm: boolean }; pipeline: Pipeline }
    expect(r.classification).toMatchObject({ category: 'writing', needsConfirm: false })
    expect(r.pipeline.pattern).toBe('handoff')
  })

  it('accounts:status reports each vendor', async () => {
    const { handlers } = createIpcHandlers(makeCtx('out'))
    const s = (await handlers['accounts:status'](undefined)) as Array<{ vendor: string; cli: { state: string } }>
    expect(s.map((x) => x.cli.state)).toEqual(['disconnected', 'disconnected', 'disconnected'])
  })

  it('web:markSignedIn persists and makes the web tools connected', async () => {
    const ctx = makeCtx('in')
    const { handlers } = createIpcHandlers(ctx)
    await handlers['web:markSignedIn']({ vendor: 'anthropic', value: true })
    expect((await ctx.store.getSettings()).webSignedIn.anthropic).toBe(true)
  })
})

describe('run:start end to end with fake CLIs', () => {
  it('runs the pipeline, records history, emits events, and edits are off by default', async () => {
    const events: RunEvent[] = []
    const ctx = makeCtx('in', events, { runnerOverrides: { killGraceMs: 300 } })
    const { handlers } = createIpcHandlers(ctx)
    const folder = (await handlers['folder:pick'](undefined)) as { id: string; label: string }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, '.fake-mode'), 'run=success\nreview=verdict_pass')
    const { pipeline, classification } = (await handlers['task:analyse']({ text: 'corrige le bug dans calc.py' })) as { pipeline: Pipeline; classification: never }
    pipeline.steps[1]!.canEdit = true // a tampered renderer asks for edits; Settings say no
    const runId = (await handlers['run:start']({ pipeline, text: 'corrige le bug dans calc.py', folderId: folder.id, classification })) as string
    for (let i = 0; i < 100 && !events.some((e) => e.type === 'run-end'); i++) await sleep(100)
    const end = events.find((e) => e.type === 'run-end') as Extract<RunEvent, { type: 'run-end' }>
    expect(end.runId).toBe(runId)
    expect(end.status).toBe('done')
    expect(events[0]?.type).toBe('run-start')
    const started = events[0] as Extract<RunEvent, { type: 'run-start' }>
    expect(started.pipeline.steps.every((s) => !s.canEdit)).toBe(true)
    const hist = await ctx.store.listHistory()
    expect(hist).toHaveLength(1)
    expect(hist[0]!.id).toBe(runId)
  })

  it('rejects a tampered pipeline (model id injection) and an unknown folder', async () => {
    const { handlers } = createIpcHandlers(makeCtx('in'))
    const { pipeline } = (await handlers['task:analyse']({ text: 'corrige le bug dans calc.py' })) as { pipeline: Pipeline }
    const evil = structuredClone(pipeline)
    evil.steps[0]!.model.id = '--add-dir=/'
    await expect(handlers['run:start']({ pipeline: evil, text: 'x', folderId: null })).rejects.toThrow('err.invalidPipeline')
    await expect(handlers['run:start']({ pipeline, text: 'x', folderId: 'deadbeef' })).rejects.toThrow('err.unknownFolder')
  })
})

describe('registerIpc', () => {
  function fakeIpcMain() {
    const map = new Map<string, (e: unknown, p: unknown) => Promise<unknown>>()
    return { map, handle: (c: string, f: (e: unknown, p: unknown) => Promise<unknown>) => void map.set(c, f) }
  }

  it('registers every channel, validates payloads and checks the sender', async () => {
    const ipc = fakeIpcMain()
    let trusted = true
    registerIpc(ipc as never, makeCtx('in'), () => trusted)
    expect([...ipc.map.keys()].sort()).toEqual([...IPC_CHANNELS].sort())
    const h = ipc.map.get('task:analyse')!
    await expect(h({}, { text: '' })).rejects.toThrow('err.invalidInput')
    await expect(h({}, { text: 'x'.repeat(300_000) })).rejects.toThrow('err.invalidInput')
    await expect(h({}, { text: 'bonjour' })).resolves.toBeTruthy()
    trusted = false
    await expect(h({}, { text: 'bonjour' })).rejects.toThrow('err.untrustedSender')
  })

  it('main-process messages are i18n keys', async () => {
    const ipc = fakeIpcMain()
    registerIpc(ipc as never, makeCtx('in'), () => true)
    for (const [ch, p] of [['accounts:connect', { vendor: 'x' }], ['run:cancel', {}], ['link:open', { toolId: 'codex' }]] as const) {
      await expect(ipc.map.get(ch)!({}, p)).rejects.toThrow(/^err\./)
    }
  })

  it('link:open opens only the exact catalog URL', async () => {
    const opened: string[] = []
    const ipc = fakeIpcMain()
    registerIpc(ipc as never, makeCtx('in', [], { openExternal: (u) => void opened.push(u) }), () => true)
    await ipc.map.get('link:open')!({}, { toolId: 'cowork' })
    expect(opened).toEqual(['https://claude.ai'])
  })

  it('link:open opens a site page from the catalog, per language, and refuses anything else', async () => {
    const opened: string[] = []
    const ipc = fakeIpcMain()
    registerIpc(ipc as never, makeCtx('in', [], { openExternal: (u) => void opened.push(u) }), () => true)
    await ipc.map.get('link:open')!({}, { link: 'support', lang: 'fr' })
    await ipc.map.get('link:open')!({}, { link: 'support', lang: 'en' })
    expect(opened).toEqual(['https://smartroute.yolea.ai/soutenir/', 'https://smartroute.yolea.ai/en/support/'])
    await expect(ipc.map.get('link:open')!({}, { link: 'https://evil.example', lang: 'fr' })).rejects.toThrow(/^err\./)
    expect(opened).toHaveLength(2)
  })

  it('run:handoffResult returns ok:false when nothing is waiting', async () => {
    const { handlers } = createIpcHandlers(makeCtx('in'))
    expect(await handlers['run:handoffResult']({ runId: 'r', stepId: 's1', text: 'x' })).toEqual({ ok: false })
  })
})

describe('web:insertBrief guards', () => {
  it('refuses a mismatched vendor and a hidden panel, inserts otherwise', async () => {
    const inserted: string[] = []
    let visible = true
    const events: RunEvent[] = []
    const ctx = makeCtx('in', events, {
      web: { show() {}, hide() {}, insertBrief: async (_v, t) => void inserted.push(t), captureSelection: async () => '', isVisible: () => visible }
    })
    const { handlers } = createIpcHandlers(ctx)
    const { pipeline } = (await handlers['task:analyse']({ text: 'bonjour', category: 'writing' })) as { pipeline: Pipeline }
    const runId = (await handlers['run:start']({ pipeline, text: 'rédige un email', folderId: null })) as string
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'handoff'); i++) await sleep(50)
    const h = events.find((e) => e.type === 'handoff') as Extract<RunEvent, { type: 'handoff' }>
    expect(h.tool).toBe('cowork')
    await expect(handlers['web:insertBrief']({ vendor: 'openai', runId, stepId: h.stepId })).rejects.toThrow(/^err\./)
    visible = false
    await expect(handlers['web:insertBrief']({ vendor: 'anthropic', runId, stepId: h.stepId })).rejects.toThrow(/^err\./)
    visible = true
    await handlers['web:insertBrief']({ vendor: 'anthropic', runId, stepId: h.stepId })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toContain('rédige un email')
    await handlers['run:cancel']({ runId })
  })
})

describe('run:retryStep', () => {
  it('re-runs only the failed step after a network error, updates history, rejects other cases', async () => {
    const events: RunEvent[] = []
    const ctx = makeCtx('in', events, { runnerOverrides: { killGraceMs: 300 } })
    const { handlers } = createIpcHandlers(ctx)
    const { writeFile, readFile } = await import('node:fs/promises')
    const folder = (await handlers['folder:pick'](undefined)) as { id: string }
    await writeFile(join(dir, '.fake-mode'), 'default=network_once\n')
    const text = 'Réponds OK en français'
    const { pipeline, classification } = (await handlers['task:analyse']({ text, category: 'other' })) as { pipeline: Pipeline; classification: never }
    const runId = (await handlers['run:start']({ pipeline, text, folderId: folder.id, classification })) as string
    const waitEnd = async (n: number): Promise<Extract<RunEvent, { type: 'run-end' }>> => {
      for (let i = 0; i < 100 && events.filter((e) => e.type === 'run-end').length < n; i++) await sleep(50)
      return events.filter((e) => e.type === 'run-end')[n - 1] as Extract<RunEvent, { type: 'run-end' }>
    }
    const end1 = await waitEnd(1)
    expect(end1.status).toBe('failed')
    expect(end1.results[0]?.error).toBe('network')
    const stepId = end1.results[0]!.stepId
    await expect(handlers['run:retryStep']({ runId: 'nope', stepId })).rejects.toThrow('err.cannotRetry')
    await handlers['run:retryStep']({ runId, stepId })
    const end2 = await waitEnd(2)
    expect(end2.status).toBe('done')
    expect(end2.results[0]?.ok).toBe(true)
    expect((await ctx.store.listHistory())[0]!.results[0]!.ok).toBe(true)
    await expect(handlers['run:retryStep']({ runId, stepId })).rejects.toThrow('err.cannotRetry')
    // the French task made claude run with the French language override
    expect(await readFile(join(dir, '.fake-args'), 'utf8')).toContain('{"language":"French"}')
  })
})

describe('task:analyse never waits for a CLI status check', () => {
  type Mode = 'real' | 'hang' | 'garbage'
  function ctxWith(mode: { v: Mode }) {
    return makeCtx('in', [], {
      exec: (file, args, env, t) =>
        mode.v === 'hang' ? new Promise(() => undefined) : mode.v === 'garbage' ? Promise.resolve({ stdout: '', stderr: '', code: 0 }) : defaultExec(file, args, env, t)
    })
  }

  it('with no status yet it answers immediately (installed CLIs assumed connected)', async () => {
    const mode = { v: 'hang' as Mode }
    const { handlers } = createIpcHandlers(ctxWith(mode))
    const t0 = Date.now()
    const r = (await handlers['task:analyse']({ text: 'corrige le bug dans calc.py' })) as { pipeline: Pipeline }
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(r.pipeline.steps.length).toBeGreaterThan(0)
  })

  it('uses the last known statuses while a refresh hangs, and keeps a vendor whose check became unknown', async () => {
    const mode = { v: 'real' as Mode }
    const ctx = ctxWith(mode)
    ctx.env.FAKE_AUTH = 'out'
    const { handlers } = createIpcHandlers(ctx)
    await handlers['accounts:status'](undefined) // warm the cache: all disconnected
    mode.v = 'hang'
    const t0 = Date.now()
    const r = (await handlers['task:analyse']({ text: 'corrige le bug dans calc.py' })) as { pipeline: Pipeline }
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(r.pipeline.steps).toHaveLength(0)
    expect(r.pipeline.explanation.filter((e) => e.key === 'route.skip.notConnected')).toHaveLength(3)
  })

  it('an unknown answer with a lastConnectedAt still counts as connected', async () => {
    const mode = { v: 'real' as Mode }
    const ctx = ctxWith(mode)
    const { handlers } = createIpcHandlers(ctx)
    await handlers['accounts:status'](undefined) // connected, remembered
    mode.v = 'garbage'
    await handlers['accounts:status'](undefined) // now unknown
    mode.v = 'hang'
    const r = (await handlers['task:analyse']({ text: 'corrige le bug dans calc.py' })) as { pipeline: Pipeline }
    expect(r.pipeline.steps.length).toBeGreaterThan(0)
  })
})

describe('user folder and web reading', () => {
  it('run:start tells the runner whether the run works in a folder the user chose', async () => {
    const seen: Array<boolean | undefined> = []
    const runStepFn = (async (step, _prompt, _cwd, _signal, _onEvent, deps) => {
      seen.push(deps.userFolder)
      return { stepId: step.id, role: step.role, tool: step.tool, ok: true, text: 'ok', durationMs: 1 }
    }) as NonNullable<IpcContext['runStepFn']>
    const events: RunEvent[] = []
    const { handlers } = createIpcHandlers(makeCtx('in', events, { runStepFn }))
    const folder = (await handlers['folder:pick'](undefined)) as { id: string }
    const { pipeline } = (await handlers['task:analyse']({ text: 'explique ce code', category: 'research' })) as { pipeline: Pipeline }
    expect(pipeline.steps.length).toBeGreaterThan(0)
    const only = { ...pipeline, steps: [pipeline.steps[0]!] }
    for (const folderId of [folder.id, null]) {
      const before = events.filter((e) => e.type === 'run-end').length
      await handlers['run:start']({ pipeline: only, text: 'explique ce code', folderId })
      for (let i = 0; i < 100 && events.filter((e) => e.type === 'run-end').length === before; i++) await sleep(50)
    }
    expect(seen).toEqual([true, false])
  })
})

describe('concurrent runs', () => {
  it('at most three runs at once; a fourth start is refused with err.tooManyRuns, and a slot frees when one ends', async () => {
    const events: RunEvent[] = []
    const { handlers, activeRuns, abortAll, whenIdle } = createIpcHandlers(makeCtx('in', events))
    const { pipeline } = (await handlers['task:analyse']({ text: 'bonjour', category: 'writing' })) as { pipeline: Pipeline }
    const start = (): Promise<unknown> => handlers['run:start']({ pipeline, text: 'rédige un email', folderId: null })
    const ids = (await Promise.all([start(), start(), start()])) as string[]
    expect(activeRuns()).toBe(3)
    await expect(start()).rejects.toThrow('err.tooManyRuns')
    // simultaneous starts when two slots are taken: only one gets the last slot
    await handlers['run:cancel']({ runId: ids[0] as string })
    for (let i = 0; i < 100 && activeRuns() > 2; i++) await sleep(50)
    expect(activeRuns()).toBe(2)
    const settled = await Promise.allSettled([start(), start()])
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    expect(activeRuns()).toBe(3)
    abortAll()
    await whenIdle()
  })
})

describe('the replay record, the export and the folder channels', () => {
  /** A handoff run needs no CLI: start it, answer the handoff, wait for the history row. */
  async function finishedHandoffRun(extra: Partial<IpcContext> = {}) {
    const events: RunEvent[] = []
    const ctx = makeCtx('in', events, extra)
    const { handlers } = createIpcHandlers(ctx)
    const { pipeline } = (await handlers['task:analyse']({ text: 'bonjour', category: 'writing' })) as { pipeline: Pipeline }
    const runId = (await handlers['run:start']({ pipeline, text: 'rédige un email', folderId: null })) as string
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'handoff'); i++) await sleep(50)
    const h = events.find((e) => e.type === 'handoff') as Extract<RunEvent, { type: 'handoff' }>
    await handlers['run:handoffResult']({ runId, stepId: h.stepId, text: '## Email\n\nBonjour,\nVoici le message.' })
    for (let i = 0; i < 100 && !events.some((e) => e.type === 'run-end'); i++) await sleep(50)
    for (let i = 0; i < 50 && (await ctx.store.listHistory()).length === 0; i++) await sleep(50)
    return { ctx, handlers, runId, events }
  }

  it('the history row is version 2 and holds the timed events of the run, run-end last', async () => {
    const { ctx, runId } = await finishedHandoffRun()
    const [row] = await ctx.store.listHistory()
    expect(row).toMatchObject({ v: 2, id: runId })
    expect(row!.events.map((e) => e.kind)).toEqual(['start', 'handoff', 'end', 'run-end'])
    expect(row!.events[1]).toMatchObject({ kind: 'handoff', text: 'cowork' })
    expect(row!.events.at(-1)).toMatchObject({ kind: 'run-end', text: 'done' })
    for (let i = 1; i < row!.events.length; i++) expect(row!.events[i]!.t).toBeGreaterThanOrEqual(row!.events[i - 1]!.t)
    // the brief that was shown to the person is not copied into the replay
    expect(JSON.stringify(row!.events)).not.toContain('rédige un email')
  })

  it('history:export asks main to save the Markdown with a suggested name, in the language of the settings', async () => {
    const saved: Array<{ name: string; text: string }> = []
    const { handlers, runId } = await finishedHandoffRun({ saveFile: async (name, text) => {
      saved.push({ name, text })
      return true
    } })
    const r = (await handlers['history:export']({ id: runId })) as { saved: boolean; name: string }
    expect(r.saved).toBe(true)
    expect(r.name).toMatch(/^smart-route-\d{4}-\d{2}-\d{2}-[A-Za-z0-9]{1,6}\.md$/)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe(r.name)
    expect(saved[0]!.text).toContain('## Résultat')
    expect(saved[0]!.text).toContain('Voici le message.')
    expect(saved[0]!.text).toContain('Claude (claude.ai)')
  })

  it('history:export reports a cancelled dialog, an unknown id and a missing dialog', async () => {
    const cancelled = await finishedHandoffRun({ saveFile: async () => false })
    expect(await cancelled.handlers['history:export']({ id: cancelled.runId })).toMatchObject({ saved: false })
    await expect(cancelled.handlers['history:export']({ id: 'nope' })).rejects.toThrow('err.notFound')
    const none = await finishedHandoffRun()
    await expect(none.handlers['history:export']({ id: none.runId })).rejects.toThrow('err.notAvailable')
  })

  it('folder:list gives ids and labels only; folder:open shows the folder behind an id and refuses any other', async () => {
    const shown: string[] = []
    const { handlers } = createIpcHandlers(makeCtx('in', [], { showFolder: (p) => void shown.push(p) }))
    expect(await handlers['folder:list'](undefined)).toEqual([])
    const picked = (await handlers['folder:pick'](undefined)) as { id: string; label: string }
    const list = (await handlers['folder:list'](undefined)) as Array<Record<string, unknown>>
    expect(list).toEqual([{ id: picked.id, label: picked.label }])
    expect(Object.keys(list[0]!).sort()).toEqual(['id', 'label'])
    expect(JSON.stringify(list)).not.toContain(dir)
    expect(await handlers['folder:open']({ folderId: picked.id })).toEqual({ ok: true })
    expect(shown).toEqual([dir])
    await expect(handlers['folder:open']({ folderId: 'deadbeef' })).rejects.toThrow('err.unknownFolder')
    expect(shown).toHaveLength(1)
  })

  it('folder:open without a file manager says so', async () => {
    const { handlers } = createIpcHandlers(makeCtx('in'))
    const picked = (await handlers['folder:pick'](undefined)) as { id: string }
    await expect(handlers['folder:open']({ folderId: picked.id })).rejects.toThrow('err.notAvailable')
  })

  it('the three new channels are validated and trusted-sender checked like the others', async () => {
    const map = new Map<string, (e: unknown, p: unknown) => Promise<unknown>>()
    let trusted = true
    registerIpc({ handle: (c: string, f: (e: unknown, p: unknown) => Promise<unknown>) => void map.set(c, f) } as never, makeCtx('in'), () => trusted)
    await expect(map.get('history:export')!({}, { id: '../x' })).rejects.toThrow('err.invalidInput')
    await expect(map.get('folder:open')!({}, { folderId: '/etc' })).rejects.toThrow('err.invalidInput')
    await expect(map.get('folder:list')!({}, { x: 1 })).rejects.toThrow('err.invalidInput')
    trusted = false
    for (const [c, p] of [['history:export', { id: 'ab' }], ['folder:open', { folderId: 'ab' }], ['folder:list', undefined]] as const) {
      await expect(map.get(c)!({}, p)).rejects.toThrow('err.untrustedSender')
    }
  })
})
