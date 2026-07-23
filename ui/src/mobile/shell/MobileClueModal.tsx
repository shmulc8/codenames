import { useEffect, useLayoutEffect, useRef } from 'react';

import { useAppStore } from '../../state/store';
import { MobileCluePanel } from '../panels';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface MobileClueModalProps {
  autoRequest: boolean;
  onClose(): void;
}

export function MobileClueModal({ autoRequest, onClose }: MobileClueModalProps): JSX.Element {
  const clueResponse = useAppStore((state) => state.clue.current);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousResponseRef = useRef(clueResponse);

  useLayoutEffect(() => {
    // Move focus into the dialog on open. Focus RESTORATION on close is owned by the shell
    // (it captures the trigger in the open handler, which is immune to StrictMode's effect
    // double-invocation that would otherwise capture this close button instead).
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  useEffect(() => {
    if (!clueResponse || clueResponse === previousResponseRef.current) return;
    previousResponseRef.current = clueResponse;

    const frame = window.requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const result = scroller?.querySelector<HTMLElement>('[data-testid="clue-result"]');
      if (!scroller || !result) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const resultRect = result.getBoundingClientRect();
      scroller.scrollTop += resultRect.top - scrollerRect.top - 8;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [clueResponse]);

  return (
    <div className="mobile-clue-modal__backdrop">
      <div
        className="mobile-clue-modal"
        data-testid="mobile-clue-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-clue-modal-title"
        tabIndex={-1}
      >
        <header className="mobile-clue-modal__header">
          <div>
            <p>עוזר רב־המרגלים</p>
            <h2 id="mobile-clue-modal-title">יצירת רמז</h2>
          </div>
          <button
            className="mobile-clue-modal__close"
            ref={closeRef}
            type="button"
            aria-label="סגירת חלון הרמז"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="mobile-clue-modal__scroll" data-testid="mobile-clue-scroll" ref={scrollRef}>
          <MobileCluePanel autoRequest={autoRequest} />
        </div>
      </div>
    </div>
  );
}
