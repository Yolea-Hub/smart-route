import type { CliAccountStatus, RunEvent, Vendor } from '../../core/types'

declare global {
  /** True in the browser build (vite.web.config.ts), false in the desktop build. Replaced at build time. */
  const __WEB__: boolean
  interface Window {
    smartRoute: {
      invoke(channel: string, payload?: unknown): Promise<unknown>
      on(
        channel: 'run:event' | 'accounts:update' | 'web:signinBlocked' | 'web:focusReturned',
        listener: (data: RunEvent | { vendor: Vendor; cli: CliAccountStatus } | { vendor: Vendor }) => void
      ): () => void
    }
  }
  /** The part of Vite's `import.meta.glob` this app uses (vite/client is not a direct dependency). */
  interface ImportMeta {
    glob(pattern: string | string[], options?: { eager?: boolean; query?: string; import?: string }): Record<string, unknown>
  }
}
export {}
