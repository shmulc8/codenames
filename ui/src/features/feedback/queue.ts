import { ApiError, postFeedback } from '../../api/client';
import type { FeedbackPayload } from '../../types/api';

const RETRY_INTERVAL_MS = 30_000;
const pending: FeedbackPayload[] = [];
let retryTimer: number | null = null;
let flushing = false;

function scheduleRetry(): void {
  if (retryTimer !== null || pending.length === 0) return;

  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void flushFeedbackQueue();
  }, RETRY_INTERVAL_MS);
}

export type FeedbackOutcome = 'accepted' | 'queued' | 'rejected';

// A 4xx (other than timeout / rate limit) means the server will never accept this payload,
// so retrying is pointless. Network errors and 5xx are worth retrying.
function isPermanentRejection(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

export async function enqueueFeedback(payload: FeedbackPayload): Promise<FeedbackOutcome> {
  try {
    await postFeedback(payload);
    return 'accepted';
  } catch (error) {
    if (isPermanentRejection(error)) return 'rejected';
    pending.push(payload);
    scheduleRetry();
    return 'queued';
  }
}

export async function flushFeedbackQueue(): Promise<void> {
  if (flushing || pending.length === 0) return;
  flushing = true;

  const batch = pending.splice(0, pending.length);
  const failed: FeedbackPayload[] = [];

  for (const payload of batch) {
    try {
      await postFeedback(payload);
    } catch (error) {
      if (!isPermanentRejection(error)) failed.push(payload);
    }
  }

  pending.unshift(...failed);
  flushing = false;

  if (pending.length > 0) scheduleRetry();
}
