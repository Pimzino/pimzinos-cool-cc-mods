// Where the meters are drawn. 'AbovePrompt' is the band directly above the prompt box,
// the site the Desktop app is known to draw. 'PromptHint' is the line under it.
const SITE = 'AbovePrompt'

// How often to refresh the figures and the reset countdowns, in milliseconds
const REFRESH_MS = 60_000

// A plan limit that reaches this percent gets a one-off notice
const WARN_AT = 90

// How much of each meter is drawn, from roomiest to tightest: the bar's width in pixels
// (0 for no bar) and whether the reset time shows. The band uses the first that fits its width.
const LAYOUTS = [
  { bar: 56, hasReset: true },
  { bar: 28, hasReset: true },
  { bar: 28, hasReset: false },
  { bar: 0, hasReset: false },
]

// The Desktop app reports the band's width in character cells of about this many pixels,
// and draws one cell of gap as this many
const CELL_PX = 8

// Cells between two meters
const GAP = 3

// One icon per meter, in place of a text label: the name read out for it,
// the glyph the terminal shows, and the icon's strokes on a 16 by 16 grid for the Desktop app
const ICONS = {
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
  cost: {
    name: 'Session cost',
    glyph: '$',
    paths: '<path d="M3.75 1.75h8.5v12.5l-2.1-1.3-2.15 1.3-2.15-1.3-2.1 1.3zM6.25 5.5h3.5M6.25 8.5h3.5"/>',
  },
}

// For a limit kind this mod has no icon for
const OTHER_ICON = { glyph: '◔', paths: '<circle cx="8" cy="8" r="6.25"/><path d="M8 8V1.75M8 8l4.4 4.4"/>' }

const iconFor = (key) => ICONS[key] ?? { ...OTHER_ICON, name: key.replaceAll('_', ' ') }

// Where the Desktop app keeps its own typeface, Anthropic Sans. The mod reads the file from
// the app installed on this computer and draws the figures with its letter shapes, so the
// font is neither shipped with the mod nor installed.
const FONT_FOLDERS = ['/Applications/Claude.app/Contents/Resources/fonts']
const FONT_FILE = /^AnthropicSans-Romans?-.*\.ttf$/

// What the figures fall back to when that file is not there
const FALLBACK_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"

// Font weights for the reset time and for the figure
const WEIGHT_NORMAL = 400
const WEIGHT_STRONG = 600

// The parsed typeface, or null while it has not been found
let font = null

// A small circular arrow drawn before a reset time, on a 10 by 10 grid
const RESET_ICON = '<path d="M8.4 5a3.4 3.4 0 1 1-1-2.4M8.5 1.4v2.2H6.3"/>'

// Text and icon colors in a drawn meter. The fill attributes are mid-tones that read on
// either theme, and these rules sharpen them for the theme in use.
const SVG_STYLE =
  '<style>' +
  '.strong{fill:#3d3d3a}.dim{fill:#73726c}.icon{stroke:#73726c}' +
  '@media (prefers-color-scheme:dark){.strong{fill:#e8e6dc}.dim{fill:#9c9a92}.icon{stroke:#9c9a92}}' +
  '</style>'

// Bar colors by how full a meter is. Mid-tones, so they read on light and dark themes.
const COLORS = [
  { from: 90, hex: '#e5534b', name: 'red' },
  { from: 70, hex: '#e0a23c', name: 'yellow' },
  { from: 0, hex: '#4caf7d', name: 'green' },
]

// The latest figures from $.session.usage(), shared by the hooks below
let usage = null

// The Claude Code version this session runs on, shown in the hint line under the prompt
let version = ''

// Each plan limit's percent used at the last reading, to notice one crossing WARN_AT
const lastPercent = new Map()

const colorFor = (percent) => COLORS.find((c) => percent >= c.from)
const clamp = (percent) => Math.max(0, Math.min(100, percent))

