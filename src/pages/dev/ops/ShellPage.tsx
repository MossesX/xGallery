import { useEffect, useState } from 'react'
import { Plus, Save, Smartphone, TerminalSquare, Trash2 } from 'lucide-react'
import { useOps, useSaveOps, type OpsProfile, type ShellProfile } from '../../../api/ops'
import { useUI } from '../../../store/ui'
import { CommandBlock } from './CommandBlock'
import { moshCommand, recipeById } from './recipes'

const PREDICT: [ShellProfile['predict'], string][] = [
  ['adaptive', 'adaptive — predict only on slow links (default)'],
  ['always', 'always — local echo everywhere'],
  ['never', 'never — wait for the server'],
  ['experimental', 'experimental — also predict cursor moves'],
]

/** Remote shell tab: mosh profiles, every command you need to connect from desktop or phone, server setup, diagnostics. */
export function ShellPage() {
  const notify = useUI((s) => s.notify)
  const { data } = useOps()
  const save = useSaveOps()
  const [ops, setOps] = useState<OpsProfile | null>(null)
  const [sel, setSel] = useState<string>('')
  useEffect(() => {
    if (data && !ops) {
      setOps(data.ops)
      setSel(data.ops.shell.defaultProfile)
    }
  }, [data, ops])
  if (!ops) return null
  const profiles = ops.shell.profiles
  const p = profiles.find((x) => x.id === sel) ?? profiles[0]
  const dirty = JSON.stringify(ops) !== JSON.stringify(data?.ops)
  const update = (patch: Partial<ShellProfile>) => setOps({ ...ops, shell: { ...ops.shell, profiles: profiles.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) } })
  const add = () => {
    const id = `p${Date.now().toString(36)}`
    const np: ShellProfile = { ...p, id, name: 'New server', notes: '' }
    setOps({ ...ops, shell: { ...ops.shell, profiles: [...profiles, np] } })
    setSel(id)
  }
  const remove = () => {
    if (profiles.length <= 1 || !confirm(`Delete profile “${p.name}”?`)) return
    const rest = profiles.filter((x) => x.id !== p.id)
    setOps({ ...ops, shell: { ...ops.shell, profiles: rest, defaultProfile: ops.shell.defaultProfile === p.id ? rest[0].id : ops.shell.defaultProfile } })
    setSel(rest[0].id)
  }
  const sshOpts = [`-p ${p.port}`, p.keyPath ? `-i ${p.keyPath}` : '', p.sshOptions].filter(Boolean).join(' ')
  const sshCmd = `ssh ${sshOpts} ${p.user}@${p.host}`
  const alias = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server'
  const serverRecipe = recipeById('mosh-server')!.generate(ops, { udp: `${p.udpFrom}:${p.udpTo}` }, false)
  const clientRecipe = recipeById('mosh-client')!.generate(ops, {}, false)
  const tmuxRecipe = recipeById('tmux-config')!.generate(ops, {}, false)

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">Operations</div>
          <h1 style={{ margin: 0 }}>
            <TerminalSquare size={22} /> Remote shell · mosh
          </h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Mosh keeps a shell alive across Wi-Fi changes, sleep and flaky mobile links, with local echo. Keep profiles per server; every command below is ready to copy on desktop or phone.</p>
        </div>
        <button className="btn primary sm" onClick={() => save.mutate(ops, { onSuccess: () => notify('Shell profiles saved', 'success'), onError: (e: Error) => notify(e.message, 'error') })} disabled={!dirty || save.isPending}>
          <Save size={13} /> Save profiles
        </button>
      </div>

      <div className="shell-layout">
        <aside className="card stack" style={{ gap: 6, padding: 8 }}>
          {profiles.map((x) => (
            <button key={x.id} className={`dev-session-item ${x.id === p.id ? 'active' : ''}`} onClick={() => setSel(x.id)} data-profile={x.id}>
              <strong>{x.name}</strong>
              <span className="muted small">
                {x.user}@{x.host}:{x.port}
              </span>
              {ops.shell.defaultProfile === x.id && <span className="chip">default</span>}
            </button>
          ))}
          <button className="btn sm" onClick={add}>
            <Plus size={13} /> New profile
          </button>
        </aside>

        <div className="stack grow" style={{ gap: 12, minWidth: 0 }}>
          <section className="card stack" style={{ gap: 10 }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Profile</h3>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn ghost sm" onClick={() => setOps({ ...ops, shell: { ...ops.shell, defaultProfile: p.id } })} disabled={ops.shell.defaultProfile === p.id}>
                  Make default
                </button>
                <button className="btn ghost icon sm danger" onClick={remove} title="Delete profile" disabled={profiles.length <= 1}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <div className="ops-grid">
              <label className="field">
                <span>Name</span>
                <input className="input" value={p.name} onChange={(e) => update({ name: e.target.value })} />
              </label>
              <label className="field">
                <span>Host</span>
                <input className="input" value={p.host} onChange={(e) => update({ host: e.target.value })} />
              </label>
              <label className="field">
                <span>User</span>
                <input className="input" value={p.user} onChange={(e) => update({ user: e.target.value })} />
              </label>
              <label className="field">
                <span>SSH port</span>
                <input className="input" type="number" value={p.port} onChange={(e) => update({ port: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>SSH key path (your machine)</span>
                <input className="input" value={p.keyPath} onChange={(e) => update({ keyPath: e.target.value })} placeholder="~/.ssh/id_ed25519" />
              </label>
              <label className="field">
                <span>Extra ssh options</span>
                <input className="input" value={p.sshOptions} onChange={(e) => update({ sshOptions: e.target.value })} placeholder="-o ServerAliveInterval=30" />
              </label>
              <label className="field">
                <span>mosh-server path on the host</span>
                <input className="input" value={p.moshServer} onChange={(e) => update({ moshServer: e.target.value })} />
              </label>
              <label className="field">
                <span>UDP port range</span>
                <span className="row" style={{ gap: 6 }}>
                  <input className="input" type="number" value={p.udpFrom} onChange={(e) => update({ udpFrom: Number(e.target.value) })} />
                  <input className="input" type="number" value={p.udpTo} onChange={(e) => update({ udpTo: Number(e.target.value) })} />
                </span>
              </label>
              <label className="field">
                <span>Prediction (local echo)</span>
                <select className="select" value={p.predict} onChange={(e) => update({ predict: e.target.value as ShellProfile['predict'] })}>
                  {PREDICT.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Locale (must exist on the server)</span>
                <input className="input" value={p.locale} onChange={(e) => update({ locale: e.target.value })} />
              </label>
              <label className="field">
                <span>tmux session to attach (blank = none)</span>
                <input className="input" value={p.tmux} onChange={(e) => update({ tmux: e.target.value })} placeholder="main" />
              </label>
              <label className="field">
                <span>Notes</span>
                <input className="input" value={p.notes} onChange={(e) => update({ notes: e.target.value })} />
              </label>
            </div>
          </section>

          <section className="card stack" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>Connect</h3>
            <CommandBlock title="mosh" hint="resilient shell with local echo" code={`LANG=${p.locale} LC_ALL=${p.locale} ${moshCommand(p)}`} filename={`${alias}-mosh.sh`} />
            {p.tmux && <CommandBlock title="mosh + tmux (attach or create the session)" hint="survives disconnects completely" code={`LANG=${p.locale} LC_ALL=${p.locale} ${moshCommand(p, { tmux: true })}`} filename={`${alias}-mosh-tmux.sh`} />}
            <CommandBlock title="plain ssh (fallback)" code={sshCmd} filename={`${alias}-ssh.sh`} />
            <CommandBlock title="~/.ssh/config entry" hint={`then just: mosh ${alias}  or  ssh ${alias}`} code={`Host ${alias}\n  HostName ${p.host}\n  User ${p.user}\n  Port ${p.port}${p.keyPath ? `\n  IdentityFile ${p.keyPath}` : ''}\n  ServerAliveInterval 30\n  ServerAliveCountMax 4\n  TCPKeepAlive yes`} filename={`${alias}-ssh-config.txt`} />
          </section>

          <section className="card stack" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>
              <Smartphone size={15} /> From a phone (Android)
            </h3>
            <p className="muted small" style={{ margin: 0 }}>Termux (from F-Droid) runs real mosh. Termius and Blink Shell also speak mosh with a nicer keyboard. Pair this with the Android developer-panel app for a complete mobile toolkit.</p>
            <CommandBlock title="Termux one-time setup" code={`pkg update -y && pkg install -y mosh openssh tmux\nmkdir -p ~/.ssh && chmod 700 ~/.ssh\n# bring your key over (or make a new one and add its .pub to the server's authorized_keys):\nssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""\ncat ~/.ssh/id_ed25519.pub`} filename="termux-setup.sh" />
            <CommandBlock title="Termux connect" code={`${moshCommand({ ...p, keyPath: '~/.ssh/id_ed25519' }, { tmux: !!p.tmux })}`} filename="termux-connect.sh" />
            <CommandBlock title="Add the phone's key on the server" hint="paste the .pub printed above into PUBKEY" code={`PUBKEY='ssh-ed25519 AAAA... phone'\nmkdir -p ~/.ssh && chmod 700 ~/.ssh\ngrep -qF "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null || echo "$PUBKEY" >> ~/.ssh/authorized_keys\nchmod 600 ~/.ssh/authorized_keys`} filename="add-phone-key.sh" />
          </section>

          <section className="card stack" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>Server setup</h3>
            <CommandBlock title="Install mosh-server, locale, tmux and open UDP" code={serverRecipe.remote ?? ''} filename="mosh-server-setup.sh" />
            <CommandBlock title="tmux config" code={tmuxRecipe.remote ?? ''} filename="tmux-conf.sh" />
            <CommandBlock title="Install the client on your machine" code={clientRecipe.local ?? ''} filename="mosh-client-install.sh" />
          </section>

          <section className="card stack" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>Diagnostics</h3>
            <CommandBlock title="Is mosh-server reachable and does the locale work?" code={`${sshCmd} 'which mosh-server && mosh-server --version 2>&1 | head -1; locale -a | grep -i utf; echo "UDP listeners:"; ss -ulpn | grep mosh || echo none yet'`} filename="mosh-diag.sh" />
            <CommandBlock title="Verbose connection (shows where it stalls)" code={`${moshCommand(p, { verbose: true })} 2>&1 | head -20`} filename="mosh-verbose.sh" />
            <CommandBlock title="Common fixes" code={`# "Nothing received from server on UDP port 60001": open ${p.udpFrom}:${p.udpTo}/udp in ufw AND hPanel → VPS → Firewall\n# "mosh-server needs a UTF-8 native locale": on the server run  locale-gen ${p.locale} && update-locale LANG=${p.locale}\n# "mosh-server not found": apt-get install mosh, or set the full path in the profile\n# Stuck session: kill it on the server with  pkill mosh-server  (tmux keeps your work)`} filename="mosh-fixes.txt" />
          </section>
        </div>
      </div>
    </div>
  )
}
