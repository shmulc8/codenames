import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Toast } from '../../src/components/Toast';
import { PanZoomCanvas } from '../../src/mobile/board/PanZoomCanvas';

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
