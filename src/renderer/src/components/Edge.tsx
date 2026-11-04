import { useEffect, useState, type CSSProperties } from 'react'

/** Steps of the Edge while a wait lasts: it fills once, never loops (Sogoma). [delay in ms, percentage]. */
const STEPS: [number, number][] = [
  [0, 10],
  [300, 40],
  [1500, 70],
  [4000, 90]
]
/** Time the line takes to reach the end when the wait is over (the state duration of the kit). */
const FINISH_MS = 320

/**
 * The only progress indicator: a 2 px line under the Sky. `label` is read to screen readers once, when the wait starts (the text
 * is removed when it ends, which says nothing). `announce={false}` for a second Edge inside a view: only the one of the shell speaks.
 */
export function Edge({ active, label, announce = true }: { active: boolean; label: string; announce?: boolean }) {
  const [fill, setFill] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timers: number[] = []
    if (active) {
      setVisible(true)
      for (const [delay, value] of STEPS) timers.push(window.setTimeout(() => setFill(value), delay))
    } else {
      setFill(100)
      timers.push(
        window.setTimeout(() => {
          setVisible(false)
          setFill(0)
        }, FINISH_MS)
      )
    }
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [active])

  return (
    <div className="app-edge" role={announce ? 'status' : undefined}>
      <div className="sg-edge" data-idle={visible ? undefined : ''} aria-hidden="true">
        <div className="sg-edge__fill" style={{ '--edge': fill } as CSSProperties} />
      </div>
      {announce && <span className="sg-visually-hidden">{visible ? label : ''}</span>}
    </div>
  )
}
