import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { db, getSetting, MEDIA_DIR, now, setSetting } from './db.js'
import { hashPassword, newSalt } from './auth.js'
import { ensureGalleryFor } from './access.js'
import { slugify } from './util.js'

/**
 * Demo community: a dozen people, each with a gallery of albums (most public) filled with generated
 * artwork, plus likes and comments between them, so the public landing page looks alive. Runs once
 * per data directory (guarded by the `demoSeeded` setting); never touches existing accounts.
 */

type Style = 'aurora' | 'dunes' | 'geo' | 'nebula' | 'bokeh' | 'skyline' | 'ripple' | 'strata'

interface AlbumSpec {
  title: string
  description: string
  tags: string[]
  style: Style
  hue: number
  n: number
  visibility: 'public' | 'published'
  hook?: boolean
}

interface PersonSpec {
  username: string
  name: string
  bio: string
  albums: AlbumSpec[]
}

const PEOPLE: PersonSpec[] = [
  {
    username: 'noor.haddad',
    name: 'Noor Haddad',
    bio: 'Night streets, neon and long exposures. Beirut → Berlin.',
    albums: [
      { title: 'Neon Rain', description: 'Wet asphalt and signage after midnight.', tags: ['night', 'city', 'neon'], style: 'bokeh', hue: 300, n: 8, visibility: 'public', hook: true },
      { title: 'Skyline Hours', description: 'The same rooftop, every hour from dusk to dawn.', tags: ['city', 'skyline'], style: 'skyline', hue: 220, n: 6, visibility: 'public' },
      { title: 'Studio Tests', description: 'Lighting experiments, work in progress.', tags: ['studio'], style: 'geo', hue: 20, n: 5, visibility: 'published' },
    ],
  },
  {
    username: 'mateo.rivas',
    name: 'Mateo Rivas',
    bio: 'Deserts, dunes and the colour of heat.',
    albums: [
      { title: 'Dune Lines', description: 'Wind-carved ridges in the Atacama at first light.', tags: ['desert', 'landscape', 'minimal'], style: 'dunes', hue: 30, n: 7, visibility: 'public', hook: true },
      { title: 'Heat Haze', description: 'Layers of distance shimmering in the afternoon.', tags: ['desert', 'abstract'], style: 'strata', hue: 15, n: 6, visibility: 'public' },
      { title: 'Camp Notes', description: 'Behind the scenes from the road.', tags: ['travel'], style: 'bokeh', hue: 40, n: 5, visibility: 'published' },
    ],
  },
  {
    username: 'aiko.tanaka',
    name: 'Aiko Tanaka',
    bio: 'Quiet geometry. Architecture and the spaces between.',
    albums: [
      { title: 'Concrete Poems', description: 'Brutalist facades reduced to shape and shadow.', tags: ['architecture', 'minimal', 'geometry'], style: 'geo', hue: 200, n: 8, visibility: 'public', hook: true },
      { title: 'Paper Light', description: 'Shoji screens and the softness of filtered sun.', tags: ['interior', 'light'], style: 'strata', hue: 40, n: 6, visibility: 'public' },
      { title: 'Stairwells', description: 'A study of ascent.', tags: ['architecture'], style: 'ripple', hue: 210, n: 5, visibility: 'public' },
    ],
  },
  {
    username: 'lena.fischer',
    name: 'Lena Fischer',
    bio: 'Chasing aurora and the blue hour above the Arctic circle.',
    albums: [
      { title: 'Northern Lights', description: 'Three nights outside Tromsø when the sky caught fire.', tags: ['aurora', 'night', 'arctic'], style: 'aurora', hue: 150, n: 9, visibility: 'public', hook: true },
      { title: 'Blue Hour', description: 'The twenty minutes after the sun gives up.', tags: ['arctic', 'minimal'], style: 'dunes', hue: 215, n: 6, visibility: 'public' },
      { title: 'Cabin Winter', description: 'Members only: the cabin, the dog, the stove.', tags: ['winter'], style: 'bokeh', hue: 200, n: 5, visibility: 'published' },
    ],
  },
  {
    username: 'kwame.mensah',
    name: 'Kwame Mensah',
    bio: 'Colour, fabric and the rhythm of Accra markets.',
    albums: [
      { title: 'Market Colour', description: 'Kente, wax print and the stalls of Makola.', tags: ['colour', 'street', 'textile'], style: 'geo', hue: 10, n: 8, visibility: 'public', hook: true },
      { title: 'Gold Coast', description: 'Sun on the surf at Labadi.', tags: ['beach', 'sun'], style: 'dunes', hue: 45, n: 6, visibility: 'public' },
      { title: 'Portrait Sessions', description: 'Private sittings.', tags: ['portrait'], style: 'bokeh', hue: 25, n: 6, visibility: 'published' },
    ],
  },
  {
    username: 'sofia.moreau',
    name: 'Sofia Moreau',
    bio: 'Deep sea and deep space, as painted by light.',
    albums: [
      { title: 'Nebulae', description: 'Long exposures of the Carina and Orion regions.', tags: ['space', 'astro', 'night'], style: 'nebula', hue: 260, n: 8, visibility: 'public', hook: true },
      { title: 'Tide Pools', description: 'Macro work at low tide in Brittany.', tags: ['sea', 'macro'], style: 'ripple', hue: 190, n: 7, visibility: 'public' },
      { title: 'Darkroom', description: 'Prints in progress.', tags: ['film'], style: 'strata', hue: 280, n: 4, visibility: 'published' },
    ],
  },
  {
    username: 'omar.khalil',
    name: 'Omar Khalil',
    bio: 'Film photographer. Grain is a feature.',
    albums: [
      { title: 'Kodachrome Days', description: 'Scans from a box of slides found in my grandfather’s attic.', tags: ['film', 'archive', 'colour'], style: 'strata', hue: 35, n: 7, visibility: 'public', hook: true },
      { title: 'Harbour Fog', description: 'Alexandria before the fishermen leave.', tags: ['sea', 'fog', 'film'], style: 'dunes', hue: 195, n: 6, visibility: 'public' },
      { title: 'Contact Sheets', description: 'Everything, unedited.', tags: ['film'], style: 'geo', hue: 0, n: 6, visibility: 'published' },
    ],
  },
  {
    username: 'hanna.berg',
    name: 'Hanna Berg',
    bio: 'Forests, moss and slow mornings in Småland.',
    albums: [
      { title: 'Mossland', description: 'Green on green on green.', tags: ['forest', 'nature', 'green'], style: 'aurora', hue: 110, n: 8, visibility: 'public', hook: true },
      { title: 'Lake Stillness', description: 'Reflections at the summer house.', tags: ['lake', 'minimal'], style: 'ripple', hue: 170, n: 6, visibility: 'public' },
      { title: 'Foraging', description: 'Mushrooms and berries, season by season.', tags: ['nature'], style: 'bokeh', hue: 90, n: 5, visibility: 'public' },
    ],
  },
  {
    username: 'diego.santos',
    name: 'Diego Santos',
    bio: 'Skate, surf and the São Paulo sprawl.',
    albums: [
      { title: 'Concrete Waves', description: 'Skate parks at golden hour.', tags: ['skate', 'city', 'sun'], style: 'skyline', hue: 25, n: 7, visibility: 'public', hook: true },
      { title: 'Lineups', description: 'Dawn patrol in Florianópolis.', tags: ['surf', 'sea'], style: 'dunes', hue: 205, n: 6, visibility: 'public' },
      { title: 'Crew', description: 'Friends, members only.', tags: ['people'], style: 'geo', hue: 340, n: 5, visibility: 'published' },
    ],
  },
  {
    username: 'priya.nair',
    name: 'Priya Nair',
    bio: 'Monsoon light, temple towns and the colour of turmeric.',
    albums: [
      { title: 'Monsoon', description: 'Kerala in the rains. Everything glows.', tags: ['rain', 'india', 'colour'], style: 'aurora', hue: 45, n: 8, visibility: 'public', hook: true },
      { title: 'Temple Geometry', description: 'Gopurams and the pattern of devotion.', tags: ['architecture', 'india'], style: 'geo', hue: 350, n: 7, visibility: 'public' },
      { title: 'Spice Tones', description: 'Still life from the kitchen.', tags: ['still life'], style: 'strata', hue: 30, n: 5, visibility: 'public' },
    ],
  },
  {
    username: 'elias.vogt',
    name: 'Elias Vogt',
    bio: 'Alpine photography. Mostly cold, always early.',
    albums: [
      { title: 'Ridge Lines', description: 'The Bernese Oberland in winter silhouette.', tags: ['mountains', 'winter', 'minimal'], style: 'dunes', hue: 225, n: 8, visibility: 'public', hook: true },
      { title: 'Ice Studies', description: 'Macro textures from frozen lakes.', tags: ['ice', 'macro', 'abstract'], style: 'ripple', hue: 200, n: 6, visibility: 'public' },
      { title: 'Hut Life', description: 'Evenings at 2,800 metres.', tags: ['mountains'], style: 'bokeh', hue: 35, n: 5, visibility: 'published' },
    ],
  },
  {
    username: 'zara.okafor',
    name: 'Zara Okafor',
    bio: 'Generative art and motion design. Code is my camera.',
    albums: [
      { title: 'Signal Noise', description: 'Procedural fields rendered nightly.', tags: ['generative', 'abstract', 'code'], style: 'nebula', hue: 320, n: 9, visibility: 'public', hook: true },
      { title: 'Tessellate', description: 'Tilings that almost repeat.', tags: ['generative', 'geometry'], style: 'geo', hue: 180, n: 7, visibility: 'public' },
      { title: 'Orbitals', description: 'Rings within rings.', tags: ['generative', 'abstract'], style: 'ripple', hue: 290, n: 6, visibility: 'public' },
    ],
  },
]

