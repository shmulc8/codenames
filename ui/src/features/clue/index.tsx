import { useEffect, useRef, useState } from 'react';

import { postSpymaster } from '../../api/client';
import { Button, RoleIcon, showToast } from '../../components';
import { boardsMatch, liveBoard, useAppStore } from '../../state/store';
import type {
  ClueOption,
  Risk,
  Role,
  TeamColor,
  VocabMode,
} from '../../types/api';
import { FeedbackControls } from '../feedback';
import './clue.css';

type RequestKind = 'focused' | 'auto' | 'regenerate';

interface RequestSnapshot {
  focus?: string[];
  risk: Risk;
  vocabMode: VocabMode;
  target: TeamColor;
}

const targetLabels: Record<TeamColor, string> = {
  red: 'אדום',
  blue: 'כחול',
};

const riskOptions: Array<{
  value: Risk;
  label: string;
}> = [
  { value: 'cautious', label: 'זהיר' },
  { value: 'balanced', label: 'מאוזן' },
  { value: 'bold', label: 'שובב' },
];

const vocabOptions: Array<{
  value: VocabMode;
  label: string;
}> = [
  { value: 'curated', label: 'מומלץ' },
  { value: 'conservative', label: 'מורחב' },
];

function HoverWordChip({
  role,
  word,
}: {
  role?: Role;
  word: string;
}): JSX.Element {
  const setHoverWord = useAppStore((state) => state.setHoverWord);

  return (
    <span
      className={`clue-chip${role ? ` role-${role}` : ''}`}
      tabIndex={0}
      onMouseEnter={() => setHoverWord(word)}
      onMouseLeave={() => setHoverWord(null)}
      onFocus={() => setHoverWord(word)}
      onBlur={() => setHoverWord(null)}
    >
      {role ? <RoleIcon role={role} /> : null}
      {word}
    </span>
  );
}

