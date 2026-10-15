import type { MediaItem } from '../api/types'

/**
 * Renders a picture of the album page (header + tile grid) on a canvas, the way the shared page
 * looks when unlocked. It is uploaded as the lock-screen backdrop and blurred by CSS there, so the
 * locked page shows the real album shape without revealing any photo.
 */

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const done = (v: HTMLImageElement | null) => { clearTimeout(t); resolve(v) }
    const t = setTimeout(() => done(null), 8000)
    img.onload = () => done(img)
    img.onerror = () => done(null)
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export async function renderAlbumSnapshot(album: { title: string; description: string }, media: MediaItem[], opts: { columns?: number; width?: number; height?: number } = {}): Promise<Blob> {
  const W = opts.width ?? 1280
  const H = opts.height ?? 860
  const cols = Math.min(6, Math.max(2, opts.columns ?? 4))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = cssVar('--c-bg', '#f6f2ec')
  ctx.fillRect(0, 0, W, H)
  const text = cssVar('--c-text', '#1b1611')
  const muted = cssVar('--c-text-muted', '#7a7068')
  const primary = cssVar('--c-primary', '#ff7a1a')
  const pad = 56
  ctx.fillStyle = primary
  ctx.font = '600 13px ui-monospace, Menlo, monospace'
  ctx.fillText('SHARED GALLERY', pad, pad + 10)
  ctx.fillStyle = text
  ctx.font = '700 44px Outfit, Sora, Inter, system-ui, sans-serif'
  ctx.fillText(album.title.slice(0, 48), pad, pad + 58)
  let y = pad + 84
  if (album.description) {
    ctx.fillStyle = muted
    ctx.font = '400 17px Inter, system-ui, sans-serif'
    const words = album.description.split(/\s+/)
    let line = ''
    let lines = 0
    for (const w of words) {
      const t = line ? `${line} ${w}` : w
      if (ctx.measureText(t).width > W - pad * 2 && line) {
        ctx.fillText(line, pad, y)
        y += 24
        line = w
        if (++lines >= 2) break
      } else line = t
    }
    if (line && lines < 2) {
      ctx.fillText(line, pad, y)
      y += 24
    }
    y += 8
  }
  y += 10
  const gap = 12
  const tileW = (W - pad * 2 - gap * (cols - 1)) / cols
  const heights = new Array(cols).fill(y)
  const items = media.slice(0, 30)
  const images = await Promise.all(items.map((m) => loadImage(m.thumbUrl ?? m.url)))
  items.forEach((m, i) => {
    const col = heights.indexOf(Math.min(...heights))
    const ratio = m.width && m.height ? m.height / m.width : 0.75
    const tileH = Math.max(90, Math.min(tileW * 1.6, tileW * ratio))
    const x = pad + col * (tileW + gap)
    const ty = heights[col]
    if (ty + 40 > H) return
    const h = Math.min(tileH, H - ty - 8)
    ctx.save()
    roundRect(ctx, x, ty, tileW, h, 12)
    ctx.clip()
    const img = images[i]
    if (img) {
      const s = Math.max(tileW / img.width, h / img.height)
      const dw = img.width * s
      const dh = img.height * s
      ctx.drawImage(img, x + (tileW - dw) / 2, ty + (h - dh) / 2, dw, dh)
    } else {
      ctx.fillStyle = `hsl(${(i * 47) % 360} 30% 70%)`
      ctx.fillRect(x, ty, tileW, h)
    }
    ctx.restore()
    heights[col] = ty + h + gap
  })
  if (!items.length) {
    ctx.fillStyle = muted
    ctx.font = '400 18px Inter, system-ui, sans-serif'
    ctx.fillText('No photos yet', pad, y + 40)
  }
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the snapshot'))), 'image/jpeg', 0.82))
}
