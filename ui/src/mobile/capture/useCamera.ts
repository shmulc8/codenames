import { useEffect, useRef, useState, type RefObject } from 'react';

export type CameraStatus = 'starting' | 'live' | 'denied';
export type FacingMode = 'environment' | 'user';

export interface UseCamera {
  videoRef: RefObject<HTMLVideoElement>;
  status: CameraStatus;
  facingMode: FacingMode;
  flip: () => void;
}

// Live preview via getUserMedia. Any failure (no device, denied permission,
// insecure context, or a headless test browser) degrades gracefully to
// `denied`, which the UI turns into a gallery-first fallback.
export function useCamera(active: boolean): UseCamera {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setStatus('starting');

    const stopStream = (): void => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const start = async (): Promise<void> => {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        setStatus('denied');
        return;
      }
      try {
        const stream = await media.getUserMedia({ video: { facingMode } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopStream();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        setStatus('live');
      } catch {
        if (!cancelled) setStatus('denied');
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [active, facingMode]);

  const flip = (): void =>
    setFacingMode((mode) => (mode === 'environment' ? 'user' : 'environment'));

  return { videoRef, status, facingMode, flip };
}

export async function grabFrame(video: HTMLVideoElement): Promise<File | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) return null;
  return new File([blob], 'capture.jpg', { type: 'image/jpeg' });
}
