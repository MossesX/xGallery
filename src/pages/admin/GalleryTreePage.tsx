import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Clapperboard, File, FolderOpen, FolderTree, Image as ImageIcon, Images, Search, User as UserIcon } from 'lucide-react'
import { api } from '../../api/client'
import { useAdminTree } from '../../api/hooks'
import type { MediaItem, TreeAlbum, TreeGallery, TreeUser } from '../../api/types'
import { Avatar } from '../../components/Avatar'
import { AlbumBrowserModal } from '../../components/AlbumBrowserModal'
import { Lightbox } from '../../components/Lightbox'
import { formatBytes } from '../../lib/media'

type Mode = 'users' | 'galleries'

/** Owner only: the whole site as a tree, by person or by gallery, filtered as you type. */
export function GalleryTreePage() {
  const [mode, setMode] = useState<Mode>('users')
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 180)
    return () => clearTimeout(t)
  }, [typed])
  const { data, isLoading } = useAdminTree(q)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<{ type: 'user' | 'gallery' | 'album'; id: number } | null>(null)
  const [browse, setBrowse] = useState<number | null>(null)
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null)
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  // Searching expands everything that matched.
  useEffect(() => {
    if (!q || !data) return
    const keys = new Set<string>()
    for (const u of data.tree) {
      keys.add(`u${u.id}`)
      for (const g of u.galleries) keys.add(`g${g.id}`)
    }
    setOpen(keys)
  }, [q, data])

  const galleriesFlat = useMemo(() => (data?.tree ?? []).flatMap((u) => u.galleries.map((g) => ({ ...g, user: u }))), [data])
  const selAlbum = selected?.type === 'album' ? selected.id : null
  const { data: files } = useQuery({ queryKey: ['admin-album-files', selAlbum], queryFn: () => api.get<{ files: MediaItem[] }>(`/api/admin/albums/${selAlbum}/files`).then((r) => r.files), enabled: selAlbum != null })

  const AlbumRow = ({ a, depth }: { a: TreeAlbum; depth: number }) => (
    <div className={`tree-row ${selected?.type === 'album' && selected.id === a.id ? 'is-selected' : ''}`} style={{ paddingLeft: 12 + depth * 18 }} onClick={() => setSelected({ type: 'album', id: a.id })} onDoubleClick={() => setBrowse(a.id)}>
      <Images size={14} className="tree-ico" />
      <span className="tree-label clamp-1">{a.title}</span>
      <span className="muted small tree-meta">
        {a.photos} <ImageIcon size={10} /> {a.videos} <Clapperboard size={10} /> · {formatBytes(a.bytes)}
      </span>
      <span className={`badge ${a.visibility === 'public' ? 'success' : a.visibility === 'published' ? 'primary' : ''}`}>{a.visibility === 'published' ? 'buddies' : a.visibility}</span>
    </div>
  )
  const GalleryRows = ({ g, depth, user }: { g: TreeGallery; depth: number; user?: TreeUser }) => {
    const key = `g${g.id}`
    const isOpen = open.has(key)
    return (
      <>
        <div className={`tree-row ${selected?.type === 'gallery' && selected.id === g.id ? 'is-selected' : ''}`} style={{ paddingLeft: 12 + depth * 18 }} onClick={() => { toggle(key); setSelected({ type: 'gallery', id: g.id }) }}>
          {isOpen ? <ChevronDown size={14} className="tree-caret" /> : <ChevronRight size={14} className="tree-caret" />}
          <FolderOpen size={14} className="tree-ico" />
          <span className="tree-label clamp-1">
            {g.title}
            {user ? <span className="muted small"> · {user.displayName}</span> : null}
          </span>
          <span className="muted small tree-meta">{g.albums.length} albums{g.isPrimary ? ' · primary' : ''}</span>
        </div>
        {isOpen && g.albums.map((a) => <AlbumRow a={a} depth={depth + 1} key={a.id} />)}
        {isOpen && g.albums.length === 0 && (
          <div className="tree-row muted small" style={{ paddingLeft: 12 + (depth + 1) * 18 }}>
            No albums
          </div>
        )}
      </>
    )
  }
  const UserRows = ({ u }: { u: TreeUser }) => {
    const key = `u${u.id}`
    const isOpen = open.has(key)
    return (
      <>
        <div className={`tree-row ${selected?.type === 'user' && selected.id === u.id ? 'is-selected' : ''}`} onClick={() => { toggle(key); setSelected({ type: 'user', id: u.id }) }}>
          {isOpen ? <ChevronDown size={14} className="tree-caret" /> : <ChevronRight size={14} className="tree-caret" />}
          <Avatar name={u.displayName} size={20} src={u.avatarUrl} />
          <span className="tree-label clamp-1">
            {u.displayName} <span className="muted small">@{u.username}</span>
          </span>
          <span className="muted small tree-meta">
            {u.galleries.length} galler{u.galleries.length === 1 ? 'y' : 'ies'} · {u.galleries.reduce((n, g) => n + g.albums.length, 0)} albums
          </span>
        </div>
        {isOpen && u.galleries.map((g) => <GalleryRows g={g} depth={1} key={g.id} />)}
      </>
    )
  }

  const selUser = selected?.type === 'user' ? data?.tree.find((u) => u.id === selected.id) : undefined
  const selGallery = selected?.type === 'gallery' ? galleriesFlat.find((g) => g.id === selected.id) : undefined
  const selAlbumNode = selAlbum != null ? galleriesFlat.flatMap((g) => g.albums.map((a) => ({ ...a, gallery: g }))).find((a) => a.id === selAlbum) : undefined

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 2)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">Owner only</div>
          <h1 style={{ margin: 0 }}>
            <FolderTree size={22} /> Gallery browser
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {data ? `${data.totals.users} people · ${data.totals.galleries} galleries · ${data.totals.albums} albums` : 'Everything on the site, as a tree.'}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="feed-tabs">
            <button className={mode === 'users' ? 'active' : ''} onClick={() => setMode('users')}>
              <UserIcon size={13} /> By person
            </button>
            <button className={mode === 'galleries' ? 'active' : ''} onClick={() => setMode('galleries')}>
              <FolderOpen size={13} /> By gallery
            </button>
          </div>
          <label className="feed-search" style={{ minWidth: 260 }}>
            <Search size={14} />
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Filter as you type: person, gallery, album" aria-label="Filter tree" autoFocus />
          </label>
        </div>
      </div>
      <div className="tree-layout">
        <div className="card tree-pane">
          {isLoading && !data ? (
            <div className="muted small" style={{ padding: 12 }}>
              Loading…
            </div>
          ) : !data?.tree.length ? (
            <div className="muted small" style={{ padding: 12 }}>
              Nothing matches.
            </div>
          ) : mode === 'users' ? (
            data.tree.map((u) => <UserRows u={u} key={u.id} />)
          ) : (
            galleriesFlat.map((g) => <GalleryRows g={g} depth={0} user={g.user} key={g.id} />)
          )}
        </div>
        <div className="card tree-detail">
          {!selected && (
            <div className="muted small" style={{ padding: 16 }}>
              Select a person, gallery or album. Double-click an album to open the floating browser.
            </div>
          )}
          {selUser && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                <Avatar name={selUser.displayName} size={44} src={selUser.avatarUrl} />
                <div>
                  <strong>{selUser.displayName}</strong>
                  <div className="muted small">
                    @{selUser.username} · {selUser.role} {selUser.email ? `· ${selUser.email}` : ''} {selUser.phone ? `· ${selUser.phone}` : ''}
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Link to={`/admin/users?manage=${selUser.id}`} className="btn sm">
                  Manage account
                </Link>
                <Link to={`/admin/activity?userId=${selUser.id}`} className="btn sm">
                  Activity
                </Link>
              </div>
              {selUser.galleries.map((g) => (
                <div key={g.id} className="small">
                  <strong>{g.title}</strong> <span className="muted">· {g.albums.length} albums · {formatBytes(g.albums.reduce((n, a) => n + a.bytes, 0))}</span>
                </div>
              ))}
            </div>
          )}
          {selGallery && (
            <div className="stack" style={{ gap: 10 }}>
              <strong>{selGallery.title}</strong>
              <div className="muted small">
                {selGallery.user.displayName} · {selGallery.albums.length} albums · {selGallery.isPrimary ? 'primary gallery' : 'extra gallery'}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Link to={`/public/${selGallery.slug}`} className="btn sm">
                  Public page
                </Link>
                <Link to={`/g/${selGallery.slug}`} className="btn sm">
                  Member view
                </Link>
              </div>
              <div className="album-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                {selGallery.albums.map((a) => (
                  <button key={a.id} className="tree-album-card" onClick={() => setSelected({ type: 'album', id: a.id })} onDoubleClick={() => setBrowse(a.id)}>
                    <strong className="clamp-1">{a.title}</strong>
                    <span className="muted small">
                      {a.photos} photos · {a.videos} videos
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selAlbumNode && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{selAlbumNode.title}</strong>
                  <div className="muted small">
                    {selAlbumNode.gallery.user.displayName} · {selAlbumNode.gallery.title} · {selAlbumNode.photos} photos · {selAlbumNode.videos} videos · {formatBytes(selAlbumNode.bytes)}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn primary sm" onClick={() => setBrowse(selAlbumNode.id)}>
                    <Images size={13} /> Browse
                  </button>
                  <Link to={`/album/${selAlbumNode.slug}`} className="btn sm">
                    Open page
                  </Link>
                  <a className="btn sm" href={`/api/albums/${selAlbumNode.id}/download.zip`}>
                    ZIP
                  </a>
                </div>
              </div>
              {!files ? (
                <div className="muted small">Loading files…</div>
              ) : (
                <div className="tree-files">
                  {files.map((f, i) => (
                    <button key={f.id} className="tree-file" onClick={() => setLightbox({ items: files, index: i })} title={`${f.title} · ${formatBytes(f.size)}`}>
                      {f.thumbUrl ? <img src={f.thumbUrl} alt="" loading="lazy" /> : <File size={20} />}
                      <span className="clamp-1 small">{f.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <AlbumBrowserModal albumId={browse} onClose={() => setBrowse(null)} />
      {lightbox && <Lightbox items={lightbox.items} index={lightbox.index} onClose={() => setLightbox(null)} onNavigate={(i) => setLightbox({ ...lightbox, index: i })} allowComments={false} allowLikes={false} allowDownloads readOnly context={selAlbumNode?.title} />}
    </div>
  )
}
