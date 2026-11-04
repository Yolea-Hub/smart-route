import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { TOOL_VENDOR } from '../../../core/catalog'
import { stepRoleName, useI18n } from '../i18n/i18n'
import { layoutRoute, NODE_H } from '../constellationLayout'
import { formatElapsed, type NodeState } from '../runState'
import { useReducedMotion } from '../useReducedMotion'
import { ConstellationParticles } from './ConstellationParticles'
import { VendorLogo } from './VendorLogo'

interface Props {
  nodes: NodeState[]
  /** Clock for the elapsed time of a working node (ms). */
  now?: number
  /** Show the elapsed time under each node (live run); off in the plan preview and in the replay. */
  showElapsed?: boolean
  /** The nodes appear one after the other (plan preview). */
  reveal?: boolean
}

/** The verdict seal of a review step: a stamp whose shape differs (round with a tick, or square with a cross), words in the title. */
function Seal({ pass, label }: { pass: boolean; label: string }) {
  return (
    <svg className={`rc-seal ${pass ? 'is-pass' : 'is-fail'}`} width="28" height="28" viewBox="-14 -14 28 28" role="img" aria-label={label}>
      <title>{label}</title>
      {pass ? <circle r="11" /> : <rect x="-10" y="-10" width="20" height="20" rx="3" />}
      <path d={pass ? 'M -5 0 L -1.5 3.5 L 5 -4' : 'M -4 -4 L 4 4 M 4 -4 L -4 4'} />
    </svg>
  )
}

/**
 * The route of a task: one node per step (1 to 8), on a horizontal route from 600 px and a vertical one below. A node that works gets
 * its vendor's ring and glow on its container, and particles run along the edge that leads to it. A verdict is a seal on the reviewer,
 * an escalation is a branch. Under reduced motion: a static ring, no particles. The vendor logo itself is never touched.
 */
export function RouteConstellation({ nodes, now = 0, showElapsed = false, reveal = false }: Props) {
  const { t, lang } = useI18n()
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  /** Height of the tallest node, measured: a name that wraps makes its node taller instead of being cut (WCAG 1.4.4, 1.4.10). */
  const [nodeH, setNodeH] = useState(NODE_H)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const shape = nodes.map((n) => `${n.step.id}>${n.escalatedFrom ?? ''}`).join('|')
  const layout = useMemo(
    () => layoutRoute(nodes.map((n) => ({ id: n.step.id, escalatedFrom: n.escalatedFrom })), width || 360, nodeH),
    // The layout depends on the ids, on the width and on the measured node height only; nodes change their status many times a second.
    [shape, width, nodeH]
  )
  // After every render: how tall does each node want to be at the minimum height? (Set to the floor, read, restored: no flash.)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('.rc-node'))
    const saved = items.map((n) => n.style.minHeight)
    for (const n of items) n.style.minHeight = `${NODE_H}px`
    const wanted = items.reduce((m, n) => Math.max(m, n.offsetHeight), NODE_H)
    items.forEach((n, i) => {
      n.style.minHeight = saved[i] as string
    })
    if (wanted !== nodeH) setNodeH(wanted)
  })

  const byId = new Map(nodes.map((n) => [n.step.id, n]))
  const statusLabel = (n: NodeState): string => t(n.status === 'waiting' ? 'run.node.handoff' : `run.node.${n.status}`)
  const summary = nodes.map((n) => `${t(`tool.${n.step.tool}`)}: ${statusLabel(n)}`).join('; ')

  return (
    <div className={`rc rc--${layout.orientation}`} ref={wrap} role="group" aria-label={`${t('run.graph')}. ${summary}`} style={{ height: layout.height }}>
      <svg className="rc-edges" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false">
        {layout.edges.map((e) => {
          const from = byId.get(e.from)
          const to = byId.get(e.to)
          if (!from || !to) return null
          const live = to.status === 'running' || to.status === 'waiting'
          const state = e.branch ? 'branch' : from.status === 'ok' && live ? 'flow' : from.status === 'ok' && to.status !== 'pending' ? 'done' : 'idle'
          return (
            <g key={`${e.from}>${e.to}`} className={`v-${TOOL_VENDOR[to.step.tool]}`}>
              {state === 'flow' && <path d={e.d} className="rc-edge-key" />}
              <path d={e.d} className={`rc-edge rc-edge--${state}`} />
              {(state === 'flow' || (e.branch && live)) && !reduced && <ConstellationParticles key={e.to} d={e.d} />}
            </g>
          )
        })}
      </svg>
      <ol className="rc-list">
        {layout.nodes.map((p) => {
          const n = byId.get(p.id)
          if (!n) return null
          const vendor = TOOL_VENDOR[n.step.tool]
          const live = n.status === 'running' || n.status === 'waiting'
          const verdict = n.result?.verdict
          const elapsed = showElapsed && n.startedAt ? formatElapsed((n.endedAt ?? now) - n.startedAt) : ''
          const style: CSSProperties = { left: p.x, top: p.y, width: p.w, minHeight: p.h }
          if (reveal) style.animationDelay = `calc(var(--duration-micro) * ${p.index})`
          return (
            <li
              key={p.id}
              className={`rc-node v-${vendor} s-${n.status}${live ? ' is-live' : ''}${p.branch ? ' is-branch' : ''}${reveal ? ' is-reveal' : ''}`}
              style={style}
              aria-current={live ? 'step' : undefined}
            >
              {n.escalatedFrom && <span className="rc-tag">{t('run.escalated', { tier: t(`tier.${n.step.model.tier}`) })}</span>}
              <div className="rc-head">
                <VendorLogo vendor={vendor} tool={n.step.tool} size={28} short />
                <span className="rc-role">{stepRoleName(lang, n.step)}</span>
                {elapsed && <span className="rc-elapsed">{elapsed}</span>}
              </div>
              <p className="rc-tool">{t(`tool.${n.step.tool}`)}</p>
              <p className="rc-model">{n.step.model.label}</p>
              <p className="rc-status">
                {t(`tier.${n.step.model.tier}`)} · {statusLabel(n)}
              </p>
              {verdict && <Seal pass={verdict.pass} label={verdict.pass ? t('run.verdict.pass') : t('run.verdict.fail')} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
