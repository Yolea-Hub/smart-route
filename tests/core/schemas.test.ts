import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, IPC_SCHEMAS, modelChoiceSchema, pipelineSchema, settingsPatchSchema, verdictSchema } from '../../src/core/schemas'
import { HANDOFF_URLS, defaultCodexModels, modelFor } from '../../src/core/catalog'

describe('schemas', () => {
  it('verdict schema accepts valid and rejects invalid verdicts', () => {
    expect(verdictSchema.safeParse({ pass: true, issues: [] }).success).toBe(true)
    expect(verdictSchema.safeParse({ pass: 'yes', issues: [] }).success).toBe(false)
    expect(verdictSchema.safeParse({ pass: true }).success).toBe(false)
  })

  it('covers every IPC channel of the plan', () => {
    for (const c of ['tools:detect', 'folder:pick', 'task:analyse', 'run:start', 'run:cancel', 'run:handoffResult', 'accounts:status', 'accounts:connect', 'accounts:disconnect', 'web:show', 'web:hide', 'web:insertBrief', 'web:captureSelection', 'web:markSignedIn', 'history:list', 'history:rate', 'history:clear', 'history:export', 'folder:open', 'folder:list', 'settings:get', 'settings:set', 'link:open']) {
      expect(IPC_CHANNELS).toContain(c)
    }
  })

  it('rejects malformed IPC payloads', () => {
    expect(IPC_SCHEMAS['task:analyse'].safeParse({ text: '' }).success).toBe(false)
    expect(IPC_SCHEMAS['accounts:connect'].safeParse({ vendor: 'evil' }).success).toBe(false)
    expect(IPC_SCHEMAS['run:cancel'].safeParse({ runId: '../x' }).success).toBe(false)
    expect(IPC_SCHEMAS['link:open'].safeParse({ toolId: 'codex' }).success).toBe(false)
  })

  it('the export, open-folder and list-folders channels take ids only', () => {
    expect(IPC_SCHEMAS['history:export'].safeParse({ id: 'ab12cd' }).success).toBe(true)
    expect(IPC_SCHEMAS['history:export'].safeParse({ id: '../../etc/passwd' }).success).toBe(false)
    expect(IPC_SCHEMAS['history:export'].safeParse({ id: 'ab12cd', path: '/tmp/x' }).success).toBe(true) // extra keys are dropped by zod, never read
    expect(IPC_SCHEMAS['history:export'].parse({ id: 'ab12cd', path: '/tmp/x' })).toEqual({ id: 'ab12cd' })
    expect(IPC_SCHEMAS['folder:open'].safeParse({ folderId: 'deadbeef' }).success).toBe(true)
    expect(IPC_SCHEMAS['folder:open'].safeParse({ folderId: '/home/me' }).success).toBe(false)
    expect(IPC_SCHEMAS['folder:open'].safeParse({}).success).toBe(false)
    expect(IPC_SCHEMAS['folder:list'].safeParse(undefined).success).toBe(true)
    expect(IPC_SCHEMAS['folder:list'].safeParse({ x: 1 }).success).toBe(false)
  })

  it('settings patch rejects codex model ids that could inject arguments', () => {
    const ok = { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }
    expect(settingsPatchSchema.safeParse({ codexModels: ok }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ codexModels: { ...ok, '1': '--add-dir=/' } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ codexModels: { ...ok, '1': 'a b' } }).success).toBe(false)
  })
})

describe('catalog', () => {
  it('has exact handoff URLs', () => {
    expect(HANDOFF_URLS).toEqual({ cowork: 'https://claude.ai', 'gemini-tasks': 'https://gemini.google.com', 'chatgpt-work': 'https://chatgpt.com' })
  })
  it('maps tiers to models and codex efforts', () => {
    expect(modelFor('claude-code', 0).id).toBe('haiku')
    expect(modelFor('claude-code', 3).id).toBe('fable')
    expect(modelFor('agy', 3)).toMatchObject({ id: 'claude-opus-4-6-thinking', vendor: 'anthropic' })
    expect(modelFor('codex', 2, defaultCodexModels())).toMatchObject({ id: 'gpt-6.1-sol', effort: 'high' })
    expect(modelFor('codex', 3).effort).toBe('xhigh')
  })
})

import { IPC_CHANNEL_NAMES } from '../../src/core/channels'
describe('channels', () => {
  it('preload channel list matches the validated schemas exactly', () => {
    expect([...IPC_CHANNEL_NAMES].sort()).toEqual([...IPC_CHANNELS].sort())
  })
})

describe('pipeline and model schemas', () => {
  const model = { id: 'claude-opus-4-8', vendor: 'anthropic', tier: 3, label: 'Opus' }
  it('modelChoiceSchema.id has the same safe charset as safeModelId', () => {
    expect(modelChoiceSchema.safeParse(model).success).toBe(true)
    for (const id of ['--dangerous', 'a b', 'a;rm', '$(x)', 'a\nb', '', 'x'.repeat(101), '../x']) expect(modelChoiceSchema.safeParse({ ...model, id }).success, id).toBe(false)
  })
  it('a recipe step label survives validation (and an oversized one is refused)', () => {
    const step = { id: 's1', role: 'plan', tool: 'agy', model: { ...model, vendor: 'google', id: 'gemini-3.8-flash-high' }, canEdit: false, timeoutSec: 60, label: { fr: 'Chercher', en: 'Research' } }
    const ok = pipelineSchema.parse({ pattern: 'single', steps: [step], explanation: [] })
    expect(ok.steps[0]?.label).toEqual({ fr: 'Chercher', en: 'Research' })
    expect(pipelineSchema.safeParse({ pattern: 'single', steps: [{ ...step, label: { fr: 'x'.repeat(81), en: 'y' } }], explanation: [] }).success).toBe(false)
  })
})
