import { useEffect, useMemo, useRef, useState } from 'react';

import { getDeal } from '../../api/client';
import { Card } from '../../components/Card';
import { RoleIcon } from '../../components/RoleIcon';
import { roleColor } from '../board';
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
// Photo/OCR board capture is still being finished — gated off in production, on in
// dev/tests (VITE_ENABLE_OCR=1). Manual entry + random deal stay the default setup path.
const OCR_ENABLED =
  import.meta.env.VITE_ENABLE_OCR === '1' ||
  import.meta.env.VITE_ENABLE_OCR === 'true';

type OcrState = 'warming' | 'ready' | 'recognizing' | 'success' | 'error';

function filePreview(file: File): string {
  return URL.createObjectURL(file);
}

function SetupModeIcon({ name }: { name: 'camera' | 'cube' | 'keyboard' }): JSX.Element {
  if (name === 'keyboard') {
    return (
      <svg className="photo-setup__mode-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M7 13h.01M10.5 13h.01M14 13h3.5M8 16h8" />
      </svg>
    );
  }
  if (name === 'camera') {
    return (
      <svg className="photo-setup__mode-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8.5h3l1.5-2h7l1.5 2h3a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" />
        <circle cx="12" cy="13.5" r="3.5" />
      </svg>
    );
  }
  return (
    <svg className="photo-setup__mode-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </svg>
  );
}

