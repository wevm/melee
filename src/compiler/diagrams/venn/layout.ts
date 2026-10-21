/**
 * @module Places venn circles and finds room for labels in their regions. Port of Pele's
 * `src/diagrams/venn/layout.ts`.
 *
 * Output depends on the last bit of these computations, so `hypot` is V8's, and the trigonometric
 * functions are the fdlibm ones that both V8 and Rust's WebAssembly math use.
 */
import { utf16Cmp } from './db.ts'
import type { VennSubset } from './types.ts'
import { pushNum } from '../../svg/builder.ts'
import { type Buf, buf, midpoint, partialCmp } from '../../util/rust.ts'

const PI = Math.PI
const TAU = 2 * Math.PI
const FRAC_PI_2 = Math.PI / 2

/** A circle for one set. */
export type Circle = {
  /** The set's id. */
  id: string
  /** Radius. */
  r: number
  /** Center x. */
  x: number
  /** Center y. */
  y: number
}

/** `Circle::default()`. */
export function circleDefault(): Circle {
  return { id: '', r: 0, x: 0, y: 0 }
}

/**
 * Where the content of a region goes: the point inside all of `inside` and outside every other
 * circle that is farthest from their outlines, and how far that is. A margin of 0 or less means
 * the circles as placed leave the region empty.
 */
export type Spot = {
  /** Distance to the nearest outline. */
  margin: number
  /** x. */
  x: number
  /** y. */
  y: number
}

/** `Spot::default()`. */
export function spotDefault(): Spot {
  return { margin: 0, x: 0, y: 0 }
}

/**
 * V8's `Math.hypot` for two values: a compensated sum of squares scaled by the larger value. It
 * differs from `f64::hypot` in the last bit.
 */
export function hypot(x: number, y: number): number {
  x = Math.abs(x)
  y = Math.abs(y)
  if (x === Number.POSITIVE_INFINITY || y === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  const max = y > x ? y : x
  if (max === 0) return 0

  // The compensated sum over `[x, y]`: the first square adds to 0 exactly and leaves no
  // compensation, so the sum is the plain sum of the two squares.
  const a = x / max
  const b = y / max
  return Math.sqrt(a * a + b * b) * max
}

/** `Math.min` and `Math.max`, which return `NaN` when either value is. */
function jsMin(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return b < a ? b : a
}

function jsMax(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return b > a ? b : a
}

/** A key for a list of ids. */
function listKey(ids: readonly string[]): string {
  return JSON.stringify(ids)
}

/**
 * For every overlap of three or more sets, adds the pairwise overlaps it implies and the diagram
 * does not state, a quarter of the smaller set each, so that the circles are drawn overlapping.
 */
export function ensurePairwiseSubsets(subsets: readonly VennSubset[]): VennSubset[] {
  const present = new Set<string>()
  const sizes = new Map<string, number>()
  for (const subset of subsets) {
    const sorted = subset.sets.slice()
    sorted.sort(utf16Cmp)
    present.add(listKey(sorted))
    if (subset.sets.length === 1) sizes.set(subset.sets[0] as string, subset.size)
  }
  const out = subsets.slice()
  for (const subset of subsets) {
    if (subset.sets.length < 3) continue
    const members = subset.sets.slice()
    members.sort(utf16Cmp)
    for (let i = 0; i < members.length; i++) {
      const first = members[i] as string
      for (let j = i + 1; j < members.length; j++) {
        const second = members[j] as string
        const pair = [first, second]
        const key = listKey(pair)
        if (present.has(key)) continue
        present.add(key)
        const a = sizes.get(first)
        const b = sizes.get(second)
        const size = a !== undefined && b !== undefined ? jsMin(a, b) / 4.0 : 2.5
        out.push({ label: '', sets: pair, size })
      }
    }
  }
  return out
}

/** The area two circles share when their centers are `d` apart. */
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0
  const small = jsMin(r1, r2)
  if (d <= Math.abs(r1 - r2)) return PI * small * small
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1))
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2))
  const a3 = 0.5 * Math.sqrt(jsMax((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0.0))
  return a1 + a2 - a3
}

