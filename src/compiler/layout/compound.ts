/**
 * @module Lays out nested groups, each in its own direction, on top of the layered layout.
 * Port of Pele's `src/layout/compound.ts`.
 *
 * Each group is laid out on its own and placed in its parent as a single box. An edge that
 * crosses a group's border passes through a port on the side facing its other end.
 */
import {
  Kind,
  type LEdge,
  type LNode,
  type LayeredOptions,
  layered,
  ledge,
  lnode,
  orient,
  rank,
} from './layered.ts'
import { fmax, fmin, midpoint, partialCmp, retain, saturatingSub } from '../util/rust.ts'

/** A flow direction. */
export const Dir = {
  /** Bottom to top. */
  Bt: 'Bt',
  /** Left to right. */
  Lr: 'Lr',
  /** Right to left. */
  Rl: 'Rl',
  /** Top to bottom. */
  Tb: 'Tb',
} as const

/** A flow direction. */
export type Dir = (typeof Dir)[keyof typeof Dir]

/** The direction a diagram names, or top to bottom for anything else. */
export function direction(dir: string | undefined): Dir {
  switch (dir) {
    case 'BT':
      return Dir.Bt
    case 'LR':
      return Dir.Lr
    case 'RL':
      return Dir.Rl
    default:
      return Dir.Tb
  }
}

/** A node or group in a compound layout. Mirrors Pele's `CNode`. */
export type CNode = {
  /** The direction inside a group, when it sets its own. */
  dir: Dir | undefined
  /** Height. */
  h: number
  /** Whether the node is a group. */
  isGroup: boolean
  /** Least width of a group. */
  minW: number
  /** Padding below a group's members. */
  padBottom: number
  /** Padding beside a group's members. */
  padX: number
  /** Padding above a group's members. */
  padTop: number
  /** Index of the enclosing group, or -1 at the top level. */
  parent: number
  /** Declaration order; a group takes the smallest value among its members. */
  seq: number
  /**
   * How much of a side its edges may spread along, measured across the flow; 0 keeps them at
   * its middle.
   */
  span: number
  /** Width. */
  w: number
  /** Center x after layout. */
  x: number
  /** Center y after layout. */
  y: number
}

/** An edge in a compound layout. Mirrors Pele's `CEdge`. */
export type CEdge = {
  /** Index of the head node. */
  dst: number
  /** Label height. */
  labelH: number
  /** Label width. */
  labelW: number
  /** Label center x after layout. */
  labelX: number
  /** Label center y after layout. */
  labelY: number
  /** Least number of ranks the edge spans. */
  minlen: number
  /**
   * `x, y, axis` triples. Axis is 0 where the edge runs vertically into the point, 1
   * horizontally.
   */
  route: number[]
  /** Index of the tail node. */
  src: number
}

/** `CEdge::default()`. */
export function cEdgeDefault(): CEdge {
  return { dst: 0, labelH: 0, labelW: 0, labelX: 0, labelY: 0, minlen: 0, route: [], src: 0 }
}

/** The size of a compound layout. */
export type CompoundResult = {
  /** Height. */
  height: number
  /** Width. */
  width: number
}

/** `CompoundResult::default()`. */
export function compoundResultDefault(): CompoundResult {
  return { height: 0, width: 0 }
}

/** A side of a box, clockwise from the top. */
const Side = {
  /** The bottom side. */
  Bottom: 'Bottom',
  /** The left side. */
  Left: 'Left',
  /** The right side. */
  Right: 'Right',
  /** The top side. */
  Top: 'Top',
} as const

/** A side of a box, clockwise from the top. */
type Side = (typeof Side)[keyof typeof Side]

/** Where an edge crosses the border of a group, as seen from inside the group. */
type PortEdge = {
  /** The edge. */
  e: number
  /** The member of the group that the edge leaves or reaches. */
  inner: number
  /** Whether the edge leaves the group here. */
  out: boolean
  /** Where the port sits on the group's border, in the group's box. */
  px: number
  /** Where the port sits on the group's border, in the group's box. */
  py: number
  /** The edge's route inside the group's box, between the port and `inner`. */
  route: number[]
  /** The side of the group the port is on. */
  side: Side
}