const COMMENTS = [
  'This light is unreal.',
  'The third one is my favourite, what lens?',
  'Printing this one for the studio wall.',
  'Stunning series, the colours sing.',
  'That composition though.',
  'Saving this for inspiration.',
  'How long was the exposure here?',
  'Pure mood.',
  'Would love to see the full set.',
  'The textures in this are incredible.',
  'Best thing I have seen all week.',
  'Framing is perfect.',
  'Teach me your ways.',
  'This belongs in a book.',
  'Quiet and powerful.',
]

const TITLES = ['Untitled', 'Study', 'Frame', 'Passage', 'Field', 'Drift', 'Signal', 'Echo', 'Trace', 'Bloom', 'Vector', 'Still', 'Fold', 'Pulse', 'Veil', 'Shift']

/* ---------- deterministic PRNG ---------- */

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`

/* ---------- SVG artwork ---------- */

function grain(id: string) {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`
}

function artwork(style: Style, hue: number, seed: number): { svg: string; w: number; h: number } {
  const r = rng(seed)
  const ratio = r()
  const [w, h] = ratio < 0.55 ? [1600, 1067] : ratio < 0.8 ? [1067, 1600] : ratio < 0.9 ? [1400, 1400] : [1600, 900]
  const defs: string[] = [grain('grain')]
  const body: string[] = []
  const bg = (h1: number, h2: number, l1: number, l2: number, angle = 45) => {
    defs.push(`<linearGradient id="bg" gradientTransform="rotate(${angle})"><stop offset="0" stop-color="${hsl(h1, 55, l1)}"/><stop offset="1" stop-color="${hsl(h2, 60, l2)}"/></linearGradient>`)
    body.push(`<rect width="${w}" height="${h}" fill="url(#bg)"/>`)
  }
  switch (style) {
    case 'aurora': {
      bg(hue + 200, hue + 240, 8, 14, 90)
      defs.push(`<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${70 + r() * 60}"/></filter>`)
      const n = 4 + Math.floor(r() * 4)
      for (let i = 0; i < n; i++) {
        const cx = r() * w, cy = r() * h * 0.8, rx = w * (0.2 + r() * 0.35), ry = h * (0.08 + r() * 0.2)
        body.push(`<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${hsl(hue + (r() - 0.5) * 80, 85, 55 + r() * 15, 0.75)}" transform="rotate(${((r() - 0.5) * 40).toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})" filter="url(#blur)"/>`)
      }
      for (let i = 0; i < 60; i++) body.push(`<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(1 + r() * 2.2).toFixed(1)}" fill="#fff" opacity="${(0.3 + r() * 0.7).toFixed(2)}"/>`)
      body.push(`<rect width="${w}" height="${h}" fill="${hsl(hue + 220, 50, 6)}" opacity="0.35" y="${(h * 0.78).toFixed(0)}"/>`)
      break
    }
    case 'dunes': {
      bg(hue + 10, hue + 40, 70, 92, 90)
      const sunX = w * (0.2 + r() * 0.6), sunY = h * (0.2 + r() * 0.3)
      defs.push(`<radialGradient id="sun"><stop offset="0" stop-color="${hsl(hue + 20, 100, 92)}"/><stop offset="0.4" stop-color="${hsl(hue + 20, 100, 80, 0.9)}"/><stop offset="1" stop-color="${hsl(hue + 20, 100, 80, 0)}"/></radialGradient>`)
      body.push(`<circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(w * 0.22).toFixed(0)}" fill="url(#sun)"/>`)
      body.push(`<circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(w * 0.05).toFixed(0)}" fill="${hsl(hue + 25, 100, 94)}"/>`)
      const layers = 5 + Math.floor(r() * 3)
      for (let i = 0; i < layers; i++) {
        const base = h * (0.42 + (i / layers) * 0.58)
        const amp = h * (0.04 + r() * 0.08)
        let d = `M0 ${h} L0 ${(base + (r() - 0.5) * amp).toFixed(0)}`
        const segs = 3 + Math.floor(r() * 3)
        for (let s = 1; s <= segs; s++) {
          const x = (w / segs) * s
          const y = base + (r() - 0.5) * amp * 2
          const c1x = x - w / segs / 2, c1y = base + (r() - 0.5) * amp * 3
          d += ` S${c1x.toFixed(0)} ${c1y.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)}`
        }
        d += ` L${w} ${h} Z`
        body.push(`<path d="${d}" fill="${hsl(hue + i * 4, 45 + i * 4, 62 - i * 7)}"/>`)
      }
      break
    }
    case 'geo': {
      bg(hue, hue + 30, 92, 86, 30)
      const n = 9 + Math.floor(r() * 9)
      for (let i = 0; i < n; i++) {
        const kind = r()
        const x = r() * w, y = r() * h, s = Math.min(w, h) * (0.08 + r() * 0.3)
        const fill = hsl(hue + [0, 30, 180, 210, 330][Math.floor(r() * 5)], 60 + r() * 30, 35 + r() * 35, 0.55 + r() * 0.4)
        const rot = (r() * 90).toFixed(0)
        if (kind < 0.4) body.push(`<rect x="${(x - s / 2).toFixed(0)}" y="${(y - s / 2).toFixed(0)}" width="${s.toFixed(0)}" height="${(s * (0.4 + r())).toFixed(0)}" fill="${fill}" transform="rotate(${rot} ${x.toFixed(0)} ${y.toFixed(0)})" style="mix-blend-mode:multiply"/>`)
        else if (kind < 0.75) body.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(s / 2).toFixed(0)}" fill="${fill}" style="mix-blend-mode:multiply"/>`)
        else body.push(`<polygon points="${x.toFixed(0)},${(y - s / 2).toFixed(0)} ${(x + s / 2).toFixed(0)},${(y + s / 2).toFixed(0)} ${(x - s / 2).toFixed(0)},${(y + s / 2).toFixed(0)}" fill="${fill}" transform="rotate(${rot} ${x.toFixed(0)} ${y.toFixed(0)})" style="mix-blend-mode:multiply"/>`)
      }
      body.push(`<rect x="${(w * 0.06).toFixed(0)}" y="${(h * 0.06).toFixed(0)}" width="${(w * 0.88).toFixed(0)}" height="${(h * 0.88).toFixed(0)}" fill="none" stroke="${hsl(hue, 30, 20, 0.5)}" stroke-width="3"/>`)
      break
    }
    case 'nebula': {
      bg(hue + 180, hue + 220, 5, 9, 60)
      defs.push(`<filter id="neb" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${(0.0025 + r() * 0.004).toFixed(4)}" numOctaves="4" seed="${Math.floor(r() * 1000)}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 ${(0.3 + r() * 0.6).toFixed(2)}  0 0 0 0 ${(0.1 + r() * 0.4).toFixed(2)}  0 0 0 0 ${(0.5 + r() * 0.5).toFixed(2)}  0 0 0 1.6 -0.35"/></filter>`)
      defs.push(`<radialGradient id="glow"><stop offset="0" stop-color="${hsl(hue, 90, 75, 0.9)}"/><stop offset="0.5" stop-color="${hsl(hue + 40, 85, 55, 0.45)}"/><stop offset="1" stop-color="${hsl(hue + 60, 80, 40, 0)}"/></radialGradient>`)
      body.push(`<rect width="${w}" height="${h}" filter="url(#neb)" opacity="0.9"/>`)
      body.push(`<ellipse cx="${(w * (0.3 + r() * 0.4)).toFixed(0)}" cy="${(h * (0.3 + r() * 0.4)).toFixed(0)}" rx="${(w * 0.45).toFixed(0)}" ry="${(h * 0.35).toFixed(0)}" fill="url(#glow)" style="mix-blend-mode:screen"/>`)
      for (let i = 0; i < 160; i++) body.push(`<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(0.6 + r() * 2).toFixed(1)}" fill="#fff" opacity="${(0.25 + r() * 0.75).toFixed(2)}"/>`)
      break
    }
    case 'bokeh': {
      bg(hue + 180, hue + 210, 6, 12, 120)
      defs.push(`<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(6 + r() * 14).toFixed(0)}"/></filter>`)
      const n = 22 + Math.floor(r() * 24)
      for (let i = 0; i < n; i++) {
        const rad = Math.min(w, h) * (0.02 + r() * 0.09)
        body.push(`<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${rad.toFixed(0)}" fill="${hsl(hue + (r() - 0.5) * 90, 90, 55 + r() * 25, 0.35 + r() * 0.5)}" filter="url(#soft)" style="mix-blend-mode:screen"/>`)
      }
      body.push(`<rect width="${w}" height="${(h * 0.5).toFixed(0)}" y="${(h * 0.5).toFixed(0)}" fill="${hsl(hue + 200, 40, 4)}" opacity="0.25"/>`)
      break
    }
    case 'skyline': {
      bg(hue + 200, hue, 20, 65, 90)
      defs.push(`<radialGradient id="sun"><stop offset="0" stop-color="${hsl(hue + 10, 100, 85)}"/><stop offset="1" stop-color="${hsl(hue + 10, 100, 70, 0)}"/></radialGradient>`)
      body.push(`<circle cx="${(w * (0.25 + r() * 0.5)).toFixed(0)}" cy="${(h * 0.55).toFixed(0)}" r="${(w * 0.16).toFixed(0)}" fill="url(#sun)"/>`)
      const ground = h * 0.72
      let x = -20
      const dark = hsl(hue + 220, 35, 9)
      while (x < w) {
        const bw = 40 + r() * 140, bh = h * (0.12 + r() * 0.45)
        body.push(`<rect x="${x.toFixed(0)}" y="${(ground - bh).toFixed(0)}" width="${bw.toFixed(0)}" height="${(bh + h * 0.3).toFixed(0)}" fill="${dark}"/>`)
        const cols = Math.max(1, Math.floor(bw / 22)), rows = Math.max(1, Math.floor(bh / 28))
        for (let c = 0; c < cols; c++) for (let rw = 0; rw < rows; rw++) if (r() < 0.35) body.push(`<rect x="${(x + 6 + c * 22).toFixed(0)}" y="${(ground - bh + 8 + rw * 28).toFixed(0)}" width="9" height="12" fill="${hsl(hue + 20, 90, 70, 0.85)}"/>`)
        x += bw + 4 + r() * 20
      }
      body.push(`<rect width="${w}" height="${(h - ground).toFixed(0)}" y="${ground.toFixed(0)}" fill="${hsl(hue + 220, 35, 6)}"/>`)
      break
    }
    case 'ripple': {
      bg(hue, hue + 40, 14, 22, 135)
      const cx = w * (0.3 + r() * 0.4), cy = h * (0.3 + r() * 0.4)
      const rings = 18 + Math.floor(r() * 18)
      for (let i = 0; i < rings; i++) {
        const rad = (Math.max(w, h) * 0.75 * (i + 1)) / rings
        body.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="none" stroke="${hsl(hue + i * 6, 70, 55 + (i % 3) * 10, 0.75)}" stroke-width="${(2 + r() * 10).toFixed(1)}" opacity="${(1 - i / rings).toFixed(2)}"/>`)
      }
      defs.push(`<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>`)
      body.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(Math.min(w, h) * 0.12).toFixed(0)}" fill="${hsl(hue + 30, 90, 80)}" filter="url(#soft)"/>`)
      break
    }
    case 'strata': {
      bg(hue, hue + 20, 85, 75, 0)
      const bands = 7 + Math.floor(r() * 9)
      let y = 0
      for (let i = 0; i < bands; i++) {
        const bh = (h / bands) * (0.5 + r())
        const d = `M0 ${y.toFixed(0)} C${(w * 0.3).toFixed(0)} ${(y + (r() - 0.5) * 120).toFixed(0)} ${(w * 0.7).toFixed(0)} ${(y + (r() - 0.5) * 120).toFixed(0)} ${w} ${(y + (r() - 0.5) * 60).toFixed(0)} L${w} ${h} L0 ${h} Z`
        body.push(`<path d="${d}" fill="${hsl(hue + i * 5 + (r() - 0.5) * 20, 50 + r() * 30, 78 - i * (55 / bands))}"/>`)
        y += bh
      }
      break
    }
  }
  body.push(`<rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.07" style="mix-blend-mode:overlay"/>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs.join('')}</defs>${body.join('')}</svg>`
  return { svg, w, h }
}

