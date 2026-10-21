/**
 * @module Draws an architecture diagram: services and junctions on a grid, groups around them,
 * and orthogonal edges between their sides. Port of Pele's `src/diagrams/architecture/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { tighten, titleRoom } from '../common/fit_width.ts'
import { escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { edgeLabelSvg, marker, markerTrim } from '../../svg/edges.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS } from '../../svg/theme.ts'
import { type Label, type Span, labelDefault, layoutLabel, trimEnd } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD } from '../../text/measure.ts'
import { asUint, type Buf, fmax, fmin, midpoint, totalCmp } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'
import { type ArchitectureDb, NodeKind, architectureDbPosition } from './db.ts'
import { builtinIcon } from './icons.ts'
import { placeOnGrid, sideIndex } from './layout.ts'

const STUB = 12
const CORNER = 6
const LABEL_GAP = 4
const DOT = 3
/** {@link DOT} as YAML writes it. */
const DOT_TEXT = '3'
const DX: readonly number[] = [-1, 1, 0, 0]
const DY: readonly number[] = [0, 0, -1, 1]

function at(values: readonly number[], i: number): number {
  return values[i] ?? 0
}

/** Raises `values[i]` to at least `value`. */
function raise(values: number[], i: number, value: number): void {
  if (i >= 0 && i < values.length) values[i] = fmax(values[i] as number, value)
}

/** `count` copies of `value`. */
function filled(count: number, value: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(value)
  return out
}

function set<T>(values: T[], i: number, value: T): void {
  if (i >= 0 && i < values.length) values[i] = value
}

/**
 * A finite number of the `architecture` section of `config`, clamped to `min` and `max`, or
 * `fallback`.
 */
function setting(config: Value, key: string, fallback: number, min: number, max: number): number {
  if (config.kind !== 'Object') return fallback
  const section = config._0.find(([own]) => own === 'architecture')?.[1]
  if (section === undefined || section.kind !== 'Object') return fallback
  const value = section._0.find(([own]) => own === key)?.[1]
  if (value !== undefined && value.kind === 'Number' && Number.isFinite(value._0)) {
    return fmin(fmax(value._0, min), max)
  }
  return fallback
}

/** Maps the grid lines in use to consecutive indexes, so empty rows and columns take no room. */
function rank(values: number[]): number[] {
  values.sort((a, b) => a - b)
  const out: number[] = []
  for (const value of values) if (out.length === 0 || out[out.length - 1] !== value) out.push(value)
  return out
}

/** The index of `value` in a {@link rank}. */
function rankOf(ranks: readonly number[], value: number): number | undefined {
  let lo = 0
  let hi = ranks.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const v = ranks[mid] as number
    if (v === value) return mid
    if (v < value) lo = mid + 1
    else hi = mid
  }
  return undefined
}

function iconSlot(name: string, x: number, y: number, side: number): string {
  const sideText = num(side)
  // Icons need a host resolver, which Ondine does not take yet, so only built-ins draw.
  return `<svg class="ondine-icon" data-icon="${escText(name)}" x="${num(x)}" y="${num(y)}" width="${sideText}" height="${sideText}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${builtinIcon(name)}</svg>`
}

/** A number as YAML writes it. */
function yamlNumber(value: number): string {
  const out: Buf = { s: '' }
  pushNumber(out, value)
  return out.s
}

/** `String::from_utf16_lossy` of a slice of a string: lone surrogates become U+FFFD. */
function fromUtf16Lossy(text: string): string {
  return text.toWellFormed()
}

function isHigh(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}

function isLow(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff
}

/**
 * The width of the first `count` UTF-16 units of `units`. A cut inside a surrogate pair measures
 * as the whole pair, as Pele's measurer counts the high surrogate as the wide half.
 */
function prefixWidth(units: string, count: number, size: number, style: number): number {
  let end = Math.min(count, units.length)
  const next = end < units.length ? units.charCodeAt(end) : 0
  if (end > 0 && isHigh(units.charCodeAt(end - 1)) && isLow(next)) end += 1
  return measure.width(fromUtf16Lossy(units.slice(0, end)), size, style)
}

