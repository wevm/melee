/** @module Lays out and draws a block diagram. Port of Pele's `src/diagrams/block/render.ts`. */
import type { Rendered } from '../../diagrams.ts'
import { tighten, titleRoom } from '../common/fit_width.ts'
import { escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { type EdgePath, edgeLabelSvg, marker, markerTrim } from '../../svg/edges.ts'
import { accessibleDefault, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { drawShape, shapeInset, shapeSize } from '../../svg/shapes.ts'
import { RADIUS, type ResolvedStyle, classNames, resolveStyle, resolvedStyleDefault } from '../../svg/theme.ts'
import { type Label, labelDefault, layoutLabel, trim } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { type Buf, clamp, fmax, fmin, midpoint } from '../../util/rust.ts'
import { pushNumber, type Value } from '../../yaml.ts'
import { AXIS_X, AXIS_Y, OVERHANG, arrowAxis, arrowMask, arrowSize, drawArrow } from './arrows.ts'
import { type BlockDb, blockDbChildren, blockDbClass, ROOT } from './db.ts'
import { type Cell, cellDefault, checkColumns, layout } from './layout.ts'
import { type Block, blockDefault } from './types.ts'

const GAP = 12.0
const WRAP = 200.0
const CORNER = 8.0
const SHAPE_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"'
const LINE_ATTRS = ' stroke="var(--_b)"'
/** Checking every edge against every block is quadratic, so large diagrams route without it. */
const OBSTACLE_BUDGET = 2_000_000

const FRAC_1_SQRT_2 = Math.SQRT1_2
const FRAC_PI_2 = Math.PI / 2
const FRAC_PI_4 = Math.PI / 4
const PI = Math.PI

/** The drawn shape of a block type. */
function shapeOf(type: string): string {
  switch (type) {
    case 'round':
      return 'rounded'
    case 'circle':
      return 'circle'
    case 'doublecircle':
      return 'dbl-circ'
    case 'diamond':
      return 'diam'
    case 'hexagon':
      return 'hex'
    case 'stadium':
      return 'stadium'
    case 'subroutine':
      return 'fr-rect'
    case 'cylinder':
      return 'cyl'
    case 'rect_left_inv_arrow':
      return 'odd'
    case 'lean_right':
      return 'lean-r'
    case 'lean_left':
      return 'lean-l'
    case 'trapezoid':
      return 'trap-b'
    case 'inv_trapezoid':
      return 'trap-t'
    default:
      return 'rect'
  }
}

/** Shapes that keep their own size in a larger cell, where the others stretch to fill it. */
function fixed(shape: string): boolean {
  return shape === 'circle' || shape === 'dbl-circ' || shape === 'diam'
}

/** Shapes that only widen, because their slants and curves are set by their height. */
function wide(shape: string): boolean {
  switch (shape) {
    case 'stadium':
    case 'hex':
    case 'odd':
    case 'lean-r':
    case 'lean-l':
    case 'trap-b':
    case 'trap-t':
      return true
    default:
      return false
  }
}

const Kind = { Arrow: 0, Composite: 1, Leaf: 2, Space: 3 } as const
type Kind = (typeof Kind)[keyof typeof Kind]

/** What a block is drawn as, beside its grid cell. */
type View = {
  block: number
  /** Drawn height, which for a fixed shape is smaller than its cell. */
  bh: number
  /** Drawn width, which for a fixed shape is smaller than its cell. */
  bw: number
  dx: number
  dy: number
  kind: Kind
  label: Label
  mask: number
  shape: string
  style: ResolvedStyle
}

/** An edge's route: two points for a straight line, three for a bend, none for a self-loop. */
type Route = {
  edge: number
  label: Label
  loop: number
  lx: number
  ly: number
  points: number[]
}

/** What routing reads of a placed view. */
type Shape = {
  bh: number
  bw: number
  kind: Kind
  mask: number
  name: string
  x: number
  y: number
}

function shapeDefault(): Shape {
  return { bh: 0, bw: 0, kind: Kind.Leaf, mask: 0, name: '', x: 0, y: 0 }
}

function shapeIsRound(self: Shape): boolean {
  return self.kind === Kind.Leaf && (self.name === 'circle' || self.name === 'dbl-circ')
}

function shapeIsDiamond(self: Shape): boolean {
  return self.kind === Kind.Leaf && self.name === 'diam'
}

/** The shape of view `at` as placed. */
function shape(cells: Cell[], views: View[], at: number): Shape {
  const c = cells[at]
  const v = views[at]
  if (c === undefined || v === undefined) return shapeDefault()
  return { bh: v.bh, bw: v.bw, kind: v.kind, mask: v.mask, name: v.shape, x: c.x, y: c.y }
}

/**
 * V8's `Math.hypot` for two values, copied from `layout/layered.ts`: a compensated sum of squares
 * scaled by the larger value. It differs from `f64::hypot` in the last bit.
 */
export function hypot(x: number, y: number): number {
  x = Math.abs(x)
  y = Math.abs(y)
  if (x === Number.POSITIVE_INFINITY || y === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  const max = y > x ? y : x
  if (max === 0) return 0

  // The loop over `[x, y]`, unrolled.
  let sum = 0
  let compensation = 0
  let n = x / max
  let summand = n * n - compensation
  let preliminary = sum + summand
  compensation = preliminary - sum - summand
  sum = preliminary
  n = y / max
  summand = n * n - compensation
  preliminary = sum + summand
  sum = preliminary
  return Math.sqrt(sum) * max
}

/** `value || 1`. */
function orOne(value: number): number {
  return value === 0 || Number.isNaN(value) ? 1 : value
}

/** JavaScript's `Math.sign`. */
function sign(x: number): number {
  if (x > 0) return 1
  if (x < 0) return -1
  return x
}

/** Where a vertical line at `x` meets the outline, below the center (`sign` 1) or above it (-1). */
function edgeY(v: Shape, x: number, sign: number): number {
  const hw = v.bw / 2
  const hh = v.bh / 2
  const dx = Math.abs(x - v.x)
  let reach: number
  if (shapeIsRound(v)) reach = Math.sqrt(fmax(hw * hw - dx * dx, 0))
  else if (shapeIsDiamond(v)) reach = hh * fmax(1 - dx / hw, 0)
  else if (v.kind === Kind.Leaf) reach = hh - shapeInset(v.name, v.bw, v.bh, sign > 0 ? 2 : 0, 0)
  else if (v.kind === Kind.Arrow && arrowAxis(v.mask) === AXIS_X) reach = hh - OVERHANG
  else reach = hh
  return v.y + sign * reach
}

/**
 * Where a horizontal line at `y` meets the outline, right of the center (`sign` 1) or left of it
 * (-1).
 */
function edgeX(v: Shape, y: number, sign: number): number {
  const hw = v.bw / 2
  const hh = v.bh / 2
  const dy = Math.abs(y - v.y)
  let reach: number
  if (shapeIsRound(v)) reach = Math.sqrt(fmax(hh * hh - dy * dy, 0))
  else if (shapeIsDiamond(v)) reach = hw * fmax(1 - dy / hh, 0)
  else if (v.kind === Kind.Leaf) reach = hw - shapeInset(v.name, v.bw, v.bh, sign > 0 ? 1 : 3, 0)
  else if (v.kind === Kind.Arrow && arrowAxis(v.mask) === AXIS_Y) reach = hw - OVERHANG
  else reach = hw
  return v.x + sign * reach
}

/** Where the line from the center toward (`tx`, `ty`) leaves the outline. */
function border(v: Shape, tx: number, ty: number, out: number[]): void {
  const dx = tx - v.x
  const dy = ty - v.y
  const hw = v.bw / 2
  const hh = v.bh / 2
  let k: number
  if (shapeIsRound(v)) {
    k = hw / orOne(hypot(dx, dy))
  } else if (shapeIsDiamond(v)) {
    k = 1 / orOne(Math.abs(dx) / hw + Math.abs(dy) / hh)
  } else {
    const kx = dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx)
    const ky = dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy)
    k = fmin(kx, ky)
  }
  if (k === Number.POSITIVE_INFINITY) k = 0
  out.push(v.x + dx * k)
  out.push(v.y + dy * k)
}

function crossesBox(x1: number, y1: number, x2: number, y2: number, v: Shape): boolean {
  const l = v.x - v.bw / 2 + 1
  const r = v.x + v.bw / 2 - 1
  const t = v.y - v.bh / 2 + 1
  const b = v.y + v.bh / 2 - 1
  if ((x1 < l && x2 < l) || (x1 > r && x2 > r) || (y1 < t && y2 < t) || (y1 > b && y2 > b)) {
    return false
  }
  if (x1 === x2 || y1 === y2) return true
  // The segment is diagonal and its bounding box overlaps: the box is hit unless all four
  // corners are on one side.
  const dx = x2 - x1
  const dy = y2 - y1
  const side = (x: number, y: number): number => sign(dx * (y - y1) - dy * (x - x1))
  const first = side(l, t)
  return first === 0 || side(r, t) !== first || side(r, b) !== first || side(l, b) !== first
}

/** The views a route may not cross: their view indices and their shapes. */
type Obstacles = { at: number[]; shapes: Shape[] }

function hits(points: number[], s: number, t: number, obstacles: Obstacles): number {
  let count = 0
  const ats = obstacles.at
  const shapes = obstacles.shapes
  for (let o = 0; o < ats.length; o++) {
    const at = ats[o] as number
    if (at === s || at === t) continue
    const v = shapes[o] as Shape
    for (let i = 0; i + 4 <= points.length; i += 2) {
      if (
        crossesBox(
          points[i] as number,
          points[i + 1] as number,
          points[i + 2] as number,
          points[i + 3] as number,
          v,
        )
      ) {
        count += 1
        break
      }
    }
  }
  return count
}

/**
 * A straight line where the two blocks share a row or a column, otherwise one bend between facing
 * sides.
 */
function routeEdge(
  [si, s]: [number, Shape],
  [ti, t]: [number, Shape],
  shift: number,
  obstacles: Obstacles | undefined,
): number[] {
  const sx = s.x
  const sy = s.y
  const sw = s.bw
  const sh = s.bh
  const tx = t.x
  const ty = t.y
  const tw = t.bw
  const th = t.bh
  const sl = sx - sw / 2
  const sr = sx + sw / 2
  const st = sy - sh / 2
  const sb = sy + sh / 2
  const tl = tx - tw / 2
  const tr = tx + tw / 2
  const tt = ty - th / 2
  const tb = ty + th / 2
  const x1 = fmax(sl, tl)
  const x2 = fmin(sr, tr)
  const y1 = fmax(st, tt)
  const y2 = fmin(sb, tb)
  const overX = x2 - x1 > 6
  const overY = y2 - y1 > 6

  if (overX && overY) {
    // One block is inside the other: join the inner one to the nearest side of the outer one.
    const innerIsS = sw * sh <= tw * th
    const inner = innerIsS ? s : t
    const outer = innerIsS ? t : s
    const ix = inner.x
    const iy = inner.y
    const iw = inner.bw
    const ih = inner.bh
    const ox = outer.x
    const oy = outer.y
    const ow = outer.bw
    const oh = outer.bh
    const up = iy - ih / 2 - (oy - oh / 2)
    const down = oy + oh / 2 - (iy + ih / 2)
    const left = ix - iw / 2 - (ox - ow / 2)
    const right = ox + ow / 2 - (ix + iw / 2)
    const least = fmin(fmin(fmin(up, down), left), right)
    let points: [number, number, number, number]
    if (least === down) points = [ix, edgeY(inner, ix, 1), ix, oy + oh / 2]
    else if (least === up) points = [ix, edgeY(inner, ix, -1), ix, oy - oh / 2]
    else if (least === right) points = [edgeX(inner, iy, 1), iy, ox + ow / 2, iy]
    else points = [edgeX(inner, iy, -1), iy, ox - ow / 2, iy]
    return innerIsS ? points.slice() : [points[2], points[3], points[0], points[1]]
  }
  if (overX) {
    const margin = fmin((x2 - x1) / 2, 6)
    const x = fmin(fmax(midpoint(x1, x2) + shift, x1 + margin), x2 - margin)
    const down = ty > sy ? 1 : -1
    return [x, edgeY(s, x, down), x, edgeY(t, x, -down)]
  }
  if (overY) {
    const margin = fmin((y2 - y1) / 2, 6)
    const y = fmin(fmax(midpoint(y1, y2) + shift, y1 + margin), y2 - margin)
    const right = tx > sx ? 1 : -1
    return [edgeX(s, y, right), y, edgeX(t, y, -right), y]
  }

  const right = tx > sx ? 1 : -1
  const down = ty > sy ? 1 : -1
  const across = [edgeX(s, sy, right), sy, tx, sy, tx, edgeY(t, tx, -down)]
  const along = [sx, edgeY(s, sx, down), sx, ty, edgeX(t, ty, -right), ty]
  const isWide = Math.abs(tx - sx) >= Math.abs(ty - sy)
  let best = isWide ? across : along
  const other = isWide ? along : across
  if (obstacles === undefined) return best
  let least = hits(best, si, ti, obstacles)
  if (least === 0) return best
  const count = hits(other, si, ti, obstacles)
  if (count < least) {
    best = other
    least = count
  }
  if (least === 0) return best
  const direct: number[] = []
  border(s, tx, ty, direct)
  border(t, sx, sy, direct)
  return hits(direct, si, ti, obstacles) < least ? direct : best
}

/** Builds the path through two or three points, rounding the bend and leaving room for markers. */
function trace(p: number[], startTrim: number, endTrim: number): EdgePath {
  const n = p.length
  const at = (i: number): number => p[i] ?? 0
  const sx = at(0)
  const sy = at(1)
  const ex = at(n - 2)
  const ey = at(n - 1)
  let ax = at(2) - sx
  let ay = at(3) - sy
  const first = hypot(ax, ay)
  ax /= orOne(first)
  ay /= orOne(first)
  let bx = ex - at(n - 4)
  let by = ey - at(n - 3)
  const last = hypot(bx, by)
  bx /= orOne(last)
  by /= orOne(last)
  if (n === 4 && startTrim + endTrim > first) {
    const scale = first / (startTrim + endTrim)
    startTrim *= scale
    endTrim *= scale
  }
  startTrim = fmin(startTrim, first)
  endTrim = fmin(endTrim, last)
  let d = `M${num(sx + ax * startTrim)},${num(sy + ay * startTrim)}`
  if (n === 6) {
    const r = fmax(fmin(fmin(CORNER, first - startTrim), last - endTrim), 0)
    const cx = at(2)
    const cy = at(3)
    d += `L${num(cx - ax * r)},${num(cy - ay * r)}Q${num(cx)},${num(cy)} ${num(cx + bx * r)},${num(cy + by * r)}`
  }
  d += `L${num(ex - bx * endTrim)},${num(ey - by * endTrim)}`
  return { d, edx: bx, edy: by, ex, ey, sdx: -ax, sdy: -ay, sx, sy }
}

/**
 * A self-loop is an arc around the top right corner of the block, or around the matching point on
 * a round or diamond outline. Gives the arc's center and radius and the angles where it leaves and
 * returns.
 */
function loopArc(v: Shape, k: number): [number, number, number, number, number] {
  const hw = v.bw / 2
  const hh = v.bh / 2
  const r = fmax(fmin(fmin(10 + 5 * (k - 1), hw), hh), 1)
  const x = v.x
  const y = v.y
  if (shapeIsRound(v)) {
    const px = x + hw * FRAC_1_SQRT_2
    const py = y - hw * FRAC_1_SQRT_2
    const half = 2 * Math.asin(fmin(r / (2 * hw), 1))
    const angle = (at: number): number => Math.atan2(y - hw * Math.sin(at) - py, x + hw * Math.cos(at) - px)
    return [px, py, r, angle(FRAC_PI_4 + half), angle(FRAC_PI_4 - half)]
  }
  if (shapeIsDiamond(v)) {
    const slope = Math.atan2(hh, hw)
    return [x + hw / 2, y - hh / 2, r, slope + PI, slope]
  }
  return [x + hw, y - hh, r, PI, FRAC_PI_2]
}

function loopPath(v: Shape, k: number, startTrim: number, endTrim: number): EdgePath {
  const [px, py, r, a1, a2] = loopArc(v, k)
  const from = a1 + startTrim / r
  const to = a2 - endTrim / r
  let sweep = (to - from) % (2 * PI)
  if (sweep <= 0) sweep += 2 * PI
  const x1 = px + r * Math.cos(from)
  const y1 = py + r * Math.sin(from)
  const x2 = px + r * Math.cos(to)
  const y2 = py + r * Math.sin(to)
  const sx = px + r * Math.cos(a1)
  const sy = py + r * Math.sin(a1)
  const ex = px + r * Math.cos(a2)
  const ey = py + r * Math.sin(a2)
  // Each marker lies along the chord it covers, so it follows the curve instead of the tangent at
  // its tip.
  const sl = hypot(sx - x1, sy - y1)
  const el = hypot(ex - x2, ey - y2)
  const d = `M${num(x1)},${num(y1)}A${num(r)},${num(r)}${sweep > PI ? ' 0 1 1 ' : ' 0 0 1 '}${num(x2)},${num(y2)}`
  return {
    d,
    edx: el > 0 ? (ex - x2) / el : -Math.sin(a2),
    edy: el > 0 ? (ey - y2) / el : Math.cos(a2),
    ex,
    ey,
    sdx: sl > 0 ? (sx - x1) / sl : Math.sin(a1),
    sdy: sl > 0 ? (sy - y1) / sl : -Math.cos(a1),
    sx,
    sy,
  }
}

const SPOTS = [0.5, 0.3, 0.7, 0.15, 0.85] as const

/**
 * Picks the point on a leg where a label of the given size covers no block other than the two it
 * joins.
 */
function labelSpot(
  p: number[],
  at: number,
  w: number,
  h: number,
  s: number,
  t: number,
  obstacles: Obstacles | undefined,
): number {
  if (obstacles === undefined) return 0.5
  const x0 = p[at] ?? 0
  const y0 = p[at + 1] ?? 0
  const x1 = p[at + 2] ?? 0
  const y1 = p[at + 3] ?? 0
  const ats = obstacles.at
  const shapes = obstacles.shapes
  spots: for (let k = 0; k < SPOTS.length; k++) {
    const spot = SPOTS[k] as number
    const x = x0 + (x1 - x0) * spot
    const y = y0 + (y1 - y0) * spot
    for (let o = 0; o < ats.length; o++) {
      const i = ats[o] as number
      const v = shapes[o] as Shape
      if (i !== s && i !== t && Math.abs(x - v.x) < midpoint(w, v.bw) && Math.abs(y - v.y) < midpoint(h, v.bh)) {
        continue spots
      }
    }
    return spot
  }
  return 0.5
}

/** The value under `key` of a YAML mapping. */
function get(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** Checks every container's grid width, as Pele's layout does when it places their children. */
function check(model: BlockDb): void {
  const queue = [ROOT]
  let at = 0
  while (at < queue.length) {
    const index = queue[at] as number
    at += 1
    const block = model.arena[index]
    if (block === undefined) continue
    if (block.type !== 'composite') continue
    const children = blockDbChildren(model, index)
    if (children.length > 0) checkColumns(block.columns ?? -1)
    for (const child of children) queue.push(child)
  }
}

/** Splits each style on `;` into `out`. A style list is split on commas only, so one entry can still hold several declarations. */
function addStyles(out: string[], styles: string[]): void {
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i] as string
    if (style.indexOf(';') === -1) out.push(style)
    else for (const part of style.split(';')) out.push(part)
  }
}

