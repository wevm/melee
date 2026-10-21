/**
 * @module Grid placement of architecture nodes and groups. Port of Pele's
 * `src/diagrams/architecture/layout.ts`.
 *
 * Mermaid hands the edge sides to a force-directed solver as relative placement constraints.
 * Pele applies them directly: every service and junction takes a cell, an edge `a:R -- L:b` puts
 * b in the cell to the right of a, and a group is a solid rectangle of cells, so a group never
 * encloses a node that is not in it. Each container (the diagram, then every group) is laid out
 * on its own, innermost first, and a finished group is placed in its parent as one block.
 */
import type { ArchEdge, ArchGroup, ArchLayoutHint, ArchNode } from './db.ts'
import { Direction, Side } from './parser.ts'

/** Cells of the nodes and groups. */
export type Grid = {
  /** Column of each node, in the order of the nodes passed in. */
  col: number[]
  /** Column of each group's top left cell. */
  groupCol: number[]
  /** Width of each group in cells. A group with nothing in it takes one cell. */
  groupCols: number[]
  /** Whether each group has nothing in it. */
  groupEmpty: boolean[]
  /** Parent group of each group, or -1. */
  groupParent: number[]
  /** Row of each group's top left cell. */
  groupRow: number[]
  /** Height of each group in cells. */
  groupRows: number[]
  /** Parent group of each node, or -1. */
  nodeParent: number[]
  /** Row of each node. */
  row: number[]
}

/** `Grid::default()`. */
export function gridDefault(): Grid {
  return {
    col: [],
    groupCol: [],
    groupCols: [],
    groupEmpty: [],
    groupParent: [],
    groupRow: [],
    groupRows: [],
    nodeParent: [],
    row: [],
  }
}

/** Step across for each side index: left, right, top, bottom. */
const DX: readonly number[] = [-1, 1, 0, 0]
/** Step down for each side index. */
const DY: readonly number[] = [0, 0, -1, 1]

/** The index of `side` in `DX` and `DY`. */
export function sideIndex(side: Side): number {
  switch (side) {
    case Side.L:
      return 0
    case Side.R:
      return 1
    case Side.T:
      return 2
    case Side.B:
      return 3
  }
}

/**
 * Blocks up to this many cells are found through the cell map; larger ones are compared one by
 * one.
 */
const SMALL = 64
const OFFSET = 1 << 25
const SPAN = 1 << 26

function at(values: readonly number[], i: number): number {
  return values[i] ?? 0
}

function atBool(values: readonly boolean[], i: number): boolean {
  return values[i] ?? false
}

function set<T>(values: T[], i: number, value: T): void {
  if (i >= 0 && i < values.length) values[i] = value
}

/** `count` copies of `value`. */
function filled<T>(count: number, value: T): T[] {
  const out: T[] = []
  for (let i = 0; i < count; i++) out.push(value)
  return out
}

function zeros(count: number): number[] {
  return filled(count, 0)
}

/** `count` empty lists. */
function lists(count: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < count; i++) out.push([])
  return out
}

function cellKey(cx: number, cy: number): number {
  return (cx + OFFSET) * SPAN + cy + OFFSET
}

/** The links that place items beside each other, as parallel arrays. */
type Links = {
  itemA: number[]
  itemB: number[]
  linkA: number[]
  linkB: number[]
  sideA: number[]
  sideB: number[]
}

function linksDefault(): Links {
  return { itemA: [], itemB: [], linkA: [], linkB: [], sideA: [], sideB: [] }
}

/** The state of one placement run. */
type Placer = {
  /** What the last {@link placerAnchor} call found. */
  ax: number
  ay: number
  cells: Map<number, number>
  edgeLinks: number[][]
  first: number
  h: number[]
  hints: number[][]
  large: number[]
  links: Links
  n: number
  order: number[]
  parent: number[]
  placed: boolean[]
  reach: Map<number, number>
  /** {@link reach} for blocks too far out or too large for a numeric key. */
  reachFar: Map<string, number>
  w: number[]
  x: number[]
  y: number[]
}

/** The position of `node` relative to its ancestor `item`, left in `self.ax` and `self.ay`. */
function placerAnchor(self: Placer, node: number, item: number): void {
  let ax = 0
  let ay = 0
  let cur = node
  while (cur !== item && cur < self.x.length) {
    ax += at(self.x, cur)
    ay += at(self.y, cur)
    cur = self.n + at(self.parent, cur)
  }
  self.ax = ax
  self.ay = ay
}

