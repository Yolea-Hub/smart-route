export const SELECTION_MAX_BYTES = 50_000

/** Coerce whatever the page returned to a string capped at 50 KB (UTF-8 safe). */
export function clampSelection(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  const buf = Buffer.from(s, 'utf8')
  if (buf.length <= SELECTION_MAX_BYTES) return s
  return buf.subarray(0, SELECTION_MAX_BYTES).toString('utf8').replace(/�+$/, '')
}