/** Cuts a label down to a box, ending what is left with an ellipsis. */
function fit(label: Label, maxWidth: number, maxLines: number): Label {
  const cut = label.lines.length > maxLines
  if (!cut && label.width <= maxWidth) return label
  const dots = measure.width('…', label.size, 0)
  const lines: Span[][] = []
  const widths: number[] = []
  let widest = 0
  const count = Math.min(label.lines.length, maxLines)
  for (let i = 0; i < count; i++) {
    const source = label.lines[i] as Span[]
    const line = source.map((span) => ({ ...span }))
    let width = at(label.widths, i)
    if (width > maxWidth || (cut && i + 1 === maxLines)) {
      for (;;) {
        const span = line[line.length - 1]
        if (span === undefined) {
          line.push({ icon: undefined, style: 0, text: '…', width: dots })
          width = dots
          break
        }
        const rest = width - span.width
        if (span.icon === undefined && rest + dots < maxWidth) {
          const units = span.text
          let lo = 0
          let hi = units.length
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (rest + prefixWidth(units, mid, label.size, span.style) + dots <= maxWidth) lo = mid
            else hi = mid - 1
          }
          if (lo > 0 && isHigh(units.charCodeAt(lo - 1))) lo -= 1
          const kept = fromUtf16Lossy(units.slice(0, lo))
          const text = trimEnd(kept) + '…'
          span.width = measure.width(text, label.size, span.style)
          span.text = text
          width = rest + span.width
          break
        }
        line.pop()
        width = rest
      }
    }
    lines.push(line)
    widths.push(width)
    widest = fmax(widest, width)
  }
  const height = lines.length * label.lineHeight
  return { ...label, height, lines, width: widest, widths }
}

/** Where an edge leaves or enters a node. */
type Port = {
  x: number
  y: number
  dx: number
  dy: number
  /** The box the route has to stay out of when it cannot leave straight. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** How far short of the port an arrowhead stops: the radius of a junction's dot. */
  gap: number
  /**
   * Set where a junction is reached through the border of its group: the line carries on to
   * the junction.
   */
  wire: boolean
}

/** An orthogonal route from one port to another, each left along its side's normal. */
function route(s: Port, e: Port): number[] {
  const sx = s.x
  const sy = s.y
  const sdx = s.dx
  const sdy = s.dy
  const ex = e.x
  const ey = e.y
  const edx = e.dx
  const edy = e.dy
  const s1x = sx + sdx * STUB
  const s1y = sy + sdy * STUB
  const e1x = ex + edx * STUB
  const e1y = ey + edy * STUB
  if (sdx * edx + sdy * edy === 0) {
    const cx = sdx === 0 ? sx : ex
    const cy = sdx === 0 ? ey : sy
    if ((cx - sx) * sdx + (cy - sy) * sdy > 0 && (cx - ex) * edx + (cy - ey) * edy > 0) {
      return [sx, sy, cx, cy, ex, ey]
    }
    return sdx === 0
      ? [sx, sy, s1x, s1y, e1x, s1y, e1x, e1y, ex, ey]
      : [sx, sy, s1x, s1y, s1x, e1y, e1x, e1y, ex, ey]
  }
  const sideways = sdx !== 0
  const offset = sideways ? ey - sy : ex - sx
  if (sdx === -edx && sdy === -edy) {
    const ahead = (ex - sx) * sdx + (ey - sy) * sdy
    if (ahead > 0) {
      if (Math.abs(offset) < 0.5) return [sx, sy, ex, ey]
      // Turn midway between the two boxes, which is clear of both titles, when there is such a
      // place.
      if (sideways) {
        const lo = sdx > 0 ? s.x1 : e.x1
        const hi = sdx > 0 ? e.x0 : s.x0
        const mx = lo < hi ? midpoint(lo, hi) : midpoint(sx, ex)
        return [sx, sy, mx, sy, mx, ey, ex, ey]
      }
      const lo = sdy > 0 ? s.y1 : e.y1
      const hi = sdy > 0 ? e.y0 : s.y0
      const my = lo < hi ? midpoint(lo, hi) : midpoint(sy, ey)
      return [sx, sy, sx, my, ex, my, ex, ey]
    }
  } else if (Math.abs(offset) >= 1) {
    if (sideways) {
      const x = sdx > 0 ? fmax(sx, ex) + STUB : fmin(sx, ex) - STUB
      return [sx, sy, x, sy, x, ey, ex, ey]
    }
    const y = sdy > 0 ? fmax(sy, ey) + STUB : fmin(sy, ey) - STUB
    return [sx, sy, sx, y, ex, y, ex, ey]
  }
  // The straight way is blocked by one of the two nodes: go between them, or around both.
  if (sideways) {
    const lane =
      s.y1 + STUB <= e.y0
        ? midpoint(s.y1, e.y0)
        : e.y1 + STUB <= s.y0
          ? midpoint(e.y1, s.y0)
          : fmax(s.y1, e.y1) + STUB
    return [sx, sy, s1x, sy, s1x, lane, e1x, lane, e1x, ey, ex, ey]
  }
  const lane =
    s.x1 + STUB <= e.x0
      ? midpoint(s.x1, e.x0)
      : e.x1 + STUB <= s.x0
        ? midpoint(e.x1, s.x0)
        : fmax(s.x1, e.x1) + STUB
  return [sx, sy, sx, s1y, lane, s1y, lane, e1y, ex, e1y, ex, ey]
}