function placerPut(self: Placer, item: number, px: number, py: number): void {
  set(self.x, item, px)
  set(self.y, item, py)
  set(self.placed, item, true)
  self.order.push(item)
  const w = at(self.w, item)
  const h = at(self.h, item)
  if (w * h > SMALL) {
    self.large.push(item)
    return
  }
  for (let cy = py; cy < py + h; cy++) {
    for (let cx = px; cx < px + w; cx++) self.cells.set(cellKey(cx, cy), item)
  }
}

function placerOverlaps(self: Placer, item: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const x = at(self.x, item)
  const y = at(self.y, item)
  return x < rx + rw && rx < x + at(self.w, item) && y < ry + rh && ry < y + at(self.h, item)
}

function placerCollide(self: Placer, rx: number, ry: number, rw: number, rh: number): number | undefined {
  if (rw * rh > SMALL) {
    const order = self.order
    for (let i = self.first; i < order.length; i++) {
      const item = order[i] as number
      if (placerOverlaps(self, item, rx, ry, rw, rh)) return item
    }
    return undefined
  }
  for (let cy = ry; cy < ry + rh; cy++) {
    for (let cx = rx; cx < rx + rw; cx++) {
      const hit = self.cells.get(cellKey(cx, cy))
      if (hit !== undefined) return hit
    }
  }
  const large = self.large
  for (let i = 0; i < large.length; i++) {
    const item = large[i] as number
    if (placerOverlaps(self, item, rx, ry, rw, rh)) return item
  }
  return undefined
}

/** Bounds of the numeric {@link placerSlide} keys: positions within `±REACH_OFFSET`, sizes below `REACH_SPAN`. */
const REACH_SPAN = 2048
const REACH_OFFSET = 1024

/**
 * How far a block must slide along (`sx`, `sy`) to be clear. Each step jumps past what it hit,
 * and the result is kept, because a later block starting from the same place cannot stop
 * sooner.
 */
function placerSlide(self: Placer, rx: number, ry: number, rw: number, rh: number, sx: number, sy: number): number {
  // Every coordinate is a whole number and each step is -1, 0, or 1, so small blocks near the
  // origin have an exact numeric key below 2^53.
  const numeric =
    rx > -REACH_OFFSET &&
    rx < REACH_OFFSET &&
    ry > -REACH_OFFSET &&
    ry < REACH_OFFSET &&
    rw >= 0 &&
    rw < REACH_SPAN &&
    rh >= 0 &&
    rh < REACH_SPAN &&
    (sx === -1 || sx === 0 || sx === 1) &&
    (sy === -1 || sy === 0 || sy === 1)
  const code = numeric
    ? (((rx + REACH_OFFSET) * REACH_SPAN + ry + REACH_OFFSET) * REACH_SPAN + rw) * REACH_SPAN * 9 +
      rh * 9 +
      (sx + 1) * 3 +
      sy +
      1
    : 0
  const far = numeric ? '' : `${rx},${ry},${rw},${rh},${sx},${sy}`
  let k = (numeric ? self.reach.get(code) : self.reachFar.get(far)) ?? 0
  for (;;) {
    const hit = placerCollide(self, rx + k * sx, ry + k * sy, rw, rh)
    if (hit === undefined) break
    const hx = at(self.x, hit)
    const hy = at(self.y, hit)
    const hw = at(self.w, hit)
    const hh = at(self.h, hit)
    k = sx > 0 ? hx + hw - rx : sx < 0 ? rx + rw - hx : sy > 0 ? hy + hh - ry : ry + rh - hy
  }
  if (numeric) self.reach.set(code, k)
  else self.reachFar.set(far, k)
  return k
}