/** An edge between two items of one level. */
type LevelEdge = {
  /** The item at the tail end. */
  a: number
  /** The item at the head end. */
  b: number
  /** The edge. */
  e: number
}

/** The diagram or a group, laid out on its own. */
type Level = {
  /** The direction of its flow. */
  dir: Dir
  /** The edges between its items. */
  edges: LevelEdge[]
  /** The group, or `undefined` for the diagram. */
  id: number | undefined
  /** Its members, in declaration order. */
  items: number[]
  /** Each port by `edge * 2`, plus 1 where the edge arrives, as an index into `ports`. */
  portOf: Map<number, number>
  /** The edges that cross its border. */
  ports: PortEdge[]
  /** Left of its box in diagram coordinates. */
  x: number
  /** Top of its box in diagram coordinates. */
  y: number
}

/**
 * Past this many group border crossings, edges are drawn between the groups that hold their
 * ends.
 */
const MAX_PORTS = 40000

/** An array of `len` copies of `value`, built without the `Array.prototype.fill` builtin. */
function numbers(len: number, value: number): number[] {
  const a: number[] = []
  for (let i = 0; i < len; i++) a.push(value)
  return a
}

/** An array of `len` copies of `value`. */
function bools(len: number, value: boolean): boolean[] {
  const a: boolean[] = []
  for (let i = 0; i < len; i++) a.push(value)
  return a
}

/** An array of `len` empty slots. */
function nones(len: number): (number | undefined)[] {
  const a: (number | undefined)[] = []
  for (let i = 0; i < len; i++) a.push(undefined)
  return a
}

/** Moves a finished layout by `ox`, `oy`: nodes, routes, and labels. */
export function shiftLayout(nodes: CNode[], edges: CEdge[], ox: number, oy: number): void {
  for (const c of nodes) {
    c.x += ox
    c.y += oy
  }
  for (const e of edges) {
    const route = e.route
    for (let i = 0; i + 3 <= route.length; i += 3) {
      route[i] = (route[i] as number) + ox
      route[i + 1] = (route[i + 1] as number) + oy
    }
    e.labelX += ox
    e.labelY += oy
  }
}

/** A node of the given size inside `parent`, as Pele's `cnode` creates it. */
export function cnode(w: number, h: number, parent: number): CNode {
  return {
    dir: undefined,
    h,
    isGroup: false,
    minW: 0,
    padBottom: 0,
    padX: 0,
    padTop: 0,
    parent,
    seq: 0,
    span: 0,
    w,
    x: 0,
    y: 0,
  }
}

/** The side that a flow starts from. */
function startSide(dir: Dir): Side {
  switch (dir) {
    case Dir.Tb:
      return Side.Top
    case Dir.Bt:
      return Side.Bottom
    case Dir.Lr:
      return Side.Left
    case Dir.Rl:
      return Side.Right
  }
}

/** The side across from `side`. */
function opposite(side: Side): Side {
  switch (side) {
    case Side.Top:
      return Side.Bottom
    case Side.Right:
      return Side.Left
    case Side.Bottom:
      return Side.Top
    case Side.Left:
      return Side.Right
  }
}

/** Adds a level for group `id`, or the diagram for `undefined`, and returns its index. */
function pushLevel(levels: Level[], id: number | undefined, dir: Dir, items: number[]): number {
  levels.push({
    dir,
    edges: [],
    id,
    items,
    portOf: new Map(),
    ports: [],
    x: 0,
    y: 0,
  })
  return levels.length - 1
}

/**
 * Places the items of the levels from `from` on, breadth first, adding a level for each group
 * among them, which comes in its parent's direction unless it sets its own.
 */
function descend(
  levels: Level[],
  levelOf: (number | undefined)[],
  depth: number[],
  placed: boolean[],
  nodes: CNode[],
  children: number[][],
  from: number,
): void {
  let q = from
  while (q < levels.length) {
    const level = levels[q] as Level
    const dir = level.dir
    const id = level.id
    for (let k = 0; k < level.items.length; k++) {
      const item = level.items[k] as number
      placed[item] = true
      depth[item] = id === undefined ? 0 : (depth[id] as number) + 1
      const node = nodes[item] as CNode
      if (node.isGroup) {
        const own = node.dir ?? dir
        levelOf[item] = pushLevel(levels, item, own, (children[item] as number[]).slice())
      }
    }
    q += 1
  }
}

