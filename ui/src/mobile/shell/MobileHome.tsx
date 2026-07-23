import { useState } from 'react';

import { getDeal } from '../../api/client';
import { Button, showToast } from '../../components';
import { useAppStore } from '../../state/store';

function CameraIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 5.5 10 3.8h4l1.5 1.7H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h3.5Z" />
      <circle cx="12" cy="12.5" r="4" />
    </svg>
  );
}

function RandomBoardButton(): JSX.Element {
  const setBoard = useAppStore((state) => state.setBoard);
  const [loading, setLoading] = useState(false);

  async function handleRandomBoard(): Promise<void> {
    if (loading) return;
    setLoading(true);

    try {
      const deal = await getDeal();
      if (deal.words.length !== 25) {
        throw new Error('הלוח האקראי שהתקבל אינו תקין');
      }
      setBoard(deal.words, deal.roles);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'לא הצלחנו לטעון לוח אקראי', {
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      className="mobile-home__random"
      data-testid="btn-random"
      loading={loading}
      variant="secondary"
      onClick={() => void handleRandomBoard()}
    >
      <span aria-hidden="true">⚄</span>
      לוח אקראי לתרגול
    </Button>
  );
}

function ResumeButton(): JSX.Element | null {
  const tiles = useAppStore((state) => state.tiles);
  const setBoard = useAppStore((state) => state.setBoard);
  const canResume = tiles.length === 25;

  function handleResume(): void {
    if (!canResume) return;
    setBoard(
      tiles.map((tile) => tile.word),
      Object.fromEntries(tiles.map((tile) => [tile.word, tile.role])),
    );
  }

  if (!canResume) return null;

  return (
    <button
      className="mobile-home__resume btn btn-ghost"
      data-testid="btn-resume"
      type="button"
      onClick={handleResume}
    >
      <span aria-hidden="true">↶</span>
      המשך המשחק האחרון
    </button>
  );
}

function HomeActions({ onShoot }: { onShoot?: () => void }): JSX.Element {
  return (
    <div className="mobile-home__actions">
      <button
        className="mobile-home__shoot btn btn-primary"
        data-testid="btn-shoot"
        type="button"
        onClick={onShoot ?? (() => showToast('הצילום יהיה זמין בקרוב'))}
      >
        <CameraIcon />
        <span>
          <strong>צלמו את הלוח</strong>
          <small>25 הקלפים שעל השולחן</small>
        </span>
      </button>

      <div className="mobile-home__separator" aria-hidden="true">
        <span />
        או
        <span />
      </div>

      <RandomBoardButton />
      <ResumeButton />
    </div>
  );
}

export function MobileHome({ onShoot }: { onShoot?: () => void }): JSX.Element {
  return (
    <main className="mobile-home" data-testid="mobile-home">
      <section className="mobile-home__intro" aria-labelledby="mobile-home-title">
        <p className="mobile-home__eyebrow">קופיילוט · שם קוד</p>
        <h1 id="mobile-home-title">מתחילים מהלוח שעל השולחן</h1>
        <p>צלמו את הלוח ואת כרטיס המפתח — ונעזור להכין את הרמז הבא.</p>
      </section>

      <HomeActions onShoot={onShoot} />

      <p className="mobile-home__privacy">הכול נשמר על המכשיר בלבד</p>
    </main>
  );
}
