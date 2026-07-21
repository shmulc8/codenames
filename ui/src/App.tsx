import { useEffect, useState } from 'react';

import { Toast } from './components/Toast';
import { SpyFlow } from './features/spy';
import { MainScreen } from './screens/MainScreen';

const mobileQuery = '(pointer: coarse) and (max-width: 820px)';

type MobileView = 'choose' | 'play' | 'spy';

function useMobileGate(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(mobileQuery).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileQuery);
    const update = (): void => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener('change', update);

    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function GameApp(): JSX.Element {
  return (
    <>
      <MainScreen />
      <Toast />
    </>
  );
}

export default function App(): JSX.Element {
  const isMobile = useMobileGate();
  const [mobileView, setMobileView] = useState<MobileView>('choose');

  if (!isMobile || mobileView === 'play') {
    return <GameApp />;
  }

  if (mobileView === 'spy') {
    return <SpyFlow onExit={() => setMobileView('choose')} />;
  }

  return (
    <main className="spy-mode-choice" dir="rtl" data-testid="spy-mode-choice">
      <div className="spy-mode-choice__content">
        <p className="spy-mode-choice__eyebrow">שם קוד</p>
        <h1>איך תרצו להמשיך?</h1>
        <p>אפשר לשחק כרגיל, או לעקוב אחר הלוח הפיזי בזמן המשחק.</p>
        <div className="spy-mode-choice__actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="btn-play"
            onClick={() => setMobileView('play')}
          >
            לשחק
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="btn-spy-mode"
            onClick={() => setMobileView('spy')}
          >
            מצב מרגל
          </button>
        </div>
      </div>
    </main>
  );
}
