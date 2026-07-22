import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Toast } from '../../components/Toast';
import { PanZoomCanvas } from './PanZoomCanvas';

declare global {
  interface Window {
    __mobileBoardReady?: boolean;
  }
}

const applicationRoot = document.getElementById('root');

if (!applicationRoot) {
  throw new Error('Missing #root application mount point');
}

applicationRoot.remove();
const root = document.createElement('div');
root.className = 'mobile';
root.id = 'mobile-board-test-root';
root.style.height = '100vh';
// The standalone harness has no MobileShell parent to size the canvas, and the
// injected context makes 100svh collapse; pin a deterministic viewport height so
// fit-to-screen matches a real device instead of flooring fitScale to its minimum.
const harnessStyle = document.createElement('style');
harnessStyle.textContent =
  '.mobile-board-harness .mobile-board{height:100vh!important}' +
  '.mobile-board-harness .mobile-board__viewport{min-height:78vh!important}';
document.head.append(harnessStyle);
document.body.append(root);
createRoot(root).render(
  <StrictMode>
    <div className="mobile mobile-board-harness">
      <PanZoomCanvas />
      <Toast />
    </div>
  </StrictMode>,
);
window.__mobileBoardReady = true;
