import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { PanZoomCanvas } from '../board';
import { CaptureFlow } from '../capture';
import { MobileCheckPanel, MobileCluePanel, MobileMapPanel, MobileOperativePanel } from '../panels';
import { mobileClueFocusTeam, useAppStore } from '../../state/store';
import { MobileClueModal } from './MobileClueModal';
import { MobileGameBar } from './MobileGameBar';
import { MobileHome } from './MobileHome';
import './shell.css';

type MobileTab = 'board' | 'clue' | 'check' | 'map' | 'operative';
type GameMode = 'spymaster' | 'operative';

const spymasterTabs: Array<{ id: MobileTab; icon: string; label: string }> = [
  { id: 'board', icon: '▦', label: 'לוח' },
  { id: 'clue', icon: '✧', label: 'רמז' },
  { id: 'check', icon: '⌕', label: 'בדיקה' },
  { id: 'map', icon: '⁙', label: 'מפה' },
];

const operativeTabs: Array<{ id: MobileTab; icon: string; label: string }> = [
  { id: 'board', icon: '▦', label: 'לוח' },
  { id: 'operative', icon: '✦', label: 'ניחוש' },
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
    case 'operative':
      return <MobileOperativePanel />;
    case 'board':
      return <PanZoomCanvas />;
  }
}

function MobileTabBar({
  activeTab,
  mode,
  onSelect,
}: {
  activeTab: MobileTab;
  mode: GameMode;
  onSelect: (tab: MobileTab) => void;
}): JSX.Element {
  const tabs = mode === 'operative' ? operativeTabs : spymasterTabs;

  return (
    <nav
      className="mobile-shell__tabbar"
      data-testid="tabbar"
      role="tablist"
      aria-label="ניווט במשחק"
      style={{ '--mobile-tab-count': tabs.length } as CSSProperties}
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
          <span className="mobile-shell__tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function MobileShell(): JSX.Element {
  const screen = useAppStore((state) => state.screen);
  const mode = useAppStore((state) => state.mode);
  const clueModalOpen = useAppStore((state) => state.clueModalOpen);
  const clueFocusTeam = useAppStore(mobileClueFocusTeam);
  const setMode = useAppStore((state) => state.setMode);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const closeMobileClue = useAppStore((state) => state.closeMobileClue);
  const [mobileTab, setMobileTab] = useState<MobileTab>('board');
  const [manualClueOpen, setManualClueOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const backgroundRef = useRef<HTMLDivElement | null>(null);
  // Remember what had focus when the clue modal opened so we can restore it on close. Captured
  // in the (once-only) open handler rather than a modal effect — StrictMode double-invokes effects
  // and would otherwise capture the modal's own close button instead of the real trigger.
  const clueOpenerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const viewport = window.visualViewport;
    if (!shell) return;

    function syncViewportHeight(): void {
      shell?.style.setProperty(
        '--mobile-viewport-height',
        `${Math.round(viewport?.height ?? window.innerHeight)}px`,
      );
    }

    syncViewportHeight();
    viewport?.addEventListener('resize', syncViewportHeight);
    window.addEventListener('resize', syncViewportHeight);
    return () => {
      viewport?.removeEventListener('resize', syncViewportHeight);
      window.removeEventListener('resize', syncViewportHeight);
    };
  }, []);

  useLayoutEffect(() => {
    const background = backgroundRef.current;
    if (!background) return;
    background.inert = clueModalOpen;
    return () => {
      background.inert = false;
    };
  }, [clueModalOpen]);

  useEffect(() => {
    if (!clueModalOpen && manualClueOpen) setManualClueOpen(false);
  }, [clueModalOpen, manualClueOpen]);

  function selectTab(tab: MobileTab): void {
    if (tab === 'clue') {
      clueOpenerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setActiveTab('clue');
      setManualClueOpen(true);
      useAppStore.setState({ clueModalOpen: true });
      return;
    }
    setMobileTab(tab);
    if (tab === 'check') setActiveTab(tab);
  }

  function changeMode(nextMode: GameMode): void {
    setMode(nextMode);
    setManualClueOpen(false);
    setMobileTab(nextMode === 'operative' ? 'operative' : 'board');
    if (nextMode === 'spymaster') setActiveTab('clue');
  }

  const closeClue = useCallback((): void => {
    closeMobileClue();
    setManualClueOpen(false);
    const opener = clueOpenerRef.current;
    clueOpenerRef.current = null;
    // Restore on a macrotask so it runs after the shell clears `inert` on the background
    // (focusing an element under an inert ancestor is silently ignored).
    if (opener?.isConnected) window.setTimeout(() => opener.focus(), 0);
  }, [closeMobileClue]);

  return (
    <div
      className={`mobile mobile-shell${screen === 'game' ? ' is-game' : ''}`}
      data-testid="mobile-shell"
      dir="rtl"
      ref={shellRef}
    >
      <MobileLandscapePrompt />
      <div
        className="mobile-shell__background"
        ref={backgroundRef}
        aria-hidden={clueModalOpen ? 'true' : undefined}
      >
        {screen === 'setup' && capturing ? (
          <CaptureFlow onClose={() => setCapturing(false)} />
        ) : (
          <>
            {screen === 'setup' ? <MobileHeader /> : null}
            {screen === 'game' ? (
              <MobileGameBar onModeChange={changeMode} boardActive={mobileTab === 'board'} />
            ) : null}
            {screen === 'setup' ? (
              <MobileHome onShoot={() => setCapturing(true)} />
            ) : (
              <MobilePanel tab={mobileTab} />
            )}
            <MobileTabBar
              activeTab={clueModalOpen ? 'clue' : mobileTab}
              mode={mode}
              onSelect={selectTab}
            />
          </>
        )}
      </div>
      {clueModalOpen ? (
        <MobileClueModal
          autoRequest={!manualClueOpen && clueFocusTeam !== null}
          onClose={closeClue}
        />
      ) : null}
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
      <span className="mobile-shell__mark" aria-hidden="true">
        ⌘
      </span>
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
