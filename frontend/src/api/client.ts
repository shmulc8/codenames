import type {
  CheckRequest,
  CheckResponse,
  DealResponse,
  FeedbackRequest,
  FeedbackResponse,
  HealthResponse,
  OperativeRequest,
  OperativeResponse,
  SpaceRequest,
  SpaceResponse,
  SpymasterRequest,
  SpymasterResponse,
} from './types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body: unknown = await response.json()

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`
    throw new Error(message)
  }

  return body as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  deal: () => request<DealResponse>('/api/deal'),
  space: (body: SpaceRequest) => post<SpaceResponse>('/api/space', body),
  spymaster: (body: SpymasterRequest) => post<SpymasterResponse>('/api/coach/spymaster', body),
  check: (body: CheckRequest) => post<CheckResponse>('/api/coach/check', body),
  operative: (body: OperativeRequest) => post<OperativeResponse>('/api/coach/operative', body),
  feedback: (body: FeedbackRequest) => post<FeedbackResponse>('/api/feedback', body),
}
