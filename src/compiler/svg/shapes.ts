/**
 * @module Node shapes: their sizes around a label, their outlines, and where edges meet them.
 * Port of Pele's `src/svg/shapes.ts`. Unknown shape names draw and size as `rect`.
 */
import type { CNode } from '../layout/compound.ts'
import { num } from './builder.ts'
import { ROUNDED } from './theme.ts'
import { fmax, fmin } from '../util/rust.ts'

/** A shape's size around its label. */
export type ShapeSize = {
  /** Vertical shift of the label from the shape's center. */
  dy: number
  /** Height. */
  h: number
  /** Width. */
  w: number
}

/** `ShapeSize::default()`. */
export function shapeSizeDefault(): ShapeSize {
  return { dy: 0, h: 0, w: 0 }
}

/** Space beside a label in a box. */
export const PAD_X = 18.0
/** Space above and below a label in a box. */
export const PAD_Y = 12.0

/** Kept clear at each end of a straight side, for the corner. */
const CORNER = 12.0

/** `f64::from_bits` for a 64-bit pattern written in hexadecimal. */
function fromBits(bits: string): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setBigUint64(0, BigInt(`0x${bits}`))
  return view.getFloat64(0)
}

/**
 * `(cos, sin)` of `PI * i / 14 - PI / 2` for the bang shape's 28 points, bit for bit as libm and
 * JavaScript's `Math` return them. The table keeps libm's trigonometry out of the module.
 */
// prettier-ignore
const STAR: [number, number][] = [
  [fromBits('3c91a62633145c07'), fromBits('bff0000000000000')],
  [fromBits('3fcc7b90e3024584'), fromBits('bfef329c0558e969')],
  [fromBits('3fdbc4c04d71abc2'), fromBits('bfecd4bca9cb5c71')],
  [fromBits('3fe3f3a0e28bedd2'), fromBits('bfe904c37505de4b')],
  [fromBits('3fe904c37505de4b'), fromBits('bfe3f3a0e28bedd1')],
  [fromBits('3fecd4bca9cb5c71'), fromBits('bfdbc4c04d71abc1')],
  [fromBits('3fef329c0558e969'), fromBits('bfcc7b90e3024582')],
  [fromBits('3ff0000000000000'), fromBits('0000000000000000')],
  [fromBits('3fef329c0558e969'), fromBits('3fcc7b90e3024582')],
  [fromBits('3fecd4bca9cb5c71'), fromBits('3fdbc4c04d71abc1')],
  [fromBits('3fe904c37505de4b'), fromBits('3fe3f3a0e28bedd1')],
  [fromBits('3fe3f3a0e28bedd5'), fromBits('3fe904c37505de48')],
  [fromBits('3fdbc4c04d71abc2'), fromBits('3fecd4bca9cb5c71')],
  [fromBits('3fcc7b90e3024575'), fromBits('3fef329c0558e96a')],
  [fromBits('3c91a62633145c07'), fromBits('3ff0000000000000')],
  [fromBits('bfcc7b90e3024570'), fromBits('3fef329c0558e96a')],
  [fromBits('bfdbc4c04d71abc0'), fromBits('3fecd4bca9cb5c71')],
  [fromBits('bfe3f3a0e28bedd4'), fromBits('3fe904c37505de49')],
  [fromBits('bfe904c37505de4a'), fromBits('3fe3f3a0e28bedd2')],
  [fromBits('bfecd4bca9cb5c70'), fromBits('3fdbc4c04d71abc3')],
  [fromBits('bfef329c0558e969'), fromBits('3fcc7b90e3024586')],
  [fromBits('bff0000000000000'), fromBits('3ca1a62633145c07')],
  [fromBits('bfef329c0558e96b'), fromBits('bfcc7b90e302455f')],
  [fromBits('bfecd4bca9cb5c71'), fromBits('bfdbc4c04d71abbf')],
  [fromBits('bfe904c37505de4c'), fromBits('bfe3f3a0e28bedd0')],
  [fromBits('bfe3f3a0e28bedd3'), fromBits('bfe904c37505de4a')],
  [fromBits('bfdbc4c04d71abb5'), fromBits('bfecd4bca9cb5c74')],
  [fromBits('bfcc7b90e3024589'), fromBits('bfef329c0558e969')],
]

