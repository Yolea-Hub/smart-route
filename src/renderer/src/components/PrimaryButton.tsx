import type { ButtonHTMLAttributes } from 'react'

/** The one primary action of a screen (Sogoma: 48 px, Oasis). Use it once per screen. */
export function PrimaryButton({ children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>) {
  return (
    <button type="button" {...rest} className="sg-button" data-primary>
      {children}
    </button>
  )
}
