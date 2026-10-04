// Where the meters are drawn. 'PromptHint' is the line under the prompt box,
// 'AbovePrompt' is the band directly above it.
const SITE = 'PromptHint'

// How often to refresh the figures and the reset countdowns, in milliseconds
const REFRESH_MS = 60_000

// Short labels for the rate-limit windows Claude Code reports
const LABELS = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

// Bar colors by how full a meter is. Mid-tones, so they read on light and dark themes.
const COLORS = [
  { from: 90, hex: '#e5534b', name: 'red' },
  { from: 70, hex: '#e0a23c', name: 'yellow' },
  { from: 0, hex: '#4caf7d', name: 'green' },
]

// The latest figures from $.session.usage(), shared by the hooks below
let usage = null

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

// A rounded pill, for the Desktop app
function barSvg(percent) {
  const width = 56
  const height = 6
  const filled = Math.max(percent > 0 ? height : 0, (clamp(percent) / 100) * width)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="#888888" fill-opacity="0.3"/>` +
    `<rect width="${filled}" height="${height}" rx="${height / 2}" fill="${colorFor(percent).hex}"/>` +
    `</svg>`
  )
}

// The same bar as characters, for the terminal
function barText(percent) {
  const cells = 8
  const filled = Math.round((clamp(percent) / 100) * cells)
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

// The meters to show: each plan limit, then the context window
function meters(now) {
  if (!usage) return []
  const list = usage.rateLimits.map((limit) => ({
    key: limit.kind,
    label: LABELS[limit.kind] ?? limit.kind.replaceAll('_', ' '),
    percent: limit.percentUsed,
    detail: limit.resetsAt ? '↻ ' + formatReset(limit.resetsAt, now) : '',
  }))
  if (typeof usage.context?.percent === 'number') {
    list.push({ key: 'context', label: 'ctx', percent: usage.context.percent, detail: '' })
  }
  return list
}

// Read the figures now, and redraw
async function refresh($) {
  usage = await $.session.usage()
  $.ui.invalidate('ui.render')
}

export function register(on) {
  // Runs before your first prompt, and again after a reload
  on('session.start', async ($, e, next) => {
    await refresh($)
    // Keeps the reset countdowns current while the session is idle
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  // Runs after each turn, and when a plan limit's percent used changes
  on('session.measure', async ($, e, next) => {
    usage = { context: e.context, rateLimits: e.rateLimits, cost: e.cost }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: SITE }, async ($, e, next) => {
    const { Box, Text, Svg } = $.ui.resolve(e)
    const theirs = await next(e)
    const now = await $.clock.now()
    const items = meters(now)

    const meter = (m) => {
      const percent = Math.round(m.percent)
      const bar = Svg
        ? Svg({ source: barSvg(m.percent), alt: m.label + ' ' + percent + '% used', width: 56, height: 6 })
        : Text({ color: colorFor(m.percent).name, children: [barText(m.percent)] })
      return Box({
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: 1,
        children: [
          Text({ dimColor: true, children: [m.label] }),
          bar,
          Text({ bold: true, children: [percent + '%'] }),
          ...(m.detail ? [Text({ dimColor: true, children: [m.detail] })] : []),
        ],
      })
    }

    const mine = Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 3,
      children: items.some((m) => m.key !== 'context')
        ? items.map(meter)
        : [...items.map(meter), Text({ dimColor: true, children: ['plan limits appear after the first reply'] })],
    })

    // Claude Code's own drawing stays on the left, and the meters sit in the middle
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      children: [
        Box({ flexGrow: 1, children: theirs ? [theirs] : [] }),
        mine,
        Box({ flexGrow: 1, children: [] }),
      ],
    })
  })
}