/** A size with no label shift. */
function size(w: number, h: number): ShapeSize {
  return { dy: 0, h, w }
}

/** The span of a shape straight along every side. */
function flat(w: number, h: number, sideways: boolean): number {
  return (sideways ? h : w) - 2 * CORNER
}

/**
 * The span of a shape straight along the top and bottom except for `cut` at each end, and not
 * straight at the sides.
 */
function flatAcross(cut: number, w: number, sideways: boolean): number {
  if (sideways) {
    return 0
  } else {
    return w - 2 * cut - 2 * CORNER
  }
}

/**
 * How far an ellipse's outline has fallen away from its bounding box, `t` from the middle of a
 * side `half` long.
 */
function bulge(t: number, half: number, depth: number): number {
  const k = fmin(Math.abs(t) / half, 1)
  return depth * (1 - Math.sqrt(1 - k * k))
}

/** The inset of a circle or ellipse. */
function roundInset(w: number, h: number, side: number, t: number): number {
  if ((side & 1) === 1) {
    return bulge(t, h / 2, w / 2)
  } else {
    return bulge(t, w / 2, h / 2)
  }
}

/** The span of a circle or ellipse. */
function roundSpan(w: number, h: number, sideways: boolean): number {
  return (sideways ? h : w) * 0.6
}

/** The depth of a cylinder's cap. */
function cap(w: number): number {
  return fmin(12, fmax(6, w / 14))
}

/** The inset of a cylinder, whose caps bulge at the top and bottom. */
function capInset(w: number, side: number, t: number): number {
  if ((side & 1) === 1) {
    return 0
  } else {
    return bulge(t, w / 2, cap(w))
  }
}

/** The size of a triangle around its label, pointing down when `flip`. */
function triSize(tw: number, th: number, flip: boolean): ShapeSize {
  const w = fmax(1.6 * tw + 40, 80)
  const h = (th + 10) / (1 - (tw + 8) / w)
  const dy = h / 2 - 10 - th / 2
  return {
    dy: flip ? -dy : dy,
    h,
    w,
  }
}

/** A path with attributes. */
function path(d: string, a: string): string {
  return `<path d="${d}"${a}/>`
}

/** The inset of a parallelogram or trapezoid. */
function leanInset(h: number, side: number): number {
  return (side & 1) === 1 ? h / 8 : 0
}

/** The size of a box around its label. */
function box(tw: number, th: number): ShapeSize {
  return size(fmax(tw + 2 * PAD_X, 2 * PAD_X + 12), th + 2 * PAD_Y)
}

/** The height of a one-line shape around a label `th` high. */
function lineH(th: number): number {
  return th + 2 * PAD_Y
}

/** A polygon through `points`, given as x, y pairs. */
function poly(points: number[], a: string): string {
  let out = '<polygon points="'
  for (let i = 0; i * 2 < points.length; i++) {
    if (i > 0) {
      out += ' '
    }
    // A trailing lone value is a chunk of one, which writes nothing.
    if (i * 2 + 1 < points.length) {
      out += num(points[i * 2] as number)
      out += ','
      out += num(points[i * 2 + 1] as number)
    }
  }
  out += '"'
  out += a
  out += '/>'
  return out
}

/** A rectangle of `w` by `h` centered on the origin, with a corner attribute `rx`. */
function rect(w: number, h: number, a: string, rx: string): string {
  return `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}"${rx}${a}/>`
}

/** A circle of radius `r` centered on the origin. */
function circle(r: number, a: string): string {
  return `<circle r="${num(r)}"${a}/>`
}

/** A brace at `x` the height of the shape, opening toward `dir`. */
function brace(x: number, h: number, dir: number, line: string): string {
  const y = h / 2
  const k = 6 * dir
  return `<path d="M${num(x)},${num(-y)}q${num(k)},0 ${num(k)},6V-6q0,6 ${num(k)},6q${num(-k)},0 ${num(-k)},6V${num(y - 6)}q0,6 ${num(-k)},6" fill="none"${line}/>`
}

/** A document outline: a rectangle whose bottom edge waves. */
function wave(w: number, h: number, a: string): string {
  const x = w / 2
  const top = -h / 2
  const base = h / 2 - 10
  const q = w / 4
  return `<path d="M${num(-x)},${num(top)}H${num(x)}V${num(base)}q${num(-q)},-12 ${num(-2 * q)},0t${num(-2 * q)},0Z"${a}/>`
}

