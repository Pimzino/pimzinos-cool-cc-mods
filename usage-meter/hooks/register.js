import { parseFont } from './font.js'
import { ALERT_HEX, ICONS, WEIGHT_NORMAL, WEIGHT_STRONG, bar, clamp, colorFor, detailIcon, icon, iconFor, setFont, svg, text } from './draw.js'
import { heading, settingLabel, usageCards, usageMarkdown } from './panes.js'

// Where the meters are drawn. 'AbovePrompt' is the band directly above the prompt box,
// the site the Desktop app is known to draw. It does not draw 'PromptHint', the line under it.
const SITE = 'AbovePrompt'

// How often to refresh the figures and the reset countdowns, in milliseconds
const REFRESH_MS = 60_000

// The side panes: the full picture, and the settings
const USAGE_PANE = 'usage-meter'
const SETTINGS_PANE = 'usage-meter-settings'

// The usage pane is redrawn at most this often, however fast the figures move, so it holds
// still while a reply is being written
const PANE_REFRESH_MS = 5_000

// How long a limit's readings are kept to work out how fast it is filling, and the least
// time and rise there must be before a projection is trusted
const PACE_WINDOW_MS = 30 * 60_000
const PACE_MIN_MS = 5 * 60_000
const PACE_MIN_RISE = 2

// The context meter says so when the window is within this many points of auto-compaction
const COMPACT_NEAR = 10

// Days of cost history kept between sessions
const HISTORY_DAYS = 90

// How much of each meter is drawn, from roomiest to tightest: the bar's width in pixels
// (0 for no bar) and whether the reset time shows. The band uses the first that fits its width.
const LAYOUTS = [
  { bar: 56, hasReset: true },
  { bar: 28, hasReset: true },
  { bar: 28, hasReset: false },
  { bar: 0, hasReset: false },
]

// The Desktop app reports widths in character cells of about this many pixels,
// and draws one cell of gap as this many
const CELL_PX = 8

// Where a tooltip sits against its element, in rows: negative is above it
const TIP_ROWS = -1

// Cells between two meters, and the cells the band's two buttons take
const GAP = 3
const BUTTON_CELLS = 10

// The band's buttons, each a single character: the usage pane's and the settings pane's.
// The second ends with a mark that keeps the cog a plain character, not an emoji.
const USAGE_GLYPH = '☰'
const SETTINGS_GLYPH = '⚙\uFE0E'

// Where the Desktop app keeps its own typeface, Anthropic Sans. The mod reads the file from
// the app installed on this computer and draws text with its letter shapes, so the
// font is neither shipped with the mod nor installed.
const FONT_FOLDERS = ['/Applications/Claude.app/Contents/Resources/fonts']
const FONT_FILE = /^AnthropicSans-Romans?-.*\.ttf$/

// The settings, in the order the settings pane lists them: its group, name, what it does,
// and its value until the person changes it
const SETTINGS = [
  { key: 'showFiveHour', group: 'Meters', name: '5-hour limit', description: 'Show the 5-hour plan limit', initial: true },
  { key: 'showWeekly', group: 'Meters', name: 'Weekly limit', description: 'Show the weekly plan limit', initial: true },
  { key: 'showSpendLimit', group: 'Meters', name: 'Spend limit', description: 'Show the spend limit, where the account has one', initial: true },
  { key: 'showContext', group: 'Meters', name: 'Context window', description: 'Show how full the context window is', initial: true },
  { key: 'showCost', group: 'Meters', name: 'Session cost', description: 'Show what the session would have cost at API prices', initial: true },
  { key: 'showTurnCost', group: 'Meters', name: "Latest turn's cost", description: 'Show the latest turn beside the session cost', initial: true },
  { key: 'showVersion', group: 'Footer', name: 'Claude Code version', description: 'Show the bundled version under the prompt', initial: true },
  { key: 'showSessionAge', group: 'Footer', name: 'Session age', description: 'Show how long the session has been running', initial: true },
  { key: 'notifyOnReset', group: 'Notices', name: 'Limit reset', description: 'Say so when a plan limit starts over', initial: true },
  { key: 'notifyOnWarn', group: 'Notices', name: 'Limit warning', description: 'Say so when a plan limit reaches the warning level', initial: true },
]
const WARN_LEVELS = [70, 80, 90, 95]

