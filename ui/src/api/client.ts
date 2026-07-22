import type {
  BoardPayload,
  CheckResponse,
  ClueOption,
  DealResponse,
  FeedbackPayload,
  OperativeResponse,
  ReadEntry,
  Risk,
  Role,
  SpaceResponse,
  SpymasterResponse,
  TeamColor,
  VocabMode,
  WireRole,
} from '../types/api';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 30_000;

export interface HealthResponse {
  ok: boolean;
  models: unknown;
  encoders: unknown;
  geo: unknown;
}

interface ErrorResponse {
  error?: unknown;
}

interface WireReadEntry extends Omit<ReadEntry, 'role'> {
  role: WireRole;
}

interface WireClueOption extends Omit<ClueOption, 'read' | 'leak'> {
  read: WireReadEntry[];
  leak: WireReadEntry[];
}

interface WireSpymasterResponse extends Omit<SpymasterResponse, 'options' | 'read' | 'leak'> {
  options: WireClueOption[];
  read?: WireReadEntry[];
  leak?: WireReadEntry[];
}

interface WireCheckResponse extends Omit<CheckResponse, 'read' | 'first_danger'> {
  read: WireReadEntry[];
  first_danger: WireReadEntry | null;
}

interface WireSpaceResponse extends Omit<SpaceResponse, 'roles'> {
  roles: Record<string, WireRole>;
}

interface WireDealResponse extends Omit<DealResponse, 'roles'> {
  roles: Record<string, WireRole>;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function toWireRole(role: Role, target: TeamColor): WireRole {
  if (role === target) return 'my';
  if (role === 'red' || role === 'blue') return 'opp';
  return role;
}

function fromWireRole(role: WireRole, target: TeamColor): Role {
  if (role === 'my') return target;
  if (role === 'opp') return target === 'red' ? 'blue' : 'red';
  return role;
}

function toWire(roles: Record<string, Role>, target: TeamColor): Record<string, WireRole> {
  return Object.fromEntries(
    Object.entries(roles).map(([word, role]) => [word, toWireRole(role, target)]),
  );
}

function fromWire(roles: Record<string, WireRole>, target: TeamColor): Record<string, Role> {
  return Object.fromEntries(
    Object.entries(roles).map(([word, role]) => [word, fromWireRole(role, target)]),
  );
}

function mapReadEntry(entry: WireReadEntry, target: TeamColor): ReadEntry {
  return { ...entry, role: fromWireRole(entry.role, target) };
}

function mapClueOption(option: WireClueOption, target: TeamColor): ClueOption {
  return {
    ...option,
    read: option.read.map((entry) => mapReadEntry(entry, target)),
    leak: option.leak.map((entry) => mapReadEntry(entry, target)),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('השרת החזיר תשובה לא תקינה', response.status);
    }

    const serverError = (payload as ErrorResponse | null)?.error;
    if (!response.ok || typeof serverError === 'string') {
      const message =
        typeof serverError === 'string' && serverError.length > 0
          ? serverError
          : 'לא הצלחנו להשלים את הבקשה';
      throw new ApiError(message, response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('הבקשה ארכה יותר מדי זמן', 0);
    }
    throw new ApiError(error instanceof Error ? error.message : 'לא ניתן להתחבר לשרת', 0);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

export async function getDeal(): Promise<DealResponse> {
  const response = await request<WireDealResponse>('/api/deal');
  return {
    words: response.words,
    roles: fromWire(response.roles, 'red'),
  };
}

export async function postSpymaster(
  board: BoardPayload,
  target: TeamColor,
  focus?: string[],
  risk?: Risk,
  vocabMode?: VocabMode,
): Promise<SpymasterResponse> {
  const response = await request<WireSpymasterResponse>('/api/coach/spymaster', {
    method: 'POST',
    body: JSON.stringify({
      words: board.words,
      roles: toWire(board.roles, target),
      ...(focus?.length ? { focus } : {}),
      ...(risk ? { risk } : {}),
      ...(vocabMode ? { vocab_mode: vocabMode } : {}),
    }),
  });

  const { options, read, leak, ...summary } = response;

  return {
    ...summary,
    options: options.map((option) => mapClueOption(option, target)),
    ...(read ? { read: read.map((entry) => mapReadEntry(entry, target)) } : {}),
    ...(leak ? { leak: leak.map((entry) => mapReadEntry(entry, target)) } : {}),
  };
}

export function postOperative(
  board: BoardPayload,
  clue: string,
  count: number,
  vocabMode?: VocabMode,
): Promise<OperativeResponse> {
  // The guesser view is role-blind: the response ranks words by clue proximity with no roles,
  // so no wire→app role mapping is needed on the way back. Roles are sent only so the engine can
  // build the board (they don't affect the ranking); the target choice here is arbitrary.
  return request<OperativeResponse>('/api/coach/operative', {
    method: 'POST',
    body: JSON.stringify({
      words: board.words,
      roles: toWire(board.roles, 'red'),
      clue,
      count,
      ...(vocabMode ? { vocab_mode: vocabMode } : {}),
    }),
  });
}

export async function postCheck(
  board: BoardPayload,
  target: TeamColor,
  clue: string,
): Promise<CheckResponse> {
  const response = await request<WireCheckResponse>('/api/coach/check', {
    method: 'POST',
    body: JSON.stringify({
      words: board.words,
      roles: toWire(board.roles, target),
      clue,
    }),
  });

  return {
    ...response,
    read: response.read.map((entry) => mapReadEntry(entry, target)),
    first_danger: response.first_danger ? mapReadEntry(response.first_danger, target) : null,
  };
}

export async function postSpace(
  board: BoardPayload,
  target: TeamColor,
  clue?: string,
): Promise<SpaceResponse> {
  const response = await request<WireSpaceResponse>('/api/space', {
    method: 'POST',
    body: JSON.stringify({
      words: board.words,
      roles: toWire(board.roles, target),
      ...(clue ? { clue } : {}),
    }),
  });

  return {
    ...response,
    roles: fromWire(response.roles, target),
  };
}

export function postFeedback(payload: FeedbackPayload): Promise<{ ok: true }> {
  const wirePayload = {
    ...payload,
    board: {
      words: payload.board.words,
      roles: toWire(payload.board.roles, payload.target),
    },
    ...(payload.revealed
      ? {
          revealed: payload.revealed.map(({ word, chosenBy }) => ({
            word,
            chosenBy: toWireRole(chosenBy, payload.target),
          })),
        }
      : {}),
  };

  return request<{ ok: true }>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify(wirePayload),
  });
}
