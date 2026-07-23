import { mobileClueFocusTeam, useAppStore } from '../../state/store';

function ClueIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9 18h6M10 22h4M8.7 14.6A7 7 0 1 1 15.3 14.6C14.5 15.2 14 16 14 17h-4c0-1-.5-1.8-1.3-2.4Z" />
      <path d="m18.5 5.5 1.4-1.4M5.5 5.5 4.1 4.1M12 3V1" />
    </svg>
  );
}

function RevealIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function BoardActionBar(): JSX.Element | null {
  const count = useAppStore((state) => state.mobileSelection.length);
  const mode = useAppStore((state) => state.mode);
  const clueFocusTeam = useAppStore(mobileClueFocusTeam);
  const clearMobileSelection = useAppStore((state) => state.clearMobileSelection);
  const eliminateMobileSelection = useAppStore((state) => state.eliminateMobileSelection);
  const openMobileClue = useAppStore((state) => state.openMobileClue);

  if (count === 0) return null;

  const clueUnavailable = mode === 'spymaster' && clueFocusTeam === null;

  return (
    <div className="mobile-board-action-context">
      {clueUnavailable ? (
        <p className="mobile-board-action-context__reason" data-testid="board-clue-unavailable">
          בחרו קלפים מאותה קבוצה
        </p>
      ) : null}
      <div
        className="mobile-board-action-bar"
        data-testid="mobile-board-action-bar"
        role="toolbar"
        aria-label="פעולות על הקלפים שנבחרו"
      >
        <button
          type="button"
          className="mobile-board-action-bar__button mobile-board-action-bar__clear"
          data-testid="board-selection-clear"
          aria-label="ניקוי הבחירה"
          onClick={clearMobileSelection}
        >
          <span aria-hidden="true">×</span>
        </button>
        <strong
          className="mobile-board-action-bar__count"
          data-testid="board-selection-count"
          aria-label={`${count} קלפים נבחרו`}
          aria-live="polite"
          aria-atomic="true"
        >
          {count}
        </strong>
        <span className="mobile-board-action-bar__divider" aria-hidden="true" />
        {mode === 'spymaster' ? (
          <button
            type="button"
            className="mobile-board-action-bar__button"
            data-testid="board-action-clue"
            aria-label="יצירת רמז לקלפים שנבחרו"
            disabled={clueUnavailable}
            onClick={openMobileClue}
          >
            <ClueIcon />
          </button>
        ) : null}
        <button
          type="button"
          className="mobile-board-action-bar__button"
          data-testid="board-action-eliminate"
          aria-label="חשיפת הקלפים שנבחרו"
          onClick={eliminateMobileSelection}
        >
          <RevealIcon />
        </button>
      </div>
    </div>
  );
}
