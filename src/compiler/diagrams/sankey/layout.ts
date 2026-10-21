/**
 * @module Sankey layout: columns by distance from a source, node heights by flow, and a few
 * relaxation passes that let bands cross less. Port of Pele's `src/diagrams/sankey/layout.ts`.
 */
import type { SankeyDb } from './db.ts'
import { Code, type CompileError, errorNew } from '../../error.ts'
import { fmax, fmin, saturatingSub } from '../../util/rust.ts'

/** Which column a node goes in. */
export const Alignment = {
  /** Sources pulled next to their first target. */
  Center: 'Center',
  /** Sinks in the last column, everything else by depth. */
  Justify: 'Justify',
  /** By depth from a source. */
  Left: 'Left',
  /** By distance to a sink, from the right. */
  Right: 'Right',
} as const
export type Alignment = (typeof Alignment)[keyof typeof Alignment]

/** What the layout is fitted to. */
export type LayoutOptions = {
  /** Column placement. */
  alignment: Alignment
  /** Chart height. */
  height: number
  /** Height of a label line; thin nodes are kept at least this far apart where there is room. */
  labelHeight: number
  /** Space between nodes of a column. */
  nodePadding: number
  /** Width of a node bar. */
  nodeWidth: number
  /** Chart width. */
  width: number
}

/** A placed node. */
export type PlacedNode = {
  /** Bar height. */
  height: number
  /** Column index. */
  layer: number
  /** Total flow through the node, in the diagram's units. */
  value: number
  /** Left edge. */
  x: number
  /** Top edge. */
  y: number
}

/** `PlacedNode::default()`. */
export function placedNodeDefault(): PlacedNode {
  return { height: 0, layer: 0, value: 0, x: 0, y: 0 }
}

/** A placed link. */
export type PlacedLink = {
  /** Source node index. */
  source: number
  /** Vertical center of the band where it leaves its source. */
  sourceY: number
  /** Target node index. */
  target: number
  /** Vertical center of the band where it enters its target. */
  targetY: number
  /** Band thickness. */
  thickness: number
  /** The flow, or 0 when it is not a positive finite number. */
  value: number
}

/** Relaxation passes. */
const PASSES = 6

const EMPTY = new Float64Array(0)

/** The keys {@link compareByKey} reads while a list is sorted. */
let sortKey: Float64Array = EMPTY

/**
 * Orders indexes by their keys, then by index, as `or(key[a] - key[b], a - b)`: the index decides
 * when the difference is 0 or `NaN`.
 */
function compareByKey(a: number, b: number): number {
  const d = sortKey[a] - sortKey[b]
  const c = d === 0 || d !== d ? a - b : d
  return c > 0 ? 1 : c < 0 ? -1 : 0
}

/**
 * Sorts as Pele's `sort` does, comparing as {@link compareByKey}: insertion sort for short lists,
 * the built-in stable sort otherwise. The comparator never ties, so both orders agree with
 * JavaScript's.
 */
function sortByKey(list: number[], key: Float64Array): void {
  if (list.length > 8) {
    sortKey = key
    list.sort(compareByKey)
    sortKey = EMPTY
    return
  }
  for (let i = 1; i < list.length; i++) {
    const item = list[i] as number
    const itemKey = key[item]
    let j = i
    while (j > 0) {
      const prev = list[j - 1] as number
      const d = key[prev] - itemKey
      const c = d === 0 || d !== d ? prev - item : d
      if (!(c > 0)) break
      list[j] = prev
      j -= 1
    }
    list[j] = item
  }
}

/**
 * Places nodes in columns by their distance from a source, sizes them by their flow, and then
 * lets each column settle next to its neighbours so that the bands cross less.
 *
 * Throws a semantic error naming a node on a cycle.
 */
