export interface ShutdownDeps {
  activeRuns: () => number
  abortAll: () => void
  whenIdle: () => Promise<void>
  killAllLive: () => void
  /** Runner kill grace; the wait is bounded by graceMs + 500. */
  graceMs: number
}

/**
 * App-quit sequence: if runs are active, abort them, wait (bounded) for the runner to settle, then
 * SIGKILL every process group still registered. Returns true when it had to wait (caller must exit itself).
 */
export async function shutdownRuns(d: ShutdownDeps): Promise<boolean> {
  if (d.activeRuns() === 0) {
    d.killAllLive()
    return false
  }
  d.abortAll()
  await Promise.race([d.whenIdle(), new Promise<void>((r) => setTimeout(r, d.graceMs + 500))])
  d.killAllLive()
  return true
}
