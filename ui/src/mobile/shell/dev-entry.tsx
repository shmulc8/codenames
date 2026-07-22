import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Toast } from '../../components/Toast';
import { MobileShell } from './MobileShell';
import { useLayout } from './useLayout';

let developmentRoot: Root | null = null;
let developmentContainer: HTMLDivElement | null = null;
let desktopContainer: HTMLElement | null = null;

function setDesktopRootMounted(mounted: boolean): void {
  desktopContainer ??= document.getElementById('root');
  if (!desktopContainer) return;

  if (!mounted) {
    desktopContainer.remove();
  } else if (!desktopContainer.isConnected && developmentContainer) {
    document.body.insertBefore(desktopContainer, developmentContainer);
  }
}

function DevelopmentMobileShell(): JSX.Element | null {
  const layout = useLayout();
  const enabled = new URLSearchParams(window.location.search).get('mobile') === '1';
  const active = enabled && layout === 'mobile';

  useEffect(() => {
    setDesktopRootMounted(!active);
    return () => setDesktopRootMounted(true);
  }, [active]);

  return active ? (
    <>
      <MobileShell />
      <Toast />
    </>
  ) : null;
}

export function mountMobileShellForDevelopment(): void {
  if (developmentRoot) return;

  developmentContainer = document.createElement('div');
  developmentContainer.id = 'mobile-shell-development-root';
  document.body.append(developmentContainer);
  developmentRoot = createRoot(developmentContainer);
  developmentRoot.render(
    <React.StrictMode>
      <DevelopmentMobileShell />
    </React.StrictMode>,
  );
}
