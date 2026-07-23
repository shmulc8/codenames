import { BoardGrid } from '../features/board';
import { CheckPanel } from '../features/check';
import { CluePanel } from '../features/clue';
import { SessionLog } from '../features/log';
import { SemanticMap } from '../features/map';
import { OperativePanel } from '../features/operative';
import { PhotoSetup } from '../features/photo';
import { MobileShell, useLayout } from '../mobile/shell';
import { useAppStore } from '../state/store';
import './MainScreen.css';

export function MainScreen(): JSX.Element {
  return useLayout() === 'mobile' ? <MobileShell /> : <DesktopMainScreen />;
}

function DesktopMainScreen(): JSX.Element {
  const screen = useAppStore((state) => state.screen);
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const editBoard = useAppStore((state) => state.editBoard);

  if (screen === 'setup') {
    return (
      <main className="setup-shell" data-testid="setup-screen">
        <PhotoSetup />
      </main>
    );
  }

  return (
    <div className="main-screen">
      <header className="main-screen__header">
        <div>
          <p className="main-screen__eyebrow">שם קוד · מנתח לוח</p>
          <h1>שם קוד קופיילוט</h1>
        </div>
        <div className="main-screen__header-end">
          <div
            className="main-screen__mode"
            role="group"
            aria-label="מצב משחק"
            data-testid="mode-toggle"
          >
            <button
              type="button"
              className="main-screen__mode-option"
              aria-pressed={mode === 'spymaster'}
              data-testid="mode-spymaster"
              onClick={() => setMode('spymaster')}
            >
              רב המרגלים
            </button>
            <button
              type="button"
              className="main-screen__mode-option"
              aria-pressed={mode === 'operative'}
              data-testid="mode-operative"
              onClick={() => setMode('operative')}
            >
              מנחש
            </button>
          </div>
          <button
            type="button"
            className="main-screen__edit-board"
            data-testid="btn-edit-board"
            onClick={editBoard}
          >
            ✏️ ערוך לוח
          </button>
          <a className="main-screen__methods" href="/methods.html" target="_blank" rel="noopener">
            איך זה עובד
          </a>
        </div>
      </header>

      <main className="main-screen__workspace">
        <section className="main-screen__primary" aria-label="לוח ומפה סמנטית">
          <BoardGrid />
          <SemanticMap />
        </section>

        <aside className="main-screen__controls" aria-label="כלי המפעיל">
          {mode === 'operative' ? (
            <OperativePanel />
          ) : (
            <>
              <div className="main-screen__tabs" role="tablist" aria-label="מצב עבודה">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'clue'}
                  className={activeTab === 'clue' ? 'is-active' : undefined}
                  data-testid="tab-clue"
                  onClick={() => setActiveTab('clue')}
                >
                  קבל רמז
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'check'}
                  className={activeTab === 'check' ? 'is-active' : undefined}
                  data-testid="tab-check"
                  onClick={() => setActiveTab('check')}
                >
                  בדוק מילה שלי
                </button>
              </div>

              <section className="main-screen__active-panel" role="tabpanel">
                {activeTab === 'clue' ? <CluePanel /> : <CheckPanel />}
              </section>
            </>
          )}

          <SessionLog />
        </aside>
      </main>
    </div>
  );
}
