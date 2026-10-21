/**
 * @module Layered (Sugiyama-style) layout of one flat graph. Port of Pele's `src/layout/layered.ts`.
 *
 * Ranks run down the y axis; callers rotate the result for other directions. What the layout of
 * edges aims for, most important first, with where each is carried out:
 *
 * 1. Lines can be told apart: ends on one side of a node have places of their own (`spread`),
 *    and curves that would pass within a few pixels turn at levels of their own
 *    (`assignTracks`).
 * 2. Lines cross as little as the order of the nodes allows (`reduceCrossings`).
 * 3. An edge takes the shortest and simplest way (`alignLabels`, `straighten`, `settle`,
 *    `snap`).
 * 4. An edge meets the middle of a side unless an aim above moves it (`settle`).
 * 5. The drawing is balanced (`headRoom` in `layered`, the crossed gaps in `assignTracks`).
 * 6. Nodes keep the order they were written in where nothing above says otherwise.
 * 7. The drawing stays compact.
 *
 * Bounds: every array a pass builds is sized from the graph it indexes (node, segment, or rank
 * count), and every index stored in one comes from that graph. `layered`, `orient`, and `rank`
 * check the caller's edge endpoints once on entry, so indexing inside the passes stays in
 * bounds. Floating-point expressions keep Pele's operation order, since output depends on it.
 */
import { clamp as fclamp, fmax, fmin, midpoint, partialCmp, saturatingSub } from '../util/rust.ts'

/** What a layout node stands for. */
export const Kind = {
  /** A bend of an edge in a rank it passes. */
  Dummy: 'Dummy',
  /** A port on the end border of a group, which edges leave the group through. */
  EndPort: 'EndPort',
  /** The label of an edge, in a rank it passes. */
  Label: 'Label',
  /** A node the caller placed. */
  Node: 'Node',
  /** A port on the start border of a group, which edges enter the group through. */
  StartPort: 'StartPort',
} as const

/** What a layout node stands for. */
export type Kind = (typeof Kind)[keyof typeof Kind]

/** The default kind: a node the caller placed. */
export function kindDefault(): Kind {
  return Kind.Node
}

/** A node of a layered layout. Mirrors Pele's `LNode`. */
export type LNode = {
  /** Height along the flow. */
  h: number
  /** What the node stands for. */
  kind: Kind
  /** Keeps the node first (negative) or last (positive) in its rank; 0 leaves it free. */
  pin: number
  /** Rank after layout. */
  rank: number
  /**
   * How much of the side that edges meet may be shared out between them; 0 keeps them all
   * at its middle.
   */
  span: number
  /** Width across the flow. */
  w: number
  /** Center x after layout. */
  x: number
  /** Center y after layout. */
  y: number
}

/** A node with every field at its default. */
export function lNodeDefault(): LNode {
  return { h: 0, kind: kindDefault(), pin: 0, rank: 0, span: 0, w: 0, x: 0, y: 0 }
}

/** An edge of a layered layout. Mirrors Pele's `LEdge`. */
export type LEdge = {
  /** Index of the head node. */
  head: number
  /** Offset of the head end from the middle of its node, across the flow. */
  headDx: number
  /** Whether the head end is held at its offset and takes no part in sharing out its side. */
  headFixed: boolean
  /** Label height. */
  labelH: number
  /** Label width; 0 for no label. */
  labelW: number
  /** Label center x after layout. */
  labelX: number
  /** Label center y after layout. */
  labelY: number
  /** Least number of ranks the edge spans; 0 counts as 1. */
  minlen: number
  /** Route after layout, as `x, y` pairs from tail to head. */
  points: number[]
  /** Whether the edge runs against the flow, set by `orient`. */
  reversed: boolean
  /** Index of the tail node. */
  tail: number
  /** Offset of the tail end from the middle of its node, across the flow. */
  tailDx: number
  /** Whether the tail end is held at its offset and takes no part in sharing out its side. */
  tailFixed: boolean
}

/** An edge with every field at its default. */
export function lEdgeDefault(): LEdge {
  return {
    head: 0,
    headDx: 0,
    headFixed: false,
    labelH: 0,
    labelW: 0,
    labelX: 0,
    labelY: 0,
    minlen: 0,
    points: [],
    reversed: false,
    tail: 0,
    tailDx: 0,
    tailFixed: false,
  }
}

/** Options of a layered layout. Mirrors Pele's `LayeredOptions`. */
export type LayeredOptions = {
  /**
   * The caller sets the ends of the edges on one side of a node apart itself, so twin edges
   * need no bend to keep them from being drawn as one.
   */
  apart: boolean
  /** Room between edges and bends. */
  edgeSep: number
  /**
   * The room the marker at the head of an edge takes. A rank of labels whose edges all head
   * one way sits half of this nearer their tails.
   */
  headRoom: number
  /** Room between nodes in a rank. */
  nodeSep: number
  /** Room under a rank that holds only group border ports. */
  portSep: number
  /** Room between ranks. */
  rankSep: number
  /** Draw every edge straight from point to point: none is given a level to turn onto. */
  straight: boolean
  /** Route edges at right angles, each on a track of its own across the gap between ranks. */
  tracks: boolean
}

/** Options with every field at its default. */
export function layeredOptionsDefault(): LayeredOptions {
  return {
    apart: false,
    edgeSep: 0,
    headRoom: 0,
    nodeSep: 0,
    portSep: 0,
    rankSep: 0,
    straight: false,
    tracks: false,
  }
}

/** The size of a layered layout. */
export type LayeredResult = {
  /** Height along the flow. */
  height: number
  /** Width across the flow. */
  width: number
}

/** An empty size. */
export function layeredResultDefault(): LayeredResult {
  return { height: 0, width: 0 }
}

/** A node of the given size and kind, as Pele's `lnode` creates it. */
export function lnode(w: number, h: number, kind: Kind): LNode {
  // `{ ...lNodeDefault(), h, kind, w }`, written out in the same key order.
  return { h, kind, pin: 0, rank: 0, span: 0, w, x: 0, y: 0 }
}

/** An edge from `tail` to `head`, as Pele's `ledge` creates it. */
export function ledge(tail: number, head: number, minlen: number, labelW: number, labelH: number): LEdge {
  // `{ ...lEdgeDefault(), head, labelH, labelW, minlen, tail }`, written out in the same key
  // order.
  return {
    head,
    headDx: 0,
    headFixed: false,
    labelH,
    labelW,
    labelX: 0,
    labelY: 0,
    minlen,
    points: [],
    reversed: false,
    tail,
    tailDx: 0,
    tailFixed: false,
  }
}

/** The most crossing-reduction sweeps per attempt. */
const MAX_SWEEPS = 24

/** Past this many bends, the longest edges are drawn as one direct curve instead. */
const MAX_DUMMIES = 20000

/** The room between two edges that meet one side of a node. */
const PORT_PITCH = 16.0

/** The least room that keeps two arrowheads apart. */
const MIN_PITCH = 8.0

/** Where edges get no levels, a gap grows to keep its edges at least this steep. */
const MIN_SLOPE = 0.125

/** A gap grows to at most this many times its usual height. */
const MAX_GAP = 3.0

/** Room kept clear between a rank and the nearest track. */
const TRACK_MARGIN = 18.0

/** Room between two tracks when the gap has to grow to hold them. */
const TRACK_PITCH = 10.0

/** The most room between two tracks when the gap has room to spare. */
const TRACK_SPREAD = 14.0

/** A curve that runs more than this many times as far across as its gap is high is wide. */
const LEVEL_WIDE = 2.0

/** Room kept between a gap's levels and its ranks. */
const LEVEL_MARGIN = 28.0

/** Room between two levels. */
const LEVEL_PITCH = 12.0

/** The room a plain curve is taken to keep straight at each end of its gap. */
const LEVEL_LEAD = 12.0

/** Two curves, one of them wide, nearer than this turn at levels of their own. */
const LEVEL_CLEAR = 8.0

/** Two plain curves nearer than this turn at levels of their own. */
const LEVEL_TOUCH = 4.0

/** A gap whose curves mostly cross is this many times as tall as its widest curve runs across. */
const CROSSED_SLOPE = 0.5

/** How far out of line two points may be and still count as in line. */
const IN_LINE = 0.5

/** The farthest a node moves to bring one more of its edges into line. */
const SNAP = 12.0

/**
 * An end that leans keeps this far from the ends of the part of its side that edges spread
 * along.
 */
const LEAN_CLEAR = 40.0

/** Past this many edges across one gap, tracks are given out in a plain order. */
const MAX_WEIGHED = 400

/** Points sampled along a curve to tell how near two curves pass. */
const SAMPLES = 16

/** What a segment's end is to the node it meets. */
const End = {
  /** The edge arrives at the node. */
  Arrives: 'Arrives',
  /** Held where its offset puts it. */
  Held: 'Held',
  /** The edge leaves the node. */
  Leaves: 'Leaves',
} as const

/** What a segment's end is to the node it meets. */
type End = (typeof End)[keyof typeof End]

