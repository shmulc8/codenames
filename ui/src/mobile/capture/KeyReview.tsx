import { RoleIcon } from '../../components/RoleIcon';
import type { Role } from '../../types/api';
import { CaptureHeader } from './CaptureHeader';
import { ReviewFooter } from './ReviewFooter';
import { isValidKey, roleCounts } from './keyGrid';

interface KeyReviewProps {
  roles: Role[];
  onCycle: (index: number) => void;
  onRotate: () => void;
  onUse: () => void;
  onRetake: () => void;
  onGallery: (file: File) => void;
  onClose: () => void;
}

const ROLE_LABEL: Record<Role, string> = {
  red: 'אדום',
  blue: 'כחול',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
};

const ROLE_ORDER: Role[] = ['red', 'blue', 'neutral', 'assassin'];

export function KeyReview({
  roles,
  onCycle,
  onRotate,
  onUse,
  onRetake,
  onGallery,
  onClose,
}: KeyReviewProps): JSX.Element {
  const valid = isValidKey(roles);
  const counts = roleCounts(roles);

  return (
    <section className="cn-capture__review">
      <CaptureHeader
        step={2}
        title="בדקו את המפתח"
        onClose={onClose}
        onRetake={onRetake}
      />

      <div className="cn-capture__review-body">
        <div className="cn-capture__key-status">
          <span className={`cn-capture__key-flag ${valid ? 'is-valid' : ''}`}>
            {valid ? '9·8·7·1 מפתח תקין' : 'חלוקת המפתח עדיין לא 9·8·7·1'}
          </span>
          <button
            type="button"
            className="btn btn-secondary cn-capture__rotate"
            onClick={onRotate}
          >
            סובב ↻
          </button>
        </div>

        <div className="cn-capture__counts" aria-label="ספירת תפקידי המפתח">
          {ROLE_ORDER.map((role) => (
            <span className={`cn-capture__count role-${role}`} key={role}>
              <RoleIcon role={role} /> {ROLE_LABEL[role]} {counts[role]}
            </span>
          ))}
        </div>

        <div className="cn-capture__grid cn-capture__grid--roles" data-testid="review-grid">
          {roles.map((role, index) => (
            <button
              key={index}
              type="button"
              data-testid={`review-cell-${index}`}
              data-role={role}
              className={`cn-capture__cell cn-capture__cell--role role-${role}`}
              aria-label={`תא ${index + 1}, תפקיד ${ROLE_LABEL[role]}; לחצו להחלפה`}
              onClick={() => onCycle(index)}
            >
              <RoleIcon role={role} />
            </button>
          ))}
        </div>

        <p className="cn-capture__hint">👆 הקישו על תא כדי להחליף תפקיד</p>
      </div>

      <ReviewFooter
        canUse={valid}
        onUse={onUse}
        onRetake={onRetake}
        onGallery={onGallery}
      />
    </section>
  );
}
