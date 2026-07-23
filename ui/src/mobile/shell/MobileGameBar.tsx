import { ThemeToggle } from '../../components';
import { useAppStore } from '../../state/store';

type GameMode = 'spymaster' | 'operative';

interface MobileGameBarProps {
  onModeChange(mode: GameMode): void;
  boardActive: boolean;
}

export function MobileGameBar({ onModeChange, boardActive }: MobileGameBarProps): JSX.Element {
  const mode = useAppStore((state) => state.mode);
  const editBoard = useAppStore((state) => state.editBoard);
  const boardView = useAppStore((state) => state.boardView);
  const setBoardView = useAppStore((state) => state.setBoardView);
  const requestBoardFit = useAppStore((state) => state.requestBoardFit);

  return (
    <header className="mobile-shell__gamebar" data-testid="mobile-gamebar">
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

      <div className="mobile-shell__gamebar-end">
        {boardActive ? (
          <div className="mobile-shell__board-controls" role="group" aria-label="תצוגת הלוח">
            <div className="mobile-shell__view-switch">
              <button
                type="button"
                data-testid="board-view-visual"
                aria-pressed={boardView === 'visual'}
                onClick={() => setBoardView('visual')}
              >
                לוח
              </button>
              <button
                type="button"
                data-testid="board-view-list"
                aria-pressed={boardView === 'list'}
                onClick={() => setBoardView('list')}
              >
                רשימה
              </button>
            </div>
            {boardView === 'visual' ? (
              <button
                type="button"
                className="mobile-shell__fit"
                data-testid="btn-fit-board"
                aria-label="התאימו למסך"
                onClick={requestBoardFit}
              >
                ⌗
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mobile-shell__gamebar-actions">
          <button type="button" data-testid="mobile-edit-board" onClick={editBoard}>
            לוח חדש
          </button>
          <ThemeToggle />
          <a href="/methods.html" target="_blank" rel="noopener" aria-label="איך זה עובד">
            ?
          </a>
        </div>
      </div>
    </header>
  );
}
