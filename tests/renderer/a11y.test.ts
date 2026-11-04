import { describe, expect, it, vi } from 'vitest'
import { describedBy, focusElement, isEscapeKey, nextGroupIndex, VIEW_HEADING, type FocusableLike } from '../../src/renderer/src/a11y'
import { PARTICLES_TOTAL_S, PASS_S, PASSES, STAGGER_S } from '../../src/renderer/src/particleTiming'

function fakeEl(attrs: Record<string, string> = {}) {
  const focus = vi.fn<() => void>()
  return {
    attrs,
    focus,
    hasAttribute: (n: string) => n in attrs,
    setAttribute: (n: string, v: string) => void (attrs[n] = v)
  } satisfies FocusableLike & { attrs: Record<string, string> }
}

describe('focusElement (view change)', () => {
  it('focuses the heading and makes it focusable by script only (tabindex -1)', () => {
    const h1 = fakeEl()
    const root = { querySelector: vi.fn((sel: string) => (sel === VIEW_HEADING ? h1 : null)) }
    expect(focusElement(root, VIEW_HEADING)).toBe(true)
    expect(h1.attrs.tabindex).toBe('-1')
    expect(h1.focus).toHaveBeenCalledTimes(1)
  })

  it('keeps the tabindex an element already has', () => {
    const el = fakeEl({ tabindex: '0' })
    expect(focusElement({ querySelector: () => el }, '#about')).toBe(true)
    expect(el.attrs.tabindex).toBe('0')
  })

  it('does nothing and says so when nothing matches', () => {
    expect(focusElement({ querySelector: () => null }, '#nope')).toBe(false)
  })
})

describe('isEscapeKey', () => {
  it('accepts Escape (and the old Esc), nothing else', () => {
    expect(isEscapeKey({ key: 'Escape' })).toBe(true)
    expect(isEscapeKey({ key: 'Esc' })).toBe(true)
    expect(isEscapeKey({ key: 'Enter' })).toBe(false)
    expect(isEscapeKey({ key: 'e' })).toBe(false)
  })
})

describe('nextGroupIndex (tool picker keys)', () => {
  it('arrows move by one and wrap', () => {
    expect(nextGroupIndex('ArrowRight', 0, 6)).toBe(1)
    expect(nextGroupIndex('ArrowDown', 5, 6)).toBe(0)
    expect(nextGroupIndex('ArrowLeft', 0, 6)).toBe(5)
    expect(nextGroupIndex('ArrowUp', 3, 6)).toBe(2)
  })
  it('Home and End jump to the ends', () => {
    expect(nextGroupIndex('Home', 4, 6)).toBe(0)
    expect(nextGroupIndex('End', 1, 6)).toBe(5)
  })
  it('other keys are left alone (null), and an empty group never answers', () => {
    expect(nextGroupIndex('Tab', 1, 6)).toBeNull()
    expect(nextGroupIndex('a', 1, 6)).toBeNull()
    expect(nextGroupIndex('Home', 0, 0)).toBeNull()
  })
})

describe('describedBy', () => {
  it('joins the ids that exist and gives undefined (no empty attribute) when there is none', () => {
    expect(describedBy('hint', false, 'err')).toBe('hint err')
    expect(describedBy(false, null, undefined, '')).toBeUndefined()
    expect(describedBy('only')).toBe('only')
  })
})

describe('particles (WCAG 2.2.2)', () => {
  it('the whole movement ends before 5 seconds', () => {
    expect(PARTICLES_TOTAL_S).toBeCloseTo(2 * STAGGER_S + PASSES * PASS_S)
    expect(PARTICLES_TOTAL_S).toBeLessThan(5)
    expect(PASSES).toBeGreaterThan(0)
  })
})
