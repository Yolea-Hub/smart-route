import type { VendorAccountStatus, Vendor } from '../../../core/types'
import { VENDORS } from '../../../core/types'
import { useI18n } from '../i18n/i18n'
import { VendorBadge } from './VendorLogo'

type Level = 'ok' | 'partial' | 'unknown' | 'off'

export function levelOf(s: VendorAccountStatus | undefined): Level {
  if (!s) return 'off'
  if (s.cli.state === 'connected') return 'ok'
  if (s.cli.state === 'unknown') return 'unknown'
  if (s.webSignedIn) return 'partial'
  return 'off'
}

/**
 * Sogoma Status: the shape of the mark differs per state (solid round, dashed round, dashed square, dotted round) and the word is
 * always there. « Web only » and « check impossible » are both dashed in the kit; the latter is squared by `data-level`.
 */
export const SHAPE: Record<Level | 'checking', 'ok' | 'surveillance' | 'unknown'> = {
  ok: 'ok',
  partial: 'surveillance',
  unknown: 'surveillance',
  off: 'unknown',
  checking: 'unknown'
}

/** The words of an account state; shared by the header bar and the home strip. */
export function useStateText(): (s: VendorAccountStatus | undefined, level: Level | 'checking') => string {
  const { t } = useI18n()
  return (s, level) =>
    level === 'checking'
      ? t('health.checking')
      : level === 'ok'
        ? t('health.connected')
        : level === 'unknown'
          ? t('health.unknown')
          : level === 'partial'
            ? t('health.partial')
            : s?.cli.state === 'not_installed'
              ? t('health.notInstalled')
              : t('health.disconnected')
}

/** Account health bar: one Status per vendor, with its logo. `checking` shows the waiting shape; the caller ends it after the Edge ceiling. */
export function AccountDots({ statuses, checking = false, onOpen }: { statuses: VendorAccountStatus[]; checking?: boolean; onOpen: () => void }) {
  const { t } = useI18n()
  const text = useStateText()
  return (
    <button type="button" className="dots" onClick={onOpen}>
      {/* The name of the button is its content: the label, then each visible vendor name with its state in words. */}
      <span className="sg-visually-hidden">{t('health.label')}</span>
      {VENDORS.map((v: Vendor) => {
        const s = statuses.find((x) => x.vendor === v)
        const level: Level | 'checking' = checking ? 'checking' : s ? levelOf(s) : 'unknown'
        return (
          <span key={v} className={`sg-status dot-item v-${v}`} data-status={SHAPE[level]} data-level={level}>
            <span className="sg-status__mark" aria-hidden="true" />
            <VendorBadge vendor={v} size={20} nameClass="dot-name" />
            <span className="dot-state">{text(s, level)}</span>
          </span>
        )
      })}
    </button>
  )
}