/**
 * How far apart two circles sit for their overlap to have the given area. The area falls as the
 * distance grows, so bisection finds it.
 */
export function distanceForOverlap(r1: number, r2: number, area: number): number {
  let low = Math.abs(r1 - r2)
  let high = r1 + r2
  if (!(area > 0.0)) return high
  const small = jsMin(r1, r2)
  if (area >= PI * (small * small)) return low
  for (let round = 0; round < 48; round++) {
    const middle = midpoint(low, high)
    if (lensArea(r1, r2, middle) > area) low = middle
    else high = middle
  }
  return midpoint(low, high)
}

/**
 * How far a point is from the nearest outline it must stay within or without. Gives up, with some
 * value below `floor`, as soon as the point cannot reach `floor`. `data` holds `x, y, r` for each
 * circle, the first `insideEnd / 3` of them the ones to stay within.
 */
function margin(data: Float64Array, insideEnd: number, x: number, y: number, floor: number): number {
  let best = Number.POSITIVE_INFINITY
  let k = 0
  for (; k < insideEnd; k += 3) {
    const dx = x - data[k]
    const dy = y - data[k + 1]
    const room = data[k + 2] - Math.sqrt(dx * dx + dy * dy)
    if (room < best) {
      if (room < floor) return room
      best = room
    }
  }
  const end = data.length
  for (; k < end; k += 3) {
    const dx = x - data[k]
    const dy = y - data[k + 1]
    const room = Math.sqrt(dx * dx + dy * dy) - data[k + 2]
    if (room < best) {
      if (room < floor) return room
      best = room
    }
  }
  return best
}

/** The directions of the uphill walk in {@link findSpot}: `k * TAU / 8` for `k` in `0..8`. */
const WALK_COS = new Float64Array(8)
const WALK_SIN = new Float64Array(8)
for (let k = 0; k < 8; k++) {
  const angle = (k * TAU) / 8.0
  WALK_COS[k] = Math.cos(angle)
  WALK_SIN[k] = Math.sin(angle)
}

/**
 * Finds the roomiest point of a region by sampling the smallest of its circles on a grid and then
 * walking uphill from the best sample. Ties go to the point nearest the middle of the region, so a
 * symmetric arrangement gets symmetric labels.
 */
export function findSpot(circles: readonly Circle[], inside: readonly number[], outside: readonly number[]): Spot {
  const GRID = 10

  const count = inside.length
  let cx = 0
  let cy = 0
  const firstIndex = inside[0]
  let smallest = firstIndex === undefined ? undefined : circles[firstIndex]
  if (smallest === undefined) return spotDefault()
  let used = 0
  for (const i of inside) {
    const c = circles[i]
    if (c === undefined) continue
    used++
    cx += c.x / count
    cy += c.y / count
    if (c.r < smallest.r) smallest = c
  }
  const insideEnd = used * 3
  for (const i of outside) if (circles[i] !== undefined) used++
  const data = new Float64Array(used * 3)
  let k = 0
  for (const i of inside) {
    const c = circles[i]
    if (c === undefined) continue
    data[k] = c.x
    data[k + 1] = c.y
    data[k + 2] = c.r
    k += 3
  }
  for (const i of outside) {
    const c = circles[i]
    if (c === undefined) continue
    data[k] = c.x
    data[k + 1] = c.y
    data[k + 2] = c.r
    k += 3
  }
  const r = smallest.r
  const sx = smallest.x
  const sy = smallest.y
  const slack = r * 1e-9
  let x = cx
  let y = cy
  let best = margin(data, insideEnd, x, y, Number.NEGATIVE_INFINITY)
  let off = 0
  for (let gy = -GRID; gy <= GRID; gy++) {
    for (let gx = -GRID; gx <= GRID; gx++) {
      if (gx * gx + gy * gy <= GRID * GRID) {
        const px = sx + (gx * r) / GRID
        const py = sy + (gy * r) / GRID
        const m = margin(data, insideEnd, px, py, best - slack)
        if (!(m > best - slack)) continue
        const distance = hypot(px - cx, py - cy)
        if (m > best + slack || distance < off - slack) {
          best = m
          off = distance
          x = px
          y = py
        }
      }
    }
  }
  let step = r / GRID
  let round = 0
  while (round < 40 && step > r * 1e-6) {
    let moved = false
    for (let k = 0; k < 8; k++) {
      // The walk starts from where the previous direction left it.
      const px = x + WALK_COS[k] * step
      const py = y + WALK_SIN[k] * step
      const m = margin(data, insideEnd, px, py, best - slack)
      if (!(m > best - slack)) continue
      const distance = hypot(px - cx, py - cy)
      if (m > best + slack || distance < off - slack) {
        best = m
        off = distance
        x = px
        y = py
        moved = true
      }
    }
    if (!moved) step /= 2.0
    round += 1
  }
  return { margin: best, x, y }
}