/** The key of an edge's port in `Level.portOf`. */
function portKey(e: number, out: boolean): number {
  return e * 2 + (out ? 0 : 1)
}

/** The port that edge `e` passes through on the border of group `item`. */
function portOf(
  levels: Level[],
  levelOf: (number | undefined)[],
  item: number,
  e: number,
  out: boolean,
): PortEdge | undefined {
  const q = levelOf[item]
  if (q === undefined) return undefined
  const level = levels[q]
  if (level === undefined) return undefined
  const k = level.portOf.get(portKey(e, out))
  if (k === undefined) return undefined
  return level.ports[k]
}

/** Whether the edge's end lies below `item` rather than at it. */
function endpointBelow(item: number, e: CEdge, out: boolean): boolean {
  return (out ? e.src : e.dst) !== item
}

/** The enclosing group of a node whose parent has been checked. */
function parentOf(nodes: CNode[], i: number): number | undefined {
  const parent = (nodes[i] as CNode).parent
  return parent >= 0 ? parent : undefined
}

/** The level that holds the members of `parent`, the diagram's for `undefined`. */
function levelIndex(levelOf: (number | undefined)[], parent: number | undefined): number | undefined {
  return parent === undefined ? 0 : levelOf[parent]
}

/**
 * The layered graph of one level: its items, the edges between them, and an edge to a port
 * node for each crossing on the start or end side. `dummies` gives each port's node. Without
 * `sized`, every node is a point, which is enough to rank them.
 */
function build(
  levels: Level[],
  levelOf: (number | undefined)[],
  q: number,
  nodes: CNode[],
  edges: CEdge[],
  local: number[],
  sized: boolean,
): [LNode[], LEdge[], (number | undefined)[]] {
  const level = levels[q] as Level
  const vertical = level.dir === Dir.Tb || level.dir === Dir.Bt
  const start = startSide(level.dir)
  const lnodes: LNode[] = []
  const ledges: LEdge[] = []
  for (let i = 0; i < level.items.length; i++) {
    const item = level.items[i] as number
    local[item] = i
    const node = nodes[item] as CNode
    let ln: LNode
    if (sized) {
      const w = vertical ? node.w : node.h
      const h = vertical ? node.h : node.w
      ln = lnode(w, h, Kind.Node)
    } else {
      ln = lnode(0, 0, Kind.Node)
    }
    ln.span = node.isGroup ? fmin(node.span, ln.w - 2 * node.padX) : node.span
    lnodes.push(ln)
  }
  for (const le of level.edges) {
    const e = edges[le.e] as CEdge
    const edge = ledge(local[le.a] as number, local[le.b] as number, e.minlen, 0, 0)
    if (sized) {
      edge.labelW = vertical ? e.labelW : e.labelH
      edge.labelH = vertical ? e.labelH : e.labelW
      edge.tailDx = offset(levels, levelOf, nodes, edges, vertical, le.a, le.e, true)
      edge.headDx = offset(levels, levelOf, nodes, edges, vertical, le.b, le.e, false)
      edge.tailFixed = held(nodes, edges, le.a, le.e, true)
      edge.headFixed = held(nodes, edges, le.b, le.e, false)
    }
    ledges.push(edge)
  }
  const dummies: (number | undefined)[] = nones(level.ports.length)
  for (let i = 0; i < level.ports.length; i++) {
    const port = level.ports[i] as PortEdge
    if (port.side === start || port.side === opposite(start)) {
      const d = lnodes.length
      const kind = port.side === start ? Kind.StartPort : Kind.EndPort
      lnodes.push(lnode(0, 0, kind))
      dummies[i] = d
      const inner = local[port.inner] as number
      const edge = port.out ? ledge(inner, d, 1, 0, 0) : ledge(d, inner, 1, 0, 0)
      if (port.out) {
        edge.tailDx = sized ? offset(levels, levelOf, nodes, edges, vertical, port.inner, port.e, true) : 0
        edge.tailFixed = held(nodes, edges, port.inner, port.e, true)
      } else {
        edge.headDx = sized ? offset(levels, levelOf, nodes, edges, vertical, port.inner, port.e, false) : 0
        edge.headFixed = held(nodes, edges, port.inner, port.e, false)
      }
      ledges.push(edge)
    } else {
      const ln = lnodes[local[port.inner] as number]
      if (ln !== undefined) ln.pin = port.side === Side.Top || port.side === Side.Left ? -1 : 1
    }
  }
  return [lnodes, ledges, dummies]
}