/** An array of `len` copies of `value`, built without the `Array.prototype.fill` builtin. */
function numbers(len: number, value: number): number[] {
  const a = new Array<number>(len)
  for (let i = 0; i < len; i++) a[i] = value
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

/** An array of `len` nodes' kinds, all `Kind.Node`. */
function nodeKinds(len: number): Kind[] {
  const a: Kind[] = []
  for (let i = 0; i < len; i++) a.push(Kind.Node)
  return a
}

/** An array of `len` held ends. */
function helds(len: number): End[] {
  const a: End[] = []
  for (let i = 0; i < len; i++) a.push(End.Held)
  return a
}

/**
 * Scratch arrays for `layered` and the passes it runs, reused from call to call so that a
 * layout allocates little. `layered` frees them all when it starts; each take hands out the
 * next one with its first `len` entries set. A taken array may be longer than `len`, so code
 * that uses one never reads its `length` or past `len`.
 */
const intPool: number[][] = []
let intNext = 0
const floatPool: number[][] = []
let floatNext = 0
const boolPool: boolean[][] = []
let boolNext = 0
const nonePool: (number | undefined)[][] = []
let noneNext = 0

/**
 * A scratch array whose first `len` entries are `value`, for small integers. Integers and
 * fractions are kept in separate pools so that each pool's arrays keep one elements kind.
 */
function takeInts(len: number, value: number): number[] {
  let a = intPool[intNext]
  if (a === undefined) {
    a = []
    intPool.push(a)
  }
  intNext += 1
  for (let i = 0; i < len; i++) a[i] = value
  return a
}

/**
 * A scratch array of small integers with room for `len` entries, which the caller sets before
 * it reads them.
 */
function takeIntsRaw(len: number): number[] {
  let a = intPool[intNext]
  if (a === undefined) {
    a = []
    intPool.push(a)
  }
  intNext += 1
  for (let i = a.length; i < len; i++) a.push(0)
  return a
}

/** A scratch array whose first `len` entries are `value`, for any numbers. */
function takeFloats(len: number, value: number): number[] {
  let a = floatPool[floatNext]
  if (a === undefined) {
    a = []
    floatPool.push(a)
  }
  floatNext += 1
  for (let i = 0; i < len; i++) a[i] = value
  return a
}

/** A scratch array whose first `len` entries are `value`. */
function takeBools(len: number, value: boolean): boolean[] {
  let a = boolPool[boolNext]
  if (a === undefined) {
    a = []
    boolPool.push(a)
  }
  boolNext += 1
  for (let i = 0; i < len; i++) a[i] = value
  return a
}

/** A scratch array whose first `len` entries are empty. */
function takeNones(len: number): (number | undefined)[] {
  let a = nonePool[noneNext]
  if (a === undefined) {
    a = []
    nonePool.push(a)
  }
  noneNext += 1
  for (let i = 0; i < len; i++) a[i] = undefined
  return a
}

/** Whether a kind is a bend or label of an edge. */
function isDummy(kind: Kind): boolean {
  return kind === Kind.Dummy || kind === Kind.Label
}

/**
 * Orders two numbers as a JavaScript comparator returning `a - b` does: equal values, and
 * `NaN`, tie.
 */
function cmp(a: number, b: number): number {
  return partialCmp(a, b)
}

/**
 * `Math.max(lo, Math.min(hi, x))`, which returns `lo` when `lo > hi` where `f64::clamp`
 * panics.
 */
function clamp(x: number, lo: number, hi: number): number {
  return fmax(lo, fmin(hi, x))
}

/**
 * V8's `Math.hypot` for two values: a compensated sum of squares scaled by the larger value.
 * It differs from `f64::hypot` in the last bit, and the result feeds comparisons.
 */
function hypot(x: number, y: number): number {
  x = Math.abs(x)
  y = Math.abs(y)
  if (x === Number.POSITIVE_INFINITY || y === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  const max = y > x ? y : x
  if (max === 0) return 0

  // The compensated sum unrolled: the first summand is finite and added to zero exactly, so
  // the compensation after it is exactly zero and the second sum is a plain addition.
  const a = x / max
  const b = y / max
  return Math.sqrt(a * a + b * b) * max
}

/** `usize::next_power_of_two`. */
function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/**
 * Ranges shorter than this are sorted in place by the same steps as V8's `Array.prototype.sort`
 * takes for them (one natural run, then binary insertion), so the result matches it exactly
 * even for comparators that are not consistent. Longer ranges go to the built-in sort.
 */
const SMALL_SORT = 64

/** Stable-sorts `list[from..to]` in place, as `slice[from..to].sort_by` does. */
function sortSlice<T>(list: T[], from: number, to: number, compare: (a: T, b: T) => number): void {
  const len = to - from
  if (len < 2) return
  if (len >= SMALL_SORT) {
    const part = list.slice(from, to).sort(compare)
    for (let i = 0; i < part.length; i++) list[from + i] = part[i]
    return
  }
  // V8's `CountAndMakeRun`: the run at the start, reversed if strictly descending.
  let run = 2
  let prev = list[from + 1]
  const descending = compare(prev, list[from]) < 0
  for (let i = from + 2; i < to; i++) {
    const current = list[i]
    const order = compare(current, prev)
    if (descending ? order >= 0 : order < 0) break
    prev = current
    run += 1
  }
  if (descending) {
    let lo = from
    let hi = from + run - 1
    while (lo < hi) {
      const t = list[lo]
      list[lo] = list[hi]
      list[hi] = t
      lo += 1
      hi -= 1
    }
  }
  // V8's `BinaryInsertionSort` for the rest.
  for (let start = from + run; start < to; start++) {
    const pivot = list[start]
    let left = from
    let right = start
    while (left < right) {
      const mid = left + ((right - left) >> 1)
      if (compare(pivot, list[mid]) < 0) right = mid
      else left = mid + 1
    }
    for (let p = start; p > left; p--) list[p] = list[p - 1]
    list[left] = pivot
  }
}

/** Stable-sorts all of `list` in place, as `sort_by` does. */
function sortAll<T>(list: T[], compare: (a: T, b: T) => number): void {
  sortSlice(list, 0, list.length, compare)
}

/**
 * Sorts `list[from..to]` by `key[other[item]]`, then by item: a strict order, so any sorting
 * method gives the same result.
 */
function sortByOtherPos(list: number[], from: number, to: number, key: ArrayLike<number>, other: ArrayLike<number>): void {
  if (to - from >= SMALL_SORT) {
    sortByOtherPosLong(list, from, to, key, other)
    return
  }
  for (let i = from + 1; i < to; i++) {
    const item = list[i]
    const k = key[other[item]]
    let j = i
    while (j > from) {
      const p = list[j - 1]
      const pk = key[other[p]]
      if (pk > k || (pk === k && p > item)) {
        list[j] = p
        j -= 1
      } else {
        break
      }
    }
    list[j] = item
  }
}

/** `sortByOtherPos` by the built-in sort, for long ranges. */
function sortByOtherPosLong(list: number[], from: number, to: number, key: ArrayLike<number>, other: ArrayLike<number>): void {
  const part = list.slice(from, to).sort((a, b) => key[other[a]] - key[other[b]] || a - b)
  for (let i = 0; i < part.length; i++) list[from + i] = part[i]
}

/** Sorts the integers `list[from..to]` ascending. */
function sortInts(list: number[], from: number, to: number): void {
  if (to - from >= SMALL_SORT) {
    const part = list.slice(from, to).sort((a, b) => a - b)
    for (let i = 0; i < part.length; i++) list[from + i] = part[i]
    return
  }
  for (let i = from + 1; i < to; i++) {
    const item = list[i]
    let j = i
    while (j > from && list[j - 1] > item) {
      list[j] = list[j - 1]
      j -= 1
    }
    list[j] = item
  }
}

/**
 * Copies the first `len` entries of `source` into `target`, as `copy_from_slice` does. Scratch
 * arrays may be longer than the slices they hold, so the length is given.
 */
function copyFrom(target: number[], source: number[], len: number): void {
  for (let i = 0; i < len; i++) target[i] = source[i]
}

/** Whether every edge endpoint names one of `count` nodes. */
function valid(count: number, edges: LEdge[]): boolean {
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (!(e.tail < count && e.head < count)) return false
  }
  return true
}

/** Insertion-sorts `list[from..to]` by `key`, then by value. */
function sortRange(list: number[], from: number, to: number, key: ArrayLike<number>): void {
  for (let i = from + 1; i < to; i++) {
    const item = list[i]
    const k = key[item]
    let j = i
    while (j > from && (key[list[j - 1]] > k || (key[list[j - 1]] === k && list[j - 1] > item))) {
      list[j] = list[j - 1]
      j -= 1
    }
    list[j] = item
  }
}

/**
 * Lays out a flat graph in ranks down the y axis. Sets each node's `rank`, `x`, and `y`, and
 * each edge's `reversed`, `points`, and label position, and moves `tailDx` and `headDx`
 * where edges spread along their nodes. Returns the size of the drawing.
 *
 * An edge whose endpoint names no node makes the whole layout empty, where Pele throws.
 */
export function layered(nodes: LNode[], edges: LEdge[], opt: LayeredOptions): LayeredResult {
  const real = nodes.length
  if (real === 0 || !valid(real, edges)) return layeredResultDefault()
  if (real === 1 && edges.length === 0 && nodes[0].kind === Kind.Node && Number.isFinite(nodes[0].w)) {
    return layeredSingle(nodes[0])
  }
  // Every array taken from the pools below is free again: nothing from a past call is live.
  intNext = 0
  floatNext = 0
  boolNext = 0
  noneNext = 0
  const m = edges.length

  // Every edge gets a middle rank of its own when labels or parallel edges need the room.
  let step = 1
  if (m > 32) {
    const seen = new Set<number>()
    for (const e of edges) {
      const key = Math.min(e.tail, e.head) * real + Math.max(e.tail, e.head)
      if (e.labelW > 0 || seen.has(key)) {
        step = 2
        break
      }
      seen.add(key)
    }
  } else {
    // The same test without a set for a few edges: a label, or a pair of nodes already seen.
    for (let i = 0; i < m && step === 1; i++) {
      const e = edges[i]
      if (e.labelW > 0) {
        step = 2
        break
      }
      const key = Math.min(e.tail, e.head) * real + Math.max(e.tail, e.head)
      for (let j = 0; j < i; j++) {
        const f = edges[j]
        if (Math.min(f.tail, f.head) * real + Math.max(f.tail, f.head) === key) {
          step = 2
          break
        }
      }
    }
  }

  orient(nodes, edges)
  rank(nodes, edges, step)

  // Set for every edge below.
  const span: number[] = takeIntsRaw(m)
  let dummies = 0
  for (let ei = 0; ei < m; ei++) {
    const e = edges[ei]
    const s = Math.abs(nodes[e.head].rank - nodes[e.tail].rank)
    span[ei] = s
    if (s > 1) dummies += s - 1
  }
  const direct: boolean[] = takeBools(m, false)
  if (dummies > MAX_DUMMIES) {
    const longest: number[] = []
    for (let ei = 0; ei < m; ei++) if (span[ei] > 1) longest.push(ei)
    sortLongest(longest, span)
    for (const ei of longest) {
      if (dummies <= MAX_DUMMIES) break
      direct[ei] = true
      dummies -= span[ei] - 1
    }
  }

  const n = real + dummies
  const w: number[] = takeFloats(n, 0)
  const h: number[] = takeFloats(n, 0)
  const kind: Kind[] = nodeKinds(n)
  const ranks: number[] = takeInts(n, 0)
  let maxRank = 0
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    w[i] = node.w
    h[i] = node.h
    kind[i] = node.kind
    ranks[i] = node.rank
    maxRank = Math.max(maxRank, node.rank)
  }

  // The graph that gets ordered and positioned: every edge cut into rank-to-rank segments.
  // An edge whose head ranks above its tail (only around a self-loop) counts bends it never
  // gets, as in Pele, and those slots stay zero. The segment arrays are scratch arrays sized to
  // this count, and the passes read `g.segments`; that matches the port, which read the
  // arrays' lengths in some passes, as long as no edge's ends share a rank after ranking, so
  // that no edge writes more segments than it counts. `compoundLayout` never builds such an
  // edge: each edge has a plain node at one end at least, and `rank` puts edges between plain
  // nodes at least one rank apart and ports a step beyond them.
  let segments = 0
  for (let ei = 0; ei < m; ei++) if (!direct[ei]) segments += span[ei]
  const ef: number[] = takeInts(segments, 0)
  const et: number[] = takeInts(segments, 0)
  const efd: number[] = takeFloats(segments, 0)
  const etd: number[] = takeFloats(segments, 0)
  const firstDummy: (number | undefined)[] = takeNones(m)
  // Which way the edges with a label in each rank head: 1 down, 2 up, 3 both.
  const heads: number[] = takeInts(maxRank + 1, 0)
  const labelNode: (number | undefined)[] = takeNones(m)
  const spans = nodes.some((v) => v.span > 0 && v.kind === Kind.Node)
  // What each segment's end is to the node it meets, for the ends that may move along a side.
  const ends = spans ? segments : 0
  const efk: End[] = helds(ends)
  const etk: End[] = helds(ends)
  const firstSeg: number[] = takeInts(m, 0)
  const lastSeg: number[] = takeInts(m, 0)
  let offsets = false
  {
    let next = real
    let ce = 0
    for (let ei = 0; ei < m; ei++) {
      const e = edges[ei]
      if (direct[ei]) continue
      const a = e.reversed ? e.head : e.tail
      const b = e.reversed ? e.tail : e.head
      const aDx = e.reversed ? e.headDx : e.tailDx
      const bDx = e.reversed ? e.tailDx : e.headDx
      if (aDx !== 0 || bDx !== 0) offsets = true
      const ra = ranks[a]
      const rb = ranks[b]
      // The label goes halfway along: in a rank of nodes beside them for a long edge, the
      // nearer its start of the two either side of halfway, or in the rank between two
      // neighbouring ranks. Only an edge that gets bends can hold it.
      let labelRank: number | undefined
      if (e.labelW > 0 && rb > ra + 1) {
        let r = ra + ((rb - ra) >> 1)
        if (step === 2 && rb - ra >= 4) {
          if ((r & 1) === 1) r = e.reversed ? r + 1 : r - 1
        } else if (step === 2 && (r & 1) === 0) {
          r = e.reversed ? r + 1 : r - 1
        }
        labelRank = r
      }
      let prev = a
      if (rb > ra + 1) firstDummy[ei] = next
      firstSeg[ei] = ce
      if (spans && !(e.reversed ? e.headFixed : e.tailFixed)) {
        efk[ce] = e.reversed ? End.Arrives : End.Leaves
      }
      for (let r = ra + 1; r < rb; r++) {
        const d = next
        next += 1
        ranks[d] = r
        if (labelRank === r) {
          w[d] = e.labelW
          h[d] = e.labelH
          kind[d] = Kind.Label
          labelNode[ei] = d
          heads[r] |= e.reversed ? 2 : 1
        } else {
          kind[d] = Kind.Dummy
        }
        ef[ce] = prev
        et[ce] = d
        efd[ce] = prev === a ? aDx : 0
        ce += 1
        prev = d
      }
      ef[ce] = prev
      et[ce] = b
      efd[ce] = prev === a ? aDx : 0
      etd[ce] = bDx
      if (spans && !(e.reversed ? e.tailFixed : e.headFixed)) {
        etk[ce] = e.reversed ? End.Leaves : End.Arrives
      }
      lastSeg[ei] = ce
      ce += 1
    }
  }

  const succStart: number[] = takeInts(n + 1, 0)
  const predStart: number[] = takeInts(n + 1, 0)
  for (let e = 0; e < segments; e++) {
    succStart[ef[e] + 1] += 1
    predStart[et[e] + 1] += 1
  }
  for (let i = 0; i < n; i++) {
    succStart[i + 1] += succStart[i]
    predStart[i + 1] += predStart[i]
  }
  // Each segment takes one slot of each below.
  const succE: number[] = takeIntsRaw(segments)
  const predE: number[] = takeIntsRaw(segments)
  {
    const sf = succStart.slice(0, n)
    const pf = predStart.slice(0, n)
    for (let e = 0; e < segments; e++) {
      succE[sf[ef[e]]] = e
      sf[ef[e]] += 1
      predE[pf[et[e]]] = e
      pf[et[e]] += 1
    }
  }

  const layerStart: number[] = takeInts(maxRank + 2, 0)
  for (let i = 0; i < n; i++) layerStart[ranks[i] + 1] += 1
  for (let r = 0; r <= maxRank; r++) layerStart[r + 1] += layerStart[r]
  // The depth-first pass below puts every node in one slot of its rank.
  const order: number[] = takeIntsRaw(n)

  // Initial order: depth-first from the top so that subtrees start out contiguous.
  {
    const byRank: number[] = takeIntsRaw(n)
    const fill = layerStart.slice(0, maxRank + 1)
    for (let i = 0; i < n; i++) {
      byRank[fill[ranks[i]]] = i
      fill[ranks[i]] += 1
    }
    copyFrom(fill, layerStart, maxRank + 1)
    const visited: boolean[] = takeBools(n, false)
    const stack: number[] = []
    for (let b = 0; b < n; b++) {
      const first = byRank[b]
      if (visited[first]) continue
      stack.push(first)
      while (stack.length > 0) {
        const v = stack.pop() as number
        if (visited[v]) continue
        visited[v] = true
        order[fill[ranks[v]]] = v
        fill[ranks[v]] += 1
        for (let j = succStart[v + 1] - 1; j >= succStart[v]; j--) {
          const w = et[succE[j]]
          if (!visited[w]) stack.push(w)
        }
      }
    }
  }

  if (nodes.some((v) => v.pin !== 0)) sortPins(order, layerStart, maxRank, nodes, real)

  const g: Graph = {
    ef,
    efd,
    et,
    etd,
    kind,
    layerStart,
    maxRank,
    n,
    offsets,
    order,
    // Set for every node by `graphSetPositions` below.
    pos: takeIntsRaw(n),
    predE,
    predStart,
    rank: ranks,
    real,
    segments,
    succE,
    succStart,
    w,
  }
  graphSetPositions(g)

  if (segments > 0 && maxRank > 0) {
    reduceCrossings(g, nodes)
    graphSetPositions(g)
  }

  if (spans) spread(g, nodes, efk, etk)

  const xs = position(g, opt)

  const empty = emptyRanks(g)
  if (spans) {
    const free = freeEnds(g, efk, etk)
    alignLabels(g, nodes, xs, free, opt, empty)
    settle(g, nodes, xs, efk, etk, free, empty)
    snap(g, xs, empty, opt)
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei]
      if (direct[ei]) continue
      const aDx = g.efd[firstSeg[ei]]
      const bDx = g.etd[lastSeg[ei]]
      e.tailDx = e.reversed ? bDx : aDx
      e.headDx = e.reversed ? aDx : bDx
    }
  }

  // A rank that holds nothing but bends is only there because some other edge has a label or
  // a twin. Its bends move onto the straight line between the ends of their edges, and one
  // that gets there is left out of the route.
  const onLine: boolean[] = takeBools(n, false)
  if (empty !== undefined && !opt.tracks) {
    const sep = opt.apart ? 0 : opt.edgeSep
    straighten(g, xs, empty, firstDummy, m, span, sep, onLine)
  }
  if (!opt.tracks) pastLabels(g, xs, firstDummy, m, span, opt.edgeSep, onLine)

  // An edge is cut where it passes a rank that holds something, and each piece crosses one
  // gap. With `tracks`, every piece that does not run straight gets a track; otherwise, where
  // edges spread along their nodes, a piece gets one only if it needs a level to turn onto.
  const pieceStart: number[] = takeInts(m + 1, 0)
  const pieces: Pieces | undefined = opt.tracks || (spans && !opt.straight) ? piecesDefault() : undefined
  const trackCount: number[] = takeFloats(maxRank + 1, 0)
  if (pieces !== undefined) {
    for (let ei = 0; ei < m; ei++) {
      pieceStart[ei] = pieces.from.length
      if (direct[ei]) continue
      const d0 = firstDummy[ei]
      const bendsStart = d0 === undefined ? 0 : d0
      const bendsEnd = d0 === undefined ? 0 : d0 + span[ei] - 1
      // An edge that keeps a bend to stay clear of its twin is drawn through the bend, as
      // it is, and so is one that has a bend left out in a rank of labels.
      let twin = false
      if (!opt.tracks) {
        for (let d = bendsStart; d < bendsEnd; d++) {
          if ((empty !== undefined && empty[g.rank[d]]) !== onLine[d]) {
            twin = true
            break
          }
        }
      }
      if (twin) continue
      const first = firstSeg[ei]
      let x = xs[g.ef[first]] + g.efd[first]
      let rk = g.rank[g.ef[first]]
      for (let d = bendsStart; d < bendsEnd; d++) {
        if (empty !== undefined && empty[g.rank[d]]) continue
        pieces.from.push(x)
        pieces.to.push(xs[d])
        pieces.rank.push(rk)
        pieces.lower.push(d)
        x = xs[d]
        rk = g.rank[d]
      }
      const last = lastSeg[ei]
      pieces.from.push(x)
      pieces.to.push(xs[g.et[last]] + g.etd[last])
      pieces.rank.push(rk)
      pieces.lower.push(undefined)
    }
    pieceStart[m] = pieces.from.length
  }

  // Ranks that hold only border ports or their pass-through dummies need little room.
  const startRanks = portOnly(g, 0, Kind.StartPort) ? step : 0
  const endRanks = portOnly(g, maxRank, Kind.EndPort) ? step : 0
  // The longest way across that any edge travels in the gap below each rank.
  const run: number[] = takeFloats(maxRank + 1, 0)
  for (let e = 0; e < segments; e++) {
    const across = Math.abs(xs[g.ef[e]] + g.efd[e] - xs[g.et[e]] - g.etd[e])
    const r = g.rank[g.ef[e]]
    if (across > run[r]) run[r] = across
  }
  const stepF = step
  // The room under each rank. Edges that are not cut into pieces need more where they run
  // far across.
  const gapUnder: number[] = takeFloats(maxRank + 1, 0)
  for (let r = 0; r < maxRank; r++) {
    const usual = (r < startRanks || r + endRanks >= maxRank ? opt.portSep : opt.rankSep) / stepF
    gapUnder[r] = pieces !== undefined ? usual : fmax(usual, fmin((MAX_GAP * opt.rankSep) / stepF, run[r] * MIN_SLOPE))
  }
  // A rank between two ranks of nodes, which holds labels and bends only.
  const between: boolean[] = takeBools(maxRank + 1, true)
  for (let i = 0; i < real; i++) between[g.rank[i]] = false
  for (let r = 1; r < maxRank; r++) {
    if (opt.tracks || !between[r] || (heads[r] !== 1 && heads[r] !== 2)) continue
    const down = heads[r] === 1
    const shift = fmin(opt.headRoom / 2, gapUnder[down ? r - 1 : r] / 2)
    gapUnder[r - 1] += down ? -shift : shift
    gapUnder[r] += down ? shift : -shift
  }
  // The rank that the pieces leaving each rank arrive at, past any that hold only bends, and
  // the room between the two, which grows to hold the gap's tracks or levels.
  const margin = opt.tracks ? TRACK_MARGIN : LEVEL_MARGIN
  const leastPitch = opt.tracks ? TRACK_PITCH : LEVEL_PITCH
  const mostPitch = opt.tracks ? TRACK_SPREAD : LEVEL_PITCH
  const below: number[] = takeInts(maxRank + 1, 0)
  if (pieces !== undefined) {
    const room: number[] = takeFloats(maxRank + 1, 0)
    for (let r = 0; r < maxRank; r++) {
      if (empty !== undefined && empty[r]) continue
      let next = r + 1
      room[r] = gapUnder[r]
      while (next < maxRank && empty !== undefined && empty[next]) {
        room[r] += gapUnder[next]
        next += 1
      }
      below[r] = next
    }
    for (let k = 0; k < pieces.from.length; k++) {
      const wide = Math.abs(pieces.from[k] - pieces.to[k]) > LEVEL_WIDE * room[pieces.rank[k]]
      pieces.wide.push(wide)
    }
    const tall: number[] = takeFloats(maxRank + 1, 0)
    assignTracks(pieces, trackCount, maxRank + 1, !opt.tracks, room, tall)
    for (let r = 0; r < maxRank; r++) {
      if (trackCount[r] > 0) {
        const need = 2 * margin + (trackCount[r] - 1) * leastPitch - room[r]
        gapUnder[r] += fmax(need, 0)
      } else if (tall[r] > 0) {
        gapUnder[r] += fmax(fmin(MAX_GAP * opt.rankSep, tall[r]) - room[r], 0)
      }
    }
  }
  const bandTop: number[] = takeFloats(maxRank + 1, 0)
  const bandBottom: number[] = takeFloats(maxRank + 1, 0)
  let y = 0
  for (let r = 0; r <= maxRank; r++) {
    let tallest = 0
    for (let i = g.layerStart[r]; i < g.layerStart[r + 1]; i++) {
      const v = g.order[i]
      if (h[v] > tallest) tallest = h[v]
    }
    bandTop[r] = y
    bandBottom[r] = y + tallest
    y += tallest + gapUnder[r]
  }
  const height = y
  const bands: Bands = { below, between, bottom: bandBottom, margin, mostPitch, top: bandTop, trackCount, tracks: opt.tracks }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    const half = g.w[i] / 2
    if (xs[i] - half < minX) minX = xs[i] - half
    if (xs[i] + half > maxX) maxX = xs[i] + half
  }
  // Where edges spread along their nodes, a rank whose nodes only send edges on stands on one
  // line, and a rank whose nodes only receive them hangs from one. Other ranks are centered.
  const arrives: boolean[] = takeBools(maxRank + 1, false)
  const leaves: boolean[] = takeBools(maxRank + 1, false)
  for (let i = 0; i < real; i++) {
    if (g.kind[i] !== Kind.Node || !spans) continue
    if (g.predStart[i + 1] > g.predStart[i]) arrives[g.rank[i]] = true
    if (g.succStart[i + 1] > g.succStart[i]) leaves[g.rank[i]] = true
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const r = node.rank
    node.x = xs[i] - minX
    if (g.kind[i] === Kind.Node && leaves[r] && !arrives[r]) node.y = bandBottom[r] - node.h / 2
    else if (g.kind[i] === Kind.Node && arrives[r] && !leaves[r]) node.y = bandTop[r] + node.h / 2
    else node.y = midpoint(bandTop[r], bandBottom[r])
  }

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei]
    const first = nodes[e.reversed ? e.head : e.tail]
    const last = nodes[e.reversed ? e.tail : e.head]
    const firstDx = e.reversed ? e.headDx : e.tailDx
    const pts: number[] = [first.x + firstDx, first.y + first.h / 2]
    const d0 = firstDummy[ei]
    if (pieces !== undefined && pieceStart[ei + 1] > pieceStart[ei]) {
      for (let k = pieceStart[ei]; k < pieceStart[ei + 1]; k++) {
        const track = pieces.track[k]
        if (track >= 0 && (opt.tracks || pieces.wide[k])) {
          const across = trackY(bands, pieces, k, track)
          pts.push(pieces.from[k] - minX, across, pieces.to[k] - minX, across)
        } else if (track > 0) {
          // A short piece among levels runs straight until it is past the level
          // before its own, and turns in one S from there.
          pts.push(pieces.from[k] - minX, trackY(bands, pieces, k, track - 1))
        }
        const d = pieces.lower[k]
        if (d === undefined) continue
        const r = g.rank[d]
        pts.push(xs[d] - minX, bandTop[r] + inset(g, bands, d))
        if (bandBottom[r] > bandTop[r]) pts.push(xs[d] - minX, bandBottom[r] - inset(g, bands, d))
      }
    } else if (d0 !== undefined) {
      for (let d = d0; d < d0 + span[ei] - 1; d++) {
        if (onLine[d]) continue
        const x = xs[d] - minX
        const top = bandTop[g.rank[d]]
        const bottom = bandBottom[g.rank[d]]
        pts.push(x, top + inset(g, bands, d))
        if (bottom > top) pts.push(x, bottom - inset(g, bands, d))
      }
    }
    const lastDx = e.reversed ? e.tailDx : e.headDx
    pts.push(last.x + lastDx, last.y - last.h / 2)
    if (e.reversed) {
      const pairs = pts.length >> 1
      for (let i = 0; i < pairs >> 1; i++) {
        const j = pairs - 1 - i
        let t = pts[2 * i]
        pts[2 * i] = pts[2 * j]
        pts[2 * j] = t
        t = pts[2 * i + 1]
        pts[2 * i + 1] = pts[2 * j + 1]
        pts[2 * j + 1] = t
      }
    }
    const ln = labelNode[ei]
    if (ln !== undefined) {
      e.labelX = xs[ln] - minX
      e.labelY = midpoint(bandTop[g.rank[ln]], bandBottom[g.rank[ln]])
    } else if (e.labelW > 0) {
      const len = pts.length
      e.labelX = midpoint(pts[0], pts[len - 2])
      e.labelY = midpoint(pts[1], pts[len - 1])
    }
    e.points = pts
  }

  return { height, width: maxX - minX }
}