function placerFollow(self: Placer, from: number, k: number): void {
  const l = self.links
  const forward = at(l.itemA, k) === from
  const to = forward ? at(l.itemB, k) : at(l.itemA, k)
  if (atBool(self.placed, to)) return
  const sp = forward ? at(l.sideA, k) : at(l.sideB, k)
  const sq = forward ? at(l.sideB, k) : at(l.sideA, k)
  const nearLink = forward ? at(l.linkA, k) : at(l.linkB, k)
  const farLink = forward ? at(l.linkB, k) : at(l.linkA, k)
  placerAnchor(self, nearLink, from)
  const pax = self.ax
  const pay = self.ay
  placerAnchor(self, farLink, to)
  const ax = self.ax
  const ay = self.ay
  let dx = at(DX, sp)
  let dy = at(DY, sp)
  let shiftX = 0
  let shiftY = 0
  const facing = at(DX, sp) + at(DX, sq) === 0 && at(DY, sp) + at(DY, sq) === 0
  if (sp === sq) {
    // Like sides: the edge loops around, so the nodes stack across the direction it leaves in.
    dx = at(DX, sp) === 0 ? 1 : 0
    dy = 1 - dx
  } else if (!facing) {
    // A bend: one step along the side the edge leaves, one step back from the side it enters.
    shiftX = -at(DX, sq)
    shiftY = -at(DY, sq)
  }

  const xf = at(self.x, from)
  const yf = at(self.y, from)
  const wf = at(self.w, from)
  const hf = at(self.h, from)
  const wt = at(self.w, to)
  const ht = at(self.h, to)
  let bx: number
  let by: number
  if (dx === 0) {
    by = dy > 0 ? yf + hf : yf - ht
    bx = xf + pax + shiftX - ax
  } else {
    bx = dx > 0 ? xf + wf : xf - wt
    by = yf + pay + shiftY - ay
  }

  if (facing) {
    // When several placed nodes reach this one through the same pair of sides, line it up with
    // the middle one, not with whichever happened to be visited first.
    const list = self.edgeLinks[to]
    if (list !== undefined && list.length > 1) {
      const wanted: number[] = []
      for (const j of list) {
        const l = self.links
        const toIsB = at(l.itemB, j) === to
        const other = toIsB ? at(l.itemA, j) : at(l.itemB, j)
        const otherSide = toIsB ? at(l.sideA, j) : at(l.sideB, j)
        const ownSide = toIsB ? at(l.sideB, j) : at(l.sideA, j)
        if (!atBool(self.placed, other) || otherSide !== sp || ownSide !== sq) continue
        const otherLink = toIsB ? at(l.linkA, j) : at(l.linkB, j)
        const ownLink = toIsB ? at(l.linkB, j) : at(l.linkA, j)
        placerAnchor(self, otherLink, other)
        const spot = dx === 0 ? at(self.x, other) + self.ax : at(self.y, other) + self.ay
        placerAnchor(self, ownLink, to)
        wanted.push(spot - (dx === 0 ? self.ax : self.ay))
      }
      if (wanted.length > 1) {
        wanted.sort((a, b) => a - b)
        const middle = at(wanted, (wanted.length - 1) >> 1)
        if (dx === 0) bx = middle
        else by = middle
      }
    }
    // Taken: move sideways, to whichever side is nearer, so the edge can still leave straight.
    const px = dx === 0 ? 1 : 0
    const py = 1 - px
    const forth = placerSlide(self, bx, by, wt, ht, px, py)
    const back = forth === 0 ? 0 : placerSlide(self, bx, by, wt, ht, -px, -py)
    const near = forth <= back ? forth : -back
    bx += px * near
    by += py * near
  } else {
    const far = placerSlide(self, bx, by, wt, ht, dx, dy)
    bx += dx * far
    by += dy * far
  }
  placerPut(self, to, bx, by)
}

