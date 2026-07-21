import { useEffect, useMemo, useState } from 'react';

import { getDeal } from '../../api/client';
import { RoleIcon } from '../../components/RoleIcon';
import { useAppStore } from '../../state/store';
import { showToast } from '../../state/toast';
import type { Role } from '../../types/api';
import { classifyKeyCard, rotateRolesClockwise } from './keyCard';
import {
  recognizeBoard,
  subscribeToOcrProgress,
  warmOcrWorker,
} from './ocr';
import './photo.css';

const EMPTY_WORDS = Array.from({ length: 25 }, () => '');
const EMPTY_CONFIDENCE = Array.from({ length: 25 }, () => 100);
const EMPTY_ROLES: Role[] = Array.from({ length: 25 }, () => 'neutral');
const roleOrder: Role[] = ['red', 'blue', 'neutral', 'assassin'];
const roleLabel: Record<Role, string> = {
  red: 'אדום',
  blue: 'כחול',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
};

type InputMode = 'manual' | 'photo';
type OcrState = 'warming' | 'ready' | 'recognizing' | 'success' | 'error';

function filePreview(file: File): string {
  return URL.createObjectURL(file);
}

export function PhotoSetup(): JSX.Element {
  const setBoard = useAppStore((state) => state.setBoard);
  const [mode, setMode] = useState<InputMode>('manual');
  const [words, setWords] = useState([...EMPTY_WORDS]);
  const [confidences, setConfidences] = useState([...EMPTY_CONFIDENCE]);
  const [roles, setRoles] = useState<Role[]>([...EMPTY_ROLES]);
  const [ocrState, setOcrState] = useState<OcrState>('warming');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [keyBusy, setKeyBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [boardPreview, setBoardPreview] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToOcrProgress(({ progress }) => {
      setOcrProgress(Math.round(progress * 100));
    });
    void warmOcrWorker()
      .then(() => {
        if (active) setOcrState((state) => (state === 'warming' ? 'ready' : state));
      })
      .catch(() => {
        if (active) setOcrState('error');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => () => {
    if (boardPreview) URL.revokeObjectURL(boardPreview);
  }, [boardPreview]);

  useEffect(() => () => {
    if (keyPreview) URL.revokeObjectURL(keyPreview);
  }, [keyPreview]);

  const counts = useMemo(
    () =>
      roles.reduce<Record<Role, number>>(
        (total, role) => ({ ...total, [role]: total[role] + 1 }),
        { red: 0, blue: 0, neutral: 0, assassin: 0 },
      ),
    [roles],
  );
  const validKey =
    [counts.red, counts.blue].sort((left, right) => right - left).join(',') === '9,8' &&
    counts.neutral === 7 &&
    counts.assassin === 1;

  async function loadDemo(): Promise<void> {
    setDemoBusy(true);
    try {
      const deal = await getDeal();
      setBoard(deal.words, deal.roles);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'לא הצלחנו לטעון לוח אקראי',
        { tone: 'error' },
      );
    } finally {
      setDemoBusy(false);
    }
  }

  async function handleBoardFile(file: File): Promise<void> {
    setMode('photo');
    setBoardPreview(filePreview(file));
    setOcrState('recognizing');
    setValidation(null);
    try {
      const recognized = await recognizeBoard(file);
      setWords(recognized.map((cell) => cell.word));
      setConfidences(recognized.map((cell) => cell.confidence));
      setOcrState('success');
    } catch (error) {
      setWords([...EMPTY_WORDS]);
      setConfidences(Array.from({ length: 25 }, () => 0));
      setOcrState('error');
      showToast(
        `${error instanceof Error ? error.message : 'הזיהוי נכשל'} — אפשר להקליד ידנית`,
        { tone: 'error' },
      );
    }
  }

  async function handleKeyFile(file: File): Promise<void> {
    setKeyPreview(filePreview(file));
    setKeyBusy(true);
    try {
      setRoles(await classifyKeyCard(file));
      showToast('צבעי כרטיס המפתח זוהו — בדקו ותקנו לפי הצורך', {
        tone: 'success',
      });
    } catch (error) {
      setRoles([...EMPTY_ROLES]);
      showToast(
        `${error instanceof Error ? error.message : 'זיהוי הצבעים נכשל'} — אפשר לסמן ידנית`,
        { tone: 'error' },
      );
    } finally {
      setKeyBusy(false);
    }
  }

  function cycleRole(index: number, direction = 1): void {
    setRoles((current) => {
      const next = [...current];
      const currentIndex = roleOrder.indexOf(current[index]);
      next[index] = roleOrder[
        (currentIndex + direction + roleOrder.length) % roleOrder.length
      ];
      return next;
    });
  }

  function focusNextWord(index: number): void {
    const nextInput = document.querySelector<HTMLInputElement>(
      `[data-testid="ocr-cell-${index + 1}"]`,
    );
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
      return;
    }
    document.querySelector<HTMLButtonElement>('[data-testid="btn-confirm-board"]')?.focus();
  }

  function confirmBoard(): void {
    const normalized = words.map((word) => word.trim());
    const firstEmpty = normalized.findIndex((word) => word.length === 0);
    if (firstEmpty >= 0) {
      setValidation('צריך למלא את כל 25 המילים לפני שממשיכים');
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>(
          `[data-testid="ocr-cell-${firstEmpty}"]`,
        )?.focus();
      });
      return;
    }
    if (new Set(normalized).size !== 25) {
      const duplicateIndex = normalized.findIndex(
        (word, index) => normalized.indexOf(word) !== index,
      );
      setValidation('כל מילה צריכה להופיע פעם אחת בלבד');
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>(
          `[data-testid="ocr-cell-${duplicateIndex}"]`,
        )?.focus();
      });
      return;
    }

    setValidation(null);
    const roleMap = Object.fromEntries(
      normalized.map((word, index) => [word, roles[index]]),
    );
    setBoard(normalized, roleMap);
  }

  return (
    <section className="photo-setup" aria-labelledby="setup-title" data-testid="stub-photo">
      <header className="photo-setup__header">
        <div>
          <p className="photo-setup__eyebrow">הכנסת לוח חדש</p>
          <h1 id="setup-title">מאיפה נביא את הלוח?</h1>
        </div>
        <div className="photo-setup__modes" role="group" aria-label="אופן הזנת הלוח">
          <button
            type="button"
            className={mode === 'manual' ? 'is-active' : undefined}
            aria-pressed={mode === 'manual'}
            onClick={() => setMode('manual')}
          >
            הזנה ידנית
          </button>
          <button
            type="button"
            className={mode === 'photo' ? 'is-active' : undefined}
            aria-pressed={mode === 'photo'}
            onClick={() => setMode('photo')}
          >
            מתמונה
          </button>
          <button
            type="button"
            data-testid="btn-skip-demo"
            disabled={demoBusy}
            onClick={() => void loadDemo()}
          >
            {demoBusy ? 'טוען לוח…' : 'אקראי'}
          </button>
        </div>
      </header>

      <div className="photo-setup__body">
        <section className="photo-setup__editor" aria-labelledby="words-heading">
          <div className="photo-setup__section-title">
            <div>
              <h2 id="words-heading">25 המילים שעל הלוח</h2>
              <p id="words-help">Tab או Enter עוברים למילה הבאה · ↑/↓ מחליפים תפקיד.</p>
            </div>
            <span className={`photo-setup__key-status ${validKey ? 'is-valid' : ''}`}>
              {validKey ? '9·8·7·1 מפתח תקין' : 'חלוקת המפתח עדיין לא 9·8·7·1'}
            </span>
          </div>

          <div className="photo-setup__key-tools">
            <div className="photo-setup__counts" aria-label="ספירת תפקידי המפתח">
              {roleOrder.map((role) => (
                <span className={`role-${role}`} key={role}>
                  <RoleIcon role={role} /> {roleLabel[role]} {counts[role]}
                </span>
              ))}
            </div>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setRoles((current) => rotateRolesClockwise(current))}
            >
              סובב ↻
            </button>
          </div>

          <div className="photo-setup__word-grid" data-testid="ocr-grid">
            {words.map((word, index) => (
              <div
                className={`photo-setup__word-cell role-${roles[index]} ${
                  confidences[index] < 60 ? 'is-low-confidence' : ''
                }`}
                key={index}
              >
                <span className="sr-only">מילה {index + 1}</span>
                <span className="photo-setup__word-hole" aria-hidden="true" />
                <span className="photo-setup__word-mirror" aria-hidden="true">
                  {word || `מילה ${index + 1}`}
                </span>
                <input
                  data-testid={`ocr-cell-${index}`}
                  value={word}
                  aria-label={`מילה ${index + 1}, תפקיד ${roleLabel[roles[index]]}`}
                  aria-describedby="words-help"
                  aria-invalid={validation !== null && word.trim().length === 0}
                  onChange={(event) => {
                    const next = [...words];
                    next[index] = event.target.value;
                    setWords(next);
                    setConfidences((current) => {
                      const confidence = [...current];
                      confidence[index] = 100;
                      return confidence;
                    });
                    setValidation(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      focusNextWord(index);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      cycleRole(index, 1);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      cycleRole(index, -1);
                    }
                  }}
                />
                <button
                  type="button"
                  className="photo-setup__word-role"
                  data-testid={`key-cell-${index}`}
                  tabIndex={-1}
                  aria-label={`תפקיד ${roleLabel[roles[index]]} למילה ${index + 1}; לחצו להחלפה`}
                  title={`החלפת תפקיד: ${roleLabel[roles[index]]}`}
                  onClick={() => cycleRole(index)}
                >
                  <RoleIcon role={roles[index]} />
                </button>
              </div>
            ))}
          </div>

          {validation && (
            <p className="photo-setup__validation" role="alert">
              {validation}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary photo-setup__confirm"
            data-testid="btn-confirm-board"
            disabled={demoBusy || ocrState === 'recognizing' || keyBusy}
            onClick={confirmBoard}
          >
            בנו את הלוח והתחילו ←
          </button>
        </section>

        <aside className={`photo-setup__uploads ${mode === 'photo' ? 'is-emphasized' : ''}`}>
          <h2>יש תמונה של הלוח?</h2>
          <p>גררו לכאן צילום מהטלפון, או בחרו קובץ. תמיד תוכלו לתקן את הזיהוי.</p>

          <label
            className="photo-setup__drop-zone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file?.type.startsWith('image/')) void handleBoardFile(file);
            }}
          >
            {boardPreview ? (
              <img src={boardPreview} alt="תצוגה מקדימה של צילום הלוח" />
            ) : (
              <span className="photo-setup__upload-icon" aria-hidden="true">↥</span>
            )}
            <strong>{boardPreview ? 'בחרו צילום אחר' : 'גררו תמונה או בחרו מהמחשב'}</strong>
            <small>JPG · PNG · WEBP</small>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="photo-input-board"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleBoardFile(file);
              }}
            />
          </label>

          <button
            type="button"
            className="btn btn-ghost photo-setup__skip"
            onClick={() => {
              setWords([...EMPTY_WORDS]);
              setConfidences([...EMPTY_CONFIDENCE]);
              setOcrState('ready');
            }}
          >
            דלגו על צילום הלוח — הקלידו ידנית
          </button>

          <div className={`photo-setup__ocr-status is-${ocrState}`} role="status">
            {(ocrState === 'warming' || ocrState === 'recognizing') && (
              <span data-testid="loading-spinner" className="photo-setup__spinner" />
            )}
            {ocrState === 'warming' && `טוען מנוע זיהוי… ${ocrProgress ? `${ocrProgress}%` : ''}`}
            {ocrState === 'ready' && 'מנוע הזיהוי מוכן'}
            {ocrState === 'recognizing' && `מזהה את מילות הלוח… ${ocrProgress}%`}
            {ocrState === 'success' && 'הזיהוי הושלם — בדקו תאים המסומנים בצהוב'}
            {ocrState === 'error' && 'הזיהוי לא זמין כרגע — רשת ההקלדה מוכנה לשימוש'}
          </div>

          <label className="photo-setup__key-upload">
            <span>
              <strong>צילום כרטיס המפתח</strong>
              <small>{keyBusy ? 'מזהה צבעים…' : 'הצבעים ייכנסו לרשת ויישארו ניתנים לתיקון'}</small>
            </span>
            {keyPreview && <img src={keyPreview} alt="תצוגה מקדימה של כרטיס המפתח" />}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="photo-input-key"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleKeyFile(file);
              }}
            />
          </label>

          <button
            type="button"
            className="btn btn-ghost photo-setup__skip"
            onClick={() => setRoles([...EMPTY_ROLES])}
          >
            דלגו על צילום המפתח — סמנו ידנית
          </button>

          <div className="photo-setup__manual-note">
            <span aria-hidden="true">▣</span>
            <p><strong>אין מצלמה במחשב?</strong> זו הסיבה שהזנה ידנית היא ברירת המחדל.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
