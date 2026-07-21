import { postFeedback } from '../../api/client';
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

export async function enqueueFeedback(payload: FeedbackPayload): Promise<void> {
  try {
    await postFeedback(payload);
  } catch {
    pending.push(payload);
    scheduleRetry();
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
    } catch {
      failed.push(payload);
    }
  }

  pending.unshift(...failed);
  flushing = false;

  if (pending.length > 0) scheduleRetry();
}
