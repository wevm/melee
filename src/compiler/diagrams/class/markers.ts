/** @module The end markers of class relations. Port of Pele's `src/diagrams/class/markers.ts`. */
import type { RelationEnd } from './types.ts'
import { pushNum } from '../../svg/builder.ts'
import { marker, markerTrim } from '../../svg/edges.ts'
import { type Buf, buf } from '../../util/rust.ts'

/** Length of the extension triangle. */
const TRIANGLE = 12.0
/** Length of the aggregation and composition diamonds. */
const DIAMOND = 16.0
/** Half the width of a triangle. */
const HALF = 6.0
/** Radius of the lollipop circle. */
const RING = 5.0

/** How far the line stops short of the node so that it meets the back of the marker. */
export function classMarkerTrim(type: RelationEnd): number {
  if (type.kind !== 'Type') return 0.0
  switch (type._0) {
    case 1:
      return TRIANGLE
    case 0:
    case 2:
      return DIAMOND
    case 4:
      return 2.0 * RING
    case 3:
      return markerTrim('arrow_point')
    default:
      return 0.0
  }
}

/** Appends `x,y`. */
function pushPoint(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

/** Draws an end marker whose tip is at (`x`, `y`), pointing along (`dx`, `dy`). */
export function classMarker(
  type: RelationEnd,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: string,
): string {
  const nx = -dy
  const ny = dx
  const out = buf()
  if (type.kind !== 'Type') return out.s
  const kind = type._0
  switch (kind) {
    case 1: {
      const bx = x - dx * TRIANGLE
      const by = y - dy * TRIANGLE
      out.s += '<path class="ondine-marker" d="M'
      pushPoint(out, x, y)
      out.s += 'L'
      pushPoint(out, bx + nx * HALF, by + ny * HALF)
      out.s += 'L'
      pushPoint(out, bx - nx * HALF, by - ny * HALF)
      out.s += 'Z" stroke-linejoin="round"/>'
      break
    }
    case 0:
    case 2: {
      const mx = x - (dx * DIAMOND) / 2.0
      const my = y - (dy * DIAMOND) / 2.0
      const half = HALF - 1.0
      out.s += '<path class="ondine-marker" d="M'
      pushPoint(out, x, y)
      out.s += 'L'
      pushPoint(out, mx + nx * half, my + ny * half)
      out.s += 'L'
      pushPoint(out, x - dx * DIAMOND, y - dy * DIAMOND)
      out.s += 'L'
      pushPoint(out, mx - nx * half, my - ny * half)
      out.s += 'Z" stroke-linejoin="round"'
      if (kind === 2) {
        out.s += ' fill="'
        out.s += color
        out.s += '"'
      }
      out.s += '/>'
      break
    }
    case 4:
      out.s += '<circle class="ondine-marker" cx="'
      pushNum(out, x - dx * RING)
      out.s += '" cy="'
      pushNum(out, y - dy * RING)
      out.s += '" r="5"/>'
      break
    case 3:
      return marker('arrow_point', x, y, dx, dy, color)
    default:
      break
  }
  return out.s
}
