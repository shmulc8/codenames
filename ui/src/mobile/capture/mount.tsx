import { createRoot, type Root } from 'react-dom/client';

import { Toast } from '../../components/Toast';
import { CaptureFlow } from './CaptureFlow';

const ROOT_ID = 'cn-mobile-capture-root';
let root: Root | null = null;

// Mobile-only: the capture flow renders only when the app is explicitly in the
// mobile layout (`?mobile=1`) AND the viewport is phone-sized. This keeps the
// desktop board input (desktop-4a) completely untouched.
export function shouldMountMobileCapture(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('mobile') !== '1') return false;
  return window.matchMedia('(max-width: 820px)').matches;
}

export function unmountMobileCapture(): void {
  root?.unmount();
  root = null;
  document.getElementById(ROOT_ID)?.remove();
}

export function installMobileCapture(): void {
  if (!shouldMountMobileCapture()) return;
  if (document.getElementById(ROOT_ID)) return;
  // Detach the real app root so this isolated harness doesn't render alongside
  // MainScreen's MobileShell (whose fixed bottom tabbar would overlay the
  // capture flow's bottom controls). Matches the board/panels dev harnesses.
  document.getElementById('root')?.remove();
  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <>
      <CaptureFlow onClose={unmountMobileCapture} />
      <Toast />
    </>,
  );
}

installMobileCapture();
