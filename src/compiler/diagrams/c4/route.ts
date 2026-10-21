/**
 * @module Routes C4 relations between shapes and boundaries. Port of Pele's
 * `src/diagrams/c4/route.ts`.
 *
 * Pele compares boxes by identity. This port gives every box an index, and compares those.
 */
import { pushNum } from '../../svg/builder.ts'
import { type Buf, fmax, fmin, midpoint } from '../../util/rust.ts'

/** A laid out shape or boundary: top-left corner, size, and the shared shape it is drawn as. */
export type Box = {
  /** The shared shape: `person`, `rect`, `cyl` or `h-cyl`. */
  form: Form
  /** Height. */
  h: number
  /** Width. */
  w: number
  /** Left edge. */
  x: number
  /** Top edge. */
  y: number
}

/** `Box::default()`. */
export function boxDefault(): Box {
  return { form: Form.Rect, h: 0, w: 0, x: 0, y: 0 }
}

/** The shared shape a box is drawn as. */
export const Form = {
  /** A cylinder standing up. */
  Cyl: 'Cyl',
  /** A cylinder lying down. */
  HCyl: 'HCyl',
  /** A person. */
  Person: 'Person',
  /** A rectangle. */
  Rect: 'Rect',
} as const
export type Form = (typeof Form)[keyof typeof Form]

/** The name of the shared shape. */
export function formName(self: Form): string {
  switch (self) {
    case Form.Cyl:
      return 'cyl'
    case Form.HCyl:
      return 'h-cyl'
    case Form.Person:
      return 'person'
    case Form.Rect:
      return 'rect'
  }
}

/** A routed relation. */
export type Route = {
  /** The path data. */
  d: string
  /** The direction of the end marker. */
  edx: number
  /** The direction of the end marker. */
  edy: number
  /** The tip of the end marker. */
  ex: number
  /** The tip of the end marker. */
  ey: number
  /** When set, the label stays over the line and moves that way by at most this much. */
  lean: number
  /** The side of the label's stretch the label is pushed to, as a unit vector. Zero centers it. */
  nx: number
  /** The side of the label's stretch the label is pushed to, as a unit vector. Zero centers it. */
  ny: number
  /** The corners of the line, as x, y pairs. */
  points: number[]
  /** The widest the label should be. */
  room: number
  /** The direction of the start marker. */
  sdx: number
  /** The direction of the start marker. */
  sdy: number
  /** The tip of the start marker. */
  sx: number
  /** The tip of the start marker. */
  sy: number
  /** The start of the stretch the label may sit on. */
  x0: number
  /** The end of the stretch the label may sit on. */
  x1: number
  /** The start of the stretch the label may sit on. */
  y0: number
  /** The end of the stretch the label may sit on. */
  y1: number
}

const LOOP = 28.0
/** Room for a relation to run along the inside of a boundary. */
export const LANE = 20.0
const LANE_STEP = 7.0
const CORNER = 8.0
/**
 * A wide label on an upright lane leans this far out from it, to the middle of the gap between
 * columns.
 */
const LEAN = 30.0
/** Label widths that fit the gap between two columns, and where there is room to spare. */
const NARROW = 88.0
const WIDE = 160.0
/**
 * The shared person shape: a head of radius 13 centered 14 below the top, over a body that
 * starts 26 below it.
 */
export const HEAD = 26.0

/**
 * Parallel stretches closer than this read as one line, and a line this close to a boundary's
 * frame reads as part of it.
 */
const NEAR = 6.0
const FRAME_NEAR = 3.0
const PORT_STEP = 12.0

/** JavaScript's `Math.sign`: zero and `NaN` stay as they are. */
export function sign(value: number): number {
  if (value > 0) return 1
  if (value < 0) return -1
  return value
}

/**
 * JavaScript's `Math.hypot` of two values, as V8 computes it: the sum of the squares of each
 * over the larger, compensated, then the square root times the larger.
 */
