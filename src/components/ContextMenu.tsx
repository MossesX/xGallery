import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Code2, Copy, ExternalLink, Globe, HelpCircle, Image as ImageIcon, Link2, Lock, Pencil, Settings, Sparkles, TextSelect, Wand2 } from 'lucide-react'
import { settingsEntries } from './Banner'
import { useAiStatus, useCreateLink, useMe, useTogglePublic } from '../api/hooks'
import { useDevStatus } from '../api/dev'
import { useUI } from '../store/ui'
import { UiIcon, useUiConfig, visibleTo } from '../ui/config'

interface MenuState {
  x: number
  y: number
  selection: string
  element: string
  href: string | null
  img: string | null
  album: { id: number; slug: string; title: string; isPublic: boolean; manage: boolean } | null
  region: { label: string; to: string } | null
}

/** Describe the right-clicked element for the assistant: nearest album/media/person/title. */
function describe(el: Element | null): string {
  let cur: Element | null = el
  for (let i = 0; cur && i < 8; i++) {
    const cls = cur.getAttribute('class') ?? ''
    const h = cur.querySelector('h1, h2, h3, .feed-title, strong')?.textContent?.trim()
    if (/album-card|feed-card/.test(cls)) return `album card "${h ?? ''}"`
    if (/gallery-tile|person-row|person-bubble/.test(cls)) return `person/gallery "${h ?? cur.textContent?.trim().slice(0, 40) ?? ''}"`
    if (/media-tile|masonry-item|grid-item|viewer|lightbox|play-panel/.test(cls)) return `media item`
    if (/admin-nav|banner|footer/.test(cls)) return `navigation (${cur.textContent?.trim().slice(0, 40)})`
    if (cur.tagName === 'TABLE' || cur.tagName === 'TR') return `table row: ${cur.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80)}`
    if (cur.tagName === 'FORM' || cur.tagName === 'INPUT' || cur.tagName === 'SELECT' || cur.tagName === 'BUTTON') return `${cur.tagName.toLowerCase()} "${(cur as HTMLElement).innerText?.trim().slice(0, 40) || (cur as HTMLInputElement).placeholder || ''}"`
    cur = cur.parentElement
  }
  const t = el?.textContent?.trim().replace(/\s+/g, ' ') ?? ''
  return t ? `${el?.tagName.toLowerCase()} "${t.slice(0, 60)}"` : el?.tagName.toLowerCase() ?? 'page'
}

/** Which developer-panel editor owns the right-clicked region, if any. */
function regionOf(el: Element | null): { label: string; to: string } | null {
  if (!el) return null
  const section = el.closest<HTMLElement>('[data-section]')
  if (section) return { label: `home section “${section.dataset.sectionTitle || section.dataset.section}”`, to: `/dev/home?section=${section.dataset.section}` }
  if (el.closest('.hero-feature')) return { label: 'home page', to: '/dev/home' }
  if (el.closest('.banner-nav')) return { label: 'navigation menu', to: '/dev/navigation' }
  if (el.closest('.banner-right')) return { label: 'toolbar', to: '/dev/toolbar' }
  if (el.closest('.banner-brand')) return { label: 'banner', to: '/dev/layout' }
  if (el.closest('.banner')) return { label: 'toolbar', to: '/dev/toolbar' }
  if (el.closest('.footer')) return { label: 'footer', to: '/dev/footer' }
  if (el.closest('.media-layout, .tile-frame')) return { label: 'album layout', to: '/dev/appearance' }
  return null
}

