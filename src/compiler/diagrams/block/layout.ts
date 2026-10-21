/**
 * @module The block grid: places each block in its container's columns and sizes the containers.
 * Port of Pele's `src/diagrams/block/layout.ts`.
 */
import { Code, errorNew } from '../../error.ts'
import { fmax, fmin } from '../../util/rust.ts'

/** A block in the grid. Cells live in one list and name their children by index. */
export type Cell = {
  /** Child cells, by index. */
  children: number[]
  /** Grid column. */
  col: number
  /** Number of columns in use. */
  cols: number
  /** Grid width of this container: a positive count, or -1 to put every child on one row. */
  columns: number
  /** Height in pixels. */
  h: number
  /** Height reserved above a container's grid for its title. */
  head: number
  /** Height of each row. */
  heights: number[]
  /** Height the content needs. Set by the caller for leaves, computed here for containers. */
  nh: number
  /** Width the content needs. Set by the caller for leaves, computed here for containers. */
  nw: number
  /** Grid row. */
  row: number
  /** Whether the cell is empty space. */
  space: boolean
  /** Number of columns spanned. */
  span: number
  /** Width in pixels. */
  w: number
  /** Center x. */
  x: number
  /** Center y. */
  y: number
}

/** `Cell::default()`. */
export function cellDefault(): Cell {
  return {
    children: [],
    col: 0,
    cols: 0,
    columns: 0,
    h: 0,
    head: 0,
    heights: [],
    nh: 0,
    nw: 0,
    row: 0,
    space: false,
    span: 0,
    w: 0,
    x: 0,
    y: 0,
  }
}

const MAX_SPAN = 1000

/** Whether `columns` is a grid width Pele's `calculateBlockPosition` accepts. */
function validColumns(columns: number): boolean {
  return columns !== 0 && Number.isFinite(columns) && Math.trunc(columns) === columns
}

/**
 * The error Pele's `calculateBlockPosition` throws for a grid width of 0.
 *
 * Throws a semantic error when a container with children has an invalid grid width.
 */
export function checkColumns(columns: number): void {
  if (validColumns(columns)) return
  const error = errorNew(Code.Semantic, 'Columns must be an integer !== 0.')
  error.type = 'block'
  throw error
}

/** The grid column and row of a position. `columns` has been checked. */
function blockPosition(columns: number, position: number): [number, number] {
  if (columns < 0) return [position, 0]
  return [position % columns, Math.floor(position / columns)]
}

/**
 * Puts each child in its grid cell and sizes the container. Every column is as wide as the widest
 * block needs. Every row that holds a plain block is as tall as the tallest block in the
 * container, as in Mermaid. A row of nothing but containers is only as tall as they need.
 */
function measure(cells: Cell[], at: number, gap: number, inset: number): void {
  const cell = cells[at]
  if (cell === undefined) return
  const columns = cell.columns
  const children = cell.children.slice()
  const heights: number[] = []
  let position = 0
  let cols = 0
  let cw = 0
  let tallest = 0
  for (const c of children) {
    const child = cells[c]
    if (child === undefined) continue
    const [px, py] = blockPosition(columns, position)
    // Mermaid lets a block wider than the rest of its row stick out of the grid. Here it stops
    // at the last column.
    let span = child.span >= 1 ? fmin(child.span, MAX_SPAN) : 1
    if (columns > 0 && span > columns - px) span = columns - px
    child.span = span
    child.col = px
    child.row = py
    position += span
    if (px + span > cols) cols = px + span
    if (py === heights.length) heights.push(0)
    const height = heights[py]
    if (height !== undefined) {
      if (child.children.length === 0) heights[py] = -1
      else if (height >= 0 && child.nh > height) heights[py] = child.nh
    }
    if (child.space) continue
    const width = (child.nw - gap * (span - 1)) / span
    if (width > cw) cw = width
    if (child.nh > tallest) tallest = child.nh
  }

  let height = (heights.length - 1) * gap
  for (let r = 0; r < heights.length; r++) {
    if ((heights[r] as number) < 0) heights[r] = tallest
    height += heights[r] as number
  }
  const target = cells[at]
  if (target !== undefined) {
    target.cols = cols
    target.heights = heights
    target.nw = fmax(target.nw, cols * cw + (cols - 1) * gap + 2 * inset)
    target.nh = height + 2 * inset + target.head
  }
}

/** Gives each child its cell, sharing out any room the container has beyond what it needs. */
function arrange(cells: Cell[], at: number, gap: number, inset: number): void {
  const cell = cells[at]
  if (cell === undefined) return
  const cols = cell.cols
  const heights = cell.heights.slice()
  const children = cell.children.slice()
  const rows = heights.length
  const cw = (cell.w - 2 * inset - (cols - 1) * gap) / cols
  const room = cell.h - 2 * inset - cell.head - (rows - 1) * gap
  let needed = 0
  for (const height of heights) needed += height
  const scale = needed > 0 ? room / needed : 0
  const share = needed > 0 ? 0 : room / rows
  const left = cell.x - cell.w / 2 + inset
  let top = cell.y - cell.h / 2 + inset + cell.head
  let row = 0
  for (const c of children) {
    const child = cells[c]
    if (child === undefined) continue
    while (row < child.row) {
      top += (heights[row] ?? 0) * scale + share + gap
      row += 1
    }
    child.w = cw * child.span + gap * (child.span - 1)
    child.h = (heights[row] ?? 0) * scale + share
    child.x = left + child.col * (cw + gap) + child.w / 2
    child.y = top + child.h / 2
  }
}

/**
 * Lays out a tree of cells in place, `cells[0]` the root, listed so that every cell comes after
 * its parent in breadth-first order. The root has no border, so its grid starts at the origin.
 * Returns the root's width and height.
 */
export function layout(cells: Cell[], gap: number): [number, number] {
  for (let at = cells.length - 1; at >= 0; at--) {
    const cell = cells[at]
    if (cell !== undefined && cell.children.length > 0) measure(cells, at, gap, at === 0 ? 0 : gap)
  }
  const root = cells[0]
  if (root === undefined) return [0, 0]
  root.w = root.nw
  root.h = root.nh
  root.x = root.w / 2
  root.y = root.h / 2
  const size: [number, number] = [root.w, root.h]
  for (let at = 0; at < cells.length; at++) {
    const cell = cells[at]
    if (cell !== undefined && cell.children.length > 0) arrange(cells, at, gap, at === 0 ? 0 : gap)
  }
  return size
}
