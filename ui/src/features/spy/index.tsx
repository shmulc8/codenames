import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import './SpyFlow.css';

type SpyStage = 'capture' | 'verify' | 'decision' | 'board' | 'monitoring';
type CoverColor = 'red' | 'blue' | 'neutral' | 'assassin' | 'unknown';
type CameraStatus = 'starting' | 'ready' | 'manual';

interface ScanResponse {
  words: string[];
  covered: Array<{ word: string; color: CoverColor }>;
}

interface SpyFlowProps {
  onExit: () => void;
}

class ScanError extends Error {}

const maxImageEdge = 1280;
const scanTimeoutMs = 45_000;
const roleShape: Record<CoverColor, string> = {
  red: '◆',
  blue: '●',
  neutral: '−',
  assassin: '☠',
  unknown: '?',
};

function normaliseWords(value: unknown): string[] {
  const words = Array.isArray(value)
    ? value.map((word) => (typeof word === 'string' ? word.trim() : ''))
    : [];

  return Array.from({ length: 25 }, (_, index) => words[index] ?? '');
}

function normaliseCovered(value: unknown): ScanResponse['covered'] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];

    const { color, word } = entry as { color?: unknown; word?: unknown };
    const allowedColors: CoverColor[] = [
      'red',
      'blue',
      'neutral',
      'assassin',
      'unknown',
    ];

    return typeof word === 'string' && allowedColors.includes(color as CoverColor)
      ? [{ word, color: color as CoverColor }]
      : [];
  });
}

function scanMessage(error: unknown): string {
  if (error instanceof ScanError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'הסריקה ארכה יותר מדי זמן. נסו שוב.';
  }

  return 'לא הצלחנו לסרוק את התמונה. נסו שוב.';
}

