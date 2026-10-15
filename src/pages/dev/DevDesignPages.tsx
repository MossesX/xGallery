import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Braces, Eye, RotateCcw, Save, Undo2 } from 'lucide-react'
import { useDevUi, useSaveUi, type UiConfig, type UiLink, type UiSection } from '../../api/dev'
import { ListEditor } from '../../components/ListEditor'
import { useUI } from '../../store/ui'
import { ICONS, UiIcon } from '../../ui/config'

/* ---------- shared: a draft of one part of the design, previewed live, saved with a snapshot ---------- */

function useUiDraft<K extends keyof UiConfig>(key: K) {
  const { data } = useDevUi()
  const save = useSaveUi()
  const notify = useUI((s) => s.notify)
  const setPreview = useUI((s) => s.setPreviewUi)
  const [draft, setDraft] = useState<UiConfig[K] | null>(null)
  useEffect(() => {
    if (data && draft == null) setDraft(data.ui[key])
  }, [data, draft, key])
  useEffect(() => () => setPreview(null), [setPreview])
  const update = (v: UiConfig[K]) => {
    setDraft(v)
    setPreview({ [key]: v } as Partial<UiConfig>)
  }
  const dirty = !!data && draft != null && JSON.stringify(draft) !== JSON.stringify(data.ui[key])
  const commit = (label: string) =>
    draft != null &&
    save.mutate(
      { ui: { [key]: draft } as Partial<UiConfig>, label },
      {
        onSuccess: () => {
          setPreview(null)
          notify(`${label} saved (snapshot taken first)`, 'success')
        },
        onError: (e: Error) => notify(e.message, 'error'),
      },
    )
  const discard = () => {
    if (data) setDraft(data.ui[key])
    setPreview(null)
  }
  const factory = () => data && update(data.defaults[key])
  return { data, draft, update, commit, discard, factory, dirty, saving: save.isPending }
}

function DesignHeader({ title, intro, label, d }: { title: string; intro: string; label: string; d: { dirty: boolean; saving: boolean; commit: (l: string) => void; discard: () => void; factory: () => void } }) {
  return (
    <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
      <div>
        <div className="eyebrow">Site builder</div>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <p className="muted small" style={{ margin: '4px 0 0' }}>{intro}</p>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className={`chip ${d.dirty ? 'warn' : ''}`}>
          <Eye size={11} /> {d.dirty ? 'previewing unsaved changes' : 'live'}
        </span>
        <button className="btn ghost sm" onClick={d.factory} title="Load the factory defaults for this part (not saved until you press Save)">
          <RotateCcw size={13} /> Factory defaults
        </button>
        <button className="btn ghost sm" onClick={d.discard} disabled={!d.dirty}>
          <Undo2 size={13} /> Discard
        </button>
        <button className="btn primary sm" onClick={() => d.commit(label)} disabled={!d.dirty || d.saving}>
          <Save size={13} /> Save {label.toLowerCase()}
        </button>
      </div>
    </div>
  )
}

const SHOW_OPTIONS = [
  ['all', 'Everyone'],
  ['members', 'Signed-in members'],
  ['guests', 'Visitors only'],
  ['admins', 'Admins and owner'],
  ['owner', 'Owner only'],
] as const

function newLink(prefix: string): UiLink {
  return { id: `${prefix}-${Math.random().toString(36).slice(2, 7)}`, label: 'New link', to: '/', icon: '', show: 'all', enabled: true, newTab: false }
}

