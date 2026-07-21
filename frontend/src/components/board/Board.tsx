import { useGame } from '../../state/GameProvider.tsx'
import { WordCard } from './WordCard.tsx'
import './board.css'

export function Board() {
  const { state, dispatch } = useGame()

  return (
    <div className="board" role="grid" aria-label="לוח שם קוד" dir="rtl">
      {state.words.map((word) => (
        <div className="board-cell" role="gridcell" key={word}>
          <WordCard
            word={word}
            role={state.roles[word] ?? 'neutral'}
            revealed={state.revealed.has(word)}
            onReveal={() => dispatch({ type: 'REVEAL_CARD', word })}
          />
        </div>
      ))}
    </div>
  )
}
