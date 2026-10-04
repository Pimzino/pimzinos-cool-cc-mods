// The side panes' drawings for the Desktop app: each card is one SVG, laid out for the
// width it is given, and the same content as markdown for the terminal.

import { ACCENT_HEX, ALERT_HEX, WEIGHT_STRONG, bar, clamp, colorFor, detailIcon, icon, rect, svg, text } from './draw.js'

const PAD = 14
const RADIUS = 10

const money = (usd) => '$' + usd.toFixed(2)

// A card: a rounded sheet with a title, and a body drawn by `draw(x, y, innerWidth)`
// that answers its markup and its height
function card(width, title, draw) {
  const inner = width - PAD * 2
  const body = draw(PAD, 38, inner)
  const height = Math.ceil(38 + body.height + PAD)
  return svg(
    width,
    height,
    rect(0, 0, width, height, RADIUS) + text(title, PAD, 23, { size: 12, weight: WEIGHT_STRONG, tone: 'dim' }).markup + body.markup,
  )
}

// Plan limits: one block per limit, two side by side where the pane is wide
function limitsCard(width, limits) {
  return card(width, 'Plan limits', (x, y, inner) => {
    if (!limits.length) return { markup: text('Plan limits appear after the first reply.', x, y + 10, { tone: 'dim' }).markup, height: 16 }
    const columns = inner >= 520 ? 2 : 1
    const gap = 24
    const blockWidth = (inner - gap * (columns - 1)) / columns
    let markup = ''
    let rowHeight = 0
    let top = y
    limits.forEach((limit, i) => {
      const column = i % columns
      if (column === 0 && i > 0) {
        top += rowHeight + 18
        rowHeight = 0
      }
      const left = x + column * (blockWidth + gap)
      const right = left + blockWidth
      markup += icon(limit.key, left, top)
      markup += text(limit.name, left + 24, top + 12.5, { size: 13, weight: WEIGHT_STRONG }).markup
      markup += text(Math.round(limit.percent) + '%', right, top + 12.5, { size: 15, weight: WEIGHT_STRONG, anchor: 'end' }).markup
      markup += bar(left, top + 24, blockWidth, 8, limit.percent, colorFor(limit.percent).hex)
      // The full date where there is room for it, the countdown alone where there is not
      const resets = limit.resetLong ? (blockWidth >= 300 ? 'Resets ' + limit.resetLong + ' · in ' + limit.resetShort : 'Resets in ' + limit.resetShort) : ''
      let height = 32
      if (resets) {
        markup += text(resets, left, top + 50, { size: 11.5, tone: 'dim' }).markup
        height = 54
      }
      if (limit.pace) {
        const isAlert = limit.pace.kind === 'alert'
        if (isAlert) markup += detailIcon('alert', left, top + height + 9)
        markup += text(limit.pace.text, left + (isAlert ? 14 : 0), top + height + 18, { size: 11.5, tone: 'dim', color: isAlert ? ALERT_HEX : undefined }).markup
        height += 20
      }
      rowHeight = Math.max(rowHeight, height)
    })
    return { markup, height: top + rowHeight - y }
  })
}

// Context window: the fill, where it is summarised, and what is taking the room
function contextCard(width, context) {
  return card(width, 'Context window', (x, y, inner) => {
    const right = x + inner
    let markup = icon('context', x, y)
    markup += text(Math.round(context.percent) + '% full', x + 24, y + 12.5, { size: 13, weight: WEIGHT_STRONG }).markup
    if (context.tokens) markup += text(context.tokens.toLocaleString() + ' of ' + context.window.toLocaleString() + ' tokens', right, y + 12.5, { size: 11.5, tone: 'dim', anchor: 'end' }).markup
    markup += bar(x, y + 24, inner, 8, context.percent, colorFor(context.percent).hex)
    let height = 32
    if (context.compactAt !== null) {
      // A tick on the bar where the conversation is summarised
      const at = x + (clamp(context.compactAt) / 100) * inner
      markup += `<rect class="strong" x="${+(at - 1).toFixed(2)}" y="${y + 21}" width="2" height="14" rx="1" fill="#8a8880"/>`
      markup += text('Summarised at about ' + context.compactAt + '%', x, y + 50, { size: 11.5, tone: 'dim' }).markup
      height = 54
    }
    if (context.categories.length) {
      let top = y + height + 12
      const most = Math.max(...context.categories.map((c) => c.share))
      for (const c of context.categories) {
        markup += text(c.name, x, top + 11, { size: 12 }).markup
        markup += text(c.tokens.toLocaleString() + ' · ' + c.share.toFixed(1) + '%', right, top + 11, { size: 11.5, tone: 'dim', anchor: 'end' }).markup
        markup += bar(x, top + 17, inner, 3, (c.share / most) * 100, ACCENT_HEX)
        top += 30
      }
      markup += text('Estimated on this computer.', x, top + 8, { size: 11, tone: 'dim' }).markup
      height = top + 12 - y
    }
    return { markup, height }
  })
}

