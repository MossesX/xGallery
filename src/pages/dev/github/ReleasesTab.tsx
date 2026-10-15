import { useState } from 'react'
import { Download, ExternalLink, Plus, Tag, Trash2 } from 'lucide-react'
import { ago, short, useGh, type Release } from '../../../api/github'
import { Body, Busy, Dialog, useGhAction } from './common'

export function ReleasesTab() {
  const rel = useGh<{ releases: Release[]; next: number | null }>('/releases')
  const tags = useGh<{ tags: { name: string; sha: string; zip: string }[] }>('/tags')
  const { run, busy } = useGhAction()
  const [create, setCreate] = useState(false)
  const [form, setForm] = useState({ tag: '', target: '', name: '', body: '', draft: false, prerelease: false, generateNotes: true })
  const inv = ['/releases', '/tags', '/overview']
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-releases="">
      <div className="row" style={{ gap: 6 }}>
        <span className="muted small">Releases are tags with notes and downloadable assets (the Android APK is published as a release by its workflow).</span>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => setCreate(true)} data-gh-new-release="">
          <Plus size={12} /> New release
        </button>
      </div>
      {rel.error && <div className="dev-session-chip warn">{(rel.error as Error).message}</div>}
      <div className="stack" style={{ gap: 8 }}>
        {(rel.data?.releases ?? []).map((r) => (
          <section key={r.id} className="card stack" style={{ gap: 6 }} data-gh-release={r.tag}>
            <div className="row" style={{ gap: 6 }}>
              <h3 style={{ margin: 0 }}>
                <Tag size={14} /> {r.name || r.tag}
              </h3>
              <span className="chip">{r.tag}</span>
              {r.draft && <span className="chip prio-high">draft</span>}
              {r.prerelease && <span className="chip">pre-release</span>}
              <span className="muted small">
                {r.author} · {r.published_at ? ago(r.published_at) : 'unpublished'} · {r.target}
              </span>
              <a href={r.url} target="_blank" rel="noreferrer" className="small">
                <ExternalLink size={10} />
              </a>
              <span className="grow" />
              {r.draft && (
                <button className="btn sm" disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/releases/${r.id}`, body: { draft: false }, label: `${r.tag} published`, invalidate: inv })}>
                  Publish
                </button>
              )}
              <button className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/releases/${r.id}`, body: { prerelease: !r.prerelease }, label: 'Release updated', invalidate: inv })}>
                {r.prerelease ? 'mark stable' : 'mark pre-release'}
              </button>
              <button className="btn ghost icon sm danger" title="Delete release" disabled={busy !== ''} onClick={() => run({ method: 'DELETE', path: `/releases/${r.id}`, label: `${r.tag} deleted`, confirm: `Delete release ${r.tag}? The tag stays.`, invalidate: inv })}>
                <Trash2 size={12} />
              </button>
            </div>
            <Body text={r.body} />
            {r.assets.length > 0 && (
              <div className="row" style={{ gap: 4 }}>
                {r.assets.map((a) => (
                  <a key={a.id} className="chip" href={a.url} target="_blank" rel="noreferrer">
                    <Download size={10} /> {a.name} · {Math.round(a.size / 1024)} KB · {a.downloads} downloads
                  </a>
                ))}
              </div>
            )}
          </section>
        ))}
        {rel.data && !rel.data.releases.length && <p className="muted small">No releases yet.</p>}
      </div>
      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Tags</h3>
        <div className="row" style={{ gap: 4 }}>
          {(tags.data?.tags ?? []).map((t) => (
            <span key={t.name} className="chip" title={short(t.sha)}>
              {t.name}
            </span>
          ))}
          {tags.data && !tags.data.tags.length && <span className="muted small">No tags.</span>}
        </div>
      </section>
      {create && (
        <Dialog title="New release" onClose={() => setCreate(false)} wide>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <input className="input mono grow" placeholder="tag, e.g. v1.4.0 (created if missing)" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} aria-label="Tag" autoFocus />
              <input className="input mono grow" placeholder="target branch/sha (default branch)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} aria-label="Target" />
            </div>
            <input className="input" placeholder="Release title" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Release name" />
            <textarea className="textarea" rows={6} placeholder="Notes (markdown); GitHub can generate them from merged PRs and commits" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-label="Release notes" />
            <div className="row" style={{ gap: 12 }}>
              <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={form.generateNotes} onChange={(e) => setForm({ ...form, generateNotes: e.target.checked })} /> generate notes</label>
              <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={form.draft} onChange={(e) => setForm({ ...form, draft: e.target.checked })} /> draft</label>
              <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={form.prerelease} onChange={(e) => setForm({ ...form, prerelease: e.target.checked })} /> pre-release</label>
            </div>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!form.tag || busy === 'create'} onClick={async () => { const r = await run({ path: '/releases', body: form, label: `Release ${form.tag} ${form.draft ? 'drafted' : 'published'}`, invalidate: inv, key: 'create' }); if (r) { setCreate(false); setForm({ tag: '', target: '', name: '', body: '', draft: false, prerelease: false, generateNotes: true }) } }} data-gh-create-release="">
              <Busy on={busy === 'create'}>
                <Plus size={13} />
              </Busy>{' '}
              {form.draft ? 'Save draft' : 'Publish'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
