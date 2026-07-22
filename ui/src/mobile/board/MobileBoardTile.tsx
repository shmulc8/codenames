import { RoleIcon } from '../../components/RoleIcon';
import type { TileState } from '../../state/store';
import { roleLabel } from './board-model';

interface MobileBoardTileProps {
  index: number;
  selectedIndex: number;
  tile: TileState;
}

export function MobileBoardTile({ index, selectedIndex, tile }: MobileBoardTileProps): JSX.Element {
  const chosen = tile.lifecycle === 'chosen';
  const visualRole = chosen ? (tile.chosenBy ?? tile.role) : tile.role;

  return (
    <button
      type="button"
      className={`mobile-board-tile role-${visualRole}${chosen ? ' is-chosen' : ''}${selectedIndex >= 0 ? ' is-selected' : ''}`}
      data-mobile-tile="true"
      data-testid={`tile-${index}`}
      data-word={tile.word}
      data-role={tile.role}
      data-lifecycle={tile.lifecycle}
      aria-pressed={selectedIndex >= 0}
      aria-label={`${tile.word}, ${roleLabel[tile.role]}${chosen ? ', נחשף' : ''}`}
    >
      {chosen ? (
        <>
          <RoleIcon className="mobile-board-tile__agent" role={visualRole} />
          <span className="mobile-board-tile__chosen-word">{tile.word}</span>
          <span className="mobile-board-tile__check" aria-hidden="true">
            ✓
          </span>
        </>
      ) : (
        <>
          <span className="mobile-board-tile__hole" aria-hidden="true" />
          <RoleIcon className="mobile-board-tile__role" role={tile.role} />
          {selectedIndex >= 0 ? (
            <span className="mobile-board-tile__badge">{selectedIndex + 1}</span>
          ) : null}
          <span className="mobile-board-tile__mirror" aria-hidden="true">
            {tile.word}
          </span>
          <span className="mobile-board-tile__label">{tile.word}</span>
        </>
      )}
    </button>
  );
}
