/**
 * @module Edge paths, end markers, edge labels, and self-loops. Port of Pele's `src/svg/edges.ts`.
 *
 * Marker types are Mermaid's: `arrow_point`, `arrow_circle`, and `arrow_cross`. Any other type
 * draws nothing.
 */
import type { CEdge, CNode } from '../layout/compound.ts'
import { ease } from '../layout/layered.ts'
import { escText, labelSvg, num } from './builder.ts'
import type { IconResolver } from '../text/icons.ts'
import type { Label } from '../text/label.ts'
import { fmax, fmin, midpoint, signum } from '../util/rust.ts'

/** The length of an arrowhead. */
export const ARROW = 8.0

/** A drawn edge: its path, and where and which way it leaves and arrives, for its markers. */
export type EdgePath = {
  /** The path data. */
  d: string
  /** The x of the way the edge arrives. */
  edx: number
  /** The y of the way the edge arrives. */
  edy: number
  /** The x of the end, before trimming. */
  ex: number
  /** The y of the end, before trimming. */
  ey: number
  /** The x of the way back out of the start, for a marker there. */
  sdx: number
  /** The y of the way back out of the start, for a marker there. */
  sdy: number
  /** The x of the start, before trimming. */
  sx: number
  /** The y of the start, before trimming. */
  sy: number
}

/** `EdgePath::default()`: no path, everything zero. */
export function edgePathDefault(): EdgePath {
  return { d: '', edx: 0, edy: 0, ex: 0, ey: 0, sdx: 0, sdy: 0, sx: 0, sy: 0 }
}

/** The most a corner is rounded by in a stepped route. */
const CORNER = 12.0
/**
 * How far the handles of a wide turn reach along its two legs. A little more than a circle's,
 * which makes the turn fuller.
 */
const HANDLE = 0.62
/** How far an edge runs straight before a marker at its end, where it has the room. */
export const LEAD = 6.0

/** JavaScript's `Math.sign`: zero for zero and `NaN` for `NaN`. */
function jsSign(value: number): number {
  if (value === 0 || Number.isNaN(value)) return value
  return signum(value)
}

/** `Math.sign(value) || 1`: the sign, or 1 where there is none. */
function signOrOne(value: number): number {
  if (value === 0 || Number.isNaN(value)) return 1
  return signum(value)
}

/**
 * How far from each side of each node the edges that meet it start to turn: as far as the
 * largest marker there needs, for every edge on the side, so none turns sooner than its
 * neighbor and crosses it.
 */
export type SideReach = {
  /** The reach by `node * 4 + side`. */
  reach: Map<number, number>
}

/** `SideReach::default()`. */
export function sideReachDefault(): SideReach {
  return { reach: new Map() }
}

/** Records an end with a marker of `type` on `side` of `node`. A side below 0 is none. */
export function sideReachAdd(self: SideReach, node: number, side: number, type: string): void {
  const trim = markerTrim(type)
  if (side < 0) return
  const key = node * 4 + side
  if (trim > 0 && trim + LEAD > (self.reach.get(key) ?? 0)) {
    self.reach.set(key, trim + LEAD)
  }
}

/** How far from `side` of `node` its edges start to turn. */
export function sideReachOf(self: SideReach, node: number, side: number): number {
  if (side < 0) return 0
  return self.reach.get(node * 4 + side) ?? 0
}

/**
 * A route's points as {@link routePath} reshapes them: the x, y, and axis (0 entered vertically,
 * 1 horizontally) of each point, in scratch arrays reused from call to call. `routePath` calls
 * nothing that comes back to it, so one set serves every call. Routes too long for the largest
 * size kept get arrays of their own.
 */
let routeXs = new Float64Array(64)
let routeYs = new Float64Array(64)
let routeAxes = new Float64Array(64)

/** The most points the scratch arrays of {@link routePath} grow to hold. */
const ROUTE_SCRATCH_MAX = 1 << 14

/** The element at `i` of the first `n`, or `NaN` past the ends, as JavaScript reads an absent element. */
function getOrNaN(items: Float64Array, n: number, i: number): number {
  return i >= 0 && i < n ? (items[i] as number) : Number.NaN
}

/** Whether points `i - 1` and `i` are in line. */
function pointsAligned(xs: Float64Array, ys: Float64Array, n: number, i: number): boolean {
  const j = i - 1
  return (
    Math.abs(getOrNaN(xs, n, i) - getOrNaN(xs, n, j)) < 0.01 ||
    Math.abs(getOrNaN(ys, n, i) - getOrNaN(ys, n, j)) < 0.01
  )
}

