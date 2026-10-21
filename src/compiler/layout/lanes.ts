/**
 * @module Layout for swimlanes. Port of Pele's `src/layout/lanes.ts`.
 *
 * Every top-level group is a lane: a band that runs the length of the diagram along the flow.
 * Ranks are shared by all lanes, so a step sits level with the steps that happen at the same
 * time in other lanes, and each node stays inside its own lane. Arrays are sized from the
 * validated graph, so their indices are in bounds by construction, as in the layered layout.
 */
import { type CEdge, type CNode, type CompoundResult, Dir, compoundResultDefault } from './compound.ts'
import { Kind, type LEdge, type LNode, type LayeredOptions, ledge, lnode, orient, rank } from './layered.ts'
import { jsRound } from '../svg/builder.ts'
import { fmax, fmin, midpoint, partialCmp } from '../util/rust.ts'

const LANE_HEAD = 34
/** The room a lane keeps around its items by default. */
export const LANE_PAD = 24
const SWEEPS = 8
const MAX_DUMMIES = 20000
const MAX_HOPS = 10000
const ROUTE_BUDGET = 2_000_000
/** Parallel lines closer than this are drawn as one. */
const NEAR = 4
const ROUNDS = 3
const RELAY = 8
const TURN = 20
/**
 * The room a lane keeps beside a handoff along its margin, and how much of it is between the
 * handoff and the lane's items.
 */
const MARGIN = 20
const LEG = 14
const CLOSE = 3

/** `Math.sign`: zero stays zero. */
function sign(value: number): number {
  if (value > 0) return 1
  if (value < 0) return -1
  return value
}

/** `n` copies of `value`. */
function filled<T>(n: number, value: T): T[] {
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(value)
  return out
}

