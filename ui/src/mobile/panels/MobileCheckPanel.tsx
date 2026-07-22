import { CheckPanel } from '../../features/check';

/**
 * Single-column re-layout of the reused desktop `CheckPanel` for the mobile
 * `tab-check`. Container/CSS only — no behavior change.
 */
export function MobileCheckPanel(): JSX.Element {
  return (
    <div className="mobile-panel mobile-check">
      <CheckPanel />
    </div>
  );
}
