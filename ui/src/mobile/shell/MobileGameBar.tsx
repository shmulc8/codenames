import { useAppStore } from '../../state/store';

type GameMode = 'spymaster' | 'operative';

interface MobileGameBarProps {
  onModeChange(mode: GameMode): void;
}

export function MobileGameBar({ onModeChange }: MobileGameBarProps): JSX.Element {
  const mode = useAppStore((state) => state.mode);
  const editBoard = useAppStore((state) => state.editBoard);

  return (
    <header className="mobile-shell__gamebar" data-testid="mobile-gamebar">
      <strong className="mobile-shell__gamebar-brand">שם קוד</strong>

      <div className="mobile-shell__mode" role="group" aria-label="מצב משחק">
        <button
          type="button"
          data-testid="mobile-mode-spymaster"
          aria-pressed={mode === 'spymaster'}
          onClick={() => onModeChange('spymaster')}
        >
          רב־מרגלים
        </button>
        <button
          type="button"
          data-testid="mobile-mode-operative"
          aria-pressed={mode === 'operative'}
          onClick={() => onModeChange('operative')}
        >
          מנחש
        </button>
      </div>

      <div className="mobile-shell__gamebar-actions">
        <button type="button" data-testid="mobile-edit-board" onClick={editBoard}>
          לוח חדש
        </button>
        <a href="/methods" target="_blank" rel="noopener" aria-label="איך זה עובד">
          ?
        </a>
      </div>
    </header>
  );
}