/** Removes `child` from a group's `list` of children. */
function removeChild(list: number[], child: number): void {
  retain(list, (c) => c !== child)
}

/** The enclosing group of `i`, or `i` itself at the top level. */
function upOf(nodes: CNode[], i: number): number {
  return parentOf(nodes, i) ?? i
}

/** Whether an edge of `level` ends inside one of its groups, which needs the level ranked. */
function needsSides(level: Level, nodes: CNode[], edges: CEdge[]): boolean {
  for (const le of level.edges) {
    const e = edges[le.e] as CEdge
    if (((nodes[le.a] as CNode).isGroup && e.src !== le.a) || ((nodes[le.b] as CNode).isGroup && e.dst !== le.b)) {
      return true
    }
  }
  return false
}

/** How a level's layered layout maps into its box. */
type Frame = {
  /** Whether the flow runs up or left. */
  flip: boolean
  /** Height of the layered layout. */
  height: number
  /** Left of the layout in the box. */
  offX: number
  /** Top of the layout in the box. */
  offY: number
  /** Whether the flow runs up or down. */
  vertical: boolean
}

/** The box x of layout point `lx`, `ly`. */
function frameX(f: Frame, lx: number, ly: number): number {
  return f.offX + (f.vertical ? lx : f.flip ? f.height - ly : ly)
}

/** The box y of layout point `lx`, `ly`. */
function frameY(f: Frame, lx: number, ly: number): number {
  return f.offY + (!f.vertical ? lx : f.flip ? f.height - ly : ly)
}

/** A layout route of `x, y` pairs as box `x, y, axis` triples. */
function convert(f: Frame, points: number[]): number[] {
  const axis = f.vertical ? 0 : 1
  const out: number[] = []
  for (let i = 0; i + 2 <= points.length; i += 2) {
    const x = points[i] as number
    const y = points[i + 1] as number
    out.push(frameX(f, x, y), frameY(f, x, y), axis)
  }
  return out
}

/** The x where a line from x across `side` of a box `boxW` wide meets it. */
function borderX(side: Side, x: number, boxW: number): number {
  switch (side) {
    case Side.Top:
    case Side.Bottom:
      return x
    case Side.Left:
      return 0
    case Side.Right:
      return boxW
  }
}

/** The y where a line from y across `side` of a box `boxH` high meets it. */
function borderY(side: Side, y: number, boxH: number): number {
  switch (side) {
    case Side.Top:
      return 0
    case Side.Bottom:
      return boxH
    case Side.Left:
    case Side.Right:
      return y
  }
}

/** Whether the end of edge `ei` at `item` is held where its port on the group's border puts it. */
function held(nodes: CNode[], edges: CEdge[], item: number, ei: number, out: boolean): boolean {
  return (nodes[item] as CNode).isGroup && endpointBelow(item, edges[ei] as CEdge, out)
}

/** Where a held end of edge `ei` meets `item`, from the middle of its side; 0 for a free end. */
function offset(
  levels: Level[],
  levelOf: (number | undefined)[],
  nodes: CNode[],
  edges: CEdge[],
  vertical: boolean,
  item: number,
  ei: number,
  out: boolean,
): number {
  if (!held(nodes, edges, item, ei, out)) return 0
  const port = portOf(levels, levelOf, item, ei, out)
  if (port === undefined) return 0
  const node = nodes[item] as CNode
  return vertical ? port.px - node.w / 2 : port.py - node.h / 2
}

