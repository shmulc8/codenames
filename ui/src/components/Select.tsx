import type { SelectHTMLAttributes } from 'react';

import './Select.css';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

/** Native <select> styled as a custom control with a comfortably-padded chevron. */
export function Select({ options, className = '', ...props }: SelectProps): JSX.Element {
  return (
    <span className={`cn-select ${className}`.trim()}>
      <select className="cn-select__native" {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="cn-select__chevron" aria-hidden="true">
        <svg viewBox="0 0 12 8" width="12" height="8">
          <path
            d="M1 1.5 6 6.5 11 1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}