/** Sorts the edges in `longest` by how many ranks they span, most first. */
function sortLongest(longest: number[], span: number[]): void {
  sortAll(longest, (a, b) => span[b] - span[a] || a - b)
}

/** Moves the nodes pinned first or last in each rank to the start or end of it. */
function sortPins(order: number[], layerStart: number[], maxRank: number, nodes: LNode[], real: number): void {
  const pin = (v: number) => (v < real ? nodes[v].pin : 0)
  for (let r = 0; r <= maxRank; r++) {
    sortSlice(order, layerStart[r], layerStart[r + 1], (a, b) => cmp(pin(a), pin(b)))
  }
}

/** Whether rank `r` holds a `port` and otherwise only bends. */
function portOnly(g: Graph, r: number, port: Kind): boolean {
  let found = false
  for (let i = g.layerStart[r]; i < g.layerStart[r + 1]; i++) {
    const v = g.order[i]
    if (g.kind[v] === port) found = true
    else if (g.kind[v] !== Kind.Dummy) return false
  }
  return found
}

/** Where the ranks and the gaps between them lie along the flow, once `layered` knows. */
type Bands = {
  /** The rank that the pieces leaving each rank arrive at. */
  below: number[]
  /** Whether each rank lies between two ranks of nodes, holding labels and bends only. */
  between: boolean[]
  /** The bottom of each rank. */
  bottom: number[]
  /** Room kept clear between a rank and the nearest track or level. */
  margin: number
  /** The most room between two tracks. */
  mostPitch: number
  /** The top of each rank. */
  top: number[]
  /** The number of tracks in the gap under each rank. */
  trackCount: number[]
  /** Whether edges are routed on tracks. */
  tracks: boolean
}

/**
 * The part of its rank that an edge runs straight through at a bend or label. A bare bend
 * beside labels keeps to the middle half.
 */
function inset(g: Graph, bands: Bands, d: number): number {
  const r = g.rank[d]
  if (g.kind[d] === Kind.Dummy && bands.between[r] && !bands.tracks) return (bands.bottom[r] - bands.top[r]) / 4
  return 0
}

/**
 * Where a piece runs across its gap on a track of its group: its tracks sit in the middle of
 * the gap, the first at the top.
 */
function trackY(bands: Bands, pieces: Pieces, piece: number, onTrack: number): number {
  const r = pieces.rank[piece]
  const top = bands.bottom[r]
  const bottom = bands.top[bands.below[r]]
  const count = bands.tracks ? bands.trackCount[r] : pieces.levels[piece]
  const pitch = count > 1 ? fmin(bands.mostPitch, (bottom - top - 2 * bands.margin) / (count - 1)) : 0
  const on = onTrack < 0 ? 0 : onTrack
  return midpoint(top, bottom) + (on - saturatingSub(count, 1) / 2) * pitch
}

/**
 * `layered` for one plain node of finite width and no edges, without the passes that have
 * nothing to do. Each value comes from the same expressions the full layout evaluates for it:
 * the node takes rank 0, all four aligned layouts put it at +0, and its rank has no gap below.
 */
function layeredSingle(node: LNode): LayeredResult {
  node.rank = 0
  const x = 0
  const half = node.w / 2
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  if (x - half < minX) minX = x - half
  if (x + half > maxX) maxX = x + half
  const tallest = node.h > 0 ? node.h : 0
  const top = 0
  const bottom = top + tallest
  const height = top + (tallest + 0)
  node.x = x - minX
  node.y = midpoint(top, bottom)
  return { height, width: maxX - minX }
}

/**
 * The pieces of edges that each cross one gap. Where only some pieces get a level to turn
 * onto, `wide` marks those that run far across, `levels` is how many tracks the group a piece
 * belongs to takes (0 for none), and each track counts from its group's first.
 */
