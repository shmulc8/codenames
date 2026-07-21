import { useMemo, useState } from 'react';

import { Panel, RoleIcon } from '../../components';
import { useAppStore, type UsedClue } from '../../state/store';
import type { Risk } from '../../types/api';
import { OutcomeReporter } from '../feedback';
import './log.css';

const riskLabel: Record<Risk, string> = {
  cautious: 'זהיר',
  balanced: 'מאוזן',
  bold: 'נועז',
};

const timeFormatter = new Intl.DateTimeFormat('he-IL', {
  hour: '2-digit',
  minute: '2-digit',
});

function LogEntry({ entry, index, repeated }: { entry: UsedClue; index: number; repeated: boolean }): JSX.Element {
  return (
    <article className="session-log__entry" data-testid={`log-entry-${index}`}>
      <header className="session-log__entry-header">
        <div className="session-log__clue-line">
          <strong>{entry.clue}</strong>
          <span className="session-log__count" aria-label={`${entry.count} קלפים`}>
            {entry.count}
          </span>
        </div>
        <time dateTime={new Date(entry.ts).toISOString()}>{timeFormatter.format(entry.ts)}</time>
      </header>

      <div className="session-log__meta">
        <span className={`session-log__team role-${entry.target}`}>
          <RoleIcon role={entry.target} />
          צוות {entry.target === 'red' ? 'אדום' : 'כחול'}
        </span>
        <span>{riskLabel[entry.risk]}</span>
        {repeated ? <span className="session-log__repeat">כבר השתמשת ברמז הזה</span> : null}
      </div>

      {entry.intended.length > 0 ? (
        <div className="session-log__intended" aria-label="מילות המטרה">
          {entry.intended.map((word) => (
            <span className="tag tag-outline" key={word}>{word}</span>
          ))}
        </div>
      ) : null}

      <div className="session-log__outcome" aria-label="תוצאת הרמז">
        {entry.revealedAfter.length === 0 ? (
          <span className="session-log__pending">ממתין לקלפים שייחשפו</span>
        ) : (
          entry.revealedAfter.map((reveal, revealIndex) => {
            const isTarget = reveal.chosenBy === entry.target;
            const tone = reveal.chosenBy === 'assassin' ? 'danger' : isTarget ? 'correct' : 'miss';
            return (
              <span
                className={`session-log__reveal session-log__reveal--${tone}`}
                key={`${reveal.word}-${revealIndex}`}
              >
                <RoleIcon role={reveal.chosenBy} />
                {reveal.word}
              </span>
            );
          })
        )}
      </div>
    </article>
  );
}

export function SessionLog(): JSX.Element {
  const [open, setOpen] = useState(true);
  const log = useAppStore((state) => state.log);
  const currentClueWord = useAppStore((state) => {
    const option = state.clue.current?.options[state.clue.optionIndex];
    return option?.word ?? null;
  });
  const newestFirst = useMemo(() => [...log].reverse(), [log]);

  return (
    <div className="session-log-slot" data-testid="stub-log">
      <OutcomeReporter />
      <Panel
        className="session-log"
        data-testid="session-log"
        title={
          <button
            type="button"
            className="session-log__toggle"
            data-testid="log-toggle"
            aria-expanded={open}
            aria-controls="session-log-content"
            onClick={() => setOpen((value) => !value)}
          >
            <span>יומן רמזים</span>
            <span className="session-log__total" aria-label={`${log.length} רמזים`}>{log.length}</span>
            <span className="session-log__chevron" aria-hidden="true">⌄</span>
          </button>
        }
      >
        <div id="session-log-content" hidden={!open}>
          {newestFirst.length === 0 ? (
            <p className="session-log__empty">עוד לא ניתנו רמזים במשחק הזה</p>
          ) : (
            <div className="session-log__list">
              {newestFirst.map((entry, index) => (
                <LogEntry
                  key={`${entry.ts}-${entry.clue}`}
                  entry={entry}
                  index={index}
                  repeated={currentClueWord === entry.clue}
                />
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
