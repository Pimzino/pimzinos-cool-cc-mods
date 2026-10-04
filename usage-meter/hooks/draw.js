// Drawing helpers shared by the band and the side panes: the typeface, colors, icons
// and the pieces an SVG is put together from.

// What text falls back to when the Desktop app's typeface was not found
const FALLBACK_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"

export const WEIGHT_NORMAL = 400
export const WEIGHT_STRONG = 600

// The parsed typeface, or null while it has not been found
let font = null
export const setFont = (parsed) => {
  font = parsed
}

// One icon per meter: the name shown for it, the glyph the terminal shows, and the icon's
// strokes on a 16 by 16 grid for the Desktop app
export const ICONS = {
  five_hour: {
    name: '5-hour limit',
    glyph: '◷',
    paths: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/>',
  },
  seven_day: {
    name: 'Weekly limit',
    glyph: '▦',
    paths: '<rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2"/><path d="M2.25 6.75h11.5M5.5 1.75v3M10.5 1.75v3"/>',
  },
  spend_limit: {
    name: 'Spend limit',
    glyph: '◎',
    paths:
      '<circle cx="8" cy="8" r="6.25"/>' +
      '<path d="M9.9 6.4c-.3-.6-1-.95-1.9-.95-1.1 0-1.9.5-1.9 1.3 0 1.8 3.8.7 3.8 2.6 0 .8-.8 1.3-1.9 1.3-.9 0-1.6-.35-1.9-.95M8 4.25v7.5"/>',
  },
  context: {
    name: 'Context window',
    glyph: '◧',
    paths: '<path d="M8 2.25 2 5.5l6 3.25 6-3.25zM2 8l6 3.25L14 8M2 10.5l6 3.25 6-3.25"/>',
  },
  cache: {
    name: 'Prompt cache',
    glyph: '◍',
    paths: '<ellipse cx="8" cy="4.25" rx="5.25" ry="2"/><path d="M2.75 4.25v7.5c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2v-7.5M2.75 8c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2"/>',
  },
  cost: {
    name: 'Session cost',
    glyph: '$',
    paths: '<path d="M3.75 1.75h8.5v12.5l-2.1-1.3-2.15 1.3-2.15-1.3-2.1 1.3zM6.25 5.5h3.5M6.25 8.5h3.5"/>',
  },
  repo: {
    name: 'Repository',
    glyph: '▣',
    paths: '<path d="M3.25 2.25h9.5v11.5h-9.5zM3.25 10.75h9.5M6 2.25v8.5"/>',
  },
  branch: {
    name: 'Branch',
    glyph: '⎇',
    paths: '<circle cx="5" cy="3.75" r="1.75"/><circle cx="5" cy="12.25" r="1.75"/><circle cx="11.25" cy="5.75" r="1.75"/><path d="M5 5.5v5M11.25 7.5c0 2.2-2.4 2.6-4.6 2.9"/>',
  },
  folder: {
    name: 'Folder',
    glyph: '▸',
    paths: '<path d="M1.75 4.25c0-.8.7-1.5 1.5-1.5h3l1.5 1.75h5c.8 0 1.5.7 1.5 1.5v5.75c0 .8-.7 1.5-1.5 1.5h-9.5c-.8 0-1.5-.7-1.5-1.5z"/>',
  },
  session: {
    name: 'Session',
    glyph: '›',
    paths: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M4.75 6.25 6.75 8l-2 1.75M8.5 10h2.75"/>',
  },
}

// For a limit kind this mod has no icon for
const OTHER_ICON = { glyph: '◔', paths: '<circle cx="8" cy="8" r="6.25"/><path d="M8 8V1.75M8 8l4.4 4.4"/>' }

export const iconFor = (key) => ICONS[key] ?? { ...OTHER_ICON, name: key.replaceAll('_', ' ') }

// Drawn before a detail, on a 10 by 10 grid: a circular arrow before a reset time,
// a warning triangle before a warning
const DETAIL_ICONS = {
  reset: '<path d="M8.4 5a3.4 3.4 0 1 1-1-2.4M8.5 1.4v2.2H6.3"/>',
  alert: '<path d="M5 1.5 9.2 8.6H.8zM5 4.2v2.1M5 7.5v.1"/>',
  // Arrows for the prompt cache: down for what was read out of it, up for what was written in
  down: '<path d="M5 1.25v7.25M2 5.75 5 8.75l3-3"/>',
  up: '<path d="M5 8.75V1.5M2 4.25 5 1.25l3 3"/>',
}

export const ALERT_HEX = '#e5534b'
export const ACCENT_HEX = '#d97757'
export const ADDED_HEX = '#4caf7d'
export const WRITTEN_HEX = '#e0a23c'

// Bar colors by how full a meter is. Mid-tones, so they read on light and dark themes.
const COLORS = [
  { from: 90, hex: ALERT_HEX, name: 'red' },
  { from: 70, hex: '#e0a23c', name: 'yellow' },
  { from: 0, hex: '#4caf7d', name: 'green' },
]

