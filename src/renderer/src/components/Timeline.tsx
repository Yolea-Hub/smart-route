import { useEffect, useMemo, useRef, useState } from 'react'
import type { Pipeline, TimedEvent } from '../../../core/types'
import { useI18n } from '../i18n/i18n'
import { compressGaps, feedAt, nodesAtTime } from '../replayState'
import { formatElapsed } from '../runState'
import { RouteConstellation } from './RouteConstellation'

/** The whole replay lasts this long at most, whatever the length of the run. */
const TARGET_MS = 20_000
const FEED = 6

/**
 * Replays the timed events of a run on the constellation: play, pause, move along the line. Long silences are shortened
 * (replayState.compressGaps), so a ten-minute run replays in about twenty seconds.
 */
export function Timeline({ pipeline, events }: { pipeline: Pipeline; events: TimedEvent[] }) {
  const { t } = useI18n()
  const clock = useMemo(() => compressGaps(events), [events])
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = useRef(0)
  const posRef = useRef(0)
  const speed = Math.max(1, clock.duration / TARGET_MS)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    last.current = performance.now()
    const tick = (ts: number): void => {
      const dt = ts - last.current
      last.current = ts
      const next = Math.min(posRef.current + dt * speed, clock.duration)
      posRef.current = next
      setPos(next)
      if (next >= clock.duration) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, clock.duration])

  const state = useMemo(() => nodesAtTime(pipeline, clock.events, pos), [pipeline, clock.events, pos])
  const feed = feedAt(clock.events, pos, FEED)

  if (events.length === 0) return <p className="muted">{t('replay.none')}</p>

  const toggle = (): void => {
    if (!playing && pos >= clock.duration) {
      posRef.current = 0
      setPos(0)
    }
    setPlaying((p) => !p)
  }
  const reached = feedAt(clock.events, pos, 1)
  const realNow = reached.length > 0 ? (clock.real[reached[0] as number] as number) : 0
  const lineOf = (i: number): string => {
    const e = clock.events[i] as TimedEvent
    const step = state.nodes.find((n) => n.step.id === e.stepId)
    const who = step ? t(`tool.${step.step.tool}`) : ''
    const when = formatElapsed(clock.real[i] as number)
    if (e.kind === 'log') return `${when} · ${who ? `${who} · ` : ''}${e.text}`
    return `${when} · ${who ? `${who} · ` : ''}${t(`replay.kind.${e.kind}`)}${e.kind === 'run-end' ? ` · ${t(`run.status.${e.text}`)}` : ''}`
  }

  return (
    <div className="timeline">
      <RouteConstellation nodes={state.nodes} />
      <div className="timeline-bar">
        <button type="button" className="sg-button" onClick={toggle}>
          {playing ? t('replay.pause') : pos >= clock.duration && clock.duration > 0 ? t('replay.again') : t('replay.play')}
        </button>
        <label className="timeline-scrub">
          <span className="sg-visually-hidden">{t('replay.position')}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(clock.duration))}
            step={1}
            value={Math.round(pos)}
            aria-valuetext={`${formatElapsed(realNow)} / ${formatElapsed(clock.real[clock.real.length - 1] ?? 0)}`}
            onChange={(e) => {
              setPlaying(false)
              posRef.current = Number(e.target.value)
              setPos(posRef.current)
            }}
          />
        </label>
        <span className="timeline-time sg-tnum">
          {formatElapsed(realNow)} / {formatElapsed(clock.real[clock.real.length - 1] ?? 0)}
        </span>
      </div>
      <ol className="timeline-feed" aria-label={t('replay.feed')}>
        {feed.map((i) => (
          <li key={i}>{lineOf(i)}</li>
        ))}
      </ol>
    </div>
  )
}