type Pieces = {
  /** Where each piece leaves the rank above. */
  from: number[]
  /** How many tracks each piece's group takes. */
  levels: number[]
  /** The bend each piece ends at, or `undefined` at the edge's last node. */
  lower: (number | undefined)[]
  /** The rank above each piece. */
  rank: number[]
  /** Where each piece reaches the rank below. */
  to: number[]
  /** The track each piece runs across on, or -1. */
  track: number[]
  /** Whether each piece runs far across its gap. */
  wide: boolean[]
}

/** No pieces. */
function piecesDefault(): Pieces {
  return { from: [], levels: [], lower: [], rank: [], to: [], track: [], wide: [] }
}

/** The graph that gets ordered and positioned. Mirrors Pele's `Graph`. */
type Graph = {
  /** Segment tails. */
  ef: number[]
  /** Where each segment attaches on its tail, from the middle. */
  efd: number[]
  /** Segment heads. */
  et: number[]
  /** Where each segment attaches on its head, from the middle. */
  etd: number[]
  /** Each node's kind. */
  kind: Kind[]
  /** Where each rank starts in `order`, with one more entry for the end. */
  layerStart: number[]
  /** The last rank. */
  maxRank: number
  /** Node count, bends and labels included. */
  n: number
  /** Whether any edge end is offset from the middle of its node. */
  offsets: boolean
  /** Nodes rank by rank, each rank in order across. */
  order: number[]
  /** Each node's place within its rank. */
  pos: number[]
  /** Segments into each node, grouped by `predStart`. */
  predE: number[]
  /** Where each node's incoming segments start in `predE`. */
  predStart: number[]
  /** Each node's rank. */
  rank: number[]
  /** Count of the caller's nodes, which come first. */
  real: number
  /** Segment count. The segment arrays may be longer, as they are reused from call to call. */
  segments: number
  /** Segments out of each node, grouped by `succStart`. */
  succE: number[]
  /** Where each node's outgoing segments start in `succE`. */
  succStart: number[]
  /** Each node's width. */
  w: number[]
}

/** Sets `pos` from `order`. */
function graphSetPositions(g: Graph): void {
  for (let r = 0; r <= g.maxRank; r++) {
    const s = g.layerStart[r]
    for (let i = s; i < g.layerStart[r + 1]; i++) g.pos[g.order[i]] = i - s
  }
}

/**
 * Reverses the edges that close a cycle, found by depth-first search in declaration order.
 * Edges into a start port or out of an end port are reversed outright.
 */
export function orient(nodes: LNode[], edges: LEdge[]): void {
  const n = nodes.length
  if (!valid(n, edges)) return
  // The scratch arrays taken below are given back on return.
  const mark = intNext
  const start: number[] = takeInts(n + 1, 0)
  for (const e of edges) {
    e.reversed = nodes[e.head].kind === Kind.StartPort || nodes[e.tail].kind === Kind.EndPort
    if (!e.reversed) start[e.tail + 1] += 1
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const out: number[] = takeInts(start[n], 0)
  {
    const fill = start.slice(0, n)
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]
      if (!e.reversed) {
        out[fill[e.tail]] = i
        fill[e.tail] += 1
      }
    }
  }
  const state: number[] = takeInts(n, 0)
  const cursor = start.slice(0, n)
  const stack: number[] = []
  for (let root = 0; root < n; root++) {
    if (state[root] !== 0) continue
    stack.push(root)
    state[root] = 1
    while (stack.length > 0) {
      const v = stack[stack.length - 1]
      if (cursor[v] < start[v + 1]) {
        const e = edges[out[cursor[v]]]
        cursor[v] += 1
        const w = e.head
        if (state[w] === 1) {
          e.reversed = true
        } else if (state[w] === 0) {
          state[w] = 1
          stack.push(w)
        }
      } else {
        state[v] = 2
        stack.pop()
      }
    }
  }
  intNext = mark
}

/**
 * Ranks the nodes by longest path along the oriented edges, each edge spanning at least
 * `minlen * step` ranks, then pulls loosely attached nodes toward the side with more edges.
 * Start ports go one step above every other node and end ports one step below.
 */
export function rank(nodes: LNode[], edges: LEdge[], step: number): void {
  const n = nodes.length
  if (!valid(n, edges)) return
  // The scratch arrays taken below are given back on return.
  const mark = intNext
  const m = edges.length
  step = Math.min(step, 4294967295)
  const from: number[] = takeInts(m, 0)
  const to: number[] = takeInts(m, 0)
  const len: number[] = takeInts(m, 0)
  const outStart: number[] = takeInts(n + 1, 0)
  const inStart: number[] = takeInts(n + 1, 0)
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    const a = e.reversed ? e.head : e.tail
    const b = e.reversed ? e.tail : e.head
    from[i] = a
    to[i] = b
    len[i] = Math.max(e.minlen, 1) * step
    outStart[a + 1] += 1
    inStart[b + 1] += 1
  }
  for (let i = 0; i < n; i++) {
    outStart[i + 1] += outStart[i]
    inStart[i + 1] += inStart[i]
  }
  const outE: number[] = takeInts(m, 0)
  const inE: number[] = takeInts(m, 0)
  {
    const of = outStart.slice(0, n)
    const inf = inStart.slice(0, n)
    for (let i = 0; i < m; i++) {
      outE[of[from[i]]] = i
      of[from[i]] += 1
      inE[inf[to[i]]] = i
      inf[to[i]] += 1
    }
  }

  const r: number[] = takeInts(n, 0)
  const indeg: number[] = []
  for (let i = 0; i < n; i++) indeg.push(inStart[i + 1] - inStart[i])
  const topo: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) topo.push(i)
  let q = 0
  while (q < topo.length) {
    const v = topo[q]
    q += 1
    for (let j = outStart[v]; j < outStart[v + 1]; j++) {
      const ei = outE[j]
      const w = to[ei]
      if (r[v] + len[ei] > r[w]) r[w] = r[v] + len[ei]
      indeg[w] -= 1
      if (indeg[w] === 0) topo.push(w)
    }
  }

  // Longest-path ranking leaves loosely attached nodes far from their neighbours. Move each
  // node toward the side that has more edges.
  for (let iteration = 0; iteration < 8; iteration++) {
    let changed = false
    for (let t = topo.length - 1; t >= 0; t--) {
      const v = topo[t]
      const ins = inStart[v + 1] - inStart[v]
      const outs = outStart[v + 1] - outStart[v]
      if (ins === 0 && outs === 0) continue
      let lo: number | undefined
      for (let j = inStart[v]; j < inStart[v + 1]; j++) {
        const ei = inE[j]
        const value = r[from[ei]] + len[ei]
        if (lo === undefined || value > lo) lo = value
      }
      let hi: number | undefined
      for (let j = outStart[v]; j < outStart[v + 1]; j++) {
        const ei = outE[j]
        const value = r[to[ei]] - len[ei]
        if (hi === undefined || value < hi) hi = value
      }
      let next: number
      if (hi !== undefined && outs > ins) next = hi
      else if (lo !== undefined && ins > outs) next = lo
      else next = r[v]
      if (next !== r[v]) {
        r[v] = next
        changed = true
      }
    }
    if (!changed) break
  }

  let min: number | undefined
  let max: number | undefined
  let startPorts = false
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.kind === Kind.StartPort) startPorts = true
    if (node.kind === Kind.StartPort || node.kind === Kind.EndPort) continue
    min = min === undefined ? r[i] : Math.min(min, r[i])
    max = max === undefined ? r[i] : Math.max(max, r[i])
  }
  let least = min ?? 0
  const most = max ?? 0
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.kind === Kind.StartPort) r[i] = least - step
    else if (node.kind === Kind.EndPort) r[i] = most + step
  }
  if (startPorts) least -= step
  for (let i = 0; i < nodes.length; i++) {
    const value = r[i] - least
    nodes[i].rank = value < 0 ? 0 : value
  }
  intNext = mark
}

/**
 * The ends of edges that may move along one side of a node (0 the side its edges arrive at, 1
 * the other) into `ids`, in the order of the nodes at their other ends. `room` receives the
 * least distance between each end and the one before it, and the result is their sum. With
 * too little room, ends that leave side by side move closer, then neighbours that run the same
 * way share a place.
 */
function sideEnds(
  g: Graph,
  v: number,
  side: number,
  span: number,
  kinds: End[],
  ids: number[],
  room: number[],
): number {
  const start = side === 0 ? g.predStart : g.succStart
  const list = side === 0 ? g.predE : g.succE
  const other = side === 0 ? g.ef : g.et
  let count = 0
  for (let j = start[v]; j < start[v + 1]; j++) {
    const k = list[j]
    if (kinds[k] !== End.Held) {
      ids[count] = k
      count += 1
    }
  }
  sideCount = count
  if (count < 2) return 0
  sortByOtherPos(ids, 0, count, g.pos, other)
  let total = sideFill(ids, count, kinds, room, 0)
  if (span / total < MIN_PITCH) total = sideFill(ids, count, kinds, room, 1)
  if (span / total < MIN_PITCH) total = sideFill(ids, count, kinds, room, 2)
  if (total === 0) return 0
  const pitch = fmin(PORT_PITCH, span / total)
  for (let k = 1; k < count; k++) room[k] *= pitch
  return total * pitch
}

/**
 * How many ends the last call of `sideEnds` put in `ids`. The buffers it fills are reused and
 * may hold more entries past these.
 */
let sideCount = 0

/**
 * The shares of room between the first `count` ends in `ids`, by `mode`, into `room`; returns
 * their sum.
 */
function sideFill(ids: number[], count: number, kinds: End[], room: number[], mode: number): number {
  let total = 0
  room[0] = 0
  for (let k = 1; k < count; k++) {
    const same = kinds[ids[k]] === kinds[ids[k - 1]]
    let share: number
    if (mode === 1 && same && kinds[ids[k]] === End.Leaves) share = 0.5
    else if (mode === 2 && same) share = 0
    else share = 1
    room[k] = share
    total += share
  }
  return total
}

/** Gives the edges that meet one side of a node places of their own along it, around its middle. */
function spread(g: Graph, nodes: LNode[], efk: End[], etk: End[]): void {
  const ids: number[] = []
  const room: number[] = []
  for (let v = 0; v < g.real; v++) {
    const span = fmin(nodes[v].span, g.w[v])
    if (span <= 0 || nodes[v].kind !== Kind.Node) continue
    for (let side = 0; side < 2; side++) {
      const kinds = side === 0 ? etk : efk
      const total = sideEnds(g, v, side, span, kinds, ids, room)
      if (total === 0) continue
      const dx = side === 0 ? g.etd : g.efd
      let at = -total / 2
      const count = sideCount
      for (let k = 0; k < count; k++) {
        at += room[k]
        dx[ids[k]] = at
      }
    }
  }
}

/**
 * The segment of an edge that reaches the next point held in place, on the way up from
 * segment `e` (side 0) or down: past the bends in ranks that hold nothing else.
 */
function follow(g: Graph, empty: boolean[] | undefined, e: number, side: number): number {
  if (empty === undefined) return e
  for (let i = 0; i < 100_000; i++) {
    const u = side === 0 ? g.ef[e] : g.et[e]
    if (g.kind[u] !== Kind.Dummy || !empty[g.rank[u]]) break
    e = side === 0 ? g.predE[g.predStart[u]] : g.succE[g.succStart[u]]
  }
  return e
}

/**
 * How many ends that may move along it each node has on the side its edges arrive at, and on
 * the other.
 */
function freeEnds(g: Graph, efk: End[], etk: End[]): [number[], number[]] {
  const free: [number[], number[]] = [takeInts(g.n, 0), takeInts(g.n, 0)]
  for (let e = 0; e < g.segments; e++) {
    if (etk[e] !== End.Held) free[0][g.et[e]] += 1
    if (efk[e] !== End.Held) free[1][g.ef[e]] += 1
  }
  return free
}

/**
 * How far along the flow the handles of a plain S reach, as a share of the way it travels along
 * it. Half gives an even S; one that runs far across turns sooner, down to a quarter. The
 * layout uses this to tell how near two curves will pass, and the drawing to draw them.
 */
export function ease(across: number, along: number): number {
  // `Math.abs(across) || 1` also replaces NaN.
  const a = across === 0 || Number.isNaN(across) ? 1 : Math.abs(across)
  return fclamp((4 * Math.abs(along)) / a, 0.25, 0.5)
}

/**
 * Where segment `e` ends on the way up (side 0) or down. How many ends share that side of the
 * node there, none for a point that is not on a node, goes to `endShared`.
 */
function segmentEnd(
  g: Graph,
  nodes: LNode[],
  xs: number[],
  free: [number[], number[]],
  e: number,
  side: number,
): number {
  const u = side === 0 ? g.ef[e] : g.et[e]
  const x = side === 0 ? xs[u] + g.efd[e] : xs[u] + g.etd[e]
  endShared = u < g.real && nodes[u].kind === Kind.Node ? free[1 - side][u] : 0
  return x
}

/** How many ends share the side that the last call of `segmentEnd` reached. */
let endShared = 0

/**
 * The room the neighbours in its rank leave a label or bend: a full gap from a node or
 * between two labels, half of one between a label and a line that passes it. Returns the left
 * end; the right end goes to `roomHi`.
 */
function labelRoom(g: Graph, xs: number[], opt: LayeredOptions, v: number): number {
  const s = g.layerStart[g.rank[v]]
  const i = s + g.pos[v]
  roomHi =
    i + 1 < g.layerStart[g.rank[v] + 1]
      ? xs[g.order[i + 1]] - labelClear(g, opt, v, g.order[i + 1])
      : Number.POSITIVE_INFINITY
  return i > s ? xs[g.order[i - 1]] + labelClear(g, opt, v, g.order[i - 1]) : Number.NEGATIVE_INFINITY
}

/** The right end of the room that the last call of `labelRoom` found. */
let roomHi = 0

