import { useSyncExternalStore } from 'react';

export type Layout = 'mobile' | 'desktop';

const NARROW_QUERY = '(max-width: 700px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';

function currentLayout(): Layout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }

  const isNarrow = window.matchMedia(NARROW_QUERY).matches;
  const hasCoarsePointer = window.matchMedia(COARSE_POINTER_QUERY).matches;
  return isNarrow || hasCoarsePointer ? 'mobile' : 'desktop';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const queries = [
    window.matchMedia(NARROW_QUERY),
    window.matchMedia(COARSE_POINTER_QUERY),
  ];
  queries.forEach((query) => query.addEventListener('change', onChange));
  window.addEventListener('resize', onChange);

  return () => {
    queries.forEach((query) => query.removeEventListener('change', onChange));
    window.removeEventListener('resize', onChange);
  };
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, currentLayout, () => 'desktop');
}
