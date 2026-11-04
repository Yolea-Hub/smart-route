import { z } from 'zod'
import { SITE_LINK_IDS } from './siteLinks'

export const verdictSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().max(2000)).max(100)
})

/** JSON Schema given to the CLIs (--json-schema / --output-schema). Strict: all keys required. */
export const VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string', maxLength: 2000 }, maxItems: 100 }
  },
  required: ['pass', 'issues'],
  additionalProperties: false
} as const

const toolId = z.enum(['claude-code', 'codex', 'agy', 'cowork', 'gemini-tasks', 'chatgpt-work'])
export const vendorSchema = z.enum(['anthropic', 'openai', 'google'])
const role = z.enum(['plan', 'execute', 'review', 'single'])
const tier = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

/** A model id as it is passed to a tool's command line: no space, no leading dash, no shell character. */
export const safeModelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/)

export const modelChoiceSchema = z.object({
  id: safeModelId,
  vendor: vendorSchema,
  tier,
  label: z.string().max(200),
  effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional()
})

export const stepSchema = z.object({
  id: z.string().min(1).max(32),
  role,
  tool: toolId,
  model: modelChoiceSchema,
  canEdit: z.boolean(),
  timeoutSec: z.number().int().min(1).max(86_400),
  // Recipe step name: without it the history and the replay would show the generic role.
  label: z.object({ fr: z.string().max(80), en: z.string().max(80) }).optional()
})

export const explainEntrySchema = z.object({
  key: z.string().max(100),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional()
})

export const pipelineSchema = z.object({
  pattern: z.enum(['single', 'plan-execute-review', 'handoff']),
  steps: z.array(stepSchema).min(1).max(8),
  explanation: z.array(explainEntrySchema).max(100)
})

export const settingsSchema = z.object({
  v: z.literal(2),
  lang: z.enum(['fr', 'en']),
  allowEdits: z.boolean(),
  auto: z.boolean(),
  useClaudeConfig: z.boolean(),
  codexModels: z.object({
    '0': z.string().min(1).max(100),
    '1': z.string().min(1).max(100),
    '2': z.string().min(1).max(100),
    '3': z.string().min(1).max(100)
  }),
  dailyCap: z.number().int().min(1).max(1000),
  timeoutSec: z.number().int().min(10).max(7200),
  webSignedIn: z.object({ anthropic: z.boolean(), openai: z.boolean(), google: z.boolean() }),
  role: z.enum(['none', 'developer', 'manager', 'marketing', 'image', 'video', 'research', 'student', 'entrepreneur']),
  roleAsked: z.boolean()
})

/** Model ids are passed as CLI arguments: restrict them to a safe charset. */

export const settingsPatchSchema = settingsSchema
  .omit({ v: true })
  .extend({ codexModels: z.object({ '0': safeModelId, '1': safeModelId, '2': safeModelId, '3': safeModelId }) })
  .partial()

/** What a browser may change with `settings:set`: the language, nothing else. */
export const webSettingsPatchSchema = z.object({ lang: z.enum(['fr', 'en']) }).strict()

export const classificationSchema = z.object({
  category: z.enum(['code', 'debug', 'review', 'research', 'question', 'writing', 'data', 'design', 'ops', 'image', 'video', 'other']),
  difficulty: tier,
  risk: z.enum(['low', 'high']),
  confidence: z.number().min(0).max(1),
  reasons: z.array(explainEntrySchema).max(50),
  needsConfirm: z.boolean()
})

const TASK_MAX = 200_000
const taskText = z.string().min(1).max(TASK_MAX)
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** zod schemas for every IPC channel payload (renderer -> main). */
export const IPC_SCHEMAS = {
  'tools:detect': z.undefined().or(z.null()),
  'folder:pick': z.undefined().or(z.null()),
  'task:analyse': z.object({ text: taskText, category: classificationSchema.shape.category.optional() }),
  'run:start': z.object({
    pipeline: pipelineSchema,
    text: taskText,
    folderId: id.nullable(),
    classification: classificationSchema.optional()
  }),
  'run:cancel': z.object({ runId: id }),
  'run:handoffResult': z.object({ runId: id, stepId: id, text: z.string().max(1_000_000).nullable() }),
  'run:confirm': z.object({ runId: id, stepId: id, accept: z.boolean() }),
  'run:retryStep': z.object({ runId: id, stepId: id }),
  'accounts:status': z.undefined().or(z.null()),
  'accounts:connect': z.object({ vendor: vendorSchema }),
  'accounts:disconnect': z.object({ vendor: vendorSchema }),
  'web:show': z.object({
    vendor: vendorSchema,
    bounds: z.object({
      x: z.number().int().min(0).max(20_000),
      y: z.number().int().min(0).max(20_000),
      width: z.number().int().min(0).max(20_000),
      height: z.number().int().min(0).max(20_000)
    })
  }),
  'web:hide': z.undefined().or(z.null()),
  'web:insertBrief': z.object({ vendor: vendorSchema, runId: id, stepId: id }),
  'web:focus': z.object({ vendor: vendorSchema }),
  'web:captureSelection': z.object({ vendor: vendorSchema }),
  'web:openInBrowser': z.object({ vendor: vendorSchema }),
  'web:markSignedIn': z.object({ vendor: vendorSchema, value: z.boolean() }),
  'history:list': z.undefined().or(z.null()),
  'history:rate': z.object({ id, rating: z.union([z.literal(1), z.literal(-1)]).nullable() }),
  'history:clear': z.undefined().or(z.null()),
  'history:export': z.object({ id }),
  'folder:open': z.object({ folderId: id }),
  'folder:list': z.undefined().or(z.null()),
  'settings:get': z.undefined().or(z.null()),
  'settings:set': settingsPatchSchema,
  'link:open': z.union([
    z.object({ toolId: z.enum(['cowork', 'gemini-tasks', 'chatgpt-work']) }),
    z.object({ link: z.enum(SITE_LINK_IDS), lang: z.enum(['fr', 'en']) })
  ]),
  // Browser access (desktop only, never reachable from a socket).
  'bridge:status': z.undefined().or(z.null()),
  'bridge:enable': z.object({ enabled: z.boolean() }),
  'bridge:newCode': z.undefined().or(z.null()),
  'bridge:revoke': z.undefined().or(z.null())
} as const

export type IpcChannel = keyof typeof IPC_SCHEMAS
export const IPC_CHANNELS = Object.keys(IPC_SCHEMAS) as IpcChannel[]
