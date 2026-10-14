import { useState } from 'react'
import { Search, Users } from 'lucide-react'
import { useBuddies, usePeople } from '../../api/hooks'
import { PersonRow } from '../../components/PersonRow'
import { PageLoader } from '../../components/Skeleton'

type Tab = 'buddies' | 'requests' | 'find'

/** Buddy list: your buddies, pending requests both ways, and a people finder. */
export function BuddiesPage() {
  const [tab, setTab] = useState<Tab>('buddies')
  const [q, setQ] = useState('')
  const { data, isLoading } = useBuddies()
  const { data: people, isLoading: finding } = usePeople(q, tab === 'find')
  const pending = (data?.incoming.length ?? 0) + (data?.outgoing.length ?? 0)

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">People</div>
          <h1 style={{ margin: 0 }}>Buddies</h1>
        </div>
        <div className="feed-tabs">
          <button className={tab === 'buddies' ? 'active' : ''} onClick={() => setTab('buddies')}>
            My buddies {data ? `(${data.buddies.length})` : ''}
          </button>
          <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
            Requests {pending ? `(${pending})` : ''}
          </button>
          <button className={tab === 'find' ? 'active' : ''} onClick={() => setTab('find')}>
            Find people
          </button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Buddies can see the albums you set to <strong>Buddies &amp; members</strong>, and you can see theirs. Anyone can message anyone.
      </p>

      {tab === 'buddies' &&
        (isLoading ? (
          <PageLoader />
        ) : !data?.buddies.length ? (
          <div className="empty">
            <Users size={40} strokeWidth={1.2} />
            <p style={{ marginTop: 12 }}>No buddies yet. Find people and send a request.</p>
            <button className="btn sm" onClick={() => setTab('find')}>
              Find people
            </button>
          </div>
        ) : (
          <div className="card stack" style={{ gap: 0, padding: 0 }}>
            {data.buddies.map((p) => (
              <PersonRow person={p} key={p.id} />
            ))}
          </div>
        ))}

      {tab === 'requests' && (
        <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
          <section>
            <h3>Waiting for you {data?.incoming.length ? `(${data.incoming.length})` : ''}</h3>
            {!data?.incoming.length ? (
              <p className="muted small">No incoming requests.</p>
            ) : (
              <div className="card stack" style={{ gap: 0, padding: 0 }}>
                {data.incoming.map((p) => (
                  <PersonRow person={p} key={p.id} />
                ))}
              </div>
            )}
          </section>
          <section>
            <h3>Sent {data?.outgoing.length ? `(${data.outgoing.length})` : ''}</h3>
            {!data?.outgoing.length ? (
              <p className="muted small">No pending requests you sent.</p>
            ) : (
              <div className="card stack" style={{ gap: 0, padding: 0 }}>
                {data.outgoing.map((p) => (
                  <PersonRow person={p} key={p.id} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'find' && (
        <div className="stack" style={{ gap: 'calc(var(--space) * 2)' }}>
          <label className="feed-search" style={{ maxWidth: 420 }}>
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or username" aria-label="Find people" autoFocus />
          </label>
          {finding && !people ? (
            <PageLoader />
          ) : !people?.length ? (
            <div className="empty">Nobody matches that.</div>
          ) : (
            <div className="card stack" style={{ gap: 0, padding: 0 }}>
              {people.map((p) => (
                <PersonRow person={p} key={p.id} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
