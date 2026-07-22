import { useEffect, useState } from 'react';

import { RoleIcon } from '../../components/RoleIcon';
import { useAppStore } from '../../state/store';
import { showToast } from '../../state/toast';
import type { Role } from '../../types/api';
import { roleLabel, roles } from './board-model';

interface MarkRevealedSheetProps {
  onClose(): void;
  word: string;
}

export function MarkRevealedSheet({ onClose, word }: MarkRevealedSheetProps): JSX.Element | null {
  const tile = useAppStore((state) => state.tiles.find((candidate) => candidate.word === word));
  const selected = useAppStore((state) => state.selected.includes(word));
  const toggleLifecycle = useAppStore((state) => state.toggleLifecycle);
  const toggleSelected = useAppStore((state) => state.toggleSelected);
  const [chosenBy, setChosenBy] = useState<Role>(tile?.role ?? 'neutral');

  useEffect(() => {
    if (tile) setChosenBy(tile.chosenBy ?? tile.role);
  }, [tile?.chosenBy, tile?.role, tile?.word]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  if (!tile) return null;
  const chosen = tile.lifecycle === 'chosen';

  function selectForClue(): void {
    if (tile?.role !== 'red' && tile?.role !== 'blue') {
      showToast('אפשר לבחור רק קלפים של קבוצה');
      return;
    }
    toggleSelected(word);
  }

  return (
    <div className="mobile-board-sheet-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="mobile-board-sheet"
        data-testid="sheet-mark-revealed"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-sheet-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="mobile-board-sheet__handle" aria-hidden="true" />
        <header>
          <div>
            <h2 id="mobile-sheet-title">{tile.word}</h2>
            <p className={`role-${tile.role}`}><RoleIcon role={tile.role} /> קלף {roleLabel[tile.role]}</p>
          </div>
          <div className={`mobile-board-sheet__preview role-${tile.role}`}>
            <RoleIcon role={tile.role} />
            <strong>{tile.word}</strong>
          </div>
        </header>

        <p className="mobile-board-sheet__status">
          {chosen ? 'הקלף כבר מחוץ למשחק' : 'עדיין במשחק · לא נחשף'}
        </p>
        <fieldset disabled={chosen}>
          <legend>מי לקח את הקלף? (ברירת מחדל — צבע הקלף)</legend>
          <div className="mobile-board-sheet__roles">
            {roles.map((role) => (
              <button
                type="button"
                className={`role-${role}${chosenBy === role ? ' is-active' : ''}`}
                data-testid={`sheet-chosenby-${role}`}
                aria-pressed={chosenBy === role}
                key={role}
                onClick={() => setChosenBy(role)}
              >
                <RoleIcon role={role} />
                {roleLabel[role]}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          className="mobile-board-sheet__primary"
          data-testid="btn-mark-chosen"
          onClick={() => {
            toggleLifecycle(tile.word, chosen ? undefined : chosenBy);
            onClose();
          }}
        >
          {chosen ? 'החזר למשחק' : 'סמנו כנחשפה'}
        </button>
        {!chosen ? (
          <button type="button" className="mobile-board-sheet__select" onClick={selectForClue}>
            {selected ? 'הסירו מהרמז' : 'הוסיפו לרמז'}
          </button>
        ) : null}
        <button type="button" className="mobile-board-sheet__cancel" onClick={onClose}>ביטול</button>
      </section>
    </div>
  );
}
