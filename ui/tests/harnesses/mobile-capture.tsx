import { createRoot, type Root } from 'react-dom/client';

import { Toast } from '../../src/components/Toast';
import { CaptureFlow } from '../../src/mobile/capture/CaptureFlow';

const ROOT_ID = 'cn-mobile-capture-root';
let root: Root | null = null;

function shouldMountMobileCapture(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mobile') === '1'
    && window.matchMedia('(max-width: 820px)').matches;
}

function unmountMobileCapture(): void {
  root?.unmount();
  root = null;
  document.getElementById(ROOT_ID)?.remove();
}

function installMobileCapture(): void {
  if (!shouldMountMobileCapture() || document.getElementById(ROOT_ID)) return;
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