export function hypot(x: number, y: number): number {
  x = Math.abs(x)
  y = Math.abs(y)
  if (x === Number.POSITIVE_INFINITY || y === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  const max = y > x ? y : x
  if (max === 0) return 0

  // The compensated sum over `x` then `y`, unrolled.
  const nx = x / max
  const sx = nx * nx
  const sum0 = 0 + sx
  const compensation = sum0 - 0 - sx
  const ny = y / max
  const sy = ny * ny - compensation
  const sum = sum0 + sy
  return Math.sqrt(sum) * max
}

/** The cap radius `drawShape` uses for a standing cylinder. */
export function cylRy(w: number): number {
  return fmin(12, fmax(6, w / 14))
}

/** The cap radius `drawShape` uses for a lying cylinder. */
export function queueRx(h: number): number {
  return fmin(12, h / 4)
}

/**
 * How far along the segment from (`px`, `py`) by (`dx`, `dy`) it first meets the rectangle.
 * Infinity when it misses.
 */
function hitRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  px: number,
  py: number,
  dx: number,
  dy: number,
): number {
  let enter = 0
  let leave = 1
  if (dx === 0) {
    if (px < x0 || px > x1) return Number.POSITIVE_INFINITY
  } else {
    const a = (x0 - px) / dx
    const b = (x1 - px) / dx
    enter = fmax(enter, fmin(a, b))
    leave = fmin(leave, fmax(a, b))
  }
  if (dy === 0) {
    if (py < y0 || py > y1) return Number.POSITIVE_INFINITY
  } else {
    const a = (y0 - py) / dy
    const b = (y1 - py) / dy
    enter = fmax(enter, fmin(a, b))
    leave = fmin(leave, fmax(a, b))
  }
  return enter <= leave ? enter : Number.POSITIVE_INFINITY
}

function hitEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  px: number,
  py: number,
  dx: number,
  dy: number,
): number {
  const ux = dx / rx
  const uy = dy / ry
  const vx = (px - cx) / rx
  const vy = (py - cy) / ry
  const a = ux * ux + uy * uy
  const b = 2 * (ux * vx + uy * vy)
  const c = vx * vx + vy * vy - 1
  const disc = b * b - 4 * a * c
  if (a === 0 || disc < 0) return Number.POSITIVE_INFINITY
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  if (t >= 0 && t <= 1) return t
  if (c <= 0) return 0
  return Number.POSITIVE_INFINITY
}

/** Where a segment from outside first meets the outline of a shape, as a fraction of the segment. */
function hit(b: Box, px: number, py: number, qx: number, qy: number): number {
  const { x, y, w, h } = b
  const dx = qx - px
  const dy = qy - py
  switch (b.form) {
    case Form.Person:
      return fmin(
        hitRect(x, y + HEAD, x + w, y + h, px, py, dx, dy),
        hitEllipse(x + w / 2, y + 14, 13, 13, px, py, dx, dy),
      )
    case Form.Cyl: {
      const ry = cylRy(w)
      return fmin(
        fmin(
          hitRect(x, y + ry, x + w, y + h - ry, px, py, dx, dy),
          hitEllipse(x + w / 2, y + ry, w / 2, ry, px, py, dx, dy),
        ),
        hitEllipse(x + w / 2, y + h - ry, w / 2, ry, px, py, dx, dy),
      )
    }
    case Form.HCyl: {
      const rx = queueRx(h)
      return fmin(
        fmin(
          hitRect(x + rx, y, x + w - rx, y + h, px, py, dx, dy),
          hitEllipse(x + rx, y + h / 2, rx, h / 2, px, py, dx, dy),
        ),
        hitEllipse(x + w - rx, y + h / 2, rx, h / 2, px, py, dx, dy),
      )
    }
    case Form.Rect:
      return hitRect(x, y, x + w, y + h, px, py, dx, dy)
  }
}

/** Whether the line through `points` crosses the rectangle. */
export function crosses(points: number[], x0: number, y0: number, x1: number, y1: number): boolean {
  for (let i = 0; i + 4 <= points.length; i += 2) {
    const px = points[i] as number
    const py = points[i + 1] as number
    const qx = points[i + 2] as number
    const qy = points[i + 3] as number
    if (hitRect(x0, y0, x1, y1, px, py, qx - px, qy - py) <= 1) return true
  }
  return false
}

