import type { HTMLAttributes } from 'react';

import type { Role } from '../types/api';

const roleLabel: Record<Role, string> = {
  red: 'אדום',
  blue: 'כחול',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
};

export interface RoleIconProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  role: Role;
}

export function RoleIcon({
  className = '',
  role,
  ...props
}: RoleIconProps): JSX.Element {
  const classes = ['cn-role-icon', `role-${role}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      {...props}
      className={classes}
      role="img"
      aria-label={props['aria-label'] ?? roleLabel[role]}
    />
  );
}

