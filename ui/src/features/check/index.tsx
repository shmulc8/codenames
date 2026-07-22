import { useState, type FormEvent } from 'react';

import { postCheck } from '../../api/client';
import { Button, Panel, RoleIcon, showToast } from '../../components';
import { FeedbackControls } from '../feedback';
import { boardsMatch, liveBoard, useAppStore } from '../../state/store';
import type {
  BoardPayload,
  CheckResponse,
  ClueOption,
  ReadEntry,
  Role,
  TeamColor,
} from '../../types/api';
import { rememberCheckResult } from './result-cache';
import './styles.css';

const roleLabels: Record<Role, string> = {
  red: 'אדום',
  blue: 'כחול',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
};

const targetLabels: Record<TeamColor, string> = {
  red: 'הקבוצה האדומה',
  blue: 'הקבוצה הכחולה',
};

function syntheticOption(clue: string, result: CheckResponse): ClueOption {
  return {
    word: clue,
    count: result.safe,
    intended: result.read.slice(0, result.safe).map((entry) => entry.word),
    score: 0,
    reason: '',
    read: result.read,
    leak: result.first_danger ? [result.first_danger] : [],
    safe: result.safe,
    assassin: result.assassin,
    no_clue: false,
    risky: result.first_danger !== null,
    note: '',
  };
}

