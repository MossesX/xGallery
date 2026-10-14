import { Link } from 'react-router-dom'
import { Check, MessageCircle, UserMinus, UserPlus, X } from 'lucide-react'
import type { Person } from '../api/types'
import { Avatar } from './Avatar'
import { useBuddyAction } from '../api/hooks'

/** Buddy request / accept / remove controls for one person, reused across the people pages. */
export function BuddyButtons({ person, compact = false }: { person: Person; compact?: boolean }) {
  const act = useBuddyAction()
  const busy = act.isPending
  const cls = compact ? 'btn sm' : 'btn'
  if (person.buddy === 'accepted')
    return (
      <button className={`${cls} ghost`} onClick={() => confirm(`Remove ${person.displayName} from your buddies?`) && act.mutate({ id: person.id, action: 'remove' })} disabled={busy}>
        <UserMinus size={14} /> Buddies
      </button>
    )
  if (person.buddy === 'incoming')
    return (
      <span className="row" style={{ gap: 6 }}>
        <button className={`${cls} primary`} onClick={() => act.mutate({ id: person.id, action: 'accept' })} disabled={busy}>
          <Check size={14} /> Accept
        </button>
        <button className={`${cls} ghost`} onClick={() => act.mutate({ id: person.id, action: 'remove' })} disabled={busy} title="Decline">
          <X size={14} />
        </button>
      </span>
    )
  if (person.buddy === 'outgoing')
    return (
      <button className={`${cls} ghost`} onClick={() => act.mutate({ id: person.id, action: 'remove' })} disabled={busy} title="Cancel request">
        Requested
      </button>
    )
  return (
    <button className={`${cls} primary`} onClick={() => act.mutate({ id: person.id, action: 'request' })} disabled={busy}>
      <UserPlus size={14} /> Add buddy
    </button>
  )
}

export function PersonRow({ person, children }: { person: Person; children?: React.ReactNode }) {
  return (
    <div className="person-row">
      <Link to={person.gallerySlug ? `/public/${person.gallerySlug}` : '#'} className="person-main">
        <Avatar name={person.displayName} size={44} src={person.avatarUrl} />
        <span>
          <strong>{person.displayName}</strong>
          <span className="muted small">
            @{person.username}
            {person.publicAlbums > 0 ? ` · ${person.publicAlbums} public album${person.publicAlbums === 1 ? '' : 's'}` : ''}
          </span>
          {person.bio && <span className="muted small clamp-2">{person.bio}</span>}
        </span>
      </Link>
      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
        <Link to={`/me/messages/${person.id}`} className="btn sm" title="Message">
          <MessageCircle size={14} />
        </Link>
        {children ?? <BuddyButtons person={person} compact />}
      </div>
    </div>
  )
}