/**
 * Places one circle per set, with areas in proportion to the sizes of the sets and each pair as
 * far apart as its overlap asks: one, two and three sets exactly, more by relaxing a ring of
 * circles toward those distances. Lengths are in units of the square root of a size.
 */
export function layoutCircles(subsets: readonly VennSubset[]): Circle[] {
  const sizes: [string, number][] = []
  const sizeIndex = new Map<string, number>()
  for (const subset of subsets) {
    for (const id of subset.sets) {
      if (!sizeIndex.has(id)) {
        sizeIndex.set(id, sizes.length)
        sizes.push([id, 10.0])
      }
    }
  }
  for (const subset of subsets) {
    if (subset.sets.length === 1) {
      const at = sizeIndex.get(subset.sets[0] as string)
      const entry = at === undefined ? undefined : sizes[at]
      if (entry !== undefined) entry[1] = subset.size
    }
  }

  let largest = 0.0
  for (const [, size] of sizes) {
    if (Number.isFinite(size) && size > largest) largest = size
  }
  if (largest === 0.0) largest = 10.0
  const widest = Math.sqrt(largest / PI)
  const circles: Circle[] = sizes.map(([id, size]) => {
    // A set too small to hold its name, or with no size at all, still gets a circle that shows.
    const r = Number.isFinite(size) && size > 0.0 ? Math.sqrt(size / PI) : 0.0
    return { id, r: jsMax(r, widest * 0.3), x: 0.0, y: 0.0 }
  })
  const n = circles.length
  if (n < 2) return circles

  // The overlap each pair was given, by the indexes of its circles.
  const overlaps = new Map<number, number>()
  for (const subset of ensurePairwiseSubsets(subsets)) {
    if (subset.sets.length !== 2) continue
    const a = sizeIndex.get(subset.sets[0] as string)
    const b = sizeIndex.get(subset.sets[1] as string)
    if (a === undefined || b === undefined) continue
    if (a !== b) overlaps.set(Math.min(a, b) * n + Math.max(a, b), subset.size)
  }
  // How far apart each overlapping pair should be. Pairs that do not overlap only have to keep a
  // gap.
  const radius = (circles: readonly Circle[], i: number): number => circles[i]?.r ?? 0.0
  const wanted = new Map<number, number>()
  for (const [key, area] of overlaps) {
    const d = distanceForOverlap(radius(circles, Math.trunc(key / n)), radius(circles, key % n), area)
    wanted.set(key, d)
  }
  const gap = widest * 0.15
  const distance = (circles: readonly Circle[], a: number, b: number): number =>
    wanted.get(a * n + b) ?? radius(circles, a) + radius(circles, b) + gap

  if (n === 2) {
    const d = distance(circles, 0, 1)
    const c = circles[1]
    if (c !== undefined) c.x = d
    return circles
  }

  if (n === 3) {
    // Two sets side by side and the third below, the corners of a triangle whose sides are the
    // three distances. An overlap of all three has to exist, so the triangle shrinks until it
    // does.
    let ab = distance(circles, 0, 1)
    let ac = distance(circles, 0, 2)
    let bc = distance(circles, 1, 2)
    const triple = subsets.some((subset) => new Set(subset.sets).size === 3)
    for (let round = 0; round < 40; round++) {
      const x = ab > 0.0 ? (ab * ab + ac * ac - bc * bc) / (2.0 * ab) : 0.0
      const c1 = circles[1]
      if (c1 !== undefined) c1.x = ab
      const c2 = circles[2]
      if (c2 !== undefined) {
        c2.x = jsMax(-ac, jsMin(ac, x))
        c2.y = Math.sqrt(jsMax(ac * ac - x * x, 0.0))
      }
      if (!triple || findSpot(circles, [0, 1, 2], []).margin > widest * 0.12) break
      ab *= 0.94
      ac *= 0.94
      bc *= 0.94
    }
    return circles
  }

  let total = 0.0
  for (const c of circles) total += 2.0 * c.r + gap
  const rounds = jsMin(300.0, Math.floor(3e6 / (n * n)))
  if (n <= 64) {
    const ring = total / TAU
    for (let i = 0; i < n; i++) {
      const c = circles[i] as Circle
      const angle = (i * TAU) / n - FRAC_PI_2
      c.x = Math.cos(angle) * ring
      c.y = Math.sin(angle) * ring
    }
  } else {
    const columns = Math.ceil(Math.sqrt(n))
    const cell = 2.0 * widest + gap
    for (let i = 0; i < n; i++) {
      const c = circles[i] as Circle
      c.x = (i % columns) * cell
      c.y = Math.floor(i / columns) * cell
    }
  }
  // The wanted distances by `a * n + b`, `has` marking the pairs that have one.
  const want = new Float64Array(n * n)
  const has = new Uint8Array(n * n)
  for (const [key, d] of wanted) {
    want[key] = d
    has[key] = 1
  }
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const rs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const c = circles[i] as Circle
    xs[i] = c.x
    ys[i] = c.y
    rs[i] = c.r
  }
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const pulls = new Float64Array(n)
  let round = 0.0
  while (round < rounds) {
    dx.fill(0.0)
    dy.fill(0.0)
    pulls.fill(0)
    for (let a = 0; a < n; a++) {
      const ax = xs[a]
      const ay = ys[a]
      const ar = rs[a]
      const row = a * n
      for (let b = a + 1; b < n; b++) {
        const known = has[row + b] === 1
        const apart = ar + rs[b] + gap
        let ux = xs[b] - ax
        let uy = ys[b] - ay
        let length = hypot(ux, uy)
        if (!known && length >= apart) continue
        if (length < 1e-9) {
          ux = Math.cos(a + b)
          uy = Math.sin(a + b)
          length = 1.0
        }
        const shift = (length - (known ? want[row + b] : apart)) / 2.0 / length
        dx[a] += ux * shift
        dy[a] += uy * shift
        dx[b] -= ux * shift
        dy[b] -= uy * shift
        pulls[a] += 1
        pulls[b] += 1
      }
    }
    for (let i = 0; i < n; i++) {
      const pull = pulls[i]
      if (pull === 0) continue
      xs[i] += dx[i] / pull
      ys[i] += dy[i] / pull
    }
    round += 1.0
  }
  for (let i = 0; i < n; i++) {
    const c = circles[i] as Circle
    c.x = xs[i]
    c.y = ys[i]
  }
  return circles
}