/** A rounded rectangle followed by lines drawn in the line style. */
function rectAndLines(w: number, h: number, a: string, d: string, line: string): string {
  return `${rect(w, h, a, ROUNDED)}<path d="${d}" fill="none"${line}/>`
}

/** The size of `shape` around a label `tw` by `th`. */
export function shapeSize(shape: string, tw: number, th: number): ShapeSize {
  switch (shape) {
    case 'stadium': {
      const h = lineH(th)
      return size(tw + h * 0.5 + 2 * PAD_X - 8, h)
    }
    case 'fr-rect':
      return size(tw + 2 * PAD_X + 16, th + 2 * PAD_Y)
    case 'cyl': {
      const w = fmax(tw + 2 * PAD_X, 56)
      const ry = cap(w)
      return {
        dy: ry / 2,
        h: th + 2 * PAD_Y + 2 * ry,
        w,
      }
    }
    case 'circle': {
      const d = fmax(Math.sqrt(tw * tw + th * th) + 16, 44)
      return size(d, d)
    }
    case 'dbl-circ': {
      const d = fmax(Math.sqrt(tw * tw + th * th) + 26, 54)
      return size(d, d)
    }
    case 'ellipse':
      return size(tw * 1.3 + 2 * PAD_X, th * 1.2 + 2 * PAD_Y)
    case 'diam': {
      const a = tw + 16
      const b = th + 8
      return size(a + 1.6 * b, a / 1.6 + b)
    }
    case 'hex':
    case 'lean-r':
    case 'lean-l':
    case 'trap-b':
    case 'trap-t': {
      const h = lineH(th)
      return size(tw + 2 * PAD_X + h / 2, h)
    }
    case 'odd':
    case 'delay': {
      const h = lineH(th)
      return size(tw + 2 * PAD_X + h / 4, h)
    }
    case 'text':
      return size(tw + 8, th + 8)
    case 'sm-circ':
    case 'f-circ':
      return size(14, 14)
    case 'fr-circ':
      return size(18, 18)
    case 'fork':
      return size(72, 8)
    case 'lin-rect':
      return size(tw + 2 * PAD_X + 8, th + 2 * PAD_Y)
    case 'div-rect':
      return {
        dy: 4,
        h: th + 2 * PAD_Y + 8,
        w: tw + 2 * PAD_X,
      }
    case 'win-pane':
    case 'st-rect':
      return {
        dy: 4,
        h: th + 2 * PAD_Y + 8,
        w: tw + 2 * PAD_X + 8,
      }
    case 'tri':
      return triSize(tw, th, false)
    case 'flip-tri':
      return triSize(tw, th, true)
    case 'sl-rect':
      return {
        dy: 5,
        h: th + 2 * PAD_Y + 10,
        w: tw + 2 * PAD_X,
      }
    case 'notch-pent':
      return size(tw + 2 * PAD_X, th + 2 * PAD_Y)
    case 'hourglass':
      return size(32, 40)
    case 'h-cyl': {
      const h = lineH(th)
      const rx = fmin(12, h / 4)
      return size(tw + 2 * PAD_X + 2 * rx, h)
    }
    case 'cross-circ':
      return size(44, 44)
    case 'doc':
    case 'tag-doc':
      return {
        dy: -5,
        h: th + 2 * PAD_Y + 10,
        w: tw + 2 * PAD_X,
      }
    case 'flag':
      return size(tw + 2 * PAD_X, th + 2 * PAD_Y + 16)
    case 'folder':
      return {
        dy: 4,
        h: th + 2 * PAD_Y + 8,
        w: fmax(tw + 2 * PAD_X, 64),
      }
    case 'bucket':
      return {
        dy: 3,
        h: th + 2 * PAD_Y + 10,
        w: tw + 2 * PAD_X + 20,
      }
    case 'console':
    case 'browser':
      return {
        dy: 6,
        h: th + 2 * PAD_Y + 12,
        w: fmax(tw + 2 * PAD_X, 72),
      }
    case 'person':
      return {
        dy: 13,
        h: th + 2 * PAD_Y + 26,
        w: fmax(tw + 2 * PAD_X, 56),
      }
    case 'bang':
      return size(tw + 2 * PAD_X + 28, th + 2 * PAD_Y + 24)
    case 'cloud':
      return size(tw + 2 * PAD_X + 32, th + 2 * PAD_Y + 24)
    case 'brace':
    case 'brace-r':
      return size(tw + 2 * PAD_X + 12, th + 2 * PAD_Y)
    case 'braces':
      return size(tw + 2 * PAD_X + 24, th + 2 * PAD_Y)
    case 'bolt':
      return size(36, 56)
    case 'lin-cyl': {
      const w = fmax(tw + 2 * PAD_X, 56)
      const ry = cap(w)
      return {
        dy: ry / 2 + 4,
        h: th + 2 * PAD_Y + 2 * ry + 8,
        w,
      }
    }
    case 'curv-trap': {
      const h = lineH(th)
      return size(tw + 2 * PAD_X + h * 0.6, h)
    }
    case 'docs':
      return {
        dy: -1,
        h: th + 2 * PAD_Y + 18,
        w: tw + 2 * PAD_X + 8,
      }
    case 'bow-rect': {
      const h = lineH(th)
      return size(tw + 2 * PAD_X + h * 0.4, h)
    }
    case 'lin-doc':
      return {
        dy: -5,
        h: th + 2 * PAD_Y + 10,
        w: tw + 2 * PAD_X + 8,
      }
    case 'collapsedGroup':
      return {
        dy: -2,
        h: th + 2 * PAD_Y + 8,
        w: tw + 2 * PAD_X + 8,
      }
    // `rect`, `rounded`, `notch-rect`, `datastore`, `tag-rect`, and unknown names.
    default:
      return box(tw, th)
  }
}