// Cost: the session's total, four figures as tiles, the last week by day, and recent turns
function costCard(width, cost) {
  return card(width, 'Cost at API prices', (x, y, inner) => {
    let markup = text(money(cost.session), x, y + 22, { size: 26, weight: WEIGHT_STRONG }).markup
    markup += text('this session', x, y + 40, { size: 11.5, tone: 'dim' }).markup
    let top = y + 56

    const row = tiles(
      [
        ['Latest turn', money(cost.turn)],
        ['Today', money(cost.today)],
        ['Last 7 days', money(cost.week)],
        ['Last 30 days', money(cost.month)],
      ],
      x,
      top,
      inner,
      400,
    )
    markup += row.markup
    top += row.height + 12

    // The last seven days as columns, each with its total above and its weekday below
    markup += text('Last 7 days', x, top + 10, { size: 11.5, weight: WEIGHT_STRONG, tone: 'dim' }).markup
    top += 22
    const chart = 64
    const most = Math.max(0.01, ...cost.days.map((d) => d.usd))
    const slot = inner / cost.days.length
    const columnWidth = Math.min(28, slot * 0.6)
    cost.days.forEach((day, i) => {
      const middle = x + slot * i + slot / 2
      const tall = Math.max(day.usd > 0 ? 3 : 1, (day.usd / most) * chart)
      markup += `<rect x="${+(middle - columnWidth / 2).toFixed(2)}" y="${+(top + 14 + chart - tall).toFixed(2)}" width="${+columnWidth.toFixed(2)}" height="${+tall.toFixed(2)}" rx="3" fill="${ACCENT_HEX}"${day.usd > 0 ? '' : ' fill-opacity="0.3"'}/>`
      if (day.usd > 0 && slot >= 44) markup += text(money(day.usd), middle, top + 9 + chart - tall, { size: 10, tone: 'dim', anchor: 'middle' }).markup
      markup += text(day.label, middle, top + 14 + chart + 14, { size: 10.5, tone: day.isToday ? 'strong' : 'dim', anchor: 'middle' }).markup
    })
    top += 14 + chart + 22

    if (cost.turns.length > 1) {
      markup += text('Recent turns', x, top + 14, { size: 11.5, weight: WEIGHT_STRONG, tone: 'dim' }).markup
      markup += text('largest ' + money(Math.max(...cost.turns)), x + inner, top + 14, { size: 11, tone: 'dim', anchor: 'end' }).markup
      top += 24
      const tallest = Math.max(...cost.turns)
      const step = Math.min(14, inner / cost.turns.length)
      cost.turns.forEach((usd, i) => {
        const tall = Math.max(2, (usd / tallest) * 28)
        markup += `<rect x="${+(x + i * step).toFixed(2)}" y="${+(top + 28 - tall).toFixed(2)}" width="${+Math.max(2, step - 3).toFixed(2)}" height="${+tall.toFixed(2)}" rx="1.5" fill="${ACCENT_HEX}" fill-opacity="0.75"/>`
      })
      top += 36
      // The latest few as figures, newest first
      markup += text(cost.turns.slice(-5).reverse().map(money).join('   '), x, top + 8, { size: 11.5, tone: 'dim' }).markup
      top += 14
    }
    return { markup, height: top - y }
  })
}