function contains(outer: Box, inner: Box): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  )
}

/** The straight line from a to b: x, y of its start, then of its end. */
function connect(a: Box, b: Box, shift: number): [number, number, number, number] {
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  const bx = b.x + b.w / 2
  const by = b.y + b.h / 2
  const down = contains(a, b)
  if (down || contains(b, a)) {
    // One holds the other: a short line from the nearest side of the outer box.
    const [outer, inner] = down ? [a, b] : [b, a]
    const ix = inner.x + inner.w / 2
    const iy = inner.y + inner.h / 2
    const left = inner.x - outer.x
    const right = outer.x + outer.w - inner.x - inner.w
    const top = inner.y - outer.y
    const bottom = outer.y + outer.h - inner.y - inner.h
    const least = fmin(fmin(fmin(left, right), top), bottom)
    const ox = least === left ? outer.x : least === right ? outer.x + outer.w : ix
    const oy = least === left || least === right ? iy : least === bottom ? outer.y + outer.h : outer.y
    const t = fmin(hit(inner, ox, oy, ix, iy), 1)
    const mx = ox + (ix - ox) * t
    const my = oy + (iy - oy) * t
    return down ? [ox, oy, mx, my] : [mx, my, ox, oy]
  }

  let px = ax
  let py = ay
  let qx = bx
  let qy = by
  // Shapes that share a column or a row are joined by an upright or level line through the
  // shared span.
  const x0 = fmax(a.x, b.x)
  const x1 = fmin(a.x + a.w, b.x + b.w)
  const y0 = fmax(a.y, b.y)
  const y1 = fmin(a.y + a.h, b.y + b.h)
  if (x0 < x1) {
    px = midpoint(x0, x1)
    qx = px
  } else if (y0 < y1) {
    py = midpoint(y0, y1)
    qy = py
  }
  const hyp = hypot(qx - px, qy - py)
  const len = hyp === 0 || Number.isNaN(hyp) ? 1 : hyp
  const nx = (-(qy - py) / len) * shift
  const ny = ((qx - px) / len) * shift
  let ta = hit(a, qx + nx, qy + ny, px + nx, py + ny)
  let tb = hit(b, px + nx, py + ny, qx + nx, qy + ny)
  if (ta <= 1 && tb <= 1) {
    px += nx
    py += ny
    qx += nx
    qy += ny
  } else {
    px = ax
    py = ay
    qx = bx
    qy = by
    ta = fmin(hit(a, qx, qy, px, py), 1)
    tb = fmin(hit(b, px, py, qx, qy), 1)
  }
  return [qx + (px - qx) * ta, qy + (py - qy) * ta, px + (qx - px) * tb, py + (qy - py) * tb]
}

/**
 * What the routes drawn so far take up, so that the next keeps apart from them: upright
 * stretches as x, top, bottom; level ones as y, left, right; and where lines leave or reach
 * each side of a shape.
 */
export type Lanes = {
  frames: [number[], number[]]
  level: number[]
  /**
   * Routes that found no lane of their own: a line left straight behind a shape, or a lane
   * that runs along another.
   */
  squeezed: number
  taken: Map<number, number[]>
  upright: number[]
}

/** `Lanes::default()`. */
export function lanesDefault(): Lanes {
  return { frames: [[], []], level: [], squeezed: 0, taken: new Map(), upright: [] }
}

function lanesFree(self: Lanes, upright: boolean, at: number, a0: number, a1: number): boolean {
  const lo = fmin(a0, a1)
  const hi = fmax(a0, a1)
  const near = (list: number[], gap: number): boolean => {
    for (let i = 0; i + 3 <= list.length; i += 3) {
      const x = list[i] as number
      const from = list[i + 1] as number
      const to = list[i + 2] as number
      if (Math.abs(x - at) < gap && from < hi && to > lo) return true
    }
    return false
  }
  const own = upright ? self.upright : self.level
  const frames = upright ? self.frames[0] : self.frames[1]
  return !near(own, NEAR) && !near(frames, FRAME_NEAR)
}

