// Small pure helpers for the accessibility behaviour of the interface (focus moves, keys, ids). No React here, so they are tested without a browser.

/** The little of an element that `focusElement` needs (a real DOM element satisfies it). */
export interface FocusableLike {
  focus(options?: { preventScroll?: boolean }): void
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
}
export interface QueryRootLike {
  querySelector(selector: string): FocusableLike | null
}

/** Selector of the heading that receives the focus when a view opens. */
export const VIEW_HEADING = 'main h1'

/**
 * Put the keyboard focus on the first element matching `selector`. A heading or a section is not focusable by default:
 * it gets `tabindex="-1"` (focusable by script, not part of the Tab order). Returns false when nothing matched.
 */
export function focusElement(root: QueryRootLike, selector: string): boolean {
  const el = root.querySelector(selector)
  if (!el) return false
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.focus()
  return true
}

/** True for the Escape key (old engines say « Esc »). */
export function isEscapeKey(e: { key: string }): boolean {
  return e.key === 'Escape' || e.key === 'Esc'
}

/**
 * Next index in a one-choice group of `count` items after `key`: arrows move by one and wrap, Home and End jump to the ends.
 * Returns null for any other key (the caller leaves the key alone).
 */
export function nextGroupIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  const dir = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0
  if (dir === 0) return null
  return (index + dir + count) % count
}

/** Join the ids of the elements that describe a control; undefined when there are none (no empty attribute). */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((x): x is string => typeof x === 'string' && x !== '')
  return list.length > 0 ? list.join(' ') : undefined
}
