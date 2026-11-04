import { useEffect, useState } from 'react'

/** True when the person asked the system for less motion: the constellation then shows a static ring and no particles. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = (): void => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