/**
 * Lays out a graph whose nodes may be nested in groups. Sets every node's center and size of
 * every group, and every edge's route and label position, and returns the size of the
 * drawing. A parent that is not a group, or groups that contain each other, put the node at
 * the top level. Past `MAX_PORTS` border crossings, an edge's `src` and `dst` move to the
 * groups that hold its ends. An edge whose end names no node makes the layout empty, where
 * Pele throws.
 */
export function compoundLayout(
  nodes: CNode[],
  edges: CEdge[],
  rootDir: Dir,
  opt: LayeredOptions,
): CompoundResult {
  const n = nodes.length
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as CEdge
    if (e.src >= n || e.dst >= n) return compoundResultDefault()
  }
  const levels: Level[] = []
  const levelOf: (number | undefined)[] = nones(n)
  const children: number[][] = []
  for (let i = 0; i < n; i++) children.push([])
  const rootItems: number[] = []
  for (let i = 0; i < n; i++) {
    const parent = (nodes[i] as CNode).parent
    const p = parent >= 0 && parent < n ? parent : undefined
    if (p !== undefined && p !== i && (nodes[p] as CNode).isGroup) {
      ;(children[p] as number[]).push(i)
    } else {
      ;(nodes[i] as CNode).parent = -1
      rootItems.push(i)
    }
  }
  pushLevel(levels, undefined, rootDir, rootItems)
  const depth: number[] = numbers(n, 0)
  const placed: boolean[] = bools(n, false)
  descend(levels, levelOf, depth, placed, nodes, children, 0)
  // Groups that contain each other are unreachable from the root; lift them out.
  for (let i = 0; i < n; i++) {
    if (placed[i]) continue
    const former = parentOf(nodes, i)
    if (former !== undefined) removeChild(children[former] as number[], i)
    const node = nodes[i] as CNode
    node.parent = -1
    ;(levels[0] as Level).items.push(i)
    placed[i] = true
    depth[i] = 0
    if (node.isGroup) {
      const from = levels.length
      const dir = node.dir ?? rootDir
      levelOf[i] = pushLevel(levels, i, dir, (children[i] as number[]).slice())
      descend(levels, levelOf, depth, placed, nodes, children, from)
    }
  }

  for (let q = levels.length - 1; q >= 1; q--) {
    const level = levels[q] as Level
    let seq = Number.POSITIVE_INFINITY
    for (const item of level.items) {
      const s = (nodes[item] as CNode).seq
      if (s < seq) seq = s
    }
    if (seq !== Number.POSITIVE_INFINITY && level.id !== undefined) {
      ;(nodes[level.id] as CNode).seq = seq
    }
  }
  for (const level of levels) sortItems(level.items, nodes)

  // Every group border an edge crosses costs a port. Past the budget, an edge is drawn
  // between the groups that hold their ends, at the level they share.
  let ports = 0
  for (const e of edges) {
    let a = e.src
    let b = e.dst
    let crossed = 0
    while ((depth[a] as number) > (depth[b] as number)) {
      a = upOf(nodes, a)
      crossed += 1
    }
    while ((depth[b] as number) > (depth[a] as number)) {
      b = upOf(nodes, b)
      crossed += 1
    }
    while (a !== b && (nodes[a] as CNode).parent !== (nodes[b] as CNode).parent) {
      a = upOf(nodes, a)
      b = upOf(nodes, b)
      crossed += 2
    }
    if (a === b) continue
    if (ports + crossed > MAX_PORTS) {
      e.src = a
      e.dst = b
    } else {
      ports += crossed
    }
  }

  const loops: number[] = []
  const stray: number[] = []
  const aPath: number[] = []
  const bPath: number[] = []
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei] as CEdge
    e.route = []
    if (e.src === e.dst) {
      loops.push(ei)
      continue
    }
    let a = e.src
    let b = e.dst
    // The paths are buffers reused from edge to edge; only the first `aLen` and `bLen`
    // entries belong to this one.
    let aLen = 0
    let bLen = 0
    while ((depth[a] as number) > (depth[b] as number)) {
      aPath[aLen++] = a
      a = upOf(nodes, a)
    }
    while ((depth[b] as number) > (depth[a] as number)) {
      bPath[bLen++] = b
      b = upOf(nodes, b)
    }
    if (a === b) {
      stray.push(ei)
      continue
    }
    while ((nodes[a] as CNode).parent !== (nodes[b] as CNode).parent) {
      aPath[aLen++] = a
      bPath[bLen++] = b
      a = upOf(nodes, a)
      b = upOf(nodes, b)
    }
    const shared = levelIndex(levelOf, parentOf(nodes, a))
    if (shared !== undefined) (levels[shared] as Level).edges.push({ a, b, e: ei })
    addPorts(levels, levelOf, nodes, aPath, aLen, ei, true)
    addPorts(levels, levelOf, nodes, bPath, bLen, ei, false)
  }

  const local: number[] = numbers(n, 0)

  // Top-down: rank each level to learn which side of a group every crossing edge leaves from.
  for (let q = 0; q < levels.length; q++) {
    const level = levels[q] as Level
    for (let k = 0; k < level.ports.length; k++) {
      const port = level.ports[k] as PortEdge
      const { inner, e, out, side } = port
      if ((nodes[inner] as CNode).isGroup && endpointBelow(inner, edges[e] as CEdge, out)) {
        setSide(levels, levelOf, inner, e, out, side)
      }
    }
    if (level.edges.length === 0) continue
    if (!needsSides(level, nodes, edges)) continue
    const [lnodes, ledges] = build(levels, levelOf, q, nodes, edges, local, false)
    orient(lnodes, ledges)
    rank(lnodes, ledges, 1)
    const start = startSide(level.dir)
    const count = Math.min(level.edges.length, ledges.length)
    for (let i = 0; i < count; i++) {
      const ledgeI = ledges[i] as LEdge
      const { a, b, e: ei } = level.edges[i] as LevelEdge
      const e = edges[ei] as CEdge
      const aAbove = !ledgeI.reversed
      if ((nodes[a] as CNode).isGroup && e.src !== a) {
        const side = aAbove ? opposite(start) : start
        setSide(levels, levelOf, a, ei, true, side)
      }
      if ((nodes[b] as CNode).isGroup && e.dst !== b) {
        const side = aAbove ? start : opposite(start)
        setSide(levels, levelOf, b, ei, false, side)
      }
    }
  }

  // Bottom-up: lay out each level now that the sizes of its groups are known.
  const routes: number[][] = []
  for (let i = 0; i < edges.length; i++) routes.push([])
  let total = compoundResultDefault()
  for (let q = levels.length - 1; q >= 0; q--) {
    const level = levels[q] as Level
    const group = level.id
    const dir = level.dir
    const vertical = dir === Dir.Tb || dir === Dir.Bt
    const flip = dir === Dir.Bt || dir === Dir.Rl
    const [lnodes, ledges, dummies] = build(levels, levelOf, q, nodes, edges, local, true)
    const size = layered(lnodes, ledges, opt)
    const contentW = vertical ? size.width : size.height
    const contentH = vertical ? size.height : size.width
    let padX = 0
    let padTop = 0
    let padBottom = 0
    let minW = 0
    if (group !== undefined) {
      const g = nodes[group] as CNode
      padX = g.padX
      padTop = g.padTop
      padBottom = g.padBottom
      minW = g.minW
    }
    const boxW = fmax(contentW + 2 * padX, minW)
    const boxH = contentH + padTop + padBottom
    const offX = (boxW - contentW) / 2
    const offY = padTop
    const frame: Frame = { flip, height: size.height, offX, offY, vertical }
    const axis = vertical ? 0 : 1

    for (let i = 0; i < level.items.length; i++) {
      const item = level.items[i] as number
      const ln = lnodes[i] as LNode
      const node = nodes[item] as CNode
      node.x = frameX(frame, ln.x, ln.y)
      node.y = frameY(frame, ln.x, ln.y)
    }
    for (let i = 0; i < level.edges.length; i++) {
      const le = level.edges[i] as LevelEdge
      const edge = ledges[i] as LEdge
      routes[le.e] = convert(frame, edge.points)
      const e = edges[le.e] as CEdge
      if (e.labelW > 0) {
        e.labelX = frameX(frame, edge.labelX, edge.labelY)
        e.labelY = frameY(frame, edge.labelX, edge.labelY)
      }
    }
    let k = level.edges.length
    for (let i = 0; i < dummies.length; i++) {
      const dummy = dummies[i]
      const port = level.ports[i] as PortEdge
      const { inner, e: ei, out, side } = port
      let px: number
      let py: number
      let route: number[]
      if (dummy !== undefined) {
        const l = ledges[k]
        route = l === undefined ? [] : convert(frame, l.points)
        k += 1
        const at = out ? saturatingSub(route.length, 3) : 0
        const bx = borderX(side, route[at] ?? 0, boxW)
        const by = borderY(side, route[at + 1] ?? 0, boxH)
        if (out) route.push(bx, by, axis)
        else route.unshift(bx, by, axis)
        px = bx
        py = by
      } else {
        const item = nodes[inner] as CNode
        let ix = item.x
        let iy = item.y
        if (item.isGroup && endpointBelow(inner, edges[ei] as CEdge, out)) {
          const p = portOf(levels, levelOf, inner, ei, out)
          if (p !== undefined) {
            ix += p.px - item.w / 2
            iy += p.py - item.h / 2
          }
        } else {
          switch (side) {
            case Side.Top:
              iy -= item.h / 2
              break
            case Side.Bottom:
              iy += item.h / 2
              break
            case Side.Left:
              ix -= item.w / 2
              break
            case Side.Right:
              ix += item.w / 2
              break
          }
        }
        const bx = borderX(side, ix, boxW)
        const by = borderY(side, iy, boxH)
        const a = side === Side.Top || side === Side.Bottom ? 0 : 1
        route = out ? [ix, iy, a, bx, by, a] : [bx, by, a, ix, iy, a]
        px = bx
        py = by
      }
      port.px = px
      port.py = py
      port.route = route
    }

    if (group !== undefined) {
      const g = nodes[group] as CNode
      g.w = boxW
      g.h = boxH
    } else {
      total = { height: boxH, width: boxW }
    }
  }

  // Top-down again: turn positions inside each box into diagram coordinates.
  for (let q = 0; q < levels.length; q++) {
    const level = levels[q] as Level
    const ox = level.x
    const oy = level.y
    for (let k = 0; k < level.items.length; k++) {
      const item = level.items[k] as number
      const node = nodes[item] as CNode
      node.x += ox
      node.y += oy
      const child = levelOf[item]
      if (node.isGroup && child !== undefined) {
        const childLevel = levels[child] as Level
        childLevel.x = node.x - node.w / 2
        childLevel.y = node.y - node.h / 2
      }
    }
  }

  // A buffer reused from edge to edge; only the first `inwardLen` entries belong to the edge.
  const inward: number[] = []
  for (const level of levels) {
    for (const le of level.edges) {
      const e = edges[le.e] as CEdge
      const route: number[] = []
      // The ports on the way out, innermost first, as they are found.
      let item = e.src
      for (;;) {
        const p = parentOf(nodes, item)
        if (p === undefined || p === level.id) break
        const lvIndex = levelOf[p]
        if (lvIndex !== undefined) {
          const lv = levels[lvIndex] as Level
          const k = lv.portOf.get(portKey(le.e, true))
          if (k !== undefined) append(route, (lv.ports[k] as PortEdge).route, lv.x, lv.y)
        }
        item = p
      }
      append(route, routes[le.e] as number[], level.x, level.y)
      let inwardLen = 0
      item = e.dst
      for (;;) {
        const p = parentOf(nodes, item)
        if (p === undefined || p === level.id) break
        const lv = levelOf[p]
        if (lv !== undefined) inward[inwardLen++] = lv
        item = p
      }
      for (let j = inwardLen - 1; j >= 0; j--) {
        const lv = levels[inward[j] as number] as Level
        const k = lv.portOf.get(portKey(le.e, false))
        if (k !== undefined) append(route, (lv.ports[k] as PortEdge).route, lv.x, lv.y)
      }
      e.route = route
      if (e.labelW > 0) {
        e.labelX += level.x
        e.labelY += level.y
      }
    }
  }

  for (const ei of stray) {
    const e = edges[ei] as CEdge
    const a = nodes[e.src] as CNode
    const b = nodes[e.dst] as CNode
    e.route = [a.x, a.y, 0, b.x, b.y, 0]
    e.labelX = midpoint(a.x, b.x)
    e.labelY = midpoint(a.y, b.y)
  }
  for (const ei of loops) {
    const e = edges[ei] as CEdge
    const node = nodes[e.src] as CNode
    e.labelX = node.x + node.w / 2 + 28 + e.labelW / 2
    e.labelY = node.y
  }

  return total
}

