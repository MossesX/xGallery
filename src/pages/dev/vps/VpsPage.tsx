import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Cloud, Database, FolderTree, Gauge, Globe, HardDrive, RefreshCw, Server, Settings2, Shield, SquareTerminal, Wrench } from 'lucide-react'
import { useInvalidateVps, useVpsSettings } from '../../../api/vps'
import { VpsCtx, withProfile } from './common'
import { OverviewTab } from './OverviewTab'
import { ContainersTab } from './ContainersTab'
import { ImagesTab } from './ImagesTab'
import { SitesTab } from './SitesTab'
import { DnsTab } from './DnsTab'
import { FilesTab } from './FilesTab'
import { FirewallTab } from './FirewallTab'
import { SnapshotsTab } from './SnapshotsTab'
import { SystemTab } from './SystemTab'
import { ConsoleTab } from './ConsoleTab'
import { HostingerTab } from './HostingerTab'
import { VpsSettingsTab } from './VpsSettingsTab'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'containers', label: 'Containers', icon: Box },
  { id: 'images', label: 'Images & storage', icon: Database },
  { id: 'sites', label: 'Sites & subdomains', icon: Globe },
  { id: 'dns', label: 'DNS', icon: Cloud },
  { id: 'files', label: 'Files · SFTP', icon: FolderTree },
  { id: 'firewall', label: 'Firewall', icon: Shield },
  { id: 'snapshots', label: 'Snapshots & backups', icon: HardDrive },
  { id: 'system', label: 'System', icon: Wrench },
  { id: 'console', label: 'Console', icon: SquareTerminal },
  { id: 'hostinger', label: 'Hostinger', icon: Server },
  { id: 'settings', label: 'Settings', icon: Settings2 },
] as const
type TabId = (typeof TABS)[number]['id']

/** The VPS manager: Hostinger + the machine itself (docker, sites, DNS, files, firewall, system) from one place. */
export function VpsPage() {
  const { data: settings, isLoading, error } = useVpsSettings()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as TabId
  const setTab = (id: TabId) => setParams((p) => { p.set('tab', id); return p }, { replace: true })
  const [profile, setProfile] = useState('')
  const invalidate = useInvalidateVps()
  const effProfile = profile || settings?.hostinger.profileId || settings?.defaultProfile || ''
  const ctx = useMemo(() => ({ profile: effProfile, p: (path: string) => withProfile(path, effProfile), hasToken: !!settings?.hostinger.hasToken, domain: settings?.hostinger.domain ?? '' }), [effProfile, settings])
  const prof = settings?.profiles.find((x) => x.id === effProfile)
  const Active = { overview: OverviewTab, containers: ContainersTab, images: ImagesTab, sites: SitesTab, dns: DnsTab, files: FilesTab, firewall: FirewallTab, snapshots: SnapshotsTab, system: SystemTab, console: ConsoleTab, hostinger: HostingerTab, settings: VpsSettingsTab }[tab]

  return (
    <VpsCtx.Provider value={ctx}>
      <div className="stack vps-page" style={{ gap: 12 }} data-vps-page="">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="eyebrow">Operations</div>
            <h1 style={{ margin: 0 }}>
              <Server size={22} /> VPS manager
            </h1>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Hostinger (VM, DNS, firewall, snapshots) and the server itself (containers, sites, files, services) from the panel. Machine actions run over SSH with the panel key; Hostinger actions use the API token kept on the server. Everything is logged on this developer session.
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <label className="field" style={{ gap: 2 }}>
              <span className="muted small">Server</span>
              <select className="select sm" aria-label="VPS profile" value={effProfile} onChange={(e) => setProfile(e.target.value)}>
                {(settings?.profiles ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.user}@{x.host}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn ghost sm" onClick={() => invalidate()} title="Refresh everything" data-vps-refresh="">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
        {error && <div className="dev-session-chip warn">{(error as Error).message}</div>}
        {settings && !settings.hostinger.hasToken && tab !== 'settings' && (
          <div className="dev-session-chip warn" data-vps-no-token="">
            No Hostinger API token yet: DNS, firewall, snapshots and VM power actions are off until you add one in <button className="link" onClick={() => setTab('settings')}>Settings</button>. Everything over SSH works as soon as the panel key is installed on {prof ? `${prof.user}@${prof.host}` : 'the server'}.
          </div>
        )}
        <div className="vps-tabs" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`vps-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} data-vps-tab={id}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {isLoading ? <p className="muted">Loading…</p> : <Active key={`${tab}:${effProfile}`} />}
      </div>
    </VpsCtx.Provider>
  )
}
