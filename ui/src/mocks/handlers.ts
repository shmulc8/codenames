import { delay, http, HttpResponse } from 'msw';

import { fixtureBoard } from './fixtures/board';

type MockWireRole = 'my' | 'opp' | 'neutral' | 'assassin';

interface WireBoardRequest {
  words: string[];
  roles: Record<string, MockWireRole>;
}

interface SpymasterRequest extends WireBoardRequest {
  focus?: string[];
  risk?: 'cautious' | 'balanced' | 'bold';
}

interface CheckRequest extends WireBoardRequest {
  clue: string;
}

interface SpaceRequest extends WireBoardRequest {
  clue?: string;
  whiten?: boolean;
}

interface OperativeRequest extends WireBoardRequest {
  clue: string;
  count: number;
  vocab_mode?: string;
}

interface FeedbackRequest {
  uid: string;
  verdict: 'up' | 'down' | 'outcome';
  comment?: string;
  mode: 'suggest' | 'check' | 'outcome';
  target: 'red' | 'blue';
  risk?: 'cautious' | 'balanced' | 'bold';
  why?: string;
  clue: string;
  count?: number;
  intended?: string[];
  focus?: string[];
  board: WireBoardRequest;
  revealed?: Array<{ word: string; chosenBy: MockWireRole }>;
  option?: unknown;
}

declare global {
  interface Window {
    __lastSpymasterReq?: SpymasterRequest;
    __lastCheckReq?: CheckRequest;
    __lastSpaceReq?: SpaceRequest;
    __lastOperativeReq?: OperativeRequest;
    __lastFeedback?: FeedbackRequest;
    __failFeedbackOnce?: boolean;
  }
}

function roleScore(role: MockWireRole): number {
  switch (role) {
    case 'my':
      return 0.9;
    case 'assassin':
      return 0.76;
    case 'neutral':
      return 0.51;
    case 'opp':
      return 0.38;
  }
}

function rankedRead(board: WireBoardRequest) {
  return board.words
    .map((word, index) => {
      const role = board.roles[word] ?? 'neutral';
      const sim = roleScore(role) - index * 0.003;
      return {
        word,
        role,
        sim,
        conf: Math.max(0, Math.min(1, (sim + 1) / 2)),
      };
    })
    .sort((left, right) => right.sim - left.sim);
}

