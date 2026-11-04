export interface LogLine {
  stream: 'event' | 'stderr'
  text: string
  /** A streamed text fragment: consecutive fragments of one step are joined into one block. */
  delta?: boolean
}

/** Longest joined block; a longer stream starts a new line. */
const MAX_JOINED = 4000

/**
 * Adds one log event to a step's lines. Consecutive fragments (`delta`) of the same stream are concatenated into one line
 * (words are never cut); a newline inside a fragment, or any other kind of event (a tool line), starts a new line.
 */
export function appendLog(list: LogLine[], ev: LogLine): LogLine[] {
  if (!ev.delta) return [...list, { stream: ev.stream, text: ev.text }]
  const parts = ev.text.split('\n')
  const out = list.slice()
  parts.forEach((part, i) => {
    const last = out[out.length - 1]
    const joinable = i === 0 && last !== undefined && last.delta === true && last.stream === ev.stream && last.text.length + part.length <= MAX_JOINED
    if (joinable) out[out.length - 1] = { ...last, text: last.text + part }
    else out.push({ stream: ev.stream, text: part, delta: true })
  })
  return out
}

/** Bare event-type names the CLIs stream (system, rate_limit_event, thread.started...): technical noise. */
const BARE_TYPE = /^[a-z]+(?:[_.][a-z]+)*$/
const KNOWN_NOISE = new Set(['system', 'user', 'result', 'assistant', 'init', 'stream_event', 'rate_limit_event'])
export function isNoise(l: LogLine): boolean {
  if (l.stream !== 'event') return false
  const t = l.text.trim()
  if (t === '') return true
  if (l.delta) return false
  return BARE_TYPE.test(t) && t.length < 40 && (KNOWN_NOISE.has(t) || /[_.]/.test(t))
}

