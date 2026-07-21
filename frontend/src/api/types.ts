export type Role = 'my' | 'opp' | 'neutral' | 'assassin'

export interface BoardPayload {
  words: string[]
  roles: Record<string, Role>
}

export interface HealthResponse {
  ok: boolean
  models: ModelInfo[]
  encoders: string[]
  geo: string
}

export interface ModelInfo {
  id: string
  label: string
}

export type DealResponse = BoardPayload

export interface ReadEntry {
  word: string
  role: Role
  sim: number
  conf: number
  rank?: number
}

export interface AssassinResult {
  word: string | null
  rank: number
}

export interface SpaceRequest extends BoardPayload {
  clue?: string
  whiten?: boolean
}

export interface SpaceResponse {
  coords: Record<string, [number, number]>
  roles: Record<string, Role>
  clue: string | null
  clue_xy: [number, number] | null
}

export type Risk = 'cautious' | 'balanced' | 'bold'

export interface ClueOption {
  word: string
  count: number
  intended: string[]
  reason: string
  read: ReadEntry[]
  leak: ReadEntry[]
  assassin: AssassinResult
  no_clue: boolean
  risky: boolean
  safe: number
  note: string
}

export interface SpymasterRequest extends BoardPayload {
  engine?: 'geometry' | 'hybrid' | 'llm'
  model?: string | null
  focus?: string[]
  risk?: Risk
}

export interface SpymasterResponse extends Omit<ClueOption, 'word'> {
  options: ClueOption[]
  picked: number
  shortlist: unknown[]
  clue: string
}

export interface CheckRequest extends BoardPayload {
  clue: string
  use_llm?: boolean
  model?: string | null
}

export interface CheckResponse {
  clue: string
  illegal: boolean
  read: ReadEntry[]
  safe: number
  first_danger: ReadEntry | null
  assassin: AssassinResult
}

export interface OperativeRequest extends BoardPayload {
  clue: string
  count: number
  engine?: 'geometry' | 'hybrid' | 'llm'
  model?: string | null
}

export interface OperativeRanking extends ReadEntry {
  rank: number
}

export interface OperativeResponse {
  clue: string
  count: number
  ranking: OperativeRanking[]
  picks: string[]
  agreement: number | null
  agree_with: string | null
}

export interface FeedbackRequest {
  verdict?: string
  why?: string
  comment?: string
  uid?: string
  mode?: 'spymaster' | 'operative'
  risk?: Risk
  side?: 'my' | 'opp'
  clue?: string
  count?: number
  intended?: string[]
  focus?: string[]
  board?: BoardPayload
  revealed?: string[]
  option?: ClueOption | null
}

export interface FeedbackResponse {
  ok: boolean
}

export type SpyCoverColor = 'red' | 'blue' | 'neutral' | 'assassin' | 'unknown'

export interface SpyCoveredWord {
  word: string
  color: SpyCoverColor
}

export interface SpyScanRequest {
  image: string
  words?: string[]
}

export interface SpyScanResponse {
  words: string[]
  covered?: SpyCoveredWord[]
}
