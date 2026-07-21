import { useRef, useState } from 'react';

import { postSpymaster } from '../../api/client';
import { Button, RoleIcon, showToast } from '../../components';
import { liveBoard, useAppStore } from '../../state/store';
import type {
  ClueOption,
  Risk,
  Role,
  TeamColor,
} from '../../types/api';
import { FeedbackControls } from '../feedback';
import './clue.css';

type RequestKind = 'focused' | 'auto' | 'regenerate';

interface RequestSnapshot {
  focus?: string[];
  risk: Risk;
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
  { value: 'bold', label: 'נועז' },
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
  const target = useAppStore((state) => state.target);
  const clue = useAppStore((state) => state.clue);
  const setRisk = useAppStore((state) => state.setRisk);
  const setTarget = useAppStore((state) => state.setTarget);
  const setClueResult = useAppStore((state) => state.setClueResult);
  const setOptionIndex = useAppStore((state) => state.setOptionIndex);
  const useCurrentClue = useAppStore((state) => state.useCurrentClue);
  const [loading, setLoading] = useState<RequestKind | null>(null);
  const lastRequest = useRef<RequestSnapshot | null>(null);

  const response = clue.current;
  const options = response?.options ?? [];
  const option = options[clue.optionIndex];
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
    lastRequest.current = snapshot;

    try {
      const state = useAppStore.getState();
      const board = liveBoard(state);
      const liveFocus = snapshot.focus?.filter((word) => board.words.includes(word));
      const result = await postSpymaster(
        board,
        snapshot.target,
        liveFocus?.length ? liveFocus : undefined,
        snapshot.risk,
      );
      setClueResult(result);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'לא הצלחנו לקבל רמז',
        { tone: 'error' },
      );
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
    setOptionIndex((clue.optionIndex + delta + options.length) % options.length);
  }

  function handleRegenerate(): void {
    const snapshot = lastRequest.current;
    if (!snapshot) {
      void requestClue('auto', { risk, target });
      return;
    }
    void requestClue('regenerate', snapshot);
  }

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
            זהיר = רק רמזים בטוחים · מאוזן = כיסוי בטוח · נועז = מקסימום מילים
          </p>
        </fieldset>

        <div className="clue-actions">
          <Button
            className="clue-actions__button"
            data-testid="btn-get-clue"
            disabled={selected.length === 0 || Boolean(loading)}
            loading={loading === 'focused'}
            onClick={() =>
              void requestClue('focused', {
                focus: [...selected],
                risk,
                target,
              })
            }
          >
            קבל רמז לקלפים שבחרתי
          </Button>
          <Button
            className="clue-actions__button"
            data-testid="btn-auto-cluster"
            disabled={Boolean(loading)}
            loading={loading === 'auto'}
            variant="secondary"
            onClick={() => void requestClue('auto', { risk, target })}
          >
            מצא לי את הצירוף הכי טוב
          </Button>
        </div>
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
              <p>נסה רמת 'נועז' או בחר מילים אחרות</p>
            </div>
          ) : option?.no_clue ? (
            <div className="clue-empty" data-testid="no-clue-state" role="status">
              <strong>לא נמצא רמז בטוח</strong>
              <p>{option.note || option.reason}</p>
              <p>נסה רמת 'נועז' או בחר מילים אחרות</p>
            </div>
          ) : option ? (
            <>
              <header className="clue-result__header">
                <div>
                  <p className="clue-panel__eyebrow">הרמז המוצע</p>
                  <div className="clue-result__title-row">
                    <h3 data-testid="clue-word">{option.word}</h3>
                    <span className="clue-result__count" data-testid="clue-count">
                      מספר: {option.count}
                    </span>
                  </div>
                </div>
              </header>

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

              <div className="clue-use">
                <Button
                  data-testid="btn-use-clue"
                  disabled={isCurrentOptionUsed || clue.stale}
                  onClick={useCurrentClue}
                >
                  {isCurrentOptionUsed ? 'הרמז סומן לשימוש' : 'אני משתמש ברמז הזה'}
                </Button>
                {isCurrentOptionUsed ? (
                  <span className="clue-use__confirmation" role="status">
                    ✓ נשמר — תוצאות החשיפות יתווספו לרמז הזה
                  </span>
                ) : null}
              </div>
            </>
          ) : null}

          {option?.assassin.sim != null ? (
            <p className="clue-assassin role-assassin">
              <RoleIcon role="assassin" />
              המתנקש ({option.assassin.word}) במקום {option.assassin.rank + 1} בדירוג
            </p>
          ) : null}

          {options.length > 0 ? (
            <nav className="clue-carousel" aria-label="אפשרויות רמז">
              <Button
                data-testid="btn-next-option"
                variant="ghost"
                disabled={options.length < 2}
                aria-label="האפשרות הבאה"
                onClick={() => moveOption(1)}
              >
                הבא ‹
              </Button>
              <span data-testid="option-counter">
                אפשרות {clue.optionIndex + 1} מתוך {options.length}
              </span>
              <Button
                data-testid="btn-prev-option"
                variant="ghost"
                disabled={options.length < 2}
                aria-label="האפשרות הקודמת"
                onClick={() => moveOption(-1)}
              >
                › הקודם
              </Button>
            </nav>
          ) : null}

          {option ? (
            <FeedbackControls option={option} mode="suggest" risk={risk} />
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
