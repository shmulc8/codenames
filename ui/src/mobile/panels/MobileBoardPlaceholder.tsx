/**
 * Placeholder for the board tab. The mobile pan/zoom board canvas is owned by
 * stepC-2 (`src/mobile/board/**`); until it merges, this keeps the `tab-board`
 * slot functional in the stepC-4 dev harness without touching another agent's
 * area.
 */
export function MobileBoardPlaceholder(): JSX.Element {
  return (
    <div className="mobile-panel mobile-board-placeholder" role="status">
      <span className="mobile-board-placeholder__glyph" aria-hidden="true">
        ▦
      </span>
      <p>לוח המשחק מוצג כאן במכשיר נייד.</p>
    </div>
  );
}