/** How far the middle of label or bend `v` keeps from the middle of its neighbour `other`. */
function labelClear(g: Graph, opt: LayeredOptions, v: number, other: number): number {
  const sep = opt.edgeSep
  let extra: number
  if (g.kind[other] === Kind.Node) extra = opt.nodeSep / 2 + sep / 2
  else if (g.kind[other] === g.kind[v]) extra = sep
  else extra = sep / 2
  return g.w[other] / 2 + g.w[v] / 2 + extra
}

/**
 * The place between `lo` and `hi` that is in line with one of two ends, or else nearest the
 * first choice.
 */
function choose(
  x: number,
  upX: number,
  upShared: number,
  downX: number,
  downShared: number,
  lo: number,
  hi: number,
): number {
  const upFirst = upShared === downShared ? Math.abs(upX - x) <= Math.abs(downX - x) : upShared < downShared
  const first = upFirst ? upX : downX
  const second = upFirst ? downX : upX
  if (first >= lo && first <= hi) return first
  if (second >= lo && second <= hi) return second
  return clamp(first, lo, hi)
}

/** Whether `v` is a label, or a bend in a rank that holds more than bends. */
function placedBend(g: Graph, empty: boolean[] | undefined, v: number): boolean {
  return g.kind[v] === Kind.Label || (g.kind[v] === Kind.Dummy && !(empty !== undefined && empty[g.rank[v]]))
}

/**
 * Brings the labels and bends of each edge into line with an end of the edge, so that it runs
 * straight from that end and turns once, at the other: the end with fewer edges beside it, or
 * else the other, as near as the neighbours in their ranks leave room. Bends in ranks that hold
 * nothing else are left to `straighten`. An edge with no one line that fits brings each label
 * and bend into line with the nearest held point above or below.
 */
function alignLabels(
  g: Graph,
  nodes: LNode[],
  xs: number[],
  free: [number[], number[]],
  opt: LayeredOptions,
  empty: boolean[] | undefined,
): void {
  const done: boolean[] = takeBools(g.n, false)
  const chain: number[] = []
  for (let r = 1; r < g.maxRank; r++) {
    for (let i = g.layerStart[r]; i < g.layerStart[r + 1]; i++) {
      const v = g.order[i]
      if (!placedBend(g, empty, v) || done[v]) continue
      // The edge's labels and bends from its first node to its last, and the room they
      // share.
      let top = v
      while (isDummy(g.kind[g.ef[g.predE[g.predStart[top]]]])) top = g.ef[g.predE[g.predStart[top]]]
      let bottom = top
      let lo = Number.NEGATIVE_INFINITY
      let hi = Number.POSITIVE_INFINITY
      // `chain` is reused from edge to edge; its first `chainLen` entries are this edge's.
      let chainLen = 0
      let d = top
      while (isDummy(g.kind[d])) {
        bottom = d
        if (placedBend(g, empty, d)) {
          done[d] = true
          chain[chainLen++] = d
          const least = labelRoom(g, xs, opt, d)
          const most = roomHi
          if (least > lo) lo = least
          if (most < hi) hi = most
        }
        d = g.et[g.succE[g.succStart[d]]]
      }
      if (lo <= hi) {
        const upX = segmentEnd(g, nodes, xs, free, g.predE[g.predStart[top]], 0)
        const upShared = endShared
        const downX = segmentEnd(g, nodes, xs, free, g.succE[g.succStart[bottom]], 1)
        const downShared = endShared
        const x = choose(xs[chain[0]], upX, upShared, downX, downShared, lo, hi)
        for (let c = 0; c < chainLen; c++) xs[chain[c]] = x
        continue
      }
      for (let c = 0; c < chainLen; c++) {
        const d = chain[c]
        const least = labelRoom(g, xs, opt, d)
        const most = roomHi
        if (least > most) continue
        const upX = segmentEnd(g, nodes, xs, free, follow(g, empty, g.predE[g.predStart[d]], 0), 0)
        const upShared = endShared
        const downX = segmentEnd(g, nodes, xs, free, follow(g, empty, g.succE[g.succStart[d]], 1), 1)
        const downShared = endShared
        xs[d] = choose(xs[d], upX, upShared, downX, downShared, least, most)
      }
    }
  }
}

/**
 * Where the end of segment `e` on node `v` should be, from the middle of its side. The edge
 * is followed up (side 0) or down past bends in ranks that hold nothing else, to where it next
 * comes to a held point or another node's side.
 */
function wanted(
  g: Graph,
  nodes: LNode[],
  xs: number[],
  efk: End[],
  etk: End[],
  free: [number[], number[]],
  empty: boolean[] | undefined,
  e: number,
  side: number,
  v: number,
  span: number,
  again: boolean,
): number {
  if (free[side][v] < 2) return 0
  e = follow(g, empty, e, side)
  const u = side === 0 ? g.ef[e] : g.et[e]
  const point = side === 0 ? xs[u] + g.efd[e] : xs[u] + g.etd[e]
  // Once the other end has its place, this one comes into line with it if it can.
  if (again && Math.abs(point - xs[v]) <= span / 2 + IN_LINE) {
    return fmax(-span / 2, fmin(span / 2, point - xs[v]))
  }
  // The part of the other side that its end may move along, if it may move.
  let middle = point
  let width = 0
  const other = side === 0 ? efk : etk
  if (u < g.real && nodes[u].kind === Kind.Node && other[e] !== End.Held && free[1 - side][u] >= 2) {
    width = fmax(fmin(nodes[u].span, g.w[u]), 0)
    if (width > 0) middle = xs[u]
  }
  const lo = fmax(xs[v] - span / 2, middle - width / 2)
  const hi = fmin(xs[v] + span / 2, middle + width / 2)
  // Two sides with no part in line: the end leans towards the other, if its side is long
  // enough.
  if (lo > hi + IN_LINE) {
    const lean = fmax(span / 2 - LEAN_CLEAR, 0)
    return fmax(-lean, fmin(lean, point - xs[v]))
  }
  // Both ends settle on one place in the part the two sides share: nearer the middle of the
  // narrower.
  const place = (xs[v] * width + middle * span) / (width + span)
  return clamp(place, lo, hi) - xs[v]
}

/**
 * Once the nodes have their places, moves an end along its side when that lets its edge run
 * straight. Any other end leans towards the point its edge runs to, and an end with a side to
 * itself stays in the middle. On a group, the ends keep clear of held ends.
 */
function settle(
  g: Graph,
  nodes: LNode[],
  xs: number[],
  efk: End[],
  etk: End[],
  free: [number[], number[]],
  empty: boolean[] | undefined,
): void {
  const ids: number[] = []
  const room: number[] = []
  const all: number[] = []
  const sum: number[] = []
  const counts: number[] = []
  // The ends of an edge follow each other, so the nodes are gone over until none moves.
  let moved = true
  let pass = 0
  while (moved && pass < 6) {
    moved = false
    for (let v = 0; v < g.real; v++) {
      const span = fmin(nodes[v].span, g.w[v])
      if (span <= 0 || nodes[v].kind !== Kind.Node) continue
      for (let side = 0; side < 2; side++) {
        const kinds = side === 0 ? etk : efk
        sideEnds(g, v, side, span, kinds, ids, room)
        // `ids` and `room` hold `sideCount` entries; with two or more, `sideEnds` filled
        // `room` for all of them.
        if (sideCount === 0) continue
        if (sideCount === 1) room[0] = 0
        // Every end on the side in order; the held ones divide the rest into runs.
        let allCount = 0
        {
          const start = side === 0 ? g.predStart : g.succStart
          const list = side === 0 ? g.predE : g.succE
          for (let j = start[v]; j < start[v + 1]; j++) {
            all[allCount] = list[j]
            allCount += 1
          }
          sortByOtherPos(all, 0, allCount, g.pos, side === 0 ? g.ef : g.et)
        }
        const dxs = side === 0 ? g.etd : g.efd
        let k = 0
        let lo = -span / 2
        for (let i = 0; i <= allCount; i++) {
          const held = i < allCount && kinds[all[i]] === End.Held
          if (i < allCount && !held) continue
          // The run of free ends before this point is ids[k..], as many as were passed
          // since the last held end.
          let size = 0
          for (let j = i - 1; j >= 0 && kinds[all[j]] !== End.Held; j--) size += 1
          const hi = held ? dxs[all[i]] - PORT_PITCH : span / 2
          if (size > 0) {
            // The places nearest the wanted ones that keep the order and the room
            // between neighbours: an isotonic fit, pooling neighbours that would
            // otherwise be too close.
            // `sum` and `counts` are a stack of pools, `top` deep.
            let top = 0
            let before = 0
            for (let j = 0; j < size; j++) {
              if (j > 0) before += room[k + j]
              const want = wanted(g, nodes, xs, efk, etk, free, empty, ids[k + j], side, v, span, pass > 0)
              sum[top] = want - before
              counts[top] = 1
              top += 1
              // Ends that share a place for want of room stay together.
              let together = j > 0 && room[k + j] === 0
              while (top >= 2) {
                const s2 = sum[top - 2]
                const s1 = sum[top - 1]
                const c2 = counts[top - 2]
                const c1 = counts[top - 1]
                if (!(together || s2 / c2 > s1 / c1)) break
                together = false
                top -= 1
                sum[top - 1] += s1
                counts[top - 1] += c1
              }
            }
            const total = before
            let j = 0
            before = 0
            for (let b = 0; b < top; b++) {
              // With too little room between two held ends, the run sits in the
              // middle of what there is.
              const level = hi - total < lo ? (lo + hi - total) / 2 : fmax(lo, fmin(hi - total, sum[b] / counts[b]))
              for (let c = 0; c < counts[b]; c++) {
                if (j > 0) before += room[k + j]
                const id = ids[k + j]
                if (Math.abs(dxs[id] - level - before) > 0.01) moved = true
                if (side === 0) g.etd[id] = level + before
                else g.efd[id] = level + before
                j += 1
              }
            }
            k += size
          }
          if (held) lo = dxs[all[i]] + PORT_PITCH
        }
      }
    }
    pass += 1
  }
}

/**
 * Brings edges that are nearly straight into line, by moving a node a little across the flow
 * along with everything already in line with it, where the nodes beside them leave room.
 */
function snap(g: Graph, xs: number[], empty: boolean[] | undefined, opt: LayeredOptions): void {
  // Each edge from one held point to the next, past the bends in ranks that hold nothing
  // else.
  const a: number[] = []
  const b: number[] = []
  const da: number[] = []
  const db: number[] = []
  for (let e = 0; e < g.segments; e++) {
    const u = g.ef[e]
    if (g.kind[u] === Kind.Dummy && empty !== undefined && empty[g.rank[u]]) continue
    const f = follow(g, empty, e, 1)
    a.push(g.ef[e])
    b.push(g.et[f])
    da.push(g.efd[e])
    db.push(g.etd[f])
  }
  // The nodes in line with each other move as one. Each block lists its members from `head`
  // along `next` to `tail`, in the order they joined it.
  const n = g.n
  const blocks: Blocks = {
    block: takeInts(n, 0),
    head: takeInts(n, 0),
    next: takeInts(n, -1),
    size: takeInts(n, 1),
    tail: takeInts(n, 0),
  }
  const block = blocks.block
  for (let i = 0; i < n; i++) {
    block[i] = i
    blocks.head[i] = i
    blocks.tail[i] = i
  }
  const near: number[] = []
  for (let k = 0; k < a.length; k++) {
    const d = Math.abs(xs[b[k]] + db[k] - xs[a[k]] - da[k])
    if (d < 0.01) blocksJoin(blocks, a[k], b[k])
    else if (d <= SNAP) near.push(k)
  }
  if (near.length === 0) return
  sortNear(near, xs, a, b, da, db)
  for (const k of near) {
    const d = xs[b[k]] + db[k] - xs[a[k]] - da[k]
    if (Math.abs(d) < 0.01) {
      blocksJoin(blocks, a[k], b[k])
      continue
    }
    if (Math.abs(d) > SNAP || block[a[k]] === block[b[k]]) continue
    // The smaller of the two blocks moves, if it can; else the other.
    const upper = block[a[k]]
    const lower = block[b[k]]
    const first = blocks.size[upper] <= blocks.size[lower] ? upper : lower
    const second = first === upper ? lower : upper
    for (let pick = 0; pick < 2; pick++) {
      const id = pick === 0 ? first : second
      const shift = id === upper ? d : -d
      if (!blockFree(g, opt, xs, blocks, id, shift)) continue
      for (let v = blocks.head[id]; v >= 0; v = blocks.next[v]) xs[v] += shift
      blocksJoin(blocks, a[k], b[k])
      break
    }
  }
}

/** Sorts the nearly straight edges `near` by how far out of line they are, least first. */
function sortNear(near: number[], xs: number[], a: number[], b: number[], da: number[], db: number[]): void {
  sortAll(
    near,
    (x, y) =>
      cmp(Math.abs(xs[b[x]] + db[x] - xs[a[x]] - da[x]), Math.abs(xs[b[y]] + db[y] - xs[a[y]] - da[y])) || x - y,
  )
}

/** The blocks of nodes that `snap` moves as one. */
type Blocks = {
  /** The block each node is in. */
  block: number[]
  /** Each block's first member, or -1 once it is empty. */
  head: number[]
  /** The member after each node in its block, or -1. */
  next: number[]
  /** Each block's member count. */
  size: number[]
  /** Each block's last member. */
  tail: number[]
}

/** Joins the blocks of `x` and `y`: the smaller one's members move to the end of the other. */
function blocksJoin(blocks: Blocks, x: number, y: number): void {
  const { block, head, next, size, tail } = blocks
  let keep = block[x]
  let drop = block[y]
  if (keep === drop) return
  if (size[keep] < size[drop]) {
    const t = keep
    keep = drop
    drop = t
  }
  for (let v = head[drop]; v >= 0; v = next[v]) block[v] = keep
  if (head[drop] >= 0) {
    if (head[keep] >= 0) next[tail[keep]] = head[drop]
    else head[keep] = head[drop]
    tail[keep] = tail[drop]
  }
  size[keep] += size[drop]
  size[drop] = 0
  head[drop] = -1
}

