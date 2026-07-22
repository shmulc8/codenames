interface ProcessingOverlayProps {
  progress: number;
  label: string;
}

export function ProcessingOverlay({
  progress,
  label,
}: ProcessingOverlayProps): JSX.Element {
  return (
    <div className="cn-capture__processing" role="status">
      <span className="cn-capture__spinner" data-testid="loading-spinner" />
      <p>
        {label}
        {progress > 0 ? ` ${progress}%` : ''}
      </p>
    </div>
  );
}
