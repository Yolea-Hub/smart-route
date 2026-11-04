import { useCallback, useEffect, useRef } from 'react'
import { focusElement, VIEW_HEADING } from './a11y'

/**
 * Focus management for a view change (WCAG 2.4.3, 3.2.2). `navigate(next, selector)` sets the key and, once the new view is on screen,
 * puts the focus on its heading (or on `selector`), so that a keyboard or screen-reader user starts reading at the top of the new view
 * and the focus is never left on a button that has just disappeared. Changes made by the app itself (first load, onboarding redirect)
 * use `setKey` directly and never move the focus.
 */
export function useFocusOnNav<K extends string>(key: K, setKey: (k: K) => void): (next: K, selector?: string) => void {
  const pending = useRef<string | null>(null)
  const current = useRef(key)
  current.current = key

  useEffect(() => {
    const selector = pending.current
    if (selector === null) return
    pending.current = null
    focusElement(document, selector)
  }, [key])

  return useCallback(
    (next: K, selector: string = VIEW_HEADING) => {
      if (next === current.current) {
        // Same view: only an explicit target (e.g. « About » inside Settings) moves the focus.
        if (selector !== VIEW_HEADING) window.setTimeout(() => focusElement(document, selector), 0)
        return
      }
      pending.current = selector
      setKey(next)
    },
    [setKey]
  )
}