/** Lays out the children of container `c` and, for a group, records its size. */
function placerLayout(self: Placer, c: number, items: number[], groups: number): void {
  if (items.length === 0) return
  self.order = []
  const starts: number[] = []
  for (const start of items) {
    if (atBool(self.placed, start)) continue
    self.first = self.order.length
    starts.push(self.first)
    self.cells.clear()
    self.large = []
    self.reach.clear()
    self.reachFar.clear()
    placerPut(self, start, 0, 0)
    // Declared alignments are followed as soon as a node is placed, ahead of any edge.
    let hintAt = self.first
    let edgeAt = self.first
    let linkAt = 0
    for (;;) {
      if (hintAt < self.order.length) {
        const from = at(self.order, hintAt)
        hintAt += 1
        const count = self.hints[from]?.length ?? 0
        for (let j = 0; j < count; j++) {
          const list = self.hints[from]
          const k = list === undefined ? 0 : at(list, j)
          placerFollow(self, from, k)
        }
        continue
      }
      if (edgeAt >= self.order.length) break
      const from = at(self.order, edgeAt)
      const next = self.edgeLinks[from]?.[linkAt]
      if (next === undefined) {
        edgeAt += 1
        linkAt = 0
        continue
      }
      linkAt += 1
      placerFollow(self, from, next)
    }
  }
  starts.push(self.order.length)

  // Unconnected parts go side by side, wrapping into rows that keep the whole roughly square.
  const count = starts.length - 1
  const minX: number[] = zeros(count)
  const minY: number[] = zeros(count)
  const partW: number[] = zeros(count)
  const partH: number[] = zeros(count)
  let area = 0
  let widest = 0
  for (let p = 0; p < count; p++) {
    let x0 = Number.MAX_SAFE_INTEGER
    let y0 = Number.MAX_SAFE_INTEGER
    let x1 = Number.MIN_SAFE_INTEGER
    let y1 = Number.MIN_SAFE_INTEGER
    for (let i = at(starts, p); i < at(starts, p + 1); i++) {
      const item = at(self.order, i)
      x0 = Math.min(x0, at(self.x, item))
      y0 = Math.min(y0, at(self.y, item))
      x1 = Math.max(x1, at(self.x, item) + at(self.w, item))
      y1 = Math.max(y1, at(self.y, item) + at(self.h, item))
    }
    set(minX, p, x0)
    set(minY, p, y0)
    set(partW, p, x1 - x0)
    set(partH, p, y1 - y0)
    area += (x1 - x0) * (y1 - y0)
    widest = Math.max(widest, x1 - x0)
  }
  const limit = Math.max(widest, Math.ceil(Math.sqrt(area * 2)))
  let cx = 0
  let cy = 0
  let shelf = 0
  let width = 0
  for (let p = 0; p < count; p++) {
    const pw = at(partW, p)
    if (cx > 0 && cx + pw > limit) {
      cy += shelf
      cx = 0
      shelf = 0
    }
    for (let i = at(starts, p); i < at(starts, p + 1); i++) {
      const item = at(self.order, i)
      const x = at(self.x, item)
      const y = at(self.y, item)
      set(self.x, item, x + cx - at(minX, p))
      set(self.y, item, y + cy - at(minY, p))
    }
    cx += pw
    shelf = Math.max(shelf, at(partH, p))
    width = Math.max(width, cx)
  }
  if (c < groups) {
    set(self.w, self.n + c, width)
    set(self.h, self.n + c, cy + shelf)
  }
}

/**
 * Adds a link asking for node `b` to sit on side `sb` of node `a`'s side `sa`, between the two
 * children of the innermost container that holds both, and lists it for both children.
 */
function addLink(
  links: Links,
  parent: number[],
  depth: number[],
  n: number,
  a: number,
  b: number,
  sa: number,
  sb: number,
  lists: number[][],
): void {
  if (a === b) return
  let ia = a
  let ib = b
  let ca = at(parent, a)
  let cb = at(parent, b)
  while (ca !== cb) {
    if (at(depth, ca) >= at(depth, cb)) {
      ia = n + ca
      ca = at(parent, ia)
    } else {
      ib = n + cb
      cb = at(parent, ib)
    }
  }
  const k = links.linkA.length
  links.linkA.push(a)
  links.linkB.push(b)
  links.sideA.push(sa)
  links.sideB.push(sb)
  links.itemA.push(ia)
  links.itemB.push(ib)
  lists[ia]?.push(k)
  lists[ib]?.push(k)
}

/**
 * Places `nodes` and `groups` on a grid so each edge's sides and each alignment hold where they
 * can.
 */
