import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Check, Mail, UserPlus } from 'lucide-react'
import { api } from '../api/client'
import { useMe, useSettings } from '../api/hooks'
import { PublicShell } from '../components/PublicShell'
import { AppShell } from '../components/AppShell'

/** Visitors ask the owner for an account; members send the owner a note. Both land in the owner's inbox. */
export function RequestAccountPage() {
  const { data: me } = useMe()
  const { data: site } = useSettings()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [contact, setContact] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const request = useMutation({
    mutationFn: () => (me ? api.post('/api/inbox/contact', { message }) : api.post('/api/inbox/request', { name, username, contact, message })),
    onSuccess: () => setSent(true),
  })
  const Shell = me ? AppShell : PublicShell
  const brand = site?.settings.siteTitle ?? 'xGallery'

  return (
    <Shell>
      <main className="page narrow">
        <div className="login-card request-card">
          {sent ? (
            <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 10 }}>
              <span className="avatar" style={{ width: 56, height: 56, background: 'var(--c-success)', color: '#fff' }}>
                <Check size={26} />
              </span>
              <h2 style={{ margin: 0 }}>{me ? 'Sent to the owner' : 'Request sent'}</h2>
              <p className="muted">{me ? 'The owner will see your note in their admin inbox.' : 'The owner reviews requests personally and will reach out using the contact you left.'}</p>
              <Link to="/" className="btn primary">
                Back to {brand}
              </Link>
            </div>
          ) : (
            <form
              className="stack"
              style={{ gap: 'calc(var(--space) * 2)' }}
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                request.mutate()
              }}
            >
              <div>
                <div className="eyebrow">{me ? 'Contact' : 'Join'}</div>
                <h1 style={{ margin: 0 }}>{me ? 'Message the owner' : 'Request an account'}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  {me ? 'Questions, problems or ideas for the site go straight to the owner. This is separate from private messages.' : `${brand} is invitation-only. Tell the owner who you are and they will set up your login.`}
                </p>
              </div>
              {request.error && <div className="error">{(request.error as Error).message}</div>}
              {!me && (
                <>
                  <div className="field">
                    <label htmlFor="rq-name">Your name</label>
                    <input id="rq-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
                  </div>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div className="field grow">
                      <label htmlFor="rq-user">Preferred username</label>
                      <input id="rq-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="optional" />
                    </div>
                    <div className="field grow">
                      <label htmlFor="rq-contact">Email or handle</label>
                      <input id="rq-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="how to reach you" required />
                    </div>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="rq-msg">{me ? 'Message' : 'Anything the owner should know'}</label>
                <textarea id="rq-msg" className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} style={{ minHeight: 110 }} placeholder={me ? 'What would you like to tell the owner?' : 'Who invited you, what you want to share…'} required={!!me} />
              </div>
              <button className="btn primary lg" disabled={request.isPending || (me ? !message.trim() : !name.trim() || !contact.trim())}>
                {me ? <Mail size={16} /> : <UserPlus size={16} />} {me ? 'Send to the owner' : 'Send request'}
              </button>
              {!me && (
                <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
                  Already a member? <Link to="/login">Sign in</Link>
                </p>
              )}
            </form>
          )}
        </div>
      </main>
    </Shell>
  )
}
