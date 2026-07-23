import type { Role } from '../../types/api';
import { classifyKeyCard } from '../../features/photo/keyCard';
import { recognizeBoard, type OcrCell } from '../../features/photo/ocr';

export interface CaptureRecognizers {
  recognizeBoard: (file: File) => Promise<OcrCell[]>;
  classifyKeyCard: (file: File) => Promise<Role[]>;
}

declare global {
  interface Window {
    __captureRecognizers?: Partial<CaptureRecognizers>;
  }
}

const allowRecognizerOverride = import.meta.env.DEV || import.meta.env.MODE === 'test';

export function hasRecognizerOverride(): boolean {
  return (
    allowRecognizerOverride && typeof window !== 'undefined' && Boolean(window.__captureRecognizers)
  );
}

// OCR and colour classification are non-deterministic system boundaries. The
// real implementations come from stepB-1's photo feature (imported as-is);
// dev/test harnesses may override them through `window.__captureRecognizers`.
export function getRecognizers(): CaptureRecognizers {
  const override = hasRecognizerOverride() ? window.__captureRecognizers : undefined;
  return {
    recognizeBoard: override?.recognizeBoard ?? recognizeBoard,
    classifyKeyCard: override?.classifyKeyCard ?? classifyKeyCard,
  };
}