/* ---------- seeding ---------- */

const DAY = 86_400_000

function uniqueAlbumSlug(base: string): string {
  const root = slugify(base)
  let slug = root
  let n = 2
  while (db.prepare('SELECT id FROM albums WHERE slug = ?').get(slug)) slug = `${root}-${n++}`
  return slug
}

export function seedDemoCommunity(): void {
  if (getSetting<boolean>('demoSeeded', false)) return
  const t0 = now()
  const r = rng(20261014)
  mkdirSync(path.join(MEDIA_DIR, 'demo'), { recursive: true })
  const userIds: number[] = []
  const mediaIds: number[] = []
  const albumIds: number[] = []

  const insUser = db.prepare("INSERT INTO users(username, display_name, role, password_hash, salt, bio, created_at, status) VALUES (?, ?, 'admin', ?, ?, ?, ?, 'active')")
  const insAlbum = db.prepare('INSERT INTO albums(slug, title, description, visibility, tags, sort_order, featured, views, created_at, updated_at, gallery_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const insMedia = db.prepare("INSERT INTO media(album_id, kind, title, description, mime, file_path, width, height, size, sort_order, views, created_at) VALUES (?, 'image', ?, '', 'image/svg+xml', ?, ?, ?, ?, ?, ?, ?)")

  PEOPLE.forEach((p, pi) => {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(p.username)) return
    const salt = newSalt()
    const joined = t0 - (120 - pi * 7) * DAY - Math.floor(r() * DAY)
    const info = insUser.run(p.username, p.name, hashPassword(randomBytes(18).toString('base64url'), salt), salt, p.bio, joined)
    const uid = info.lastInsertRowid as number
    userIds.push(uid)
    const g = ensureGalleryFor(uid, p.name)
    db.prepare('UPDATE galleries SET title = ?, tagline = ?, created_at = ?, updated_at = ? WHERE id = ?').run(p.name, p.bio, joined, joined, g.id)
    let splash: number | null = null
    let hook: number | null = null
    let latest = joined
    p.albums.forEach((a, ai) => {
      // Spread albums between the person joining and yesterday, so the feed shows real ages.
      const span = Math.max(DAY, t0 - DAY - joined)
      const created = joined + Math.floor(r() * span)
      const updated = Math.min(t0 - 3_600_000, created + Math.floor(r() * 10 * DAY))
      latest = Math.max(latest, updated)
      const slug = uniqueAlbumSlug(a.title)
      const ar = insAlbum.run(slug, a.title, a.description, a.visibility, JSON.stringify(a.tags), ai + 1, a.hook ? 1 : 0, 40 + Math.floor(r() * 900), created, updated, g.id)
      const aid = ar.lastInsertRowid as number
      albumIds.push(aid)
      for (let i = 0; i < a.n; i++) {
        const seed = pi * 1000 + ai * 100 + i
        const art = artwork(a.style, a.hue + (r() - 0.5) * 30, seed)
        const rel = path.posix.join('demo', `${slug}-${i + 1}.svg`)
        writeFileSync(path.join(MEDIA_DIR, rel), art.svg)
        const title = `${TITLES[Math.floor(r() * TITLES.length)]} ${String(i + 1).padStart(2, '0')}`
        const mr = insMedia.run(aid, title, rel, art.w, art.h, Buffer.byteLength(art.svg), i + 1, 10 + Math.floor(r() * 400), created + i * 60_000)
        const mid = mr.lastInsertRowid as number
        mediaIds.push(mid)
        if (a.hook && splash == null && art.w >= art.h) splash = mid
      }
      if (a.hook) hook = aid
    })
    db.prepare('UPDATE galleries SET splash_media_id = ?, public_album_id = ?, updated_at = ? WHERE id = ?').run(splash, hook, latest, g.id)
  })

  // Likes and comments between the demo people, so counts look alive.
  const insLike = db.prepare('INSERT OR IGNORE INTO likes(user_id, media_id, created_at) VALUES (?, ?, ?)')
  const insComment = db.prepare('INSERT INTO comments(user_id, media_id, album_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
  if (userIds.length) {
    for (const mid of mediaIds) {
      const likers = Math.floor(r() * r() * userIds.length)
      for (let i = 0; i < likers; i++) insLike.run(userIds[Math.floor(r() * userIds.length)], mid, t0 - Math.floor(r() * 60 * DAY))
      if (r() < 0.12) insComment.run(userIds[Math.floor(r() * userIds.length)], mid, null, COMMENTS[Math.floor(r() * COMMENTS.length)], t0 - Math.floor(r() * 60 * DAY))
    }
    for (const aid of albumIds) {
      const n = Math.floor(r() * 4)
      for (let i = 0; i < n; i++) insComment.run(userIds[Math.floor(r() * userIds.length)], null, aid, COMMENTS[Math.floor(r() * COMMENTS.length)], t0 - Math.floor(r() * 60 * DAY))
    }
  }
  setSetting('demoSeeded', true)
}
