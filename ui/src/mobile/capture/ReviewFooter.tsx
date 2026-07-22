import type { ChangeEvent } from 'react';

interface ReviewFooterProps {
  canUse: boolean;
  onUse: () => void;
  onRetake: () => void;
  onGallery: (file: File) => void;
}

export function ReviewFooter({
  canUse,
  onUse,
  onRetake,
  onGallery,
}: ReviewFooterProps): JSX.Element {
  function handleGalleryChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onGallery(file);
  }

  return (
    <footer className="cn-capture__footer">
      <button
        type="button"
        className="btn btn-primary cn-capture__use"
        data-testid="btn-use-photo"
        disabled={!canUse}
        onClick={onUse}
      >
        ✓ השתמשו בתמונה הזו
      </button>

      <div className="cn-capture__footer-row">
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="btn-retake"
          onClick={onRetake}
        >
          ⟲ צלמו שוב
        </button>

        <label className="btn btn-secondary cn-capture__gallery">
          ▦ מהגלריה
          <input type="file" accept="image/*" onChange={handleGalleryChange} />
        </label>
      </div>
    </footer>
  );
}
