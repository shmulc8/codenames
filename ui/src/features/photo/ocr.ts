import { createWorker, type Worker } from 'tesseract.js';

export interface OcrCell {
  confidence: number;
  word: string;
}

export interface OcrProgress {
  progress: number;
  status: string;
}

type ProgressListener = (progress: OcrProgress) => void;

const progressListeners = new Set<ProgressListener>();
let workerPromise: Promise<Worker> | null = null;

function emitProgress(status: string, progress = 0): void {
  progressListeners.forEach((listener) => listener({ progress, status }));
}

export function subscribeToOcrProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function warmOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('heb', undefined, {
      logger: ({ progress, status }) => emitProgress(status, progress),
    }).catch((error: unknown) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('לא הצלחנו לקרוא את קובץ התמונה'));
    };
    image.src = url;
  });
}

export async function imageFileToCanvas(
  file: File,
  grayscale = false,
): Promise<HTMLCanvasElement> {
  const image = await loadImage(file);
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('הדפדפן לא הצליח לעבד את התמונה');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (grayscale) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray =
        pixels.data[index] * 0.299 +
        pixels.data[index + 1] * 0.587 +
        pixels.data[index + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
      pixels.data[index] = contrasted;
      pixels.data[index + 1] = contrasted;
      pixels.data[index + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
  }

  return canvas;
}

function onlyHebrew(value: string): string {
  return value.replace(/[^\u0590-\u05FF]/g, '').trim();
}

export async function recognizeBoard(file: File): Promise<OcrCell[]> {
  const [worker, canvas] = await Promise.all([
    warmOcrWorker(),
    imageFileToCanvas(file, true),
  ]);
  const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const words =
    result.data.blocks
      ?.flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .flatMap((line) => line.words)
      .map((word) => ({
        confidence: word.confidence,
        word: onlyHebrew(word.text),
        x: (word.bbox.x0 + word.bbox.x1) / 2,
        y: (word.bbox.y0 + word.bbox.y1) / 2,
      }))
      .filter((word) => word.word.length > 0)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 25) ?? [];

  const ordered = words
    .sort((left, right) => left.y - right.y)
    .reduce<typeof words[]>((rows, word) => {
      const nearest = rows.find((row) => {
        const averageY = row.reduce((total, item) => total + item.y, 0) / row.length;
        return Math.abs(averageY - word.y) < canvas.height / 12;
      });
      if (nearest) nearest.push(word);
      else rows.push([word]);
      return rows;
    }, [])
    .sort((left, right) => left[0].y - right[0].y)
    .slice(0, 5)
    .flatMap((row) => row.sort((left, right) => right.x - left.x));

  return Array.from({ length: 25 }, (_, index) => ({
    confidence: ordered[index]?.confidence ?? 0,
    word: ordered[index]?.word ?? '',
  }));
}
