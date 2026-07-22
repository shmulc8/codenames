import { useEffect, useRef, useState } from 'react';

import { rotateRolesClockwise } from '../../features/photo/keyCard';
import { subscribeToOcrProgress, warmOcrWorker } from '../../features/photo/ocr';
import { useAppStore } from '../../state/store';
import { showToast } from '../../state/toast';
import type { Role } from '../../types/api';
import { CameraView } from './CameraView';
import { KeyReview } from './KeyReview';
import { ProcessingOverlay } from './ProcessingOverlay';
import { WordReview } from './WordReview';
import {
  EMPTY_CONFIDENCE,
  EMPTY_ROLES,
  EMPTY_WORDS,
  isValidKey,
  nextRole,
  normalizedWords,
  wordsComplete,
} from './keyGrid';
import { getRecognizers, hasRecognizerOverride } from './recognizers';
import './capture.css';

type Step = 1 | 2;
type Phase = 'camera' | 'review';

export interface CaptureFlowProps {
  onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function coerceWords(words: string[]): string[] {
  return Array.from({ length: 25 }, (_, index) => words[index] ?? '');
}

function coerceRoles(roles: Role[]): Role[] {
  return Array.from({ length: 25 }, (_, index) => roles[index] ?? 'neutral');
}

export function CaptureFlow({ onClose }: CaptureFlowProps): JSX.Element {
  const setBoard = useAppStore((state) => state.setBoard);
  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>('camera');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [words, setWords] = useState<string[]>(EMPTY_WORDS);
  const [confidences, setConfidences] = useState<number[]>(EMPTY_CONFIDENCE);
  const [roles, setRoles] = useState<Role[]>(EMPTY_ROLES);
  const boardAttempt = useRef(0);
  const keyAttempt = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeToOcrProgress(({ progress: value }) =>
      setProgress(Math.round(value * 100)),
    );
    // Warm the shared Tesseract worker up front for real captures; skip when a
    // test injects deterministic recognizers so no traineddata is fetched.
    if (!hasRecognizerOverride()) {
      void warmOcrWorker().catch(() => undefined);
    }
    return () => {
      boardAttempt.current += 1;
      keyAttempt.current += 1;
      unsubscribe();
    };
  }, []);

  async function processBoard(file: File): Promise<void> {
    const attempt = ++boardAttempt.current;
    setProcessing(true);
    setProgress(0);
    try {
      const cells = await getRecognizers().recognizeBoard(file);
      if (attempt !== boardAttempt.current) return;
      setWords(coerceWords(cells.map((cell) => cell.word)));
      setConfidences(
        Array.from({ length: 25 }, (_, index) => cells[index]?.confidence ?? 0),
      );
      setPhase('review');
    } catch (error) {
      if (attempt !== boardAttempt.current) return;
      showToast(`${errorMessage(error, 'הזיהוי נכשל')} — נסו שוב או תקנו ידנית`, {
        tone: 'error',
      });
    } finally {
      if (attempt === boardAttempt.current) setProcessing(false);
    }
  }

  async function processKey(file: File): Promise<void> {
    const attempt = ++keyAttempt.current;
    setProcessing(true);
    try {
      const classified = await getRecognizers().classifyKeyCard(file);
      if (attempt !== keyAttempt.current) return;
      setRoles(coerceRoles(classified));
      setPhase('review');
    } catch (error) {
      if (attempt !== keyAttempt.current) return;
      showToast(`${errorMessage(error, 'זיהוי הצבעים נכשל')} — נסו שוב או סמנו ידנית`, {
        tone: 'error',
      });
    } finally {
      if (attempt === keyAttempt.current) setProcessing(false);
    }
  }

  function handleCameraFile(file: File): void {
    if (step === 1) void processBoard(file);
    else void processKey(file);
  }

  function updateWord(index: number, value: string): void {
    boardAttempt.current += 1;
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
  }

  function cycleRole(index: number): void {
    keyAttempt.current += 1;
    setRoles((current) => {
      const next = [...current];
      next[index] = nextRole(current[index]);
      return next;
    });
  }

  function rotateRoles(): void {
    keyAttempt.current += 1;
    setRoles((current) => rotateRolesClockwise(current));
  }

  function confirmWords(): void {
    if (!wordsComplete(words)) return;
    setRoles(EMPTY_ROLES());
    setStep(2);
    setPhase('camera');
  }

  function confirmKey(): void {
    if (!isValidKey(roles)) return;
    const normalized = normalizedWords(words);
    const roleMap = Object.fromEntries(
      normalized.map((word, index) => [word, roles[index]]),
    );
    setBoard(normalized, roleMap);
    onClose();
  }

  return (
    <div className="mobile cn-capture" dir="rtl">
      {phase === 'camera' && (
        <CameraView step={step} onFile={handleCameraFile} onClose={onClose} />
      )}
      {phase === 'review' && step === 1 && (
        <WordReview
          words={words}
          confidences={confidences}
          onChange={updateWord}
          onUse={confirmWords}
          onRetake={() => setPhase('camera')}
          onGallery={handleCameraFile}
          onClose={onClose}
        />
      )}
      {phase === 'review' && step === 2 && (
        <KeyReview
          roles={roles}
          onCycle={cycleRole}
          onRotate={rotateRoles}
          onUse={confirmKey}
          onRetake={() => setPhase('camera')}
          onGallery={handleCameraFile}
          onClose={onClose}
        />
      )}
      {processing && (
        <ProcessingOverlay
          progress={progress}
          label={step === 1 ? 'מזהה את מילות הלוח…' : 'מזהה את צבעי המפתח…'}
        />
      )}
    </div>
  );
}
