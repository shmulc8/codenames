import { remainingByRole, useGame } from '../../state/GameProvider.tsx'

const teams = [
  { role: 'my' as const, label: 'כחול' },
  { role: 'opp' as const, label: 'אדום' },
]

export function CountChips() {
  const { state } = useGame()

  return (
    <div className="count-chips" aria-label="קלפים שנותרו לכל צוות">
      {teams.map(({ role, label }) => (
        <span className={`count-chip count-chip-${role}`} key={role}>
          <span className="count-chip-label">{label}</span>
          <strong>{remainingByRole(state, role)}</strong>
        </span>
      ))}
    </div>
  )
}
