import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Save, Server, ShieldCheck, TerminalSquare, Wand2 } from 'lucide-react'
import { useOps, useSaveOps, type OpsProfile } from '../../../api/ops'
import { useUI } from '../../../store/ui'
import { CommandBlock } from './CommandBlock'
import { GROUPS, overSsh, RECIPES, sshBase, type Recipe } from './recipes'

const RISK: Record<Recipe['risk'], string> = { safe: 'safe', careful: 'changes the server', danger: 'destructive' }

/** The command wizard: pick the target, pick what to do, type the values, copy the generated shell. */
export function OpsWizardPage() {
  const notify = useUI((s) => s.notify)
  const { data } = useOps()
  const save = useSaveOps()
  const [step, setStep] = useState(0)
  const [ctx, setCtx] = useState<OpsProfile | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})
  const [embed, setEmbed] = useState(false)
  const [transport, setTransport] = useState<'ssh' | 'mosh'>('ssh')
  useEffect(() => {
    if (data && !ctx) setCtx(data.ops)
  }, [data, ctx])
  const recipes = useMemo(() => picked.map((id) => RECIPES.find((r) => r.id === id)!).filter(Boolean), [picked])
  if (!ctx) return null
  const dirty = JSON.stringify(ctx) !== JSON.stringify(data?.ops)
  const set = <K extends keyof OpsProfile>(k: K, v: OpsProfile[K]) => setCtx({ ...ctx, [k]: v })
  const val = (r: Recipe, key: string) => values[r.id]?.[key] ?? r.inputs.find((i) => i.key === key)?.default ?? ''
  const setVal = (r: Recipe, key: string, v: string) => setValues({ ...values, [r.id]: { ...(values[r.id] ?? {}), [key]: v } })
  const missing = recipes.flatMap((r) => r.inputs.filter((i) => i.required && !val(r, i.key)).map((i) => `${r.title}: ${i.label}`))
  const secretsTyped = recipes.flatMap((r) => r.inputs.filter((i) => i.type === 'password').map((i) => val(r, i.key))).filter(Boolean)
  const shellProfile = ctx.shell.profiles.find((p) => p.id === ctx.shell.defaultProfile) ?? ctx.shell.profiles[0]
  const connect = transport === 'mosh' && shellProfile ? `mosh --ssh='ssh -p ${shellProfile.port}${shellProfile.keyPath ? ` -i ${shellProfile.keyPath}` : ''}' ${shellProfile.user}@${shellProfile.host}` : sshBase(ctx)

  const generated = recipes.map((r) => ({ r, out: r.generate(ctx, Object.fromEntries(r.inputs.map((i) => [i.key, val(r, i.key)])), embed) }))
  const combinedRemote = generated.filter((g) => g.out.remote).map((g) => `# ---- ${g.r.title}\n${g.out.remote}`).join('\n\n')
  const combinedLocal = generated.filter((g) => g.out.local).map((g) => `# ---- ${g.r.title}\n${g.out.local}`).join('\n\n')

  const steps = ['Target', 'Tasks', 'Details', 'Commands']
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">Operations</div>
          <h1 style={{ margin: 0 }}>
            <Wand2 size={22} /> Command wizard
          </h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Generates copy-and-paste shell for the VPS and for your own machine: rotate passwords, update GitHub secrets, deploy, back up, harden, install mosh. Nothing runs from here; secrets stay in your browser.</p>
        </div>
        <button className="btn sm" onClick={() => save.mutate(ctx, { onSuccess: () => notify('Target saved', 'success'), onError: (e: Error) => notify(e.message, 'error') })} disabled={!dirty || save.isPending}>
          <Save size={13} /> Save target
        </button>
      </div>

      <div className="wizard-steps">
        {steps.map((s, i) => (
          <button key={s} className={`wizard-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} onClick={() => setStep(i)}>
            <span className="num">{i + 1}</span> {s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <section className="card stack" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>
            <Server size={15} /> Where the commands go
          </h3>
          <div className="ops-grid">
            {(
              [
                ['host', 'VPS host or IP'],
                ['user', 'SSH user'],
                ['port', 'SSH port'],
                ['keyPath', 'SSH key on your machine (blank = password)'],
                ['repo', 'GitHub repository (owner/name)'],
                ['domain', 'Site domain'],
                ['deployDir', 'Deploy directory on the VPS'],
                ['project', 'Compose project name'],
                ['composeFile', 'Compose file'],
                ['container', 'App container name'],
                ['volume', 'Data volume'],
                ['image', 'Published image'],
                ['backupDir', 'Backup directory on the VPS'],
                ['coolifyUrl', 'Coolify URL (optional)'],
              ] as [keyof OpsProfile, string][]
            ).map(([k, label]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <input className="input" value={String(ctx[k] ?? '')} onChange={(e) => set(k, (k === 'port' ? Number(e.target.value) : e.target.value) as never)} />
              </label>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>These facts are saved on the server (no secrets). The defaults match the deploy workflow in this repository.</p>
        </section>
      )}

      {step === 1 && (
        <section className="stack" style={{ gap: 12 }}>
          {GROUPS.map((g) => (
            <div key={g} className="card stack" style={{ gap: 6 }}>
              <h3 style={{ margin: 0 }}>{g}</h3>
              {RECIPES.filter((r) => r.group === g).map((r) => (
                <label key={r.id} className={`recipe-row ${picked.includes(r.id) ? 'picked' : ''}`} data-recipe={r.id}>
                  <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                  <span className="grow">
                    <strong>{r.title}</strong>
                    <span className="muted small"> {r.description}</span>
                  </span>
                  <span className={`chip risk-${r.risk}`}>{r.risk === 'danger' && <AlertTriangle size={10} />} {RISK[r.risk]}</span>
                </label>
              ))}
            </div>
          ))}
        </section>
      )}

      {step === 2 && (
        <section className="stack" style={{ gap: 12 }}>
          {recipes.length === 0 && <div className="muted">Pick at least one task first.</div>}
          {recipes.map((r) => (
            <div key={r.id} className="card stack" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>{r.title}</h3>
              {r.inputs.length === 0 && <span className="muted small">Nothing to fill in.</span>}
              <div className="ops-grid">
                {r.inputs.map((i) => (
                  <label key={i.key} className="field">
                    <span>
                      {i.label}
                      {i.required ? ' *' : ''}
                    </span>
                    {i.type === 'select' ? (
                      <select className="select" value={val(r, i.key)} onChange={(e) => setVal(r, i.key, e.target.value)}>
                        {(i.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : i.type === 'textarea' ? (
                      <textarea className="textarea" value={val(r, i.key)} onChange={(e) => setVal(r, i.key, e.target.value)} placeholder={i.placeholder} />
                    ) : (
                      <input className="input" type={i.type === 'password' ? 'password' : i.type === 'number' ? 'number' : 'text'} value={val(r, i.key)} onChange={(e) => setVal(r, i.key, e.target.value)} placeholder={i.placeholder} autoComplete="off" />
                    )}
                    {i.hint && <em className="muted small">{i.hint}</em>}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {recipes.some((r) => r.inputs.some((i) => i.type === 'password')) && (
            <div className="card stack" style={{ gap: 6 }}>
              <label className="checkbox between">
                <span>
                  <ShieldCheck size={13} /> Embed typed secrets in the generated scripts (otherwise they prompt with read -s)
                </span>
                <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} />
              </label>
              <p className="muted small" style={{ margin: 0 }}>Prompting is safer: nothing secret lands in your clipboard, the script file or shell history. Secrets typed here are never sent to the server.</p>
            </div>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="stack" style={{ gap: 12 }}>
          {missing.length > 0 && <div className="error">Missing: {missing.join(' · ')}</div>}
          <div className="card row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <TerminalSquare size={15} />
            <strong>Connect:</strong>
            <code className="small">{connect}</code>
            <span className="grow" />
            <div className="feed-tabs sm">
              <button className={transport === 'ssh' ? 'active' : ''} onClick={() => setTransport('ssh')}>
                ssh
              </button>
              <button className={transport === 'mosh' ? 'active' : ''} onClick={() => setTransport('mosh')}>
                mosh
              </button>
            </div>
          </div>
          {generated.map(({ r, out }) => (
            <div key={r.id} className="card stack" style={{ gap: 8 }}>
              <div className="row between">
                <h3 style={{ margin: 0 }}>{r.title}</h3>
                <span className={`chip risk-${r.risk}`}>{RISK[r.risk]}</span>
              </div>
              {out.remote && <CommandBlock title="On the VPS" hint="paste into your ssh/mosh session" code={out.remote} filename={`${r.id}-remote.sh`} mask={secretsTyped} />}
              {out.local && <CommandBlock title="On your machine" hint="paste into your local terminal" code={out.local} filename={`${r.id}-local.sh`} mask={secretsTyped} />}
              {out.notes?.map((n, i) => (
                <p key={i} className="muted small" style={{ margin: 0 }}>
                  • {n}
                </p>
              ))}
            </div>
          ))}
          {recipes.length > 0 && (
            <div className="card stack" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>Everything in one go</h3>
              {combinedRemote && <CommandBlock title="All VPS steps over one ssh connection" hint="runs from your machine; stops at the first error" code={overSsh(ctx, combinedRemote)} filename="xgallery-vps-all.sh" mask={secretsTyped} />}
              {combinedLocal && <CommandBlock title="All local steps" code={combinedLocal} filename="xgallery-local-all.sh" mask={secretsTyped} />}
            </div>
          )}
        </section>
      )}

      <div className="row between">
        <button className="btn" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ChevronLeft size={14} /> Back
        </button>
        <span className="muted small">{picked.length} task{picked.length === 1 ? '' : 's'} selected</span>
        <button className="btn primary" onClick={() => setStep(Math.min(3, step + 1))} disabled={step === 3 || (step === 1 && picked.length === 0)}>
          {step === 2 ? 'Generate commands' : 'Next'} <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
