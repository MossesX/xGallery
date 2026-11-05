import type { MediaKind } from '../api/types'

const THUMB_MAX = 640

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|3gp|3g2|avi|ts|mpe?g|ogv)$/i
const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', avi: 'video/x-msvideo', ts: 'video/mp2t', mpg: 'video/mpeg', mpeg: 'video/mpeg', ogv: 'video/ogg' }

/** Photo or video: by the browser's type, or by the file name when the phone sends no type. */
export function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (IMAGE_EXT.test(file.name)) return 'image'
  if (VIDEO_EXT.test(file.name)) return 'video'
  return null
}

/** The content type to upload with: the browser's, or one guessed from the extension. */
export function mimeOf(file: File): string {
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return file.type
  return MIME_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? (file.type || 'application/octet-stream')
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/webp', quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Thumbnail failed'))), type, quality)
  })
}

function drawScaled(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const ratio = Math.min(1, THUMB_MAX / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * ratio))
  canvas.height = Math.max(1, Math.round(h * ratio))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export interface ProcessedMedia {
  kind: MediaKind
  width: number
  height: number
  duration?: number
  thumb?: Blob
}

export async function processImage(file: File): Promise<ProcessedMedia> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode image'))
      el.src = url
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    let thumb: Blob | undefined
    try {
      thumb = await canvasToBlob(drawScaled(img, w, h))
    } catch {
      thumb = undefined
    }
    return { kind: 'image', width: w, height: h, thumb }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function processVideo(file: File): Promise<ProcessedMedia> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    // A codec this browser can't decode (HEVC, some .mov/.mkv) must not block the upload: give up after 8 s.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video metadata timed out')), 8000)
      video.onloadedmetadata = () => {
        clearTimeout(timer)
        resolve()
      }
      video.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Could not decode video'))
      }
      video.src = url
    })
    const w = video.videoWidth || 16
    const h = video.videoHeight || 9
    const duration = Number.isFinite(video.duration) ? video.duration : undefined
    let thumb: Blob | undefined
    try {
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        video.onseeked = done
        const t = Math.min(1, (duration ?? 0) / 2)
        video.currentTime = t
        setTimeout(done, 1500)
      })
      thumb = await canvasToBlob(drawScaled(video, w, h))
    } catch {
      thumb = undefined
    }
    return { kind: 'video', width: w, height: h, duration, thumb }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

export async function processFile(file: File): Promise<ProcessedMedia> {
  const kind = kindOf(file)
  if (!kind) throw new Error(`Unsupported file type: ${file.type || 'unknown'}`)
  try {
    return kind === 'image' ? await processImage(file) : await processVideo(file)
  } catch {
    // The browser can't preview it (HEIC, HEVC...): upload anyway, without a thumbnail.
    return kind === 'video' ? { kind, width: 16, height: 9 } : { kind, width: 4, height: 3 }
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function formatDuration(s?: number | null): string {
  if (!s || !Number.isFinite(s)) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'album'
  )
}

/** Compact relative time: "just now", "5m", "3h", "2d", "3w", or a short date. */
export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  if (d < 35) return `${Math.floor(d / 7)}w`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