// The setting that shows or hides each meter
const SHOW = { five_hour: 'showFiveHour', seven_day: 'showWeekly', spend_limit: 'showSpendLimit', context: 'showContext', cost: 'showCost' }

// The latest figures from $.session.usage(), shared by the hooks below
let usage = null

// The person's settings, kept in the store between sessions
let settings = {}

// The Claude Code version this session runs on, shown in the footer under the prompt
let version = ''

// The context window by category and the point where auto-compaction runs, read after each turn
let breakdown = null

// Each plan limit's last reading, to notice one crossing the warning level or resetting
const lastLimit = new Map()

// Each plan limit's recent readings, as { at, percent }, to work out how fast it is filling
const readings = new Map()

// The session's cost when the running turn began, and what each finished turn cost
let turnStartCost = null
const turnCosts = []

// Cost history: this session's spend by day, as kept in the store, and every session's by day
let historyKey = ''
let mySpend = {}
let recordedCost = null
let spendByDay = {}
let sessionCount = 0

// What the band last showed, and the usage pane's last drawing with when it was made
let shownBand = ''
let paneDrawing = null
let paneTimer = null

const money = (usd) => '$' + usd.toFixed(2)
const isOn = (key) => settings[key] ?? SETTINGS.find((s) => s.key === key)?.initial ?? true
const warnAt = () => (WARN_LEVELS.includes(settings.warnAt) ? settings.warnAt : 90)

// "2h 14m" for a span under a day, "3d 4h" for a longer one
function formatSpan(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return minutes + 'm'
  if (minutes < 24 * 60) return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
  return Math.floor(minutes / 1440) + 'd ' + Math.floor((minutes % 1440) / 60) + 'h'
}

