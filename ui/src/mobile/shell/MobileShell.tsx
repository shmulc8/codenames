import { useState } from 'react';

import { PanZoomCanvas } from '../board';
import { CaptureFlow } from '../capture';
import { MobileCheckPanel, MobileCluePanel, MobileMapPanel } from '../panels';
import { useAppStore } from '../../state/store';
import { MobileHome } from './MobileHome';
import './shell.css';

type MobileTab = 'board' | 'clue' | 'check' | 'map';

const tabs: Array<{ id: MobileTab; icon: string; label: string }> = [
  { id: 'board', icon: '▦', label: 'לוח' },
  { id: 'clue', icon: '✧', label: 'רמז' },
  { id: 'check', icon: '⌕', label: 'בדיקה' },
  { id: 'map', icon: '⁙', label: 'מפה' },
];

function MobileGamePanel({ tab }: { tab: MobileTab }): JSX.Element {
  switch (tab) {
    case 'clue':
      return <MobileCluePanel />;
    case 'check':
      return <MobileCheckPanel />;
    case 'map':
      return <MobileMapPanel />;
    case 'board':
      return <PanZoomCanvas />;
  }
}

function MobileTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
}): JSX.Element {
  return (
    <nav
      className="mobile-shell__tabbar"
      data-testid="tabbar"
      role="tablist"
      aria-label="ניווט במשחק"
    >
      {tabs.map((tab) => (
        <button
          className={tab.id === activeTab ? 'is-active' : undefined}
          data-testid={`tab-${tab.id}`}
          id={`mobile-tab-${tab.id}`}
          key={tab.id}
          role="tab"
          aria-controls={`mobile-panel-${tab.id}`}
          aria-selected={tab.id === activeTab}
          type="button"
          onClick={() => onSelect(tab.id)}
        >
          <span className="mobile-shell__tab-icon" aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function MobileShell(): JSX.Element {
  const screen = useAppStore((state) => state.screen);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [mobileTab, setMobileTab] = useState<MobileTab>('board');
  const [capturing, setCapturing] = useState(false);

  function selectTab(tab: MobileTab): void {
    setMobileTab(tab);
    if (tab === 'clue' || tab === 'check') setActiveTab(tab);
  }

  return (
    <div className="mobile mobile-shell" data-testid="mobile-shell" dir="rtl">
      <MobileLandscapePrompt />
      {screen === 'setup' && capturing ? (
        <CaptureFlow onClose={() => setCapturing(false)} />
      ) : (
        <>
          {screen === 'setup' ? <MobileHeader /> : null}
          {screen === 'setup' ? (
            <MobileHome onShoot={() => setCapturing(true)} />
          ) : (
            <MobilePanel tab={mobileTab} />
          )}
          <MobileTabBar activeTab={mobileTab} onSelect={selectTab} />
        </>
      )}
    </div>
  );
}

function MobileLandscapePrompt(): JSX.Element {
  return (
    <main
      className="mobile-shell__orientation-gate"
      data-testid="mobile-landscape-prompt"
      role="status"
    >
      <span aria-hidden="true">↻</span>
      <h1>סובבו את המכשיר לרוחב</h1>
      <p>הצילום, הגדרת הלוח והמשחק פועלים בתצוגה אופקית</p>
    </main>
  );
}

function MobileHeader(): JSX.Element {
  return (
    <header className="mobile-shell__header">
      <span className="mobile-shell__mark" aria-hidden="true">⌘</span>
      <span>
        <strong>קופיילוט · שם קוד</strong>
        <small>עוזר רמזים למשחק הלוח האמיתי</small>
      </span>
    </header>
  );
}

function MobilePanel({ tab }: { tab: MobileTab }): JSX.Element {
  return (
    <main
      className={`mobile-shell__content mobile-shell__content--${tab}`}
      id={`mobile-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`mobile-tab-${tab}`}
    >
      <MobileGamePanel tab={tab} />
    </main>
  );
}
