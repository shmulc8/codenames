import { useState } from 'react';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeToggle({ className = '' }: { className?: string }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === 'undefined' ? 'dark' : currentTheme(),
  );

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cn-theme', next);
    } catch {
      /* storage may be unavailable — the in-page toggle still works for the session */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={`cn-theme-toggle ${className}`.trim()}
      data-testid="theme-toggle"
      aria-label={theme === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
      title={theme === 'dark' ? 'מצב בהיר' : 'מצב כהה'}
      onClick={toggle}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}