// A row of small tiles, wrapping to as many rows as the width needs; answers its markup and height
function tiles(items, x, top, inner, wide) {
  const columns = inner >= wide ? items.length : 2
  const gap = 8
  const tileWidth = (inner - gap * (columns - 1)) / columns
  let markup = ''
  items.forEach(([label, value, sub], i) => {
    const left = x + (i % columns) * (tileWidth + gap)
    const tileTop = top + Math.floor(i / columns) * (sub === undefined ? 54 : 68)
    markup += rect(left, tileTop, tileWidth, sub === undefined ? 46 : 60, 8)
    markup += text(label, left + 10, tileTop + 17, { size: 11, tone: 'dim' }).markup
    markup += text(value, left + 10, tileTop + 36, { size: 15, weight: WEIGHT_STRONG }).markup
    if (sub) markup += text(sub, left + 10, tileTop + 51, { size: 10.5, tone: 'dim' }).markup
  })
  return { markup, height: Math.ceil(items.length / columns) * (items.some((item) => item[2] !== undefined) ? 68 : 54) }
}

// Cost history: the whole record kept, as totals, a column for every day, and the latest days listed
function historyCard(width, history) {
  return card(width, 'Cost history, last ' + history.days.length + ' days', (x, y, inner) => {
    const row = tiles(
      [
        ['Total', money(history.total), history.activeDays + (history.activeDays === 1 ? ' day' : ' days') + ' with usage'],
        ['Average day', money(history.average), 'on days with usage'],
        ['Busiest day', history.busiest ? money(history.busiest.usd) : money(0), history.busiest ? history.busiest.label : 'none yet'],
        ['Sessions', String(history.sessions), 'tracked'],
      ],
      x,
      y,
      inner,
      440,
    )
    let markup = row.markup
    let top = y + row.height + 10

    // One column for every day, oldest on the left, with the months marked beneath
    const chart = 56
    const most = Math.max(0.01, ...history.days.map((d) => d.usd))
    const slot = inner / history.days.length
    markup += `<rect class="track" x="${x}" y="${top + chart}" width="${inner}" height="1" fill="#888888" fill-opacity="0.3"/>`
    history.days.forEach((day, i) => {
      const left = x + slot * i
      if (day.usd > 0) {
        const tall = Math.max(2, (day.usd / most) * chart)
        markup += `<rect x="${+left.toFixed(2)}" y="${+(top + chart - tall).toFixed(2)}" width="${+Math.max(1, slot - 1).toFixed(2)}" height="${+tall.toFixed(2)}" rx="1" fill="${ACCENT_HEX}"/>`
      }
      // A month that starts in the last few days would sit under the 'today' mark
      if (day.month && i < history.days.length * 0.85) markup += text(day.month, left, top + chart + 14, { size: 10.5, tone: 'dim' }).markup
    })
    markup += text('today', x + inner, top + chart + 14, { size: 10.5, anchor: 'end' }).markup
    top += chart + 28

    if (history.recent.length) {
      markup += text('Latest days with usage', x, top + 10, { size: 11.5, weight: WEIGHT_STRONG, tone: 'dim' }).markup
      top += 22
      for (const day of history.recent) {
        markup += text(day.label, x, top + 11, { size: 12 }).markup
        markup += text(money(day.usd), x + inner, top + 11, { size: 12, weight: WEIGHT_STRONG, anchor: 'end' }).markup
        markup += bar(x, top + 17, inner, 3, (day.usd / most) * 100, ACCENT_HEX)
        top += 28
      }
    }
    markup += text(history.note, x, top + 10, { size: 11, tone: 'dim' }).markup
    return { markup, height: top + 14 - y }
  })
}

