import { CluePanel } from '../../features/clue';
import { SessionLog } from '../../features/log';

/**
 * Single-column, scrollable re-layout of the reused desktop `CluePanel`
 * (target-team control, risk dial, request buttons, result card, carousel,
 * warnings, and inline FeedbackControls). Container/CSS only — no forked logic.
 *
 * The session log is reached from the clue tab as a collapsible sheet rather
 * than a permanent side panel (DESIGN.md §5 mobile-3d), reusing `SessionLog`
 * with its own `log-toggle`.
 */
export function MobileCluePanel({ autoRequest = false }: { autoRequest?: boolean }): JSX.Element {
  return (
    <div className="mobile-panel mobile-clue">
      <CluePanel autoRequest={autoRequest} />
      <section className="mobile-clue__log" aria-label="יומן רמזים">
        <SessionLog />
      </section>
    </div>
  );
}
