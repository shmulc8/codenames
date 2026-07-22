import { useSyncExternalStore } from 'react';

import { getToastSnapshot, hideToast, subscribeToToast } from '../state/toast';

export function Toast(): JSX.Element | null {
  const toast = useSyncExternalStore(subscribeToToast, getToastSnapshot, getToastSnapshot);

  if (!toast) {
    return null;
  }

  return (
    <div className="cn-toast-viewport">
      <div
        className={`cn-toast cn-toast--${toast.tone}`}
        data-testid="toast"
        role={toast.tone === 'error' ? 'alert' : 'status'}
        aria-atomic="true"
      >
        <p className="cn-toast__message">{toast.message}</p>
        <button
          type="button"
          className="cn-toast__close"
          onClick={hideToast}
          aria-label="סגירת ההודעה"
        >
          ×
        </button>
      </div>
    </div>
  );
}
