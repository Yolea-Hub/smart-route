import { describe, expect, it } from 'vitest'
import { HORIZONTAL_FROM, NODE_H, NODE_W, layoutRoute } from '../../src/renderer/src/constellationLayout'

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }))

describe('layoutRoute', () => {
  it('runs horizontally from 600 px and vertically below', () => {
    expect(layoutRoute(ids(3), HORIZONTAL_FROM).orientation).toBe('horizontal')
    expect(layoutRoute(ids(3), HORIZONTAL_FROM - 1).orientation).toBe('vertical')
    expect(layoutRoute(ids(3), 360).orientation).toBe('vertical')
  })

  it('three steps fit in one row at 1000 px, in order, left to right, without overlap', () => {
    const l = layoutRoute(ids(3), 1000)
    expect(new Set(l.nodes.map((n) => n.y)).size).toBe(1)
    const xs = l.nodes.map((n) => n.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    for (let i = 1; i < l.nodes.length; i++) expect(l.nodes[i]!.x).toBeGreaterThanOrEqual(l.nodes[i - 1]!.x + NODE_W)
    expect(l.nodes.at(-1)!.x + NODE_W).toBeLessThanOrEqual(1000)
    expect(l.edges).toHaveLength(2)
    expect(l.height).toBeGreaterThanOrEqual(NODE_H)
  })

  it('eight steps at the narrowest horizontal width wrap onto rows that stay inside the box', () => {
    const l = layoutRoute(ids(8), 600)
    expect(l.nodes).toHaveLength(8)
    expect(Math.max(...l.nodes.map((n) => n.row))).toBeGreaterThanOrEqual(2)
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x + n.w).toBeLessThanOrEqual(600)
      expect(n.y + n.h).toBeLessThanOrEqual(l.height)
    }
    expect(l.edges).toHaveLength(7)
    // no two nodes share a place
    const spots = new Set(l.nodes.map((n) => `${n.x},${n.y}`))
    expect(spots.size).toBe(8)
  })

  it('vertical: one column, every node fits the box, a single step is valid', () => {
    const l = layoutRoute(ids(4), 360)
    expect(new Set(l.nodes.map((n) => n.x)).size).toBe(1)
    for (const n of l.nodes) expect(n.x + n.w).toBeLessThanOrEqual(360)
    const ys = l.nodes.map((n) => n.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(layoutRoute(ids(1), 360).edges).toHaveLength(0)
    expect(layoutRoute(ids(1), 1000).nodes).toHaveLength(1)
  })

  it('an escalation hangs as a branch under the route (horizontal) or right after its source (vertical)', () => {
    const input = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's2b', escalatedFrom: 's2' }]
    const h = layoutRoute(input, 1000)
    const branch = h.nodes.find((n) => n.id === 's2b')!
    expect(branch.branch).toBe(true)
    expect(branch.y).toBeGreaterThan(Math.max(...h.nodes.filter((n) => !n.branch).map((n) => n.y)))
    expect(h.edges.filter((e) => e.branch)).toEqual([expect.objectContaining({ from: 's2', to: 's2b' })])
    expect(h.edges.filter((e) => !e.branch)).toHaveLength(2)
    expect(branch.y + branch.h).toBeLessThanOrEqual(h.height)

    const v = layoutRoute(input, 360)
    const order = v.nodes.map((n) => n.id)
    expect(order.indexOf('s2b')).toBe(order.indexOf('s2') + 1)
    expect(v.nodes.find((n) => n.id === 's2b')!.x).toBeGreaterThan(v.nodes.find((n) => n.id === 's2')!.x)
  })

  it('an escalation whose source is unknown is drawn as a normal step instead of disappearing', () => {
    const l = layoutRoute([{ id: 's1' }, { id: 'x', escalatedFrom: 'gone' }], 1000)
    expect(l.nodes.map((n) => n.id)).toEqual(['s1', 'x'])
    expect(l.nodes[1]!.branch).toBe(false)
  })

  it('every edge is a path that starts and ends on its nodes', () => {
    const l = layoutRoute(ids(5), 700)
    for (const e of l.edges) {
      expect(e.d).toMatch(/^M [\d.]+ [\d.]+ C /)
    }
  })
})

describe('layoutRoute with a measured node height', () => {
  it('uses the measured height for every node, row and the total height (a wrapped name makes a taller node)', () => {
    const tall = NODE_H + 60
    for (const width of [360, 1000]) {
      const l = layoutRoute(ids(3), width, tall)
      for (const n of l.nodes) expect(n.h).toBe(tall)
      const plain = layoutRoute(ids(3), width)
      expect(l.height).toBeGreaterThan(plain.height - 1)
    }
  })

  it('never goes below the floor, and stacked nodes do not overlap at the measured height', () => {
    expect(layoutRoute(ids(2), 360, 10).nodes.every((n) => n.h === NODE_H)).toBe(true)
    const l = layoutRoute(ids(3), 360, 200)
    for (let i = 1; i < l.nodes.length; i++) expect(l.nodes[i]!.y).toBeGreaterThanOrEqual(l.nodes[i - 1]!.y + 200)
    expect(layoutRoute(ids(3), 360, 200).height).toBeGreaterThanOrEqual(3 * 200)
  })
})
