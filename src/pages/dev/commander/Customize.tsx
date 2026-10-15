import { useEffect, useState } from 'react'
import { ClipboardPaste, Copy, FolderOpen, Play, RotateCcw, Save, Star, Wand2 } from 'lucide-react'
import { api } from '../../../api/client'
import { VPS, withProfile, type FileEntry } from '../../../api/vps'
import { useUI } from '../../../store/ui'
import { Dialog } from '../vps/common'
import { defaultsOf, type CmdOption, type Command, type CustomSnippet, type Vals } from './catalog'

/**
 * The customize pane: point-and-click options for the selected snippet, a live preview of the
 * exact command, and the buttons that send it to the active terminal (or run the FTP action).
 */

interface Props {
  cmd: Command | null
  vals: Vals
  setVals: (v: Vals) => void
  profile: string
  favorite: boolean
  onFavorite: () => void
  onRun: (line: string) => void
  onPaste: (line: string) => void
  onSaveCustom: (cs: CustomSnippet) => void
  onDeleteCustom: (id: string) => void
  customs: CustomSnippet[]
  runLabel?: string
  pasteLabel?: string
}

export function Customize({ cmd, vals, setVals, profile, favorite, onFavorite, onRun, onPaste, onSaveCustom, onDeleteCustom, customs, runLabel, pasteLabel }: Props) {
  const notify = useUI((s) => s.notify)
  const [edited, setEdited] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ key: string; dirOnly: boolean } | null>(null)
  const [editor, setEditor] = useState<CustomSnippet | null>(null)
  useEffect(() => setEdited(null), [cmd?.id])
  if (!cmd)
    return (
      <div className="cmdr-custom" data-cmdr-customize="">
        <div className="card muted small">Pick a command on the left. Its options appear here as switches, pickers and fields; the exact command is previewed before anything runs.</div>
      </div>
    )
  const built = cmd.build(vals)
  const line = edited ?? built
  const set = (k: string, v: Vals[string]) => setVals({ ...vals, [k]: v })
  const copy = () => navigator.clipboard.writeText(line).then(() => notify('Copied', 'success'))
  const field = (o: CmdOption) => {
    const v = vals[o.key]
    switch (o.type) {
      case 'toggle':
        return (
          <label key={o.key} className="cmdr-opt row" style={{ gap: 8 }}>
            <input type="checkbox" checked={!!v} onChange={(e) => set(o.key, e.target.checked)} data-opt={o.key} />
            <span>
              {o.label}
              {o.hint && <span className="muted small"> · {o.hint}</span>}
            </span>
          </label>
        )
      case 'select':
        return (
          <label key={o.key} className="cmdr-opt field">
            <span>{o.label}</span>
            <select className="select sm" value={String(v ?? '')} onChange={(e) => set(o.key, e.target.value)} data-opt={o.key}>
              {(o.options ?? []).map((x) => {
                const val = typeof x === 'string' ? x : x.v
                const lab = typeof x === 'string' ? x : x.l
                return (
                  <option key={val} value={val}>
                    {lab}
                  </option>
                )
              })}
            </select>
            {o.hint && <span className="muted small">{o.hint}</span>}
          </label>
        )
      case 'number':
        return (
          <label key={o.key} className="cmdr-opt field">
            <span>{o.label}</span>
            <input className="input sm" type="number" value={String(v ?? '')} onChange={(e) => set(o.key, e.target.value === '' ? '' : Number(e.target.value))} data-opt={o.key} />
            {o.hint && <span className="muted small">{o.hint}</span>}
          </label>
        )
      case 'path':
      case 'dir':
        return (
          <label key={o.key} className="cmdr-opt field">
            <span>{o.label}</span>
            <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <input className="input sm mono grow" value={String(v ?? '')} onChange={(e) => set(o.key, e.target.value)} placeholder={o.placeholder} data-opt={o.key} />
              <button className="btn ghost icon sm" type="button" title="Browse the server" onClick={() => setPicker({ key: o.key, dirOnly: o.type === 'dir' })} data-opt-browse={o.key}>
                <FolderOpen size={13} />
              </button>
            </span>
            {o.hint && <span className="muted small">{o.hint}</span>}
          </label>
        )
      default:
        return (
          <label key={o.key} className="cmdr-opt field">
            <span>{o.label}</span>
            <input className="input sm" value={String(v ?? '')} onChange={(e) => set(o.key, e.target.value)} placeholder={o.placeholder} data-opt={o.key} />
            {o.hint && <span className="muted small">{o.hint}</span>}
          </label>
        )
    }
  }
  const startCustom = () => {
    const base = customs.find((c) => c.id === cmd.id)
    setEditor(base ? { ...base } : { id: `c${Date.now().toString(36)}`, name: `${cmd.name} (mine)`, cat: 'Custom', sub: cmd.cat, summary: cmd.summary, tags: [...cmd.tags], risk: cmd.risk, template: line, opts: [] })
  }
  return (
    <div className="cmdr-custom" data-cmdr-customize="">
      <div className="row between" style={{ gap: 6 }}>
        <div>
          <div className="eyebrow">
            {cmd.cat} › {cmd.sub}
          </div>
          <h3 style={{ margin: 0 }}>{cmd.name}</h3>
          <p className="muted small" style={{ margin: '2px 0 0' }}>{cmd.summary}</p>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <span className={`chip risk-${cmd.risk}`}>{cmd.risk}</span>
          <button className={`btn ghost icon sm ${favorite ? 'active' : ''}`} onClick={onFavorite} title="Favourite" aria-label="Favourite">
            <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
      {cmd.ftp && <div className="dev-session-chip">FTP action: runs in the active FTP tab through the panel's SFTP connection, no shell needed.</div>}
      {cmd.opts.length > 0 ? (
        <div className="cmdr-opts" data-cmdr-options="">
          {cmd.opts.map(field)}
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setVals(defaultsOf(cmd)); setEdited(null) }}>
            <RotateCcw size={12} /> Reset options
          </button>
        </div>
      ) : (
        !cmd.ftp && <p className="muted small" style={{ margin: 0 }}>No options: runs as shown.</p>
      )}
      {!cmd.ftp && (
        <>
          <div className="row between">
            <span className="eyebrow">Command</span>
            {edited != null && (
              <button className="link small" onClick={() => setEdited(null)}>
                back to generated
              </button>
            )}
          </div>
          <textarea className="textarea mono cmdr-preview" value={line} onChange={(e) => setEdited(e.target.value)} rows={Math.min(8, Math.max(2, line.split('\n').length + 1))} spellCheck={false} aria-label="Command preview" data-cmdr-preview="" />
        </>
      )}
      <div className="row" style={{ gap: 4 }}>
        <button className="btn primary sm" onClick={() => onRun(line)} data-cmdr-run="">
          <Play size={12} /> {cmd.ftp ? 'Do it' : runLabel ?? 'Run in terminal'}
        </button>
        {!cmd.ftp && (
          <>
            <button className="btn sm" onClick={() => onPaste(line)} title="Type it at the prompt without pressing Enter" data-cmdr-paste="">
              <ClipboardPaste size={12} /> {pasteLabel ?? 'Paste only'}
            </button>
            <button className="btn sm" onClick={copy}>
              <Copy size={12} /> Copy
            </button>
            <button className="btn ghost sm" onClick={startCustom} title="Save this exact command as your own snippet">
              <Wand2 size={12} /> Save as mine
            </button>
          </>
        )}
        {cmd.custom && (
          <button className="btn ghost sm danger" onClick={() => window.confirm(`Delete snippet “${cmd.name}”?`) && onDeleteCustom(cmd.id)}>
            delete
          </button>
        )}
      </div>
      {picker && <PathPicker profile={profile} dirOnly={picker.dirOnly} start={String(vals[picker.key] ?? '/')} onClose={() => setPicker(null)} onPick={(p) => { set(picker.key, p); setPicker(null) }} />}
      {editor && <CustomEditor snippet={editor} onClose={() => setEditor(null)} onSave={(cs) => { onSaveCustom(cs); setEditor(null) }} />}
    </div>
  )
}

