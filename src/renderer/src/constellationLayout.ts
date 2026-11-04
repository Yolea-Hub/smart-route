// Geometry of the route constellation: pure, so that it is tested without a browser.

export const NODE_W = 192
export const NODE_H = 148
const GAP_X = 48
const GAP_X_MAX = 96
const GAP_Y = 44
const PAD = 16
const BRANCH_DX = 28
/** GRILLE: from 600 px the route runs horizontally (tablet and above), below it runs vertically. */
export const HORIZONTAL_FROM = 600

export interface LayoutInput {
  id: string
  /** Set on a step added by escalation: it hangs as a branch under the step it came from. */
  escalatedFrom?: string
}
export interface PlacedNode {
  id: string
  index: number
  x: number
  y: number
  w: number
  h: number
  row: number
  branch: boolean
}
export interface PlacedEdge {
  from: string
  to: string
  d: string
  branch: boolean
}
export interface RouteLayout {
  orientation: 'horizontal' | 'vertical'
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  width: number
  height: number
}

function curve(a: PlacedNode, b: PlacedNode, sameRow: boolean, gap: number): string {
  if (sameRow) {
    const x1 = a.x + a.w
    const y1 = a.y + a.h / 2
    const x2 = b.x
    const y2 = b.y + b.h / 2
    const c = Math.max(8, (x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`
  }
  const x1 = a.x + a.w / 2
  const y1 = a.y + a.h
  const x2 = b.x + b.w / 2
  const y2 = b.y
  const c = Math.max(12, gap / 2)
  return `M ${x1} ${y1} C ${x1} ${y1 + c}, ${x2} ${y2 - c}, ${x2} ${y2}`
}

/**
 * Place 1 to 8 steps (and their escalation branches) in a box `width` px wide. `nodeH` is the height of every node: NODE_H at least,
 * more when a name wraps on several lines (the caller measures it: text is never cut off at a larger text size or a narrow width).
 */
export function layoutRoute(input: LayoutInput[], width: number, nodeH: number = NODE_H): RouteLayout {
  const NODE_H_ = Math.max(NODE_H, Math.ceil(nodeH))
  const orientation = width >= HORIZONTAL_FROM ? 'horizontal' : 'vertical'
  const main = input.filter((n) => !n.escalatedFrom)
  const branches = input.filter((n) => n.escalatedFrom && main.some((m) => m.id === n.escalatedFrom))
  const orphans = input.filter((n) => n.escalatedFrom && !main.some((m) => m.id === n.escalatedFrom))
  const sequence = [...main, ...orphans] // an escalation whose source is unknown is shown as a normal step
  const placed: PlacedNode[] = []
  const edges: PlacedEdge[] = []
  const at = (id: string): PlacedNode | undefined => placed.find((p) => p.id === id)

  if (orientation === 'vertical') {
    const w = Math.max(120, Math.min(width - PAD * 2, 360))
    let y = PAD
    let row = 0
    for (const m of sequence) {
      placed.push({ id: m.id, index: placed.length, x: PAD, y, w, h: NODE_H_, row, branch: false })
      y += NODE_H_ + GAP_Y
      row++
      for (const b of branches.filter((x) => x.escalatedFrom === m.id)) {
        placed.push({ id: b.id, index: placed.length, x: PAD + BRANCH_DX, y, w: w - BRANCH_DX, h: NODE_H_, row, branch: true })
        y += NODE_H_ + GAP_Y
        row++
      }
    }
    for (let i = 1; i < sequence.length; i++) {
      const a = at(sequence[i - 1].id) as PlacedNode
      // The step after a branched one continues from the original step, not from its branch.
      edges.push({ from: a.id, to: sequence[i].id, d: curve(a, at(sequence[i].id) as PlacedNode, false, GAP_Y), branch: false })
    }
    for (const b of branches) {
      const from = at(b.escalatedFrom as string) as PlacedNode
      edges.push({ from: from.id, to: b.id, d: curve(from, at(b.id) as PlacedNode, false, GAP_Y), branch: true })
    }
    return { orientation, nodes: placed, edges, width, height: Math.max(PAD * 2, y - GAP_Y + PAD) }
  }

  const avail = Math.max(NODE_W, width - PAD * 2)
  const perRow = Math.max(1, Math.floor((avail + GAP_X) / (NODE_W + GAP_X)))
  const k = Math.min(perRow, Math.max(1, sequence.length))
  const gap = k > 1 ? Math.min(GAP_X_MAX, Math.max(GAP_X, (avail - k * NODE_W) / (k - 1))) : 0
  sequence.forEach((m, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    placed.push({ id: m.id, index: i, x: PAD + col * (NODE_W + gap), y: PAD + row * (NODE_H_ + GAP_Y), w: NODE_W, h: NODE_H_, row, branch: false })
  })
  const rows = Math.max(1, Math.ceil(sequence.length / perRow))
  const branchY = PAD + rows * (NODE_H_ + GAP_Y)
  const counts = new Map<string, number>()
  for (const b of branches) {
    const from = at(b.escalatedFrom as string) as PlacedNode
    const n = counts.get(from.id) ?? 0
    counts.set(from.id, n + 1)
    const x = Math.max(PAD, Math.min(from.x + n * (NODE_W + gap), width - PAD - NODE_W))
    placed.push({ id: b.id, index: placed.length, x, y: branchY, w: NODE_W, h: NODE_H_, row: rows, branch: true })
  }
  for (let i = 1; i < sequence.length; i++) {
    const a = at(sequence[i - 1].id) as PlacedNode
    const b = at(sequence[i].id) as PlacedNode
    edges.push({ from: a.id, to: b.id, d: curve(a, b, a.row === b.row, GAP_Y), branch: false })
  }
  for (const b of branches) {
    const from = at(b.escalatedFrom as string) as PlacedNode
    edges.push({ from: from.id, to: b.id, d: curve(from, at(b.id) as PlacedNode, false, GAP_Y), branch: true })
  }
  const totalRows = rows + (branches.length > 0 ? 1 : 0)
  return { orientation, nodes: placed, edges, width, height: PAD * 2 + totalRows * NODE_H_ + (totalRows - 1) * GAP_Y }
}