function lanesCrossings(self: Lanes, points: number[]): number {
  let count = 0
  for (let i = 0; i + 4 <= points.length; i += 2) {
    const px = points[i] as number
    const py = points[i + 1] as number
    const qx = points[i + 2] as number
    const qy = points[i + 3] as number
    const upright = qx === px
    const at = upright ? qx : qy
    const a = upright ? py : px
    const b = upright ? qy : qx
    const lo = fmin(a, b)
    const hi = fmax(a, b)
    const list = upright ? self.level : self.upright
    for (let k = 0; k + 3 <= list.length; k += 3) {
      const x = list[k] as number
      const from = list[k + 1] as number
      const to = list[k + 2] as number
      if (x > lo && x < hi && from < at && to > at) count += 1
    }
  }
  return count
}

/** Records a boundary's frame, which lines keep off. */
export function lanesFrame(self: Lanes, b: Box): void {
  self.frames[0].push(b.x, b.y, b.y + b.h, b.x + b.w, b.y, b.y + b.h)
  self.frames[1].push(b.y, b.x, b.x + b.w, b.y + b.h, b.x, b.x + b.w)
}

function lanesTake(self: Lanes, points: number[]): void {
  for (let i = 0; i + 4 <= points.length; i += 2) {
    const px = points[i] as number
    const py = points[i + 1] as number
    const qx = points[i + 2] as number
    const qy = points[i + 3] as number
    if (qx === px) {
      self.upright.push(qx, fmin(py, qy), fmax(py, qy))
    } else if (qy === py) {
      self.level.push(qy, fmin(px, qx), fmax(px, qx))
    }
  }
}

/**
 * Where on one side of a shape (0 left, 1 right, 2 top, 3 bottom) a line can leave or arrive,
 * between `lo` and `hi`: the places clear of the lines already there, nearest `want` first.
 */
function lanesPorts(self: Lanes, id: number, side: number, want: number, lo: number, hi: number): number[] {
  const used = self.taken.get(id) ?? []
  const out: number[] = []
  for (let k = 0; k < 9; k++) {
    if (out.length >= 4) break
    const way = (k & 1) === 1 ? 1 : -1
    const at = want + way * Math.ceil(k / 2) * PORT_STEP
    if (at < lo || at > hi) continue
    let clear = true
    for (let i = 0; i + 2 <= used.length; i += 2) {
      if (used[i] === side && Math.abs((used[i + 1] as number) - at) < PORT_STEP) {
        clear = false
        break
      }
    }
    if (clear) out.push(at)
  }
  return out.length === 0 ? [want] : out
}

function lanesClaim(self: Lanes, id: number, side: number, at: number): void {
  let list = self.taken.get(id)
  if (list === undefined) {
    list = []
    self.taken.set(id, list)
  }
  list.push(side, at)
}

function path(points: number[], startTrim: number, endTrim: number): string {
  const n = points.length
  const at = (i: number): number => (i >= 0 && i < n ? (points[i] as number) : Number.NaN)
  const ux = sign(at(2) - at(0))
  const uy = sign(at(3) - at(1))
  const d: Buf = { s: 'M' }
  pushNum(d, at(0) + ux * startTrim)
  d.s += ','
  pushNum(d, at(1) + uy * startTrim)
  let i = 2
  while (i + 2 < n) {
    const x = at(i)
    const y = at(i + 1)
    const ix = sign(x - at(i - 2))
    const iy = sign(y - at(i - 1))
    const ox = sign(at(i + 2) - x)
    const oy = sign(at(i + 3) - y)
    const r = fmin(
      fmin(CORNER, Math.abs(x - at(i - 2) + y - at(i - 1)) / 2),
      Math.abs(at(i + 2) - x + at(i + 3) - y) / 2,
    )
    if (ix === 0) {
      d.s += 'V'
      pushNum(d, y - iy * r)
    } else {
      d.s += 'H'
      pushNum(d, x - ix * r)
    }
    d.s += 'Q'
    pushNum(d, x)
    d.s += ','
    pushNum(d, y)
    d.s += ' '
    pushNum(d, x + ox * r)
    d.s += ','
    pushNum(d, y + oy * r)
    i += 2
  }
  const lx = sign(at(n - 2) - at(n - 4))
  const ly = sign(at(n - 1) - at(n - 3))
  if (lx === 0) {
    d.s += 'V'
    pushNum(d, at(n - 1) - ly * endTrim)
  } else {
    d.s += 'H'
    pushNum(d, at(n - 2) - lx * endTrim)
  }
  return d.s
}

