import { useEffect, useState } from 'react';

import { useAppStore } from '../../state/store';

const UNDO_VISIBLE_MS = 5_000;

export function BoardUndoSnackbar(): JSX.Element | null {
  const lastElimination = useAppStore((state) => state.lastElimination);
  const undoLastElimination = useAppStore((state) => state.undoLastElimination);
  const [visible, setVisible] = useState(Boolean(lastElimination));

  useEffect(() => {
    if (!lastElimination) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), UNDO_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [lastElimination]);

  if (!lastElimination || !visible) return null;

  return (
    <div className="mobile-board-undo" data-testid="board-undo-snackbar" role="status">
      <button
        type="button"
        data-testid="board-action-undo"
        aria-label="ביטול חשיפת הקלפים"
        onClick={undoLastElimination}
      >
        <span aria-hidden="true">↩</span>
      </button>
    </div>
  );
}