/** Drops repeated points and joins runs that continue in a straight line. */
function simplify(p: number[]): number[] {
  const out = [at(p, 0), at(p, 1)]
  for (let k = 2; k < p.length; k += 2) {
    const x = at(p, k)
    const y = p[k + 1] ?? Number.NaN
    const n = out.length
    const sameX = Math.abs(x - at(out, n - 2)) < 0.01
    const sameY = Math.abs(y - at(out, n - 1)) < 0.01
    if (sameX && sameY) continue
    if (
      n >= 4 &&
      ((sameX && Math.abs(at(out, n - 4) - at(out, n - 2)) < 0.01) ||
        (sameY && Math.abs(at(out, n - 3) - at(out, n - 1)) < 0.01))
    ) {
      set(out, n - 2, x)
      set(out, n - 1, y)
    } else {
      out.push(x, y)
    }
  }
  return out
}

function point(x: number, y: number): string {
  return `${num(x)},${num(y)}`
}

/** Moves point `at_` towards point `toward` by `amount`, short of reaching it. */
function trimEndOf(xs: number[], ys: number[], at_: number, toward: number, amount: number): void {
  const ax = at(xs, at_)
  const ay = at(ys, at_)
  const tx = at(xs, toward)
  const ty = at(ys, toward)
  const len = Math.hypot(tx - ax, ty - ay)
  const t = fmin(amount, fmax(0, len - 1))
  if (len > 0 && t > 0) {
    set(xs, at_, ax + ((tx - ax) / len) * t)
    set(ys, at_, ay + ((ty - ay) / len) * t)
  }
}

/**
 * The path through points `p`, with rounded corners and its ends trimmed for markers. `p` holds
 * at least two points.
 */
function pathData(p: number[], startTrim: number, endTrim: number): string {
  const n = Math.trunc(p.length / 2)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < p.length; i += 2) xs.push(p[i] as number)
  for (let i = 1; i < p.length; i += 2) ys.push(p[i] as number)
  trimEndOf(xs, ys, 0, 1, startTrim)
  trimEndOf(xs, ys, n - 1, n - 2, endTrim)
  let d = `M${point(at(xs, 0), at(ys, 0))}`
  for (let i = 1; i < n - 1; i++) {
    const px = at(xs, i - 1)
    const py = at(ys, i - 1)
    const x = at(xs, i)
    const y = at(ys, i)
    const nx = at(xs, i + 1)
    const ny = at(ys, i + 1)
    const before = Math.hypot(x - px, y - py)
    const after = Math.hypot(nx - x, ny - y)
    const r = fmin(fmin(CORNER, before / 2), after / 2)
    if (r < 0.5) {
      d += `L${point(x, y)}`
      continue
    }
    const inX = x - ((x - px) / before) * r
    const inY = y - ((y - py) / before) * r
    const outX = x + ((nx - x) / after) * r
    const outY = y + ((ny - y) / after) * r
    d += `L${point(inX, inY)}Q${point(x, y)} ${point(outX, outY)}`
  }
  return `${d}L${point(at(xs, n - 1), at(ys, n - 1))}`
}