/**
 * Draws `shape` at `w` by `h` centered on the origin, with outline attributes `a` and line
 * attributes `line` for the strokes drawn over it.
 */
export function drawShape(shape: string, w: number, h: number, a: string, line: string): string {
  switch (shape) {
    case 'rounded':
      return rect(w, h, a, ` rx="${num(fmin(12, h / 2))}"`)
    case 'stadium':
      return rect(w, h, a, ` rx="${num(h / 2)}"`)
    case 'fr-rect': {
      const x = w / 2 - 8
      const d = `M${num(-x)},${num(-h / 2)}V${num(h / 2)}M${num(x)},${num(-h / 2)}V${num(h / 2)}`
      return rectAndLines(w, h, a, d, line)
    }
    case 'cyl': {
      const rx = w / 2
      const ry = cap(w)
      const top = -h / 2 + ry
      const bottom = h / 2 - ry
      return `<path d="M${num(-rx)},${num(top)}A${num(rx)},${num(ry)} 0 0 1 ${num(rx)},${num(top)}V${num(bottom)}A${num(rx)},${num(ry)} 0 0 1 ${num(-rx)},${num(bottom)}Z"${a}/><path d="M${num(-rx)},${num(top)}A${num(rx)},${num(ry)} 0 0 0 ${num(rx)},${num(top)}" fill="none"${line}/>`
    }
    case 'circle':
    case 'sm-circ':
      return circle(w / 2, a)
    case 'dbl-circ':
      return `${circle(w / 2, a)}<circle r="${num(w / 2 - 5)}" fill="none"${line}/>`
    case 'ellipse':
      return `<ellipse rx="${num(w / 2)}" ry="${num(h / 2)}"${a}/>`
    case 'diam':
      return poly([0, -h / 2, w / 2, 0, 0, h / 2, -w / 2, 0], a)
    case 'hex': {
      const m = h / 4
      return poly([-w / 2 + m, -h / 2, w / 2 - m, -h / 2, w / 2, 0, w / 2 - m, h / 2, -w / 2 + m, h / 2, -w / 2, 0], a)
    }
    case 'odd': {
      const notch = h / 4
      return poly([-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2 + notch, 0], a)
    }
    case 'lean-r': {
      const s = h / 4
      return poly([-w / 2 + s, -h / 2, w / 2, -h / 2, w / 2 - s, h / 2, -w / 2, h / 2], a)
    }
    case 'lean-l': {
      const s = h / 4
      return poly([-w / 2, -h / 2, w / 2 - s, -h / 2, w / 2, h / 2, -w / 2 + s, h / 2], a)
    }
    case 'trap-b': {
      const s = h / 4
      return poly([-w / 2 + s, -h / 2, w / 2 - s, -h / 2, w / 2, h / 2, -w / 2, h / 2], a)
    }
    case 'trap-t': {
      const s = h / 4
      return poly([-w / 2, -h / 2, w / 2, -h / 2, w / 2 - s, h / 2, -w / 2 + s, h / 2], a)
    }
    case 'text':
      return rect(w, h, ' fill="none" stroke="none"', '')
    case 'f-circ':
      return `<circle r="${num(w / 2)}" fill="var(--_l)"${line}/>`
    case 'fr-circ':
      return `${circle(w / 2, a)}<circle r="${num(w / 2 - 4)}" fill="var(--_l)"${line}/>`
    case 'fork':
      return rect(w, h, ` fill="var(--_l)"${line}`, ' rx="2"')
    case 'notch-rect': {
      const c = 10
      return poly([-w / 2 + c, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2 + c], a)
    }
    case 'lin-rect':
      return rectAndLines(w, h, a, `M${num(-w / 2 + 8)},${num(-h / 2)}V${num(h / 2)}`, line)
    case 'div-rect':
      return rectAndLines(w, h, a, `M${num(-w / 2)},${num(-h / 2 + 8)}H${num(w / 2)}`, line)
    case 'win-pane': {
      const d = `M${num(-w / 2 + 8)},${num(-h / 2)}V${num(h / 2)}M${num(-w / 2)},${num(-h / 2 + 8)}H${num(w / 2)}`
      return rectAndLines(w, h, a, d, line)
    }
    case 'tri':
      return poly([0, -h / 2, w / 2, h / 2, -w / 2, h / 2], a)
    case 'flip-tri':
      return poly([-w / 2, -h / 2, w / 2, -h / 2, 0, h / 2], a)
    case 'sl-rect':
      return poly([-w / 2, -h / 2 + 10, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2], a)
    case 'notch-pent': {
      const c = 10
      return poly(
        [-w / 2 + c, -h / 2, w / 2 - c, -h / 2, w / 2, -h / 2 + c, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2 + c],
        a,
      )
    }
    case 'hourglass':
      return poly([-w / 2, -h / 2, w / 2, -h / 2, -w / 2, h / 2, w / 2, h / 2], a)
    case 'delay': {
      const r = h / 2
      return `<path d="M${num(-w / 2)},${num(-r)}H${num(w / 2 - r)}A${num(r)},${num(r)} 0 0 1 ${num(w / 2 - r)},${num(r)}H${num(-w / 2)}Z"${a}/>`
    }
    case 'h-cyl': {
      const ry = h / 2
      const rx = fmin(12, h / 4)
      const l = -w / 2 + rx
      const r = w / 2 - rx
      return `<path d="M${num(l)},${num(-ry)}H${num(r)}A${num(rx)},${num(ry)} 0 0 1 ${num(r)},${num(ry)}H${num(l)}A${num(rx)},${num(ry)} 0 0 1 ${num(l)},${num(-ry)}Z"${a}/><path d="M${num(r)},${num(-ry)}A${num(rx)},${num(ry)} 0 0 0 ${num(r)},${num(ry)}" fill="none"${line}/>`
    }
    case 'cross-circ': {
      const r = w / 2
      const k = r * Math.SQRT1_2
      return `${circle(r, a)}<path d="M${num(-k)},${num(-k)}L${num(k)},${num(k)}M${num(k)},${num(-k)}L${num(-k)},${num(k)}" fill="none"${line}/>`
    }
    case 'st-rect': {
      const bw = w - 8
      const bh = h - 8
      let out = ''
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + (2 - i) * 4
        const y = -h / 2 + i * 4
        out += `<rect x="${num(x)}" y="${num(y)}" width="${num(bw)}" height="${num(bh)}"${ROUNDED}${a}/>`
      }
      return out
    }
    case 'doc':
      return wave(w, h, a)
    case 'flag': {
      const x = w / 2
      const y = h / 2 - 8
      const q = w / 4
      return `<path d="M${num(-x)},${num(-y)}q${num(q)},-10 ${num(2 * q)},0t${num(2 * q)},0V${num(y)}q${num(-q)},10 ${num(-2 * q)},0t${num(-2 * q)},0Z"${a}/>`
    }
    case 'datastore': {
      const d = `M${num(-w / 2)},${num(-h / 2)}H${num(w / 2)}M${num(-w / 2)},${num(h / 2)}H${num(w / 2)}`
      // `replacen(.., 1)`: only the first occurrence. The replacement has no `$` patterns.
      return `${rect(w, h, a.replace('stroke="var(--_b)"', 'stroke="none"'), '')}<path d="${d}" fill="none"${line}/>`
    }
    case 'folder': {
      const x = w / 2
      const y = h / 2
      const tab = fmin(w * 0.4, 48)
      const d = `M${num(-x)},${num(-y)}H${num(-x + tab)}L${num(-x + tab + 8)},${num(-y + 8)}H${num(x)}V${num(y)}H${num(-x)}Z`
      return path(d, a)
    }
    case 'bucket': {
      const x = w / 2
      const y = h / 2
      const ry = 5
      const taper = h / 6
      const d = `M${num(-x)},${num(-y + ry)}A${num(x)},${num(ry)} 0 0 1 ${num(x)},${num(-y + ry)}L${num(x - taper)},${num(y - ry)}A${num(x - taper)},${num(ry)} 0 0 1 ${num(-x + taper)},${num(y - ry)}Z`
      return `${path(d, a)}<path d="M${num(-x)},${num(-y + ry)}A${num(x)},${num(ry)} 0 0 0 ${num(x)},${num(-y + ry)}" fill="none"${line}/>`
    }
    case 'console': {
      const d = `M${num(-w / 2)},${num(-h / 2 + 12)}H${num(w / 2)}M${num(-w / 2 + 7)},${num(-h / 2 + 4)}l3,2.5l-3,2.5M${num(-w / 2 + 13)},${num(-h / 2 + 9)}h4`
      return rectAndLines(w, h, a, d, line)
    }
    case 'browser': {
      let out = rectAndLines(w, h, a, `M${num(-w / 2)},${num(-h / 2 + 12)}H${num(w / 2)}`, line)
      for (let i = 0; i < 3; i++) {
        out += `<circle cx="${num(-w / 2 + 8 + i * 7)}" cy="${num(-h / 2 + 6)}" r="1.5" fill="none"${line}/>`
      }
      return out
    }
    case 'person': {
      const top = -h / 2
      return `<rect x="${num(-w / 2)}" y="${num(top + 26)}" width="${num(w)}" height="${num(h - 26)}" rx="12"${a}/><circle cy="${num(top + 14)}" r="13"${a}/>`
    }
    case 'bang': {
      const points: number[] = []
      for (let i = 0; i < STAR.length; i++) {
        const [cos, sin] = STAR[i] as [number, number]
        const k = i % 2 === 0 ? 1 : 0.82
        points.push(cos * (w / 2) * k)
        points.push(sin * (h / 2) * k)
      }
      return poly(points, a)
    }
    case 'cloud': {
      const x = w / 2
      const y = h / 2
      const r = y * 0.55
      const d = `M${num(-x + r)},${num(y)}A${num(r)},${num(r)} 0 0 1 ${num(-x + r * 0.6)},${num(-y * 0.1)}A${num(x * 0.42)},${num(y * 0.7)} 0 0 1 ${num(-x * 0.1)},${num(-y * 0.72)}A${num(x * 0.4)},${num(y * 0.62)} 0 0 1 ${num(x * 0.62)},${num(-y * 0.42)}A${num(r * 1.05)},${num(r * 1.05)} 0 0 1 ${num(x - r)},${num(y)}Z`
      return path(d, a)
    }
    case 'brace':
      return rect(w, h, ' fill="none" stroke="none"', '') + brace(-w / 2 + 12, h, -1, line)
    case 'brace-r':
      return rect(w, h, ' fill="none" stroke="none"', '') + brace(w / 2 - 12, h, 1, line)
    case 'braces':
      return (
        rect(w, h, ' fill="none" stroke="none"', '') + brace(-w / 2 + 12, h, -1, line) + brace(w / 2 - 12, h, 1, line)
      )
    case 'bolt':
      return poly([w * 0.15, -h / 2, -w / 2, h * 0.08, -w * 0.05, h * 0.08, -w * 0.15, h / 2, w / 2, -h * 0.08, w * 0.05, -h * 0.08], a)
    case 'lin-cyl': {
      const rx = w / 2
      const ry = cap(w)
      const top = -h / 2 + ry
      const bottom = h / 2 - ry
      const arc = (y: number): string =>
        `M${num(-rx)},${num(y)}A${num(rx)},${num(ry)} 0 0 0 ${num(rx)},${num(y)}`
      const d = `M${num(-rx)},${num(top)}A${num(rx)},${num(ry)} 0 0 1 ${num(rx)},${num(top)}V${num(bottom)}A${num(rx)},${num(ry)} 0 0 1 ${num(-rx)},${num(bottom)}Z`
      return `${path(d, a)}<path d="${arc(top)}${arc(top + 8)}" fill="none"${line}/>`
    }
    case 'curv-trap': {
      const x = w / 2
      const y = h / 2
      const k = h * 0.3
      const d = `M${num(-x + k)},${num(-y)}H${num(x - k)}A${num(k)},${num(y)} 0 0 1 ${num(x - k)},${num(y)}H${num(-x + k)}L${num(-x)},0Z`
      return path(d, a)
    }
    case 'docs': {
      let out = ''
      for (const [dx, dy] of [
        ['4', '-4'],
        ['0', '0'],
        ['-4', '4'],
      ] as const) {
        out += `<g transform="translate(${dx},${dy})">${wave(w - 8, h - 8, a)}</g>`
      }
      return out
    }
    case 'bow-rect': {
      const x = w / 2
      const y = h / 2
      const k = h * 0.2
      const d = `M${num(-x + k)},${num(-y)}H${num(x)}A${num(k)},${num(y)} 0 0 0 ${num(x)},${num(y)}H${num(-x + k)}A${num(k)},${num(y)} 0 0 1 ${num(-x + k)},${num(-y)}Z`
      return path(d, a)
    }
    case 'tag-rect':
      return rectAndLines(
        w,
        h,
        a,
        `M${num(w / 2 - 12)},${num(h / 2)}L${num(w / 2)},${num(h / 2 - 12)}`,
        line,
      )
    case 'tag-doc':
      return `${wave(w, h, a)}<path d="M${num(w / 2 - 12)},${num(h / 2 - 14)}L${num(w / 2)},${num(h / 2 - 26)}" fill="none"${line}/>`
    case 'lin-doc':
      return `${wave(w, h, a)}<path d="M${num(-w / 2 + 8)},${num(-h / 2)}V${num(h / 2 - 6)}" fill="none"${line}/>`
    case 'collapsedGroup':
      return `<rect x="${num(-w / 2 + 6)}" y="${num(-h / 2 + 8)}" width="${num(w - 12)}" height="${num(h - 8)}"${ROUNDED}${a}/><rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h - 4)}"${ROUNDED}${a}/>`
    // `rect` and unknown names.
    default:
      return rect(w, h, a, ROUNDED)
  }
}

