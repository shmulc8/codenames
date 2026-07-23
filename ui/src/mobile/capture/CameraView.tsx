import { useRef, type ChangeEvent } from 'react';

import { CaptureHeader } from './CaptureHeader';
import { grabFrame, useCamera } from './useCamera';

interface CameraViewProps {
  step: 1 | 2;
  onFile: (file: File) => void;
  onClose: () => void;
}

const TITLE: Record<1 | 2, string> = {
  1: 'צילום לוח המילים',
  2: 'צילום כרטיס המפתח',
};

const HINT: Record<1 | 2, string> = {
  1: 'צלמו את 25 מילות הלוח',
  2: 'צלמו את כרטיס המפתח עם הצבעים',
};

export function CameraView({ step, onFile, onClose }: CameraViewProps): JSX.Element {
  const { videoRef, status, flip } = useCamera(true);
  const galleryRef = useRef<HTMLInputElement>(null);

  function handleGalleryChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(file);
  }

  async function handleShutter(): Promise<void> {
    const video = videoRef.current;
    if (status === 'live' && video) {
      const frame = await grabFrame(video);
      if (frame) {
        onFile(frame);
        return;
      }
    }
    galleryRef.current?.click();
  }

  return (
    <section className="cn-capture__camera" data-testid="camera-view">
      <CaptureHeader step={step} title={TITLE[step]} onClose={onClose} leading="flash" />

      <div className="cn-capture__stage">
        <video
          ref={videoRef}
          className={`cn-capture__video${status === 'live' ? '' : ' is-hidden'}`}
          autoPlay
          muted
          playsInline
          aria-hidden={status !== 'live'}
        />
        {status !== 'live' ? (
          <p className="cn-capture__fallback">
            {status === 'starting' ? 'פותח מצלמה…' : 'המצלמה אינה זמינה — העלו תמונה מהגלריה'}
          </p>
        ) : null}

        <div className="cn-capture__viewfinder" data-testid="viewfinder">
          <span className="cn-capture__tick cn-capture__tick--tl" aria-hidden="true" />
          <span className="cn-capture__tick cn-capture__tick--tr" aria-hidden="true" />
          <span className="cn-capture__tick cn-capture__tick--bl" aria-hidden="true" />
          <span className="cn-capture__tick cn-capture__tick--br" aria-hidden="true" />
          {status === 'live' && <span className="cn-capture__detected">✓ זוהה לוח 5×5</span>}
        </div>
      </div>

      <p className="cn-capture__align">{HINT[step]}: יישרו את הלוח בתוך המסגרת</p>

      <div className="cn-capture__bar">
        <button
          type="button"
          className="cn-capture__bar-btn"
          data-testid="btn-flip"
          onClick={flip}
          aria-label="הפוך מצלמה"
        >
          <span className="cn-capture__bar-icon" aria-hidden="true">
            ⟳
          </span>
          <small>הפוך</small>
        </button>

        <button
          type="button"
          className="cn-capture__shutter"
          data-testid="btn-shutter"
          onClick={() => void handleShutter()}
          aria-label="צלמו"
        />

        <label className="cn-capture__bar-btn cn-capture__gallery" data-testid="btn-gallery">
          <span className="cn-capture__bar-icon" aria-hidden="true">
            ▦
          </span>
          <small>גלריה</small>
          <input ref={galleryRef} type="file" accept="image/*" onChange={handleGalleryChange} />
        </label>
      </div>
    </section>
  );
}