export function placeOnGrid(nodes: ArchNode[], groups: ArchGroup[], edges: ArchEdge[], hints: ArchLayoutHint[]): Grid {
  const n = nodes.length
  const gCount = groups.length
  const root = gCount
  const nodeIndex = new Map<string, number>()
  const groupIndex = new Map<string, number>()
  // Items are nodes (0..N-1) then groups (N..N+G-1). Containers are groups (0..G-1) then the
  // root.
  const parent: number[] = filled(n + gCount, root)
  const depth: number[] = zeros(gCount + 1)
  const kids: number[][] = lists(gCount + 1)
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g] as ArchGroup
    groupIndex.set(group.id, g)
    const p = group.in === undefined ? undefined : groupIndex.get(group.in)
    if (p !== undefined && p !== g) {
      set(parent, n + g, p)
      const d = at(depth, p) + 1
      set(depth, g, d)
    } else {
      set(depth, g, 1)
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as ArchNode
    nodeIndex.set(node.id, i)
    const p = node.in === undefined ? undefined : groupIndex.get(node.in)
    if (p !== undefined) set(parent, i, p)
    kids[at(parent, i)]?.push(i)
  }
  for (let g = 0; g < gCount; g++) kids[at(parent, n + g)]?.push(n + g)

  // A link asks for one node to sit beside another. It belongs to the innermost container that
  // holds both ends, and there it relates the two children of that container the ends are in.
  const links = linksDefault()
  const hintLinks: number[][] = lists(n + gCount)
  const edgeLinks: number[][] = lists(n + gCount)
  for (const hint of hints) {
    const row = hint.direction === Direction.Row
    for (let m = 0; m + 1 < hint.members.length; m++) {
      const prev = hint.members[m] as string
      const cur = hint.members[m + 1] as string
      const a = nodeIndex.get(prev)
      const b = nodeIndex.get(cur)
      if (a !== undefined && b !== undefined) {
        addLink(links, parent, depth, n, a, b, row ? 1 : 3, row ? 0 : 2, hintLinks)
      }
    }
  }
  // An edge between two like sides says least about where its ends go, so those come last.
  for (let pass = 0; pass < 2; pass++) {
    const likeSides = pass === 1
    for (const edge of edges) {
      if ((edge.lhsDir === edge.rhsDir) !== likeSides) continue
      const a = nodeIndex.get(edge.lhsId)
      const b = nodeIndex.get(edge.rhsId)
      if (a !== undefined && b !== undefined) {
        addLink(links, parent, depth, n, a, b, sideIndex(edge.lhsDir), sideIndex(edge.rhsDir), edgeLinks)
      }
    }
  }

  // Position of each item in its container, and its size in cells.
  const placer: Placer = {
    ax: 0,
    ay: 0,
    cells: new Map(),
    edgeLinks,
    first: 0,
    h: filled(n + gCount, 1),
    hints: hintLinks,
    large: [],
    links,
    n,
    order: [],
    parent,
    placed: filled(n + gCount, false),
    reach: new Map(),
    reachFar: new Map(),
    w: filled(n + gCount, 1),
    x: zeros(n + gCount),
    y: zeros(n + gCount),
  }
  for (let c = gCount - 1; c >= 0; c--) {
    const items = (kids[c] ?? []).slice()
    placerLayout(placer, c, items, gCount)
  }
  const items = (kids[root] ?? []).slice()
  placerLayout(placer, root, items, gCount)

  const grid: Grid = {
    col: zeros(n),
    groupCol: zeros(gCount),
    groupCols: placer.w.slice(n),
    groupEmpty: filled(gCount, false),
    groupParent: zeros(gCount),
    groupRow: zeros(gCount),
    groupRows: placer.h.slice(n),
    nodeParent: zeros(n),
    row: zeros(n),
  }
  for (let g = 0; g < gCount; g++) {
    const p = at(placer.parent, n + g)
    const baseCol = p === root ? 0 : at(grid.groupCol, p)
    const baseRow = p === root ? 0 : at(grid.groupRow, p)
    set(grid.groupParent, g, p === root ? -1 : p)
    set(grid.groupCol, g, at(placer.x, n + g) + baseCol)
    set(grid.groupRow, g, at(placer.y, n + g) + baseRow)
    if ((kids[g] ?? []).length === 0) set(grid.groupEmpty, g, true)
  }
  for (let i = 0; i < n; i++) {
    const p = at(placer.parent, i)
    const baseCol = p === root ? 0 : at(grid.groupCol, p)
    const baseRow = p === root ? 0 : at(grid.groupRow, p)
    set(grid.nodeParent, i, p === root ? -1 : p)
    set(grid.col, i, at(placer.x, i) + baseCol)
    set(grid.row, i, at(placer.y, i) + baseRow)
  }
  return grid
}
