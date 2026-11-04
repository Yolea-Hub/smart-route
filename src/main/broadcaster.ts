import type { CliAccountStatus, RunEvent, Vendor } from '../core/types'

export type PushChannel = 'run:event' | 'accounts:update'
export type PushData = RunEvent | { vendor: Vendor; cli: CliAccountStatus }
export type PushSink = (channel: PushChannel, data: PushData) => void

/**
 * Fan-out of the main -> renderer pushes (`run:event`, `accounts:update`): the Electron window is one sink, each
 * authenticated browser socket is another. A failing sink never stops the others.
 */
export class Broadcaster {
  private sinks = new Set<PushSink>()

  /** Adds a sink; returns the function that removes it. */
  addSink(sink: PushSink): () => void {
    this.sinks.add(sink)
    return () => {
      this.sinks.delete(sink)
    }
  }

  runEvent(e: RunEvent): void {
    this.send('run:event', e)
  }

  accountUpdate(u: { vendor: Vendor; cli: CliAccountStatus }): void {
    this.send('accounts:update', u)
  }

  send(channel: PushChannel, data: PushData): void {
    for (const sink of [...this.sinks]) {
      try {
        sink(channel, data)
      } catch {
        /* one broken sink must not stop the others */
      }
    }
  }

  get size(): number {
    return this.sinks.size
  }
}