export const colorFor = (percent) => COLORS.find((c) => percent >= c.from)
export const clamp = (percent) => Math.max(0, Math.min(100, percent))
export const escapeXml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// Text and icon colors. The fill attributes are mid-tones that read on either theme, and
// these rules sharpen them for the theme in use. The first rule says the drawing suits both
// themes: without it the frame it is drawn in gets a white backdrop on a dark theme.
const STYLE =
  '<style>' +
  ':root{color-scheme:light dark}' +
  '.strong{fill:#3d3d3a}.dim{fill:#73726c}.icon{stroke:#73726c}.card{fill:#3d3d3a;fill-opacity:.05}.track{fill:#3d3d3a;fill-opacity:.12}' +
  '@media (prefers-color-scheme:dark){.strong{fill:#e8e6dc}.dim{fill:#9c9a92}.icon{stroke:#9c9a92}.card{fill:#e8e6dc;fill-opacity:.06}.track{fill:#e8e6dc;fill-opacity:.14}}' +
  '</style>'

const STROKES = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'

// The outlines the drawing in progress has used, each kept once and stamped wherever its
// character appears, which keeps a drawing with a lot of text small. svg() writes them out.
let outlines = new Map()

// A piece of text: outlines in the app's typeface when it was found, otherwise ordinary text
// in the system font with its width estimated. `anchor` places x at its start, middle or end.
export function text(string, x, y, { size = 12, weight = WEIGHT_NORMAL, tone = 'strong', color, anchor = 'start' } = {}) {
  // A color of its own, or the theme's through the class
  const paint = color ? `fill="${color}"` : `class="${tone}" fill="#8a8880"`
  const glyphs = font ? [...string].map((char) => font.glyph(char, weight)) : [null]
  if (glyphs.every(Boolean)) {
    const scale = size / font.unitsPerEm
    const width = glyphs.reduce((sum, g) => sum + g.advance, 0) * scale
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
    let stamps = ''
    let cursor = 0
    for (const g of glyphs) {
      const key = g.id + '-' + weight
      if (!outlines.has(key)) outlines.set(key, { name: 'g' + outlines.size, d: g.d })
      stamps += `<use href="#${outlines.get(key).name}" x="${Math.round(cursor)}"/>`
      cursor += g.advance
    }
    return { markup: `<g ${paint} transform="translate(${+left.toFixed(2)} ${y}) scale(${+scale.toFixed(5)})">${stamps}</g>`, width }
  }
  return {
    markup: `<text ${paint} x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FALLBACK_FONT}" font-size="${size}" font-weight="${weight}">${escapeXml(string)}</text>`,
    width: string.length * size * (weight > WEIGHT_NORMAL ? 0.62 : 0.58),
  }
}

// A meter's icon, 16 pixels square with its corner at x, y
export const icon = (key, x, y) =>
  `<g class="icon" stroke="#8a8880" ${STROKES} stroke-width="1.4" transform="translate(${+x.toFixed(2)} ${+y.toFixed(2)})">${iconFor(key).paths}</g>`

// A detail's icon, 10 pixels square
export const detailIcon = (kind, x, y, hex) => {
  const paint = hex ? `stroke="${hex}"` : kind === 'alert' ? `stroke="${ALERT_HEX}"` : 'class="icon" stroke="#8a8880"'
  return `<g ${paint} ${STROKES} stroke-width="${kind === 'up' || kind === 'down' ? 1.5 : 1.1}" transform="translate(${+x.toFixed(2)} ${+y.toFixed(2)})">${DETAIL_ICONS[kind]}</g>`
}

// A rounded bar: the track, then the filled part in `hex`
export function bar(x, y, width, height, percent, hex) {
  const filled = Math.max(percent > 0 ? height : 0, (clamp(percent) / 100) * width)
  return (
    `<rect class="track" x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#888888" fill-opacity="0.3"/>` +
    `<rect x="${x}" y="${y}" width="${+filled.toFixed(2)}" height="${height}" rx="${height / 2}" fill="${hex}"/>`
  )
}

export const rect = (x, y, width, height, radius, tone = 'card') =>
  `<rect class="${tone}" x="${+x.toFixed(2)}" y="${+y.toFixed(2)}" width="${+Math.max(0, width).toFixed(2)}" height="${+Math.max(0, height).toFixed(2)}" rx="${radius}" fill="#888888" fill-opacity="0.1"/>`

// A whole SVG document. With a tooltip, hovering anywhere on it shows that text: the title
// sits in a group, since one directly under the root names the document instead, and an
// unseen sheet makes the gaps between the parts count as part of the group.
export function svg(width, height, body, tooltip) {
  const inner = tooltip
    ? `<g><title>${escapeXml(tooltip)}</title><rect width="${width}" height="${height}" fill="#000000" fill-opacity="0"/>${body}</g>`
    : body
  const defs = outlines.size ? `<defs>${[...outlines.values()].map((o) => `<path id="${o.name}" d="${o.d}"/>`).join('')}</defs>` : ''
  outlines = new Map()
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}${defs}${inner}</svg>`,
    width,
    height,
  }
}
