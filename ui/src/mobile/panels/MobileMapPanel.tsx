import { SemanticMap } from '../../features/map';
import './panels.css';

/**
 * Full-bleed re-layout of the reused desktop `SemanticMap` on its own mobile
 * `tab-map` — never side-by-side with the board on mobile (DESIGN.md §9).
 * Keeps the legend "קרוב למרכז = קרוב לרמז", danger rings, and the
 * bidirectional dot↔tile highlight via `store.hoverWord`. Container/CSS only.
 */
export function MobileMapPanel(): JSX.Element {
  return (
    <div className="mobile-panel mobile-map">
      <SemanticMap />
    </div>
  );
}