/** A point where two outlines cross, and the circles that cross there, by index. */
type Corner = {
  a: number
  b: number
  x: number
  y: number
}

function pushPoint(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

/** The outline of a whole circle. */
function whole(c: Circle): string {
  const d = buf('M')
  pushPoint(d, c.x - c.r, c.y)
  d.s += 'A'
  pushPoint(d, c.r, c.r)
  d.s += ' 0 1 1 '
  pushPoint(d, c.x + c.r, c.y)
  d.s += 'A'
  pushPoint(d, c.r, c.r)
  d.s += ' 0 1 1 '
  pushPoint(d, c.x - c.r, c.y)
  d.s += 'Z'
  return d.s
}

/**
 * The outline of the region all the given circles share, as an SVG path, or empty if they share
 * none.
 */
export function regionPath(circles: readonly Circle[]): string {
  if (circles.length === 1) return whole(circles[0] as Circle)
  const within = (x: number, y: number, skip: number, other: number): boolean =>
    circles.every((c, i) => i === skip || i === other || !(hypot(x - c.x, y - c.y) > c.r * (1.0 + 1e-9)))
  // The corners of the region: where two outlines cross inside all the other circles.
  const corners: Corner[] = []
  for (let i = 0; i < circles.length; i++) {
    const a = circles[i] as Circle
    for (let j = i + 1; j < circles.length; j++) {
      const b = circles[j] as Circle
      const d = hypot(b.x - a.x, b.y - a.y)
      if (d >= a.r + b.r || d <= Math.abs(a.r - b.r) || d === 0.0) continue
      const along = (a.r * a.r - b.r * b.r + d * d) / (2.0 * d)
      const up = Math.sqrt(jsMax(a.r * a.r - along * along, 0.0))
      const mx = a.x + ((b.x - a.x) * along) / d
      const my = a.y + ((b.y - a.y) * along) / d
      for (const sign of [1.0, -1.0]) {
        const x = mx + (sign * up * (b.y - a.y)) / d
        const y = my - (sign * up * (b.x - a.x)) / d
        if (within(x, y, i, j)) corners.push({ a: i, b: j, x, y })
      }
    }
  }
  if (corners.length < 2) {
    // No corners: either one circle lies inside all the others, or there is nothing shared.
    let smallest = circles[0]
    if (smallest === undefined) return ''
    for (const c of circles) if (c.r < smallest.r) smallest = c
    for (const c of circles) {
      if (c !== smallest && hypot(c.x - smallest.x, c.y - smallest.y) + smallest.r > c.r * (1.0 + 1e-9)) return ''
    }
    return whole(smallest)
  }
  const total = corners.length
  let cx = 0.0
  let cy = 0.0
  for (const p of corners) {
    cx += p.x / total
    cy += p.y / total
  }
  corners.sort((p, q) => {
    const diff = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx)
    return partialCmp(diff, 0.0)
  })
  const d = buf()
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i] as Corner
    const to = corners[(i + 1) % corners.length] as Corner
    if (i === 0) {
      d.s += 'M'
      pushPoint(d, from.x, from.y)
    }
    // The side between two corners is an arc of a circle that passes through both. Of those, the
    // one whose arc stays inside the others.
    let arc: Circle | undefined
    let large = false
    let narrowest = Number.POSITIVE_INFINITY
    for (const at of [from.a, from.b]) {
      if (at !== to.a && at !== to.b) continue
      const c = circles[at]
      if (c === undefined) continue
      const start = Math.atan2(from.y - c.y, from.x - c.x)
      let sweep = Math.atan2(to.y - c.y, to.x - c.x) - start
      if (sweep <= 0.0) sweep += TAU
      const mx = c.x + c.r * Math.cos(start + sweep / 2.0)
      const my = c.y + c.r * Math.sin(start + sweep / 2.0)
      const width = hypot(mx - midpoint(from.x, to.x), my - midpoint(from.y, to.y))
      if (width < narrowest) {
        narrowest = width
        arc = c
        large = sweep > PI
      }
    }
    if (arc === undefined) {
      d.s += 'L'
      pushPoint(d, to.x, to.y)
    } else {
      d.s += 'A'
      pushPoint(d, arc.r, arc.r)
      d.s += large ? ' 0 1 1 ' : ' 0 0 1 '
      pushPoint(d, to.x, to.y)
    }
  }
  d.s += 'Z'
  return d.s
}
