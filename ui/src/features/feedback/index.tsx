import type { ClueOption, Risk } from '../../types/api';

interface FeedbackControlsProps {
  option: ClueOption;
  mode: 'suggest' | 'check';
  risk: Risk;
}

export function FeedbackControls({
  option,
  mode,
  risk,
}: FeedbackControlsProps): JSX.Element {
  return (
    <div
      data-testid="stub-feedback"
      data-clue={option.word}
      data-mode={mode}
      data-risk={risk}
    >
      בקרוב
    </div>
  );
}
