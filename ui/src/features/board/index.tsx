import { useEffect, useMemo, useRef, useState } from 'react';

import { Card } from '../../components/Card';
import { RoleIcon } from '../../components/RoleIcon';
import { getDeal } from '../../api/client';
import { useAppStore } from '../../state/store';
import { showToast } from '../../state/toast';
import type { Role } from '../../types/api';
import './board.css';

const roleLabel: Record<Role, string> = {
  red: 'אדום',
  blue: 'כחול',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
};

const legendRoles: Role[] = ['red', 'blue', 'neutral', 'assassin'];

// Card base color per role; the Card derives all its shades from this.
export const roleColor: Record<Role, string> = {
  red: '#d98f8f',
  blue: '#8fb3d9',
  neutral: '#e8d4b9',
  assassin: '#4a4d5c',
};

export function BoardGrid(): JSX.Element {
  const tiles = useAppStore((state) => state.tiles);
  const mode = useAppStore((state) => state.mode);
  const selected = useAppStore((state) => state.selected);
  const hoverWord = useAppStore((state) => state.hoverWord);
  const currentClueOption = useAppStore(
    (state) => state.clue.current?.options[state.clue.optionIndex] ?? null,
  );
  const toggleSelected = useAppStore((state) => state.toggleSelected);
  const toggleLifecycle = useAppStore((state) => state.toggleLifecycle);
  const setHoverWord = useAppStore((state) => state.setHoverWord);
  const setBoard = useAppStore((state) => state.setBoard);
  const [legendOpen, setLegendOpen] = useState(false);
  const [markingRevealed, setMarkingRevealed] = useState(false);
  const [dealing, setDealing] = useState(false);
  const legendRef = useRef<HTMLDivElement | null>(null);

  const remaining = tiles.reduce(
    (counts, tile) => {
      if (tile.lifecycle === 'inPlay' && (tile.role === 'red' || tile.role === 'blue')) {
        counts[tile.role] += 1;
      }
      return counts;
    },
    { red: 0, blue: 0 },
  );
  const assassinRevealed = tiles.some(
    (tile) => tile.role === 'assassin' && tile.lifecycle === 'chosen',
  );
  const intendedWords = useMemo(
    () => new Set(mode === 'operative' ? [] : (currentClueOption?.intended ?? [])),
    [currentClueOption, mode],
  );

  useEffect(() => {
    if (!legendOpen) return undefined;
    const closeLegend = (event: MouseEvent): void => {
      if (!legendRef.current?.contains(event.target as Node)) setLegendOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLegendOpen(false);
    };
    document.addEventListener('pointerdown', closeLegend);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeLegend);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [legendOpen]);

  function selectTile(index: number): void {
    // Clue-focus selection is a spymaster concept — the guesser must not be able to
    // trigger it (its "team-only" toast below would otherwise leak a hidden role).
    if (mode === 'operative') return;
    const tile = tiles[index];
    if (!tile || tile.lifecycle !== 'inPlay') return;
    toggleSelected(tile.word);
    if (tile.role === 'neutral' || tile.role === 'assassin') {
      showToast('אפשר לבחור רק קלפים של קבוצה');
    }
  }

  async function dealNewBoard(): Promise<void> {
    if (dealing) return;

    setDealing(true);
    try {
      const deal = await getDeal();
      // setBoard intentionally keeps the player on the game screen while replacing
      // all board-scoped state (selections, clues, reveals, and log).
      setBoard(deal.words, deal.roles);
      setMarkingRevealed(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'לא הצלחנו לטעון לוח אקראי', {
        tone: 'error',
      });
    } finally {
      setDealing(false);
    }
  }

  return (
    <section
      className="board"
      aria-labelledby="board-title"
      data-testid="stub-board"
      data-mode={mode}
    >
      <header className="board__toolbar">
        <div>
          <p className="board__eyebrow">הלוח הפעיל</p>
          <h2 id="board-title">
            {mode === 'operative' ? 'בחרו קלף לניחוש' : 'בחרו צירוף מאותו צבע'}
          </h2>
        </div>

        <div className="board__toolbar-actions">
          {mode === 'spymaster' ? (
            <>
              <div className="board__remaining" aria-label="קלפי קבוצה שנותרו במשחק">
                <span className="role-red">
                  <RoleIcon role="red" /> אדום {remaining.red}
                </span>
                <span className="role-blue">
                  <RoleIcon role="blue" /> כחול {remaining.blue}
                </span>
              </div>

              <div className="board__legend" ref={legendRef}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-expanded={legendOpen}
                  aria-controls="board-role-legend"
                  onClick={() => setLegendOpen((open) => !open)}
                >
                  מקרא
                </button>
                {legendOpen && (
                  <div
                    id="board-role-legend"
                    className="board__legend-popover"
                    role="dialog"
                    aria-label="מקרא תפקידי הלוח"
                  >
                    {legendRoles.map((role) => (
                      <span className={`role-${role}`} key={role}>
                        <RoleIcon role={role} /> {roleLabel[role]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}

          <button
            type="button"
            className={`btn btn-secondary ${markingRevealed ? 'is-active' : ''}`}
            data-testid="btn-mark-revealed"
            aria-pressed={markingRevealed}
            onClick={() => {
              // When cards are already selected, reveal the whole selection in one click
              // instead of forcing the user to enter marking mode and tap each card.
              if (selected.length > 0) {
                [...selected].forEach((word) => toggleLifecycle(word));
                return;
              }
              setMarkingRevealed((marking) => !marking);
            }}
          >
            {selected.length > 0
              ? `סמנו ${selected.length} כנחשפו`
              : markingRevealed
                ? 'סיום סימון'
                : 'סימון כנחשף'}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            data-testid="btn-reset-game"
            disabled={dealing}
            onClick={() => void dealNewBoard()}
          >
            {dealing ? 'מגרילים לוח…' : 'לוח אקראי חדש'}
          </button>
        </div>
      </header>

      {assassinRevealed && (
        <div className="board__game-over" role="alert">
          <RoleIcon role="assassin" /> המתנקש נחשף — סוף משחק
        </div>
      )}

      <div className="board__grid" data-testid="board-grid">
        {tiles.map((tile, index) => {
          const selectionIndex = selected.indexOf(tile.word);
          const selectedForClue = selectionIndex >= 0;
          const chosen = tile.lifecycle === 'chosen';
          // The guesser sees no card colors until a card is chosen — the spymaster view
          // (mode !== 'operative') is untouched, still showing the true role at all times.
          const hideRole = mode === 'operative' && !chosen;
          const visualRole = chosen ? (tile.chosenBy ?? tile.role) : tile.role;
          const displayRole = hideRole ? 'neutral' : visualRole;
          const classes = [
            'board-tile',
            `role-${displayRole}`,
            selectedForClue ? 'is-selected' : '',
            chosen ? 'is-chosen' : '',
            chosen && tile.role === 'assassin' ? 'is-assassin-chosen' : '',
            intendedWords.has(tile.word) ? 'is-clue-target' : '',
            hoverWord === tile.word ? 'is-hover-linked' : '',
            markingRevealed ? 'is-marking-revealed' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              className="board-cell"
              onMouseEnter={() => setHoverWord(tile.word)}
              onMouseLeave={() => setHoverWord(null)}
              onFocus={() => setHoverWord(tile.word)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setHoverWord(null);
              }}
              key={tile.word}
            >
              <button
                type="button"
                className={classes}
                data-testid={`tile-${index}`}
                data-word={tile.word}
                data-role={displayRole}
                data-lifecycle={tile.lifecycle}
                disabled={chosen && !markingRevealed}
                aria-pressed={selectedForClue}
                aria-label={`${tile.word}${hideRole ? '' : `, ${roleLabel[tile.role]}`}${chosen ? ', נחשף' : ''}`}
                onClick={() => {
                  if (markingRevealed) {
                    toggleLifecycle(tile.word);
                    return;
                  }
                  selectTile(index);
                }}
              >
                <Card className="board-tile__face" color={roleColor[displayRole]} />
                <span className="board-tile__content">
                  <span className="board-tile__hole" aria-hidden="true" />
                  <RoleIcon className="board-tile__role" role={tile.role} />
                  {selectedForClue && (
                    <span
                      className="board-tile__badge"
                      aria-label={`סדר בחירה ${selectionIndex + 1}`}
                    >
                      {selectionIndex + 1}
                    </span>
                  )}
                  {chosen && (
                    <span
                      className="board-tile__chosen-chip"
                      data-testid={`chip-chosenby-${index}`}
                      title={`נלקח על ידי ${roleLabel[tile.chosenBy ?? tile.role]}`}
                    >
                      <RoleIcon role={tile.chosenBy ?? tile.role} />
                      <span className="sr-only">
                        נלקח על ידי {roleLabel[tile.chosenBy ?? tile.role]}
                      </span>
                    </span>
                  )}
                  <span className="board-tile__mirror" aria-hidden="true">
                    {tile.word}
                  </span>
                  <span className="board-tile__label">{tile.word}</span>
                </span>
              </button>

              <button
                type="button"
                className="board-tile__lifecycle"
                data-testid={`btn-lifecycle-${index}`}
                aria-label={chosen ? `החזר את ${tile.word} למשחק` : `סמן את ${tile.word} כנחשף`}
                title={chosen ? 'החזר למשחק' : 'סמן כנחשף'}
                onClick={() => toggleLifecycle(tile.word)}
              >
                {chosen ? 'החזר למשחק' : 'סמן כנחשף'}
              </button>
            </div>
          );
        })}
      </div>

      <p className="board__hint">
        {mode === 'operative'
          ? 'הלוח לא חושף בפניכם צבעים — הזינו את הרמז בפאנל בצד כדי לראות הצעת ניחוש'
          : 'לחצו על קלף קבוצה כדי לצרף אותו לרמז'}
        {' · '}
        ב״סימון כנחשף״ לחצו על קלף שכבר יצא מהמשחק — הוא לא יישלח יותר לקבלת רמזים.
      </p>
    </section>
  );
}