/** Adds a port for edge `ei` on the border of each group in `path`, in the level that holds it. */
function addPorts(
  levels: Level[],
  levelOf: (number | undefined)[],
  nodes: CNode[],
  path: number[],
  len: number,
  ei: number,
  out: boolean,
): void {
  for (let i = 0; i < len; i++) {
    const inner = path[i] as number
    const q = levelIndex(levelOf, parentOf(nodes, inner))
    if (q === undefined) continue
    const level = levels[q] as Level
    level.portOf.set(portKey(ei, out), level.ports.length)
    level.ports.push({
      e: ei,
      inner,
      out,
      px: 0,
      py: 0,
      route: [],
      side: Side.Top,
    })
  }
}

/** Orders two items by declaration order, then by index. */
function itemCompare(a: number, b: number, nodes: CNode[]): number {
  return partialCmp((nodes[a] as CNode).seq, (nodes[b] as CNode).seq) || a - b
}

/** `sortItems` by the built-in sort, for long lists. */
function sortItemsLong(items: number[], nodes: CNode[]): void {
  items.sort((a, b) => itemCompare(a, b, nodes))
}

/**
 * Sorts `items` with `itemCompare` as `Array.prototype.sort` does. Short lists take the same
 * steps as V8 takes for them (one natural run, then binary insertion), so the result matches
 * it exactly; longer ones go to the built-in sort.
 */
