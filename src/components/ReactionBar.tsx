import { useState } from 'react'
import { SmilePlus } from 'lucide-react'
import type { MediaItem } from '../api/types'
import { useReact } from '../api/hooks'

const EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🔥', '👏', '🎉']

/** Emoji reactions on a media item: pick one, tap again to remove. */
export function ReactionBar({ item, compact = false }: { item: MediaItem; compact?: boolean }) {
  const react = useReact()
  const [open, setOpen] = useState(false)
  const reactions = item.reactions ?? []
  return (
    <div className={`reaction-bar ${compact ? 'compact' : ''}`}>
      {reactions.map((r) => (
        <button key={r.emoji} className={`reaction ${item.myReaction === r.emoji ? 'mine' : ''}`} onClick={() => react.mutate({ mediaId: item.id, emoji: item.myReaction === r.emoji ? null : r.emoji })} title={`${r.count} × ${r.emoji}`} disabled={react.isPending}>
          <span>{r.emoji}</span> <span className="count">{r.count}</span>
        </button>
      ))}
      <span className="reaction-add">
        <button className="reaction" onClick={() => setOpen((v) => !v)} title="React" aria-expanded={open} aria-label="Add a reaction">
          <SmilePlus size={14} />
        </button>
        {open && (
          <span className="reaction-picker" onMouseLeave={() => setOpen(false)}>
            {EMOJI.map((e) => (
              <button key={e} className={`reaction ${item.myReaction === e ? 'mine' : ''}`} onClick={() => { react.mutate({ mediaId: item.id, emoji: item.myReaction === e ? null : e }); setOpen(false) }}>
                {e}
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  )
}