/** What {@link view} reads of a drawing, and the style shared by blocks with no classes or styles. */
type Context = {
  cells: Cell[]
  /** The style of a block with no classes or styles, once resolved. */
  fallback: ResolvedStyle | undefined
  gap: number
  model: BlockDb
  options: RenderOptions
  size: number
  /** The style of a space, once made. */
  space: ResolvedStyle | undefined
  tight: boolean
  views: View[]
  wrap: number
}

function styleOf(ctx: Context, block: Block): ResolvedStyle {
  const model = ctx.model
  const classes = block.classes
  const plain = (classes === undefined || classes.length === 0) && block.styles === undefined
  // Such a block's style depends only on the `default` class, and styles are only read.
  if (plain && ctx.fallback !== undefined) return ctx.fallback
  const declarations: string[] = []
  if (classes !== undefined && classes.length > 0) {
    for (let i = 0; i < classes.length; i++) {
      const def = blockDbClass(model, classes[i] as string)
      if (def !== undefined) addStyles(declarations, def.styles)
    }
  } else {
    const def = blockDbClass(model, 'default')
    if (def !== undefined) addStyles(declarations, def.styles)
  }
  if (block.styles !== undefined) addStyles(declarations, block.styles)
  const style = resolveStyle(declarations)
  if (plain) ctx.fallback = style
  return style
}

