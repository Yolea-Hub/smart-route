import { USER_ROLES, type UserRole } from '../../../core/types'
import { useI18n } from '../i18n/i18n'

/** First run: which job? Eight choices and a way to skip. Keeps the choice on this computer (settings), sends nothing. */
export function RoleScreen({ onChoose, onSkip }: { onChoose: (r: UserRole) => void; onSkip: () => void }) {
  const { t } = useI18n()
  return (
    <section aria-labelledby="profile-h" className="view view-narrow">
      <h1 id="profile-h">{t('profile.title')}</h1>
      <p className="lead">{t('profile.sub')}</p>
      <ul className="role-grid" aria-label={t('profile.group')}>
        {USER_ROLES.map((r) => (
          <li key={r}>
            <button type="button" className="sg-card sg-card--raised role-pick" onClick={() => onChoose(r)}>
              <strong>{t(`profile.${r}`)}</strong>
              <span className="muted small">{t(`profile.${r}.hint`)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" className="sg-button sg-button--quiet" onClick={onSkip}>
          {t('profile.skip')}
        </button>
      </div>
    </section>
  )
}
