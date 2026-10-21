/**
 * @module Cluster titles placed clear of the edges that cross a cluster's top border. Port of
 * Pele's `src/svg/cluster.ts`.
 */
import type { CNode } from '../layout/compound.ts'
import { jsRound, labelSvg, pushNum } from './builder.ts'
import type { IconResolver } from '../text/icons.ts'
import type { Label } from '../text/label.ts'
import { buf, fmin, powi } from '../util/rust.ts'

/** The x of every route point, by its rounded y: the edges that cross a cluster's top border. */
export type Crossings = Map<number, number[]>

/** `i64::MAX as f64` and `i64::MIN as f64`, where an `as i64` cast saturates. */
const I64_LIMIT = 9223372036854775808

/** A rounded y as a map key. */
function key(y: number): number {
  // ponytail: NaN and values past `i64` saturate, where Pele would key them by their own value.
  const rounded = jsRound(y)
  if (Number.isNaN(rounded)) return 0
  if (rounded >= I64_LIMIT) return I64_LIMIT
  if (rounded <= -I64_LIMIT) return -I64_LIMIT
  // `as i64` has no negative zero.
  return rounded || 0
}

/** Records the points of a route of `x, y, axis` triples. */
export function markCrossings(crossings: Crossings, route: number[]): void {
  for (let i = 0; i < route.length; i += 3) {
    // A trailing chunk shorter than two values has no point.
    if (i + 1 >= route.length) continue
    const x = route[i] as number
    const y = route[i + 1] as number
    const k = key(y)
    let xs = crossings.get(k)
    if (xs === undefined) {
      xs = []
      crossings.set(k, xs)
    }
    xs.push(x)
  }
}

/**
 * Picks where a cluster title of `width` sits along the top edge so that edges entering there do
 * not cross it. `pad` is the cluster's padding.
 */
export function clusterTitleX(c: CNode, width: number, crossings: Crossings, pad: number): number {
  if (width === 0) {
    return c.x
  }

  const top = c.y - c.h / 2
  const left = c.x - c.w / 2
  const half = width / 2
  const candidates = [left + pad - 6 + half, c.x, left + c.w - pad + 6 - half]
  const xs = crossings.get(key(top))
  if (xs === undefined) {
    return candidates[0] as number
  }

  let best = candidates[0] as number
  let bestGap = -1
  for (const x of candidates) {
    let gap = Number.POSITIVE_INFINITY
    for (const cx of xs) {
      if (cx > left && cx < left + c.w) {
        gap = fmin(gap, Math.abs(cx - x) - half)
      }
    }
    if (gap >= 6) {
      return x
    }
    if (gap > bestGap + 0.5) {
      bestGap = gap
      best = x
    }
  }
  return best
}

/** Whether an edge that enters at the top runs through a title of `width` placed at `x`. */
export function titleCrossed(c: CNode, width: number, x: number, crossings: Crossings): boolean {
  if (Number.isNaN(width) || width <= 0) {
    return false
  }
  const xs = crossings.get(key(c.y - c.h / 2))
  if (xs === undefined) {
    return false
  }

  const left = c.x - c.w / 2
  return xs.some((cx) => cx > left && cx < left + c.w && Math.abs(cx - x) < width / 2 + 4)
}

/**
 * A title that an edge runs through, drawn over the edges: the text on an outline in the color
 * of the cluster behind it, so only the line is seen to stop short of the letters. `nodes` and
 * `index` find how many clusters deep the title is, each of which tints the background. `id` is
 * written as given.
 */
export function struckTitle(
  label: Label,
  x: number,
  y: number,
  attrs: string,
  id: string,
  nodes: CNode[],
  index: number,
  icons: IconResolver | undefined,
): string {
  let depth = 1
  let parent = nodes[index]?.parent ?? -1
  while (parent >= 0 && depth < 8) {
    depth += 1
    parent = nodes[parent]?.parent ?? -1
  }

  // Each cluster is half its fill over what is behind it.
  const halo = buf(' fill="none" stroke="color-mix(in srgb,var(--_a) ')
  pushNum(halo, 100 * (1 - powi(0.5, depth)))
  halo.s += '%,var(--_bg))" stroke-width="5" stroke-linejoin="round"'

  let out = '<g class="ondine-cluster-title" data-id="'
  out += id
  out += '">'
  out += labelSvg(label, x, y, halo.s, icons)
  out += labelSvg(label, x, y, attrs, icons)
  out += '</g>'
  return out
}
