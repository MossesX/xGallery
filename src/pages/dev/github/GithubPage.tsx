import { useSearchParams } from 'react-router-dom'
import { Bell, Code2, Gauge, GitBranch, GitCommitHorizontal, GitPullRequest, FolderGit2, KeyRound, MessageSquareWarning, Play, RefreshCw, Settings2, Tag, Webhook } from 'lucide-react'
import { useGhSettings, useInvalidateGh } from '../../../api/github'
import { OverviewTab } from './OverviewTab'
import { CommitsTab } from './CommitsTab'
import { BranchesTab } from './BranchesTab'
import { PullsTab } from './PullsTab'
import { IssuesTab } from './IssuesTab'
import { ActionsTab } from './ActionsTab'
import { ReleasesTab } from './ReleasesTab'
import { CodeTab } from './CodeTab'
import { SecretsTab } from './SecretsTab'
import { HooksTab } from './HooksTab'
import { NotificationsTab } from './NotificationsTab'
import { GhSettingsTab } from './GhSettingsTab'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'commits', label: 'Commits', icon: GitCommitHorizontal },
  { id: 'branches', label: 'Branches', icon: GitBranch },
  { id: 'pulls', label: 'Pull requests', icon: GitPullRequest },
  { id: 'issues', label: 'Issues', icon: MessageSquareWarning },
  { id: 'actions', label: 'Actions', icon: Play },
  { id: 'releases', label: 'Releases', icon: Tag },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'hooks', label: 'Webhooks', icon: Webhook },
  { id: 'notifications', label: 'Inbox', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings2 },
] as const
type TabId = (typeof TABS)[number]['id']

/** The GitHub manager: the repository, through the token the server keeps. The browser and the Android app only talk to this server. */
export function GithubPage() {
  const { data: settings, isLoading } = useGhSettings()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as TabId
  const setTab = (id: TabId) => setParams((p) => { p.set('tab', id); p.delete('n'); p.delete('run'); p.delete('sha'); return p }, { replace: true })
  const invalidate = useInvalidateGh()
  const Active = { overview: OverviewTab, commits: CommitsTab, branches: BranchesTab, pulls: PullsTab, issues: IssuesTab, actions: ActionsTab, releases: ReleasesTab, code: CodeTab, secrets: SecretsTab, hooks: HooksTab, notifications: NotificationsTab, settings: GhSettingsTab }[tab]
  const rate = settings?.github.rate
  return (
    <div className="stack gh-page" style={{ gap: 12 }} data-gh-page="">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">Operations</div>
          <h1 style={{ margin: 0 }}>
            <FolderGit2 size={22} /> GitHub manager
          </h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {settings?.github.full ? <a href={`https://github.com/${settings.github.full}`} target="_blank" rel="noreferrer">{settings.github.full}</a> : 'No repository'} · the server keeps the token, polls GitHub and receives its webhooks, so every device (this browser, the Android app) sees the same current state. Every change is logged on this developer session.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {rate && rate.limit > 0 && (
            <span className={`chip ${rate.remaining < 200 ? 'prio-high' : ''}`} title={`Resets ${new Date(rate.reset).toLocaleTimeString()}`}>
              API {rate.remaining}/{rate.limit}
            </span>
          )}
          <button className="btn ghost sm" onClick={() => invalidate()} title="Refresh everything" data-gh-refresh="">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>
      {settings && !settings.github.hasToken && tab !== 'settings' && (
        <div className="dev-session-chip warn" data-gh-no-token="">
          No GitHub token yet. Add one in <button className="link" onClick={() => setTab('settings')}>Settings</button> (a fine-grained token for {settings.github.full || 'the repository'} with Contents, Issues, Pull requests, Actions, Secrets, Webhooks and Metadata).
        </div>
      )}
      <div className="vps-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`vps-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} data-gh-tab={id}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {isLoading ? <p className="muted">Loading…</p> : <Active key={tab} />}
    </div>
  )
}
