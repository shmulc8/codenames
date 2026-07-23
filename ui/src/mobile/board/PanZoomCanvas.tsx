import { useRef, useState } from 'react';

import { RoleIcon } from '../../components/RoleIcon';
import { useAppStore } from '../../state/store';
import { showToast } from '../../state/toast';
import { BoardActionBar } from './BoardActionBar';
import { BoardUndoSnackbar } from './BoardUndoSnackbar';
import { roleLabel } from './board-model';
import { MobileBoardTile } from './MobileBoardTile';
import { usePanZoom } from './usePanZoom';
import './mobile-board.css';

export function PanZoomCanvas(): JSX.Element {
  const tiles = useAppStore((state) => state.tiles);
  const mode = useAppStore((state) => state.mode);
  const mobileSelection = useAppStore((state) => state.mobileSelection);
  const toggleLifecycle = useAppStore((state) => state.toggleLifecycle);
  const toggleMobileSelection = useAppStore((state) => state.toggleMobileSelection);
  const [viewMode, setViewMode] = useState<'visual' | 'list'>('visual');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panZoom = usePanZoom(viewportRef);

  const assassinRevealed = tiles.some(
    (tile) => tile.role === 'assassin' && tile.lifecycle === 'chosen',
  );

  function handleListTile(word: string, chosen: boolean): void {
    if (chosen) {
      toggleLifecycle(word);
      showToast('הקלף הוחזר למשחק', { duration: 2200, tone: 'success' });
      return;
    }

    toggleMobileSelection(word);
  }

  return (
    <section className="mobile-board" data-testid="board-canvas" dir="rtl" aria-label="לוח המשחק">
      <header className={`mobile-board__toolbar${viewMode === 'visual' ? ' is-visual' : ''}`}>
        {viewMode === 'list' ? (
          <div>
            <h1>הלוח</h1>
            <p>
              {tiles.length > 0
                ? mode === 'operative'
                  ? `${tiles.length} קלפים · הצבעים מוסתרים`
                  : `${tiles.length} קלפים · לפי כרטיס המפתח`
                : 'מכינים את הלוח…'}
            </p>
          </div>
        ) : null}
        <div className="mobile-board__toolbar-actions">
          <div className="mobile-board__view-switch" role="group" aria-label="תצוגת הלוח">
            <button
              type="button"
              className={viewMode === 'visual' ? 'is-active' : ''}
              data-testid="board-view-visual"
              aria-pressed={viewMode === 'visual'}
              onClick={() => setViewMode('visual')}
            >
              לוח
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'is-active' : ''}
              data-testid="board-view-list"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              רשימה
            </button>
          </div>
          {viewMode === 'visual' ? (
            <button
              type="button"
              className="mobile-board__fit"
              data-testid="btn-fit-board"
              onClick={panZoom.resetToFit}
            >
              <span aria-hidden="true">⌗</span>
              התאימו למסך
            </button>
          ) : null}
        </div>
      </header>

      {assassinRevealed ? (
        <div className="mobile-board__game-over" role="alert">
          <RoleIcon role="assassin" /> המתנקש נחשף — סוף משחק
        </div>
      ) : null}

      {viewMode === 'visual' ? (
        <>
          <div
            className={`mobile-board__viewport${panZoom.gesturing ? ' is-gesturing' : ''}`}
            ref={viewportRef}
            onClickCapture={panZoom.clickCapture}
            onPointerDown={panZoom.pointerDown}
            onPointerMove={panZoom.pointerMove}
            onPointerUp={panZoom.pointerUp}
            onPointerCancel={panZoom.pointerCancel}
          >
            {tiles.length === 0 ? (
              <div className="mobile-board__loading" role="status">
                <span
                  className="cn-loading-spinner"
                  data-testid="loading-spinner"
                  aria-hidden="true"
                />
                טוענים את קלפי הלוח…
              </div>
            ) : (
              <div
                className="mobile-board__transform"
                data-board-transform="true"
                data-at-fit={panZoom.atFit ? 'true' : 'false'}
                style={{
                  transform: `translate3d(${panZoom.transform.x}px, ${panZoom.transform.y}px, 0) scale(${panZoom.transform.scale})`,
                }}
              >
                <div className="mobile-board__grid">
                  {tiles.map((tile, index) => (
                    <MobileBoardTile
                      index={index}
                      key={tile.word}
                      selectedIndex={mobileSelection.indexOf(tile.word)}
                      tile={tile}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mobile-board__list" data-testid="board-card-list">
          {tiles.length === 0 ? (
            <div className="mobile-board__list-empty" role="status">
              טוענים את קלפי הלוח…
            </div>
          ) : (
            <ul>
              {tiles.map((tile, index) => {
                const hideRole = mode === 'operative' && tile.lifecycle === 'inPlay';
                const displayRole = hideRole ? 'neutral' : (tile.chosenBy ?? tile.role);
                const selectedIndex = mobileSelection.indexOf(tile.word);
                return (
                  <li key={tile.word}>
                    <button
                      type="button"
                      className={`role-${displayRole}${tile.lifecycle === 'chosen' ? ' is-chosen' : ''}${selectedIndex >= 0 ? ' is-selected' : ''}`}
                      data-testid={`board-list-item-${index}`}
                      aria-pressed={selectedIndex >= 0}
                      onClick={() => handleListTile(tile.word, tile.lifecycle === 'chosen')}
                    >
                      <span className="mobile-board__list-icon" aria-hidden="true">
                        {!hideRole ? <RoleIcon role={displayRole} /> : null}
                      </span>
                      <span className="mobile-board__list-copy">
                        <strong>{tile.word}</strong>
                        <small>
                          {hideRole ? 'צבע מוסתר' : roleLabel[displayRole]}
                          {tile.lifecycle === 'chosen' ? ' · נחשף' : ''}
                        </small>
                      </span>
                      <span className="mobile-board__list-action" aria-hidden="true">
                        {selectedIndex >= 0 ? selectedIndex + 1 : '‹'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <BoardActionBar />
      <BoardUndoSnackbar />
    </section>
  );
}
