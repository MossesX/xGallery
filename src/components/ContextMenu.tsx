import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Copy, ExternalLink, HelpCircle, Image as ImageIcon, Sparkles, TextSelect } from 'lucide-react'
import { useAiStatus, useMe } from '../api/hooks'
import { useUI } from '../store/ui'

interface MenuState {
  x: number
  y: number
  selection: string
  element: string
  href: string | null
  img: string | null
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

/** Right-click anywhere: ask the assistant about the selection, the element, or the page. */
export function ContextMenu() {
  const { data: me } = useMe()
  const { data: status } = useAiStatus(!!me)
  const open = useUI((s) => s.openAssistant)
  const notify = useUI((s) => s.notify)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const location = useLocation()
  const enabled = !!me && !!status?.allowed

  useEffect(() => {
    if (!enabled) return
    const onCtx = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target) return
      // Keep the native menu inside text fields and the assistant itself.
      if (target.closest('input, textarea, [contenteditable="true"], .assistant')) return
      if (e.shiftKey) return
      e.preventDefault()
      const selection = window.getSelection()?.toString().trim() ?? ''
      const a = target.closest('a') as HTMLAnchorElement | null
      const img = target.closest('img') as HTMLImageElement | null
      const x = Math.min(e.clientX, window.innerWidth - 260)
      const y = Math.min(e.clientY, window.innerHeight - 240)
      setMenu({ x, y, selection, element: describe(target), href: a?.href ?? null, img: img?.currentSrc ?? null })
    }
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      // Ctrl/Cmd + J opens the assistant from anywhere.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
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
  }, [enabled, open, location.pathname])

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
  return (
    <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
      <div className="ctx-head">
        <Sparkles size={12} /> {name}
      </div>
      {menu.selection && item('Ask about the selection', <TextSelect size={14} />, () => open({ text: 'Explain this:', context: { ...ctx, selection: menu.selection } }))}
      {item(`Ask about this ${menu.img ? 'image' : 'element'}`, menu.img ? <ImageIcon size={14} /> : <HelpCircle size={14} />, () => open({ text: `What is this and how does it work?`, context: { ...ctx, element: menu.element + (menu.img ? ` (image ${menu.img})` : '') } }))}
      {item('Explain this page', <HelpCircle size={14} />, () => open({ text: 'Explain what this page does and how it is built.', context: ctx }))}
      {item(`Open ${name}`, <Sparkles size={14} />, () => open({ context: ctx }))}
      <div className="ctx-sep" />
      {menu.selection && item('Copy selection', <Copy size={14} />, () => navigator.clipboard.writeText(menu.selection).then(() => notify('Copied', 'success')))}
      {menu.href && item('Open link in new tab', <ExternalLink size={14} />, () => window.open(menu.href!, '_blank', 'noopener'))}
      {item('Copy page link', <Copy size={14} />, () => navigator.clipboard.writeText(window.location.href).then(() => notify('Link copied', 'success')))}
      <div className="ctx-hint muted">Shift + right-click for the browser menu · Ctrl/⌘ J opens {name}</div>
    </div>
  )
}