// Session: plain facts, name on the left and value on the right
function sessionCard(width, rows) {
  return card(width, 'Session', (x, y, inner) => {
    let markup = ''
    rows.forEach(([name, value], i) => {
      markup += text(name, x, y + 11 + i * 24, { size: 12, tone: 'dim' }).markup
      markup += text(value, x + inner, y + 11 + i * 24, { size: 12, weight: WEIGHT_STRONG, anchor: 'end' }).markup
    })
    return { markup, height: rows.length * 24 - 8 }
  })
}

// The usage pane's cards, top to bottom, for a pane `width` pixels across
export function usageCards(model, width) {
  const cards = [{ ...limitsCard(width, model.limits), alt: 'Plan limits' }]
  if (model.context) cards.push({ ...contextCard(width, model.context), alt: 'Context window' })
  if (model.cost) cards.push({ ...costCard(width, model.cost), alt: 'Cost at API prices' })
  if (model.history) cards.push({ ...historyCard(width, model.history), alt: 'Cost history' })
  cards.push({ ...sessionCard(width, model.session), alt: 'Session' })
  return cards
}

// A heading in a pane
export const heading = (label, width) => svg(width, 26, text(label, 0, 18, { size: 12, weight: WEIGHT_STRONG, tone: 'dim' }).markup)

// A setting's name and what it does, beside its switch
export function settingLabel(name, description, width) {
  return svg(width, 36, text(name, 0, 14, { size: 13, weight: WEIGHT_STRONG }).markup + text(description, 0, 30, { size: 11.5, tone: 'dim' }).markup)
}

// A bar of blocks for the terminal's tables
const blocks = (percent, cells = 12) => {
  const filled = Math.round((clamp(percent) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

// The usage pane as markdown, for a surface that cannot draw the cards
export function usageMarkdown(model) {
  const out = ['## Plan limits', '']
  if (model.limits.length) {
    out.push('| Limit | Used | | Resets | Pace |', '|:--|--:|:--|:--|:--|')
    for (const l of model.limits) out.push(`| ${l.name} | ${Math.round(l.percent)}% | ${blocks(l.percent)} | ${l.resetLong ?? ''} | ${l.pace?.text ?? ''} |`)
  } else out.push('Plan limits appear after the first reply.')
  if (model.context) {
    out.push('', '## Context window', '', `${Math.round(model.context.percent)}% full` + (model.context.compactAt !== null ? `, summarised at about ${model.context.compactAt}%.` : '.'), '')
    if (model.context.categories.length) {
      out.push('| Category | Tokens | Share |', '|:--|--:|--:|')
      for (const c of model.context.categories) out.push(`| ${c.name} | ${c.tokens.toLocaleString()} | ${c.share.toFixed(1)}% |`)
    }
  }
  if (model.cost) {
    const c = model.cost
    out.push('', '## Cost at API prices', '', '| | |', '|:--|--:|')
    out.push(`| This session | ${money(c.session)} |`, `| Latest turn | ${money(c.turn)} |`, `| Today | ${money(c.today)} |`, `| Last 7 days | ${money(c.week)} |`, `| Last 30 days | ${money(c.month)} |`)
    out.push('', '| Day | Spent | |', '|:--|--:|:--|')
    const most = Math.max(0.01, ...c.days.map((d) => d.usd))
    for (const d of [...c.days].reverse()) out.push(`| ${d.label} | ${money(d.usd)} | ${blocks((d.usd / most) * 100)} |`)
  }
  if (model.history) {
    const h = model.history
    out.push('', '## Cost history, last ' + h.days.length + ' days', '', '| | |', '|:--|--:|')
    out.push(`| Total | ${money(h.total)} |`, `| Average day with usage | ${money(h.average)} |`, `| Busiest day | ${h.busiest ? money(h.busiest.usd) + ' on ' + h.busiest.label : 'none yet'} |`, `| Sessions tracked | ${h.sessions} |`)
    if (h.recent.length) {
      out.push('', '| Day | Spent |', '|:--|--:|')
      for (const d of h.recent) out.push(`| ${d.label} | ${money(d.usd)} |`)
    }
    out.push('', h.note)
  }
  out.push('', '## Session', '', '| | |', '|:--|:--|', ...model.session.map(([name, value]) => `| ${name} | ${value} |`))
  return out.join('\n')
}
