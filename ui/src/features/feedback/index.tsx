import { useEffect, useRef, useState } from 'react';

import { fullBoard, useAppStore, type UsedClue } from '../../state/store';
import type { ClueOption, FeedbackPayload, RevealedEntry, Risk } from '../../types/api';
import { enqueueFeedback } from './queue';
import './feedback.css';

interface FeedbackControlsProps {
  option: ClueOption;
  mode: 'suggest' | 'check';
  risk: Risk;
}

type Verdict = 'up' | 'down';
type Why = NonNullable<FeedbackPayload['why']>;
type SendState = 'idle' | 'sending' | 'sent';

const whyOptions: ReadonlyArray<{ value: Why; label: string }> = [
  { value: 'opposite', label: 'הפוך' },
  { value: 'vague', label: 'מעורפל' },
  { value: 'wrong', label: 'שגוי' },
  { value: 'risky', label: 'מסוכן' },
  { value: 'overreach', label: 'מוגזם' },
];

const OUTCOME_DEBOUNCE_MS = 5_000;
const sentRevealCounts = new Map<number, number>();

export function getUid(): string {
  const existing = window.localStorage.getItem('cn-uid');
  if (existing) return existing;

  const uid =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem('cn-uid', uid);
  return uid;
}

function currentRevealed(): RevealedEntry[] {
  return useAppStore
    .getState()
    .tiles.filter((tile) => tile.lifecycle === 'chosen')
    .map((tile) => ({
      word: tile.word,
      chosenBy: tile.chosenBy ?? tile.role,
    }));
}

function buildFeedbackPayload(
  option: ClueOption,
  mode: 'suggest' | 'check',
  risk: Risk,
  verdict: Verdict,
  why?: Why,
  comment?: string,
): FeedbackPayload {
  const state = useAppStore.getState();
  const trimmedComment = comment?.trim();

  return {
    uid: getUid(),
    verdict,
    mode,
    target: state.target,
    risk,
    clue: option.word,
    count: option.count,
    intended: option.intended,
    focus: [...state.selected],
    board: fullBoard(state),
    revealed: currentRevealed(),
    option,
    ...(why ? { why } : {}),
    ...(trimmedComment ? { comment: trimmedComment } : {}),
  };
}