/** Browse the server over SFTP and pick a folder or file. */
function PathPicker({ profile, dirOnly, start, onClose, onPick }: { profile: string; dirOnly: boolean; start: string; onClose: () => void; onPick: (p: string) => void }) {
  const initial = start.startsWith('/') ? (dirOnly ? start : start.replace(/\/[^/]*$/, '') || '/') : '/'
  const [path, setPath] = useState(initial)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    api.get<{ path: string; entries: FileEntry[] }>(`${VPS}${withProfile(`/files?path=${encodeURIComponent(path)}`, profile)}`)
      .then((r) => alive && (setEntries(r.entries), setError('')))
      .catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [path, profile])
  const full = (n: string) => (path === '/' ? `/${n}` : `${path}/${n}`)
  return (
    <Dialog title={dirOnly ? 'Pick a folder' : 'Pick a file'} onClose={onClose}>
      <div className="stack" style={{ gap: 6 }} data-path-picker="">
        <div className="row" style={{ gap: 4 }}>
          <button className="btn ghost sm" disabled={path === '/'} onClick={() => setPath(path.replace(/\/[^/]+$/, '') || '/')}>
            ↑ up
          </button>
          <span className="mono small grow">{path}</span>
          {dirOnly && (
            <button className="btn primary sm" onClick={() => onPick(path)} data-pick-here="">
              Use this folder
            </button>
          )}
        </div>
        {error && <div className="dev-session-chip warn">{error}</div>}
        <div className="cmdr-picker-list">
          {entries.filter((e) => !dirOnly || e.type === 'dir').map((e) => (
            <button key={e.name} className="cmdr-leaf" onClick={() => (e.type === 'dir' ? setPath(full(e.name)) : onPick(full(e.name)))} onDoubleClick={() => e.type === 'dir' && onPick(full(e.name))} data-pick-entry={e.name}>
              {e.type === 'dir' ? '📁' : '📄'} {e.name}
            </button>
          ))}
          {!entries.length && !error && <span className="muted small">Empty</span>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{dirOnly ? 'Click a folder to open it, double-click to pick it.' : 'Click a file to pick it.'}</p>
      </div>
    </Dialog>
  )
}