async function scanBoard(image: string, words?: string[]): Promise<ScanResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), scanTimeoutMs);

  try {
    const response = await fetch('/api/spy/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(words ? { image, words } : { image }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    const serverError =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : null;

    if (!response.ok || serverError) {
      throw new ScanError(serverError ? `שגיאה בסריקה: ${serverError}` : 'הסריקה נכשלה. נסו שוב.');
    }

    if (!body || typeof body !== 'object' || !Array.isArray((body as { words?: unknown }).words)) {
      throw new ScanError('התקבלה תשובה לא תקינה מהסריקה. נסו שוב.');
    }

    return {
      words: normaliseWords((body as { words: unknown }).words),
      covered: normaliseCovered((body as { covered?: unknown }).covered),
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function canvasDataUrl(source: CanvasImageSource, width: number, height: number): string {
  if (!width || !height) {
    throw new ScanError('המצלמה עדיין אינה מוכנה. נסו שוב בעוד רגע.');
  }

  const scale = Math.min(1, maxImageEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new ScanError('לא ניתן להכין את התמונה לסריקה.');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', 0.8);
}

async function fileToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new ScanError('לא ניתן לפתוח את התמונה שנבחרה.'));
      nextImage.src = objectUrl;
    });

    return canvasDataUrl(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ConfirmedBoard({
  covered,
  words,
}: {
  covered: Record<string, CoverColor>;
  words: string[];
}): JSX.Element {
  return (
    <div className="spy-board" data-testid="spy-board" aria-label="לוח מאומת">
      {words.map((word, index) => {
        const color = covered[word];
        const cardClass = [
          'spy-board__card',
          color ? 'is-covered' : '',
          color && color !== 'unknown' ? `role-${color}` : '',
          color === 'unknown' ? 'is-unknown' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <article
            className={cardClass}
            key={`${word}-${index}`}
            data-testid={`spy-card-${index}`}
            data-covered={color ? 'true' : 'false'}
          >
            {color ? (
              <span className="spy-board__mark" aria-hidden="true">
                {roleShape[color]}
              </span>
            ) : null}
            <span>{word}</span>
          </article>
        );
      })}
    </div>
  );
}

export function SpyFlow({ onExit }: SpyFlowProps): JSX.Element {
  const [stage, setStage] = useState<SpyStage>('capture');
  const [words, setWords] = useState<string[]>(() => Array(25).fill(''));
  const [confirmedWords, setConfirmedWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [covered, setCovered] = useState<Record<string, CoverColor>>({});
  const [monitoringLog, setMonitoringLog] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraMessage, setCameraMessage] = useState('מחברים את מצלמת הלוח…');
  const videoRef = useRef<HTMLVideoElement>(null);
  const monitoringInFlight = useRef(false);
  const coverageRef = useRef<Record<string, CoverColor>>({});

  const handleInitialFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setIsScanning(true);

    try {
      const image = await fileToDataUrl(file);
      const response = await scanBoard(image);
      setWords(response.words);
      setStage('verify');
    } catch (nextError) {
      setError(scanMessage(nextError));
    } finally {
      setIsScanning(false);
    }
  }, []);

  const applyMonitoringResult = useCallback((response: ScanResponse) => {
    const knownWords = new Set(confirmedWords);
    const nextCoverage = response.covered.reduce<Record<string, CoverColor>>((result, entry) => {
      if (knownWords.has(entry.word)) result[entry.word] = entry.color;
      return result;
    }, {});
    const newlyCovered = Object.keys(nextCoverage).filter((word) => !coverageRef.current[word]);

    coverageRef.current = nextCoverage;
    setCovered(nextCoverage);
    setMonitoringLog(
      newlyCovered.length
        ? `נחשפו כעת: ${newlyCovered.join(' · ')}`
        : 'הסריקה האחרונה לא זיהתה קלפים חדשים.',
    );
  }, [confirmedWords]);

  const scanMonitoringImage = useCallback(async (image: string) => {
    if (monitoringInFlight.current) return;

    monitoringInFlight.current = true;
    setIsScanning(true);
    setError(null);

    try {
      const response = await scanBoard(image, confirmedWords);
      applyMonitoringResult(response);
    } catch (nextError) {
      setError(scanMessage(nextError));
    } finally {
      monitoringInFlight.current = false;
      setIsScanning(false);
    }
  }, [applyMonitoringResult, confirmedWords]);

  const scanVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    try {
      const image = canvasDataUrl(video, video.videoWidth, video.videoHeight);
      void scanMonitoringImage(image);
    } catch (nextError) {
      setError(scanMessage(nextError));
    }
  }, [scanMonitoringImage]);

  useEffect(() => {
    if (stage !== 'monitoring') return undefined;

    let stopped = false;
    let stream: MediaStream | null = null;
    let intervalId: number | undefined;
    let onLoadedMetadata: (() => void) | undefined;

    const stopStream = (): void => {
      stream?.getTracks().forEach((track) => track.stop());
    };

    const startCamera = async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('manual');
        setCameraMessage('המצלמה אינה זמינה בדפדפן הזה. אפשר לסרוק תמונה ידנית.');
        return;
      }

      setCameraStatus('starting');
      setCameraMessage('מבקשים גישה למצלמה…');

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });

        if (stopped) {
          stopStream();
          return;
        }

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setCameraStatus('ready');
        setCameraMessage('המעקב פעיל. הלוח נסרק אחת לדקה.');

        const scanWhenReady = (): void => scanVideoFrame();
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          scanWhenReady();
        } else {
          onLoadedMetadata = scanWhenReady;
          video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        }

        intervalId = window.setInterval(scanVideoFrame, 60_000);
      } catch {
        stopStream();
        setCameraStatus('manual');
        setCameraMessage('לא התקבלה גישה למצלמה. אפשר לסרוק תמונה ידנית.');
      }
    };

    void startCamera();

    return () => {
      stopped = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      if (onLoadedMetadata && videoRef.current) {
        videoRef.current.removeEventListener('loadedmetadata', onLoadedMetadata);
      }
      stopStream();
    };
  }, [scanVideoFrame, stage]);

  const handleManualRescan = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const image = await fileToDataUrl(file);
      await scanMonitoringImage(image);
    } catch (nextError) {
      setError(scanMessage(nextError));
    }
  }, [scanMonitoringImage]);

  const updateWord = (index: number, value: string): void => {
    setWords((currentWords) =>
      currentWords.map((word, wordIndex) => (wordIndex === index ? value : word)),
    );
  };

  const confirmWords = (): void => {
    const nextWords = words.map((word) => word.trim());
    setWords(nextWords);
    setConfirmedWords(nextWords);
    setStage('decision');
  };

  const completeVerification = words.every((word) => word.trim().length > 0);

  return (
    <main className="spy-flow" dir="rtl" data-testid="spy-flow">
      <header className="spy-flow__header">
        <div>
          <p className="spy-flow__eyebrow">שם קוד</p>
          <h1>מצב מרגל</h1>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          חזרה
        </button>
      </header>

      <section className="spy-flow__content" aria-live="polite">
        {stage === 'capture' ? (
          <div className="spy-panel spy-capture" data-testid="spy-capture">
            <p className="spy-panel__kicker">שלב 1</p>
            <h2>צלמו את הלוח</h2>
            <p>נסרוק את 25 המילים מהלוח הפיזי. ודאו שהלוח כולו נמצא בתמונה.</p>
            <label className="spy-capture__button btn btn-primary">
              <input
                className="spy-file-input"
                type="file"
                accept="image/*"
                capture="environment"
                data-testid="spy-capture-input"
                disabled={isScanning}
                onChange={handleInitialFile}
              />
              {isScanning ? 'סורקים את הלוח…' : 'צלמו או בחרו תמונה'}
            </label>
          </div>
        ) : null}

        {stage === 'verify' ? (
          <div className="spy-panel" data-testid="spy-verify">
            <p className="spy-panel__kicker">שלב 2</p>
            <h2>בדקו את המילים</h2>
            <p>תקנו מילים חסרות או שגויות לפני שמתחילים לעקוב אחר הלוח.</p>
            <div className="spy-verify-grid" aria-label="25 מילות הלוח">
              {words.map((word, index) => (
                <label className="spy-verify-grid__cell" key={index}>
                  <span className="spy-sr-only">מילה {index + 1}</span>
                  <input
                    className="input"
                    dir="rtl"
                    value={word}
                    data-testid={`spy-word-${index}`}
                    onChange={(event) => updateWord(index, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              data-testid="spy-confirm-board"
              disabled={!completeVerification}
              onClick={confirmWords}
            >
              אישור הלוח
            </button>
          </div>
        ) : null}

        {stage === 'decision' ? (
          <div className="spy-panel spy-decision" data-testid="spy-monitor-choice">
            <p className="spy-panel__kicker">הלוח מוכן</p>
            <h2>להמשיך לעקוב אחרי הלוח?</h2>
            <p>המצלמה תבדוק אחת לדקה אילו מילים כוסו בקלפי הסוכנים.</p>
            <div className="spy-decision__actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStage('monitoring')}
              >
                כן, להתחיל מעקב
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStage('board')}
              >
                לא, הציגו את הלוח
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'board' ? (
          <div className="spy-panel" data-testid="spy-static-board">
            <h2>הלוח המאומת</h2>
            <p>אפשר לחזור לכאן כדי לראות את מילות הלוח.</p>
            <ConfirmedBoard covered={covered} words={confirmedWords} />
          </div>
        ) : null}

        {stage === 'monitoring' ? (
          <div className="spy-panel spy-monitoring" data-testid="spy-monitoring">
            <h2>מעקב אחר הלוח</h2>
            <p className="spy-monitoring__status">{cameraMessage}</p>
            <div className="spy-monitoring__preview" aria-label="תצוגה מקדימה של המצלמה">
              <video ref={videoRef} autoPlay muted playsInline />
              {cameraStatus !== 'ready' ? <span>{cameraMessage}</span> : null}
            </div>
            {cameraStatus === 'manual' ? (
              <label className="btn btn-secondary spy-monitoring__manual">
                <input
                  className="spy-file-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  data-testid="spy-manual-rescan-input"
                  disabled={isScanning}
                  onChange={handleManualRescan}
                />
                {isScanning ? 'סורקים את הלוח…' : 'סריקה ידנית מתמונה'}
              </label>
            ) : null}
            {monitoringLog ? <p className="spy-monitoring__log">{monitoringLog}</p> : null}
            <ConfirmedBoard covered={covered} words={confirmedWords} />
          </div>
        ) : null}

        {error ? <p className="spy-flow__error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