function TargetControl({
  disabled,
  onChange,
  target,
}: {
  disabled: boolean;
  onChange: (target: TeamColor) => void;
  target: TeamColor;
}): JSX.Element {
  return (
    <fieldset
      className="check-target"
      data-testid="target-color"
      disabled={disabled}
    >
      <legend>בודקים עבור</legend>
      <div className="check-target__options" role="radiogroup">
        {(['red', 'blue'] as const).map((color) => (
          <label
            className={`check-target__option role-${color}${
              target === color ? ' is-active' : ''
            }`}
            key={color}
          >
            <input
              type="radio"
              name="check-target"
              value={color}
              checked={target === color}
              onChange={() => onChange(color)}
              data-testid={`target-${color}`}
            />
            <RoleIcon role={color} aria-hidden="true" />
            <span>{targetLabels[color]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RankedRow({
  entry,
  rank,
  onHover,
}: {
  entry: ReadEntry;
  rank: number;
  onHover: (word: string | null) => void;
}): JSX.Element {
  const score = Math.round(Math.max(0, Math.min(1, entry.conf)) * 100);

  return (
    <li
      className={`check-ranked__row role-${entry.role}`}
      data-testid={`ranked-row-${entry.word}`}
      onMouseEnter={() => onHover(entry.word)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(entry.word)}
      onBlur={() => onHover(null)}
      tabIndex={0}
    >
      <span className="check-ranked__rank" aria-label={`מקום ${rank}`}>
        {rank}
      </span>
      <span className="check-ranked__word">
        <RoleIcon role={entry.role} />
        {entry.word}
      </span>
      <span
        className="check-ranked__bar"
        role="meter"
        aria-label={`ציון הקרבה של ${entry.word}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
      >
        <span style={{ width: `${score}%` }} />
      </span>
      <strong data-testid={`sim-score-${entry.word}`}>{score}</strong>
    </li>
  );
}

export function CheckPanel(): JSX.Element {
  const tiles = useAppStore((state) => state.tiles);
  const risk = useAppStore((state) => state.risk);
  const target = useAppStore((state) => state.target);
  const setCheckedClue = useAppStore((state) => state.setCheckedClue);
  const setHoverWord = useAppStore((state) => state.setHoverWord);
  const setTarget = useAppStore((state) => state.setTarget);
  const [input, setInput] = useState('');
  const [submittedClue, setSubmittedClue] = useState('');
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [resultBoard, setResultBoard] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clue = input.trim();

    if (!clue) {
      setValidationMessage('כתבו מילה שתרצו לבדוק');
      return;
    }

    setValidationMessage('');
    setError(null);
    setResult(null);
    setResultBoard(null);
    setSubmittedClue('');
    setCheckedClue(null);
    setHoverWord(null);
    setLoading(true);
    try {
      const state = useAppStore.getState();
      const board = liveBoard(state);
      const response = await postCheck(board, state.target, clue);
      if (!boardsMatch(board, liveBoard(useAppStore.getState()))) {
        showToast('הלוח השתנה בזמן הבדיקה — בדקו שוב', { tone: 'error' });
        return;
      }
      setResult(response);
      setResultBoard(board);
      setSubmittedClue(clue);
      rememberCheckResult(clue, response.read);
      setCheckedClue(clue);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'לא הצלחנו לבדוק את המילה';
      setError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const assassinIsClose =
    result !== null &&
    result.assassin.rank >= 0 &&
    result.assassin.rank < result.safe + 2;

  const boardStale =
    result !== null &&
    resultBoard !== null &&
    !boardsMatch(resultBoard, liveBoard(useAppStore.getState()));

  const handleTargetChange = (color: TeamColor) => {
    if (color === target) return;
    setTarget(color);
    setResult(null);
    setResultBoard(null);
    setSubmittedClue('');
    setCheckedClue(null);
    setError(null);
  };

  return (
    <div className="check-panel" data-testid="stub-check">
      <div className="check-panel__intro">
        <p className="check-panel__privacy">בדיקה פרטית — לפני שאומרים בקול</p>
        <p>רק אתם רואים אותה. בדקו לאן הרמז שאתם שוקלים עלול להוביל.</p>
      </div>

      <TargetControl
        disabled={loading}
        target={target}
        onChange={handleTargetChange}
      />

      <form className="check-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="check-clue">המילה שאני שוקל</label>
        <input
          id="check-clue"
          className="input check-form__input"
          data-testid="check-input"
          type="text"
          dir="rtl"
          autoComplete="off"
          value={input}
          disabled={loading || tiles.length === 0}
          aria-invalid={Boolean(validationMessage)}
          aria-describedby={validationMessage ? 'check-validation' : undefined}
          onChange={(event) => {
            setInput(event.target.value);
            if (validationMessage) setValidationMessage('');
          }}
        />
        {validationMessage ? (
          <p className="check-form__validation" id="check-validation" role="alert">
            {validationMessage}
          </p>
        ) : null}
        <Button
          className="check-form__submit"
          data-testid="btn-check"
          type="submit"
          loading={loading}
          disabled={tiles.length === 0}
        >
          בדוק את הרמז
        </Button>
        {error ? (
          <p className="check-form__validation" data-testid="check-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {result ? (
        <div className="check-result" data-testid="check-result" aria-live="polite">
          {boardStale ? (
            <div
              className="check-stale"
              data-testid="check-stale"
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--cn-warn-bd)',
                background: 'var(--cn-warn-bg)',
                color: 'var(--cn-warn)',
              }}
            >
              <strong>הלוח השתנה — בדקו שוב</strong>
            </div>
          ) : null}

          {result.illegal ? (
            <div className="check-illegal" data-testid="check-illegal" role="alert">
              <strong>הרמז אינו חוקי</strong>
              <span>
                המילה הזו לא חוקית — היא מילה מהלוח או חולקת שורש עם אחת מהן
              </span>
            </div>
          ) : null}

          <div className="check-summary" aria-label="סיכום בטיחות">
            <span className="check-summary__safe">בטוח ל-{result.safe} מילים</span>
            {result.first_danger ? (
              <p>
                הסכנה הראשונה: <strong>{result.first_danger.word}</strong>{' '}
                <span className={`role-${result.first_danger.role}`}>
                  (<RoleIcon role={result.first_danger.role} />{' '}
                  {roleLabels[result.first_danger.role]})
                </span>
              </p>
            ) : (
              <p>לא נמצאה מילה מסוכנת ברשימה.</p>
            )}
            {result.assassin.word ? (
              <p className={assassinIsClose ? 'check-summary__assassin is-close' : 'check-summary__assassin'}>
                <RoleIcon role="assassin" /> המתנקש: {result.assassin.word} · מקום{' '}
                {result.assassin.rank + 1}
                {assassinIsClose ? ' — קרוב מדי לרמז' : ''}
              </p>
            ) : null}
          </div>

          <Panel
            className="check-ranked"
            title="אילו מילים זה עלול למשוך?"
            actions={<span className="check-ranked__scale">ציון קרבה (0–100)</span>}
          >
            {result.read.length ? (
              <ol className="check-ranked__list" data-testid="check-ranked-list">
                {result.read.map((entry, index) => (
                  <RankedRow
                    entry={entry}
                    rank={index + 1}
                    onHover={setHoverWord}
                    key={entry.word}
                  />
                ))}
              </ol>
            ) : (
              <p className="check-ranked__empty" data-testid="check-ranked-list">
                לא נמצאו מילים להשוואה בלוח החי.
              </p>
            )}
            <p className="check-ranked__help">
              המספרים מסמנים אילו מילים אחרות עלולות להתבלבל עם הרמז שלך
            </p>
          </Panel>

          <FeedbackControls
            key={submittedClue}
            mode="check"
            option={syntheticOption(submittedClue, result)}
            risk={risk}
          />
        </div>
      ) : null}
    </div>
  );
}
