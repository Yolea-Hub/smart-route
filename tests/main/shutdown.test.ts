import { describe, expect, it } from 'vitest'
import { shutdownRuns } from '../../src/main/shutdown'

describe('shutdownRuns', () => {
  it('with no active run it only reaps leftovers and does not wait', async () => {
    const calls: string[] = []
    const waited = await shutdownRuns({ activeRuns: () => 0, abortAll: () => calls.push('abort'), whenIdle: async () => void calls.push('idle'), killAllLive: () => calls.push('kill'), graceMs: 50 })
    expect(waited).toBe(false)
    expect(calls).toEqual(['kill'])
  })

  it('aborts, waits for the runs, then SIGKILLs the remaining groups', async () => {
    const calls: string[] = []
    const waited = await shutdownRuns({
      activeRuns: () => 1,
      abortAll: () => calls.push('abort'),
      whenIdle: async () => {
        await new Promise((r) => setTimeout(r, 20))
        calls.push('idle')
      },
      killAllLive: () => calls.push('kill'),
      graceMs: 5000
    })
    expect(waited).toBe(true)
    expect(calls).toEqual(['abort', 'idle', 'kill'])
  })

  it('the wait is bounded by grace + 500 ms when a run never settles', async () => {
    const t0 = Date.now()
    await shutdownRuns({ activeRuns: () => 1, abortAll: () => undefined, whenIdle: () => new Promise(() => undefined), killAllLive: () => undefined, graceMs: 100 })
    const dt = Date.now() - t0
    expect(dt).toBeGreaterThanOrEqual(550)
    expect(dt).toBeLessThan(1500)
  })
})