/** Right-click anywhere: album actions, the assistant, developer shortcuts and the owner's custom entries. */
export function ContextMenu() {
  const { data: me } = useMe()
  const { data: status } = useAiStatus(!!me)
  const { data: dev } = useDevStatus(me?.role === 'owner')
  const ui = useUiConfig()
  const open = useUI((s) => s.openAssistant)
  const notify = useUI((s) => s.notify)
  const designMode = useUI((s) => s.designMode)
  const setDesignMode = useUI((s) => s.setDesignMode)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const togglePublic = useTogglePublic()
  const createLink = useCreateLink()
  const enabled = !!me
  const ai = !!status?.allowed
  const cm = ui.contextMenu
  const devUnlocked = me?.role === 'owner' && !!dev?.unlocked

  useEffect(() => {
    if (!enabled) return
    const onCtx = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target) return
      if (target.closest('input, textarea, [contenteditable="true"], .assistant, .dev-textarea, .tasks-app')) return
      if (e.shiftKey) return
      e.preventDefault()
      const selection = window.getSelection()?.toString().trim() ?? ''
      const a = target.closest('a') as HTMLAnchorElement | null
      const img = target.closest('img') as HTMLImageElement | null
      const x = Math.min(e.clientX, window.innerWidth - 270)
      const y = Math.min(e.clientY, window.innerHeight - 360)
      const al = target.closest('[data-album-id]') as HTMLElement | null
      const ownerId = al?.dataset.albumOwner ? Number(al.dataset.albumOwner) : null
      const manage = !!al && (al.dataset.albumManage === '1' || me?.role === 'owner' || (ownerId != null && ownerId === me?.id))
      const album = al ? { id: Number(al.dataset.albumId), slug: al.dataset.albumSlug ?? '', title: al.dataset.albumTitle ?? '', isPublic: al.dataset.albumPublic === '1', manage } : null
      setMenu({ x, y, selection, element: describe(target), href: a?.href ?? null, img: img?.currentSrc ?? null, album, region: regionOf(target) })
    }
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (ai && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        open({ context: { url: location.pathname, title: document.title } })
      }
    }
    document.addEventListener('contextmenu', onCtx)
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('contextmenu', onCtx)
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [enabled, ai, open, location.pathname, me?.id, me?.role])

  if (!enabled || !menu) return null
  const ctx = { url: location.pathname + location.search, title: document.title }
  const name = status?.assistantName ?? 'Assistant'
  const item = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      className="ctx-item"
      onClick={(e) => {
        e.stopPropagation()
        setMenu(null)
        onClick()
      }}
    >
      {icon} {label}
    </button>
  )
  const custom = cm.custom.filter((l) => l.enabled && visibleTo(l.show, me))
  const go = (to: string, newTab: boolean) => (/^(https?:)?\/\//i.test(to) || newTab ? window.open(to, '_blank', 'noopener') : navigate(to))
  const albumItems = menu.album && (cm.openAlbum || (menu.album.manage && (cm.togglePublic || cm.privateLink)))

  return (
    <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
      {albumItems && (
        <>
          <div className="ctx-head">
            <Globe size={12} /> Album · {menu.album!.title.slice(0, 28)}
          </div>
          {cm.openAlbum && item('Open album', <ExternalLink size={14} />, () => navigate(`/album/${menu.album!.slug}`))}
          {menu.album!.manage &&
            cm.togglePublic &&
            item(
              menu.album!.isPublic ? 'Make album private (buddies & members)' : 'Make album public',
              menu.album!.isPublic ? <Lock size={14} /> : <Globe size={14} />,
              () => togglePublic.mutate({ albumId: menu.album!.id, makePublic: !menu.album!.isPublic }, { onSuccess: () => notify(menu.album!.isPublic ? 'Album is now for buddies & members' : 'Album is now public', 'success'), onError: (e: Error) => notify(e.message, 'error') }),
            )}
          {menu.album!.manage && cm.privateLink && ui.flags.shareLinks !== false && item('Create private link (copies it)', <Link2 size={14} />, () => createLink.mutate({ albumId: menu.album!.id }, { onSuccess: (l) => notify(`Private link copied: ${l.fullUrl}`, 'success'), onError: (e: Error) => notify(e.message, 'error') }))}
          <div className="ctx-sep" />
        </>
      )}
      {ai && (cm.askSelection || cm.askElement || cm.explainPage || cm.openAssistant) && (
        <>
          <div className="ctx-head">
            <Sparkles size={12} /> {name}
          </div>
          {cm.askSelection && menu.selection && item('Ask about the selection', <TextSelect size={14} />, () => open({ text: 'Explain this:', context: { ...ctx, selection: menu.selection } }))}
          {cm.askElement && item(`Ask about this ${menu.img ? 'image' : 'element'}`, menu.img ? <ImageIcon size={14} /> : <HelpCircle size={14} />, () => open({ text: `What is this and how does it work?`, context: { ...ctx, element: menu.element + (menu.img ? ` (image ${menu.img})` : '') } }))}
          {cm.explainPage && item('Explain this page', <HelpCircle size={14} />, () => open({ text: 'Explain what this page does and how it is built.', context: ctx }))}
          {cm.openAssistant && item(`Open ${name}`, <Sparkles size={14} />, () => open({ context: ctx }))}
          <div className="ctx-sep" />
        </>
      )}
      {cm.settings && (me?.role === 'owner' || me?.role === 'admin') && (
        <>
          <div className="ctx-head">
            <Settings size={12} /> Settings
          </div>
          {settingsEntries(me.role)
            .filter((e) => e.to !== '/dev')
            .map((e) => (
              <button key={e.to} className="ctx-item" onClick={(ev) => { ev.stopPropagation(); setMenu(null); navigate(e.to) }} data-ctx-settings={e.to}>
                {e.icon} {e.label}
              </button>
            ))}
          <div className="ctx-sep" />
        </>
      )}
      {me?.role === 'owner' && (
        <>
          <div className="ctx-head">
            <Code2 size={12} /> Developer
          </div>
          {devUnlocked && menu.region && item(`Edit the ${menu.region.label}`, <Pencil size={14} />, () => navigate(menu.region!.to))}
          {devUnlocked && item(`Ask the developer AI about this ${menu.img ? 'image' : 'element'}`, <Sparkles size={14} />, () => navigate('/dev/assistant', { state: { prompt: `On page ${ctx.url} (${ctx.title}), the element "${menu.element}"${menu.selection ? ` with the selected text "${menu.selection.slice(0, 200)}"` : ''}: ` } }))}
          {devUnlocked && item(designMode ? 'Exit design mode' : 'Design mode (edit handles)', <Wand2 size={14} />, () => setDesignMode(!designMode))}
          {item(devUnlocked ? 'Developer panel' : 'Developer panel (unlock)', <Code2 size={14} />, () => navigate('/dev'))}
          <div className="ctx-sep" />
        </>
      )}
      {custom.length > 0 && (
        <>
          {custom.map((l) => (
            <button key={l.id} className="ctx-item" onClick={(e) => { e.stopPropagation(); setMenu(null); go(l.to, l.newTab) }}>
              <UiIcon name={l.icon} size={14} /> {l.label}
            </button>
          ))}
          <div className="ctx-sep" />
        </>
      )}
      {cm.copySelection && menu.selection && item('Copy selection', <Copy size={14} />, () => navigator.clipboard.writeText(menu.selection).then(() => notify('Copied', 'success')))}
      {cm.openLink && menu.href && item('Open link in new tab', <ExternalLink size={14} />, () => window.open(menu.href!, '_blank', 'noopener'))}
      {cm.copyPageLink && item('Copy page link', <Copy size={14} />, () => navigator.clipboard.writeText(window.location.href).then(() => notify('Link copied', 'success')))}
      <div className="ctx-hint muted">Shift + right-click for the browser menu{ai ? ` · Ctrl/⌘ J opens ${name}` : ''}</div>
    </div>
  )
}
