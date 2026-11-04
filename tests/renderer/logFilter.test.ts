import { describe, expect, it } from 'vitest'
import { appendLog, isNoise, type LogLine } from '../../src/renderer/src/logFilter'
import { reduceRun } from '../../src/renderer/src/runState'
import { stepRoleName } from '../../src/renderer/src/i18n/i18n'
import type { Pipeline, RunEvent } from '../../src/core/types'
import { mkStep } from '../main/helpers'

const d = (text: string): LogLine => ({ stream: 'event', text, delta: true })

describe('appendLog joins streamed fragments', () => {
  it('consecutive fragments make one block, words are not cut', () => {
    let l: LogLine[] = []
    for (const f of ['Voici le pla', 'n d\'action', ' pour ', 'demain.']) l = appendLog(l, d(f))
    expect(l.map((x) => x.text)).toEqual(["Voici le plan d'action pour demain."])
  })
  it('a newline in a fragment starts a new line; a trailing newline lets the next text start a fresh line', () => {
    let l: LogLine[] = []
    for (const f of ['one', ' two\nthree', '\n', 'four']) l = appendLog(l, d(f))
    expect(l.map((x) => x.text)).toEqual(['one two', 'three', 'four'])
  })
  it('a tool line or another stream breaks the block', () => {
    let l: LogLine[] = []
    l = appendLog(l, d('before'))
    l = appendLog(l, { stream: 'event', text: '🔧 run_command' })
    l = appendLog(l, d('after '))
    l = appendLog(l, d('it'))
    l = appendLog(l, { stream: 'stderr', text: 'oops', delta: true })
    expect(l.map((x) => x.text)).toEqual(['before', '🔧 run_command', 'after it', 'oops'])
  })
  it('non-delta events are never merged, and a delta line is not mistaken for technical noise', () => {
    let l: LogLine[] = []
    l = appendLog(l, { stream: 'event', text: 'a' })
    l = appendLog(l, { stream: 'event', text: 'b' })
    expect(l).toHaveLength(2)
    expect(isNoise(d('result'))).toBe(false)
    expect(isNoise({ stream: 'event', text: 'result' })).toBe(true)
  })
  it('reduceRun joins the fragments of a step', () => {
    const pipeline: Pipeline = { pattern: 'single', steps: [mkStep('agy', 'single', 1, { id: 's1' })], explanation: [] }
    let s = reduceRun(null, { type: 'run-start', runId: 'r', pipeline } as RunEvent, 0)
    for (const text of ['Voici le pla', 'n']) s = reduceRun(s, { type: 'log', runId: 'r', stepId: 's1', stream: 'event', text, delta: true }, 1)
    expect(s?.logs.s1?.map((x) => x.text)).toEqual(['Voici le plan'])
  })
})

describe('stepRoleName', () => {
  it('uses the recipe label in both languages, else the generic role', () => {
    const step = { role: 'plan', label: { fr: 'Chercher', en: 'Research' } }
    expect(stepRoleName('fr', step)).toBe('Chercher')
    expect(stepRoleName('en', step)).toBe('Research')
    expect(stepRoleName('fr', { role: 'plan' })).toBe('Planifier')
  })
})
