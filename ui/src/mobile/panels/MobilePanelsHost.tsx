import { useState } from 'react';

import { Toast } from '../../components';
import { useAppStore } from '../../state/store';
import { MobileBoardPlaceholder } from './MobileBoardPlaceholder';
import { MobileCheckPanel } from './MobileCheckPanel';
import { MobileCluePanel } from './MobileCluePanel';
import { MobileMapPanel } from './MobileMapPanel';
import './panels.css';

type MobileTab = 'board' | 'clue' | 'check' | 'map';

interface TabDef {
  id: MobileTab;
  label: string;
  glyph: string;
}

// RTL order: first DOM child renders on the right (לוח), last on the left (מפה).
const TABS: TabDef[] = [
  { id: 'board', label: 'לוח', glyph: '▦' },
  { id: 'clue', label: 'רמז', glyph: '✦' },
  { id: 'check', label: 'בדיקה', glyph: '⌕' },
  { id: 'map', label: 'מפה', glyph: '⠿' },
];

function renderPanel(tab: MobileTab): JSX.Element {
  switch (tab) {
    case 'clue':
      return <MobileCluePanel />;
    case 'check':
      return <MobileCheckPanel />;
    case 'map':
      return <MobileMapPanel />;
    case 'board':
      return <MobileBoardPlaceholder />;
  }
}

/**
 * Mobile host for the reused desktop panels. This is a stepC-4 dev harness that
 * stands in for stepC-1's MobileShell tab bar until it merges — it renders the
 * same panel components stepC-1 will host, behind `/?mobile=1`. All layout is
 * CSS-only re-flow scoped under the `.mobile` root; no desktop behavior changes.
 */
export function MobilePanelsHost(): JSX.Element {
  const [visibleTab, setVisibleTab] = useState<MobileTab>('clue');
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const handleTab = (tab: MobileTab): void => {
    setVisibleTab(tab);
    // The map reads store.activeTab to decide clue-vs-check context, so keep it
    // in sync when the operator moves between the clue and check work modes.
    if (tab === 'clue' || tab === 'check') setActiveTab(tab);
  };

  return (
    <div className="mobile mobile-panels" data-testid="mobile-panels" dir="rtl">
      <main className="mobile__content" data-mobile-tab={visibleTab}>
        {renderPanel(visibleTab)}
      </main>

      <nav className="mobile__tabbar" data-testid="tabbar" aria-label="ניווט ראשי">
        {TABS.map((tab) => {
          const active = visibleTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`mobile__tab${active ? ' is-active' : ''}`}
              data-testid={`tab-${tab.id}`}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              onClick={() => handleTab(tab.id)}
            >
              <span className="mobile__tab-glyph" aria-hidden="true">
                {tab.glyph}
              </span>
              <span className="mobile__tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <Toast />
    </div>
  );
}