/** The way {@link pointsUnit} found, across and along. */
let unitX = 0
let unitY = 0

/**
 * The way the route heads from point `i` to point `j`, into {@link unitX} and {@link unitY}:
 * along the flow where an S joins them.
 */
function pointsUnit(
  xs: Float64Array,
  ys: Float64Array,
  n: number,
  linear: boolean,
  i: number,
  j: number,
  axis: number,
): void {
  // NOTE: Rust's `i.max(j)` over a wrapped `usize::MAX` picks the other index than `Math.max`
  // over -1 does, but both points lie past the ends, so `straight` reads the same.
  if (!(linear || pointsAligned(xs, ys, n, Math.max(i, j)))) {
    if (axis === 0) {
      unitX = 0
      unitY = signOrOne(getOrNaN(ys, n, j) - getOrNaN(ys, n, i))
    } else {
      unitX = signOrOne(getOrNaN(xs, n, j) - getOrNaN(xs, n, i))
      unitY = 0
    }
    return
  }
  const dx = getOrNaN(xs, n, j) - getOrNaN(xs, n, i)
  const dy = getOrNaN(ys, n, j) - getOrNaN(ys, n, i)
  let len = Math.hypot(dx, dy)
  len = len === 0 || Number.isNaN(len) ? 1 : len
  unitX = dx / len
  unitY = dy / len
}

/** The length of the leg into point `i`, along both axes. */
function pointsLength(xs: Float64Array, ys: Float64Array, n: number, i: number): number {
  const j = i - 1
  return Math.abs(getOrNaN(xs, n, i) - getOrNaN(xs, n, j)) + Math.abs(getOrNaN(ys, n, i) - getOrNaN(ys, n, j))
}

/** Whether the route turns a corner at point `i`, from running one way to running the other. */
function pointsTurns(xs: Float64Array, ys: Float64Array, n: number, linear: boolean, i: number, last: number): boolean {
  const j = i - 1
  return (
    !linear &&
    i > 0 &&
    i < last &&
    pointsAligned(xs, ys, n, i) &&
    pointsAligned(xs, ys, n, i + 1) &&
    pointsLength(xs, ys, n, i) >= 0.01 &&
    pointsLength(xs, ys, n, i + 1) >= 0.01 &&
    Math.abs(getOrNaN(xs, n, i) - getOrNaN(xs, n, j)) < 0.01 !==
      Math.abs(getOrNaN(xs, n, i + 1) - getOrNaN(xs, n, i)) < 0.01
  )
}

/** How far the leg into point `i` runs along (`ux`, `uy`). */
function pointsAlong(xs: Float64Array, ys: Float64Array, n: number, i: number, ux: number, uy: number): number {
  const j = i - 1
  return (
    Math.abs(getOrNaN(xs, n, i) - getOrNaN(xs, n, j)) * Math.abs(ux) +
    Math.abs(getOrNaN(ys, n, i) - getOrNaN(ys, n, j)) * Math.abs(uy)
  )
}

/** Whether two points are within a hundredth of each other on both axes. */
function near(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01
}

/**
 * Of the way from the end of a run to where it turns, the part that makes up for a larger marker
 * beside this one is kept where it can be, and the rest is at most a quarter of what is left, so
 * ends on one side of a node turn equally far from it.
 */
function lead(reach: number, trim: number, run: number): number {
  const room = jsMin(jsMax(0, reach - LEAD - trim), run / 4)
  return room + jsMin(reach - trim - room, (run - room) / 4)
}

/** JavaScript's two-argument `Math.min`, which passes `NaN` on. */
function jsMin(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return fmin(a, b)
}

/** JavaScript's two-argument `Math.max`, which passes `NaN` on. */
function jsMax(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return fmax(a, b)
}

/** `x,y`. */
function point(x: number, y: number): string {
  return num(x) + ',' + num(y)
}

/** Inserts `value` at `at` of the first `n` items, as `splice(at, 0, value)` does. */
function insert(items: Float64Array, n: number, at: number, value: number): void {
  for (let i = n; i > at; i--) items[i] = items[i - 1] as number
  items[at] = value
}

