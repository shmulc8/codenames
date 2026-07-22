import { useState, type FormEvent } from 'react';

import { postOperative } from '../../api/client';
import { Button, showToast } from '../../components';
import { liveBoard, useAppStore } from '../../state/store';
import type { OperativeRankEntry, OperativeResponse } from '../../types/api';
import './operative.css';

const MIN_COUNT = 1;
const MAX_COUNT = 9;

function RankedGuess({ ranking }: { ranking: OperativeRankEntry[] }): JSX.Element {
  return (
    <section className="operative-ranking" aria-labelledby="operative-ranking-title">
      <div className="operative-ranking__header">
        <h4 id="operative-ranking-title">איך הרמז נקרא על הלוח</h4>
        <span>ציון קרבה 0–100</span>
      </div>
      <ol className="operative-ranking__list" data-testid="operative-ranking-list">
        {ranking.map((entry) => {
          const score = Math.round(Math.max(0, Math.min(1, entry.conf)) * 100);
          return (
            <li className="operative-ranking__row" key={entry.word}>
              <span className="operative-ranking__word">{entry.word}</span>
              <span
                className="operative-ranking__track"
                role="meter"
                aria-label={`קרבה של ${entry.word}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score}
              >
                <span className="operative-ranking__fill" style={{ width: `${score}%` }} />
              </span>
              <span className="operative-ranking__score">{score}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function OperativePanel(): JSX.Element {
  const tiles = useAppStore((state) => state.tiles);
  const vocabMode = useAppStore((state) => state.vocabMode);
  const [clueInput, setClueInput] = useState('');
  const [count, setCount] = useState(1);
  const [result, setResult] = useState<OperativeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function adjustCount(delta: number): void {
    setCount((current) => Math.min(MAX_COUNT, Math.max(MIN_COUNT, current + delta)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const clue = clueInput.trim();
    if (!clue || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const board = liveBoard(useAppStore.getState());
      const response = await postOperative(board, clue, count, vocabMode);
      setResult(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'לא הצלחנו לקבל הצעת ניחוש';
      setError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="operative-panel" data-testid="stub-operative">
      <form className="operative-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div>
          <label htmlFor="operative-clue">הרמז שקיבלתי</label>
          <input
            id="operative-clue"
            className="input operative-form__input"
            data-testid="operative-clue-input"
            type="text"
            dir="rtl"
            autoComplete="off"
            value={clueInput}
            disabled={loading || tiles.length === 0}
            onChange={(event) => setClueInput(event.target.value)}
          />
        </div>

        <fieldset className="operative-count" data-testid="operative-count" disabled={loading}>
          <legend id="operative-count-label">כמה מילים ברמז</legend>
          <div className="operative-count__control">
            <button
              type="button"
              className="operative-count__step"
              data-testid="operative-count-decrement"
              aria-label="הפחת מספר מילים"
              disabled={count <= MIN_COUNT}
              onClick={() => adjustCount(-1)}
            >
              −
            </button>
            <span
              className="operative-count__value"
              data-testid="operative-count-value"
              aria-live="polite"
            >
              {count}
            </span>
            <button
              type="button"
              className="operative-count__step"
              data-testid="operative-count-increment"
              aria-label="הוסף מספר מילים"
              disabled={count >= MAX_COUNT}
              onClick={() => adjustCount(1)}
            >
              +
            </button>
          </div>
        </fieldset>

        <Button
          className="operative-form__submit"
          data-testid="btn-operative"
          type="submit"
          loading={loading}
          disabled={tiles.length === 0 || !clueInput.trim()}
        >
          מה כדאי לנחש?
        </Button>
      </form>

      {error ? (
        <p className="operative-error" role="alert" data-testid="operative-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="operative-result" data-testid="operative-result" aria-live="polite">
          <header className="operative-result__header">
            <p className="operative-panel__eyebrow">ההצעה שהתקבלה</p>
            <h3>
              רמז: <span data-testid="operative-result-clue">{result.clue}</span>
            </h3>
          </header>

          {result.picks.length > 0 ? (
            <div className="operative-picks">
              <span>לפי סדר עדיפות לניחוש</span>
              <ol className="operative-picks__list" data-testid="operative-picks-list">
                {result.picks.map((word, index) => (
                  <li key={word} data-testid={`operative-pick-${index}`}>
                    <span className="operative-picks__rank">{index + 1}</span>
                    {word}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="operative-empty" data-testid="operative-empty">
              לא נמצאו הצעות ניחוש עבור הרמז הזה.
            </p>
          )}

          {result.agree_with ? (
            <p className="operative-agreement" data-testid="operative-agreement">
              {result.agree_with} מסכים על {result.agreement ?? 0} מתוך {result.count}
            </p>
          ) : null}

          {result.ranking.length > 0 ? <RankedGuess ranking={result.ranking} /> : null}
        </section>
      ) : (
        <section className="operative-placeholder" aria-label="לפני קבלת הצעת ניחוש">
          <span aria-hidden="true">✦</span>
          <div>
            <strong>ההצעה הבאה מתחילה כאן</strong>
            <p>הקלידו את הרמז שקיבלתם ואת מספר המילים כדי לראות סדר ניחוש מומלץ.</p>
          </div>
        </section>
      )}
    </div>
  );
}
