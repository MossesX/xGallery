import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GitBranch, GitPullRequest, Plus, Shield, Star, Trash2 } from 'lucide-react'
import { short, useGh } from '../../../api/github'
import { Busy, useGhAction } from './common'

interface Branch { name: string; sha: string; protected: boolean; isDefault: boolean }

export function BranchesTab() {
  const list = useGh<{ branches: Branch[]; next: number | null; defaultBranch: string }>('/branches')
  const { run, busy } = useGhAction()
  const [, setParams] = useSearchParams()
  const [form, setForm] = useState({ name: '', from: '' })
  const [filter, setFilter] = useState('')
  const branches = (list.data?.branches ?? []).filter((b) => !filter || b.name.includes(filter))
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-branches="">
      <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
        <input className="input sm" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} aria-label="Filter branches" />
        <span className="grow" />
        <input className="input sm mono" placeholder="new-branch-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 200 }} aria-label="New branch name" />
        <input className="input sm mono" placeholder={`from (${list.data?.defaultBranch ?? 'default'})`} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} style={{ width: 160 }} aria-label="From" />
        <button className="btn primary sm" disabled={!form.name || busy !== ''} onClick={async () => { const r = await run({ path: '/branches', body: form, label: `Branch ${form.name} created`, invalidate: ['/branches', '/overview'], key: 'new' }); if (r) setForm({ name: '', from: '' }) }} data-gh-new-branch="">
          <Busy on={busy === 'new'}>
            <Plus size={12} />
          </Busy>{' '}
          Create
        </button>
      </div>
      {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
      <div className="card table-card">
        <table className="table compact">
          <tbody>
            {branches.map((b) => (
              <tr key={b.name} data-gh-branch={b.name}>
                <td>
                  <span className="mono">
                    <GitBranch size={12} /> {b.name}
                  </span>{' '}
                  {b.isDefault && <span className="chip st-done">default</span>} {b.protected && <span className="chip" title="Protected"><Shield size={10} /> protected</span>}
                </td>
                <td className="mono small muted">{short(b.sha)}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn ghost sm" onClick={() => setParams((p) => { p.set('tab', 'commits'); p.set('branch', b.name); return p })}>
                      commits
                    </button>
                    {!b.isDefault && (
                      <>
                        <button className="btn ghost sm" onClick={() => setParams((p) => { p.set('tab', 'pulls'); p.set('new', b.name); return p })}>
                          <GitPullRequest size={11} /> open PR
                        </button>
                        <button className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ method: 'PUT', path: '/default-branch', body: { branch: b.name }, label: `${b.name} is now the default branch`, confirm: `Make ${b.name} the default branch? Deploys follow the default branch.`, invalidate: ['/branches', '/overview'] })}>
                          <Star size={11} /> make default
                        </button>
                        <button className="btn ghost icon sm danger" title="Delete branch" disabled={busy !== '' || b.protected} onClick={() => run({ method: 'DELETE', path: `/branches/${encodeURIComponent(b.name)}`, label: `Branch ${b.name} deleted`, confirm: `Delete branch ${b.name}?`, invalidate: ['/branches', '/overview'] })}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