function hashWord(word: string): number {
  let hash = 0;
  for (const character of word) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

function roleRadius(role: MockWireRole): number {
  switch (role) {
    case 'my':
      return 0.3;
    case 'neutral':
      return 0.55;
    case 'opp':
      return 0.7;
    case 'assassin':
      return 0.35;
  }
}

function mockSpymasterResponse(board: SpymasterRequest) {
  const read = rankedRead(board);
  const teamWords = read.filter((entry) => entry.role === 'my').map((entry) => entry.word);
  const dangerWords = read.filter((entry) => entry.role !== 'my');
  const assassinEntry = read.find((entry) => entry.role === 'assassin');
  const assassin = {
    word: assassinEntry?.word ?? null,
    rank: assassinEntry ? read.indexOf(assassinEntry) : -1,
    sim: assassinEntry?.sim ?? null,
  };
  const intended = teamWords.slice(0, 2);
  const cleanOption = {
    word: 'טבע',
    count: intended.length,
    intended,
    score: 0.91,
    reason: 'הרמז מחבר היטב בין מילות המטרה.',
    read,
    leak: [],
    safe: intended.length,
    assassin,
    no_clue: false,
    risky: false,
    note: '',
  };
  const leak = dangerWords.slice(0, 1);
  const riskyOption = {
    word: 'מסע',
    count: Math.min(2, teamWords.length),
    intended: teamWords.slice(0, 2),
    score: 0.64,
    reason: 'קשר רחב יותר, עם סיכון למשיכת מילה שאינה של הקבוצה.',
    read,
    leak,
    safe: Math.min(1, teamWords.length),
    assassin,
    no_clue: false,
    risky: true,
    note: 'זהירות: הרמז עלול למשוך מילה מסוכנת.',
  };
  const noClueOption = {
    word: '',
    count: 0,
    intended: [],
    score: 0,
    reason: 'לא נמצא רמז בטוח מספיק.',
    read,
    leak: dangerWords.slice(0, 2),
    safe: 0,
    assassin,
    no_clue: true,
    risky: false,
    note: 'לא נמצא רמז בטוח. נסו אשכול אחר או רמת סיכון אחרת.',
  };

  // The cautious profile is the deterministic "no safe clue" path: the engine's best
  // option is itself a refusal, so the panel renders the no-clue state.
  if (board.risk === 'cautious') {
    return {
      options: [noClueOption],
      picked: 0,
      clue: noClueOption.word,
      count: noClueOption.count,
      intended: noClueOption.intended,
      reason: noClueOption.reason,
      read: noClueOption.read,
      leak: noClueOption.leak,
      assassin: noClueOption.assassin,
      no_clue: true,
      risky: false,
      safe: 0,
      note: noClueOption.note,
    };
  }

  return {
    options: [cleanOption, riskyOption, noClueOption],
    picked: 0,
    clue: cleanOption.word,
    count: cleanOption.count,
    intended: cleanOption.intended,
    reason: cleanOption.reason,
    read: cleanOption.read,
    leak: cleanOption.leak,
    assassin: cleanOption.assassin,
    no_clue: cleanOption.no_clue,
    risky: cleanOption.risky,
    safe: cleanOption.safe,
    note: cleanOption.note,
  };
}

const wireDealRoles: Record<string, MockWireRole> = Object.fromEntries(
  fixtureBoard.words.map((word) => {
    const role = fixtureBoard.roles[word];
    return [word, role === 'red' ? 'my' : role === 'blue' ? 'opp' : role];
  }),
);

export const handlers = [
  http.get('/api/health', () =>
    HttpResponse.json({ ok: true, models: ['mock'], encoders: ['mock'], geo: true }),
  ),

  http.get('/api/deal', () =>
    HttpResponse.json({ words: fixtureBoard.words, roles: wireDealRoles }),
  ),

  http.post('/api/coach/spymaster', async ({ request }) => {
    const body = (await request.json()) as SpymasterRequest;
    window.__lastSpymasterReq = body;
    await delay(400);
    return HttpResponse.json(mockSpymasterResponse(body));
  }),

  http.post('/api/coach/check', async ({ request }) => {
    const body = (await request.json()) as CheckRequest;
    window.__lastCheckReq = body;
    await delay(400);

    const read = rankedRead(body);
    const firstDanger = read.find((entry) => entry.role !== 'my') ?? null;
    const assassinEntry = read.find((entry) => entry.role === 'assassin');
    const firstDangerIndex = firstDanger ? read.indexOf(firstDanger) : read.length;

    return HttpResponse.json({
      clue: body.clue,
      illegal: body.words.includes(body.clue),
      read,
      safe: read.slice(0, firstDangerIndex).filter((entry) => entry.role === 'my').length,
      first_danger: firstDanger,
      assassin: {
        word: assassinEntry?.word ?? null,
        rank: assassinEntry ? read.indexOf(assassinEntry) : -1,
      },
    });
  }),

  http.post('/api/coach/operative', async ({ request }) => {
    const body = (await request.json()) as OperativeRequest;
    window.__lastOperativeReq = body;
    await delay(400);

    const ranking = body.words.map((word, index) => ({
      word,
      sim: Math.max(-1, 0.9 - index * 0.035),
      conf: Math.max(0, 0.95 - index * 0.03),
      rank: index,
    }));

    return HttpResponse.json({
      clue: body.clue,
      count: body.count,
      ranking,
      picks: body.words.slice(0, body.count),
      agreement: body.count,
      agree_with: 'mock',
    });
  }),

  http.post('/api/space', async ({ request }) => {
    const body = (await request.json()) as SpaceRequest;
    window.__lastSpaceReq = body;

    const coords = Object.fromEntries(
      body.words.map((word) => {
        const angle = ((hashWord(word) % 360) * Math.PI) / 180;
        const radius = roleRadius(body.roles[word] ?? 'neutral');
        return [word, [Math.cos(angle) * radius, Math.sin(angle) * radius]];
      }),
    );

    return HttpResponse.json({
      coords,
      roles: body.roles,
      clue: body.clue ?? null,
      clue_xy: body.clue ? [0, 0] : null,
    });
  }),

  http.post('/api/feedback', async ({ request }) => {
    const body = (await request.json()) as FeedbackRequest;
    window.__lastFeedback = body;

    if (window.__failFeedbackOnce === true) {
      window.__failFeedbackOnce = false;
      return HttpResponse.json({ error: 'שליחת המשוב נכשלה' }, { status: 500 });
    }

    return HttpResponse.json({ ok: true });
  }),
];