// "2h 14m" for a reset later today, "Thu 09:00" for one further out
function formatReset(resetsAt, now) {
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  if (at - now <= 0) return 'now'
  if (at - now < 86_400_000) return formatSpan(at - now)
  const date = new Date(at)
  const day = date.toLocaleDateString(undefined, { weekday: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return day + ' ' + time
}

// "Friday 9 Oct, 17:28", for the notices, the tooltip and the pane
function formatResetLong(resetsAt) {
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return day + ', ' + time
}

// "2026-10-04" in this computer's time zone, the key a day's spend is kept under
function dayKey(ms) {
  const date = new Date(ms)
  const two = (n) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate())
}

// Finds the Desktop app's typeface on this computer and reads it. Without it, text is
// drawn in the system font.
async function loadFont($) {
  for (const folder of FONT_FOLDERS) {
    try {
      const file = (await $.fs.list(folder)).find((entry) => FONT_FILE.test(entry.name))
      if (!file) continue
      const { base64 } = await $.fs.read(folder + '/' + file.name, { as: 'bytes' })
      const parsed = parseFont(Uint8Array.fromBase64(base64))
      if (parsed) return setFont(parsed)
    } catch {
      // No Desktop app in this folder
    }
  }
}

// A warning stays in every layout; a reset time or other detail goes when room is short
const showsDetail = (m, layout) => Boolean(m.detail) && (layout.hasReset || m.detail.kind === 'alert')

// One whole meter for the Desktop app: icon, rounded bar, figure and detail, as far
// as the layout allows. A meter with no percent, the session cost, has no bar.
function meterSvg(m, layout) {
  const hasBar = typeof m.percent === 'number' && layout.bar > 0
  let x = 20
  let body = icon(m.key, 0, 0)
  if (hasBar) {
    body += bar(x, 5, layout.bar, 6, m.percent, colorFor(m.percent).hex)
    x += layout.bar + 7
  }
  // With no bar to carry the color, the figure does
  const tone = typeof m.percent === 'number' && !hasBar ? colorFor(m.percent).hex : undefined
  const figure = text(m.figure, x, 12.25, { weight: WEIGHT_STRONG, color: tone })
  body += figure.markup
  x += figure.width
  if (showsDetail(m, layout)) {
    x += 7
    if (m.detail.kind !== 'plain') {
      body += detailIcon(m.detail.kind, x, 3.25)
      x += 13
    }
    const detail = text(m.detail.text, x, 12.25, { weight: WEIGHT_NORMAL, tone: 'dim', color: m.detail.kind === 'alert' ? ALERT_HEX : undefined })
    body += detail.markup
    x += detail.width
  }
  return svg(Math.ceil(x + 1), 16, body)
}

// The same bar as characters, for the terminal: one cell for every 7 pixels of the drawn bar
function barText(percent, layout) {
  const cells = layout.bar / 7
  const filled = Math.round((clamp(percent) / 100) * cells)
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

// When a limit will be full at the pace of its recent readings, in milliseconds from now,
// or null when it is not rising or there is too little to go on
function fullIn(kind, now) {
  const list = readings.get(kind) ?? []
  if (list.length < 2) return null
  const first = list[0]
  const last = list.at(-1)
  const rise = last.percent - first.percent
  if (last.at - first.at < PACE_MIN_MS || rise < PACE_MIN_RISE || last.percent >= 100) return null
  const perMs = rise / (last.at - first.at)
  return (100 - last.percent) / perMs - (now - last.at)
}

// Whether a limit runs out before it resets at its current pace, and how long it has
function paceOf(limit, now) {
  const left = fullIn(limit.kind, now)
  const resetIn = limit.resetsAt ? Date.parse(limit.resetsAt) - now : Infinity
  return { left, runsOut: left !== null && left < resetIn }
}

// The tokens where auto-compaction runs, as a percent of the window, or null when it is off or unknown
function compactAt() {
  const threshold = breakdown?.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined
  const window = usage?.context?.window
  return typeof threshold === 'number' && window > 0 ? Math.round((threshold / window) * 100) : null
}

// What the running turn has cost so far
function turnCost() {
  const usd = usage?.cost?.usd
  return typeof usd === 'number' && turnStartCost !== null ? Math.max(0, usd - turnStartCost) : 0
}

// What was spent over the last `days` days, today included
function spentOver(days, now) {
  const from = dayKey(now - (days - 1) * 86_400_000)
  return Object.entries(spendByDay).reduce((sum, [day, usd]) => (day >= from ? sum + usd : sum), 0)
}

// The meters to show: each plan limit, the context window, then the session's cost.
// `figure` and `detail` are drawn in the band, `name` and `hint` make up the meter's tooltip.
function meters(now) {
  if (!usage) return []
  const list = usage.rateLimits.map((limit) => {
    const percent = Math.round(limit.percentUsed)
    const resets = limit.resetsAt ? formatResetLong(limit.resetsAt) : ''
    const { left, runsOut } = paceOf(limit, now)
    return {
      key: limit.kind,
      name: iconFor(limit.kind).name,
      percent: limit.percentUsed,
      figure: percent + '%',
      detail: runsOut
        ? { kind: 'alert', text: 'full in ~' + formatSpan(left) }
        : limit.resetsAt
          ? { kind: 'reset', text: formatReset(limit.resetsAt, now) }
          : null,
      hint: percent + '% used' + (resets ? ', resets ' + resets : '') + (runsOut ? '. At the current pace it is full in about ' + formatSpan(left) : ''),
    }
  })
  if (typeof usage.context?.percent === 'number') {
    const percent = Math.round(usage.context.percent)
    const compacts = compactAt()
    const isNear = compacts !== null && percent >= compacts - COMPACT_NEAR
    list.push({
      key: 'context',
      name: ICONS.context.name,
      percent: usage.context.percent,
      figure: percent + '%',
      detail: isNear ? { kind: 'alert', text: 'compacts at ' + compacts + '%' } : null,
      hint: percent + '% full' + (compacts !== null ? ', summarised at about ' + compacts + '%' : ''),
    })
  }
  // What the session's requests add up to at API prices, as /cost totals it
  if (typeof usage.cost?.usd === 'number') {
    const turn = turnCost()
    list.push({
      key: 'cost',
      name: ICONS.cost.name,
      figure: money(usage.cost.usd),
      detail: isOn('showTurnCost') && turn >= 0.005 ? { kind: 'plain', text: '+' + turn.toFixed(2) } : null,
      hint: 'what this session would cost at API prices' + (turn >= 0.005 ? ', ' + money(turn) + ' in the latest turn' : ''),
    })
  }
  return list.filter((m) => isOn(SHOW[m.key] ?? 'showSpendLimit'))
}

// Everything the usage pane shows, as plain data for its drawing
function usageModel(now) {
  const limits = (usage?.rateLimits ?? []).map((limit) => {
    const { left, runsOut } = paceOf(limit, now)
    return {
      key: limit.kind,
      name: iconFor(limit.kind).name,
      percent: limit.percentUsed,
      resetLong: limit.resetsAt ? formatResetLong(limit.resetsAt) : null,
      resetShort: limit.resetsAt ? formatSpan(Date.parse(limit.resetsAt) - now) : null,
      pace: runsOut
        ? { kind: 'alert', text: 'Full in about ' + formatSpan(left) + ' at the current pace' }
        : left !== null
          ? { kind: 'fine', text: 'At the current pace it lasts until it resets' }
          : null,
    }
  })

  let context = null
  if (typeof usage?.context?.percent === 'number') {
    const window = breakdown?.rawMaxTokens || usage.context.window
    context = {
      percent: usage.context.percent,
      tokens: usage.context.tokens,
      window: usage.context.window,
      compactAt: compactAt(),
      categories: (breakdown?.categories ?? [])
        .filter((c) => c.kind === 'used' && c.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 8)
        .map((c) => ({ name: c.name, tokens: c.tokens, share: (c.tokens / window) * 100 })),
    }
  }

  let cost = null
  if (typeof usage?.cost?.usd === 'number') {
    const days = []
    for (let back = 6; back >= 0; back--) {
      const at = now - back * 86_400_000
      days.push({ label: new Date(at).toLocaleDateString(undefined, { weekday: 'short' }), usd: spendByDay[dayKey(at)] ?? 0, isToday: back === 0 })
    }
    const turn = turnCost()
    cost = {
      session: usage.cost.usd,
      turn,
      today: spentOver(1, now),
      week: spentOver(7, now),
      month: spentOver(30, now),
      days,
      turns: [...turnCosts, ...(turn >= 0.005 ? [turn] : [])].slice(-24),
    }
  }

  // The whole record: every day of the last HISTORY_DAYS, oldest first
  let history = null
  if (cost) {
    const days = []
    for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
      const at = now - back * 86_400_000
      const date = new Date(at)
      days.push({
        usd: spendByDay[dayKey(at)] ?? 0,
        // The month's name under its first day, to mark the chart
        month: date.getDate() === 1 || back === HISTORY_DAYS - 1 ? date.toLocaleDateString(undefined, { month: 'short' }) : '',
        label: date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
      })
    }
    const spent = days.filter((d) => d.usd > 0)
    const total = spent.reduce((sum, d) => sum + d.usd, 0)
    const busiest = spent.reduce((top, d) => (d.usd > (top?.usd ?? 0) ? d : top), null)
    history = {
      days,
      total,
      activeDays: spent.length,
      average: spent.length ? total / spent.length : 0,
      busiest,
      sessions: sessionCount,
      recent: spent.slice(-7).reverse(),
      note: 'Counts sessions where this mod was running.',
    }
  }

  const session = []
  if (usage?.startedAt) session.push(['Running for', formatSpan(now - usage.startedAt)])
  if (version) session.push(['Bundled Claude Code', version])
  if (breakdown?.model) session.push(['Model', breakdown.model])
  return { limits, context, cost, history, session }
}

// Reads every session's spend by day from the store, and drops sessions past HISTORY_DAYS
async function loadHistory($, now) {
  const oldest = dayKey(now - HISTORY_DAYS * 86_400_000)
  const total = {}
  let sessions = 0
  for (const key of await $.store.keys()) {
    if (!key.startsWith('spend:')) continue
    const days = (await $.store.get(key)) ?? {}
    const latest = Object.keys(days).sort().at(-1)
    if (key !== historyKey && (!latest || latest < oldest)) {
      await $.store.delete(key)
      continue
    }
    if (key === historyKey) mySpend = { ...days }
    sessions++
    for (const [day, usd] of Object.entries(days)) total[day] = (total[day] ?? 0) + usd
  }
  spendByDay = total
  // This session counts even before its first spend is recorded
  sessionCount = sessions + (mySpend && Object.keys(mySpend).length ? 0 : 1)
}

// Adds what the session has spent since the last reading to today's total. Each session
// writes only its own entry in the store, so two sessions never overwrite each other.
async function recordSpend($, now) {
  const usd = usage?.cost?.usd
  if (typeof usd !== 'number' || !historyKey) return
  // The first reading after a load continues from what this session already recorded
  if (recordedCost === null) recordedCost = Object.values(mySpend).reduce((sum, n) => sum + n, 0)
  // A total that went down means the ledger started over
  const spent = usd >= recordedCost ? usd - recordedCost : usd
  recordedCost = usd
  if (spent <= 0) return
  const day = dayKey(now)
  mySpend[day] = (mySpend[day] ?? 0) + spent
  spendByDay[day] = (spendByDay[day] ?? 0) + spent
  await $.store.set(historyKey, mySpend)
}

// Keeps the latest figures, raises the notices they call for, and redraws
async function take($, figures) {
  const now = await $.clock.now()
  usage = figures
  for (const limit of usage.rateLimits) {
    const before = lastLimit.get(limit.kind)
    const name = iconFor(limit.kind).name
    if (before) {
      // A later reset time and a lower reading: the window rolled over
      const hasReset = limit.resetsAt && before.resetsAt && Date.parse(limit.resetsAt) > Date.parse(before.resetsAt) && limit.percentUsed < before.percent
      if (hasReset) {
        readings.delete(limit.kind)
        if (isOn('notifyOnReset') && before.percent >= 25) $.ui.toast(name + ' has reset', { timeoutMs: 8000 })
      } else if (isOn('notifyOnWarn') && before.percent < warnAt() && limit.percentUsed >= warnAt()) {
        const resets = limit.resetsAt ? '. It resets ' + formatResetLong(limit.resetsAt) : ''
        $.ui.toast(name + ' is at ' + Math.round(limit.percentUsed) + '%' + resets, { timeoutMs: 8000 })
      }
    }
    lastLimit.set(limit.kind, { percent: limit.percentUsed, resetsAt: limit.resetsAt })
    const list = (readings.get(limit.kind) ?? []).filter((r) => now - r.at <= PACE_WINDOW_MS)
    list.push({ at: now, percent: limit.percentUsed })
    readings.set(limit.kind, list)
  }
  await recordSpend($, now)
  showStatus($, now)
  redraw($, now)
}

// Asks for a redraw only when what is shown has changed: at once for the band, and for
// the usage pane no sooner than PANE_REFRESH_MS after its last drawing
function redraw($, now) {
  const band = JSON.stringify(meters(now))
  if (band !== shownBand) {
    shownBand = band
    $.ui.invalidate('ui.render')
  }
  if (paneTimer || !paneDrawing) return
  if (paneDrawing.shows === JSON.stringify(usageModel(now))) return
  paneTimer = $.clock.after(Math.max(0, paneDrawing.at + PANE_REFRESH_MS - now), () => {
    paneTimer = null
    paneDrawing = null
    $.ui.invalidate('ui.render')
  })
}

// The footer under the prompt: the Claude Code version and how long the session has run
function showStatus($, now) {
  const parts = []
  if (version && isOn('showVersion')) parts.push('Bundled CC ' + version)
  if (usage?.startedAt && isOn('showSessionAge')) parts.push('session ' + formatSpan(now - usage.startedAt))
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
}

// Read the figures now, and redraw
async function refresh($) {
  await take($, await $.session.usage())
}

// Reads the context window by category. Estimated on this computer, so it sends no request.
async function readBreakdown($) {
  try {
    breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown ?? null
  } catch {
    breakdown = null
  }
}

// Changes one setting, keeps it for later sessions, and redraws everything it touches
async function setSetting($, key, value) {
  settings = { ...settings, [key]: value }
  await $.store.set('settings', settings)
  showStatus($, await $.clock.now())
  paneDrawing = null
  $.ui.invalidate('ui.render')
}

async function openUsage($) {
  await readBreakdown($)
  paneDrawing = null
  await $.ui.open({ id: USAGE_PANE, title: 'Usage' })
}

export function register(on) {
  // Runs before your first prompt, and again after a reload
  on('session.start', async ($, e, next) => {
    await loadFont($)
    settings = (await $.store.get('settings')) ?? {}
    // The release, such as 2.1.280, or the full version when it is not spelled as one
    const engine = await $.session.version()
    version = engine.base ?? engine.version

    const first = await $.session.usage()
    // One entry in the store for each session, named by when it began
    historyKey = 'spend:' + first.startedAt
    await loadHistory($, await $.clock.now())
    await take($, first)
    await readBreakdown($)
    // Keeps the reset countdowns current while the session is idle
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  // A new turn begins: close the books on the one before
  on('prompt.submit', ($, e, next) => {
    const usd = usage?.cost?.usd
    if (typeof usd === 'number') {
      if (turnStartCost !== null && usd - turnStartCost >= 0.005) turnCosts.push(usd - turnStartCost)
      turnStartCost = usd
    }
    return next(e)
  })

  // Runs after each turn, and when a plan limit's percent used changes
  on('session.measure', async ($, e, next) => {
    await take($, { startedAt: usage?.startedAt, context: e.context, rateLimits: e.rateLimits, cost: e.cost })
    if (e.changed.includes('context')) {
      await readBreakdown($)
      redraw($, await $.clock.now())
    }
    return next(e)
  })

  // The usage pane: cards drawn for the pane's width on the Desktop app, tables elsewhere
  on('ui.render', { component: 'Pane', requestId: USAGE_PANE }, async ($, e) => {
    const { Box, Markdown, Svg } = $.ui.resolve(e)
    const now = await $.clock.now()
    const model = usageModel(now)
    if (e.surface !== 'desktop') return Markdown({ text: usageMarkdown(model) })
    const width = Math.max(240, Math.min(720, (e.props.bodyColumns ?? 50) * CELL_PX - 16))
    // The same cards again until redraw() says the figures have moved on, or the pane's
    // width changes. Unchanged cards are then the very same pictures, which the app leaves alone.
    if (!paneDrawing || paneDrawing.width !== width) {
      paneDrawing = { at: now, width, shows: JSON.stringify(model), cards: usageCards(model, width) }
    }
    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: paneDrawing.cards.map((card) => Svg({ source: card.source, alt: card.alt, width: card.width, height: card.height })),
    })
  })

  // The settings pane: a switch for each setting, and the warning level
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Select, Text } = table
    const isDesktop = e.surface === 'desktop'
    const width = Math.max(200, Math.min(560, (e.props.bodyColumns ?? 50) * CELL_PX - 16 - 9 * CELL_PX))
    const drawn = (picture, alt) => table.Svg({ source: picture.source, alt, width: picture.width, height: picture.height })

    const rows = []
    let group = ''
    for (const setting of SETTINGS) {
      if (setting.group !== group) {
        group = setting.group
        rows.push(isDesktop ? drawn(heading(group, width), group) : Text({ bold: true, children: [group] }))
      }
      const isEnabled = isOn(setting.key)
      rows.push(
        Box({
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: 2,
          children: [
            Button({ key: 'toggle-' + setting.key, label: isEnabled ? 'On' : 'Off', ...(isEnabled ? { variant: 'primary' } : {}), onPress: () => setSetting($, setting.key, !isEnabled) }),
            isDesktop
              ? drawn(settingLabel(setting.name, setting.description, width), setting.name + ': ' + setting.description)
              : Text({ children: [setting.name + ', ' + setting.description.toLowerCase()] }),
          ],
        }),
      )
    }
    rows.push(
      Box({
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: 2,
        children: [
          Select({
            key: 'warn-at',
            options: WARN_LEVELS.map((level) => ({ value: String(level), label: level + '%' })),
            value: String(warnAt()),
            onSelect: (value) => setSetting($, 'warnAt', Number(value)),
          }),
          isDesktop
            ? drawn(settingLabel('Warning level', 'How full a plan limit is when the warning appears', width), 'Warning level')
            : Text({ children: ['Warning level, how full a plan limit is when the warning appears'] }),
        ],
      }),
    )
    return Box({ flexDirection: 'column', rowGap: 1, children: rows })
  })

  on('ui.render', { component: SITE }, async ($, e, next) => {
    // Claude Code is asking a survey question in the band, so leave it alone
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    // Only the Desktop app can draw an Svg
    const canDrawSvg = e.surface === 'desktop'
    const theirs = await next(e)
    const now = await $.clock.now()
    const items = meters(now)

    // Wraps an element so that pointing at it shows a tooltip: a card the app draws above it,
    // in its own frame and typeface. The card holds one line of text, since the Desktop app
    // draws no Svg inside it, and that app places the card itself, from the element's left edge.
    const withTip = (key, element, label) =>
      Box({
        key,
        position: 'relative',
        children: [
          element,
          Box({
            position: 'absolute',
            top: TIP_ROWS,
            left: 0,
            display: 'none',
            hover: { display: 'flex' },
            children: [Text({ wrap: 'truncate', children: [label] })],
          }),
        ],
      })

    // One meter in the given layout, and how wide it is: pixels on the Desktop app, cells on the terminal
    const meter = (m, layout) => {
      if (canDrawSvg) {
        const { source, width, height } = meterSvg(m, layout)
        const picture = Svg({ source, alt: m.name + ': ' + m.hint, width, height })
        return { width, element: withTip('meter-' + m.key, picture, m.name + ': ' + m.hint) }
      }
      const hasBar = typeof m.percent === 'number' && layout.bar > 0
      const tone = typeof m.percent === 'number' ? colorFor(m.percent).name : undefined
      const marks = { reset: '↻ ', alert: '⚠ ', plain: '' }
      // Each part's style and text. With no bar to carry the color, the figure does.
      const parts = [
        [{ dimColor: true }, iconFor(m.key).glyph],
        ...(hasBar ? [[{ color: tone }, barText(m.percent, layout)]] : []),
        [{ bold: true, ...(tone && !hasBar ? { color: tone } : {}) }, m.figure],
        ...(showsDetail(m, layout) ? [[m.detail.kind === 'alert' ? { color: 'red' } : { dimColor: true }, marks[m.detail.kind] + m.detail.text]] : []),
      ]
      const width = parts.reduce((sum, [, string]) => sum + string.length, 0) + parts.length - 1
      const children = parts.map(([style, string]) => Text({ ...style, children: [string] }))
      return { width, element: Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, children }) }
    }

    // The roomiest layout whose meters fit side by side in the band, beside the button; the
    // tightest when none does, and then the meters wrap onto further rows
    const unit = canDrawSvg ? CELL_PX : 1
    const room = typeof e.props.bodyColumns === 'number' ? (e.props.bodyColumns - BUTTON_CELLS - GAP) * unit : Infinity
    let drawn = []
    for (const layout of LAYOUTS) {
      drawn = items.map((m) => meter(m, layout))
      const width = drawn.reduce((sum, d) => sum + d.width, 0) + GAP * unit * (drawn.length - 1)
      if (width <= room) break
    }
    const elements = drawn.map((d) => d.element)
    if (!usage?.rateLimits.length) elements.push(Text({ dimColor: true, children: ['plan limits appear after the first reply'] }))
    // The usage pane and the settings pane, each behind a one-character button
    elements.push(
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          withTip('tip-usage', Button({ key: 'open-usage', label: USAGE_GLYPH, onPress: () => openUsage($) }), 'Usage details'),
          withTip('tip-settings', Button({ key: 'open-settings', label: SETTINGS_GLYPH, onPress: () => $.ui.open({ id: SETTINGS_PANE, title: 'Usage settings' }) }), 'Usage settings'),
        ],
      }),
    )

    const mine = Box({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: GAP, children: elements })

    // What other mods draw here stays above, and the meters sit centred, closest to the prompt
    return Box({
      flexDirection: 'column',
      children: [...(theirs ? [theirs] : []), Box({ flexDirection: 'row', justifyContent: 'center', width: '100%', children: [mine] })],
    })
  })
}
