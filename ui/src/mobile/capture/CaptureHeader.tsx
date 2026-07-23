interface CaptureHeaderProps {
  step: 1 | 2;
  title: string;
  onClose: () => void;
  leading?: 'close' | 'flash';
  onRetake?: () => void;
}

function StepBadge({
  index,
  active,
  label,
}: {
  index: 1 | 2;
  active: boolean;
  label: string;
}): JSX.Element {
  return (
    <span
      className={`cn-capture__step ${active ? 'is-active' : ''}`}
      data-testid={`capture-step-${index}`}
      aria-current={active ? 'step' : undefined}
    >
      <span className="cn-capture__step-dot" aria-hidden="true">
        {index}
      </span>
      <span className="cn-capture__step-label">{label}</span>
    </span>
  );
}

export function CaptureHeader({
  step,
  title,
  onClose,
  leading = 'close',
  onRetake,
}: CaptureHeaderProps): JSX.Element {
  return (
    <header className="cn-capture__header">
      <div className="cn-capture__header-row">
        {leading === 'flash' ? (
          <button type="button" className="cn-capture__icon-btn" aria-label="פלאש" title="פלאש">
            ⚡
          </button>
        ) : (
          <button
            type="button"
            className="cn-capture__icon-btn"
            aria-label="סגירה"
            title="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        )}

        <div className="cn-capture__title">
          <strong>{title}</strong>
          <small>שלב {step} מתוך 2</small>
        </div>

        {onRetake ? (
          <button type="button" className="cn-capture__header-link" onClick={onRetake}>
            צילום מחדש →
          </button>
        ) : (
          <button
            type="button"
            className="cn-capture__icon-btn"
            aria-label="סגירה"
            title="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>

      <div className="cn-capture__steps" role="list" aria-label="שלבי הצילום">
        <StepBadge index={1} active={step === 1} label="מילים" />
        <span className="cn-capture__step-sep" aria-hidden="true">
          ←
        </span>
        <StepBadge index={2} active={step === 2} label="כרטיס מפתח" />
      </div>
    </header>
  );
}
