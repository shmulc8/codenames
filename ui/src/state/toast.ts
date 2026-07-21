export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  duration?: number;
  tone?: ToastTone;
}

export interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let currentToast: ToastState | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getToastSnapshot(): ToastState | null {
  return currentToast;
}

export function subscribeToToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hideToast(): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }

  if (currentToast) {
    currentToast = null;
    emit();
  }
}

export function showToast(
  message: string,
  { duration = 4000, tone = 'info' }: ToastOptions = {},
): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
  }

  currentToast = { id: ++nextId, message, tone };
  emit();

  if (duration > 0) {
    dismissTimer = setTimeout(hideToast, duration);
  }
}

function handleToastEvent(event: Event): void {
  const detail = (event as CustomEvent<{
    duration?: number;
    message?: string;
    tone?: ToastTone;
  }>).detail;

  if (detail?.message) {
    showToast(detail.message, {
      duration: detail.duration,
      tone: detail.tone,
    });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('cn:toast', handleToastEvent);
  import.meta.hot?.dispose(() => {
    window.removeEventListener('cn:toast', handleToastEvent);
  });
}