/**
 * Distance from the bounding box to the outline of `shape` on a side: 0 top, 1 right, 2 bottom,
 * 3 left. `t` is how far along the side from its middle, to the right or down.
 */
export function shapeInset(shape: string, w: number, h: number, side: number, t: number): number {
  const odd = (side & 1) === 1
  // Arms in Rust's order: an arm whose guard fails falls through to the next.
  if (shape === 'stadium' && odd) return bulge(t, h / 2, h / 2)
  if (shape === 'cyl' || shape === 'lin-cyl') return capInset(w, side, t)
  if (
    shape === 'circle' ||
    shape === 'dbl-circ' ||
    shape === 'ellipse' ||
    shape === 'sm-circ' ||
    shape === 'f-circ' ||
    shape === 'fr-circ' ||
    shape === 'cross-circ'
  ) {
    return roundInset(w, h, side, t)
  }
  if (shape === 'diam' && odd) return (Math.abs(t) * w) / h
  if (shape === 'diam') return (Math.abs(t) * h) / w
  if (shape === 'hex' && odd) return Math.abs(t) / 2
  if (shape === 'odd' && side === 3) return h / 4
  if (shape === 'lean-r' || shape === 'lean-l' || shape === 'trap-b' || shape === 'trap-t') return leanInset(h, side)
  if ((shape === 'tri' || shape === 'flip-tri' || shape === 'bolt') && odd) return w / 4
  if (shape === 'sl-rect' && side === 0) return 5
  if (shape === 'hourglass' && odd) return w / 2
  if ((shape === 'doc' || shape === 'docs' || shape === 'tag-doc' || shape === 'lin-doc') && side === 2) return 10
  if (shape === 'flag' && !odd) return 8
  if (shape === 'bucket' && odd) return h / 12
  if (shape === 'bang') return 3
  if (shape === 'cloud' && odd) return 2
  if (shape === 'cloud') return 1
  if (shape === 'bow-rect' && side === 1) return h * 0.2
  return 0
}