function RankedRead({ option }: { option: ClueOption }): JSX.Element {
  return (
    <section className="clue-ranking" aria-labelledby="clue-ranking-title">
      <div className="clue-ranking__header">
        <h4 id="clue-ranking-title">איך הרמז נקרא על הלוח</h4>
        <span>ציון קרבה 0–100</span>
      </div>
      <ol className="clue-ranking__list">
        {option.read.slice(0, 8).map((entry) => {
          const score = Math.round(Math.max(0, Math.min(1, entry.conf)) * 100);
          return (
            <li className={`clue-ranking__row role-${entry.role}`} key={entry.word}>
              <span className="clue-ranking__word">
                <RoleIcon role={entry.role} />
                {entry.word}
              </span>
              <span
                className="clue-ranking__track"
                role="meter"
                aria-label={`קרבה של ${entry.word}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score}
              >
                <span
                  className="clue-ranking__fill"
                  style={{ width: `${score}%` }}
                />
              </span>
              <span className="clue-ranking__score">{score}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function CluePanel(): JSX.Element {
  const tiles = useAppStore((state) => state.tiles);
  const selected = useAppStore((state) => state.selected);
  const risk = useAppStore((state) => state.risk);
  const vocabMode = useAppStore((state) => state.vocabMode);
  const target = useAppStore((state) => state.target);
  const clue = useAppStore((state) => state.clue);
  const setRisk = useAppStore((state) => state.setRisk);
  const setVocabMode = useAppStore((state) => state.setVocabMode);
  const setTarget = useAppStore((state) => state.setTarget);
  const setClueResult = useAppStore((state) => state.setClueResult);
  const selectSuggested = useAppStore((state) => state.selectSuggested);
  const setOptionIndex = useAppStore((state) => state.setOptionIndex);
  const useCurrentClue = useAppStore((state) => state.useCurrentClue);
  const [loading, setLoading] = useState<RequestKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasMounted = useRef(false);

  const response = clue.current;
  // Show every option the engine returns (best-first, already MMR-diversified), minus any that
  // cover none of the target cards — a "clue for nothing" is noise, not a suggestion.
  const allOptions = response?.options ?? [];
  const withCoverage = allOptions.filter((candidate) => candidate.count >= 1);
  const options = withCoverage.length > 0 ? withCoverage : allOptions;
  const optionIndex = Math.min(clue.optionIndex, options.length - 1);
  const option = options[optionIndex];
  const selectedRoles = Object.fromEntries(
    tiles.map((tile) => [tile.word, tile.role]),
  );
  const selectedLabel = targetLabels[target];
  const isCurrentOptionUsed = clue.used?.option === option;
  const hasTopLevelEmptyState = Boolean(response?.error) && !option;

  async function requestClue(
    kind: RequestKind,
    snapshot: RequestSnapshot,
  ): Promise<void> {
    if (loading) return;

    setLoading(kind);
    setError(null);

    try {
      const state = useAppStore.getState();
      const board = liveBoard(state);
      const liveFocus = snapshot.focus?.filter((word) => board.words.includes(word));
      const result = await postSpymaster(
        board,
        snapshot.target,
        liveFocus?.length ? liveFocus : undefined,
        snapshot.risk,
        snapshot.vocabMode,
      );
      const boardChanged = !boardsMatch(
        board,
        liveBoard(useAppStore.getState()),
      );
      setClueResult(result, boardChanged);

      // "Find the best combination" is an engine-led flow: mirror the exact targets
      // of the option the engine chose on the board, so they can immediately inspect
      // or refine that combination. Focused requests preserve the user's selection.
      if (
        !boardChanged &&
        (kind === 'auto' || (kind === 'regenerate' && !snapshot.focus?.length))
      ) {
        const picked = result.picked ?? 0;
        const option = result.options[picked] ?? result.options[0];
        selectSuggested(option?.intended ?? [], snapshot.target);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'לא הצלחנו לקבל רמז';
      setError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setLoading(null);
    }
  }

  function handleTargetChange(color: TeamColor): void {
    if (color === target || loading) return;
    setTarget(color);
    setClueResult(null);
  }

  function moveOption(delta: number): void {
    if (options.length < 2) return;
    const nextIndex = (optionIndex + delta + options.length) % options.length;
    setOptionIndex(nextIndex);
    selectSuggested(options[nextIndex]?.intended ?? [], target);
  }

  function buildSnapshot(): RequestSnapshot {
    return {
      focus: [...selected],
      risk,
      vocabMode,
      target,
    };
  }

  function handleRegenerate(): void {
    void requestClue('regenerate', buildSnapshot());
  }

  // Risk/vocab dials should feel live: if a result is already on screen, changing
  // either setting re-runs the last request with the new settings automatically.
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (!clue.current || loading) return;
    void requestClue('regenerate', buildSnapshot());
  }, [risk, vocabMode]);

  return (
    <div className="clue-panel" data-testid="stub-clue">
      <section className="clue-builder" aria-labelledby="clue-builder-title">
        <div className="clue-builder__heading">
          <div>
            <p className="clue-panel__eyebrow">בניית רמז</p>
            <h2 id="clue-builder-title">רמז עבור איזו קבוצה?</h2>
          </div>
          <div
            className="clue-target seg"
            data-testid="target-color"
            role="group"
            aria-label="בחירת צבע הקבוצה"
          >
            {(['red', 'blue'] as const).map((color) => (
              <button
                key={color}
                type="button"
                className={`clue-target__option role-${color}`}
                data-testid={`target-${color}`}
                aria-pressed={target === color}
                disabled={Boolean(loading)}
                onClick={() => handleTargetChange(color)}
              >
                <RoleIcon role={color} />
                {targetLabels[color]}
              </button>
            ))}
          </div>
        </div>

        <div className="clue-selection" aria-live="polite">
          <div className="clue-selection__summary">
            <span>הקלפים שבחרתי · {selected.length}</span>
            {selected.length > 0 ? (
              <span className={`clue-selection__color role-${target}`}>
                <RoleIcon role={target} />
                נבחרו: {selected.length} קלפים בצבע {selectedLabel}
              </span>
            ) : (
              <span>לא נבחרו קלפים — אפשר לתת למנוע לבחור צירוף.</span>
            )}
          </div>
          {selected.length > 0 ? (
            <div className="clue-chip-list" aria-label="קלפים שנבחרו">
              {selected.map((word) => (
                <HoverWordChip key={word} word={word} role={selectedRoles[word]} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="clue-dials">
          <fieldset className="clue-risk" data-testid="risk-dial" disabled={Boolean(loading)}>
            <legend>כמה להעז?</legend>
            <div className="clue-risk__options seg">
              {riskOptions.map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  className="clue-risk__option"
                  data-testid={`risk-${value}`}
                  aria-pressed={risk === value}
                  onClick={() => setRisk(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="clue-risk__help">
              זהיר = רק רמזים בטוחים · מאוזן = כיסוי בטוח · שובב = מקסימום מילים
            </p>
          </fieldset>

          <div className="clue-vocab" data-testid="vocab-dial">
            <label className="clue-vocab__label" htmlFor="clue-vocab-select">
              אוצר מילים לרמזים
            </label>
            <select
              id="clue-vocab-select"
              className="clue-vocab__select"
              data-testid="vocab-select"
              value={vocabMode}
              disabled={Boolean(loading)}
              onChange={(event) => setVocabMode(event.target.value as VocabMode)}
            >
              {vocabOptions.map(({ label, value }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="clue-vocab__help">
              מומלץ = רשימה אצורה ואיכותית · מורחב = רשימת תדירות רחבה יותר
            </p>
          </div>
        </div>

        <div className="clue-actions">
          <Button
            className="clue-actions__button"
            data-testid="btn-get-clue"
            disabled={Boolean(loading)}
            loading={loading === 'focused' || loading === 'auto'}
            onClick={() =>
              selected.length > 0
                ? void requestClue('focused', {
                    focus: [...selected],
                    risk,
                    vocabMode,
                    target,
                  })
                : void requestClue('auto', { risk, vocabMode, target })
            }
          >
            {selected.length > 0
              ? 'קבל רמז לקלפים שבחרתי'
              : 'מצא לי את הצירוף הכי טוב'}
          </Button>
        </div>

        {error ? (
          <p className="clue-error" data-testid="clue-error-inline" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {option || hasTopLevelEmptyState ? (
        <section className="clue-result" data-testid="clue-result" aria-live="polite">
          {clue.stale ? (
            <div className="clue-stale" role="status">
              <div>
                <strong>הלוח השתנה — הרמז חושב על לוח ישן</strong>
                <span>כדאי לחשב שוב לפני שמשתמשים בו.</span>
              </div>
              <Button
                variant="secondary"
                loading={loading === 'regenerate'}
                disabled={Boolean(loading)}
                onClick={handleRegenerate}
              >
                חשבו שוב
              </Button>
            </div>
          ) : null}

          {hasTopLevelEmptyState ? (
            <div className="clue-empty" data-testid="no-clue-state" role="status">
              <strong>לא נמצא רמז מתאים</strong>
              <p>{response?.error}</p>
              <p>נסה רמת 'שובב' או בחר מילים אחרות</p>
            </div>
          ) : option?.no_clue ? (
            <div className="clue-empty" data-testid="no-clue-state" role="status">
              <strong>לא נמצא רמז בטוח</strong>
              <p>
                הניסיון הקרוב ביותר שנפסל:{' '}
                <strong data-testid="rejected-clue-word">{option.word}</strong>
              </p>
              <p>{option.note || option.reason}</p>
              <p>נסה רמת 'שובב' או בחר מילים אחרות</p>
              <RankedRead option={option} />
            </div>
          ) : option ? (
            <>
              <header className="clue-result__header">
                <div>
                  <p className="clue-panel__eyebrow">הרמז המוצע</p>
                  <div className="clue-result__title-row">
                    <h3 data-testid="clue-word">{option.word}</h3>
                    <button
                      type="button"
                      className="clue-result__use-button"
                      data-testid="btn-use-clue"
                      aria-label={
                        isCurrentOptionUsed
                          ? 'הרמז סומן לשימוש'
                          : 'סמנו שאשתמש ברמז הזה'
                      }
                      aria-pressed={isCurrentOptionUsed}
                      title={
                        isCurrentOptionUsed
                          ? 'הרמז סומן לשימוש'
                          : 'אני משתמש ברמז הזה'
                      }
                      disabled={isCurrentOptionUsed || clue.stale}
                      onClick={useCurrentClue}
                    >
                      <span aria-hidden="true">{isCurrentOptionUsed ? '♥' : '♡'}</span>
                    </button>
                    <span className="clue-result__count" data-testid="clue-count">
                      מספר: {option.count}
                    </span>
                  </div>
                </div>
              </header>

              {options.length > 1 ? (
                <nav className="clue-carousel" aria-label="אפשרויות רמז">
                  <Button
                    data-testid="btn-next-option"
                    variant="ghost"
                    aria-label="האפשרות הבאה"
                    onClick={() => moveOption(1)}
                  >
                    <span className="clue-carousel__chevron" aria-hidden="true">‹</span>
                    <span data-testid="next-option-label">הבא</span>
                  </Button>
                  <span data-testid="option-counter">
                    אפשרות {optionIndex + 1} מתוך {options.length}
                  </span>
                  <Button
                    data-testid="btn-prev-option"
                    variant="ghost"
                    aria-label="האפשרות הקודמת"
                    onClick={() => moveOption(-1)}
                  >
                    <span data-testid="prev-option-label">הקודם</span>
                    <span className="clue-carousel__chevron" aria-hidden="true">›</span>
                  </Button>
                </nav>
              ) : null}

              <div className="clue-intended">
                <span>מכוון אל</span>
                <div className="clue-chip-list">
                  {option.intended.map((word) => (
                    <HoverWordChip
                      key={word}
                      word={word}
                      role={selectedRoles[word]}
                    />
                  ))}
                </div>
              </div>

              <p className="clue-reason" data-testid="clue-reason">
                {option.reason}
              </p>

              {option.risky ? (
                <aside className="clue-warning" data-testid="warning-banner" role="alert">
                  <strong>זהירות — יש קרבה למילים שאינן של הקבוצה</strong>
                  <p>{option.note}</p>
                  {option.leak.length > 0 ? (
                    <div className="clue-chip-list" aria-label="מילים בסיכון">
                      {option.leak.map((entry) => (
                        <HoverWordChip
                          key={entry.word}
                          word={entry.word}
                          role={entry.role}
                        />
                      ))}
                    </div>
                  ) : null}
                </aside>
              ) : null}

              <RankedRead option={option} />

              {isCurrentOptionUsed ? (
                <span className="sr-only" role="status">
                  הרמז סומן לשימוש
                </span>
              ) : null}
            </>
          ) : null}

          {option?.assassin.sim != null ? (
            <p className="clue-assassin role-assassin">
              <RoleIcon role="assassin" />
              המתנקש ({option.assassin.word}) במקום {option.assassin.rank + 1} בדירוג
            </p>
          ) : null}

          {options.length > 0 ? (
            <details className="clue-candidates" data-testid="clue-candidates">
              <summary>המועמדים של המנוע ({options.length})</summary>
              <ol className="clue-candidates__list">
                {options.map((candidate, index) => (
                  <li key={`${candidate.word}-${index}`}>
                    <button
                      type="button"
                      className="clue-candidates__row"
                      data-testid={`candidate-${index}`}
                      aria-current={index === optionIndex}
                      onClick={() => {
                        setOptionIndex(index);
                        selectSuggested(candidate.intended, target);
                      }}
                    >
                      <span className="clue-candidates__rank">#{index + 1}</span>
                      <span className="clue-candidates__word">{candidate.word}</span>
                      <span className="clue-candidates__intended">
                        {candidate.intended.join(', ')}
                      </span>
                      <span className="clue-candidates__score">
                        {candidate.score.toFixed(2)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          {option ? (
            <FeedbackControls key={option.word} option={option} mode="suggest" risk={risk} />
          ) : null}
        </section>
      ) : (
        <section className="clue-placeholder" aria-label="לפני יצירת רמז">
          <span aria-hidden="true">✦</span>
          <div>
            <strong>הרמז הבא מתחיל כאן</strong>
            <p>בחרו קלפים מאותו צבע, או תנו למנוע למצוא צירוף בטוח.</p>
          </div>
        </section>
      )}
    </div>
  );
}
