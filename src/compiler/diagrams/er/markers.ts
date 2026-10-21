/** @module Crow's foot cardinality markers. Port of Pele's `src/diagrams/er/markers.ts`. */
import { pushNum } from '../../svg/builder.ts'
import { type Buf, buf } from '../../util/rust.ts'

/** How far a marker reaches back along its line from the box it touches. */
export const MARKER_LENGTH = 18.0

/** Half the length of a bar. */
const BAR = 5.0
/** Half the spread of a crow's foot. */
const FOOT = 6.0
/** Length of a crow's foot. */
const FOOT_LENGTH = 10.0
/** Radius of a ring. */
const RING = 3.5

/**
 * Draws a crow's foot cardinality marker over the end of a line that meets a box at (`x`, `y`)
 * while travelling along the unit vector (`dx`, `dy`). Types are Mermaid's lower-cased
 * cardinalities.
 */
export function erMarker(type: string, x: number, y: number, dx: number, dy: number): string {
  const out = buf()
  switch (type) {
    case 'only_one':
      out.s += '<path class="ondine-marker" d="'
      bar(out, x, y, dx, dy, 6.0)
      bar(out, x, y, dx, dy, 10.0)
      out.s += '"/>'
      break
    case 'zero_or_one':
      out.s += '<path class="ondine-marker" d="'
      bar(out, x, y, dx, dy, 6.0)
      out.s += '"/>'
      ring(out, x, y, dx, dy, 13.5)
      break
    case 'one_or_more':
      out.s += '<path class="ondine-marker" d="'
      foot(out, x, y, dx, dy)
      bar(out, x, y, dx, dy, FOOT_LENGTH + 3.5)
      out.s += '"/>'
      break
    case 'zero_or_more':
      out.s += '<path class="ondine-marker" d="'
      foot(out, x, y, dx, dy)
      out.s += '"/>'
      ring(out, x, y, dx, dy, FOOT_LENGTH + RING + 0.5)
      break
    case 'md_parent':
      out.s += '<path class="ondine-marker" d="M'
      at(out, x, y, dx, dy, 0.0, 0.0)
      out.s += 'L'
      at(out, x, y, dx, dy, 6.0, 4.0)
      out.s += 'L'
      at(out, x, y, dx, dy, 12.0, 0.0)
      out.s += 'L'
      at(out, x, y, dx, dy, 6.0, -4.0)
      out.s += 'Z" fill="var(--_bg)"/>'
      break
    default:
      break
  }
  return out.s
}

/** Appends the point `back` along the line from the box and `side` across it. */
function at(out: Buf, x: number, y: number, dx: number, dy: number, back: number, side: number): void {
  pushNum(out, x - dx * back - dy * side)
  out.s += ','
  pushNum(out, y - dy * back + dx * side)
}

/** Appends a bar across the line, `back` from the box. */
function bar(out: Buf, x: number, y: number, dx: number, dy: number, back: number): void {
  out.s += 'M'
  at(out, x, y, dx, dy, back, -BAR)
  out.s += 'L'
  at(out, x, y, dx, dy, back, BAR)
}

/** Appends a crow's foot. */
function foot(out: Buf, x: number, y: number, dx: number, dy: number): void {
  out.s += 'M'
  at(out, x, y, dx, dy, 0.0, -FOOT)
  out.s += 'L'
  at(out, x, y, dx, dy, FOOT_LENGTH, 0.0)
  out.s += 'L'
  at(out, x, y, dx, dy, 0.0, FOOT)
}

/** Appends a ring on the line, `back` from the box. */
function ring(out: Buf, x: number, y: number, dx: number, dy: number, back: number): void {
  out.s += '<circle class="ondine-marker" cx="'
  pushNum(out, x - dx * back)
  out.s += '" cy="'
  pushNum(out, y - dy * back)
  out.s += '" r="3.5" fill="var(--_bg)"/>'
}
