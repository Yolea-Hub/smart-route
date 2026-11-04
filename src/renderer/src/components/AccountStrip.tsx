import { VENDORS } from '../../../core/types'
import type { VendorAccountStatus } from '../../../core/types'
import { useI18n } from '../i18n/i18n'
import { levelOf, SHAPE, useStateText } from './AccountDots'
import { VendorBadge } from './VendorLogo'

/** Live status strip for the home view: one Status per vendor with its logo, the state in words. */
export function AccountStrip({ statuses, checking, onOpen }: { statuses: VendorAccountStatus[]; checking: boolean; onOpen: () => void }) {
  const { t } = useI18n()
  const text = useStateText()
  return (
    <ul className="strip" aria-label={t('task.strip')}>
      {VENDORS.map((v) => {
        const s = statuses.find((x) => x.vendor === v)
        const level = checking ? 'checking' : s ? levelOf(s) : 'unknown'
        return (
          <li key={v}>
            <button type="button" className={`strip-item v-${v}`} onClick={onOpen}>
              <VendorBadge vendor={v} size={28} nameClass="strip-name" />
              <span className="sg-status" data-status={SHAPE[level]} data-level={level}>
                <span className="sg-status__mark" aria-hidden="true" />
                <span className="strip-state">{text(s, level)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