/** Whether every node of block `id` can move by `shift` and keep its room from those beside it. */
function blockFree(g: Graph, opt: LayeredOptions, xs: number[], blocks: Blocks, id: number, shift: number): boolean {
  const block = blocks.block
  for (let v = blocks.head[id]; v >= 0; v = blocks.next[v]) {
    const s = g.layerStart[g.rank[v]]
    const end = g.layerStart[g.rank[v] + 1]
    const i = s + g.pos[v]
    if (i > s) {
      const left = g.order[i - 1]
      if (block[left] !== id && xs[v] + shift - xs[left] < halfRoom(g, opt, v) + halfRoom(g, opt, left) - 0.01) {
        return false
      }
    }
    if (i + 1 < end) {
      const right = g.order[i + 1]
      if (block[right] !== id && xs[right] - xs[v] - shift < halfRoom(g, opt, v) + halfRoom(g, opt, right) - 0.01) {
        return false
      }
    }
  }
  return true
}

/** Marks the ranks that hold nothing but the bends of edges, if there are any. */
function emptyRanks(g: Graph): boolean[] | undefined {
  const empty: boolean[] = takeBools(g.maxRank + 1, false)
  let any = false
  for (let r = 1; r < g.maxRank; r++) {
    const s = g.layerStart[r]
    const end = g.layerStart[r + 1]
    let all = true
    for (let i = s; i < end; i++) {
      if (g.kind[g.order[i]] !== Kind.Dummy) {
        all = false
        break
      }
    }
    if (end > s && all) {
      empty[r] = true
      any = true
    }
  }
  return any ? empty : undefined
}

/**
 * Where the pieces of one gap begin and end across the flow, worked out once since they are
 * compared pair by pair.
 */
type Bounds = {
  /** Where each piece leaves the rank above. */
  from: number[]
  /** The right end of each piece. */
  hi: number[]
  /** The left end of each piece. */
  lo: number[]
  /** Where each piece reaches the rank below. */
  to: number[]
}

/** 1 when `x` lies across piece `k`, else 0. */
function boundsWithin(bounds: Bounds, x: number, k: number): number {
  return x >= bounds.lo[k] - IN_LINE && x <= bounds.hi[k] + IN_LINE ? 1 : 0
}

/** Whether `a` and `b` leave from or arrive at the same point. */
function boundsMates(bounds: Bounds, a: number, b: number): boolean {
  return Math.abs(bounds.from[a] - bounds.from[b]) < IN_LINE || Math.abs(bounds.to[a] - bounds.to[b]) < IN_LINE
}

/** Whether `a` and `b` overlap across the flow. */
function boundsOverlap(bounds: Bounds, a: number, b: number): boolean {
  return bounds.lo[a] < bounds.hi[b] - IN_LINE && bounds.lo[b] < bounds.hi[a] - IN_LINE
}

/** Whether `a` and `b` need tracks of their own. */
function boundsClash(bounds: Bounds, a: number, b: number): boolean {
  return boundsOverlap(bounds, a, b) && !boundsMates(bounds, a, b)
}

/** Whether one of `a` and `b` could cross the other, depending on which is above. */
function boundsMeet(bounds: Bounds, a: number, b: number): boolean {
  return (
    boundsOverlap(bounds, a, b) ||
    boundsWithin(bounds, bounds.to[a], b) +
      boundsWithin(bounds, bounds.from[b], a) +
      boundsWithin(bounds, bounds.to[b], a) +
      boundsWithin(bounds, bounds.from[a], b) >
      0
  )
}

/** How often `a` and `b` cross with `a` on the higher track. */
function boundsCrossings(bounds: Bounds, a: number, b: number): number {
  return boundsWithin(bounds, bounds.to[a], b) + boundsWithin(bounds, bounds.from[b], a)
}

/** Points along piece `k` as a plain curve across a gap of height `h`, into `out`. */
function boundsSample(bounds: Bounds, k: number, h: number, out: number[]): void {
  const c = ease(bounds.to[k] - bounds.from[k], h)
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const u = 1.0 - t
    out[2 * i] = bounds.from[k] + (bounds.to[k] - bounds.from[k]) * t * t * (3.0 - 2.0 * t)
    out[2 * i + 1] = h * (3.0 * c * t * u * u + 3.0 * (1.0 - c) * t * t * u + t * t * t)
  }
}

/**
 * Whether some point of one sampled curve comes nearer than `limit` to the polyline of another:
 * whether the least distance between them, as Pele measures it, is less than `limit`.
 */
function reachBelow(points: number[], line: number[], limit: number): boolean {
  // Each segment of the polyline, worked out once for all the points.
  const seg = reachSegments
  for (let j = 0; j < SAMPLES; j++) {
    const dx = line[2 * j + 2] - line[2 * j]
    const dy = line[2 * j + 3] - line[2 * j + 1]
    let den = dx * dx + dy * dy
    if (den === 0 || den !== den) den = 1.0
    seg[3 * j] = dx
    seg[3 * j + 1] = dy
    seg[3 * j + 2] = den
  }
  for (let i = 0; i <= SAMPLES; i++) {
    const px = points[2 * i]
    const py = points[2 * i + 1]
    for (let j = 0; j < SAMPLES; j++) {
      const dx = seg[3 * j]
      const dy = seg[3 * j + 1]
      const den = seg[3 * j + 2]
      // `clamp(.., 0, 1)` inlined: NaN goes to 1, as `fmin` ignores it.
      let t = ((px - line[2 * j]) * dx + (py - line[2 * j + 1]) * dy) / den
      if (t !== t || 1.0 < t) t = 1.0
      if (0.0 > t) t = 0.0
      const ex = px - line[2 * j] - t * dx
      const ey = py - line[2 * j + 1] - t * dy
      // `hypot` is never less than the larger of its two values, so a point that far off
      // cannot come nearer. NaN and infinite distances never come nearer either.
      const ax = Math.abs(ex)
      const ay = Math.abs(ey)
      if ((ax > ay ? ax : ay) >= limit) continue
      if (hypot(ex, ey) < limit) return true
    }
  }
  return false
}

/** Per segment of the polyline `reachBelow` measures to: its run across, along, and squared length. */
const reachSegments = new Float64Array(3 * SAMPLES)

/** Sorts the pieces in `list` by how far across they reach, furthest first, then from the left. */
function sortReach(list: number[], lo: number[], hi: number[]): void {
  sortAll(list, (a, b) => cmp(hi[b] - lo[b], hi[a] - lo[a]) || cmp(lo[a], lo[b]) || a - b)
}

/** The root of `i` among the disjoint sets in `group`, halving the path on the way. */
function find(group: number[], i: number): number {
  while (group[i] !== i) {
    group[i] = group[group[i]]
    i = group[i]
  }
  return i
}

/**
 * Gives the pieces of one gap in `list` their tracks, and each the number of tracks that the
 * pieces it has to do with take between them, counting its own from the first of those when
 * `curved`. Returns the number of tracks. The pieces come without tracks.
 */
function lay(bounds: Bounds, track: number[], levels: number[], list: number[], curved: boolean): number {
  const lo = bounds.lo
  const hi = bounds.hi
  // A plain order to start from: the pieces that reach furthest go first, so that those of one
  // fan nest.
  sortReach(list, lo, hi)
  const count = list.length
  let above: number[][] = []
  const group: number[] = []
  for (let i = 0; i < count; i++) group.push(i)
  const sequence: number[] = []
  if (count > MAX_WEIGHED) {
    for (let i = 0; i < count; i++) sequence.push(i)
  } else {
    // above[j] lists the pieces that should be above list[j]. A piece is placed once all
    // that should be above it are, and when none is free, the one with the fewest waiting.
    const waiting: number[] = takeInts(count, 0)
    const after: number[][] = []
    for (let i = 0; i < count; i++) after.push([])
    above = []
    for (let i = 0; i < count; i++) above.push([])
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = list[i]
        const b = list[j]
        if (!boundsMeet(bounds, a, b)) continue
        const root = find(group, i)
        group[root] = find(group, j)
        const ab = boundsCrossings(bounds, a, b)
        const ba = boundsCrossings(bounds, b, a)
        if (ab === ba) continue
        const first = ab < ba ? i : j
        const second = ab < ba ? j : i
        above[second].push(first)
        after[first].push(second)
        waiting[second] += 1
      }
    }
    const placed: boolean[] = takeBools(count, false)
    for (let n = 0; n < count; n++) {
      let pick: number | undefined
      for (let i = 0; i < count; i++) {
        if (placed[i]) continue
        if (pick === undefined || waiting[i] < waiting[pick]) pick = i
        if (waiting[i] === 0) break
      }
      if (pick === undefined) break
      placed[pick] = true
      sequence.push(pick)
      for (const j of after[pick]) waiting[j] -= 1
    }
  }
  // Each piece takes the first track below those it should be under that has room for it.
  // `sequence` holds places in `list`.
  const rows: number[][] = []
  for (const i of sequence) {
    const k = list[i]
    let t = 0
    const over = above[i]
    if (over !== undefined) {
      for (const o of over) {
        if (track[list[o]] >= t) t = track[list[o]] + 1
      }
    }
    for (;;) {
      const slot = t < 0 ? 0 : t
      while (rows.length <= slot) rows.push([])
      const row = rows[slot]
      let clear = true
      for (let o = 0; o < row.length; o++) {
        if (boundsClash(bounds, k, row[o])) {
          clear = false
          break
        }
      }
      if (clear) {
        row.push(k)
        break
      }
      t += 1
    }
    track[k] = t
  }
  const first: number[] = takeFloats(count, Number.MAX_SAFE_INTEGER)
  const last: number[] = takeFloats(count, Number.MIN_SAFE_INTEGER)
  for (let i = 0; i < count; i++) {
    const k = list[i]
    const root = find(group, i)
    first[root] = Math.min(first[root], track[k])
    last[root] = Math.max(last[root], track[k])
  }
  for (let i = 0; i < count; i++) {
    const k = list[i]
    const root = find(group, i)
    const value = last[root] - first[root] + 1
    levels[k] = value < 0 ? 0 : value
    if (curved) track[k] -= first[root]
  }
  return rows.length
}

/** Sampled curves for `nearest`. */
const lineA: number[] = numbers(2 * SAMPLES + 2, 0)
const lineB: number[] = numbers(2 * SAMPLES + 2, 0)

/**
 * Whether pieces `a` and `b`, as plain curves across a gap that leaves them `height` to turn
 * in, come nearer than `limit`: whether the least distance from either one's points to the
 * other's polyline is less than `limit`.
 */
function nearer(bounds: Bounds, a: number, b: number, height: number, limit: number): boolean {
  const h = fmax(height / 2, height - 2 * LEVEL_LEAD)
  boundsSample(bounds, a, h, lineA)
  boundsSample(bounds, b, h, lineB)
  return reachBelow(lineA, lineB, limit) || reachBelow(lineB, lineA, limit)
}

/**
 * Gives every piece that does not run straight down a track across its gap, and counts the
 * tracks of each gap. Two pieces share a track only where they cannot be mistaken for each
 * other, and which goes above the other is whichever makes them cross less. With `curved`, the
 * tracks are levels for curves to turn onto, given only to pieces that would run along or too
 * near another. `room` is the height of the gap under each rank, and `tall` receives the
 * height that a gap whose curves mostly cross should have instead of levels.
 */
function assignTracks(
  pieces: Pieces,
  trackCount: number[],
  rankCount: number,
  curved: boolean,
  room: number[],
  tall: number[],
): void {
  const { from, levels, rank, to, track, wide } = pieces
  const total = from.length
  // Pieces by rank, ranks in order of their first piece.
  const slot: (number | undefined)[] = takeNones(rankCount)
  const byRank: [number, number[]][] = []
  for (let k = 0; k < total; k++) {
    track.push(-1)
    levels.push(0)
    if (Math.abs(from[k] - to[k]) < IN_LINE) continue
    const r = rank[k]
    const s = slot[r]
    if (s !== undefined) {
      byRank[s][1].push(k)
    } else {
      slot[r] = byRank.length
      byRank.push([r, [k]])
    }
  }
  const hi: number[] = []
  const lo: number[] = []
  for (let k = 0; k < total; k++) {
    hi.push(fmax(from[k], to[k]))
    lo.push(fmin(from[k], to[k]))
  }
  const bounds: Bounds = { from, hi, lo, to }
  const inLevel: boolean[] = takeBools(total, false)
  const turning: number[] = []

  for (const [r, all] of byRank) {
    if (!curved) {
      trackCount[r] = lay(bounds, track, levels, all, curved)
      continue
    }
    if (all.length > MAX_WEIGHED) continue
    // The pieces that turn onto levels: first those that run far across and have another
    // such piece to be told apart from, then any two that would pass too near each other.
    const far: number[] = []
    for (const k of all) if (wide[k]) far.push(k)
    lay(bounds, track, levels, far, curved)
    // `turning` is reused from rank to rank; its first `turns` entries are this rank's.
    let turns = 0
    for (const k of far) {
      if (levels[k] > 1) {
        inLevel[k] = true
        turning[turns++] = k
      }
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        if ((inLevel[a] && inLevel[b]) || !boundsClash(bounds, a, b) || (from[a] < to[a]) !== (from[b] < to[b])) {
          continue
        }
        const limit = wide[a] || wide[b] ? LEVEL_CLEAR : LEVEL_TOUCH
        if (nearer(bounds, a, b, room[r], limit)) {
          if (!inLevel[a]) {
            inLevel[a] = true
            turning[turns++] = a
          }
          if (!inLevel[b]) {
            inLevel[b] = true
            turning[turns++] = b
          }
        }
      }
    }
    for (const k of far) {
      track[k] = -1
      levels[k] = 0
    }
    if (turns === 0) continue
    let crossing = 0
    let alongside = 0
    for (let i = 0; i < turns; i++) {
      for (let j = i + 1; j < turns; j++) {
        const a = turning[i]
        const b = turning[j]
        if (!boundsOverlap(bounds, a, b)) continue
        if ((from[a] < to[a]) !== (from[b] < to[b])) crossing += 1
        else if (!boundsMates(bounds, a, b)) alongside += 1
      }
    }
    if (crossing > alongside) {
      for (const k of all) {
        const height = (bounds.hi[k] - bounds.lo[k]) * CROSSED_SLOPE
        if (height > tall[r]) tall[r] = height
      }
    } else {
      // With them go the short pieces that could cross one of them, so that each has its
      // place among the levels and crosses none.
      const members: number[] = []
      for (const k of all) {
        let take = inLevel[k]
        if (!take && !wide[k]) {
          for (let t = 0; t < turns; t++) {
            if (boundsMeet(bounds, k, turning[t])) {
              take = true
              break
            }
          }
        }
        if (take) members.push(k)
      }
      lay(bounds, track, levels, members, curved)
      let most = 0
      for (const k of members) if (levels[k] > most) most = levels[k]
      trackCount[r] = most
    }
    for (let t = 0; t < turns; t++) inLevel[turning[t]] = false
  }
}