/** Whether no part of any line of `label` has an icon or text other than whitespace. */
function blankLabel(label: Label): boolean {
  for (const line of label.lines) {
    for (const part of line) if (!(part.icon === undefined && trim(part.text) === '')) return false
  }
  return true
}

/** Appends the cell and view of arena block `index`, and returns its kind. */
function view(ctx: Context, index: number): Kind {
  const model = ctx.model
  const gap = ctx.gap
  const wrap = ctx.wrap
  const stored = model.arena[index]
  const block = stored === undefined ? blockDefault() : stored
  const type = block.type
  const style = type === 'space' ? (ctx.space ??= resolvedStyleDefault()) : styleOf(ctx, block)
  const textStyle = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
  const fontSize = style.fontSize ?? ctx.size
  let kind: Kind = Kind.Leaf
  let shapeName = ''
  let nw = 0
  let nh = 0
  let head = 0
  let mask = 0
  let dx = 0
  let dy = 0
  let label: Label
  if (type === 'space') {
    kind = Kind.Space
    label = labelDefault()
  } else if (type === 'composite') {
    kind = Kind.Composite
    const room = ctx.tight ? titleRoom(ctx.options) : 4000
    label = layoutLabel(block.label, false, fontSize, room, textStyle, undefined)
    head = label.height > 0 ? label.height + 4 : 0
    nw = label.width + 2 * gap
    nh = head + 2 * gap
  } else if (type === 'block_arrow') {
    kind = Kind.Arrow
    label = layoutLabel(block.label, false, fontSize, wrap, textStyle, undefined)
    const blank = blankLabel(label)
    mask = arrowMask(block.directions)
    const s = blank ? arrowSize(mask, 0, 0) : arrowSize(mask, label.width, label.height)
    nw = s.w
    nh = s.h
    dx = s.dx
    dy = s.dy
  } else {
    shapeName = shapeOf(type)
    label = layoutLabel(block.label, false, fontSize, wrap, textStyle, undefined)
    const s = shapeSize(shapeName, label.width, label.height)
    nw = s.w
    // A cylinder's caps deepen as it widens, so it is sized for the deepest ones.
    nh = shapeName === 'cyl' ? fmax(s.h, label.height + 40) : s.h
    dy = s.dy
  }
  const cell = cellDefault()
  cell.columns = kind === Kind.Composite ? (block.columns ?? -1) : -1
  cell.head = head
  cell.nh = nh
  cell.nw = nw
  cell.space = kind === Kind.Space
  cell.span = kind === Kind.Space ? 1 : (block.widthInColumns ?? 1)
  ctx.cells.push(cell)
  ctx.views.push({ bh: 0, block: index, bw: 0, dx, dy, kind, label, mask, shape: shapeName, style })
  return kind
}