/** Draws `model` with the `architecture` section of `config`, tightened to fit the host's width. */
export function renderArchitecture(model: ArchitectureDb, config: Value, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(model, config, options, tight))
}

/** Draws `model` once, tightly spaced when `tight`. */
function draw(model: ArchitectureDb, config: Value, options: RenderOptions, tight: boolean): Rendered {
  const iconSize = setting(config, 'iconSize', 48, 8, 512)
  const size = setting(config, 'fontSize', options.fontSize ?? 16, 4, 128)
  const groupPad = fmin(setting(config, 'padding', 20, 0, 256), tight ? 12 : Number.POSITIVE_INFINITY)
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8
  const half = iconSize / 2

  const nodes = model.nodes
  const groups = model.groups
  const n = nodes.length
  const gCount = groups.length
  const grid = placeOnGrid(nodes, groups, model.edges, model.layoutHints)

  // A service is its icon square with the title beneath; a junction takes the same room.
  const wrap = tight ? fmax(iconSize, 64) : fmax(iconSize * 2.25, 96)
  const labels: Label[] = []
  const boxW: number[] = filled(n, 0)
  const boxH: number[] = filled(n, 0)
  for (let i = 0; i < n; i++) {
    const node = nodes[i] as (typeof nodes)[number]
    const title = node.kind === NodeKind.Service ? node.title : undefined
    const label = layoutLabel(title, true, size, wrap, 0, undefined)
    set(boxW, i, fmax(iconSize, 2 * Math.ceil(label.width / 2)))
    set(boxH, i, iconSize + (label.height > 0 ? LABEL_GAP + label.height : 0))
    labels.push(label)
  }

  const colValues: number[] = grid.col.slice()
  const rowValues: number[] = grid.row.slice()
  for (let g = 0; g < gCount; g++) {
    if (!(grid.groupEmpty[g] ?? false)) continue
    colValues.push(at(grid.groupCol, g))
    rowValues.push(at(grid.groupRow, g))
  }
  const colOf = rank(colValues)
  const rowOf = rank(rowValues)
  const cCount = colOf.length
  const rCount = rowOf.length
  const colW: number[] = filled(cCount, 0)
  const rowH: number[] = filled(rCount, 0)
  const gap = tight ? fmax(24, 2 * STUB) : fmax(40, jsRound(iconSize * 0.75))
  const gapX: number[] = filled(cCount, gap)
  const gapY: number[] = filled(rCount, gap)
  const nodeCol: number[] = filled(n, 0)
  const nodeRow: number[] = filled(n, 0)
  for (let i = 0; i < n; i++) {
    const c = rankOf(colOf, at(grid.col, i)) ?? 0
    const r = rankOf(rowOf, at(grid.row, i)) ?? 0
    set(nodeCol, i, c)
    set(nodeRow, i, r)
    raise(colW, c, at(boxW, i))
    raise(rowH, r, at(boxH, i))
  }
  for (let g = 0; g < gCount; g++) {
    if (!(grid.groupEmpty[g] ?? false)) continue
    const c = rankOf(colOf, at(grid.groupCol, g)) ?? 0
    const r = rankOf(rowOf, at(grid.groupRow, g)) ?? 0
    raise(colW, c, iconSize)
    raise(rowH, r, half)
  }

  // An edge label needs the gap its edge crosses to be wide enough to hold it.
  const edges = model.edges
  const edgeLabels: Label[] = []
  const ends: [number | undefined, number | undefined][] = []
  for (const edge of edges) {
    const a = architectureDbPosition(model, edge.lhsId)
    const b = architectureDbPosition(model, edge.rhsId)
    ends.push([a, b])
    const label = layoutLabel(edge.title, true, small, 160, 0, undefined)
    if (a !== undefined && b !== undefined && label.width !== 0) {
      const ca = at(nodeCol, a)
      const cb = at(nodeCol, b)
      if (ca === cb) {
        raise(colW, ca, 2 * Math.ceil(label.width / 2) + 8)
        const ra = at(nodeRow, a)
        const rb = at(nodeRow, b)
        if (ra !== rb) {
          const r = Math.min(ra, rb)
          raise(gapY, r, Math.ceil(label.height) + 24)
        }
      } else {
        const c = Math.min(ca, cb)
        raise(gapX, c, Math.ceil(label.width) + 28)
      }
    }
    edgeLabels.push(label)
  }

  // Room around each group, kept on the rows and columns at its edges. A group that shares an
  // edge with a group inside it stands that much further out. Children come after their
  // parents, so walking backwards settles every group before the one that holds it.
  const groupLabels: Label[] = []
  const c0: number[] = filled(gCount, 0)
  const c1: number[] = filled(gCount, 0)
  const r0: number[] = filled(gCount, 0)
  const r1: number[] = filled(gCount, 0)
  const insL: number[] = filled(gCount, 0)
  const insR: number[] = filled(gCount, 0)
  const insT: number[] = filled(gCount, 0)
  const insB: number[] = filled(gCount, 0)
  const headW: number[] = filled(gCount, 0)
  const headH: number[] = filled(gCount, 0)
  const colL: number[] = filled(cCount, 0)
  const colR: number[] = filled(cCount, 0)
  const rowT: number[] = filled(rCount, 0)
  const rowB: number[] = filled(rCount, 0)
  const badge = jsRound(size * 1.25)
  for (let g = 0; g < gCount; g++) {
    const group = groups[g] as (typeof groups)[number]
    const gc = at(grid.groupCol, g)
    const gr = at(grid.groupRow, g)
    set(c0, g, rankOf(colOf, gc) ?? 0)
    set(c1, g, rankOf(colOf, gc + at(grid.groupCols, g) - 1) ?? 0)
    set(r0, g, rankOf(rowOf, gr) ?? 0)
    set(r1, g, rankOf(rowOf, gr + at(grid.groupRows, g) - 1) ?? 0)
    const room = tight ? fmax(80, titleRoom(options) / 2) : 320
    const label = layoutLabel(group.title, true, size, room, 0, undefined)
    const icon = group.icon !== undefined && group.icon !== '' ? badge : 0
    const joint = label.width > 0 && icon > 0 ? 6 : 0
    set(headW, g, label.width + icon + joint)
    set(headH, g, fmax(label.height, icon))
    groupLabels.push(label)
  }
  for (let g = gCount - 1; g >= 0; g--) {
    const left = groupPad + at(insL, g)
    let right = groupPad + at(insR, g)
    const top = (at(headH, g) > 0 ? fmax(groupPad, at(headH, g) + 12) : groupPad) + at(insT, g)
    const bottom = groupPad + at(insB, g)
    const gc0 = at(c0, g)
    const gc1 = at(c1, g)
    const gr0 = at(r0, g)
    const gr1 = at(r1, g)
    if (at(headW, g) > 0) {
      let inner = left + right
      for (let c = gc0; c <= gc1; c++) {
        inner += at(colW, c) + (c < gc1 ? at(colR, c) + at(gapX, c) + at(colL, c + 1) : 0)
      }
      if (at(headW, g) + 20 > inner) right += Math.ceil(at(headW, g) + 20 - inner)
    }
    set(insL, g, left)
    set(insR, g, right)
    set(insT, g, top)
    set(insB, g, bottom)
    raise(colL, gc0, left)
    raise(colR, gc1, right)
    raise(rowT, gr0, top)
    raise(rowB, gr1, bottom)
    const p = at(grid.groupParent, g)
    if (p < 0) continue
    if (at(c0, p) === gc0) raise(insL, p, left)
    if (at(c1, p) === gc1) raise(insR, p, right)
    if (at(r0, p) === gr0) raise(insT, p, top)
    if (at(r1, p) === gr1) raise(insB, p, bottom)
  }

  const xs: number[] = filled(cCount, 0)
  const ys: number[] = filled(rCount, 0)
  let innerW = 0
  for (let c = 0; c < cCount; c++) {
    const x = innerW + at(colL, c)
    set(xs, c, x)
    innerW = x + at(colW, c) + at(colR, c) + (c + 1 < cCount ? at(gapX, c) : 0)
  }
  let innerH = 0
  for (let r = 0; r < rCount; r++) {
    const y = innerH + at(rowT, r)
    set(ys, r, y)
    innerH = y + at(rowH, r) + at(rowB, r) + (r + 1 < rCount ? at(gapY, r) : 0)
  }
  // What is drawn, which an edge that has to go around a node can push past the grid.
  let minX = 0
  let minY = 0
  let maxX = innerW
  let maxY = innerH

  const left = (g: number): number => at(xs, at(c0, g)) - at(insL, g)
  const right = (g: number): number => at(xs, at(c1, g)) + at(colW, at(c1, g)) + at(insR, g)
  const top = (g: number): number => at(ys, at(r0, g)) - at(insT, g)
  const bottom = (g: number): number => at(ys, at(r1, g)) + at(rowH, at(r1, g)) + at(insB, g)
  const centerX = (i: number): number => at(xs, at(nodeCol, i)) + at(colW, at(nodeCol, i)) / 2
  const rowY = (i: number): number => at(ys, at(nodeRow, i))
  const isJunction = (i: number): boolean => nodes[i]?.kind === NodeKind.Junction

  const port = (i: number, side: number, viaGroup: boolean): Port => {
    const dx = at(DX, side)
    const dy = at(DY, side)
    const cx = centerX(i)
    const y = rowY(i)
    const p: Port = {
      x: cx,
      y: y + half,
      dx,
      dy,
      x0: cx - at(boxW, i) / 2,
      y0: y,
      x1: cx + at(boxW, i) / 2,
      y1: y + at(boxH, i),
      gap: 0,
      wire: false,
    }
    if (isJunction(i)) {
      p.x0 = cx
      p.x1 = cx
      p.y0 = p.y
      p.y1 = p.y
      p.gap = DOT
    } else if (dx !== 0) {
      p.x = cx + dx * half
    } else {
      const below = (labels[i]?.height ?? 0) > 0 ? 2 : 0
      p.y = dy < 0 ? y : y + at(boxH, i) + below
    }
    const g = viaGroup ? at(grid.nodeParent, i) : -1
    if (g >= 0) {
      p.x0 = left(g)
      p.x1 = right(g)
      p.y0 = top(g)
      p.y1 = bottom(g)
      p.gap = 0
      p.wire = isJunction(i)
      if (dx === 0) p.y = dy < 0 ? p.y0 : p.y1
      else p.x = dx < 0 ? p.x0 : p.x1
    }
    return p
  }

  let edgesOut = ''
  let labelsOut = ''
  // Vertical runs of the edges, to keep group titles out from under them.
  const runs: number[] = []
  const trimLength = markerTrim('arrow_point')
  for (let k = 0; k < edges.length; k++) {
    const edge = edges[k] as (typeof edges)[number]
    const pair = ends[k]
    if (pair === undefined) continue
    const [a, b] = pair
    if (a === undefined || b === undefined) continue
    const s = port(a, sideIndex(edge.lhsDir), edge.lhsGroup)
    const e = port(b, sideIndex(edge.rhsDir), edge.rhsGroup)
    if (s.x === e.x && s.y === e.y && s.dx === e.dx) {
      // An edge from a side back to the same side: part the two ends so it shows as a loop.
      s.x -= 8 * Math.abs(s.dy)
      s.y -= 8 * Math.abs(s.dx)
      e.x += 8 * Math.abs(s.dy)
      e.y += 8 * Math.abs(s.dx)
    }
    const routed = route(s, e)
    if (s.wire) routed.unshift(centerX(a), rowY(a) + half)
    if (e.wire) routed.push(centerX(b), rowY(b) + half)
    const points = simplify(routed)
    if (points.length < 4) continue
    const id = `${edge.lhsId}-${edge.rhsId}`
    const startTrim = edge.lhsInto && !s.wire ? trimLength + s.gap : 0
    const endTrim = edge.rhsInto && !e.wire ? trimLength + e.gap : 0
    const startMarker = edge.lhsInto
      ? marker('arrow_point', s.x + s.dx * s.gap, s.y + s.dy * s.gap, -s.dx, -s.dy, 'var(--_l)')
      : ''
    const endMarker = edge.rhsInto
      ? marker('arrow_point', e.x + e.dx * e.gap, e.y + e.dy * e.gap, -e.dx, -e.dy, 'var(--_l)')
      : ''
    edgesOut += `<g class="ondine-edge" data-id="${escText(id)}"><path d="${pathData(points, startTrim, endTrim)}"/>${startMarker}${endMarker}</g>`

    let best: number | undefined
    let bestLength = -1
    let flat: number | undefined
    let flatLength = -1
    const label = edgeLabels[k] ?? labelDefault()
    for (let q = 0; q < points.length; q += 2) {
      const x = at(points, q)
      const y = at(points, q + 1)
      minX = fmin(minX, x - 4)
      maxX = fmax(maxX, x + 4)
      minY = fmin(minY, y - 4)
      maxY = fmax(maxY, y + 4)
    }
    let i = 0
    while (i + 3 < points.length) {
      const x0 = at(points, i)
      const y0 = at(points, i + 1)
      const x1 = at(points, i + 2)
      const y1 = at(points, i + 3)
      const horizontal = Math.abs(y0 - y1) < 0.01
      const length = Math.abs(x0 - x1) + Math.abs(y0 - y1)
      if (!horizontal) runs.push(x0, fmin(y0, y1), fmax(y0, y1))
      if (length > bestLength) {
        best = i
        bestLength = length
      }
      if (horizontal && length > flatLength) {
        flat = i
        flatLength = length
      }
      i += 2
    }
    if (label.width > 0) {
      const chosen = flatLength >= label.width + 8 ? flat : best
      if (chosen === undefined) continue
      const x0 = at(points, chosen)
      const y0 = at(points, chosen + 1)
      const x1 = at(points, chosen + 2)
      const y1 = at(points, chosen + 3)
      let x = midpoint(x0, x1)
      let y = midpoint(y0, y1)
      const w = label.width + 8
      const upright = Math.abs(x0 - x1) < 0.01
      // On a short run next to a node the label would land on the node, so it moves off to the
      // side.
      for (let side = 0; side < 2; side++) {
        const p = side === 0 ? s : e
        if (
          x + w / 2 <= p.x0 ||
          x - w / 2 >= p.x1 ||
          y + label.height / 2 <= p.y0 ||
          y - label.height / 2 >= p.y1
        ) {
          continue
        }
        if (upright) {
          x = x >= midpoint(p.x0, p.x1) ? p.x1 + w / 2 + 4 : p.x0 - w / 2 - 4
        } else {
          y = y >= midpoint(p.y0, p.y1) ? p.y1 + label.height / 2 + 4 : p.y0 - label.height / 2 - 4
        }
      }
      minX = fmin(minX, x - w / 2)
      maxX = fmax(maxX, x + w / 2)
      minY = fmin(minY, y - label.height / 2)
      maxY = fmax(maxY, y + label.height / 2)
      labelsOut += edgeLabelSvg(id, label, x, y, '', undefined)
    }
  }

  let clusters = ''
  for (let g = 0; g < gCount; g++) {
    const group = groups[g] as (typeof groups)[number]
    const x = left(g)
    const y = top(g)
    const w = right(g) - x
    let head = ''
    const hw = at(headW, g)
    const hh = at(headH, g)
    if (hw > 0) {
      // The title starts at the left, or after the edges that come down through that corner.
      const band = y + hh + 12
      const crossings: number[] = []
      for (let q = 0; q + 3 <= runs.length; q += 3) {
        const rx = at(runs, q)
        const ry0 = at(runs, q + 1)
        const ry1 = at(runs, q + 2)
        if (ry0 < band && ry1 > y && rx > x && rx < x + w) crossings.push(rx)
      }
      crossings.sort(totalCmp)
      crossings.push(x + w - 4)
      let start = x + 10
      for (const crossing of crossings) {
        if (crossing - 6 - start >= hw) break
        start = fmax(start, crossing + 6)
      }
      if (start + hw > x + w - 4) start = x + 10
      const cy = y + 6 + hh / 2
      let textX = start
      if (group.icon !== undefined && group.icon !== '') {
        head += iconSlot(group.icon, start, cy - badge / 2, badge)
        textX += badge + 6
      }
      const label = groupLabels[g] ?? labelDefault()
      head += labelSvg(label, textX + label.width / 2, cy, ' class="ondine-cluster-label" fill="var(--_m)"', undefined)
    }
    clusters += `<g class="ondine-cluster" data-id="${escText(group.id)}"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(bottom(g) - y)}" rx="${RADIUS}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"/>${head}</g>`
  }

  let nodesOut = ''
  const glyph = iconSize * 0.5
  const textSize = fmax(6, jsRound(size * 0.75))
  const halfText = num(half)
  const iconSizeText = num(iconSize)
  const serviceBox = `<rect x="${num(-half)}" width="${iconSizeText}" height="${iconSizeText}" rx="${RADIUS}" fill="var(--_s)" stroke="var(--_b)"/>`
  for (let i = 0; i < n; i++) {
    const node = nodes[i] as (typeof nodes)[number]
    const atAttrs = `data-id="${escText(node.id)}" transform="translate(${point(centerX(i), rowY(i))})"`
    if (node.kind === NodeKind.Junction) {
      nodesOut += `<g class="ondine-node ondine-junction" ${atAttrs}><circle cy="${halfText}" r="${DOT_TEXT}" fill="var(--_l)"/></g>`
      continue
    }
    let inner = ''
    if (node.icon !== undefined && node.icon !== '') {
      inner = iconSlot(node.icon, -glyph / 2, (iconSize - glyph) / 2, glyph)
    } else if (node.iconText !== undefined && node.iconText !== '') {
      const text = layoutLabel(node.iconText, false, textSize, iconSize - 8, 0, undefined)
      const lineHeight = text.lineHeight === 0 ? 1 : text.lineHeight
      const lines = Math.max(1, asUint(Math.floor((iconSize - 4) / lineHeight)))
      const attrs = ` class="ondine-icon-text" font-size="${yamlNumber(textSize)}"`
      inner = labelSvg(fit(text, iconSize - 8, lines), 0, half, attrs, undefined)
    }
    const label = labels[i] ?? labelDefault()
    nodesOut += `<g class="ondine-node ondine-service" ${atAttrs}>${serviceBox}${inner}${labelSvg(label, 0, iconSize + LABEL_GAP + label.height / 2, ' class="ondine-label"', undefined)}</g>`
  }

  const titleWidth = tight ? titleRoom(options) : 4000
  const title = layoutLabel(model.title, false, size, titleWidth, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const width = Math.ceil(fmax(maxX - minX, title.width) + 2 * pad)
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad)
  const ox = jsRound((width - (maxX - minX)) / 2 - minX)
  const oy = jsRound(pad + titleHeight - minY)

  let body = ''
  if (clusters !== '') body += `<g class="ondine-clusters">${clusters}</g>`
  if (edgesOut !== '') {
    body += `<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round" stroke-linejoin="round">${edgesOut}</g>`
  }
  if (labelsOut !== '') body += `<g class="ondine-edge-labels" font-size="${yamlNumber(small)}">${labelsOut}</g>`
  if (nodesOut !== '') body += `<g class="ondine-nodes">${nodesOut}</g>`

  let content = labelSvg(title, width / 2, pad + title.height / 2, ' class="ondine-title" font-weight="var(--_tw)"', undefined)
  if (body !== '') content += `<g transform="translate(${yamlNumber(ox)},${yamlNumber(oy)})">${body}</g>`
  const svg = svgDocument(
    'architecture',
    width,
    height,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content,
  )
  return { height, links: [], svg, width }
}