export function layoutSankey(model: SankeyDb, options: LayoutOptions): [PlacedNode[], PlacedLink[]] {
  const n = model.nodes.length
  const linkCount = model.links.length
  const linkSource = new Int32Array(linkCount)
  const linkTarget = new Int32Array(linkCount)
  const linkValue = new Float64Array(linkCount)
  const outgoing: number[][] = []
  const incoming: number[][] = []
  for (let i = 0; i < n; i++) {
    outgoing.push([])
    incoming.push([])
  }
  for (let k = 0; k < linkCount; k++) {
    const link = model.links[k] as SankeyDb['links'][number]
    linkSource[k] = link.source
    linkTarget[k] = link.target
    linkValue[k] = Number.isFinite(link.value) && link.value > 0 ? link.value : 0
    if (link.source < n) (outgoing[link.source] as number[]).push(k)
    if (link.target < n) (incoming[link.target] as number[]).push(k)
  }

  // Longest distance from a source, in topological order; what is left over lies on a cycle.
  const depth = new Int32Array(n)
  const pending = new Int32Array(n)
  for (let i = 0; i < n; i++) pending[i] = (incoming[i] as number[]).length
  const order: number[] = []
  for (let i = 0; i < n; i++) if (pending[i] === 0) order.push(i)
  let q = 0
  while (q < order.length) {
    const i = order[q] as number
    const d = depth[i]
    const outs = outgoing[i] as number[]
    for (let o = 0; o < outs.length; o++) {
      const t = linkTarget[outs[o] as number]
      if (t < n) {
        if (depth[t] < d + 1) depth[t] = d + 1
        const slot = saturatingSub(pending[t], 1)
        pending[t] = slot
        if (slot === 0) order.push(t)
      }
    }
    q += 1
  }
  if (order.length < n) {
    // Every node left over has a predecessor that is left over too; walking back finds the loop.
    let stuck = pending.findIndex((p) => p !== 0)
    if (stuck < 0) stuck = 0
    const seen = new Uint8Array(n)
    while (stuck < n && seen[stuck] === 0) {
      seen[stuck] = 1
      for (const k of incoming[stuck] ?? []) {
        const s = linkSource[k]
        if ((pending[s] ?? 0) > 0) {
          stuck = s
          break
        }
      }
    }
    const id = model.nodes[stuck]?.id ?? ''
    let message = 'Sankey diagrams cannot have circular links, and "'
    message += id
    message += '" is part of one.'
    const error: CompileError = errorNew(Code.Semantic, message)
    error.type = 'sankey'
    throw error
  }
  let layers = 1
  if (n > 0) {
    layers = 0
    for (let i = 0; i < n; i++) if (depth[i] + 1 > layers) layers = depth[i] + 1
  }
  layers = Math.max(layers, 1)
  const reach = new Int32Array(n)
  for (let o = order.length - 1; o >= 0; o--) {
    const i = order[o] as number
    const outs = outgoing[i] as number[]
    for (let x = 0; x < outs.length; x++) {
      const t = linkTarget[outs[x] as number]
      const r = (t < n ? reach[t] : 0) + 1
      if (reach[i] < r) reach[i] = r
    }
  }

  // Flows are scaled to the largest one, so that sums of huge values stay finite.
  let largest = 0
  for (let k = 0; k < linkCount; k++) if (linkValue[k] > largest) largest = linkValue[k]
  const unit = largest > 0 ? 1 / largest : 0

  const nodes: PlacedNode[] = []
  const flow = new Float64Array(n)
  const columns: number[][] = []
  for (let l = 0; l < layers; l++) columns.push([])
  const step = layers > 1 ? (options.width - options.nodeWidth) / (layers - 1) : 0
  for (let i = 0; i < n; i++) {
    const ins = incoming[i] as number[]
    const outs = outgoing[i] as number[]
    const d = depth[i]
    let layer: number
    switch (options.alignment) {
      case Alignment.Left:
        layer = d
        break
      case Alignment.Right:
        layer = saturatingSub(layers - 1, reach[i])
        break
      case Alignment.Center:
        if (ins.length === 0 && outs.length !== 0) {
          layer = layers
          for (const k of outs) {
            const target = linkTarget[k]
            const t = target < n ? depth[target] : 0
            if (saturatingSub(t, 1) < layer) layer = saturatingSub(t, 1)
          }
        } else layer = d
        break
      case Alignment.Justify:
        layer = outs.length === 0 ? layers - 1 : d
        break
    }
    let into = 0
    let out = 0
    let value = 0
    let valueOut = 0
    for (let x = 0; x < ins.length; x++) {
      const v = linkValue[ins[x] as number]
      into += v * unit
      value += v
    }
    for (let x = 0; x < outs.length; x++) {
      const v = linkValue[outs[x] as number]
      out += v * unit
      valueOut += v
    }
    flow[i] = fmax(into, out)
    nodes.push({
      height: 0,
      layer,
      value: fmax(value, valueOut),
      x: layer * step,
      y: 0,
    })
    columns[layer]?.push(i)
  }

  let tallest = 0
  for (const column of columns) if (column.length > tallest) tallest = column.length
  tallest = Math.max(tallest, 1)
  const gap = tallest > 1 ? fmin(options.nodePadding, options.height / (tallest - 1)) : options.nodePadding
  let scale = Number.POSITIVE_INFINITY
  for (const column of columns) {
    let sum = -0
    for (const i of column) sum += flow[i]
    if (sum > 0) scale = fmin(scale, (options.height - (column.length - 1) * gap) / sum)
  }
  if (!Number.isFinite(scale) || scale < 0) scale = 0

  // A thin node still needs room for its label. Where every column can afford it, each node
  // claims at least a label's height, and the flows are scaled down to make that fit.
  let claim = fmax(0, options.labelHeight - gap)
  if (claim > 0 && !fits(columns, flow, gap, options.height, scale, claim)) {
    if (fits(columns, flow, gap, options.height, 0, claim)) {
      let low = 0
      for (let round = 0; round < 40; round++) {
        // JavaScript rounds the sum, then halves it.
        const mid = (low + scale) / 2
        if (fits(columns, flow, gap, options.height, mid, claim)) low = mid
        else scale = mid
      }
      scale = low
    } else {
      claim = 0
    }
  }

  // The room a node keeps clear above and below itself.
  const margin = new Float64Array(n)
  const thickness = new Float64Array(linkCount)
  for (let k = 0; k < linkCount; k++) thickness[k] = linkValue[k] * unit * scale
  const nodeY = new Float64Array(n)
  const nodeHeight = new Float64Array(n)
  for (const column of columns) {
    let y = 0
    for (const i of column) {
      const height = flow[i] * scale
      nodeHeight[i] = height
      const m = fmax(0, claim - height) / 2
      margin[i] = m
      nodeY[i] = y + m
      y += height + 2 * m + gap
    }
    // Spare room is shared out between the nodes of a column.
    const spare = (options.height - y + gap) / (column.length + 1)
    for (let k = 0; k < column.length; k++) nodeY[column[k] as number] += spare * (k + 1)
  }

  const state: Settle = {
    gap,
    height: options.height,
    incoming,
    linkKey: new Float64Array(linkCount),
    linkSource,
    linkTarget,
    margin,
    n,
    nodeHeight,
    nodeKey: new Float64Array(n),
    nodeY,
    outgoing,
    sourceOffset: new Float64Array(linkCount),
    targetOffset: new Float64Array(linkCount),
    thickness,
  }

  settleStackAll(state)
  for (let pass = 0; pass < PASSES; pass++) {
    const pull = Math.pow(0.99, pass)
    for (let l = saturatingSub(layers, 1) - 1; l >= 0; l--) {
      const column = columns[l]
      if (column !== undefined) settleSettle(state, column, pull, false)
    }
    settleStackAll(state)
    for (let l = 1; l < layers; l++) {
      const column = columns[l]
      if (column !== undefined) settleSettle(state, column, pull, true)
    }
    settleStackAll(state)
  }

  for (let i = 0; i < n; i++) {
    const node = nodes[i] as PlacedNode
    node.height = nodeHeight[i]
    node.y = nodeY[i]
  }
  const placed: PlacedLink[] = []
  for (let k = 0; k < linkCount; k++) {
    const source = linkSource[k]
    const target = linkTarget[k]
    placed.push({
      source,
      sourceY: (source < n ? nodeY[source] : 0) + state.sourceOffset[k],
      target,
      targetY: (target < n ? nodeY[target] : 0) + state.targetOffset[k],
      thickness: thickness[k],
      value: linkValue[k],
    })
  }

  return [nodes, placed]
}