/** Whether the line through `points` keeps clear of every box but `a` and `b`. */
function clearOf(points: number[], boxes: Box[], others: number[], a: number, b: number): boolean {
  for (let i = 0; i < others.length; i++) {
    const other = others[i] as number
    if (other === a || other === b) continue
    const o = boxes[other]
    if (o !== undefined && crosses(points, o.x, o.y, o.x + o.w, o.y + o.h)) return false
  }
  return true
}

/** What a bent route sets about its label, where it differs from the defaults. */
type Bend = {
  lean: number
  nx: number
  room: number
}

function bendDefault(): Bend {
  return { lean: 0, nx: 0, room: 0 }
}

/**
 * The route for a line with corners through `points`, from a's outline to b's. `along` is the
 * stretch its label sits on.
 */
function bent(points: number[], along: number, startTrim: number, endTrim: number, label: Bend): Route {
  const n = points.length
  const at = (i: number): number => (i >= 0 && i < n ? (points[i] as number) : Number.NaN)
  return {
    d: path(points, startTrim, endTrim),
    edx: sign(at(n - 2) - at(n - 4)),
    edy: sign(at(n - 1) - at(n - 3)),
    ex: at(n - 2),
    ey: at(n - 1),
    lean: label.lean,
    nx: label.nx,
    ny: 0,
    room: label.room,
    sdx: -sign(at(2) - at(0)),
    sdy: -sign(at(3) - at(1)),
    sx: at(0),
    sy: at(1),
    x0: at(along),
    x1: at(along + 2),
    y0: at(along + 1),
    y1: at(along + 3),
    points,
  }
}

function across(lo: number, hi: number): number[] {
  const out: number[] = []
  const mid = midpoint(lo, hi)
  const step = fmax(LANE_STEP, (hi - lo) / 4)
  for (let k = 0; k < 9; k++) {
    const way = (k & 1) === 1 ? 1 : -1
    const at = mid + way * Math.ceil(k / 2) * step
    if (at >= lo + NEAR && at <= hi - NEAR) out.push(at)
  }
  return out
}

/** The best elbow so far. */
type Best = {
  cost: number
  points: number[]
  sides: [number, number]
  upright: boolean
}

/**
 * Considers `points` as an elbow from `a` to `b`, keeping it when it is clear and cheaper.
 * Returns the new best, or `undefined` when it was not kept.
 */
function consider(
  best: Best | undefined,
  points: number[],
  upright: boolean,
  sides: [number, number],
  boxes: Box[],
  others: number[],
  lanes: Lanes,
  ends: [number, number],
): Best | undefined {
  if (!clearOf(points, boxes, others, ends[0], ends[1])) return undefined
  for (let i = 0; i + 4 <= points.length; i += 2) {
    const px = points[i] as number
    const py = points[i + 1] as number
    const qx = points[i + 2] as number
    const qy = points[i + 3] as number
    const up = qx === px
    const free = up ? lanesFree(lanes, up, qx, py, qy) : lanesFree(lanes, up, qy, px, qx)
    if (!free) return undefined
  }
  let cost = lanesCrossings(lanes, points) * 1e6
  for (let i = 0; i + 4 <= points.length; i += 2) {
    const px = points[i] as number
    const py = points[i + 1] as number
    const qx = points[i + 2] as number
    const qy = points[i + 3] as number
    cost += Math.abs(qx - px) + Math.abs(qy - py)
  }
  if (best === undefined || cost < best.cost) return { cost, points, sides, upright }
  return undefined
}

