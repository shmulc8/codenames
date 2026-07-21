import { useId, type HTMLAttributes, type ReactNode } from 'react';

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'content'> {
  children: ReactNode;
  content: ReactNode;
}

export function Tooltip({
  children,
  className = '',
  content,
  ...props
}: TooltipProps): JSX.Element {
  const tooltipId = useId();
  const classes = ['cn-tooltip', className].filter(Boolean).join(' ');

  return (
    <span
      {...props}
      className={classes}
      aria-describedby={props['aria-describedby'] ?? tooltipId}
      tabIndex={props.tabIndex ?? 0}
    >
      {children}
      <span className="cn-tooltip__content" id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}
