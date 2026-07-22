import { useRef, useState } from 'react';

import { RoleIcon } from '../../components/RoleIcon';
import { useAppStore } from '../../state/store';
import { roleLabel } from './board-model';
import { MarkRevealedSheet } from './MarkRevealedSheet';
import { MobileBoardTile } from './MobileBoardTile';
import { usePanZoom } from './usePanZoom';
import './mobile-board.css';

export function PanZoomCanvas(): JSX.Element {
  const tiles = useAppStore((state) => state.tiles);
  const selected = useAppStore((state) => state.selected);
  const [focusedWord, setFocusedWord] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panZoom = usePanZoom(viewportRef, setFocusedWord);

  const assassinRevealed = tiles.some(
    (tile) => tile.role === 'assassin' && tile.lifecycle === 'chosen',
  );

  return (
    <section className="mobile-board" data-testid="board-canvas" dir="rtl" aria-label="לוח המשחק">
      <header className="mobile-board__toolbar">
        <div>
          <h1>הלוח</h1>
          <p>{tiles.length > 0 ? `${tiles.length} קלפים · לפי כרטיס המפתח` : 'מכינים את הלוח…'}</p>
        </div>
        <button
          type="button"
          className="mobile-board__fit"
          data-testid="btn-fit-board"
          onClick={panZoom.resetToFit}
        >
          <span aria-hidden="true">⌗</span>
          התאימו למסך
        </button>
      </header>

      {assassinRevealed ? (
        <div className="mobile-board__game-over" role="alert">
          <RoleIcon role="assassin" /> המתנקש נחשף — סוף משחק
        </div>
      ) : null}

      <div
        className={`mobile-board__viewport${panZoom.gesturing ? ' is-gesturing' : ''}`}
        ref={viewportRef}
        onPointerDown={panZoom.pointerDown}
        onPointerMove={panZoom.pointerMove}
        onPointerUp={panZoom.pointerUp}
        onPointerCancel={panZoom.pointerCancel}
      >
        {tiles.length === 0 ? (
          <div className="mobile-board__loading" role="status">
            <span className="cn-loading-spinner" data-testid="loading-spinner" aria-hidden="true" />
            טוענים את קלפי הלוח…
          </div>
        ) : (
          <div
            className="mobile-board__transform"
            data-board-transform="true"
            data-at-fit={panZoom.atFit ? 'true' : 'false'}
            style={{ transform: `translate3d(${panZoom.transform.x}px, ${panZoom.transform.y}px, 0) scale(${panZoom.transform.scale})` }}
          >
            <div className="mobile-board__grid">
              {tiles.map((tile, index) => (
                <MobileBoardTile
                  index={index}
                  key={tile.word}
                  selectedIndex={selected.indexOf(tile.word)}
                  tile={tile}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mobile-board__minimap" data-testid="minimap" aria-label="מפת הלוח">
          {tiles.map((tile) => (
            <span className={`role-${tile.role}`} key={tile.word} />
          ))}
        </div>
      </div>

      <details className="mobile-board__fallback">
        <summary>רשימת קלפים נגישה ללא מחוות</summary>
        <ul>
          {tiles.map((tile) => (
            <li key={tile.word}>
              <button type="button" onClick={() => setFocusedWord(tile.word)}>
                <RoleIcon role={tile.role} />
                <span>{tile.word}</span>
                <span>{roleLabel[tile.role]}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
      {focusedWord ? (
        <MarkRevealedSheet onClose={() => setFocusedWord(null)} word={focusedWord} />
      ) : null}
    </section>
  );
}
