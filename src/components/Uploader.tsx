import { useRef, useState, type DragEvent } from 'react'
import { ImagePlus, Upload } from 'lucide-react'
import { uploadRaw } from '../api/client'
import { kindOf, mimeOf, processFile } from '../lib/media'
import type { MediaItem } from '../api/types'

export interface UploadItem {
  name: string
  progress: number
  status: 'queued' | 'processing' | 'uploading' | 'done' | 'error'
  error?: string
}

/** The upload queue: photos and videos go up one at a time with progress; failures stay listed. */
export function useUploadQueue(albumId: number, onUploaded: (m: MediaItem) => void) {
  const [items, setItems] = useState<UploadItem[]>([])
  const count = useRef(0)

  const update = (i: number, patch: Partial<UploadItem>) => setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))

  const addFiles = async (files: FileList | File[]) => {
    const all = Array.from(files)
    const list = all.filter((f) => kindOf(f))
    const skipped = all.filter((f) => !kindOf(f))
    const base = count.current
    count.current += list.length + skipped.length
    setItems((old) => [
      ...old,
      ...list.map((f) => ({ name: f.name, progress: 0, status: 'queued' as const })),
      ...skipped.map((f) => ({ name: f.name, progress: 0, status: 'error' as const, error: 'Not a photo or video' })),
    ])
    for (let i = 0; i < list.length; i++) {
      const idx = base + i
      const file = list[i]
      try {
        update(idx, { status: 'processing' })
        const meta = await processFile(file)
        update(idx, { status: 'uploading' })
        const res = (await uploadRaw(
          `/api/albums/${albumId}/media`,
          file,
          mimeOf(file),
          { fileName: file.name, width: meta.width, height: meta.height, duration: meta.duration, title: file.name.replace(/\.[^.]+$/, '') },
          (p) => update(idx, { progress: p * (meta.thumb ? 0.9 : 1) }),
        )) as { media: MediaItem }
        let media = res.media
        if (meta.thumb) {
          try {
            media = ((await uploadRaw(`/api/media/${res.media.id}/thumb`, meta.thumb, 'image/webp', {})) as { media: MediaItem }).media
          } catch {
            /* the item is in; it just shows without a thumbnail */
          }
        }
        onUploaded(media)
        update(idx, { status: 'done', progress: 1 })
      } catch (err) {
        update(idx, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
      }
    }
  }

  const busy = items.some((i) => i.status === 'queued' || i.status === 'processing' || i.status === 'uploading')
  return { items, addFiles, busy }
}

export function UploadList({ items }: { items: UploadItem[] }) {
  const visible = items.filter((it) => it.name && it.status !== 'done')
  if (!visible.length) return null
  return (
    <div className="upload-list" data-upload-list="">
      {visible.map((it, i) => (
        <div className={`upload-row ${it.status}`} key={i}>
          <Upload size={14} />
          <span className="grow ellipsis">{it.name}</span>
          <span className="muted small">{it.status === 'error' ? it.error : it.status === 'uploading' ? `${Math.round(it.progress * 100)}%` : it.status}</span>
          <div className="progress">
            <div style={{ width: `${it.progress * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export const UPLOAD_ACCEPT = 'image/*,video/*,.mov,.mkv,.3gp,.heic,.heif,.m4v,.avi'

export function Uploader({ albumId, onUploaded }: { albumId: number; onUploaded: (m: MediaItem) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const { items, addFiles } = useUploadQueue(albumId, onUploaded)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  return (
    <div className="stack">
      <div
        className={`dropzone ${dragging ? 'active' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
      >
        <div className="dropzone-icon">
          <ImagePlus size={26} strokeWidth={1.4} />
        </div>
        <div>
          <strong>Drop images or videos here</strong> or click to browse
        </div>
        <div className="small muted">JPEG, PNG, WebP, GIF, HEIC, MP4, MOV, WebM, MKV, 3GP. Thumbnails are generated on the fly.</div>
        <input
          ref={input}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      <UploadList items={items} />
    </div>
  )
}