/**
 * Builds the path for a route of `x, y, axis` triples, trimming both ends to leave room for
 * markers.
 *
 * Between two points that are not in line, a route is one S that leaves and arrives along the
 * flow, or a step in a stepped route. Where the route itself turns a corner, a stepped route
 * rounds it a little, and any other but a linear one turns as widely as it can: the turn takes
 * the whole of a leg that ends at a node and half of a leg it shares with the next turn.
 * `startReach` and `endReach` say how far from its nodes the edge starts to turn, where the
 * other edges on the same side of a node need it to. By default, far enough to clear its own
 * marker.
 */
export function routePath(
  route: number[],
  curve: string | undefined,
  startTrim: number,
  endTrim: number,
  startReach: number | undefined,
  endReach: number | undefined,
): EdgePath {
  startReach = startReach ?? (startTrim > 0 ? startTrim + LEAD : 0)
  endReach = endReach ?? (endTrim > 0 ? endTrim + LEAD : 0)
  const linear = curve === 'linear'
  const stepped = curve === 'step' || curve === 'stepBefore' || curve === 'stepAfter'
  const rlen = route.length
  // Each triple gives a point, a stepped one up to two more turns, and the leads two more.
  const cap = Math.ceil(rlen / 3) * (stepped ? 3 : 1) + 2
  let xs = routeXs
  let ys = routeYs
  let axes = routeAxes
  if (cap > xs.length) {
    if (cap <= ROUTE_SCRATCH_MAX) {
      let size = xs.length
      while (size < cap) size *= 2
      routeXs = new Float64Array(size)
      routeYs = new Float64Array(size)
      routeAxes = new Float64Array(size)
      xs = routeXs
      ys = routeYs
      axes = routeAxes
    } else {
      xs = new Float64Array(cap)
      ys = new Float64Array(cap)
      axes = new Float64Array(cap)
    }
  }
  let n = 0
  for (let i = 0; i < rlen; i += 3) {
    const x = route[i] as number
    const y = i + 1 < rlen ? (route[i + 1] as number) : Number.NaN
    const axis = i + 2 < rlen ? (route[i + 2] as number) : Number.NaN
    // A stepped route turns at right angles where a smooth one would curve.
    if (stepped && n > 0) {
      const px = xs[n - 1] as number
      const py = ys[n - 1] as number
      if (Math.abs(x - px) >= 0.01 && Math.abs(y - py) >= 0.01) {
        let mx: number
        let my: number
        if (curve === 'stepBefore') {
          mx = px
          my = py
        } else if (curve === 'stepAfter') {
          mx = x
          my = y
        } else {
          mx = midpoint(px, x)
          my = midpoint(py, y)
        }
        const t0x = axis === 0 ? px : mx
        const t0y = axis === 0 ? my : py
        const t1x = axis === 0 ? x : mx
        const t1y = axis === 0 ? my : y
        if (!(near(t0x, t0y, px, py) || near(t0x, t0y, x, y))) {
          xs[n] = t0x
          ys[n] = t0y
          axes[n] = axis
          n += 1
        }
        if (!(near(t1x, t1y, px, py) || near(t1x, t1y, x, y))) {
          xs[n] = t1x
          ys[n] = t1y
          axes[n] = axis
          n += 1
        }
      }
    }
    xs[n] = x
    ys[n] = y
    axes[n] = axis
    n += 1
  }

  // An empty route has no path. Pele would write `NaN` coordinates.
  if (n === 0) return edgePathDefault()
  let last = n - 1
  pointsUnit(xs, ys, n, linear, 0, 1, getOrNaN(axes, n, 1))
  const sdx = unitX
  const sdy = unitY
  pointsUnit(xs, ys, n, linear, last - 1, last, getOrNaN(axes, n, last))
  const edx = unitX
  const edy = unitY
  const sx = xs[0] as number
  const sy = ys[0] as number
  const ex = xs[last] as number
  const ey = ys[last] as number
  xs[0] = sx + sdx * startTrim
  ys[0] = sy + sdy * startTrim
  xs[last] = (xs[last] as number) - edx * endTrim
  ys[last] = (ys[last] as number) - edy * endTrim

  // An edge that curves into a marker runs straight for a little way first, where it has the
  // room, so the marker does not sit on the bend.
  const arrives =
    endReach > endTrim &&
    (!(linear || pointsAligned(xs, ys, n, last)) || pointsTurns(xs, ys, n, linear, last - 1, last))
      ? lead(endReach, endTrim, pointsAlong(xs, ys, n, last, edx, edy))
      : 0
  const leaves =
    startReach > startTrim &&
    (!(linear || pointsAligned(xs, ys, n, 1)) || pointsTurns(xs, ys, n, linear, 1, last))
      ? lead(startReach, startTrim, pointsAlong(xs, ys, n, 1, sdx, sdy))
      : 0
  if (arrives >= 1) {
    const x = (xs[last] as number) - edx * arrives
    const y = (ys[last] as number) - edy * arrives
    const axis = axes[last] as number
    insert(xs, n, last, x)
    insert(ys, n, last, y)
    insert(axes, n, last, axis)
    n += 1
    last += 1
  }
  if (leaves >= 1) {
    const x = (xs[0] as number) + sdx * leaves
    const y = (ys[0] as number) + sdy * leaves
    const axis = getOrNaN(axes, n, 1)
    insert(xs, n, 1, x)
    insert(ys, n, 1, y)
    insert(axes, n, 1, axis)
    n += 1
    last += 1
  }

  let atX = xs[0] as number
  let atY = ys[0] as number
  let d = 'M' + num(atX) + ',' + num(atY)
  for (let i = 1; i <= last; i++) {
    const x = xs[i] as number
    const y = ys[i] as number
    if (!(linear || pointsAligned(xs, ys, n, i))) {
      const down = axes[i] === 0
      const along = down ? y - atY : x - atX
      const k = Math.abs(along) * ease(down ? x - atX : y - atY, along)
      const ux = down ? 0 : jsSign(along) * k
      const uy = down ? jsSign(along) * k : 0
      d +=
        'C' +
        num(atX + ux) +
        ',' +
        num(atY + uy) +
        ' ' +
        num(x - ux) +
        ',' +
        num(y - uy) +
        ' ' +
        num(x) +
        ',' +
        num(y)
      atX = x
      atY = y
      continue
    }
    if (!pointsTurns(xs, ys, n, linear, i, last)) {
      // A point part of the way along one straight run adds nothing to the path.
      if (
        i < last &&
        pointsAligned(xs, ys, n, i) &&
        pointsAligned(xs, ys, n, i + 1) &&
        (x - (xs[i - 1] as number)) * ((xs[i + 1] as number) - x) +
          (y - (ys[i - 1] as number)) * ((ys[i + 1] as number) - y) >
          0
      ) {
        continue
      }
      if (!near(x, y, atX, atY)) {
        d += 'L' + num(x) + ',' + num(y)
        atX = x
        atY = y
      }
      continue
    }

    // How much of the leg before the turn and of the leg after it the turn takes: all of one
    // that ends at a node, short of the straight run into a marker, and half of one it shares.
    let before = pointsTurns(xs, ys, n, linear, i - 1, last)
      ? pointsLength(xs, ys, n, i) / 2
      : pointsLength(xs, ys, n, i)
    let after = pointsTurns(xs, ys, n, linear, i + 1, last)
      ? pointsLength(xs, ys, n, i + 1) / 2
      : pointsLength(xs, ys, n, i + 1)
    if (stepped) {
      before = fmin(fmin(CORNER, before), after)
      after = before
    }
    pointsUnit(xs, ys, n, linear, i - 1, i, axes[i] as number)
    const ux = unitX
    const uy = unitY
    pointsUnit(xs, ys, n, linear, i, i + 1, getOrNaN(axes, n, i + 1))
    const vx = unitX
    const vy = unitY
    const lx = x - ux * before
    const ly = y - uy * before
    if (!near(lx, ly, atX, atY)) {
      d += 'L' + num(lx) + ',' + num(ly)
      atX = lx
      atY = ly
    }
    atX = x + vx * after
    atY = y + vy * after
    if (stepped) {
      d += 'Q' + num(x) + ',' + num(y) + ' ' + num(atX) + ',' + num(atY)
    } else {
      d +=
        'C' +
        num(x - ux * before * (1 - HANDLE)) +
        ',' +
        num(y - uy * before * (1 - HANDLE)) +
        ' ' +
        num(x + vx * after * (1 - HANDLE)) +
        ',' +
        num(y + vy * after * (1 - HANDLE)) +
        ' ' +
        num(atX) +
        ',' +
        num(atY)
    }
  }
  return {
    d,
    edx,
    edy,
    ex,
    ey,
    sdx: -sdx,
    sdy: -sdy,
    sx,
    sy,
  }
}

