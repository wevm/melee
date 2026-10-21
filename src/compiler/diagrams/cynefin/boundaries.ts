/**
 * @module The geometry of Mermaid's Cynefin boundaries: seeded wavy lines between the domains and
 * the S-shaped cliff between Clear and Chaotic. Curves are flat lists of numbers: a start point,
 * then six numbers (two control points and an end point) per cubic segment. Port of Pele's
 * `src/diagrams/cynefin/boundaries.ts`.
 */
import { num, pushNum } from '../../svg/builder.ts'
import { type Buf, midpoint, remEuclid } from '../../util/rust.ts'

/** JavaScript's `ToInt32`, as `x | 0` applies it, as the bits of a `u32`. */
function toInt32(value: number): number {
  if (!Number.isFinite(value)) return 0
  const truncated = remEuclid(Math.trunc(value), 4294967296)
  return truncated >>> 0
}

/** mulberry32, one step. */
export function seededRandom(seed: number): number {
  let t = toInt32(seed + 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0
  t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 0x3d))) >>> 0
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Java's string hash over UTF-16 units, as a signed 32-bit integer. */
export function hashString(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0
  return hash
}

/** A configured seed other than zero wins; otherwise the seed comes from the diagram's id. */
export function resolveSeed(configured: number, id: string): number {
  if (Number.isFinite(configured) && configured !== 0) return configured
  return hashString(id)
}

/** How a wavy line runs: Pele's `WaveOptions`. */
export type WaveOptions = {
  /** Seed multiplier per control point. */
  controlShift: number
  /** Seed offset of control points. */
  controlStep: number
  /** Whether the end stays on the center line. */
  pinEnd: boolean
  /** Whether the start stays on the center line. */
  pinStart: boolean
  /** Seed multiplier per point. */
  pointStep: number
  /** The number of cubic segments. */
  segments: number
  /** Whether the line runs down rather than across. */
  vertical: boolean
}

/** The vertical boundary between the top quadrants. */
export const FOLD: Readonly<WaveOptions> = {
  controlShift: 7,
  controlStep: 31,
  pinEnd: false,
  pinStart: false,
  pointStep: 17,
  segments: 7,
  vertical: true,
}

/** The horizontal boundaries between the top and bottom quadrants. */
export const HORIZON: Readonly<WaveOptions> = {
  controlShift: 11,
  controlStep: 37,
  pinEnd: false,
  pinStart: false,
  pointStep: 23,
  segments: 7,
  vertical: false,
}

/**
 * A wavy line along one axis from `from` to `to`, centered on `center` in the other axis. Points
 * jitter by up to the amplitude; a pinned end stays on the center line.
 */
export function wave(
  from: number,
  to: number,
  center: number,
  seed: number,
  amplitude: number,
  o: Readonly<WaveOptions>,
): number[] {
  const segments = o.segments
  const step = (to - from) / segments
  const along: number[] = []
  const across: number[] = []
  for (let i = 0; i <= o.segments; i++) {
    const k = i
    const pinned = (i === 0 && o.pinStart) || (i === o.segments && o.pinEnd)
    along.push(from + k * step)
    across.push(pinned ? center : center + seededRandom(seed + k * o.pointStep) * amplitude * 2 - amplitude)
  }

  const at = (list: number[], i: number): number => list[i] ?? 0
  const out = o.vertical ? [at(across, 0), at(along, 0)] : [at(along, 0), at(across, 0)]
  for (let i = 0; i < o.segments; i++) {
    const k = i
    const j = i
    const mid = midpoint(at(along, j), at(along, j + 1))
    const sign = i % 2 === 0 ? 1 : -1
    const offset = amplitude * 1.5 * sign * seededRandom(seed + k * o.controlStep + o.controlShift)
    if (o.vertical) {
      out.push(at(across, j) + offset, mid, at(across, j + 1) - offset, mid, at(across, j + 1), at(along, j + 1))
    } else {
      out.push(mid, at(across, j) + offset, mid, at(across, j + 1) - offset, at(along, j + 1), at(across, j + 1))
    }
  }
  return out
}

/** The cliff: a steep S from (`cx`, `top`) down to (`cx`, `bottom`). */
export function cliff(cx: number, top: number, bottom: number, amplitude: number): number[] {
  const h = bottom - top
  return [
    cx,
    top,
    cx + amplitude,
    top + h * 0.2,
    cx - amplitude * 1.5,
    top + h * 0.55,
    cx + amplitude * 0.5,
    top + h * 0.75,
    cx - amplitude,
    top + h * 0.85,
    cx + amplitude * 0.3,
    top + h * 0.95,
    cx,
    bottom,
  ]
}

/** Appends `x,y`. */
function pushPair(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

/** Appends path commands that continue from the curve's start point to its end. */
export function forward(out: Buf, curve: number[]): void {
  const n = curve.length
  for (let s = 2; s + 6 <= n; s += 6) {
    out.s += `C${num(curve[s] as number)},${num(curve[s + 1] as number)} ${num(curve[s + 2] as number)},${num(curve[s + 3] as number)} ${num(curve[s + 4] as number)},${num(curve[s + 5] as number)}`
  }
}

/** Appends path commands that continue from the curve's end point back to its start. */
export function backward(out: Buf, curve: number[]): void {
  const points = Math.trunc(curve.length / 2)
  let k = Math.max(points - 1, 0)
  while (k >= 3) {
    // Points `k - 1`, `k - 2`, and `k - 3`, each inside the curve.
    const b = 2 * (k - 1)
    const a = 2 * (k - 2)
    const e = 2 * (k - 3)
    out.s += `C${num(curve[b] as number)},${num(curve[b + 1] as number)} ${num(curve[a] as number)},${num(curve[a + 1] as number)} ${num(curve[e] as number)},${num(curve[e + 1] as number)}`
    k -= 3
  }
}

/** The path of a curve. */
export function curvePath(curve: number[]): string {
  const out: Buf = { s: 'M' }
  pushPair(out, curve[0] ?? 0, curve[1] ?? 0)
  forward(out, curve)
  return out.s
}

/** The path of an ellipse centered on (`cx`, `cy`). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const r: Buf = { s: '' }
  pushPair(r, rx, ry)
  const out: Buf = { s: 'M' }
  pushPair(out, cx - rx, cy)
  out.s += 'A'
  out.s += r.s
  out.s += ' 0 1,1 '
  pushPair(out, cx + rx, cy)
  out.s += 'A'
  out.s += r.s
  out.s += ' 0 1,1 '
  pushPair(out, cx - rx, cy)
  out.s += 'Z'
  return out.s
}