/**
 * Moves the bends in ranks that hold only bends onto the straight line between the nearest
 * held points of their edges, and marks the ones that can be left out of the route. `sep` is
 * the room kept between the bends of twin edges, or 0 to leave those out as well.
 */
function straighten(
  g: Graph,
  xs: number[],
  empty: boolean[],
  firstDummy: (number | undefined)[],
  m: number,
  span: number[],
  sep: number,
  onLine: boolean[],
): void {
  const want: number[] = takeFloats(g.n, 0)
  // The points that each bend's edge runs between, across the ranks that hold only bends.
  const from: number[] = takeFloats(g.n, 0)
  const to: number[] = takeFloats(g.n, 0)
  for (let ei = 0; ei < m; ei++) {
    const d0 = firstDummy[ei]
    if (d0 === undefined) continue
    const end = d0 + span[ei] - 1
    // A bend's rank is its place in the run, counted from the rank after the edge's first
    // node.
    const base = g.rank[d0]
    let d = d0
    while (d < end) {
      if (!empty[base + d - d0]) {
        d += 1
        continue
      }
      let last = d
      while (last + 1 < end && empty[base + last + 1 - d0]) last += 1
      const above = g.predE[g.predStart[d]]
      const below = g.succE[g.succStart[last]]
      const x0 = xs[g.ef[above]] + g.efd[above]
      const x1 = xs[g.et[below]] + g.etd[below]
      const steps = last - d + 2
      for (let k = d; k <= last; k++) {
        want[k] = x0 + ((x1 - x0) * (k - d + 1)) / steps
        from[k] = x0
        to[k] = x1
      }
      d = last + 1
    }
  }

  // Nothing in such a rank is in a bend's way, so each one goes onto its line and out of the
  // route. Only twins stay, a little apart around the line.
  const pos = g.pos
  for (let r = 1; r < g.maxRank; r++) {
    if (!empty[r]) continue
    // A fresh row each rank, sized to it, as the sort works on the whole array.
    const row: number[] = []
    for (let i = g.layerStart[r]; i < g.layerStart[r + 1]; i++) row.push(g.order[i])
    sortEnds(row, from, to)
    let i = 0
    while (i < row.length) {
      let j = i
      while (j < row.length && Math.abs(from[row[j]] - from[row[i]]) < 1.0 && Math.abs(to[row[j]] - to[row[i]]) < 1.0) {
        j += 1
      }
      // The twins, row[i..j], keep the order the rank gave them, so two edges do not swap
      // sides.
      const count = j - i
      if (count > 1) sortByPos(row, i, j, pos)
      const middle = (count - 1) / 2
      for (let k = 0; k < count; k++) {
        const d = row[i + k]
        xs[d] = want[d] + (k - middle) * sep
        if (count === 1 || sep === 0) onLine[d] = true
      }
      i = j
    }
  }
}

/** Sorts the bends in `row` by the points their edges run between. */
function sortEnds(row: number[], from: number[], to: number[]): void {
  sortAll(row, (a, b) => cmp(from[a], from[b]) || cmp(to[a], to[b]) || a - b)
}

/** Sorts `list[start..end]` by place in rank. */
function sortByPos(list: number[], start: number, end: number, pos: number[]): void {
  sortSlice(list, start, end, (a, b) => pos[a] - pos[b])
}

/**
 * In a rank that holds labels and bends but no nodes, leaves out each bend whose edge would
 * pass clear of every label anyway, so that the edge turns in the whole height between the
 * ranks on either side.
 */
function pastLabels(
  g: Graph,
  xs: number[],
  firstDummy: (number | undefined)[],
  m: number,
  span: number[],
  clear: number,
  onLine: boolean[],
): void {
  const labelled: boolean[] = takeBools(g.maxRank + 1, false)
  let any = false
  for (let r = 1; r < g.maxRank; r++) {
    let labels = false
    let others = false
    for (let i = g.layerStart[r]; i < g.layerStart[r + 1]; i++) {
      const v = g.order[i]
      if (g.kind[v] === Kind.Label) labels = true
      else if (g.kind[v] !== Kind.Dummy) others = true
    }
    if (labels && !others) {
      labelled[r] = true
      any = true
    }
  }
  if (!any) return
  for (let ei = 0; ei < m; ei++) {
    const d0 = firstDummy[ei]
    if (d0 === undefined) continue
    const end = d0 + span[ei] - 1
    for (let d = d0; d < end; d++) {
      if (g.kind[d] !== Kind.Dummy || !labelled[g.rank[d]]) continue
      // The points on either side that the edge is held at, past bends already left out.
      let first = d
      let last = d
      while (first > d0 && onLine[first - 1]) first -= 1
      while (last + 1 < end && onLine[last + 1]) last += 1
      const above = g.predE[g.predStart[first]]
      const below = g.succE[g.succStart[last]]
      const from = xs[g.ef[above]] + g.efd[above]
      const to = xs[g.et[below]] + g.etd[below]
      const lo = fmin(from, to) - clear
      const hi = fmax(from, to) + clear
      const r = g.rank[d]
      let free = true
      for (let i = g.layerStart[r]; i < g.layerStart[r + 1]; i++) {
        const label = g.order[i]
        if (!(g.kind[label] !== Kind.Label || xs[label] + g.w[label] / 2 <= lo || xs[label] - g.w[label] / 2 >= hi)) {
          free = false
          break
        }
      }
      if (!free) continue
      onLine[d] = true
      // The bends left out between the two points lie on the line between them.
      const steps = last - first + 2
      for (let k = first; k <= last; k++) xs[k] = from + ((to - from) * (k - first + 1)) / steps
    }
  }
}

/** Reusable buffers for counting crossings. */
type Counter = {
  /** Segments of one node, for sorting. */
  ids: number[]
  /** With offsets, each segment's place along its head's side. */
  place: number[] | undefined
  /** Each segment's head place, rank by rank. */
  targets: number[]
  /** Accumulation tree. */
  tree: number[]
}

/** Sorts `ids[..count]` by offset. */
function sortByDx(ids: number[], count: number, dx: number[]): void {
  sortSlice(ids, 0, count, (a, b) => cmp(dx[a], dx[b]))
}

/** Sorts `ids[..count]` by offset, then by place. */
function sortByDxPlace(ids: number[], count: number, dx: number[], place: number[]): void {
  sortSlice(ids, 0, count, (a, b) => cmp(dx[a], dx[b]) || place[a] - place[b])
}

/** Counts the crossings between every two neighbouring ranks. */
function countCrossings(g: Graph, c: Counter): number {
  const { ids, place, targets, tree } = c
  const ls = g.layerStart
  let total = 0
  for (let r = 0; r < g.maxRank; r++) {
    let southLen = ls[r + 2] - ls[r + 1]
    if (place !== undefined) {
      let places = 0
      for (let i = ls[r + 1]; i < ls[r + 2]; i++) {
        const v = g.order[i]
        const from = g.predStart[v]
        const to = g.predStart[v + 1]
        let mixed = false
        for (let k = from + 1; k < to; k++) {
          if (g.etd[g.predE[k]] !== g.etd[g.predE[from]]) {
            mixed = true
            break
          }
        }
        if (mixed) {
          // `ids` is reused; its first `to - from` entries are this node's.
          const count = to - from
          for (let k = 0; k < count; k++) ids[k] = g.predE[from + k]
          sortByDx(ids, count, g.etd)
          for (let k = 0; k < count; k++) {
            if (k > 0 && g.etd[ids[k]] !== g.etd[ids[k - 1]]) places += 1
            place[ids[k]] = places
          }
        } else {
          for (let k = from; k < to; k++) place[g.predE[k]] = places
        }
        places += 1
      }
      southLen = places
    }
    if (southLen < 2) continue
    let t = 0
    for (let i = ls[r]; i < ls[r + 1]; i++) {
      const v = g.order[i]
      const from = g.succStart[v]
      const to = g.succStart[v + 1]
      const t0 = t
      for (let k = from; k < to; k++) {
        const e = g.succE[k]
        targets[t] = place === undefined ? g.pos[g.et[e]] : place[e]
        t += 1
      }
      if (t - t0 < 2) continue
      let mixed = false
      if (place !== undefined) {
        for (let k = from + 1; k < to; k++) {
          if (g.efd[g.succE[k]] !== g.efd[g.succE[from]]) {
            mixed = true
            break
          }
        }
      }
      if (place !== undefined && mixed) {
        const count = to - from
        for (let k = 0; k < count; k++) ids[k] = g.succE[from + k]
        sortByDxPlace(ids, count, g.efd, place)
        for (let k = 0; k < count; k++) targets[t0 + k] = place[ids[k]]
      } else {
        sortInts(targets, t0, t)
      }
    }
    if (t < 2) continue
    const leaves = nextPowerOfTwo(southLen)
    for (let i = 0; i < 2 * leaves; i++) tree[i] = 0
    for (let j = 0; j < t; j++) {
      let i = targets[j] + leaves
      tree[i] += 1
      while (i > 1) {
        if ((i & 1) === 0) total += tree[i + 1]
        i >>= 1
        tree[i] += 1
      }
    }
  }
  return total
}

/** One barycenter sweep down (from the ranks above) or up, ties broken left or right. */
function sweep(g: Graph, nodes: LNode[], bary: number[], moving: number[], down: boolean, biasRight: boolean): void {
  for (let step = 1; step <= g.maxRank; step++) {
    const r = down ? step : g.maxRank - step
    const s = g.layerStart[r]
    const e = g.layerStart[r + 1]
    let movable = 0
    const start = down ? g.predStart : g.succStart
    const list = down ? g.predE : g.succE
    const other = down ? g.ef : g.et
    const otherDx = down ? g.efd : g.etd
    for (let i = s; i < e; i++) {
      const v = g.order[i]
      const pin = v < g.real ? nodes[v].pin : 0
      if (pin !== 0) {
        bary[v] = pin * 1e9
        moving[movable] = v
        movable += 1
        continue
      }
      const from = start[v]
      const to = start[v + 1]
      if (from === to) {
        bary[v] = -1.0
        continue
      }
      let sum = 0
      for (let j = from; j < to; j++) {
        const k = list[j]
        const u = other[k]
        sum += g.pos[u]
        if (g.offsets && g.w[u] > 0) sum += otherDx[k] / g.w[u]
      }
      bary[v] = sum / (to - from)
      moving[movable] = v
      movable += 1
    }
    if (movable < 2) continue
    sortByBary(moving, movable, bary, g.pos, biasRight)
    let k = 0
    for (let i = s; i < e; i++) {
      if (bary[g.order[i]] !== -1.0) {
        g.order[i] = moving[k]
        k += 1
      }
    }
    for (let i = s; i < e; i++) g.pos[g.order[i]] = i - s
  }
}

/** Orders two nodes by barycenter, ties by their place, left or right first. */
function baryCompare(a: number, b: number, bary: number[], pos: number[], biasRight: boolean): number {
  const tie = biasRight ? pos[b] - pos[a] : pos[a] - pos[b]
  return cmp(bary[a], bary[b]) || tie
}

/** `sortByBary` through `sortSlice`, for long ranges. */
function sortByBaryLong(moving: number[], count: number, bary: number[], pos: number[], biasRight: boolean): void {
  sortSlice(moving, 0, count, (a, b) => baryCompare(a, b, bary, pos, biasRight))
}

/** `sortSlice(moving, 0, count, baryCompare)`, with the comparator called directly. */
function sortByBary(moving: number[], count: number, bary: number[], pos: number[], biasRight: boolean): void {
  if (count < 2) return
  if (count >= SMALL_SORT) {
    sortByBaryLong(moving, count, bary, pos, biasRight)
    return
  }
  let run = 2
  let prev = moving[1]
  const descending = baryCompare(prev, moving[0], bary, pos, biasRight) < 0
  for (let i = 2; i < count; i++) {
    const current = moving[i]
    const order = baryCompare(current, prev, bary, pos, biasRight)
    if (descending ? order >= 0 : order < 0) break
    prev = current
    run += 1
  }
  if (descending) {
    let lo = 0
    let hi = run - 1
    while (lo < hi) {
      const t = moving[lo]
      moving[lo] = moving[hi]
      moving[hi] = t
      lo += 1
      hi -= 1
    }
  }
  for (let start = run; start < count; start++) {
    const pivot = moving[start]
    let left = 0
    let right = start
    while (left < right) {
      const mid = left + ((right - left) >> 1)
      if (baryCompare(pivot, moving[mid], bary, pos, biasRight) < 0) right = mid
      else left = mid + 1
    }
    for (let p = start; p > left; p--) moving[p] = moving[p - 1]
    moving[left] = pivot
  }
}

/** How many pairs of nodes in one rank are not in the order they were given. */
function outOfOrder(g: Graph): number {
  let total = 0
  for (let r = 0; r <= g.maxRank; r++) {
    const end = g.layerStart[r + 1]
    for (let i = g.layerStart[r]; i < end; i++) {
      if (g.order[i] >= g.real) continue
      for (let j = i + 1; j < end; j++) if (g.order[j] < g.order[i]) total += 1
    }
  }
  return total
}

