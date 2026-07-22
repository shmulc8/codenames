import { useId, type HTMLAttributes, type ReactNode } from 'react';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  actions?: ReactNode;
  children: ReactNode;
  title?: ReactNode;
}

export function Panel({
  actions,
  children,
  className = '',
  title,
  ...props
}: PanelProps): JSX.Element {
  const generatedTitleId = useId();
  const titleId = title ? generatedTitleId : undefined;
  const classes = ['card', 'cn-panel', className].filter(Boolean).join(' ');

  return (
    <section {...props} className={classes} aria-labelledby={props['aria-labelledby'] ?? titleId}>
      {title ? (
        <header className="cn-panel__header">
          <h2 className="cn-panel__title" id={titleId}>
            {title}
          </h2>
          {actions}
        </header>
      ) : null}
      <div className="cn-panel__body">{children}</div>
    </section>
  );
}
