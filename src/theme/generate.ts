import type { Palette, ThemeDraft } from '../api/types'
import { hslToHex, readableOn, type HSL } from './color'

export const FONT_CHOICES = {
  display: ['Outfit', 'Sora', 'Playfair Display', 'Cormorant Garamond', 'Space Grotesk', 'DM Sans'],
  body: ['IBM Plex Sans', 'Inter', 'DM Sans', 'Space Grotesk'],
} as const

type Harmony = 'complementary' | 'analogous' | 'triadic' | 'split' | 'monochrome'

const ADJECTIVES = ['Velvet', 'Quiet', 'Golden', 'Nocturne', 'Ember', 'Glacier', 'Moss', 'Slate', 'Coral', 'Opal', 'Ivory', 'Indigo', 'Saffron', 'Dusk', 'Aurora']
const NOUNS = ['Studio', 'Archive', 'Atelier', 'Gallery', 'Salon', 'Horizon', 'Lumen', 'Canvas', 'Loft', 'Frame', 'Exhibit', 'Palette']

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function accentHue(base: number, harmony: Harmony): number {
  switch (harmony) {
    case 'complementary':
      return (base + 180) % 360
    case 'analogous':
      return (base + pick([30, -30, 40, -40]) + 360) % 360
    case 'triadic':
      return (base + pick([120, 240])) % 360
    case 'split':
      return (base + pick([150, 210])) % 360
    case 'monochrome':
      return base
  }
}

/** Build a full light + dark palette pair from a primary + accent HSL and a neutral tint hue. */
export function buildPalettes(primary: HSL, accent: HSL, neutralHue: number, neutralSat: number): { light: Palette; dark: Palette } {
  const n = (l: number, s = neutralSat) => hslToHex({ h: neutralHue, s, l })
  const p = hslToHex(primary)
  const a = hslToHex(accent)
  const pDark = hslToHex({ ...primary, l: Math.min(72, primary.l + 14), s: Math.min(100, primary.s + 6) })
  const aDark = hslToHex({ ...accent, l: Math.min(74, accent.l + 12) })

  const light: Palette = {
    bg: n(97),
    bgElevated: n(100, Math.max(0, neutralSat - 4)),
    surface: n(100, Math.max(0, neutralSat - 4)),
    surfaceHover: n(94),
    border: n(88),
    text: n(12),
    textMuted: n(42),
    primary: p,
    primaryText: readableOn(p),
    accent: a,
    accentText: readableOn(a),
    danger: '#d2423b',
    success: '#2f9e6a',
  }
  const dark: Palette = {
    bg: n(7),
    bgElevated: n(10),
    surface: n(12),
    surfaceHover: n(16),
    border: n(20),
    text: n(95),
    textMuted: n(64),
    primary: pDark,
    primaryText: readableOn(pDark),
    accent: aDark,
    accentText: readableOn(aDark),
    danger: '#ef6b63',
    success: '#4cc98c',
  }
  return { light, dark }
}

/** Randomly generate a tasteful, harmonious theme. */
export function rollTheme(): ThemeDraft {
  const harmony = pick<Harmony>(['complementary', 'analogous', 'triadic', 'split', 'monochrome'])
  const baseHue = Math.floor(rand(0, 360))
  const primary: HSL = { h: baseHue, s: Math.round(rand(45, 80)), l: Math.round(rand(38, 52)) }
  const accent: HSL =
    harmony === 'monochrome'
      ? { h: baseHue, s: Math.round(rand(20, 40)), l: Math.round(rand(55, 68)) }
      : { h: accentHue(baseHue, harmony), s: Math.round(rand(50, 85)), l: Math.round(rand(45, 58)) }
  const neutralSat = Math.round(rand(2, 14))
  const neutralHue = Math.random() < 0.6 ? baseHue : accent.h
  const { light, dark } = buildPalettes(primary, accent, neutralHue, neutralSat)
  return {
    name: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
    light,
    dark,
    fontDisplay: pick(FONT_CHOICES.display),
    fontBody: pick(FONT_CHOICES.body),
    radius: pick([0, 4, 8, 12, 16, 24]),
    scale: pick([0.9, 1, 1, 1.05]),
  }
}

export const AMBERX_FALLBACK: ThemeDraft = {
  name: 'AmberX Studio',
  light: {
    bg: '#f6f1e8', bgElevated: '#fffdf9', surface: '#fffdf9', surfaceHover: '#efe8db', border: '#dcd2c1',
    text: '#1d1a16', textMuted: '#77695a', primary: '#c8590f', primaryText: '#ffffff', accent: '#b57414', accentText: '#ffffff',
    danger: '#c0392b', success: '#2f8f66',
  },
  dark: {
    bg: '#131110', bgElevated: '#1c1916', surface: '#1c1916', surfaceHover: '#252119', border: '#342e26',
    text: '#f5efe6', textMuted: '#9b8f81', primary: '#ff8a2a', primaryText: '#1a120a', accent: '#f5b342', accentText: '#1a120a',
    danger: '#ff5c5c', success: '#3fb27f',
  },
  fontDisplay: 'Outfit',
  fontBody: 'IBM Plex Sans',
  radius: 14,
  scale: 1,
}