export function FeedbackControls({ option, mode, risk }: FeedbackControlsProps): JSX.Element {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [why, setWhy] = useState<Why | null>(null);
  const [comment, setComment] = useState('');
  const [sendState, setSendState] = useState<SendState>('idle');

  useEffect(() => {
    setVerdict(null);
    setWhy(null);
    setComment('');
    setSendState('idle');
  }, [option.word]);

  const submit = async (
    nextVerdict: Verdict,
    nextWhy?: Why,
    nextComment?: string,
  ): Promise<void> => {
    setSendState('sending');
    await enqueueFeedback(
      buildFeedbackPayload(option, mode, risk, nextVerdict, nextWhy, nextComment),
    );
    setSendState('sent');
  };

  const handleLike = (): void => {
    setVerdict('up');
    void submit('up');
  };

  const handleDislike = (): void => {
    setVerdict('down');
    setSendState('idle');
  };

  const handleWhy = (nextWhy: Why): void => {
    setWhy(nextWhy);
    void submit('down', nextWhy);
  };

  const saveComment = (): void => {
    if (!verdict || (verdict === 'down' && !why)) return;
    void submit(verdict, why ?? undefined, comment);
  };

  const locked = verdict !== null;

  return (
    <section
      className="feedback-controls"
      aria-label={`משוב על הרמז ${option.word}`}
      aria-busy={sendState === 'sending'}
    >
      <div className="feedback-controls__gut-check">
        <span className="feedback-controls__prompt">עזר?</span>
        <button
          type="button"
          className="feedback-controls__vote"
          data-testid="btn-like"
          aria-label="הרמז עזר"
          aria-pressed={verdict === 'up'}
          disabled={locked}
          onClick={handleLike}
        >
          <span aria-hidden="true">👍</span>
        </button>
        <button
          type="button"
          className="feedback-controls__vote"
          data-testid="btn-dislike"
          aria-label="הרמז לא עזר"
          aria-pressed={verdict === 'down'}
          disabled={locked}
          onClick={handleDislike}
        >
          <span aria-hidden="true">👎</span>
        </button>
      </div>

      {verdict === 'down' ? (
        <div className="feedback-controls__details" data-testid="feedback-why">
          <p className="feedback-controls__question">מה לא עבד? בחרו סיבה</p>
          <div className="feedback-controls__reasons" role="group" aria-label="סיבת המשוב">
            {whyOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className="feedback-controls__reason"
                aria-pressed={why === item.value}
                disabled={why !== null}
                onClick={() => handleWhy(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {verdict !== null && (verdict === 'up' || why !== null) ? (
        <div className="feedback-controls__comment-row">
          <label htmlFor={`feedback-comment-${option.word}`}>ספרו לנו עוד — לא חובה</label>
          <div className="feedback-controls__comment-actions">
            <textarea
              id={`feedback-comment-${option.word}`}
              className="input feedback-controls__comment"
              data-testid="feedback-comment"
              rows={2}
              value={comment}
              placeholder="הערה קצרה שתעזור לנו להשתפר"
              onChange={(event) => setComment(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary feedback-controls__comment-submit"
              disabled={!comment.trim() || sendState === 'sending'}
              onClick={saveComment}
            >
              שמירת הערה
            </button>
          </div>
        </div>
      ) : null}

      {sendState === 'sending' ? (
        <p className="feedback-controls__status" role="status">
          <span
            className="feedback-controls__spinner"
            data-testid="loading-spinner"
            aria-hidden="true"
          />
          שומרים את המשוב…
        </p>
      ) : null}

      {sendState === 'sent' ? (
        <p className="feedback-controls__sent" data-testid="feedback-sent" role="status">
          <span aria-hidden="true">✓</span>
          תודה! זה עוזר לאמן את המודל
        </p>
      ) : null}
    </section>
  );
}

function markOutcomeSent(used: UsedClue): void {
  useAppStore.setState((state) => {
    const currentUsed =
      state.clue.used?.ts === used.ts ? { ...state.clue.used, outcomeSent: true } : state.clue.used;

    return {
      clue: { ...state.clue, used: currentUsed },
      log: state.log.map((entry) =>
        entry.ts === used.ts ? { ...entry, outcomeSent: true } : entry,
      ),
    };
  });
}

async function reportOutcome(used: UsedClue): Promise<void> {
  const revealCount = used.revealedAfter.length;
  if (revealCount === 0 || (sentRevealCounts.get(used.ts) ?? 0) >= revealCount) return;

  sentRevealCounts.set(used.ts, revealCount);
  await enqueueFeedback({
    uid: getUid(),
    verdict: 'outcome',
    mode: 'outcome',
    target: used.target,
    risk: used.risk,
    clue: used.clue,
    count: used.count,
    intended: used.intended,
    board: used.board,
    revealed: used.revealedAfter,
    option: used.option,
  });
  markOutcomeSent(used);
}

export function OutcomeReporter(): null {
  const used = useAppStore((state) => state.clue.used);
  const previousUsedRef = useRef<UsedClue | null>(used);
  const latestUsedRef = useRef<UsedClue | null>(used);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const previous = previousUsedRef.current;
    latestUsedRef.current = used;

    if (previous && previous.ts !== used?.ts) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void reportOutcome(previous);
    }

    previousUsedRef.current = used;

    if (!used || used.revealedAfter.length === 0) return;
    if ((sentRevealCounts.get(used.ts) ?? 0) >= used.revealedAfter.length) return;

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const latest = useAppStore.getState().clue.used;
      if (latest?.ts === used.ts) void reportOutcome(latest);
    }, OUTCOME_DEBOUNCE_MS);
  }, [used, used?.revealedAfter.length]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const latest = latestUsedRef.current;
      if (latest) void reportOutcome(latest);
    },
    [],
  );

  return null;
}