/** Whether two arrays hold the same values. */
function sameValues(a: boolean[], b: boolean[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** What every placement shares: the graph's ranked items and its lanes. */
type Ctx = {
  /** The ranked relations between items. */
  edgeOf: number[]
  endPad: number
  flipped: boolean
  /** The item each node is, when it is ranked and placed. */
  itemOf: (number | undefined)[]
  itemLane: number[]
  laneCount: number
  lanePads: number[]
  /** Each lane's slot, for a top-level group. */
  laneSlot: (number | undefined)[]
  /** Lanes in the order they were written. */
  lanes: number[]
  ledges: LEdge[]
  lnodes: LNode[]
  opt: LayeredOptions
  /** Nodes and empty groups, which get ranked and placed. */
  real: number[]
  sideways: boolean
  step: number
}

/** One placement's size, and what its routing found. */
type Placed = {
  height: number
  /** The lanes whose margin a handoff runs along. */
  margins: boolean[]
  /** The relations given a simple route. */
  routed: boolean[]
  width: number
  work: number
}

/** The enclosing group of node `i`, when it names one. */
function parent(nodes: CNode[], i: number): number | undefined {
  const p = (nodes[i] as CNode).parent
  return p >= 0 && p < nodes.length ? p : undefined
}

/**
 * Lays out `nodes` and `edges` with every top-level group as a lane, flowing in `dir`. Sets the
 * position and size of every node and group, and every edge's route and label position, and
 * returns the size of the drawing. `lanePad` is the room a lane keeps around its items
 * ({@link LANE_PAD} in Pele). An edge whose end names no node makes the layout empty, where Pele
 * throws.
 */
export function laneLayout(
  nodes: CNode[],
  edges: CEdge[],
  dir: Dir,
  opt: LayeredOptions,
  lanePad: number,
): CompoundResult {
  const n = nodes.length
  if (n === 0 || edges.some((e) => e.src >= n || e.dst >= n)) return compoundResultDefault()
  const sideways = dir === Dir.Lr || dir === Dir.Rl
  const flipped = dir === Dir.Bt || dir === Dir.Rl

  // The graph lists groups last-declared first.
  const lanes: number[] = []
  for (let i = n - 1; i >= 0; i--) {
    const node = nodes[i] as CNode
    if (node.parent < 0 && node.isGroup) lanes.push(i)
  }
  const laneCount = Math.max(lanes.length, 1)
  const laneSlot: (number | undefined)[] = filled(n, undefined)
  for (let k = 0; k < lanes.length; k++) laneSlot[lanes[k] as number] = k
  const hasChild = filled(n, false)
  for (let i = 0; i < n; i++) {
    const p = parent(nodes, i)
    if (p !== undefined) hasChild[p] = true
  }

  // Room a lane keeps around its items, so that the groups drawn around them stay inside it.
  const lanePads = filled(laneCount, lanePad)
  let endPad = lanePad
  const laneOf = (i: number): number => {
    let t = i
    let room = lanePad
    let hops = 0
    for (;;) {
      const p = parent(nodes, t)
      if (p === undefined || hops >= MAX_HOPS) break
      t = p
      if (laneSlot[t] === undefined) {
        const node = nodes[t] as CNode
        room += fmax(fmax(node.padX, node.padTop), node.padBottom)
      }
      hops += 1
    }
    const lane = laneSlot[t] ?? 0
    if (room > (lanePads[lane] as number)) lanePads[lane] = room
    if (room > endPad) endPad = room
    return lane
  }

  // What gets ranked and placed: nodes, and groups that are empty and so act as nodes.
  const itemOf: (number | undefined)[] = filled(n, undefined)
  const real: number[] = []
  for (let i = 0; i < n; i++) {
    if (laneSlot[i] !== undefined) continue
    const node = nodes[i] as CNode
    if (!node.isGroup || !hasChild[i]) {
      itemOf[i] = real.length
      real.push(i)
    }
  }
  const along = (c: CNode): number => (sideways ? c.w : c.h)
  const cross = (c: CNode): number => (sideways ? c.h : c.w)

  const lnodes: LNode[] = real.map((i) => lnode(cross(nodes[i] as CNode), along(nodes[i] as CNode), Kind.Node))
  const ledges: LEdge[] = []
  const edgeOf: number[] = []
  let step = 1
  const seen = new Set<number>()
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei] as CEdge
    const a = itemOf[e.src]
    const b = itemOf[e.dst]
    if (a === undefined || b === undefined) continue
    if (a === b) continue
    const key = Math.min(a, b) * real.length + Math.max(a, b)
    if (e.labelW > 0 || seen.has(key)) step = 2
    seen.add(key)
    const labelW = sideways ? e.labelH : e.labelW
    const labelH = sideways ? e.labelW : e.labelH
    ledges.push(ledge(a, b, e.minlen, labelW, labelH))
    edgeOf.push(ei)
  }
  orient(lnodes, ledges)
  rank(lnodes, ledges, step)

  const m = ledges.length
  const itemLane = real.map((i) => laneOf(i))
  const ctx: Ctx = {
    edgeOf,
    endPad,
    flipped,
    itemOf,
    itemLane,
    laneCount,
    lanePads,
    laneSlot,
    lanes,
    ledges,
    lnodes,
    opt,
    real,
    sideways,
    step,
  }

  let plain = filled(m, false)
  let margins = filled(laneCount, false)
  let placed = place(ctx, nodes, edges, plain, margins)
  // A handoff that was given a simple route needs no room kept for it through the ranks it
  // passes, so the lanes are laid out again without it. A handoff that then loses its route
  // goes back to the ranked one. Routing is most of the work, so a large graph is laid out once.
  let round = 0
  while (round < ROUNDS && placed.work <= ROUTE_BUDGET / RELAY) {
    let next: boolean[]
    if (round === 0) {
      next = placed.routed.slice()
    } else {
      next = []
      const routed = placed.routed
      for (let k = 0; k < plain.length && k < routed.length; k++) next.push((plain[k] as boolean) && (routed[k] as boolean))
    }
    if (sameValues(next, plain) && sameValues(placed.margins, margins)) break
    plain = next
    margins = placed.margins
    placed.margins = []
    placed = place(ctx, nodes, edges, plain, margins)
    round += 1
  }
  let lost = false
  for (let k = 0; k < plain.length && k < placed.routed.length; k++) {
    if (plain[k] && !placed.routed[k]) {
      lost = true
      break
    }
  }
  if (lost) placed = place(ctx, nodes, edges, filled(m, false), filled(laneCount, false))
  return { height: placed.height, width: placed.width }
}

/**
 * Lays the ranked items out and routes the relations. A `plain` relation is a handoff that takes
 * a simple route of its own, and so keeps no room through the ranks it passes. `margins` are the
 * lanes that keep room along their margin for a handoff.
 */