/** How far a marker of `type` trims the end of its edge. */
export function markerTrim(type: string): number {
  switch (type) {
    case 'arrow_point':
      return ARROW - 1
    case 'arrow_circle':
      return ARROW
    case 'arrow_cross':
      return 4
    default:
      return 0
  }
}

/**
 * Draws a marker of `type` whose tip is at (`x`, `y`), pointing along (`dx`, `dy`), filled with
 * `color` as written.
 */
export function marker(type: string, x: number, y: number, dx: number, dy: number, color: string): string {
  const nx = -dy
  const ny = dx
  switch (type) {
    case 'arrow_point': {
      const bx = x - dx * ARROW
      const by = y - dy * ARROW
      const half = ARROW * 0.42
      return `<path class="ondine-marker" d="M${point(x, y)}L${point(bx + nx * half, by + ny * half)}L${point(bx - nx * half, by - ny * half)}Z" fill="${color}" stroke="none"/>`
    }
    case 'arrow_circle':
      return `<circle class="ondine-marker" cx="${num(x - dx * 4)}" cy="${num(y - dy * 4)}" r="3.5" fill="${color}" stroke="none"/>`
    case 'arrow_cross': {
      const cx = x - dx * 4
      const cy = y - dy * 4
      const a = 3.5
      const ux = (dx + nx) * a
      const uy = (dy + ny) * a
      const vx = (dx - nx) * a
      const vy = (dy - ny) * a
      return `<path class="ondine-marker" d="M${point(cx - ux, cy - uy)}L${point(cx + ux, cy + uy)}M${point(cx - vx, cy - vy)}L${point(cx + vx, cy + vy)}"/>`
    }
    default:
      return ''
  }
}

