import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNEL_NAMES } from '../core/channels'
import type { RunEvent, CliAccountStatus, Vendor } from '../core/types'

/** Main -> renderer push channels. */
const EVENT_CHANNELS = ['run:event', 'accounts:update', 'web:signinBlocked', 'web:focusReturned'] as const
type EventChannel = (typeof EVENT_CHANNELS)[number]

const api = {
  /** Invoke a whitelisted channel. Payloads are validated again in the main process. */
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!(IPC_CHANNEL_NAMES as readonly string[]).includes(channel)) return Promise.reject(new Error('err.invalidChannel'))
    return ipcRenderer.invoke(channel, payload)
  },
  /** Subscribe to a main -> renderer event; returns an unsubscribe function. */
  on(channel: EventChannel, listener: (data: RunEvent | { vendor: Vendor; cli: CliAccountStatus } | { vendor: Vendor }) => void): () => void {
    if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error('err.invalidChannel')
    const handler = (_e: unknown, data: RunEvent | { vendor: Vendor; cli: CliAccountStatus } | { vendor: Vendor }): void => listener(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('smartRoute', api)

export type SmartRouteApi = typeof api