/** Whether every column fits the chart height with flows scaled by `s` and nodes at least `claim`. */
function fits(columns: number[][], flow: Float64Array, gap: number, height: number, s: number, claim: number): boolean {
  for (const column of columns) {
    let extent = (column.length - 1) * gap
    for (const i of column) extent += fmax(flow[i] * s, claim)
    if (!(extent <= height + 1e-6)) return false
  }
  return true
}

/** The relaxation state: node positions and where each band meets its nodes. */
type Settle = {
  gap: number
  height: number
  incoming: number[][]
  /** Sort keys by link, filled before each sort. */
  linkKey: Float64Array
  linkSource: Int32Array
  linkTarget: Int32Array
  margin: Float64Array
  /** The number of nodes. */
  n: number
  nodeHeight: Float64Array
  /** Sort keys by node, filled before each sort. */
  nodeKey: Float64Array
  nodeY: Float64Array
  outgoing: number[][]
  /** Offsets of each band's middle from the top of its source node. */
  sourceOffset: Float64Array
  /** Offsets of each band's middle from the top of its target node. */
  targetOffset: Float64Array
  thickness: Float64Array
}

/** The middle of node `i`, or 0 for a node that does not exist. */
function settleCenter(state: Settle, i: number): number {
  return i < state.n ? state.nodeY[i] + state.nodeHeight[i] / 2 : 0
}