/**
 * Orders each rank to reduce crossings by barycenter sweeps, keeping the best order found.
 * Small graphs try two sweep orders and a mirror image, keeping the one closest to the order
 * the nodes were given among those with the fewest crossings.
 */
function reduceCrossings(g: Graph, nodes: LNode[]): void {
  const segments = g.segments
  let widest = 0
  for (let r = 0; r <= g.maxRank; r++) widest = Math.max(widest, g.layerStart[r + 1] - g.layerStart[r])
  // With offsets, edges that reach one node at different offsets take separate places.
  const place = g.offsets ? takeInts(segments, 0) : undefined
  const size = nextPowerOfTwo(place !== undefined ? widest + segments : widest)
  const counter: Counter = {
    ids: [],
    place,
    targets: takeInts(segments, 0),
    tree: takeInts(2 * size, 0),
  }

  let best = countCrossings(g, counter)
  if (best === 0) return
  const bestOrder = g.order.slice(0, g.n)
  const bary: number[] = takeFloats(g.n, 0)
  const moving: number[] = takeInts(widest, 0)

  // The sweeps run twice from the same start, going down first and going up first. When both
  // cross as little, the one that keeps more nodes in their given order wins.
  const initial = g.order.slice(0, g.n)
  const start = best
  const small = g.n <= 600
  let chosen = bestOrder.slice()
  let chosenOut = Number.MAX_SAFE_INTEGER
  for (let attempt = 0; attempt < (small ? 2 : 1); attempt++) {
    if (attempt > 0) {
      copyFrom(g.order, initial, g.n)
      graphSetPositions(g)
    }
    let found = start
    const foundOrder = initial.slice()
    let stale = 0
    let i = 0
    while (stale < 4 && i < MAX_SWEEPS) {
      sweep(g, nodes, bary, moving, (i + attempt) % 2 === 0, i % 4 >= 2)
      const c = countCrossings(g, counter)
      if (c < found) {
        found = c
        copyFrom(foundOrder, g.order, g.n)
        stale = 0
        if (c === 0) break
      }
      i += 1
      stale += 1
    }
    copyFrom(g.order, foundOrder, g.n)
    const out = small ? outOfOrder(g) : 0
    if (attempt === 0 || found < best || (found === best && out < chosenOut)) {
      best = found
      chosen = foundOrder
      chosenOut = out
    }
  }
  copyFrom(g.order, chosen, g.n)
  graphSetPositions(g)
  copyFrom(bestOrder, chosen, g.n)

  // A drawing and its mirror image cross as often too. Of those two, likewise.
  if (!small || nodes.some((v) => v.pin !== 0) || chosenOut === 0) return
  for (let r = 0; r <= g.maxRank; r++) {
    let lo = g.layerStart[r]
    let hi = g.layerStart[r + 1] - 1
    while (lo < hi) {
      const t = g.order[lo]
      g.order[lo] = g.order[hi]
      g.order[hi] = t
      lo += 1
      hi -= 1
    }
  }
  graphSetPositions(g)
  if (countCrossings(g, counter) > best || outOfOrder(g) >= chosenOut) copyFrom(g.order, bestOrder, g.n)
}

/** Half the room a node, bend, or port takes across the flow, with its share of the gap beside it. */
function halfRoom(g: Graph, opt: LayeredOptions, v: number): number {
  const sep = g.kind[v] === Kind.Node ? opt.nodeSep : opt.edgeSep
  return g.w[v] / 2 + sep / 2
}

/** Scratch space for `position`, grown as needed and reused from call to call. */
let scratchNodes = 0
let scratchSegments = 0
let sGap = new Float64Array(0)
let sRoot = new Int32Array(0)
let sAlign = new Int32Array(0)
let sShift = new Float64Array(0)
let sEFrom = new Int32Array(0)
let sETo = new Int32Array(0)
let sEW = new Float64Array(0)
let sIndeg = new Int32Array(0)
let sOutStart = new Int32Array(0)
let sOutE = new Int32Array(0)
let sFill = new Int32Array(0)
let sTopo = new Int32Array(0)
let sX = new Float64Array(0)
let sResults = new Float64Array(0)
let sKey = new Int32Array(0)
let sConflict = new Uint8Array(0)

/** Makes the scratch space of `position` hold `n` nodes and `segments` segments. */
function reserve(n: number, segments: number): void {
  if (n > scratchNodes) {
    const size = nextPowerOfTwo(Math.max(n, 64))
    scratchNodes = size
    sGap = new Float64Array(size)
    sRoot = new Int32Array(size)
    sAlign = new Int32Array(size)
    sShift = new Float64Array(size)
    sEFrom = new Int32Array(size)
    sETo = new Int32Array(size)
    sEW = new Float64Array(size)
    sIndeg = new Int32Array(size)
    sOutStart = new Int32Array(size + 1)
    sOutE = new Int32Array(size)
    sFill = new Int32Array(size)
    sTopo = new Int32Array(size)
    sX = new Float64Array(size)
    sResults = new Float64Array(4 * size)
  }
  if (segments > scratchSegments) {
    const size = nextPowerOfTwo(Math.max(segments, 64))
    scratchSegments = size
    sKey = new Int32Array(size)
    sConflict = new Uint8Array(size)
  }
}

/**
 * Brandes-Köpf horizontal coordinate assignment: four aligned layouts, balanced. Sorts each
 * node's segments by the place of their other ends, which later passes rely on.
 */
function position(g: Graph, opt: LayeredOptions): number[] {
  const n = g.n
  const maxRank = g.maxRank
  const segments = g.segments
  reserve(n, segments)
  const order = g.order
  const pos = g.pos
  const layerStart = g.layerStart
  const kind = g.kind
  const gap = sGap
  for (let i = 0; i < n; i++) gap[i] = halfRoom(g, opt, i)

  // Neighbours in left-to-right order, so the medians can be read off directly.
  const key = sKey
  for (let e = 0; e < segments; e++) key[e] = pos[g.et[e]]
  for (let v = 0; v < n; v++) {
    if (g.succStart[v + 1] - g.succStart[v] > 1) sortRange(g.succE, g.succStart[v], g.succStart[v + 1], key)
  }
  for (let e = 0; e < segments; e++) key[e] = pos[g.ef[e]]
  for (let v = 0; v < n; v++) {
    if (g.predStart[v + 1] - g.predStart[v] > 1) sortRange(g.predE, g.predStart[v], g.predStart[v + 1], key)
  }

  // An edge between two real nodes may not cross a dummy-to-dummy segment; mark those that
  // would.
  const conflict = sConflict
  for (let e = 0; e < segments; e++) conflict[e] = 0
  for (let r = 1; r <= maxRank; r++) {
    const prevLen = layerStart[r] - layerStart[r - 1]
    const s = layerStart[r]
    const end = layerStart[r + 1]
    let k0 = 0
    let scan = s
    for (let i = s; i < end; i++) {
      const v = order[i]
      let inner = -1
      if (isDummy(kind[v])) {
        const u = g.ef[g.predE[g.predStart[v]]]
        if (isDummy(kind[u])) inner = u
      }
      const k1 = inner < 0 ? prevLen : pos[inner]
      if (inner >= 0 || i === end - 1) {
        for (let o = scan; o <= i; o++) {
          const w = order[o]
          const wDummy = isDummy(kind[w])
          for (let j = g.predStart[w]; j < g.predStart[w + 1]; j++) {
            const e = g.predE[j]
            const up = pos[g.ef[e]]
            if ((up < k0 || k1 < up) && !(wDummy && isDummy(kind[g.ef[e]]))) conflict[e] = 1
          }
        }
        scan = i + 1
        k0 = k1
      }
    }
  }

  const results = sResults
  const root = sRoot
  const align = sAlign
  // Offset of each node from its block's root, so that aligned edges meet at their
  // attachment points.
  const shift = sShift
  const eFrom = sEFrom
  const eTo = sETo
  const eW = sEW
  const indeg = sIndeg
  const outStart = sOutStart
  const outE = sOutE
  const fill = sFill
  const topo = sTopo
  const x = sX

  for (let variant = 0; variant < 4; variant++) {
    const up = variant < 2
    const right = (variant & 1) === 1
    const start = up ? g.predStart : g.succStart
    const list = up ? g.predE : g.succE
    const other = up ? g.ef : g.et
    const ownDx = up ? g.etd : g.efd
    const otherDx = up ? g.efd : g.etd
    for (let i = 0; i < n; i++) {
      root[i] = i
      align[i] = i
      shift[i] = 0
    }

    for (let step = 0; step <= maxRank; step++) {
      const r = up ? step : maxRank - step
      const s = layerStart[r]
      const end = layerStart[r + 1]
      let adjacent = -1
      if (up) adjacent = r > 0 ? r - 1 : -1
      else adjacent = r + 1 <= maxRank ? r + 1 : -1
      const adjacentLast = adjacent < 0 ? 0 : layerStart[adjacent + 1] - layerStart[adjacent] - 1
      let prevIdx = -1
      for (let o = 0; o < end - s; o++) {
        const i = right ? end - 1 - o : s + o
        const v = order[i]
        const from = start[v]
        const d = start[v + 1] - from
        if (d === 0) continue
        const lo = from + ((d - 1) >> 1)
        const hi = from + (d >> 1)
        for (let pass = 0; pass < 2; pass++) {
          if (pass === 1 && lo === hi) break
          const e = list[(pass === 0) === right ? hi : lo]
          const w = other[e]
          const idx = right ? adjacentLast - pos[w] : pos[w]
          if (align[v] === v && prevIdx < idx && conflict[e] === 0) {
            align[w] = v
            root[v] = root[w]
            align[v] = root[v]
            shift[v] = shift[w] + otherDx[e] - ownDx[e]
            prevIdx = idx
          }
        }
      }
    }

    let blockEdges = 0
    for (let i = 0; i < n; i++) indeg[i] = 0
    for (let i = 0; i <= n; i++) outStart[i] = 0
    for (let r = 0; r <= maxRank; r++) {
      const s = layerStart[r]
      const end = layerStart[r + 1]
      for (let i = s + 1; i < end; i++) {
        const a = right ? order[i] : order[i - 1]
        const b = right ? order[i - 1] : order[i]
        const sep = gap[a] + gap[b]
        eFrom[blockEdges] = root[a]
        eTo[blockEdges] = root[b]
        eW[blockEdges] = right ? sep - shift[a] + shift[b] : sep + shift[a] - shift[b]
        indeg[root[b]] += 1
        outStart[root[a] + 1] += 1
        blockEdges += 1
      }
    }
    for (let i = 0; i < n; i++) outStart[i + 1] += outStart[i]
    for (let i = 0; i < n; i++) fill[i] = outStart[i]
    for (let e = 0; e < blockEdges; e++) {
      outE[fill[eFrom[e]]] = e
      fill[eFrom[e]] += 1
    }

    for (let i = 0; i < n; i++) x[i] = 0
    let count = 0
    for (let i = 0; i < n; i++) {
      if (root[i] === i && indeg[i] === 0) {
        topo[count] = i
        count += 1
      }
    }
    let q = 0
    while (q < count) {
      const v = topo[q]
      q += 1
      for (let j = outStart[v]; j < outStart[v + 1]; j++) {
        const e = outE[j]
        const w = eTo[e]
        if (x[v] + eW[e] > x[w]) x[w] = x[v] + eW[e]
        indeg[w] -= 1
        if (indeg[w] === 0) {
          topo[count] = w
          count += 1
        }
      }
    }
    for (let t = count - 1; t >= 0; t--) {
      const v = topo[t]
      let min = Number.POSITIVE_INFINITY
      for (let j = outStart[v]; j < outStart[v + 1]; j++) {
        const e = outE[j]
        const cand = x[eTo[e]] - eW[e]
        if (cand < min) min = cand
      }
      if (min !== Number.POSITIVE_INFINITY && min > x[v]) x[v] = min
    }
    const base = variant * n
    for (let i = 0; i < n; i++) results[base + i] = (right ? -x[root[i]] : x[root[i]]) + shift[i]
  }

  let narrowest = 0
  let bestWidth = Number.POSITIVE_INFINITY
  let min0 = 0
  let min1 = 0
  let min2 = 0
  let min3 = 0
  let max0 = 0
  let max1 = 0
  let max2 = 0
  let max3 = 0
  const w = g.w
  for (let k = 0; k < 4; k++) {
    const base = k * n
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (let i = 0; i < n; i++) {
      const half = w[i] / 2
      const xi = results[base + i]
      if (xi - half < lo) lo = xi - half
      if (xi + half > hi) hi = xi + half
    }
    if (k === 0) {
      min0 = lo
      max0 = hi
    } else if (k === 1) {
      min1 = lo
      max1 = hi
    } else if (k === 2) {
      min2 = lo
      max2 = hi
    } else {
      min3 = lo
      max3 = hi
    }
    if (hi - lo < bestWidth) {
      bestWidth = hi - lo
      narrowest = k
    }
  }
  const minN = narrowest === 0 ? min0 : narrowest === 1 ? min1 : narrowest === 2 ? min2 : min3
  const maxN = narrowest === 0 ? max0 : narrowest === 1 ? max1 : narrowest === 2 ? max2 : max3
  // Even variants line up by their left edges, odd ones by their right.
  const delta0 = minN - min0
  const delta1 = maxN - max1
  const delta2 = minN - min2
  const delta3 = maxN - max3

  const out: number[] = []
  for (let i = 0; i < n; i++) {
    let a = results[i]
    let b = results[n + i]
    let c = results[2 * n + i]
    let d = results[3 * n + i]
    if (delta0 !== 0) a += delta0
    if (delta1 !== 0) b += delta1
    if (delta2 !== 0) c += delta2
    if (delta3 !== 0) d += delta3
    let t: number
    if (a > b) {
      t = a
      a = b
      b = t
    }
    if (c > d) {
      t = c
      c = d
      d = t
    }
    if (a > c) {
      t = a
      a = c
      c = t
    }
    if (b > d) {
      t = b
      b = d
      d = t
    }
    if (b > c) {
      t = b
      b = c
      c = t
    }
    out.push(midpoint(b, c))
  }
  return out
}
