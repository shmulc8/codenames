import { OperativePanel } from '../../features/operative';

export function MobileOperativePanel(): JSX.Element {
  return (
    <section className="mobile-panel mobile-operative" aria-label="כלי המנחש">
      <OperativePanel focusResultOnLoad />
    </section>
  );
}