/** Editor for a user-defined snippet: {placeholders} in the template become options. */
function CustomEditor({ snippet, onClose, onSave }: { snippet: CustomSnippet; onClose: () => void; onSave: (cs: CustomSnippet) => void }) {
  const [cs, setCs] = useState<CustomSnippet>(snippet)
  const keys = [...new Set([...cs.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
  const optFor = (k: string): CmdOption => cs.opts.find((o) => o.key === k) ?? { key: k, label: k, type: 'text', default: '' }
  const setOpt = (k: string, patch: Partial<CmdOption>) => setCs({ ...cs, opts: [...cs.opts.filter((o) => o.key !== k), { ...optFor(k), ...patch }] })
  return (
    <Dialog title="Your snippet" onClose={onClose} wide>
      <div className="stack" style={{ gap: 8 }} data-custom-editor="">
        <div className="ops-grid">
          <label className="field">
            <span>Name</span>
            <input className="input sm" value={cs.name} onChange={(e) => setCs({ ...cs, name: e.target.value })} data-custom-name="" />
          </label>
          <label className="field">
            <span>Category</span>
            <input className="input sm" value={cs.cat} onChange={(e) => setCs({ ...cs, cat: e.target.value })} />
          </label>
          <label className="field">
            <span>Subcategory</span>
            <input className="input sm" value={cs.sub} onChange={(e) => setCs({ ...cs, sub: e.target.value })} />
          </label>
          <label className="field">
            <span>Risk</span>
            <select className="select sm" value={cs.risk} onChange={(e) => setCs({ ...cs, risk: e.target.value as CustomSnippet['risk'] })}>
              <option value="safe">safe</option>
              <option value="careful">careful</option>
              <option value="danger">danger</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Summary</span>
          <input className="input sm" value={cs.summary} onChange={(e) => setCs({ ...cs, summary: e.target.value })} />
        </label>
        <label className="field">
          <span>Tags (comma separated)</span>
          <input className="input sm" value={cs.tags.join(', ')} onChange={(e) => setCs({ ...cs, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
        </label>
        <label className="field">
          <span>Template · use {'{name}'} placeholders to create options</span>
          <textarea className="textarea mono" rows={4} value={cs.template} onChange={(e) => setCs({ ...cs, template: e.target.value })} spellCheck={false} data-custom-template="" />
        </label>
        {keys.length > 0 && (
          <table className="table compact">
            <thead>
              <tr>
                <th>Placeholder</th>
                <th>Label</th>
                <th>Type</th>
                <th>Default</th>
                <th>Choices (for select, comma separated)</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const o = optFor(k)
                return (
                  <tr key={k}>
                    <td className="mono small">{`{${k}}`}</td>
                    <td>
                      <input className="input sm" value={o.label} onChange={(e) => setOpt(k, { label: e.target.value })} />
                    </td>
                    <td>
                      <select className="select sm" value={o.type} onChange={(e) => setOpt(k, { type: e.target.value as CmdOption['type'] })}>
                        {['text', 'path', 'dir', 'number', 'select', 'toggle'].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input sm" value={String(o.default ?? '')} onChange={(e) => setOpt(k, { default: e.target.value })} />
                    </td>
                    <td>
                      <input className="input sm" value={(o.options ?? []).map((x) => (typeof x === 'string' ? x : x.v)).join(', ')} onChange={(e) => setOpt(k, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} disabled={o.type !== 'select'} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary sm" disabled={!cs.name.trim() || !cs.template.trim()} onClick={() => onSave({ ...cs, opts: keys.map(optFor) })} data-custom-save="">
            <Save size={12} /> Save snippet
          </button>
        </div>
      </div>
    </Dialog>
  )
}
