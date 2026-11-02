import type { CSSProperties } from 'react'

// The UI's highlight colour (Settings > Display), one of the S660's own paint colours, chart order.
// Carnival Yellow 2 is the default. The highlight is always a solid block on a black screen, so each
// colour also sets the text on it (black or white, whichever contrasts more) and an edge: colours too
// dark to see against the black ground get a white edge, so the knob's position never disappears.
export const ACCENTS = [
  { id: 'admiralGray', name: 'Admiral Gray Metallic', hex: '#4f4f4f' },
  { id: 'carnivalYellow2', name: 'Carnival Yellow 2', hex: '#ffd400' },
  { id: 'flameRed', name: 'Flame Red', hex: '#e62e1f' },
  { id: 'starWhite', name: 'Premium Star White Pearl', hex: '#ffffff' },
  { id: 'mysticNight', name: 'Premium Mystic Night Pearl', hex: '#3f2460' },
  { id: 'beachBlue', name: 'Premium Beach Blue Pearl', hex: '#32a4eb' },
  { id: 'velvetMaroon', name: 'Velvet Maroon Metallic', hex: '#723918' },
  { id: 'hidaIvory', name: 'Hida Maria Ivory Pearl', hex: '#fef1ca' },
  { id: 'nightHawkBlack', name: 'Night Hawk Black Pearl', hex: '#000000' },
  { id: 'britishGreen', name: 'British Green Pearl', hex: '#364a25' },
  { id: 'frenchBlue', name: 'French Blue Pearl', hex: '#1b66b3' },
  { id: 'alabasterSilver', name: 'Alabaster Silver Metallic', hex: '#d4d4d4' },
  { id: 'activeGreen', name: 'Active Green Pearl', hex: '#94c857' },
  { id: 'sonicGray', name: 'Sonic Gray Pearl', hex: '#d5ddef' },
] as const

export type AccentId = (typeof ACCENTS)[number]['id']
export const DEFAULT_ACCENT: AccentId = 'carnivalYellow2'
export const ACCENT_IDS = ACCENTS.map(a => a.id) as AccentId[]
export const accentOf = (id: string) => ACCENTS.find(a => a.id === id) ?? ACCENTS.find(a => a.id === DEFAULT_ACCENT)!

// WCAG relative luminance and contrast ratio.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
// Below this contrast with the black screen, a highlight block gets a white edge.
export const EDGE_BELOW = 3

export const accentColours = (id: string) => {
  const { hex } = accentOf(id)
  const ink = contrast(hex, '#000000') >= contrast(hex, '#ffffff') ? '#000000' : '#ffffff'
  const edge = contrast(hex, '#000000') < EDGE_BELOW ? '#ffffff' : hex
  return { focus: hex, ink, edge }
}

// The CSS variables native.css reads (--focus, --focus-ink, --focus-edge), for the .nui-root style.
export const accentStyle = (id: string) => {
  const c = accentColours(id)
  return { '--focus': c.focus, '--focus-ink': c.ink, '--focus-edge': c.edge } as CSSProperties
}
