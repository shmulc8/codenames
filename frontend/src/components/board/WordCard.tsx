import { Skull, VenetianMask } from 'lucide-react'
import type { Role } from '../../api/types.ts'

interface WordCardProps {
  word: string
  role: Role
  revealed: boolean
  onReveal: () => void
}

const roleLabel: Record<Role, string> = {
  my: 'סוכן כחול',
  opp: 'סוכן אדום',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
}

export function WordCard({ word, role, revealed, onReveal }: WordCardProps) {
  const RoleIcon = role === 'assassin' ? Skull : VenetianMask

  return (
    <button
      className={`word-card${revealed ? ' is-revealed' : ''}`}
      type="button"
      onClick={onReveal}
      aria-label={`${word}, ${revealed ? roleLabel[role] : 'קלף סגור'}`}
      aria-pressed={revealed}
    >
      <span className="card-inner">
        <span className="card face-word">
          <span className="w-top" aria-hidden="true">{word}</span>
          <span className="w" dir="rtl">{word}</span>
        </span>
        <span className={`card face-agent r-${role}`}>
          <RoleIcon className="role-icon" aria-hidden="true" strokeWidth={1.25} />
          <span className="role-word" dir="rtl">{word}</span>
          <span className="role-label" dir="rtl">{roleLabel[role]}</span>
        </span>
      </span>
    </button>
  )
}