function elbow(
  boxes: Box[],
  ids: [number, number],
  others: number[],
  lanes: Lanes,
  startTrim: number,
  endTrim: number,
): Route | undefined {
  const a = boxes[ids[0]] ?? boxDefault()
  const b = boxes[ids[1]] ?? boxDefault()
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  const bx = b.x + b.w / 2
  const by = b.y + b.h / 2
  let best: Best | undefined
  if (a.x + a.w <= b.x || b.x + b.w <= a.x) {
    const right = bx > ax
    const down = sign(by - ay)
    const sides: [number, number] = right ? [1, 0] : [0, 1]
    const lanesAcross = right ? across(a.x + a.w, b.x) : across(b.x + b.w, a.x)
    search: for (const y0 of lanesPorts(lanes, ids[0], sides[0], ay + (down * a.h) / 4, a.y + 8, a.y + a.h - 8)) {
      for (const y1 of lanesPorts(lanes, ids[1], sides[1], by - (down * b.h) / 4, b.y + 8, b.y + b.h - 8)) {
        for (const lane of lanesAcross) {
          const x0 = lane + (ax - lane) * fmin(hit(a, lane, y0, ax, y0), 1)
          const x1 = lane + (bx - lane) * fmin(hit(b, lane, y1, bx, y1), 1)
          const kept = consider(best, [x0, y0, lane, y0, lane, y1, x1, y1], true, sides, boxes, others, lanes, ids)
          if (kept !== undefined) {
            best = kept
            break search
          }
        }
      }
    }
  }
  if (a.y + a.h <= b.y || b.y + b.h <= a.y) {
    const below = by > ay
    const sideways = sign(bx - ax)
    const sides: [number, number] = below ? [3, 2] : [2, 3]
    const lanesAcross = below ? across(a.y + a.h, b.y) : across(b.y + b.h, a.y)
    search: for (const x0 of lanesPorts(
      lanes,
      ids[0],
      sides[0],
      ax + (sideways * a.w) / 4,
      a.x + 8,
      a.x + a.w - 8,
    )) {
      for (const x1 of lanesPorts(lanes, ids[1], sides[1], bx - (sideways * b.w) / 4, b.x + 8, b.x + b.w - 8)) {
        for (const lane of lanesAcross) {
          const y0 = lane + (ay - lane) * fmin(hit(a, x0, lane, x0, ay), 1)
          const y1 = lane + (by - lane) * fmin(hit(b, x1, lane, x1, by), 1)
          const kept = consider(best, [x0, y0, x0, lane, x1, lane, x1, y1], false, sides, boxes, others, lanes, ids)
          if (kept !== undefined) {
            best = kept
            break search
          }
        }
      }
    }
  }
  if (best === undefined) return undefined
  const points = best.points
  const at = (i: number): number => (i < points.length ? (points[i] as number) : Number.NaN)
  lanesTake(lanes, points)
  lanesClaim(lanes, ids[0], best.sides[0], best.upright ? at(1) : at(0))
  lanesClaim(lanes, ids[1], best.sides[1], best.upright ? at(7) : at(6))
  // The label sits on the middle stretch, across the gap.
  const room = best.upright ? NARROW : WIDE
  const label = bendDefault()
  label.room = room
  return bent(points, 2, startTrim, endTrim, label)
}

/** One side's detour around the shapes between a and b. */
type Detour = {
  p0: number
  p1: number
  points: number[]
  side: number
  /** How many lanes out it went. 5 when none was free. */
  step: number
}

/**
 * Routes a relation from `boxes[a]` to `boxes[b]`. `shift` moves the line sideways when another
 * runs the opposite way. `others` are the boxes to steer clear of, `undefined` to skip that
 * check. `lanes` holds what the routes before it take up, so that this one keeps apart from them.
 */
