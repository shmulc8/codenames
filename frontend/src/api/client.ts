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
  const text = await response.text()
  let body: unknown

  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `API unreachable (HTTP ${response.status})`
    throw new Error(message)
  }

  if (body === undefined) {
    throw new Error(`Invalid API response (HTTP ${response.status})`)
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