/**
 * How much of a side of `shape` edges may spread along, when the flow runs down or, if
 * `sideways`, across. A shape without one keeps its edges at the middle.
 */
export function shapeSpan(shape: string, w: number, h: number, sideways: boolean): number {
  const span = (() => {
    switch (shape) {
      case 'rect':
      case 'rounded':
      case 'fr-rect':
      case 'text':
      case 'notch-rect':
      case 'lin-rect':
      case 'div-rect':
      case 'win-pane':
      case 'notch-pent':
      case 'datastore':
      case 'console':
      case 'browser':
      case 'tag-rect':
        return flat(w, h, sideways)
      case 'stadium':
        return sideways ? h * 0.6 : w - h
      case 'cyl':
        return sideways ? h - 2 * CORNER - 12 : w * 0.6
      case 'lin-cyl':
        return sideways ? h - 2 * CORNER - 20 : w * 0.6
      case 'circle':
      case 'dbl-circ':
      case 'ellipse':
      case 'diam':
      case 'sm-circ':
      case 'f-circ':
      case 'fr-circ':
      case 'cross-circ':
        return roundSpan(w, h, sideways)
      case 'hex':
        return sideways ? h * 0.5 : w - h / 2 - CORNER
      case 'odd':
        return flatAcross(0, w, sideways)
      case 'lean-r':
      case 'lean-l':
      case 'trap-b':
      case 'trap-t':
        return flatAcross(h / 4, w, sideways)
      case 'fork':
        return (sideways ? h : w) - 8
      case 'st-rect':
        return (sideways ? h : w) - 2 * CORNER - 8
      default:
        return 0
    }
  })()
  return fmax(0, span)
}