export function route(
  boxes: Box[],
  ids: [number, number],
  shift: number,
  others: number[] | undefined,
  lanes: Lanes,
  startTrim: number,
  endTrim: number,
): Route {
  const a = boxes[ids[0]] ?? boxDefault()
  const b = boxes[ids[1]] ?? boxDefault()
  if (ids[0] === ids[1]) {
    const spread = fmin(a.h / 2 - 4, 10)
    const len = hypot(LOOP, spread)
    const x = a.x + a.w
    const cy = a.y + a.h / 2
    const ux = LOOP / len
    const uy = spread / len
    const d: Buf = { s: 'M' }
    pushNum(d, x + ux * startTrim)
    d.s += ','
    pushNum(d, cy - spread - uy * startTrim)
    d.s += 'C'
    pushNum(d, x + LOOP)
    d.s += ','
    pushNum(d, cy - spread * 2)
    d.s += ' '
    pushNum(d, x + LOOP)
    d.s += ','
    pushNum(d, cy + spread * 2)
    d.s += ' '
    pushNum(d, x + ux * endTrim)
    d.s += ','
    pushNum(d, cy + spread + uy * endTrim)
    return {
      d: d.s,
      edx: -ux,
      edy: -uy,
      ex: x,
      ey: cy + spread,
      lean: 0,
      nx: 1,
      ny: 0,
      points: [],
      room: 64,
      sdx: -ux,
      sdy: uy,
      sx: x,
      sy: cy - spread,
      x0: x + LOOP + 4,
      x1: x + LOOP + 4,
      y0: cy,
      y1: cy,
    }
  }

  const [sx, sy, ex, ey] = connect(a, b, shift)
  const upright = sx === ex
  const level = sy === ey
  const isEnd = (other: number): boolean => other === ids[0] || other === ids[1]
  const inWay = (other: Box): boolean =>
    hitRect(other.x, other.y, other.x + other.w, other.y + other.h, sx, sy, ex - sx, ey - sy) <= 1
  let blocked = false
  if (others !== undefined && !contains(a, b) && !contains(b, a)) {
    for (const other of others) {
      const o = boxes[other]
      if (!isEnd(other) && o !== undefined && inWay(o)) {
        blocked = true
        break
      }
    }
  }
  if (others !== undefined && blocked && !upright && !level) {
    const around = elbow(boxes, ids, others, lanes, startTrim, endTrim)
    if (around !== undefined) return around
    lanes.squeezed += 1
  }
  if (others !== undefined && blocked && (upright || level)) {
    const laneOn = (forward: boolean): number => {
      let lane = forward ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
      const widen = (o: Box): void => {
        const edge = upright ? o.x : o.y
        lane = forward ? fmax(lane, edge + (upright ? o.w : o.h)) : fmin(lane, edge)
      }
      widen(a)
      widen(b)
      for (const other of others) {
        const o = boxes[other]
        if (o !== undefined && !isEnd(other) && inWay(o)) widen(o)
      }
      return lane
    }
    const lo = upright ? fmin(a.y, b.y) : fmin(a.x, b.x)
    const hi = upright ? fmax(a.y + a.h, b.y + b.h) : fmax(a.x + a.w, b.x + b.w)
    const outside = (forward: boolean, lane: number): boolean =>
      others.every((other) => {
        const o = boxes[other]
        if (o === undefined || isEnd(other)) return true
        const near = upright ? o.y < hi && o.y + o.h > lo : o.x < hi && o.x + o.w > lo
        const start = upright ? o.x : o.y
        const end = start + (upright ? o.w : o.h)
        return !(near && (forward ? end > lane : start < lane))
      })
    const ax = a.x + a.w / 2
    const ay = a.y + a.h / 2
    const bx = b.x + b.w / 2
    const by = b.y + b.h / 2
    const towards = upright ? sign(by - ay) : sign(bx - ax)
    // The route on one side: each end leaves its shape a quarter of the way from the middle
    // towards the other, clear of the straight lines that meet the middle of that side and
    // of other routes there. The lane runs a little further out for each route already
    // along that gap, and never behind a shape.
    const along = (lanes: Lanes, forward: boolean): Detour => {
      const lane = laneOn(forward)
      const way = forward ? 1 : -1
      const side = upright ? (forward ? 1 : 0) : forward ? 3 : 2
      const first = (list: number[], want: number): number => list[0] ?? want
      let p0: number
      if (upright) {
        const want = ay + (towards * a.h) / 4
        p0 = first(lanesPorts(lanes, ids[0], side, want, a.y + 8, a.y + a.h - 8), want)
      } else {
        const want = ax + (towards * a.w) / 4
        p0 = first(lanesPorts(lanes, ids[0], side, want, a.x + 8, a.x + a.w - 8), want)
      }
      let p1: number
      if (upright) {
        const want = by - (towards * b.h) / 4
        p1 = first(lanesPorts(lanes, ids[1], side, want, b.y + 8, b.y + b.h - 8), want)
      } else {
        const want = bx - (towards * b.w) / 4
        p1 = first(lanesPorts(lanes, ids[1], side, want, b.x + 8, b.x + b.w - 8), want)
      }
      const pointsAt = (at: number): number[] => {
        if (upright) {
          const x0 = at + (ax - at) * fmin(hit(a, at, p0, ax, p0), 1)
          const x1 = at + (bx - at) * fmin(hit(b, at, p1, bx, p1), 1)
          return [x0, p0, at, p0, at, p1, x1, p1]
        }
        const y0 = at + (ay - at) * fmin(hit(a, p0, at, p0, ay), 1)
        const y1 = at + (by - at) * fmin(hit(b, p1, at, p1, by), 1)
        return [p0, y0, p0, at, p1, at, p1, y1]
      }
      let points = pointsAt(lane + way * LANE)
      for (let k = 0; k <= 4; k++) {
        const at = lane + way * (LANE + k * LANE_STEP)
        const tried = pointsAt(at)
        if (!clearOf(tried, boxes, others, ids[0], ids[1])) continue
        points = tried
        if (lanesFree(lanes, upright, at, p0, p1)) return { p0, p1, points, side, step: k }
      }
      return { p0, p1, points, side, step: 5 }
    }
    // A detour takes the outside of the drawing when only one side is outside, leaving the
    // gaps between columns and rows to the relations that cross them. Otherwise it takes the
    // side where it crosses fewer lines, then the one where it runs nearer its shapes, so
    // that detours spread over both sides.
    const natural = upright ? ey > sy : ex < sx
    const out = outside(natural, laneOn(natural))
    const back = outside(!natural, laneOn(!natural))
    const first = along(lanes, natural)
    const other = out === back ? along(lanes, !natural) : undefined
    const cost = (way: Detour): number => lanesCrossings(lanes, way.points) * 8 + way.step
    const forward = (back && !out) || (other !== undefined && cost(other) < cost(first)) ? !natural : natural
    const chosen = forward === natural ? first : (other ?? along(lanes, !natural))
    const way = forward ? 1 : -1
    if (chosen.step > 4) lanes.squeezed += 1
    lanesTake(lanes, chosen.points)
    lanesClaim(lanes, ids[0], chosen.side, chosen.p0)
    lanesClaim(lanes, ids[1], chosen.side, chosen.p1)
    let label: Bend
    if (upright) {
      label = { lean: LEAN, nx: way, room: NARROW }
    } else {
      label = bendDefault()
      label.room = WIDE
    }
    return bent(chosen.points, 2, startTrim, endTrim, label)
  }

  const hyp = hypot(ex - sx, ey - sy)
  const len = hyp === 0 || Number.isNaN(hyp) ? 1 : hyp
  const dx = (ex - sx) / len
  const dy = (ey - sy) / len
  if (upright || level) lanesTake(lanes, [sx, sy, ex, ey])
  const d: Buf = { s: 'M' }
  pushNum(d, sx + dx * startTrim)
  d.s += ','
  pushNum(d, sy + dy * startTrim)
  d.s += 'L'
  pushNum(d, ex - dx * endTrim)
  d.s += ','
  pushNum(d, ey - dy * endTrim)
  return {
    d: d.s,
    edx: dx,
    edy: dy,
    ex,
    ey,
    lean: 0,
    nx: shift === 0 ? 0 : -dy,
    ny: shift === 0 ? 0 : dx,
    points: [sx, sy, ex, ey],
    room: Math.abs(dx) > Math.abs(dy) ? NARROW : WIDE,
    sdx: -dx,
    sdy: -dy,
    sx,
    sy,
    x0: sx,
    x1: ex,
    y0: sy,
    y1: ey,
  }
}
