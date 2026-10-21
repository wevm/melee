/** @module Squarified treemap layout. Port of Pele's `src/diagrams/treemap/layout.ts`. */
import { jsRound } from '../../svg/builder.ts'
import { fmax, fmin, totalCmp } from '../../util/rust.ts'
import type { TreemapNode } from './model.ts'

/** A node's rectangle. Boxes link to their parent and children by index into one list. */
export type Layout = {
  /** Indices of the child boxes. */
  children: number[]
  /** Height. */
  h: number
  /** The node. */
  node: TreemapNode
  /** Index of the parent box. */
  parent: number | undefined
  /**
   * Position among the top-level nodes of the branch this box belongs to, which picks its
   * color.
   */
  series: number
  /** A leaf's own value, or the sum of the leaves under a section. */
  value: number
  /** Width. */
  w: number
  /** Left edge. */
  x: number
  /** Top edge. */
  y: number
}

/** Space around boxes: Pele's `Insets`. */
export type Insets = {
  /** Space between boxes. */
  gap: number
  /** Space a section keeps for its header. */
  header: number
  /** Space a section keeps around its children on the other three sides. */
  side: number
}

/** A box for `node`, valued by its own value when it is a positive leaf. */
function newBox(node: TreemapNode, parent: number | undefined, series: number): Layout {
  const own = node.value
  const value = node.children === undefined && own !== undefined && Number.isFinite(own) && own > 0 ? own : 0
  return { children: [], h: 0, node, parent, series, value, w: 0, x: 0, y: 0 }
}

/**
 * Lays out the boxes `shown` in the rectangle as one squarified treemap: rows are added along the
 * shorter side, and a row stops growing when another box would make its boxes less square.
 */
function squarify(boxes: Layout[], shown: number[], total: number, rect: [number, number, number, number], gap: number): void {
  let [x, y, w, h] = rect
  const value = (i: number): number => {
    const k = shown[i]
    return k === undefined ? 0 : (boxes[k]?.value ?? 0)
  }
  let rest = total
  let from = 0
  while (from < shown.length) {
    const scale = (w * h) / rest
    const side = fmin(w, h)
    let sum = value(from) * scale
    const largest = sum
    let worst = fmax((side * side * largest) / (sum * sum), (sum * sum) / (side * side * largest))
    let to = from + 1
    while (to < shown.length) {
      const smallest = value(to) * scale
      const next = sum + smallest
      const ratio = fmax((side * side * largest) / (next * next), (next * next) / (side * side * smallest))
      if (ratio > worst) break
      worst = ratio
      sum = next
      to += 1
    }

    const thickness = sum / side
    let offset = 0
    for (let i = from; i < to; i++) {
      const k = shown[i]
      const b = k === undefined ? undefined : boxes[k]
      if (b === undefined) continue
      const length = i === to - 1 ? side - offset : (b.value * scale) / thickness
      const bx = w >= h ? x : x + offset
      const by = w >= h ? y + offset : y
      const x0 = jsRound(bx + gap / 2)
      const y0 = jsRound(by + gap / 2)
      b.x = x0
      b.y = y0
      b.w = jsRound(bx + (w >= h ? thickness : length) - gap / 2) - x0
      b.h = jsRound(by + (w >= h ? length : thickness) - gap / 2) - y0
      offset += length
      rest -= b.value
    }
    if (w >= h) {
      x += thickness
      w -= thickness
    } else {
      y += thickness
      h -= thickness
    }
    from = to
  }
}

/**
 * Lays out the children `children` of a box in the rectangle, adding the boxes that get a size
 * to `placed`.
 */
function place(boxes: Layout[], placed: number[], children: number[], rect: [number, number, number, number], gap: number): void {
  const [x, y, w, h] = rect
  if (w <= 0 || h <= 0) return
  const value = (k: number): number => boxes[k]?.value ?? 0
  const shown = children.filter((k) => {
    const b = boxes[k]
    return b !== undefined && b.value > 0
  })
  shown.sort((a, b) => totalCmp(value(b), value(a)))
  let total = 0
  for (const k of shown) total += value(k)
  if (shown.length === 0 || !Number.isFinite(total)) return

  squarify(boxes, shown, total, [x - gap / 2, y - gap / 2, w + gap, h + gap], gap)
  for (const k of shown) {
    const b = boxes[k]
    if (b !== undefined && b.w > 0 && b.h > 0) placed.push(k)
  }
}

/**
 * Lays out `roots` in a `width` by `height` rectangle. Returns every box and the indices of
 * those with a size, parents before their children.
 */
export function layoutTreemap(roots: TreemapNode[], width: number, height: number, insets: Insets): [Layout[], number[]] {
  const boxes: Layout[] = roots.map((node, index) => newBox(node, undefined, index))
  const top: number[] = boxes.map((_, k) => k)
  for (let i = 0; i < boxes.length; i++) {
    const parent = boxes[i] as Layout
    const node = parent.node
    const series = parent.series
    for (const child of node.children ?? []) {
      const k = boxes.length
      boxes.push(newBox(child, i, series))
      parent.children.push(k)
    }
  }
  for (let k = boxes.length - 1; k >= 0; k--) {
    const b = boxes[k] as Layout
    if (b.parent !== undefined) {
      const parent = boxes[b.parent]
      if (parent !== undefined) parent.value += b.value
    }
  }

  const { gap, header, side } = insets
  const placed: number[] = []
  place(boxes, placed, top, [0, 0, width, height], gap)
  for (let i = 0; i < placed.length; i++) {
    const k = placed[i] as number
    const b = boxes[k]
    if (b !== undefined && b.children.length > 0) {
      const children = b.children.slice()
      const rect: [number, number, number, number] = [b.x + side, b.y + header, b.w - 2 * side, b.h - header - side]
      place(boxes, placed, children, rect, gap)
    }
  }
  return [boxes, placed]
}