export function PhotoSetup(): JSX.Element {
  const setBoard = useAppStore((state) => state.setBoard);
  const tiles = useAppStore((state) => state.tiles);
  const [mode, setMode] = useState<InputMode>('manual');
  const [words, setWords] = useState(() =>
    tiles.length > 0 ? tiles.map((tile) => tile.word) : [...EMPTY_WORDS],
  );
  const [confidences, setConfidences] = useState(() =>
    tiles.length > 0 ? tiles.map(() => 100) : [...EMPTY_CONFIDENCE],
  );
  const [roles, setRoles] = useState<Role[]>(() =>
    tiles.length > 0 ? tiles.map((tile) => tile.role) : [...EMPTY_ROLES],
  );
  const [ocrState, setOcrState] = useState<OcrState>('warming');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [keyBusy, setKeyBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [randomLoaded, setRandomLoaded] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [boardPreview, setBoardPreview] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const boardOcrAttempt = useRef(0);
  const keyCardAttempt = useRef(0);
  const didInit = useRef(false);
  const dealAttempt = useRef(0);

  useEffect(() => {
    if (!OCR_ENABLED) return;
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
      boardOcrAttempt.current += 1;
      keyCardAttempt.current += 1;
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
    const attempt = ++dealAttempt.current;
    setDemoBusy(true);
    try {
      const deal = await getDeal();
      // A slow initial deal must not overwrite the grid if the user already switched to manual.
      if (attempt !== dealAttempt.current) return;
      setMode('manual');
      setWords([...deal.words]);
      setRoles(deal.words.map((word) => deal.roles[word] ?? 'neutral'));
      setConfidences([...EMPTY_CONFIDENCE]);
      setValidation(null);
      setRandomLoaded(true);
    } catch (error) {
      if (attempt !== dealAttempt.current) return;
      showToast(
        error instanceof Error ? error.message : 'לא הצלחנו לטעון לוח אקראי',
        { tone: 'error' },
      );
    } finally {
      if (attempt === dealAttempt.current) setDemoBusy(false);
    }
  }

  // Most users just want to play, so a fresh setup starts on a random board. Returning to
  // fix an existing board (tiles already present) keeps that board instead.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (tiles.length === 0) void loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear the grid so the user can type their own board from scratch.
  function startManualEntry(): void {
    dealAttempt.current += 1;
    setMode('manual');
    setWords([...EMPTY_WORDS]);
    setRoles([...EMPTY_ROLES]);
    setConfidences([...EMPTY_CONFIDENCE]);
    setRandomLoaded(false);
    setValidation(null);
  }

  async function handleBoardFile(file: File): Promise<void> {
    const attempt = ++boardOcrAttempt.current;
    setMode('photo');
    setBoardPreview(filePreview(file));
    setOcrState('recognizing');
    setValidation(null);
    try {
      const recognized = await recognizeBoard(file);
      if (attempt !== boardOcrAttempt.current) return;
      setWords(recognized.map((cell) => cell.word));
      setConfidences(recognized.map((cell) => cell.confidence));
      setOcrState('success');
    } catch (error) {
      if (attempt !== boardOcrAttempt.current) return;
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
    const attempt = ++keyCardAttempt.current;
    setKeyPreview(filePreview(file));
    setKeyBusy(true);
    try {
      const classifiedRoles = await classifyKeyCard(file);
      if (attempt !== keyCardAttempt.current) return;
      setRoles(classifiedRoles);
      showToast('צבעי כרטיס המפתח זוהו — בדקו ותקנו לפי הצורך', {
        tone: 'success',
      });
    } catch (error) {
      if (attempt !== keyCardAttempt.current) return;
      setRoles([...EMPTY_ROLES]);
      showToast(
        `${error instanceof Error ? error.message : 'זיהוי הצבעים נכשל'} — אפשר לסמן ידנית`,
        { tone: 'error' },
      );
    } finally {
      if (attempt === keyCardAttempt.current) setKeyBusy(false);
    }
  }

  function invalidateKeyClassification(): void {
    keyCardAttempt.current += 1;
    setKeyBusy(false);
  }

  function cycleRole(index: number, direction = 1): void {
    invalidateKeyClassification();
    setRoles((current) => {
      const next = [...current];
      const currentIndex = roleOrder.indexOf(current[index]);
      next[index] = roleOrder[
        (currentIndex + direction + roleOrder.length) % roleOrder.length
      ];
      return next;
    });
  }

  function rotateRoles(): void {
    invalidateKeyClassification();
    setRoles((current) => rotateRolesClockwise(current));
  }

  function updateWord(index: number, value: string): void {
    // Typing means the user is entering their own board — cancel any in-flight deal so a
    // late random result cannot overwrite what they typed.
    dealAttempt.current += 1;
    if (ocrState === 'recognizing') {
      boardOcrAttempt.current += 1;
      setOcrState('ready');
    }
    setWords((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
    setConfidences((current) => {
      const next = [...current];
      next[index] = 100;
      return next;
    });
    setValidation(null);
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
    if (!validKey) {
      setValidation('חלוקת המפתח חייבת להיות 9·8·7·1 לפני שמתחילים');
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
            data-testid="btn-random-board"
            className={randomLoaded ? 'is-active' : undefined}
            aria-pressed={randomLoaded}
            disabled={demoBusy}
            onClick={() => void loadDemo()}
          >
            <SetupModeIcon name="cube" />
            <span>{demoBusy ? 'טוען לוח…' : randomLoaded ? 'לוח אקראי' : 'אקראי'}</span>
          </button>
          {OCR_ENABLED && (
            <button
              type="button"
              className={mode === 'photo' ? 'is-active' : undefined}
              aria-pressed={mode === 'photo'}
              onClick={() => setMode('photo')}
            >
              <SetupModeIcon name="camera" />
              <span>מתמונה</span>
            </button>
          )}
          <button
            type="button"
            data-testid="btn-manual-entry"
            className={mode === 'manual' && !randomLoaded ? 'is-active' : undefined}
            aria-pressed={mode === 'manual' && !randomLoaded}
            onClick={startManualEntry}
          >
            <SetupModeIcon name="keyboard" />
            <span>הזנה ידנית</span>
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
              onClick={rotateRoles}
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
                <Card className="photo-setup__word-face" color={roleColor[roles[index]]} />
                {word ? (
                  <span className="photo-setup__word-mirror" aria-hidden="true">
                    {word}
                  </span>
                ) : null}
                <input
                  data-testid={`ocr-cell-${index}`}
                  value={word}
                  aria-label={`מילה ${index + 1}, תפקיד ${roleLabel[roles[index]]}`}
                  aria-describedby="words-help"
                  aria-invalid={validation !== null && word.trim().length === 0}
                  onChange={(event) => updateWord(index, event.target.value)}
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

        {OCR_ENABLED && (
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
              boardOcrAttempt.current += 1;
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
            onClick={() => {
              invalidateKeyClassification();
              setRoles([...EMPTY_ROLES]);
            }}
          >
            דלגו על צילום המפתח — סמנו ידנית
          </button>

          <div className="photo-setup__manual-note">
            <span aria-hidden="true">▣</span>
            <p><strong>אין מצלמה במחשב?</strong> זו הסיבה שהזנה ידנית היא ברירת המחדל.</p>
          </div>
        </aside>
        )}
      </div>
    </section>
  );
}
