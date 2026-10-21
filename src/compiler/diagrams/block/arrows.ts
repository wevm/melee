/**
 * @module Block arrows: their directions, sizes, and outlines. Port of Pele's
 * `src/diagrams/block/arrows.ts`.
 */
import { num } from '../../svg/builder.ts'
import { trim } from '../../text/label.ts'
import { fmax, fmin, midpoint } from '../../util/rust.ts'

/** Points right. */
export const RIGHT = 1
/** Points left. */
export const LEFT = 2
/** Points up. */
export const UP = 4
/** Points down. */
export const DOWN = 8

/** How far a head reaches past each side of its shaft. */
export const OVERHANG = 7.0
const MAX_DEPTH = 20.0
const NUB = 12.0

/** The size of an arrow around its label. */
export type ArrowSize = {
  /** Shift of the label from the center, away from the heads. */
  dx: number
  /** Shift of the label from the center, away from the heads. */
  dy: number
  /** Height. */
  h: number
  /** Width. */
  w: number
}

/**
 * The direction bits of an arrow. Mermaid compares directions exactly, so `( up )` draws no arrow
 * there. Here spaces are ignored.
 */
export function arrowMask(directions: string[] | undefined): number {
  let mask = 0
  for (const direction of directions ?? []) {
    switch (trim(direction)) {
      case 'right':
        mask |= RIGHT
        break
      case 'left':
        mask |= LEFT
        break
      case 'up':
        mask |= UP
        break
      case 'down':
        mask |= DOWN
        break
      case 'x':
        mask |= RIGHT | LEFT
        break
      case 'y':
        mask |= UP | DOWN
        break
      default:
        break
    }
  }
  return mask
}

function bit(mask: number, flag: number): number {
  return (mask & flag) === 0 ? 0 : 1
}

/** The `x` axis, as {@link arrowAxis} returns it (`b'x'`). */
export const AXIS_X = 0x78
/** The `y` axis, as {@link arrowAxis} returns it (`b'y'`). */
export const AXIS_Y = 0x79

/**
 * The axis an arrow points along: `x`, `y`, or neither (0), as the byte of the letter. An arrow
 * along one axis has a shaft and heads wider than it. One that points along both axes is a box
 * with a small point on each side it names.
 */
export function arrowAxis(mask: number): number {
  if (mask !== 0 && (mask & (UP | DOWN)) === 0) return AXIS_X
  if (mask !== 0 && (mask & (RIGHT | LEFT)) === 0) return AXIS_Y
  return 0
}

/** The size of an arrow around a label `tw` by `th`. */
export function arrowSize(mask: number, tw: number, th: number): ArrowSize {
  const axis = arrowAxis(mask)
  const across = bit(mask, LEFT) - bit(mask, RIGHT)
  const along = bit(mask, UP) - bit(mask, DOWN)
  if (axis === AXIS_X) {
    const h = fmax(th + 8, 14) + 2 * OVERHANG
    const depth = fmin(h / 2, MAX_DEPTH)
    const heads = mask === (RIGHT | LEFT) ? 2 : 1
    return { dx: (across * depth) / 2, dy: 0, h, w: fmax(tw + 12, 16) + depth * heads }
  }
  if (axis === AXIS_Y) {
    const w = fmax(tw + 16, 14) + 2 * OVERHANG
    const depth = fmin(w / 2, MAX_DEPTH)
    const heads = mask === (UP | DOWN) ? 2 : 1
    return { dx: 0, dy: (along * depth) / 2, h: fmax(th + 8, 16) + depth * heads, w }
  }
  return {
    dx: (across * NUB) / 2,
    dy: (along * NUB) / 2,
    h: fmax(th + 8, 24) + NUB * (bit(mask, UP) + bit(mask, DOWN)),
    w: fmax(tw + 16, 24) + NUB * (bit(mask, LEFT) + bit(mask, RIGHT)),
  }
}

/** The outline of an arrow `w` by `h` around the origin, with `attrs` on its polygon. */
export function drawArrow(mask: number, w: number, h: number, attrs: string): string {
  const axis = arrowAxis(mask)
  const x = w / 2
  const y = h / 2
    const p: number[] = []
  if (axis === AXIS_X) {
    const depth = fmin(y, MAX_DEPTH)
    const s = y - OVERHANG
    const x0 = (mask & LEFT) !== 0 ? -x + depth : -x
    const x1 = (mask & RIGHT) !== 0 ? x - depth : x
    p.push(x0, -s, x1, -s)
    if ((mask & RIGHT) !== 0) p.push(x1, -y, x, 0, x1, y)
    p.push(x1, s, x0, s)
    if ((mask & LEFT) !== 0) p.push(x0, y, -x, 0, x0, -y)
  } else if (axis === AXIS_Y) {
    const depth = fmin(x, MAX_DEPTH)
    const s = x - OVERHANG
    const y0 = (mask & UP) !== 0 ? -y + depth : -y
    const y1 = (mask & DOWN) !== 0 ? y - depth : y
    p.push(s, y0, s, y1)
    if ((mask & DOWN) !== 0) p.push(x, y1, 0, y, -x, y1)
    p.push(-s, y1, -s, y0)
    if ((mask & UP) !== 0) p.push(-x, y0, 0, -y, x, y0)
  } else {
    const x0 = (mask & LEFT) !== 0 ? -x + NUB : -x
    const x1 = (mask & RIGHT) !== 0 ? x - NUB : x
    const y0 = (mask & UP) !== 0 ? -y + NUB : -y
    const y1 = (mask & DOWN) !== 0 ? y - NUB : y
    const cx = midpoint(x0, x1)
    const cy = midpoint(y0, y1)
    const kx = fmin((x1 - x0) / 2, 10)
    const ky = fmin((y1 - y0) / 2, 10)
    p.push(x0, y0)
    if ((mask & UP) !== 0) p.push(cx - kx, y0, cx, -y, cx + kx, y0)
    p.push(x1, y0)
    if ((mask & RIGHT) !== 0) p.push(x1, cy - ky, x, cy, x1, cy + ky)
    p.push(x1, y1)
    if ((mask & DOWN) !== 0) p.push(cx + kx, y1, cx, y, cx - kx, y1)
    p.push(x0, y1)
    if ((mask & LEFT) !== 0) p.push(x0, cy + ky, -x, cy, x0, cy - ky)
  }

  let points = ''
  for (let i = 0; i + 1 < p.length; i += 2) {
    const pair = `${num(p[i] as number)},${num(p[i + 1] as number)}`
    points = i > 0 ? `${points} ${pair}` : pair
  }
  return `<polygon points="${points}" stroke-linejoin="round"${attrs}/>`
}