function place(ctx: Ctx, nodes: CNode[], edges: CEdge[], plain: boolean[], margins: boolean[]): Placed {
  const {
    edgeOf,
    endPad,
    flipped,
    itemOf,
    itemLane,
    laneCount,
    lanePads,
    laneSlot,
    lanes,
    ledges,
    lnodes,
    opt,
    real,
    sideways,
    step,
  } = ctx
  const n = nodes.length
  const m = ledges.length

  const pad: number[] = []
  for (let k = 0; k < lanePads.length && k < margins.length; k++) {
    const room = lanePads[k] as number
    pad.push(margins[k] ? fmax(room, MARGIN) : room)
  }
  const used = filled(laneCount, false)

  // Items: the real ones, then a dummy for every rank an edge passes through.
  let dummies = 0
  // Typed arrays keep one element kind whatever the graph, so the loops below stay monomorphic.
  const span = new Int32Array(m)
  for (let k = 0; k < m; k++) {
    const e = ledges[k] as LEdge
    span[k] = Math.abs((lnodes[e.head] as LNode).rank - (lnodes[e.tail] as LNode).rank)
  }
  for (let k = 0; k < m; k++) {
    if (!plain[k]) dummies += (span[k] as number) - 1
  }
  const direct = dummies > MAX_DUMMIES
  const total = real.length + (direct ? 0 : Math.max(dummies, 0))
  const rankOf = new Int32Array(total)
  const lane = new Int32Array(total)
  const size = new Float64Array(total)
  const depth = new Float64Array(total)
  const dummy = new Uint8Array(total)
  let maxRank = 0
  for (let k = 0; k < real.length; k++) {
    const ln = lnodes[k] as LNode
    rankOf[k] = ln.rank
    lane[k] = itemLane[k] as number
    size[k] = ln.w
    depth[k] = ln.h
    maxRank = Math.max(maxRank, ln.rank)
  }
  const firstDummy: (number | undefined)[] = filled(m, undefined)
  const labelItem: (number | undefined)[] = filled(m, undefined)
  const links: number[] = []
  {
    let next = real.length
    for (let k = 0; k < m; k++) {
      const e = ledges[k] as LEdge
      const a = e.reversed ? e.head : e.tail
      const b = e.reversed ? e.tail : e.head
      if (direct || (span[k] as number) < 2 || plain[k]) {
        links.push(a, b)
        continue
      }
      const ra = rankOf[a] as number
      const rb = rankOf[b] as number
      let labelRank = -1
      if (e.labelW > 0) {
        labelRank = ra + ((rb - ra) >> 1)
        if (step === 2 && (labelRank & 1) === 0) labelRank -= 1
      }
      firstDummy[k] = next
      let prev = a
      for (let r = ra + 1; r < rb; r++) {
        const d = next
        next += 1
        // Rust indexes its sized vectors here, and panics past their end.
        if (d >= total) throw new Error('unreachable: dummy index out of bounds')
        rankOf[d] = r
        // The edge crosses from its first lane to its last one evenly along the way.
        const la = lane[a] as number
        const lb = lane[b] as number
        lane[d] = la + jsRound(((lb - la) * (r - ra)) / (rb - ra))
        dummy[d] = 1
        if (r === labelRank) {
          size[d] = e.labelW
          depth[d] = e.labelH
          labelItem[k] = d
        }
        links.push(prev, d)
        prev = d
      }
      links.push(prev, b)
    }
  }

  const upStart = new Int32Array(total + 1)
  const downStart = new Int32Array(total + 1)
  for (let p = 0; p + 1 < links.length; p += 2) {
    const from = (links[p] as number) + 1
    const to = (links[p + 1] as number) + 1
    downStart[from] = (downStart[from] as number) + 1
    upStart[to] = (upStart[to] as number) + 1
  }
  for (let i = 0; i < total; i++) {
    upStart[i + 1] = (upStart[i + 1] as number) + (upStart[i] as number)
    downStart[i + 1] = (downStart[i + 1] as number) + (downStart[i] as number)
  }
  const up = new Int32Array(links.length >> 1)
  const down = new Int32Array(links.length >> 1)
  {
    const uf = upStart.slice(0, total)
    const df = downStart.slice(0, total)
    for (let p = 0; p + 1 < links.length; p += 2) {
      const from = links[p] as number
      const to = links[p + 1] as number
      down[df[from] as number] = to
      df[from] = (df[from] as number) + 1
      up[uf[to] as number] = from
      uf[to] = (uf[to] as number) + 1
    }
  }

  // Order within each rank: by lane first, then by where the item's neighbours sit.
  const rows: number[][] = []
  for (let r = 0; r <= maxRank; r++) rows.push([])
  for (let i = 0; i < total; i++) (rows[rankOf[i] as number] as number[]).push(i)
  const pos = new Int32Array(total)
  const key = new Float64Array(total)
  // Lane, then key, then index: a total order, so any sort gives the same rows. Rows are short,
  // so an insertion sort beats the builtin.
  const settle = (row: number[]): void => {
    for (let k = 1; k < row.length; k++) {
      const item = row[k] as number
      const itemLane = lane[item] as number
      const itemKey = key[item] as number
      let j = k - 1
      while (j >= 0) {
        const other = row[j] as number
        const byLane = (lane[other] as number) - itemLane
        if (byLane < 0) break
        if (byLane === 0) {
          const diff = (key[other] as number) - itemKey
          if (diff < 0 || (diff === 0 && other < item)) break
        }
        row[j + 1] = other
        j -= 1
      }
      row[j + 1] = item
    }
    for (let k = 0; k < row.length; k++) pos[row[k] as number] = k
  }
  for (const row of rows) {
    for (let k = 0; k < row.length; k++) key[row[k] as number] = k
    settle(row)
  }
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    if (maxRank === 0) break
    const downward = (sweep & 1) === 0
    for (let s = 1; s <= maxRank; s++) {
      const row = rows[downward ? s : maxRank - s] as number[]
      const start = downward ? upStart : downStart
      const list = downward ? up : down
      for (const i of row) {
        let sum = 0
        const count = (start[i + 1] as number) - (start[i] as number)
        for (let k = start[i] as number; k < (start[i + 1] as number); k++) sum += pos[list[k] as number] as number
        key[i] = count > 0 ? sum / count : (pos[i] as number)
      }
      settle(row)
    }
  }

  // The items of one rank that share a lane sit side by side as a run.
  const gap = (a: number, b: number): number => (dummy[a] || dummy[b] ? opt.edgeSep : opt.nodeSep)
  /** The last index of the run that starts at `from`. */
  const runEnd = (row: number[], from: number): number => {
    let to = from
    while (to + 1 < row.length && lane[row[to + 1] as number] === lane[row[from] as number]) to += 1
    return to
  }
  const runSize = (row: number[], from: number, to: number): number => {
    let sum = size[row[from] as number] as number
    for (let k = from; k < to; k++) {
      sum += gap(row[k] as number, row[k + 1] as number) + (size[row[k + 1] as number] as number)
    }
    return sum
  }

  // Lane breadth: enough for its fullest rank, and for its title.
  const breadth = new Float64Array(laneCount)
  let head = lanes.length === 0 ? 0 : LANE_HEAD
  for (let k = 0; k < lanes.length; k++) {
    const node = nodes[lanes[k] as number] as CNode
    breadth[k] = fmax(node.minW - 2 * (pad[k] as number), 0)
    if (node.padTop > head) head = node.padTop
  }
  for (const row of rows) {
    for (let from = 0; from < row.length; ) {
      const to = runEnd(row, from)
      const sum = runSize(row, from, to)
      const at = lane[row[from] as number] as number
      if (sum > (breadth[at] as number)) breadth[at] = sum
      from = to + 1
    }
  }
  const laneStart = new Float64Array(laneCount + 1)
  for (let k = 0; k < laneCount; k++) {
    laneStart[k + 1] = (laneStart[k] as number) + (breadth[k] as number) + 2 * (pad[k] as number)
  }

  // Across the flow: each lane's items start centered, then line up with their neighbours in
  // the same lane as far as the lane and the items beside them allow.
  const c = new Float64Array(total)
  const want = new Float64Array(total)
  for (const row of rows) {
    for (let from = 0; from < row.length; ) {
      const to = runEnd(row, from)
      const atLane = lane[row[from] as number] as number
      const lanePadding = pad[atLane] as number
      let at =
        ((laneStart[atLane] as number) +
          lanePadding +
          ((laneStart[atLane + 1] as number) - lanePadding) -
          runSize(row, from, to)) /
        2
      for (let k = from; k <= to; k++) {
        const i = row[k] as number
        c[i] = at + (size[i] as number) / 2
        if (k < to) at += (size[i] as number) + gap(i, row[k + 1] as number)
      }
      from = to + 1
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    if (maxRank === 0) break
    const downward = (pass & 1) === 0
    for (let s = 1; s <= maxRank; s++) {
      const row = rows[downward ? s : maxRank - s] as number[]
      const start = downward ? upStart : downStart
      const list = downward ? up : down
      for (const i of row) {
        let sum = 0
        let count = 0
        for (let k = start[i] as number; k < (start[i + 1] as number); k++) {
          const other = list[k] as number
          if (lane[other] !== lane[i]) continue
          sum += c[other] as number
          count += 1
        }
        want[i] = count > 0 ? sum / count : (c[i] as number)
      }
      for (let from = 0; from < row.length; ) {
        const to = runEnd(row, from)
        const atLane = lane[row[from] as number] as number
        let floor = (laneStart[atLane] as number) + (pad[atLane] as number)
        for (let k = from; k <= to; k++) {
          const i = row[k] as number
          c[i] = fmax(want[i] as number, floor + (size[i] as number) / 2)
          if (k < to) floor = (c[i] as number) + (size[i] as number) / 2 + gap(i, row[k + 1] as number)
        }
        let ceil = (laneStart[atLane + 1] as number) - (pad[atLane] as number)
        for (let k = to; k >= from; k--) {
          const i = row[k] as number
          c[i] = fmin(c[i] as number, ceil - (size[i] as number) / 2)
          if (k > from) ceil = (c[i] as number) - (size[i] as number) / 2 - gap(row[k - 1] as number, i)
        }
        from = to + 1
      }
    }
  }

  // Along the flow: one band per rank, after the lane titles.
  const bandStart = new Float64Array(maxRank + 1)
  const bandEnd = new Float64Array(maxRank + 1)
  // The room after a rank is for the relations that turn there or are only as long as they
  // were asked to be. Where just plain handoffs and straight lines pass, the ranks close up,
  // as far as the label of a handoff between them leaves it a line to sit on.
  const sep = new Float64Array(maxRank + 1).fill(opt.rankSep / step)
  if (plain.some((on) => on)) {
    const full = opt.rankSep / step
    sep.fill(full / CLOSE)
    for (let k = 0; k < m; k++) {
      const e = ledges[k] as LEdge
      const a = e.reversed ? e.head : e.tail
      const b = e.reversed ? e.tail : e.head
      const ra = rankOf[a] as number
      const rb = rankOf[b] as number
      const sk = span[k] as number
      if (plain[k]) {
        if (e.labelH <= 0 || sk > step) continue
        if (ra > rb) throw new Error('unreachable: rank range out of order')
        const room = fmin(full, (e.labelH + 2 * TURN - fmin(depth[a] as number, depth[b] as number) / 2) / sk)
        for (let s = ra; s < rb; s++) {
          if (room > (sep[s] as number)) sep[s] = room
        }
        continue
      }
      const d0 = firstDummy[k]
      if (d0 === undefined || !(sk > step * e.minlen)) {
        if (ra > rb) throw new Error('unreachable: rank range out of order')
        for (let s = ra; s < rb; s++) sep[s] = full
        continue
      }
      const count = sk
      for (let j = 0; j < count; j++) {
        const u = j === 0 ? a : d0 + j - 1
        const v = j + 1 < count ? d0 + j : b
        if (lane[u] !== lane[v] || Math.abs((c[u] as number) - (c[v] as number)) >= 0.5) sep[rankOf[u] as number] = full
      }
    }
  }
  let at = head + endPad
  for (let r = 0; r <= maxRank; r++) {
    let most = 0
    for (const i of rows[r] as number[]) {
      if ((depth[i] as number) > most) most = depth[i] as number
    }
    bandStart[r] = at
    bandEnd[r] = at + most
    at += most + (r === maxRank ? 0 : (sep[r] as number))
  }
  const length = at + endPad
  const breadthTotal = laneStart[laneCount] as number
  const flip = (a: number): number => (flipped ? head + length - a : a)
  const px = (c: number, a: number): number => (sideways ? flip(a) : c)
  const py = (c: number, a: number): number => (sideways ? c : flip(a))
  const axis = sideways ? 1 : 0

  for (let k = 0; k < real.length; k++) {
    const id = real[k] as number
    const r = rankOf[k] as number
    const a = midpoint(bandStart[r] as number, bandEnd[r] as number)
    const node = nodes[id] as CNode
    node.x = px(c[k] as number, a)
    node.y = py(c[k] as number, a)
  }
  for (let k = 0; k < lanes.length; k++) {
    const mid = midpoint(laneStart[k] as number, laneStart[k + 1] as number)
    const width = (laneStart[k + 1] as number) - (laneStart[k] as number)
    const node = nodes[lanes[k] as number] as CNode
    node.x = sideways ? length / 2 : mid
    node.y = sideways ? mid : length / 2
    node.w = sideways ? length : width
    node.h = sideways ? width : length
    node.padTop = head
  }

  // Groups inside a lane are drawn around their members, deepest first.
  const depthOf = new Int32Array(n)
  const inner: number[] = []
  for (let i = 0; i < n; i++) {
    if (!(nodes[i] as CNode).isGroup || laneSlot[i] !== undefined || itemOf[i] !== undefined) continue
    let d = 0
    let p = parent(nodes, i)
    while (p !== undefined && d < MAX_HOPS) {
      d += 1
      p = parent(nodes, p)
    }
    depthOf[i] = d
    inner.push(i)
  }
  inner.sort((a, b) => (depthOf[b] as number) - (depthOf[a] as number) || a - b)
  const bounds: [number, number, number, number][] = []
  for (let i = 0; i < n; i++) {
    bounds.push([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])
  }
  const grow = (g: number, c: CNode): void => {
    const b = bounds[g] as [number, number, number, number]
    if (c.x - c.w / 2 < b[0]) b[0] = c.x - c.w / 2
    if (c.y - c.h / 2 < b[1]) b[1] = c.y - c.h / 2
    if (c.x + c.w / 2 > b[2]) b[2] = c.x + c.w / 2
    if (c.y + c.h / 2 > b[3]) b[3] = c.y + c.h / 2
  }
  for (const i of real) {
    const p = parent(nodes, i)
    if (p !== undefined && laneSlot[p] === undefined) grow(p, nodes[i] as CNode)
  }
  for (const g of inner) {
    const [x0, y0, x1, y1] = bounds[g] as [number, number, number, number]
    if (x0 === Number.POSITIVE_INFINITY) continue
    const group = nodes[g] as CNode
    const w = fmax(x1 - x0 + 2 * group.padX, group.minW)
    group.x = midpoint(x0, x1)
    group.w = w
    group.y = (y0 - group.padTop + y1 + group.padBottom) / 2
    group.h = y1 - y0 + group.padTop + group.padBottom
    const p = parent(nodes, g)
    if (p !== undefined && laneSlot[p] === undefined) grow(p, group)
  }

  for (const e of edges) e.route = []
  for (let k = 0; k < m; k++) {
    const e = ledges[k] as LEdge
    const a = e.reversed ? e.head : e.tail
    const b = e.reversed ? e.tail : e.head
    const ra = rankOf[a] as number
    const rb = rankOf[b] as number
    const raStart = bandStart[ra] as number
    const raEnd = bandEnd[ra] as number
    const pts: number[] = [c[a] as number, raEnd - (raEnd - raStart - (depth[a] as number)) / 2]
    const d0 = firstDummy[k]
    if (d0 !== undefined) {
      const sk = span[k] as number
      for (let d = d0; d < d0 + sk - 1; d++) {
        const rd = rankOf[d] as number
        pts.push(c[d] as number, bandStart[rd] as number)
        if ((bandEnd[rd] as number) > (bandStart[rd] as number)) pts.push(c[d] as number, bandEnd[rd] as number)
      }
    }
    const rbStart = bandStart[rb] as number
    const rbEnd = bandEnd[rb] as number
    pts.push(c[b] as number, rbStart + (rbEnd - rbStart - (depth[b] as number)) / 2)
    const route: number[] = []
    for (let p = 0; p + 1 < pts.length; p += 2) {
      const pc = pts[p] as number
      const pa = pts[p + 1] as number
      route.push(px(pc, pa), py(pc, pa), axis)
    }
    if (e.reversed && route.length >= 6) {
      let i = 0
      let j = route.length - 3
      while (i < j) {
        const x = route[i] as number
        route[i] = route[j] as number
        route[j] = x
        const y = route[i + 1] as number
        route[i + 1] = route[j + 1] as number
        route[j + 1] = y
        i += 3
        j -= 3
      }
    }
    const out = edges[edgeOf[k] as number] as CEdge
    const label = labelItem[k]
    if (label !== undefined) {
      const r = rankOf[label] as number
      const mid = midpoint(bandStart[r] as number, bandEnd[r] as number)
      out.labelX = px(c[label] as number, mid)
      out.labelY = py(c[label] as number, mid)
    } else if (route.length >= 2) {
      const last = route.length - 3
      out.labelX = midpoint(route[0] as number, route[last] as number)
      out.labelY = midpoint(route[1] as number, route[last + 1] as number)
    }
    out.route = route
  }

  // An edge that starts or ends at a lane or a group runs straight to its border.
  for (const e of edges) {
    if (e.route.length > 0 || e.src === e.dst) continue
    const [ax, ay] = border(nodes[e.src] as CNode, nodes[e.dst] as CNode)
    const [bx, by] = border(nodes[e.dst] as CNode, nodes[e.src] as CNode)
    const flat = Math.abs(bx - ax) > Math.abs(by - ay) ? 1 : 0
    e.route = [ax, ay, flat, bx, by, flat]
    e.labelX = midpoint(ax, bx)
    e.labelY = midpoint(ay, by)
  }

  // A handoff can leave towards the other lane, then arrive along the flow (or vice versa).
  // In particular, a decision's return branch must not leave through its incoming side and
  // retrace the path past the preceding step. Try the two single-corner routes, keeping the
  // ranked route when a node or another label blocks them.
  const routed = filled(m, false)
  let routePoints = 0
  for (const edge of edges) routePoints += Math.floor(edge.route.length / 3)
  const work = m * (real.length + edges.length + routePoints)
  if (work <= ROUTE_BUDGET) {
    const mids: number[] = []
    for (let i = 0; i < total; i++) {
      const r = rankOf[i] as number
      mids.push(midpoint(bandStart[r] as number, bandEnd[r] as number))
    }
    const amid = (i: number): number => mids[i] as number
    const labels: [number, number][] = edges.map((e) => [
      sideways ? e.labelY : e.labelX,
      flip(sideways ? e.labelX : e.labelY),
    ])
    const overlaps = (
      c0: number,
      a0: number,
      c1: number,
      a1: number,
      lc: number,
      la: number,
      cw: number,
      ah: number,
    ): boolean => c1 > lc - cw / 2 && c0 < lc + cw / 2 && a1 > la - ah / 2 && a0 < la + ah / 2
    const clear = (
      c0: number,
      a0: number,
      c1: number,
      a1: number,
      ends: [number, number] | undefined,
      ei: number,
    ): boolean => {
      for (let i = 0; i < real.length; i++) {
        if (ends !== undefined && (i === ends[0] || i === ends[1])) continue
        if (
          overlaps(c0, a0, c1, a1, c[i] as number, mids[i] as number, (size[i] as number) + 8, (depth[i] as number) + 8)
        ) {
          return false
        }
      }
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i] as CEdge
        // A step's own loop keeps its label inside the step's box, and has no place here.
        if (i === ei || !(e.labelW > 0) || e.src === e.dst) continue
        const w = sideways ? e.labelH : e.labelW
        const h = sideways ? e.labelW : e.labelH
        const at = labels[i] as [number, number]
        if (overlaps(c0, a0, c1, a1, at[0], at[1], w, h)) return false
      }
      return true
    }
    // How many other relations have a stretch inside a box. A stretch's whole box counts,
    // including its curve.
    const crossings = (x0: number, y0: number, x1: number, y1: number, ei: number): number => {
      let count = 0
      for (let i = 0; i < edges.length; i++) {
        if (i === ei) continue
        const r = (edges[i] as CEdge).route
        for (let j = 3; j < r.length; j += 3) {
          const rx0 = r[j - 3] as number
          const rx1 = r[j] as number
          const ry0 = r[j - 2] as number
          const ry1 = r[j + 1] as number
          if (fmax(rx0, rx1) > x0 && fmin(rx0, rx1) < x1 && fmax(ry0, ry1) > y0 && fmin(ry0, ry1) < y1) {
            count += 1
            break
          }
        }
      }
      return count
    }
    const meets = (x: number, y: number, ei: number): number => {
      let count = 0
      for (let i = 0; i < edges.length; i++) {
        const r = (edges[i] as CEdge).route
        if (i === ei || r.length === 0) continue
        const last = r.length - 3
        if (
          (Math.abs((r[0] as number) - x) < 1 && Math.abs((r[1] as number) - y) < 1) ||
          (Math.abs((r[last] as number) - x) < 1 && Math.abs((r[last + 1] as number) - y) < 1)
        ) {
          count += 1
        }
      }
      return count
    }
    // Two relations drawn along one line read as a single path. Those that leave the same step
    // or arrive at the same step may share a trunk; any other pair must not.
    const retraces = (x0: number, y0: number, x1: number, y1: number, ei: number): boolean => {
      const upright = Math.abs(x1 - x0) < 0.5
      const lo = upright ? fmin(y0, y1) : fmin(x0, x1)
      const hi = upright ? fmax(y0, y1) : fmax(x0, x1)
      const line = upright ? x0 : y0
      const us = upright ? 0 : 1
      const vs = upright ? 1 : 0
      const self = edges[ei] as CEdge
      for (let i = 0; i < edges.length; i++) {
        const other = edges[i] as CEdge
        if (i === ei || other.src === self.src || other.dst === self.dst) continue
        const r = other.route
        for (let j = 3; j < r.length; j += 3) {
          const u0 = r[j - 3 + us] as number
          const u1 = r[j + us] as number
          if (Math.abs(u0 - line) < NEAR && Math.abs(u1 - line) < NEAR) {
            const v0 = r[j - 3 + vs] as number
            const v1 = r[j + vs] as number
            if (fmin(hi, fmax(v0, v1)) - fmax(lo, fmin(v0, v1)) > 1) return true
          }
        }
      }
      return false
    }

    for (let k = 0; k < m; k++) {
      const e = ledges[k] as LEdge
      const ei = edgeOf[k] as number
      const a = e.tail
      const b = e.head
      if (lane[a] === lane[b] || Math.abs((c[b] as number) - (c[a] as number)) < 1) continue
      const ac = c[a] as number
      const bc = c[b] as number
      const aa = amid(a)
      const ba = amid(b)
      const dc = sign(bc - ac)
      const da = sign(ba - aa)
      const ends: [number, number] = [a, b]
      const attempt = (pts: number[], margin: number): boolean => {
        for (let p = 2; p + 1 < pts.length; p += 2) {
          const p0 = pts[p - 2] as number
          const p1 = pts[p - 1] as number
          const p2 = pts[p] as number
          const p3 = pts[p + 1] as number
          if (!clear(fmin(p0, p2) - margin, fmin(p1, p3) - margin, fmax(p0, p2) + margin, fmax(p1, p3) + margin, ends, ei)) {
            return false
          }
          if (retraces(px(p0, p1), py(p0, p1), px(p2, p3), py(p2, p3), ei)) return false
        }

        const own = edges[ei] as CEdge
        const outW = own.labelW
        const outH = own.labelH
        let lc = 0
        let la = 0
        let longest = -1
        if (outW > 0) {
          const cw = e.labelW
          const ah = e.labelH
          for (let p = 2; p + 1 < pts.length; ) {
            const p0 = pts[p - 2] as number
            const p1 = pts[p - 1] as number
            const p2 = pts[p] as number
            const p3 = pts[p + 1] as number
            const cc = midpoint(p0, p2)
            const ca = midpoint(p1, p3)
            const across = Math.abs(p2 - p0)
            const alongRun = Math.abs(p3 - p1)
            const run = across + alongRun
            p += 2
            const short = across > 0 ? across < cw + 8 : alongRun < ah + 8
            if (run <= longest || short) continue
            if (cc - cw / 2 < 0 || cc + cw / 2 > breadthTotal || ca - ah / 2 < 0 || ca + ah / 2 > length) continue
            // Include the ends here: the label must clear both shapes it connects.
            if (!clear(cc - cw / 2, ca - ah / 2, cc + cw / 2, ca + ah / 2, undefined, ei)) continue
            // A label moved onto a handoff must not cover a return path that keeps its
            // ranked route. A segment's whole box is kept clear, including its curve.
            const lx = px(cc, ca)
            const ly = py(cc, ca)
            if (crossings(lx - outW / 2, ly - outH / 2, lx + outW / 2, ly + outH / 2, ei) > 0) continue
            lc = cc
            la = ca
            longest = run
          }
          if (longest < 0) return false
        }

        // A point short of each corner and one past it keep the turn close to the corner,
        // so that the line stays under its label and the handoff takes little room.
        const way: number[] = [pts[0] as number, pts[1] as number]
        for (let p = 2; p + 1 < pts.length; p += 2) {
          const dx = (pts[p] as number) - (pts[p - 2] as number)
          const dy = (pts[p + 1] as number) - (pts[p - 1] as number)
          const run = Math.abs(dx) + Math.abs(dy)
          const first = p > 2 ? TURN : 0
          const last = p + 2 < pts.length ? TURN : 0
          if (run > first + last + 1) {
            if (first !== 0) {
              way.push((pts[p - 2] as number) + (dx / run) * first, (pts[p - 1] as number) + (dy / run) * first)
            }
            if (last !== 0) {
              way.push((pts[p] as number) - (dx / run) * last, (pts[p + 1] as number) - (dy / run) * last)
            }
          }
          way.push(pts[p] as number, pts[p + 1] as number)
        }
        const route: number[] = []
        for (let p = 0; p + 1 < way.length; p += 2) {
          const crosswise = p === 0 ? way.length <= 2 || way[0] !== way[2] : way[p] !== way[p - 2]
          const wc = way[p] as number
          const wa = way[p + 1] as number
          route.push(px(wc, wa), py(wc, wa), crosswise ? 1 - axis : axis)
        }
        own.route = route
        if (own.labelW > 0) {
          own.labelX = px(lc, la)
          own.labelY = py(lc, la)
          labels[ei] = [lc, la]
        }
        return true
      }

      if (
        attempt([ac + (dc * (size[a] as number)) / 2, aa, bc, aa, bc, ba - (da * (depth[b] as number)) / 2], 2) ||
        attempt([ac, aa + (da * (depth[a] as number)) / 2, ac, ba, bc - (dc * (size[b] as number)) / 2, ba], 2)
      ) {
        routed[k] = true
        continue
      }

      // With both corners blocked, as for a return past the steps between, the handoff goes
      // around: out to the margin of a lane, along it, and back in level with its end. It
      // takes the margin that crosses the fewest other relations and shares the fewest ends
      // with them, then the shortest way.
      if (work > ROUTE_BUDGET / RELAY) continue
      const around: [number[], number, number][] = []
      const laneA = lane[a] as number
      const laneB = lane[b] as number
      for (let o = 0; o < 2; o++) {
        const atLane = laneA < laneB ? (o === 0 ? laneB : laneA) : o === 0 ? laneA : laneB
        // A lane that keeps no margin yet has less room there, and the handoff stays
        // inside it.
        const lanePadding = pad[atLane] as number
        const inset = fmax(lanePadding - LEG, fmin(lanePadding / 2, MARGIN - LEG))
        for (let side = 0; side < 2; side++) {
          const ch = side === 0 ? (laneStart[atLane] as number) + inset : (laneStart[atLane + 1] as number) - inset
          if (Math.abs(ch - ac) < (size[a] as number) / 2 + 4 || Math.abs(ch - bc) < (size[b] as number) / 2 + 4) {
            continue
          }
          const pts = [
            ac + (sign(ch - ac) * (size[a] as number)) / 2,
            aa,
            ch,
            aa,
            ch,
            ba,
            bc + (sign(ch - bc) * (size[b] as number)) / 2,
            ba,
          ] as [number, number, number, number, number, number, number, number]
          const endsMet =
            meets(px(pts[0], pts[1]), py(pts[0], pts[1]), ei) + meets(px(pts[6], pts[7]), py(pts[6], pts[7]), ei)
          let cost = endsMet * 1e6
          for (let p = 2; p <= 6; p += 2) {
            const x0 = px(pts[p - 2] as number, pts[p - 1] as number)
            const y0 = py(pts[p - 2] as number, pts[p - 1] as number)
            const x1 = px(pts[p] as number, pts[p + 1] as number)
            const y1 = py(pts[p] as number, pts[p + 1] as number)
            const crossed = crossings(fmin(x0, x1), fmin(y0, y1), fmax(x0, x1), fmax(y0, y1), ei)
            cost += crossed * 1e6 + Math.abs(x1 - x0) + Math.abs(y1 - y0)
          }
          around.push([pts, cost, atLane])
        }
      }
      around.sort((p, q) => partialCmp(p[1], q[1]))
      for (const [pts, , atLane] of around) {
        if (!attempt(pts, 1)) continue
        routed[k] = true
        used[atLane] = true
        break
      }
    }
  }

  return {
    height: sideways ? breadthTotal : length,
    margins: used,
    routed,
    width: sideways ? length : breadthTotal,
    work,
  }
}

/**
 * The point where the line from one box's center to another's leaves the first box. When the
 * other center is inside the box, the point is on the nearest side instead.
 */
function border(from: CNode, to: CNode): [number, number] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const hw = fmax(from.w / 2, 0.5)
  const hh = fmax(from.h / 2, 0.5)
  if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
    const toSide = hw - Math.abs(dx)
    const toEnd = hh - Math.abs(dy)
    return toSide < toEnd ? [from.x + (dx < 0 ? -hw : hw), to.y] : [to.x, from.y + (dy < 0 ? -hh : hh)]
  }
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx)
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy)
  const scale = fmin(sx, sy)
  return [from.x + dx * scale, from.y + dy * scale]
}