function LinkFields({ item, update, withIcon = true }: { item: UiLink; update: (p: Partial<UiLink>) => void; withIcon?: boolean }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="field grow">
          <label>Label</label>
          <input className="input" value={item.label} onChange={(e) => update({ label: e.target.value })} maxLength={40} />
        </div>
        <div className="field grow">
          <label>Link (path or URL)</label>
          <input className="input" value={item.to} onChange={(e) => update({ to: e.target.value })} placeholder="/galleries or https://…" />
        </div>
        {withIcon && (
          <div className="field">
            <label>Icon</label>
            <select className="select" value={item.icon} onChange={(e) => update({ icon: e.target.value })}>
              <option value="">None</option>
              {Object.keys(ICONS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Show to</label>
          <select className="select" value={item.show} onChange={(e) => update({ show: e.target.value as UiLink['show'] })}>
            {SHOW_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 16 }}>
        <label className="checkbox">
          <input type="checkbox" checked={item.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Enabled
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={item.newTab} onChange={(e) => update({ newTab: e.target.checked })} /> Open in a new tab
        </label>
      </div>
    </div>
  )
}

const linkSummary = (l: UiLink): ReactNode => (
  <>
    <UiIcon name={l.icon} /> <strong>{l.label}</strong> <span className="muted small">{l.to}</span> <span className="chip">{SHOW_OPTIONS.find(([v]) => v === l.show)?.[1]}</span>
    {!l.enabled && <span className="chip warn">off</span>}
  </>
)

/* ---------- Navigation ---------- */

export function DevNavigationPage() {
  const d = useUiDraft('nav')
  if (!d.draft) return null
  return (
    <div className="stack" style={{ gap: 16 }}>
      <DesignHeader title="Navigation menu" intro="The links in the banner. Drag to reorder; each link can be shown to everyone, members, visitors, admins or just you. Changes preview live in the banner above." label="Navigation" d={d} />
      <section className="card">
        <ListEditor items={d.draft.items} onChange={(items) => d.update({ items })} renderItem={(it, u) => <LinkFields item={it} update={u} />} create={() => newLink('nav')} addLabel="Add menu link" summary={linkSummary} />
      </section>
    </div>
  )
}

/* ---------- Toolbar ---------- */

const TOOLBAR_SWITCHES: [keyof UiConfig['toolbar'], string][] = [
  ['clock', 'Live clock'],
  ['search', 'Search box (members)'],
  ['bell', 'Notification bell (members)'],
  ['newAlbums', 'New-album counter (owner)'],
  ['adminBell', 'Admin notifications icon (owner)'],
  ['assistant', 'Assistant button'],
  ['colorMode', 'Light / dark / auto toggle'],
  ['signOut', 'Sign-out button'],
]

export function DevToolbarPage() {
  const d = useUiDraft('toolbar')
  if (!d.draft) return null
  const t = d.draft
  return (
    <div className="stack" style={{ gap: 16 }}>
      <DesignHeader title="Toolbar" intro="The right-hand side of the banner: which built-in controls appear, plus your own buttons." label="Toolbar" d={d} />
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Built-in controls</h3>
        <div className="switch-grid">
          {TOOLBAR_SWITCHES.map(([k, label]) => (
            <label key={k} className="checkbox between">
              <span>{label}</span>
              <input type="checkbox" checked={t[k] as boolean} onChange={(e) => d.update({ ...t, [k]: e.target.checked })} />
            </label>
          ))}
        </div>
      </section>
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Custom buttons</h3>
        <ListEditor items={t.buttons} onChange={(buttons) => d.update({ ...t, buttons })} renderItem={(it, u) => <LinkFields item={it} update={u} />} create={() => newLink('tb')} addLabel="Add toolbar button" max={8} summary={linkSummary} emptyText="No custom buttons. Add one to put any page or external link in the toolbar." />
      </section>
    </div>
  )
}

/* ---------- Footer ---------- */

export function DevFooterPage() {
  const d = useUiDraft('footer')
  if (!d.draft) return null
  const f = d.draft
  return (
    <div className="stack" style={{ gap: 16 }}>
      <DesignHeader title="Footer" intro="The footer text and its links." label="Footer" d={d} />
      <section className="card stack" style={{ gap: 10 }}>
        <div className="field">
          <label>Footer text (leave empty for “site title · tagline”)</label>
          <input className="input" value={f.text} onChange={(e) => d.update({ ...f, text: e.target.value })} maxLength={300} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={f.poweredBy} onChange={(e) => d.update({ ...f, poweredBy: e.target.checked })} /> Show “Powered by AmberX”
        </label>
      </section>
      <section className="card">
        <ListEditor items={f.links} onChange={(links) => d.update({ ...f, links })} renderItem={(it, u) => <LinkFields item={it} update={u} withIcon={false} />} create={() => newLink('ft')} addLabel="Add footer link" summary={linkSummary} />
      </section>
    </div>
  )
}

/* ---------- Home page builder ---------- */

const SECTION_TYPES: [UiSection['type'], string, string][] = [
  ['hero', 'Featured hero', 'The big featured album at the top.'],
  ['galleries', 'Galleries row', 'Tiles of the galleries the member can see (only when there is more than one).'],
  ['albums', 'Album grid', 'Search/sort toolbar, tags and the album cards.'],
  ['people', 'People strip', 'Round avatars of everyone with a gallery.'],
  ['tags', 'Tag cloud', 'Popular tags as chips.'],
  ['custom', 'Custom HTML block', 'Your own text, images or embeds (scripts are stripped).'],
]

export function DevHomePage() {
  const d = useUiDraft('home')
  const [params] = useSearchParams()
  if (!d.draft) return null
  const h = d.draft
  return (
    <div className="stack" style={{ gap: 16 }}>
      <DesignHeader title="Home page builder" intro="Compose the signed-in home page from sections. Drag to reorder, switch sections off, add custom blocks. Open the home page in another tab to watch the preview." label="Home page" d={d} />
      {params.get('section') && <div className="muted small">Jumped here from the “{params.get('section')}” section.</div>}
      <section className="card">
        <ListEditor
          items={h.sections}
          onChange={(sections) => d.update({ sections })}
          max={12}
          create={() => ({ id: `custom-${Math.random().toString(36).slice(2, 7)}`, type: 'custom' as const, enabled: true, title: 'New block', html: '<p>Hello from the home page.</p>' })}
          addLabel="Add section"
          summary={(s) => (
            <>
              <strong>{s.title || SECTION_TYPES.find(([t]) => t === s.type)?.[1]}</strong> <span className="chip">{s.type}</span>
              {!s.enabled && <span className="chip warn">hidden</span>}
            </>
          )}
          renderItem={(s, u) => (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div className="field">
                  <label>Type</label>
                  <select className="select" value={s.type} onChange={(e) => u({ type: e.target.value as UiSection['type'] })}>
                    {SECTION_TYPES.map(([t, l]) => (
                      <option key={t} value={t}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field grow">
                  <label>Title (optional)</label>
                  <input className="input" value={s.title} onChange={(e) => u({ title: e.target.value })} maxLength={80} />
                </div>
                <label className="checkbox" style={{ marginTop: 26 }}>
                  <input type="checkbox" checked={s.enabled} onChange={(e) => u({ enabled: e.target.checked })} /> Shown
                </label>
              </div>
              <p className="muted small" style={{ margin: 0 }}>{SECTION_TYPES.find(([t]) => t === s.type)?.[2]}</p>
              {s.type === 'custom' && (
                <div className="field">
                  <label>HTML</label>
                  <textarea className="textarea mono" value={s.html} onChange={(e) => u({ html: e.target.value })} style={{ minHeight: 140 }} spellCheck={false} />
                </div>
              )}
            </div>
          )}
        />
      </section>
      <p className="muted small">
        <Link to="/" target="_blank" rel="noreferrer">
          Open the home page in a new tab
        </Link>{' '}
        to see the preview while you edit.
      </p>
    </div>
  )
}

/* ---------- Context menu ---------- */

const CM_SWITCHES: [keyof Omit<UiConfig['contextMenu'], 'custom'>, string][] = [
  ['openAlbum', 'Open album'],
  ['togglePublic', 'Make album public / private'],
  ['privateLink', 'Create private link'],
  ['askSelection', 'Ask the assistant about the selection'],
  ['askElement', 'Ask the assistant about this element'],
  ['explainPage', 'Explain this page'],
  ['openAssistant', 'Open the assistant'],
  ['copySelection', 'Copy selection'],
  ['openLink', 'Open link in new tab'],
  ['copyPageLink', 'Copy page link'],
]

export function DevContextMenuPage() {
  const d = useUiDraft('contextMenu')
  if (!d.draft) return null
  const c = d.draft
  return (
    <div className="stack" style={{ gap: 16 }}>
      <DesignHeader title="Context menu" intro="What the right-click menu offers members, plus your own entries (any page or URL)." label="Context menu" d={d} />
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Built-in entries</h3>
        <div className="switch-grid">
          {CM_SWITCHES.map(([k, label]) => (
            <label key={k} className="checkbox between">
              <span>{label}</span>
              <input type="checkbox" checked={c[k]} onChange={(e) => d.update({ ...c, [k]: e.target.checked })} />
            </label>
          ))}
        </div>
      </section>
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Custom entries</h3>
        <ListEditor items={c.custom} onChange={(custom) => d.update({ ...c, custom })} renderItem={(it, u) => <LinkFields item={it} update={u} />} create={() => newLink('cm')} addLabel="Add menu entry" max={10} summary={linkSummary} emptyText="No custom entries yet." />
      </section>
    </div>
  )
}

/* ---------- Layout & density ---------- */

export function DevLayoutPage() {
  const b = useUiDraft('banner')
  const l = useUiDraft('layout')
  const notify = useUI((s) => s.notify)
  const save = useSaveUi()
  const setPreview = useUI((s) => s.setPreviewUi)
  if (!b.draft || !l.draft) return null
  const banner = b.draft
  const layout = l.draft
  const dirty = b.dirty || l.dirty
  const commit = () =>
    save.mutate(
      { ui: { banner, layout }, label: 'Layout & banner' },
      {
        onSuccess: () => {
          setPreview(null)
          notify('Layout saved (snapshot taken first)', 'success')
        },
        onError: (e: Error) => notify(e.message, 'error'),
      },
    )
  const updateBoth = (nb: UiConfig['banner'], nl: UiConfig['layout']) => {
    b.update(nb)
    l.update(nl)
    setPreview({ banner: nb, layout: nl })
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">Site builder</div>
          <h1 style={{ margin: 0 }}>Layout & density</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Banner style, accent colour, page width, text size and spacing. Colours and fonts themselves live in Themes.</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" onClick={() => { b.discard(); l.discard() }} disabled={!dirty}>
            <Undo2 size={13} /> Discard
          </button>
          <button className="btn primary sm" onClick={commit} disabled={!dirty || save.isPending}>
            <Save size={13} /> Save layout
          </button>
        </div>
      </div>
      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Banner</h3>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="field">
            <label>Brand style</label>
            <select className="select" value={banner.brand} onChange={(e) => updateBoth({ ...banner, brand: e.target.value as 'amberx' | 'text' }, layout)}>
              <option value="amberx">AmberX mark + wordmark</option>
              <option value="text">Site title only</option>
            </select>
          </div>
          <div className="field">
            <label>Accent colour</label>
            <input className="input" type="color" value={banner.accent} onChange={(e) => updateBoth({ ...banner, accent: e.target.value }, layout)} style={{ width: 80, padding: 2 }} />
          </div>
          <label className="checkbox" style={{ marginTop: 26 }}>
            <input type="checkbox" checked={banner.sticky} onChange={(e) => updateBoth({ ...banner, sticky: e.target.checked }, layout)} /> Sticky banner
          </label>
          <label className="checkbox" style={{ marginTop: 26 }}>
            <input type="checkbox" checked={banner.dense} onChange={(e) => updateBoth({ ...banner, dense: e.target.checked }, layout)} /> Compact banner
          </label>
          <label className="checkbox" style={{ marginTop: 26 }}>
            <input type="checkbox" checked={banner.showProduct} onChange={(e) => updateBoth({ ...banner, showProduct: e.target.checked }, layout)} /> Show site title under the wordmark
          </label>
        </div>
      </section>
      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Page layout</h3>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="field">
            <label>Density</label>
            <select className="select" value={layout.density} onChange={(e) => updateBoth(banner, { ...layout, density: e.target.value as 'comfortable' | 'compact' })}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <div className="field">
            <label>Text size ({Math.round(layout.fontScale * 100)}%)</label>
            <input type="range" min={0.8} max={1.3} step={0.05} value={layout.fontScale} onChange={(e) => updateBoth(banner, { ...layout, fontScale: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Corner radius (blank = theme)</label>
            <input className="input" type="number" min={0} max={32} value={layout.radius ?? ''} onChange={(e) => updateBoth(banner, { ...layout, radius: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 120 }} />
          </div>
          <div className="field">
            <label>Max page width (px)</label>
            <input className="input" type="number" min={900} max={2400} step={20} value={layout.maxWidth} onChange={(e) => updateBoth(banner, { ...layout, maxWidth: Number(e.target.value) })} style={{ width: 140 }} />
          </div>
        </div>
      </section>
    </div>
  )
}

/* ---------- Custom CSS ---------- */

const CSS_PRESETS: [string, string][] = [
  ['Rounder cards', '.album-card, .card { border-radius: 22px; }'],
  ['Bigger hero title', '.hero-content h1 { font-size: 3.4rem; }'],
  ['Hide the clock', '.clock { display: none; }'],
  ['Glass banner', '.banner { backdrop-filter: blur(14px); background: color-mix(in srgb, var(--c-bg) 70%, transparent); }'],
  ['Serif headings', 'h1, h2, h3 { font-family: Georgia, serif; }'],
  ['Wider album grid gaps', '.album-grid { gap: 28px; }'],
]

export function DevCssPage() {
  const d = useUiDraft('css')
  if (d.draft == null) return null
  return (
    <div className="stack" style={{ gap: 16 }}>
      <DesignHeader title="Custom CSS" intro="Styles appended to every page. They preview live as you type. Unsafe constructs (@import, expressions, scripts) are stripped on save; if anything goes wrong open any page with ?safe=1." label="Custom CSS" d={d} />
      <section className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="muted small">Presets:</span>
          {CSS_PRESETS.map(([name, css]) => (
            <button key={name} className="chip chip-tag" onClick={() => d.update(`${d.draft}${d.draft?.trim() ? '\n' : ''}${css}\n`)}>
              {name}
            </button>
          ))}
        </div>
        <textarea className="textarea mono dev-css" value={d.draft} onChange={(e) => d.update(e.target.value)} spellCheck={false} aria-label="Custom CSS" placeholder={'/* e.g. */\n.banner { border-bottom: 2px solid var(--c-primary); }'} />
        <details>
          <summary className="muted small">
            <Braces size={11} /> Theme variables you can use
          </summary>
          <code className="small">--c-bg --c-surface --c-surface-hover --c-border --c-text --c-text-muted --c-primary --c-primary-soft --c-primary-text --c-success --c-warning --font-display --font-body --radius --space --ui-accent</code>
        </details>
      </section>
    </div>
  )
}

/* ---------- Feature switches ---------- */

export function DevFeaturesPage() {
  const d = useUiDraft('flags')
  if (!d.draft) return null
  const flags = d.draft
  const labels = d.data?.flagLabels ?? {}
  return (
    <div className="stack" style={{ gap: 16 }}>
      <DesignHeader title="Feature switches" intro="Turn whole features of the site on or off for everyone. Policies (who may do what) stay in the owner console." label="Feature switches" d={d} />
      <section className="card">
        <div className="switch-grid">
          {Object.keys(flags).map((k) => (
            <label key={k} className="checkbox between">
              <span>{labels[k] ?? k}</span>
              <input type="checkbox" checked={flags[k]} onChange={(e) => d.update({ ...flags, [k]: e.target.checked })} />
            </label>
          ))}
        </div>
      </section>
    </div>
  )
}