/** Bands leave a node in the order of where they go, so they do not cross at it. */
function settleStackOut(state: Settle, i: number): void {
  const list = state.outgoing[i]
  if (list === undefined) return
  const key = state.linkKey
  const target = state.linkTarget
  for (let x = 0; x < list.length; x++) {
    const k = list[x] as number
    key[k] = settleCenter(state, target[k])
  }
  sortByKey(list, key)
  const thickness = state.thickness
  const offset = state.sourceOffset
  let y = 0
  for (let x = 0; x < list.length; x++) {
    const k = list[x] as number
    const t = thickness[k]
    offset[k] = y + t / 2
    y += t
  }
}

/** Bands enter a node in the order of where they come from. */
function settleStackIn(state: Settle, i: number): void {
  const list = state.incoming[i]
  if (list === undefined) return
  const key = state.linkKey
  const source = state.linkSource
  for (let x = 0; x < list.length; x++) {
    const k = list[x] as number
    key[k] = settleCenter(state, source[k])
  }
  sortByKey(list, key)
  const thickness = state.thickness
  const offset = state.targetOffset
  let y = 0
  for (let x = 0; x < list.length; x++) {
    const k = list[x] as number
    const t = thickness[k]
    offset[k] = y + t / 2
    y += t
  }
}

function settleStackAll(state: Settle): void {
  for (let i = 0; i < state.n; i++) {
    settleStackOut(state, i)
    settleStackIn(state, i)
  }
}

/**
 * Moves each node of a column towards where its bands would run level, then restores the order
 * and the gaps. `forward` looks at the bands coming in, otherwise at those going out.
 */
function settleSettle(state: Settle, column: number[], pull: number, forward: boolean): void {
  const nodeY = state.nodeY
  const nodeHeight = state.nodeHeight
  const n = state.n
  const so = state.sourceOffset
  const to = state.targetOffset
  const thickness = state.thickness
  for (const i of column) {
    const list = forward ? state.incoming[i] : state.outgoing[i]
    if (list === undefined || list.length === 0) continue
    if (forward) settleStackIn(state, i)
    else settleStackOut(state, i)
    const height = i < n ? nodeHeight[i] : 0
    let weighted = 0
    let weight = 0
    let plain = 0
    const ends = forward ? state.linkSource : state.linkTarget
    for (let x = 0; x < list.length; x++) {
      const k = list[x] as number
      const other = ends[k]
      const y = other < n ? nodeY[other] : 0
      const level = forward ? y + so[k] - to[k] : y + to[k] - so[k]
      const t = thickness[k]
      weighted += level * t
      weight += t
      plain += settleCenter(state, other) - height / 2
    }
    const wanted = weight > 0 ? weighted / weight : plain / list.length
    if (i < n) nodeY[i] += (wanted - nodeY[i]) * pull
  }

  const key = state.nodeKey
  for (let x = 0; x < column.length; x++) {
    const i = column[x] as number
    key[i] = settleCenter(state, i)
  }
  sortByKey(column, key)
  const margin = state.margin
  const gap = state.gap
  let y = 0
  for (let x = 0; x < column.length; x++) {
    const i = column[x] as number
    const m = margin[i]
    if (nodeY[i] - m < y) nodeY[i] = y + m
    y = nodeY[i] + nodeHeight[i] + m + gap
  }
  y = state.height
  for (let c = column.length - 1; c >= 0; c--) {
    const i = column[c] as number
    const m = margin[i]
    if (nodeY[i] + nodeHeight[i] + m > y) nodeY[i] = y - nodeHeight[i] - m
    y = nodeY[i] - m - gap
  }
}
