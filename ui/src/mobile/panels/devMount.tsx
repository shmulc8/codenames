import { createRoot } from 'react-dom/client';

import { MobilePanelsHost } from './MobilePanelsHost';

const MOBILE_ROOT_ID = 'mobile-root';

let mounted = false;

/**
 * Dev-only mount for the mobile panels host behind `/?mobile=1`.
 *
 * stepC-4 cannot edit `App`/`MainScreen` (owned by stepA-1), so for isolated
 * development and e2e it detaches the desktop root and renders the mobile host
 * into a fresh `#mobile-root`. The production wiring is a one-line
 * `useLayout()` delegation in `MainScreen` that the integrator applies at merge
 * (see agents/SYNC-REQUESTS.md). This file never ships in the desktop path.
 */
export function mountMobilePanels(): void {
  if (mounted) return;
  mounted = true;

  document.getElementById('root')?.remove();

  let host = document.getElementById(MOBILE_ROOT_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = MOBILE_ROOT_ID;
    document.body.appendChild(host);
  }

  createRoot(host).render(<MobilePanelsHost />);
}

mountMobilePanels();