/**
 * An edge label centered on (`x`, `y`) on a patch of the background, so the line does not run
 * through the text.
 */
export function edgeLabelSvg(
  id: string,
  label: Label,
  x: number,
  y: number,
  attrs: string,
  icons: IconResolver | undefined,
): string {
  const w = label.width + 8
  const h = label.height
  return `<g class="ondine-edge-label" data-id="${escText(id)}"><rect x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${num(w)}" height="${num(h)}" rx="3" fill="var(--_bg)"/>${labelSvg(label, x, y, attrs, icons)}</g>`
}

/**
 * A self-loop beside node `c` of drawn size `w` by `h`: out of the side that lies across the
 * flow and back in. `k` counts the loops already on the node, so each one reaches a little
 * further than `base`. `trim` leaves room for the end marker. Also places the edge's label
 * beyond the loop.
 */
export function loopPath(
  c: CNode,
  w: number,
  h: number,
  k: number,
  sideways: boolean,
  base: number,
  trim: number,
  e: CEdge,
): EdgePath {
  const half = (sideways ? w : h) / 2
  const spread = fmin(half - 4, 8 + k * 6)
  const reach = base + k * 8
  let len = Math.hypot(reach, spread)
  len = len === 0 || Number.isNaN(len) ? 1 : len
  // Local frame: `out` points away from the node, `along` runs along its side.
  const at = (out: number, along: number): string => {
    if (sideways) {
      return point(c.x + along, c.y + h / 2 + out)
    } else {
      return point(c.x + w / 2 + out, c.y + along)
    }
  }
  const tx = (reach / len) * trim
  const ty = (spread / len) * trim
  if (sideways) {
    e.labelX = c.x
    e.labelY = c.y + h / 2 + reach + 4 + e.labelH / 2
  } else {
    e.labelX = c.x + w / 2 + reach + 4 + e.labelW / 2
    e.labelY = c.y
  }

  const d = `M${at(0, -spread)}C${at(reach, -spread * 2)} ${at(reach, spread * 2)} ${at(tx, spread + ty)}`
  return {
    d,
    edx: sideways ? -spread / len : -reach / len,
    edy: sideways ? -reach / len : -spread / len,
    ex: sideways ? c.x + spread : c.x + w / 2,
    ey: sideways ? c.y + h / 2 : c.y + spread,
    sdx: sideways ? 0 : -1,
    sdy: sideways ? -1 : 0,
    sx: sideways ? c.x - spread : c.x + w / 2,
    sy: sideways ? c.y + h / 2 : c.y - spread,
  }
}
