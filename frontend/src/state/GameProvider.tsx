import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import { api } from '../api/client.ts'
import type {
  BoardPayload,
  CheckResponse,
  HealthResponse,
  OperativeResponse,
  Risk,
  Role,
  SpymasterResponse,
} from '../api/types.ts'

export type GameMode = 'spymaster' | 'operative'
export type GameStage = 'setup' | 'play'
export type SpyTab = 'generate' | 'check'

export interface GameState {
  mode: GameMode
  side: 'my' | 'opp'
  risk: Risk
  words: string[]
  roles: Record<string, Role>
  focus: Set<string>
  revealed: Set<string>
  spyTab: SpyTab
  spyResult: SpymasterResponse | null
  spyIdx: number
  checkResult: CheckResponse | null
  opResult: OperativeResponse | null
  opClue: string
  opCount: number
  checkClue: string
  busy: boolean
  health: HealthResponse | null
  error: string
  paint: Role | null
  stage: GameStage
  sidebarCollapsed: boolean
  zoom: number
}

type Action =
  | { type: 'DEAL_LOADED'; payload: BoardPayload }
  | { type: 'SET_MODE'; payload: GameMode }
  | { type: 'SET_SIDE'; payload: 'my' | 'opp' }
  | { type: 'SET_RISK'; payload: Risk }
  | { type: 'SET_PAINT'; payload: Role | null }
  | { type: 'PAINT_CARD'; word: string; role: Role }
  | { type: 'EDIT_WORD'; word: string; value: string }
  | { type: 'TOGGLE_FOCUS'; word: string }
  | { type: 'REVEAL_CARD'; word: string }
  | { type: 'REVEAL_ALL'; revealed?: boolean }
  | { type: 'SET_STAGE'; payload: GameStage }
  | { type: 'SPY_RESULT'; payload: SpymasterResponse | null }
  | { type: 'CHECK_RESULT'; payload: CheckResponse | null }
  | { type: 'OP_RESULT'; payload: OperativeResponse | null }
  | { type: 'NEXT_OPTION' }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'ERROR'; payload: string }
  | { type: 'BUSY'; payload: boolean }
  | { type: 'HEALTH'; payload: HealthResponse | null }

export const demoDeck: BoardPayload = (() => {
  const words = [
    'מלך', 'חרב', 'טירה', 'דרקון', 'נסיכה', 'יער', 'נהר', 'הר', 'ים', 'שמש', 'ירח', 'כוכב',
    'אש', 'קרח', 'רוח', 'אבן', 'זהב', 'כסף', 'ברזל', 'עץ', 'פרח', 'ציפור', 'דג', 'סוס', 'חתול',
  ]
  const roleOrder: Role[] = [
    'my', 'my', 'my', 'my', 'my', 'my', 'my', 'my', 'my',
    'opp', 'opp', 'opp', 'opp', 'opp', 'opp', 'opp', 'opp',
    'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'assassin',
  ]

  return {
    words,
    roles: Object.fromEntries(words.map((word, index) => [word, roleOrder[index]])),
  }
})()

export const initialGameState: GameState = {
  mode: 'spymaster',
  side: 'my',
  risk: 'balanced',
  words: [],
  roles: {},
  focus: new Set(),
  revealed: new Set(),
  spyTab: 'generate',
  spyResult: null,
  spyIdx: 0,
  checkResult: null,
  opResult: null,
  opClue: '',
  opCount: 2,
  checkClue: '',
  busy: false,
  health: null,
  error: '',
  paint: null,
  stage: 'setup',
  sidebarCollapsed: true,
  zoom: 1,
}

export function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'DEAL_LOADED':
      return {
        ...state,
        words: action.payload.words,
        roles: action.payload.roles,
        focus: new Set(),
        revealed: new Set(),
        side: 'my',
        spyResult: null,
        checkResult: null,
        opResult: null,
        spyIdx: 0,
        error: '',
      }
    case 'REVEAL_CARD':
      if (!state.words.includes(action.word) || state.revealed.has(action.word)) return state
      return { ...state, revealed: new Set([...state.revealed, action.word]) }
    case 'REVEAL_ALL':
      return {
        ...state,
        revealed: action.revealed === false ? new Set() : new Set(state.words),
      }
    case 'SET_MODE':
      return { ...state, mode: action.payload }
    case 'SET_SIDE':
      return { ...state, side: action.payload, focus: new Set(), spyResult: null, checkResult: null, opResult: null }
    case 'SET_RISK':
      return { ...state, risk: action.payload }
    case 'SET_PAINT':
      return { ...state, paint: action.payload }
    case 'PAINT_CARD':
      if (!state.words.includes(action.word)) return state
      return { ...state, roles: { ...state.roles, [action.word]: action.role } }
    case 'EDIT_WORD': {
      const value = action.value.trim()
      if (!value || value === action.word || !state.words.includes(action.word) || state.words.includes(value)) return state
      const role = state.roles[action.word]
      const roles = { ...state.roles }
      delete roles[action.word]
      roles[value] = role
      return {
        ...state,
        words: state.words.map((word) => (word === action.word ? value : word)),
        roles,
      }
    }
    case 'TOGGLE_FOCUS': {
      if (!state.words.includes(action.word)) return state
      const focus = new Set(state.focus)
      if (focus.has(action.word)) focus.delete(action.word)
      else focus.add(action.word)
      return { ...state, focus }
    }
    case 'SET_STAGE':
      return { ...state, stage: action.payload }
    case 'SPY_RESULT':
      return { ...state, spyResult: action.payload, spyIdx: 0 }
    case 'CHECK_RESULT':
      return { ...state, checkResult: action.payload }
    case 'OP_RESULT':
      return { ...state, opResult: action.payload }
    case 'NEXT_OPTION':
      return {
        ...state,
        spyIdx: state.spyResult?.options.length
          ? (state.spyIdx + 1) % state.spyResult.options.length
          : state.spyIdx,
      }
    case 'CLEAR_SELECTION':
      return { ...state, focus: new Set() }
    case 'ERROR':
      return { ...state, error: action.payload }
    case 'BUSY':
      return { ...state, busy: action.payload }
    case 'HEALTH':
      return { ...state, health: action.payload }
    default:
      return state
  }
}

interface GameContextValue {
  state: GameState
  dispatch: Dispatch<Action>
  loadDeal: () => Promise<void>
}

const GameContext = createContext<GameContextValue | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState)

  const loadDeal = useCallback(async () => {
    dispatch({ type: 'BUSY', payload: true })
    try {
      dispatch({ type: 'DEAL_LOADED', payload: await api.deal() })
    } catch {
      dispatch({ type: 'DEAL_LOADED', payload: demoDeck })
      dispatch({ type: 'ERROR', payload: 'השרת אינו זמין — מוצג לוח הדגמה' })
    } finally {
      dispatch({ type: 'BUSY', payload: false })
    }
  }, [])

  const value = useMemo(() => ({ state, dispatch, loadDeal }), [state, loadDeal])
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  const context = useContext(GameContext)
  if (!context) throw new Error('useGame must be used within GameProvider')
  return context
}

export function remainingByRole(state: Pick<GameState, 'words' | 'roles' | 'revealed'>, role: Role) {
  return state.words.filter((word) => state.roles[word] === role && !state.revealed.has(word)).length
}
