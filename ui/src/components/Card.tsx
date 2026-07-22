import type { CSSProperties, ReactNode } from 'react';

import './Card.css';

export interface CardProps {
  /** Base color of the card; all shades are derived from it. Any CSS color. */
  color?: string;
  /** Content shown in the card's blank box area. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

// ponytail: whole palette derived from one --card-color via color-mix; no per-shade props.
export function Card({
  color = '#e8d4b9',
  children,
  className = '',
  style,
}: CardProps): JSX.Element {
  const vars = { '--card-color': color, ...style } as CSSProperties;

  return (
    <div className={`cn-card ${className}`.trim()} style={vars}>
      <svg viewBox="0 0 400 260" width="100%" height="100%" role="img" aria-hidden={!children}>
        <defs>
          <clipPath id="cardClip">
            <rect x="14" y="12" width="372" height="236" rx="16" />
          </clipPath>
        </defs>

        {/* drop shadow + parchment base */}
        <rect x="14" y="16" width="372" height="236" rx="16" fill="#000" opacity="0.12" />
        <rect x="14" y="12" width="372" height="236" rx="16" fill="var(--card-color)" />

        {/* subtle embossed inner frame */}
        <rect
          x="23"
          y="21"
          width="354"
          height="218"
          rx="11"
          fill="none"
          stroke="var(--card-shade-1)"
          strokeWidth="1.5"
          opacity="0.45"
        />
        <rect
          x="24"
          y="22"
          width="354"
          height="218"
          rx="11"
          fill="none"
          stroke="var(--card-tint-2)"
          strokeWidth="1.5"
          opacity="0.6"
        />

        {/* faint agent figure, upper-right */}
        <g fill="var(--card-shade-2)" opacity="0.3" transform="translate(130,-8)">
          <circle cx="200" cy="68" r="15" />
          <path d="M168,116 Q170,88 200,88 Q230,88 232,116 Z" />
        </g>

        {/* white word box (lower third) */}
        <rect
          x="40"
          y="150"
          width="320"
          height="66"
          rx="7"
          fill="var(--card-shade-0)"
          opacity="0.35"
        />
        <rect x="40" y="148" width="320" height="66" rx="7" fill="#faf8f2" />
        <rect
          x="40"
          y="148"
          width="320"
          height="66"
          rx="7"
          fill="none"
          stroke="var(--card-shade-1)"
          strokeWidth="1.5"
          opacity="0.55"
        />

        {/* diagonal gloss */}
        <g clipPath="url(#cardClip)">
          <path d="M 120 -20 L 190 -20 L -30 280 L -100 280 Z" fill="#fff" opacity="0.10" />
          <path d="M 270 -20 L 320 -20 L 100 280 L 50 280 Z" fill="#fff" opacity="0.07" />
        </g>
      </svg>

      {children != null && <div className="cn-card__content">{children}</div>}
    </div>
  );
}