/** Whether `shape` holds a label. */
export function shapeHasLabel(shape: string): boolean {
  switch (shape) {
    case 'sm-circ':
    case 'f-circ':
    case 'fr-circ':
    case 'fork':
    case 'hourglass':
    case 'cross-circ':
    case 'bolt':
      return false
    default:
      return true
  }
}

/**
 * The side of a node's layout box that a route end at `at` lies on: 0 top, 1 right, 2 bottom,
 * 3 left, or -1 for none.
 */
export function endSide(route: number[], at: number, c: CNode): number {
  const dx = (route[at] ?? Number.NaN) - c.x
  const dy = (route[at + 1] ?? Number.NaN) - c.y
  if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) {
    return dy < 0 ? 0 : 2
  }
  if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) {
    return dx < 0 ? 3 : 1
  }
  return -1
}

/**
 * Moves a route end at `at` from node `c`'s layout box onto the outline of `shape`, drawn `w` by
 * `h` in it. Groups have no outline to move onto.
 */
export function insetRoute(route: number[], at: number, shape: string, w: number, h: number, c: CNode): void {
  if (c.isGroup) {
    return
  }

  const side = endSide(route, at, c)
  if (side === 0 || side === 2) {
    const t = (route[at] ?? Number.NaN) - c.x
    const amount = shapeInset(shape, w, h, side === 0 ? 0 : 2, t) + (c.h - h) / 2
    if (at + 1 < route.length) {
      route[at + 1] = (route[at + 1] as number) + (side === 0 ? amount : -amount)
    }
  } else if (side >= 0) {
    const t = (route[at + 1] ?? Number.NaN) - c.y
    const amount = shapeInset(shape, w, h, side === 3 ? 3 : 1, t) + (c.w - w) / 2
    if (at < route.length) {
      route[at] = (route[at] as number) + (side === 3 ? amount : -amount)
    }
  }
}