/**
 * Draws a block diagram, tightening its spacing when it does not fit the host's width.
 *
 * Throws a semantic error for a container whose grid has 0 columns.
 */
export function render(model: BlockDb, config: Value, options: RenderOptions): Rendered {
  check(model)
  return tighten(options, (tight) => draw(model, config, options, tight))
}

function draw(model: BlockDb, config: Value, options: RenderOptions, tight: boolean): Rendered {
  const size = options.fontSize ?? 16
  const edgeSize = jsRound(size * 0.875)
  const pad = options.padding ?? 8
  const blockConfig = get(config, 'block')
  const padding = blockConfig === undefined ? undefined : get(blockConfig, 'padding')
  const configured =
    padding !== undefined && padding.kind === 'Number' && padding._0 >= 0 ? fmin(padding._0, 200) : GAP
  const gap = tight ? fmin(configured, 6) : configured
  const wrap = tight ? 80 : WRAP

  const cells: Cell[] = []
  const views: View[] = []
  const byId = new Map<string, number>()
  const ctx: Context = {
    cells,
    fallback: undefined,
    gap,
    model,
    options,
    size,
    space: undefined,
    tight,
    views,
    wrap,
  }
  view(ctx, ROOT)
  const root = cells[0] as Cell
  root.nw = 0
  root.nh = 0
  let i = 0
  for (;;) {
    const parent = views[i]
    if (parent === undefined) break
    if (parent.kind === Kind.Composite) {
      const children = blockDbChildren(model, parent.block)
      const parentCell = cells[i]
      for (let j = 0; j < children.length; j++) {
        const child = children[j] as number
        const at = cells.length
        const kind = view(ctx, child)
        parentCell?.children.push(at)
        if (kind !== Kind.Space) {
          const id = model.arena[child]?.id
          if (id !== undefined) byId.set(id, at)
        }
      }
    }
    i += 1
  }

  const [contentWidth, contentHeight] = layout(cells, gap)

  const obstacleList: number[] = []
  for (let at = 0; at < views.length && at < cells.length; at++) {
    const v = views[at] as View
    const c = cells[at] as Cell
    if (v.kind === Kind.Leaf && fixed(v.shape)) {
      v.bw = c.nw
      v.bh = c.nh
    } else if (v.kind === Kind.Arrow) {
      v.bw = c.span > 1 ? c.w : c.nw
      v.bh = c.nh
    } else {
      v.bw = c.w
      v.bh = v.kind === Kind.Leaf && wide(v.shape) ? c.nh : c.h
    }
    if (v.kind === Kind.Leaf && v.shape === 'cyl') v.dy = clamp(v.bw / 14, 6, 12) / 2
    if (v.kind === Kind.Leaf || v.kind === Kind.Arrow) obstacleList.push(at)
  }

  // Edges between the same two blocks are spread apart instead of drawn on top of each other.
  const count = cells.length
  const pairs = new Map<number, number>()
  const labelled = new Set<number>()
  const ends: [number, number][] = []
  const drawn: number[] = []
  for (const edge of model.edges) {
    const block = model.arena[edge]
    if (block === undefined) continue
    const s = byId.get(block.start ?? '')
    const t = byId.get(block.end ?? '')
    if (s === undefined || t === undefined) continue
    const key = Math.min(s, t) * count + Math.max(s, t)
    pairs.set(key, (pairs.get(key) ?? 0) + 1)
    if (block.label !== undefined && block.label !== '') labelled.add(key)
    ends.push([s, t])
    drawn.push(edge)
  }

  const obstacleShapes: Shape[] = []
  for (let o = 0; o < obstacleList.length; o++) obstacleShapes.push(shape(cells, views, obstacleList[o] as number))
  const obstacles: Obstacles = { at: obstacleList, shapes: obstacleShapes }
  const checked = drawn.length * obstacleList.length <= OBSTACLE_BUDGET ? obstacles : undefined
  const seen = new Map<number, number>()
  const routes: Route[] = []
  let minX = 0
  let minY = 0
  let maxX = contentWidth
  let maxY = contentHeight
  const grow = (x: number, y: number, w: number, h: number): void => {
    if (x - w / 2 < minX) minX = x - w / 2
    if (x + w / 2 > maxX) maxX = x + w / 2
    if (y - h / 2 < minY) minY = y - h / 2
    if (y + h / 2 > maxY) maxY = y + h / 2
  }
  for (let e = 0; e < drawn.length && e < ends.length; e++) {
    const edge = drawn[e] as number
    const [s, t] = ends[e] as [number, number]
    const key = Math.min(s, t) * count + Math.max(s, t)
    const total = pairs.get(key) ?? 1
    const k = seen.get(key) ?? 0
    seen.set(key, k + 1)
    const block = model.arena[edge]
    const label = layoutLabel(block?.label, false, edgeSize, WRAP, 0, undefined)
    let points: number[]
    let lx: number
    let ly: number
    if (s === t) {
      const [px, py, r] = loopArc(shape(cells, views, s), k + 1)
      grow(px, py, 2 * r + 2, 2 * r + 2)
      points = []
      lx = px + r + 6 + label.width / 2
      ly = py - r / 2
    } else {
      const step = labelled.has(key) ? jsRound(edgeSize * 1.5) + 2 : 14
      const shift = (k - (total - 1) / 2) * step
      points = routeEdge([s, shape(cells, views, s)], [t, shape(cells, views, t)], shift, checked)
      const n = points.length
      const route = points
      const p = (index: number): number => route[index] ?? 0
      // The label goes on the longer leg.
      const firstLeg = Math.abs(p(2) - p(0)) + Math.abs(p(3) - p(1))
      const lastLeg = Math.abs(p(n - 2) - p(n - 4)) + Math.abs(p(n - 1) - p(n - 3))
      const at = n === 6 && lastLeg > firstLeg ? 2 : 0
      const spot =
        label.width > 0 ? labelSpot(points, at, label.width + 8, label.height, s, t, checked) : 0.5
      lx = p(at) + (p(at + 2) - p(at)) * spot
      ly = p(at + 1) + (p(at + 3) - p(at + 1)) * spot
    }
    if (label.width > 0) grow(lx, ly, label.width + 8, label.height)
    routes.push({ edge, label, loop: s === t ? k + 1 : 0, lx, ly, points })
  }

  const titleWidth = tight ? titleRoom(options) : 4000
  const title = layoutLabel(model.title, false, size, titleWidth, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const inner = fmax(maxX - minX, title.width)
  const ox = pad - minX + (inner - (maxX - minX)) / 2
  const oy = pad + titleHeight - minY
  for (const cell of cells) {
    cell.x += ox
    cell.y += oy
  }
  const width = Math.ceil(inner + 2 * pad)
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad)

  let clusters = ''
  let nodes = ''
  for (let at = 1; at < views.length; at++) {
    const v = views[at] as View
    if (v.kind === Kind.Space) continue
    const c = cells[at]
    if (c === undefined) continue
    const stored = model.arena[v.block]
    const block = stored === undefined ? blockDefault() : stored
    const list = block.classes
    const classes = list === undefined || list.length === 0 ? '' : classNames(list.join(' '))
    const id = escText(block.id ?? '')
    if (v.kind === Kind.Composite) {
      const top = c.y - c.h / 2
      const attrs = ` class="ondine-cluster-label" fill="var(--_m)"${v.style.text}`
      clusters += `<g class="ondine-cluster${classes}" data-id="${id}"><rect x="${num(c.x - c.w / 2)}" y="${num(top)}" width="${num(c.w)}" height="${num(c.h)}" rx="${RADIUS}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${v.style.shape}/>${labelSvg(v.label, c.x, top + midpoint(c.head, gap) + 2, attrs, undefined)}</g>`
      continue
    }
    const arrow = v.kind === Kind.Arrow
    const shapeAttrs = SHAPE_ATTRS + v.style.shape
    const body = arrow
      ? drawArrow(v.mask, v.bw, v.bh, shapeAttrs)
      : drawShape(v.shape, v.bw, v.bh, shapeAttrs, LINE_ATTRS + v.style.line)
    const attrs = ` class="ondine-label"${v.style.text}`
    nodes += `<g class="ondine-node ondine-shape-${arrow ? 'block-arrow' : v.shape}${classes}" data-id="${id}" transform="translate(${num(c.x)},${num(c.y)})">${body}${labelSvg(v.label, v.dx, v.dy, attrs, undefined)}</g>`
  }

  let edges = ''
  let labels = ''
  for (let e = 0; e < routes.length && e < ends.length; e++) {
    const route = routes[e] as Route
    const [s] = ends[e] as [number, number]
    const block = model.arena[route.edge] ?? blockDefault()
    const startType = block.arrowTypeStart ?? ''
    const endType = block.arrowTypeEnd ?? ''
    let path: EdgePath
    if (route.loop > 0) {
      path = loopPath(shape(cells, views, s), route.loop, markerTrim(startType), markerTrim(endType))
    } else {
      for (let j = 0; j + 1 < route.points.length; j += 2) {
        route.points[j] = (route.points[j] as number) + ox
        route.points[j + 1] = (route.points[j + 1] as number) + oy
      }
      path = trace(route.points, markerTrim(startType), markerTrim(endType))
    }
    const id = block.id ?? ''
    const thick = block.thickness === 'thick' ? ' stroke-width="2.5"' : ''
    const dotted = block.pattern === 'dotted' ? ' stroke-dasharray="3 4"' : ''
    edges += `<g class="ondine-edge" data-id="${escText(id)}"><path d="${path.d}"${thick}${dotted}/>${marker(startType, path.sx, path.sy, path.sdx, path.sdy, 'var(--_l)')}${marker(endType, path.ex, path.ey, path.edx, path.edy, 'var(--_l)')}</g>`
    if (route.label.width > 0) {
      labels += edgeLabelSvg(id, route.label, route.lx + ox, route.ly + oy, '', undefined)
    }
  }

  const content: Buf = {
    s: labelSvg(
      title,
      width / 2,
      pad + title.height / 2,
      ' class="ondine-title" font-weight="var(--_tw)"',
      undefined,
    ),
  }
  if (clusters !== '') content.s += `<g class="ondine-clusters">${clusters}</g>`
  if (edges !== '') {
    content.s += `<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edges}</g>`
  }
  content.s += `<g class="ondine-nodes">${nodes}</g>`
  if (labels !== '') {
    content.s += '<g class="ondine-edge-labels" font-size="'
    pushNumber(content, edgeSize)
    content.s += `">${labels}</g>`
  }

  const svg = svgDocument('block', width, height, size, options, accessibleDefault(), content.s)
  return { height, links: [], svg, width }
}
