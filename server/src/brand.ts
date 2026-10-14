/** AmberX brand palettes, ported from the AmberX framework's theme definitions. */

export interface Palette {
  bg: string
  bgElevated: string
  surface: string
  surfaceHover: string
  border: string
  text: string
  textMuted: string
  primary: string
  primaryText: string
  accent: string
  accentText: string
  danger: string
  success: string
}

export interface ThemeSeed {
  name: string
  light: Palette
  dark: Palette
  fontDisplay: string
  fontBody: string
  radius: number
  scale: number
}

export const AMBER = '#c8590f'
export const AMBER_GOLD = '#ff8a2a'

/** Studio light: parchment surfaces, ink text, burnt-orange accent. */
const amberLight: Palette = {
  bg: '#f6f1e8',
  bgElevated: '#fffdf9',
  surface: '#fffdf9',
  surfaceHover: '#efe8db',
  border: '#dcd2c1',
  text: '#1d1a16',
  textMuted: '#77695a',
  primary: '#c8590f',
  primaryText: '#ffffff',
  accent: '#b57414',
  accentText: '#ffffff',
  danger: '#c0392b',
  success: '#2f8f66',
}

/** Studio dark: umber surfaces, cream text, glowing orange accent. */
const amberDark: Palette = {
  bg: '#131110',
  bgElevated: '#1c1916',
  surface: '#1c1916',
  surfaceHover: '#252119',
  border: '#342e26',
  text: '#f5efe6',
  textMuted: '#9b8f81',
  primary: '#ff8a2a',
  primaryText: '#1a120a',
  accent: '#f5b342',
  accentText: '#1a120a',
  danger: '#ff5c5c',
  success: '#3fb27f',
}

export const BRAND_THEMES: ThemeSeed[] = [
  {
    name: 'AmberX Studio',
    light: amberLight,
    dark: amberDark,
    fontDisplay: 'Outfit',
    fontBody: 'IBM Plex Sans',
    radius: 14,
    scale: 1,
  },
  {
    name: 'Amber Landing',
    light: { ...amberLight, primary: '#ff7a1a', accent: '#4f8ef7' },
    dark: { ...amberDark, bg: '#0f0d0b', bgElevated: '#1a1713', surface: '#1a1713', surfaceHover: '#241f19', border: '#2a2621', text: '#f7f2ea', textMuted: '#9c9083', primary: '#ff7a1a', primaryText: '#ffffff', accent: '#4f8ef7', accentText: '#ffffff', danger: '#e5484d' },
    fontDisplay: 'Outfit',
    fontBody: 'IBM Plex Sans',
    radius: 6,
    scale: 1,
  },
  {
    name: 'Amber Editorial',
    light: { ...amberLight, bg: '#f3f4f6', bgElevated: '#ffffff', surface: '#ffffff', surfaceHover: '#eef0f3', border: '#e3e6eb', text: '#1f2329', textMuted: '#6b7280', primary: '#e8821e', accent: '#d9760f' },
    dark: { ...amberDark, bg: '#14100b', bgElevated: '#1c160d', surface: '#1f1810', surfaceHover: '#2a2114', border: '#352a18', text: '#f0e8da', textMuted: '#a89878', primary: '#f0b54a', accent: '#d99524' },
    fontDisplay: 'Playfair Display',
    fontBody: 'Inter',
    radius: 18,
    scale: 1,
  },
]

export const DEFAULT_LAYOUT = {
  kind: 'masonry',
  columns: 3,
  gap: 16,
  caption: 'hover',
  shape: 'natural',
  rounded: true,
  hoverZoom: true,
  showLikes: true,
  heroCover: true,
}

export const DEFAULT_SETTINGS = {
  siteTitle: 'xGallery',
  tagline: 'Curated visual stories by AmberX',
  brandName: 'AmberX',
  activeThemeId: null as number | null,
  defaultLayout: DEFAULT_LAYOUT,
  allowComments: true,
  allowLikes: true,
  allowDownloads: true,
  heroAlbumId: null as number | null,
}