// "2h 14m" for a reset later today, "Thu 09:00" for one further out
function formatReset(resetsAt, now) {
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  const minutes = Math.round((at - now) / 60_000)
  if (minutes <= 0) return 'now'
  if (minutes < 60) return minutes + 'm'
  if (minutes < 24 * 60) return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
  const date = new Date(at)
  const day = date.toLocaleDateString(undefined, { weekday: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return day + ' ' + time
}

// "Friday 9 Oct, 17:28", for the notice and the tooltip
function formatResetLong(resetsAt) {
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return day + ', ' + time
}

const escapeXml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// Reads a TrueType variable font: enough of it to turn a line of text into outlines at a
// chosen weight. Returns null for a file it cannot use.
function parseFont(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u8 = (o) => view.getUint8(o)
  const i8 = (o) => view.getInt8(o)
  const u16 = (o) => view.getUint16(o)
  const i16 = (o) => view.getInt16(o)
  const u32 = (o) => view.getUint32(o)

  const tables = {}
  for (let i = 0; i < u16(4); i++) {
    const record = 12 + i * 16
    tables[String.fromCharCode(u8(record), u8(record + 1), u8(record + 2), u8(record + 3))] = u32(record + 8)
  }
  const { head, maxp, hhea, hmtx, loca, glyf, cmap, fvar, gvar } = tables
  if ([head, maxp, hhea, hmtx, loca, glyf, cmap].includes(undefined)) return null

  const unitsPerEm = u16(head + 18)
  const hasLongOffsets = i16(head + 50) === 1
  const glyphCount = u16(maxp + 4)
  const metricCount = u16(hhea + 34)

  // The table that maps characters to glyphs, in the segment format every font carries
  let segments = null
  for (let i = 0; i < u16(cmap + 2); i++) {
    const subtable = cmap + u32(cmap + 4 + i * 8 + 4)
    if (u16(subtable) === 4) segments = subtable
  }
  if (segments === null) return null
  const segmentCount = u16(segments + 6) / 2

  function glyphFor(code) {
    const ends = segments + 14
    const starts = ends + segmentCount * 2 + 2
    const deltas = starts + segmentCount * 2
    const offsets = deltas + segmentCount * 2
    for (let i = 0; i < segmentCount; i++) {
      if (code > u16(ends + i * 2)) continue
      const start = u16(starts + i * 2)
      if (code < start) return 0
      const offset = u16(offsets + i * 2)
      if (offset === 0) return (code + u16(deltas + i * 2)) & 0xffff
      const id = u16(offsets + i * 2 + offset + (code - start) * 2)
      return id === 0 ? 0 : (id + u16(deltas + i * 2)) & 0xffff
    }
    return 0
  }

  const glyphOffset = (id) => glyf + (hasLongOffsets ? u32(loca + id * 4) : u16(loca + id * 2) * 2)
  const advanceOf = (id) => u16(hmtx + Math.min(id, metricCount - 1) * 4)

  // A glyph's points as the font stores them, for its default weight.
  // Null for a glyph assembled from other glyphs, which this reader does not draw.
  function outline(id) {
    const start = glyphOffset(id)
    const xs = []
    const ys = []
    const isOnCurve = []
    const ends = []
    if (glyphOffset(id + 1) > start) {
      const contourCount = i16(start)
      if (contourCount < 0) return null
      let at = start + 10
      for (let i = 0; i < contourCount; i++, at += 2) ends.push(u16(at))
      const pointCount = contourCount ? ends[contourCount - 1] + 1 : 0
      at += 2 + u16(at)
      const flags = []
      while (flags.length < pointCount) {
        const flag = u8(at++)
        flags.push(flag)
        if (flag & 8) for (let repeat = u8(at++); repeat > 0; repeat--) flags.push(flag)
      }
      // Each coordinate is a step from the one before, stored in one or two bytes
      const readAxis = (isShort, isSameOrPositive, into) => {
        let value = 0
        for (const flag of flags) {
          if (flag & isShort) value += flag & isSameOrPositive ? u8(at++) : -u8(at++)
          else if (!(flag & isSameOrPositive)) {
            value += i16(at)
            at += 2
          }
          into.push(value)
        }
      }
      readAxis(2, 16, xs)
      readAxis(4, 32, ys)
      for (const flag of flags) isOnCurve.push((flag & 1) === 1)
    }
    return { xs, ys, isOnCurve, ends, advance: advanceOf(id) }
  }

  // The weight axis: where it starts, and how far it runs
  let weightAxis = null
  if (fvar !== undefined && gvar !== undefined) {
    const axes = fvar + u16(fvar + 4)
    for (let i = 0; i < u16(fvar + 8); i++) {
      const axis = axes + i * u16(fvar + 10)
      const tag = String.fromCharCode(u8(axis), u8(axis + 1), u8(axis + 2), u8(axis + 3))
      if (tag === 'wght') {
        weightAxis = { index: i, min: view.getInt32(axis + 4) / 65536, initial: view.getInt32(axis + 8) / 65536, max: view.getInt32(axis + 12) / 65536 }
      }
    }
  }

  // Moves a glyph's points from the default weight to the one asked for
  function vary(id, shape, weight) {
    if (!weightAxis) return shape
    const { index, min, initial, max } = weightAxis
    const target = Math.max(min, Math.min(max, weight))
    const position = target < initial ? (target - initial) / (initial - min) : target > initial ? (target - initial) / (max - initial) : 0
    if (position === 0) return shape

    const axisCount = u16(gvar + 4)
    const sharedTuples = gvar + u32(gvar + 8)
    const hasLongDataOffsets = (u16(gvar + 14) & 1) === 1
    const dataOffset = (n) => (hasLongDataOffsets ? u32(gvar + 20 + n * 4) : u16(gvar + 20 + n * 2) * 2)
    const data = gvar + u32(gvar + 16) + dataOffset(id)
    if (dataOffset(id + 1) === dataOffset(id)) return shape

    // The glyph's own points, then four more the font uses for its width
    const pointCount = shape.xs.length + 4
    const sumX = new Array(pointCount).fill(0)
    const sumY = new Array(pointCount).fill(0)

    const readPoints = (from) => {
      let at = from
      let count = u8(at++)
      if (count & 0x80) count = ((count & 0x7f) << 8) | u8(at++)
      if (count === 0) return { points: null, at }
      const points = []
      let point = 0
      while (points.length < count) {
        const control = u8(at++)
        for (let run = (control & 0x7f) + 1; run > 0 && points.length < count; run--) {
          if (control & 0x80) {
            point += u16(at)
            at += 2
          } else point += u8(at++)
          points.push(point)
        }
      }
      return { points, at }
    }

    const readDeltas = (from, count) => {
      let at = from
      const deltas = []
      while (deltas.length < count) {
        const control = u8(at++)
        for (let run = (control & 0x3f) + 1; run > 0 && deltas.length < count; run--) {
          if (control & 0x80) deltas.push(0)
          else if (control & 0x40) {
            deltas.push(i16(at))
            at += 2
          } else deltas.push(i8(at++))
        }
      }
      return { deltas, at }
    }

    // Fills in the points a variation leaves out, from their neighbours on the same contour
    const fillGaps = (deltas, isSet, coords) => {
      let first = 0
      for (const end of shape.ends) {
        const set = []
        for (let i = first; i <= end; i++) if (isSet[i]) set.push(i)
        for (let n = 0; n < set.length && set.length < end - first + 1; n++) {
          const a = set[n]
          const b = set[(n + 1) % set.length]
          const [low, high] = coords[a] <= coords[b] ? [a, b] : [b, a]
          for (let i = a === end ? first : a + 1; i !== b; i = i === end ? first : i + 1) {
            const c = coords[i]
            if (coords[low] === coords[high]) deltas[i] = deltas[low] === deltas[high] ? deltas[low] : 0
            else if (c <= coords[low]) deltas[i] = deltas[low]
            else if (c >= coords[high]) deltas[i] = deltas[high]
            else deltas[i] = deltas[low] + ((c - coords[low]) / (coords[high] - coords[low])) * (deltas[high] - deltas[low])
          }
          if (set.length === 1) for (let i = first; i <= end; i++) deltas[i] = deltas[a]
        }
        first = end + 1
      }
    }

    const tupleCount = u16(data)
    let header = data + 4
    let serialized = data + u16(data + 2)
    let sharedPoints = null
    if (tupleCount & 0x8000) {
      const read = readPoints(serialized)
      sharedPoints = read.points
      serialized = read.at
    }

    for (let t = 0; t < (tupleCount & 0x0fff); t++) {
      const size = u16(header)
      const tupleIndex = u16(header + 2)
      header += 4
      let peak = sharedTuples + (tupleIndex & 0x0fff) * axisCount * 2
      if (tupleIndex & 0x8000) {
        peak = header
        header += axisCount * 2
      }
      let range = null
      if (tupleIndex & 0x4000) {
        range = header
        header += axisCount * 4
      }

      // How much of this variation applies at the weight asked for. Other axes stay at
      // their defaults, so a variation that needs one of them moved does not apply.
      let scalar = 1
      for (let axis = 0; axis < axisCount; axis++) {
        const top = i16(peak + axis * 2) / 16384
        if (top === 0) continue
        const value = axis === index ? position : 0
        if (range !== null) {
          const from = i16(range + axis * 2) / 16384
          const to = i16(range + (axisCount + axis) * 2) / 16384
          if (value < from || value > to) scalar = 0
          else if (value < top) scalar *= (value - from) / (top - from)
          else if (value > top) scalar *= (to - value) / (to - top)
        } else if (value === 0 || value < Math.min(0, top) || value > Math.max(0, top)) scalar = 0
        else scalar *= value / top
      }

      if (scalar !== 0) {
        let at = serialized
        let points = sharedPoints
        if (tupleIndex & 0x2000) {
          const read = readPoints(at)
          points = read.points
          at = read.at
        }
        const count = points ? points.length : pointCount
        const dx = readDeltas(at, count)
        const dy = readDeltas(dx.at, count)
        const moveX = new Array(pointCount).fill(0)
        const moveY = new Array(pointCount).fill(0)
        if (points) {
          const isSet = new Array(pointCount).fill(false)
          points.forEach((point, n) => {
            if (point >= pointCount) return
            isSet[point] = true
            moveX[point] = dx.deltas[n]
            moveY[point] = dy.deltas[n]
          })
          fillGaps(moveX, isSet, shape.xs)
          fillGaps(moveY, isSet, shape.ys)
        } else {
          for (let i = 0; i < pointCount; i++) {
            moveX[i] = dx.deltas[i]
            moveY[i] = dy.deltas[i]
          }
        }
        for (let i = 0; i < pointCount; i++) {
          sumX[i] += moveX[i] * scalar
          sumY[i] += moveY[i] * scalar
        }
      }
      serialized += size
    }

    const n = shape.xs.length
    return {
      ...shape,
      xs: shape.xs.map((x, i) => x + sumX[i] - sumX[n]),
      ys: shape.ys.map((y, i) => y + sumY[i]),
      advance: shape.advance + sumX[n + 1] - sumX[n],
    }
  }

  // One glyph as path commands, placed at x on a baseline at y, with `scale` pixels per font unit
  function pathOf(shape, x, y, scale) {
    const round = (value) => +value.toFixed(2)
    const point = (i) => [round(x + shape.xs[i] * scale), round(y - shape.ys[i] * scale)]
    const between = (a, b) => [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)]
    let d = ''
    let first = 0
    for (const end of shape.ends) {
      const order = []
      for (let i = first; i <= end; i++) order.push(i)
      first = end + 1
      // Start on a point that lies on the curve, or halfway between two that do not
      const onCurve = order.findIndex((i) => shape.isOnCurve[i])
      const start = onCurve < 0 ? between(point(order.at(-1)), point(order[0])) : point(order[onCurve])
      const rest = onCurve < 0 ? order : [...order.slice(onCurve + 1), ...order.slice(0, onCurve)]
      d += `M${start[0]} ${start[1]}`
      let control = null
      for (const i of rest) {
        const here = point(i)
        if (shape.isOnCurve[i]) {
          d += control ? `Q${control[0]} ${control[1]} ${here[0]} ${here[1]}` : `L${here[0]} ${here[1]}`
          control = null
          continue
        }
        // Two control points in a row have a curve point halfway between them
        if (control) {
          const middle = between(control, here)
          d += `Q${control[0]} ${control[1]} ${middle[0]} ${middle[1]}`
        }
        control = here
      }
      if (control) d += `Q${control[0]} ${control[1]} ${start[0]} ${start[1]}`
      d += 'Z'
    }
    return d
  }

  const shapes = new Map()
  const shapeFor = (id, weight) => {
    const key = id + '@' + weight
    if (!shapes.has(key)) {
      const base = id < glyphCount ? outline(id) : null
      shapes.set(key, base && vary(id, base, weight))
    }
    return shapes.get(key)
  }

  return {
    // The text as one path and its width in pixels, or null when the font lacks a character
    draw(text, x, y, size, weight) {
      const scale = size / unitsPerEm
      let d = ''
      let cursor = x
      for (const char of text) {
        const id = glyphFor(char.codePointAt(0))
        const shape = id === 0 ? null : shapeFor(id, weight)
        if (!shape) return null
        d += pathOf(shape, cursor, y, scale)
        cursor += shape.advance * scale
      }
      return { d, width: cursor - x }
    },
  }
}

// Finds the Desktop app's typeface on this computer and reads it. Leaves `font` null,
// and the figures in the system font, when the app or the file is not there.
async function loadFont($) {
  for (const folder of FONT_FOLDERS) {
    try {
      const file = (await $.fs.list(folder)).find((entry) => FONT_FILE.test(entry.name))
      if (!file) continue
      const { base64 } = await $.fs.read(folder + '/' + file.name, { as: 'bytes' })
      font = parseFont(Uint8Array.fromBase64(base64))
      if (font) return
    } catch {
      // No Desktop app in this folder
    }
  }
}

// A piece of text for a drawn meter: outlines in the app's typeface when it was found,
// otherwise ordinary text in the system font with its width estimated
function textSvg(text, x, weight, className, color) {
  const size = 12
  const baseline = 12.25
  // A color of its own, or the theme's through the class
  const paint = color ? `fill="${color}"` : `class="${className}" fill="#8a8880"`
  const drawn = font?.draw(text, x, baseline, size, weight)
  if (drawn) return { markup: `<path ${paint} d="${drawn.d}"/>`, width: drawn.width }
  return {
    markup: `<text ${paint} x="${x}" y="${baseline}" font-family="${FALLBACK_FONT}" font-size="${size}" font-weight="${weight}">${escapeXml(text)}</text>`,
    width: text.length * (weight > WEIGHT_NORMAL ? 8.5 : 7.5),
  }
}

// One whole meter for the Desktop app: icon, rounded bar, figure and reset time, as far
// as the layout allows. A meter with no percent, the session cost, has no bar.
function meterSvg(m, layout) {
  const height = 16
  const barX = 20
  const barWidth = layout.bar
  const barHeight = 6
  const strokes = 'fill="none" stroke="#8a8880" stroke-linecap="round" stroke-linejoin="round"'

  let x = barX
  let bar = ''
  if (typeof m.percent === 'number' && barWidth > 0) {
    const filled = Math.max(m.percent > 0 ? barHeight : 0, (clamp(m.percent) / 100) * barWidth)
    bar =
      `<rect x="${barX}" y="5" width="${barWidth}" height="${barHeight}" rx="${barHeight / 2}" fill="#888888" fill-opacity="0.3"/>` +
      `<rect x="${barX}" y="5" width="${filled}" height="${barHeight}" rx="${barHeight / 2}" fill="${colorFor(m.percent).hex}"/>`
    x += barWidth + 7
  }
  // With no bar to carry the color, the figure does
  const tone = typeof m.percent === 'number' && barWidth === 0 ? colorFor(m.percent).hex : undefined
  const figure = textSvg(m.figure, x, WEIGHT_STRONG, 'strong', tone)
  x += figure.width
  let reset = ''
  if (m.detail && layout.hasReset) {
    x += 7
    const text = textSvg(m.detail, x + 13, WEIGHT_NORMAL, 'dim')
    reset = `<g class="icon" ${strokes} stroke-width="1.1" transform="translate(${+x.toFixed(2)} 3.25)">${RESET_ICON}</g>` + text.markup
    x += 13 + text.width
  }

  const width = Math.ceil(x + 1)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    // The tooltip, and an unseen sheet so it shows over the gaps between the parts too
    `<title>${escapeXml(m.name + ': ' + m.hint)}</title>` +
    `<rect width="${width}" height="${height}" fill="#000000" fill-opacity="0"/>` +
    SVG_STYLE +
    `<g class="icon" ${strokes} stroke-width="1.4">${iconFor(m.key).paths}</g>` +
    bar +
    figure.markup +
    reset +
    `</svg>`
  return { source, width, height }
}

// The same bar as characters, for the terminal: one cell for every 7 pixels of the drawn bar
function barText(percent, layout) {
  const cells = layout.bar / 7
  const filled = Math.round((clamp(percent) / 100) * cells)
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

// The meters to show: each plan limit, the context window, then the session's cost.
// `figure` and `detail` are drawn in the band, `name` and `hint` make up the meter's tooltip.
function meters(now) {
  if (!usage) return []
  const list = usage.rateLimits.map((limit) => {
    const percent = Math.round(limit.percentUsed)
    const resets = limit.resetsAt ? formatResetLong(limit.resetsAt) : ''
    return {
      key: limit.kind,
      name: iconFor(limit.kind).name,
      percent: limit.percentUsed,
      figure: percent + '%',
      detail: limit.resetsAt ? formatReset(limit.resetsAt, now) : '',
      hint: percent + '% used' + (resets ? ', resets ' + resets : ''),
    }
  })
  if (typeof usage.context?.percent === 'number') {
    const percent = Math.round(usage.context.percent)
    list.push({ key: 'context', name: ICONS.context.name, percent: usage.context.percent, figure: percent + '%', detail: '', hint: percent + '% full' })
  }
  // What the session's requests add up to at API prices, as /cost totals it
  if (typeof usage.cost?.usd === 'number') {
    list.push({
      key: 'cost',
      name: ICONS.cost.name,
      figure: '$' + usage.cost.usd.toFixed(2),
      detail: '',
      hint: 'what this session would have cost at API prices',
    })
  }
  return list
}

// Keeps the latest figures, says so once when a plan limit crosses WARN_AT, and redraws
function take($, figures) {
  usage = figures
  for (const limit of usage.rateLimits) {
    const before = lastPercent.get(limit.kind)
    if (before !== undefined && before < WARN_AT && limit.percentUsed >= WARN_AT) {
      const resets = limit.resetsAt ? '. It resets ' + formatResetLong(limit.resetsAt) : ''
      $.ui.toast(iconFor(limit.kind).name + ' is at ' + Math.round(limit.percentUsed) + '%' + resets, { timeoutMs: 8000 })
    }
    lastPercent.set(limit.kind, limit.percentUsed)
  }
  $.ui.invalidate('ui.render')
}

// Read the figures now, and redraw
async function refresh($) {
  take($, await $.session.usage())
}

export function register(on) {
  // Runs before your first prompt, and again after a reload
  on('session.start', async ($, e, next) => {
    await loadFont($)
    // The release, such as 2.1.280, or the full version when it is not spelled as one
    const engine = await $.session.version()
    version = engine.base ?? engine.version
    await refresh($)
    // Keeps the reset countdowns current while the session is idle
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  // Runs after each turn, and when a plan limit's percent used changes
  on('session.measure', async ($, e, next) => {
    take($, { context: e.context, rateLimits: e.rateLimits, cost: e.cost })
    return next(e)
  })

  on('ui.render', { component: SITE }, async ($, e, next) => {
    // Claude Code is asking a survey question in the band, so leave it alone
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Svg } = $.ui.resolve(e)
    // Only the Desktop app can draw an Svg
    const canDrawSvg = e.surface === 'desktop'
    const theirs = await next(e)
    const now = await $.clock.now()
    const items = meters(now)

    // One meter in the given layout, and how wide it is: pixels on the Desktop app, cells on the terminal
    const meter = (m, layout) => {
      if (canDrawSvg) {
        const { source, width, height } = meterSvg(m, layout)
        // Interactive, so that hovering the meter shows the tooltip its markup carries
        return { width, element: Svg({ source, alt: m.name + ': ' + m.hint, width, height, isInteractive: true }) }
      }
      const hasBar = typeof m.percent === 'number' && layout.bar > 0
      const tone = typeof m.percent === 'number' ? colorFor(m.percent).name : undefined
      // Each part's style and text. With no bar to carry the color, the figure does.
      const parts = [
        [{ dimColor: true }, iconFor(m.key).glyph],
        ...(hasBar ? [[{ color: tone }, barText(m.percent, layout)]] : []),
        [{ bold: true, ...(tone && !hasBar ? { color: tone } : {}) }, m.figure],
        ...(m.detail && layout.hasReset ? [[{ dimColor: true }, '↻ ' + m.detail]] : []),
      ]
      const width = parts.reduce((sum, [, text]) => sum + text.length, 0) + parts.length - 1
      const children = parts.map(([style, text]) => Text({ ...style, children: [text] }))
      return { width, element: Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, children }) }
    }

    // The roomiest layout whose meters fit side by side in the band; the tightest when none
    // does, and then the meters wrap onto further rows
    const room = typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns * (canDrawSvg ? CELL_PX : 1) : Infinity
    const gap = GAP * (canDrawSvg ? CELL_PX : 1)
    let drawn = []
    for (const layout of LAYOUTS) {
      drawn = items.map((m) => meter(m, layout))
      const width = drawn.reduce((sum, d) => sum + d.width, 0) + gap * (drawn.length - 1)
      if (width <= room) break
    }
    const elements = drawn.map((d) => d.element)

    const mine = Box({
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      columnGap: GAP,
      children: usage?.rateLimits.length
        ? elements
        : [...elements, Text({ dimColor: true, children: ['plan limits appear after the first reply'] })],
    })

    // What other mods draw here stays above, and the meters sit centred, closest to the prompt
    return Box({
      flexDirection: 'column',
      children: [
        ...(theirs ? [theirs] : []),
        Box({ flexDirection: 'row', justifyContent: 'center', width: '100%', children: [mine] }),
      ],
    })
  })

  // The hint line under the prompt gets the version at its end
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (!version) return next(e)
    const text = 'Claude Code ' + version
    // The terminal adds a tail to its own line. The Desktop app draws no tail yet, so
    // there the line's text is rewritten with the version after it.
    if (e.surface === 'terminal') {
      return next({ ...e, props: { ...e.props, tail: e.props.tail ? e.props.tail + ' · ' + text : text } })
    }
    return next({ ...e, props: { ...e.props, hint: e.props.hint ? e.props.hint + ' · ' + text : text } })
  })
}
