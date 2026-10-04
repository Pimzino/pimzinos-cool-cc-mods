// Reads a TrueType variable font: enough of it to turn a line of text into outlines at a
// chosen weight. Returns null for a file it cannot use.
export function parseFont(bytes) {
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
    unitsPerEm,
    // One character's outline in the font's own units, with y running down as a drawing's
    // does, and how far the next character sits from it; null when the font lacks it
    glyph(char, weight) {
      const id = glyphFor(char.codePointAt(0))
      const shape = id === 0 ? null : shapeFor(id, weight)
      return shape ? { id, d: pathOf(shape, 0, 0, 1), advance: shape.advance } : null
    },
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