function sortItems(items: number[], nodes: CNode[]): void {
  const count = items.length
  if (count < 2) return
  if (count >= 64) {
    sortItemsLong(items, nodes)
    return
  }
  let run = 2
  let prev = items[1] as number
  const descending = itemCompare(prev, items[0] as number, nodes) < 0
  for (let i = 2; i < count; i++) {
    const current = items[i] as number
    const order = itemCompare(current, prev, nodes)
    if (descending ? order >= 0 : order < 0) break
    prev = current
    run += 1
  }
  if (descending) {
    let lo = 0
    let hi = run - 1
    while (lo < hi) {
      const t = items[lo] as number
      items[lo] = items[hi] as number
      items[hi] = t
      lo += 1
      hi -= 1
    }
  }
  for (let start = run; start < count; start++) {
    const pivot = items[start] as number
    let left = 0
    let right = start
    while (left < right) {
      const mid = left + ((right - left) >> 1)
      if (itemCompare(pivot, items[mid] as number, nodes) < 0) right = mid
      else left = mid + 1
    }
    for (let p = start; p > left; p--) items[p] = items[p - 1] as number
    items[left] = pivot
  }
}

/** Sets the side of the port that edge `e` passes through on the border of group `item`. */
function setSide(
  levels: Level[],
  levelOf: (number | undefined)[],
  item: number,
  e: number,
  out: boolean,
  side: Side,
): void {
  const q = levelOf[item]
  if (q === undefined) return
  const level = levels[q]
  if (level === undefined) return
  const k = level.portOf.get(portKey(e, out))
  if (k === undefined) return
  const port = level.ports[k]
  if (port !== undefined) port.side = side
}

/**
 * Appends the points of `part`, moved by `ox`, `oy`, to `route`, skipping a point that
 * repeats the last one.
 */
function append(route: number[], part: number[], ox: number, oy: number): void {
  for (let i = 0; i + 3 <= part.length; i += 3) {
    const x = (part[i] as number) + ox
    const y = (part[i + 1] as number) + oy
    const len = route.length
    if (
      len >= 3 &&
      Math.abs((route[len - 3] as number) - x) < 0.01 &&
      Math.abs((route[len - 2] as number) - y) < 0.01
    ) {
      continue
    }
    route.push(x, y, part[i + 2] as number)
  }
}
