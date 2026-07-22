import { CaptureHeader } from './CaptureHeader';
import { ReviewFooter } from './ReviewFooter';
import { wordsComplete } from './keyGrid';

interface WordReviewProps {
  words: string[];
  confidences: number[];
  onChange: (index: number, value: string) => void;
  onUse: () => void;
  onRetake: () => void;
  onGallery: (file: File) => void;
  onClose: () => void;
}

const LOW_CONFIDENCE = 60;

export function WordReview({
  words,
  confidences,
  onChange,
  onUse,
  onRetake,
  onGallery,
  onClose,
}: WordReviewProps): JSX.Element {
  const canUse = wordsComplete(words);
  const hasLowConfidence = confidences.some(
    (confidence, index) =>
      confidence < LOW_CONFIDENCE || words[index].trim().length === 0,
  );

  return (
    <section className="cn-capture__review">
      <CaptureHeader
        step={1}
        title="בדקו את הקליטה"
        onClose={onClose}
        onRetake={onRetake}
      />

      <div className="cn-capture__review-body">
        <span className="cn-capture__badge">⛶ זוהו 25 מילים</span>

        <div className="cn-capture__grid cn-capture__grid--words" data-testid="review-grid">
          {words.map((word, index) => (
            <input
              key={index}
              data-testid={`review-cell-${index}`}
              className={`cn-capture__cell cn-capture__cell--word ${
                confidences[index] < LOW_CONFIDENCE || word.trim().length === 0
                  ? 'is-low-confidence'
                  : ''
              }`}
              value={word}
              aria-label={`מילה ${index + 1}`}
              onChange={(event) => onChange(index, event.target.value)}
            />
          ))}
        </div>

        <p className="cn-capture__hint">
          👆 הקישו על מילה כדי לתקן אותה לפני שממשיכים
        </p>

        {hasLowConfidence && (
          <p className="cn-capture__warn" role="status">
            ⚠ מילים מסומנות בצהוב אינן ודאיות — אשרו או תקנו
          </p>
        )}

        {!canUse && (
          <p className="cn-capture__validation" role="alert">
            צריך 25 מילים ייחודיות ולא ריקות כדי להמשיך
          </p>
        )}

        <p className="cn-capture__next-note">🔑 אחרי אישור המילים — נצלם את כרטיס המפתח (שלב 2)</p>
      </div>

      <ReviewFooter
        canUse={canUse}
        onUse={onUse}
        onRetake={onRetake}
        onGallery={onGallery}
      />
    </section>
  );
}
