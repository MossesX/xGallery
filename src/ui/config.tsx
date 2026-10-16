import { useEffect } from 'react'
import { Bell, Bookmark, Braces, Camera, Code2, Globe, Heart, Home, Images, Info, LayoutGrid, Link2, LogIn, Mail, MessageCircle, Settings2, Sparkles, Star, UserCircle2, UserPlus, Users, Wrench, type LucideIcon } from 'lucide-react'
import { useSettings } from '../api/hooks'
import type { User } from '../api/types'
import type { ShowTo, UiConfig, UiLink } from '../api/dev'
import { useUI } from '../store/ui'

/**
 * The site design the developer panel edits (navigation, toolbar, footer, home sections, context
 * menu, custom CSS, feature flags, layout). The server merges it onto its defaults and serves it
 * with /api/settings; while a developer edits, their draft is applied live through the UI store.
 *
 * Safe mode (`?safe=1`) ignores the whole config so a broken design can always be repaired.
 */

const link = (id: string, label: string, to: string, icon: string, show: ShowTo = 'all'): UiLink => ({ id, label, to, icon, show, enabled: true, newTab: false })

export const DEFAULT_UI: UiConfig = {
  nav: {
    items: [link('home', 'Home', '/', 'Home'), link('galleries', 'Galleries', '/galleries', 'Users', 'members'), link('explore', 'People', '/public', 'Users', 'guests'), link('photos', 'Photos', '/photos', 'LayoutGrid', 'members'), link('saved', 'Saved', '/favorites', 'Bookmark', 'members'), link('messages', 'Messages', '/me/messages', 'MessageCircle', 'members'), link('admin', 'Admin', '/admin', 'Settings2', 'admins')],
  },
  toolbar: { clock: true, search: true, bell: true, newAlbums: true, adminBell: true, settings: true, assistant: true, colorMode: true, signOut: true, buttons: [] },
  footer: { text: '', links: [link('public', 'Public galleries', '/public', 'Globe'), link('me', 'My space', '/me', 'UserCircle2', 'members'), link('contact', 'Contact the owner', '/contact', 'Mail', 'members'), link('request', 'Request an account', '/request-account', 'UserPlus', 'guests'), link('login', 'Member sign in', '/login', 'LogIn', 'guests')], poweredBy: true },
  home: {
    sections: [
      { id: 'hero', type: 'hero', enabled: true, title: '', html: '' },
      { id: 'galleries', type: 'galleries', enabled: true, title: 'Galleries', html: '' },
      { id: 'albums', type: 'albums', enabled: true, title: 'All albums', html: '' },
    ],
  },
  contextMenu: { openAlbum: true, togglePublic: true, privateLink: true, askSelection: true, askElement: true, explainPage: true, openAssistant: true, settings: true, copySelection: true, openLink: true, copyPageLink: true, custom: [] },
  css: '',
  flags: { reactions: true, favorites: true, comments: true, timeline: true, zipDownload: true, buddies: true, messaging: true, publicDirectory: true, requestAccount: true, forgotPassword: true, galleryThemes: true, shareLinks: true, collaborators: true },
  banner: { brand: 'amberx', accent: '#ff7a1a', sticky: true, dense: false, showProduct: true },
  layout: { density: 'comfortable', fontScale: 1, radius: null, maxWidth: 1400 },
}

/** `?safe=1` turns the custom design off for this tab; `?safe=0` turns it back on. */
export function isSafeMode(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('safe')
    if (q === '1') sessionStorage.setItem('xg-safe', '1')
    else if (q === '0') sessionStorage.removeItem('xg-safe')
    return sessionStorage.getItem('xg-safe') === '1'
  } catch {
    return false
  }
}

export function useUiConfig(): UiConfig {
  const { data } = useSettings()
  const preview = useUI((s) => s.previewUi)
  if (isSafeMode()) return DEFAULT_UI
  const base = data?.ui ?? DEFAULT_UI
  return preview ? { ...base, ...preview } : base
}

export function visibleTo(show: ShowTo, user: User | null | undefined): boolean {
  switch (show) {
    case 'all':
      return true
    case 'members':
      return !!user
    case 'guests':
      return !user
    case 'admins':
      return user?.role === 'admin' || user?.role === 'owner'
    case 'owner':
      return user?.role === 'owner'
  }
}

export const ICONS: Record<string, LucideIcon> = { Home, Images, LayoutGrid, Bookmark, MessageCircle, Settings2, Users, Sparkles, Bell, Star, Globe, Camera, Heart, Info, Link2, Code2, Wrench, Mail, UserPlus, LogIn, UserCircle2, Braces }

export function UiIcon({ name, size = 13 }: { name: string; size?: number }) {
  const I = ICONS[name]
  return I ? <I size={size} /> : null
}

export function useFlag(name: string): boolean {
  const ui = useUiConfig()
  return ui.flags[name] !== false
}

/** Applies custom CSS, layout variables and body classes from the design config. */
export function CustomStyles() {
  const ui = useUiConfig()
  const designMode = useUI((s) => s.designMode)
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--ui-font-scale', String(ui.layout.fontScale))
    root.style.setProperty('--ui-max-width', `${ui.layout.maxWidth}px`)
    if (ui.layout.radius == null) root.style.removeProperty('--ui-radius')
    else root.style.setProperty('--ui-radius', `${ui.layout.radius}px`)
    root.style.setProperty('--ui-accent', ui.banner.accent)
    document.body.classList.toggle('density-compact', ui.layout.density === 'compact')
    document.body.classList.toggle('banner-dense', ui.banner.dense)
    document.body.classList.toggle('banner-static', !ui.banner.sticky)
    document.body.classList.toggle('design-mode', designMode)
    document.body.classList.toggle('safe-mode', isSafeMode())
  }, [ui, designMode])
  return ui.css ? <style data-custom-css="">{ui.css}</style> : null
}
