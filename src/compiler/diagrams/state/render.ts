/** @module Lays out and draws a state diagram. Port of Pele's `src/diagrams/state/render.ts`. */
import { type StateDb, stateDbDirection, stateDbLink } from './db.ts'
import type { StateEdge, StateNode } from './graph.ts'
import type { Rendered } from '../../diagrams.ts'
import { runsAcross, turnToFit } from '../common/fit_width.ts'
import { type CEdge, type CNode, Dir, cnode, compoundLayout, direction } from '../../layout/compound.ts'
import type { LayeredOptions } from '../../layout/layered.ts'
import { esc, escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import {
  type EdgePath,
  type SideReach,
  edgeLabelSvg,
  marker,
  markerTrim,
  routePath,
  sideReachAdd,
  sideReachDefault,
  sideReachOf,
} from '../../svg/edges.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { endSide } from '../../svg/shapes.ts'
import { type ResolvedStyle, classNames, resolveStyle } from '../../svg/theme.ts'
import { withTitle } from '../../svg/title.ts'
import * as entities from '../../text/entities.ts'
import { type Label, labelDefault, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { type LinkInfo, type UrlOptions, linked, safeUrl } from '../../util/url.ts'
import { asInt, type Buf, fmax, fmin, midpoint, saturatingSub, trimMatches } from '../../util/rust.ts'
import type { Value } from '../../yaml.ts'

const NODE_SEP = 40.0
const EDGE_SEP = 16.0
const RANK_SEP = 44.0
const GROUP_PAD = 16.0
const REGION_PAD = 10.0
const PAD_X = 16.0
const PAD_Y = 10.0
const LOOP = 26.0
const FOLD = 8.0
const NOTE_WRAP = 320.0
const CORNER = 10.0
const BAR = 8.0
const SURFACE = ' fill="var(--_s)" stroke="var(--_b)"'
const RULE = ' fill="none" stroke="var(--_b)"'

/** What a node is drawn as. */
const K = {
  Choice: 'Choice',
  Composite: 'Composite',
  Described: 'Described',
  End: 'End',
  Fork: 'Fork',
  /** An unseen helper the layout needs, or a divider outside a body. */
  Hidden: 'Hidden',
  Join: 'Join',
  Note: 'Note',
  /** A part of a composite between dividers. */
  Region: 'Region',
  Start: 'Start',
  State: 'State',
} as const
type K = (typeof K)[keyof typeof K]

/** The classes of the drawn element, or `undefined` for kinds that draw no element of their own. */
function kClasses(self: K): string | undefined {
  switch (self) {
    case K.State:
    case K.Described:
      return 'ondine-node ondine-state'
    case K.Start:
      return 'ondine-node ondine-state-start'
    case K.End:
      return 'ondine-node ondine-state-end'
    case K.Choice:
      return 'ondine-node ondine-state-choice'
    case K.Fork:
      return 'ondine-node ondine-state-fork'
    case K.Join:
      return 'ondine-node ondine-state-join'
    case K.Note:
      return 'ondine-note'
    case K.Composite:
      return 'ondine-cluster ondine-state-composite'
    case K.Region:
    case K.Hidden:
      return undefined
  }
}

/** Pele's `KINDS` lookup for a node that is not a container. */
function kOf(shape: string | undefined): K {
  switch (shape) {
    case 'rectWithTitle':
      return K.Described
    case 'stateStart':
      return K.Start
    case 'stateEnd':
      return K.End
    case 'choice':
      return K.Choice
    case 'fork':
      return K.Fork
    case 'join':
      return K.Join
    case 'note':
      return K.Note
    case 'divider':
      return K.Hidden
    default:
      return K.State
  }
}

/** What the transitions and notes of one state add up to. */
type Stats = {
  /** Transitions that reach the state. */
  arriving: number
  /** The most transitions on one side: leaving or arriving. */
  degree: number
  /** Transitions that leave the state. */
  leaving: number
  /** How many transitions the state makes to itself. */
  loopCount: number
  /** The height of their labels together. */
  loopHeight: number
  /** How many of them are drawn so far. */
  loopSeen: number
  /** The height of the labels drawn so far. */
  loopText: number
  /** Their widest label. */
  loopWidth: number
  /** Whether a note sits beside the state. */
  noted: boolean
  /** For a note, the state it belongs to. */
  owner: number | undefined
}

function statsDefault(): Stats {
  return {
    arriving: 0,
    degree: 0,
    leaving: 0,
    loopCount: 0,
    loopHeight: 0,
    loopSeen: 0,
    loopText: 0,
    loopWidth: 0,
    noted: false,
    owner: undefined,
  }
}

/** A node as drawn, beside its layout box. */
type View = {
  h: number
  kind: K
  label: Label
  lines: Label[]
  /** Absent for the unseen helpers the layout needs. */
  node: StateNode | undefined
  style: ResolvedStyle | undefined
  titleH: number
  w: number
}

function view(node: StateNode | undefined, kind: K): View {
  return {
    h: 0,
    kind,
    label: labelDefault(),
    lines: [],
    node,
    style: undefined,
    titleH: 0,
    w: 0,
  }
}

function nodeOf(views: View[], i: number): StateNode | undefined {
  return views[i]?.node
}

/** As in Mermaid, a composite that sets no direction runs top to bottom whatever surrounds it. */
function innerDir(views: View[], composite: number): Dir {
  return direction(nodeOf(views, composite)?.dir)
}

function vertical(dir: Dir | undefined): boolean {
  return dir === Dir.Tb || dir === Dir.Bt
}

/** The value under `key` of a YAML mapping. */
function get(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

function numberOption(config: Value, key: string, fallback: number): number {
  const section = get(config, 'state')
  const value = section === undefined ? undefined : get(section, key)
  if (value?.kind === 'Number' && value._0 > 0) return fmin(value._0, 2000)
  return fallback
}

/** Mermaid keeps the quotes of a click statement's strings and strips them when it draws. */
function unquote(text: string): string {
  return trimMatches(text, '"')
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/** JavaScript's `Math.sign`. */
function jsSign(value: number): number {
  if (value === 0 || Number.isNaN(value)) return value
  return value > 0 ? 1 : -1
}

/** `value || 1`. */
function orOne(value: number): number {
  if (value === 0 || Number.isNaN(value)) return 1
  return value
}

function toParent(parent: number | undefined): number {
  return parent ?? -1
}

function rect(x: number, y: number, w: number, h: number, rest: string): string {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rest}/>`
}

function group(dir: Dir, padX: number, padTop: number, padBottom: number): CNode {
  const c = cnode(0, 0, -1)
  c.isGroup = true
  c.dir = dir
  c.padX = padX
  c.padTop = padTop
  c.padBottom = padBottom
  return c
}

/**
 * Removes Mermaid's own state classes, as Pele's
 * `/(?:^| )statediagram-(?:state|cluster-alt|cluster|note)(?= |$)/g` does.
 */
function stripMermaidClasses(classes: string): string {
  // The class list every plain state carries.
  if (classes === ' statediagram-state') return ''
  let out = ''
  let at = 0
  let kept = 0
  // A match starts at 0 or at a space before the prefix; other positions are skipped by search.
  while (at < classes.length) {
    const end = mermaidClassEnd(classes, at)
    if (end >= 0) {
      out += classes.slice(kept, at)
      kept = end
      at = end
      continue
    }
    const next = classes.indexOf(' statediagram-', at + 1)
    if (next < 0) break
    at = next
  }
  if (kept === 0) return classes
  out += classes.slice(kept)
  return out
}

/** Where a Mermaid state class matched at `at` ends, or -1. */
function mermaidClassEnd(classes: string, at: number): number {
  const PREFIX = 'statediagram-'
  let from: number
  if (at === 0 && hasAt(classes, 0, PREFIX)) {
    from = PREFIX.length
  } else if (classes.charCodeAt(at) === 32 && hasAt(classes, at + 1, PREFIX)) {
    from = at + 1 + PREFIX.length
  } else {
    return -1
  }
  for (let w = 0; w < MERMAID_WORDS.length; w++) {
    const word = MERMAID_WORDS[w] as string
    if (!hasAt(classes, from, word)) continue
    const after = from + word.length
    if (after === classes.length || classes.charCodeAt(after) === 32) return after
  }
  return -1
}

/** Whether `text` holds `word` at `at`. */
function hasAt(text: string, at: number, word: string): boolean {
  if (at + word.length > text.length) return false
  for (let k = 0; k < word.length; k++) {
    if (text.charCodeAt(at + k) !== word.charCodeAt(k)) return false
  }
  return true
}

const MERMAID_WORDS = ['state', 'cluster-alt', 'cluster', 'note']

/**
 * Draws a state diagram, turning one that runs across to run down when it does not fit the host's
 * width.
 */
export function render(db: StateDb, config: Value, options: RenderOptions, url: UrlOptions): Rendered {
  if (!runsAcross(stateDbDirection(db))) return draw(db, config, options, url, false)
  return turnToFit(options, (down) => draw(db, config, options, url, down))
}

/**
 * Pele's comparison of the order states take in their flow: initial states first, then the order
 * transitions introduce them, then declaration order.
 */
function byFlow(views: View[], appear: number[], a: number, b: number): number {
  const va = views[a]
  const vb = views[b]
  const ia = va === undefined || va.kind !== K.Start ? 1 : 0
  const ib = vb === undefined || vb.kind !== K.Start ? 1 : 0
  if (ia !== ib) return ia < ib ? -1 : 1
  const pa = appear[a] ?? Number.POSITIVE_INFINITY
  const pb = appear[b] ?? Number.POSITIVE_INFINITY
  if (pa < pb) return -1
  if (pa > pb) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Sorts `items` by {@link byFlow}. It is a total order, so a list already in order stays as it is,
 * as any sort leaves it.
 */
function sortByFlow(views: View[], appear: number[], items: number[]): void {
  for (let k = 1; k < items.length; k++) {
    if (byFlow(views, appear, items[k - 1] as number, items[k] as number) > 0) {
      items.sort((a, b) => byFlow(views, appear, a, b))
      return
    }
  }
}

/** `turned` draws a diagram that runs across as one that runs down. */
function draw(
  db: StateDb,
  config: Value,
  options: RenderOptions,
  url: UrlOptions,
  turned: boolean,
): Rendered {
  const graph = db.graph
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.875)
  const wrapWidth = numberOption(config, 'wrappingWidth', 200)
  const pad = options.padding ?? 8
  const rootDir = turned ? Dir.Tb : direction(stateDbDirection(db))
  const text = (raw: string | undefined, fontSize: number, wrap: number, style: number): Label =>
    layoutLabel(raw, true, fontSize, wrap, style, undefined)

  const index = new Map<string, number>()
  const views: View[] = []
  const cnodes: CNode[] = []
  for (const node of graph.nodes) {
    if (node.shape === 'noteGroup') continue
    const kind = node.isGroup ? (node.shape === 'divider' ? K.Region : K.Composite) : kOf(node.shape)
    index.set(node.id, views.length)
    views.push(view(node, kind))
  }
  const states = views.length

  const logical: (number | undefined)[] = []
  for (let i = 0; i < states; i++) {
    const id = nodeOf(views, i)?.parentId
    const parent = id === undefined ? undefined : index.get(id)
    logical.push(
      parent !== undefined && parent !== i && nodeOf(views, parent)?.isGroup === true ? parent : undefined,
    )
  }
  // Composites that are redeclared inside each other form a ring with no way in from the root.
  // One member of each ring moves to the root, which leaves a tree.
  {
    const kids: number[][] = []
    for (let i = 0; i < states; i++) kids.push([])
    const queue: number[] = []
    const placed: boolean[] = []
    for (let i = 0; i < logical.length; i++) placed.push(logical[i] === undefined)
    for (let i = 0; i < logical.length; i++) {
      const parent = logical[i]
      if (parent === undefined) queue.push(i)
      else kids[parent]?.push(i)
    }
    let done = 0
    const settle = (): void => {
      while (done < queue.length) {
        const at = queue[done] as number
        const list = kids[at]
        if (list !== undefined) for (let k = 0; k < list.length; k++) {
          const kid = list[k] as number
          if (kid < placed.length && !placed[kid]) {
            placed[kid] = true
            queue.push(kid)
          }
        }
        done += 1
      }
    }
    settle()
    const seen: (number | undefined)[] = []
    for (let i = 0; i < states; i++) seen.push(undefined)
    for (let i = 0; i < states; i++) {
      if (placed[i] ?? true) continue
      let ring = i
      while ((ring < states ? seen[ring] : undefined) !== i) {
        if (ring < states) seen[ring] = i
        const next = logical[ring]
        if (next === undefined) break
        ring = next
      }
      if (ring < logical.length) logical[ring] = undefined
      if (ring < placed.length) placed[ring] = true
      queue.push(ring)
      settle()
    }
  }
  const stats: Stats[] = []
  for (let i = 0; i < states; i++) stats.push(statsDefault())
  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i] as Stats
    const id = nodeOf(views, i)?.noteFor
    const owner = id === undefined ? undefined : index.get(id)
    if (owner === undefined) continue
    stat.owner = owner
    const parent = logical[owner]
    if (i < logical.length) logical[i] = parent
  }

  // Whether the flow around each state runs top to bottom or bottom to top.
  const across: boolean[] = []
  for (let i = 0; i < states; i++) {
    const parent = logical[i]
    across.push(vertical(parent === undefined ? rootDir : innerDir(views, parent)))
  }
  const acrossOf = (i: number): boolean => across[i] ?? false

  // When each state first takes part in a transition. Layout follows this order rather than the
  // order of declaration, so a state declared up front does not become the top of the flow.
  const appear: number[] = []
  for (let i = 0; i < states; i++) appear.push(Number.POSITIVE_INFINITY)
  let appeared = 0
  for (const edge of graph.edges) {
    const src = index.get(edge.start)
    const dst = index.get(edge.end)
    if (src === undefined || dst === undefined) continue
    if (edge.pattern === 'dashed') {
      const at = views[src]?.kind === K.Note ? dst : src
      const stat = stats[at]
      if (stat !== undefined) stat.noted = true
      continue
    }
    const from = stats[src]
    if (from !== undefined) {
      from.leaving += 1
      from.degree = Math.max(from.degree, from.leaving)
    }
    const to = stats[dst]
    if (to !== undefined) {
      to.arriving += 1
      to.degree = Math.max(to.degree, to.arriving)
    }
    if (src < appear.length && appear[src] === Number.POSITIVE_INFINITY) {
      appear[src] = appeared
      appeared += 1
    }
    if (dst < appear.length && appear[dst] === Number.POSITIVE_INFINITY) {
      appear[dst] = appeared
      appeared += 1
    }
  }

  for (let i = 0; i < states; i++) {
    const dir = innerDir(views, i)
    const view = views[i]
    if (view === undefined) continue
    const node = view.node
    if (node === undefined) continue
    const style =
      node.cssStyles.length === 0
        ? resolveStyle(node.cssCompiledStyles)
        : resolveStyle([...node.cssCompiledStyles, ...node.cssStyles])
    const textStyle = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
    const fontSize = style.fontSize ?? size
    view.style = style
    let c: CNode | undefined
    switch (view.kind) {
      case K.Composite: {
        view.label = text(node.label, fontSize, 4000, textStyle)
        view.titleH = view.label.height > 0 ? view.label.height + 12 : 0
        const g = group(dir, GROUP_PAD, view.titleH + GROUP_PAD, GROUP_PAD)
        g.minW = view.label.width + 2 * GROUP_PAD
        c = g
        break
      }
      case K.Region:
        c = group(dir, REGION_PAD, REGION_PAD, REGION_PAD)
        break
      case K.Start:
        view.w = 14
        view.h = 14
        break
      case K.End:
        view.w = 18
        view.h = 18
        break
      case K.Choice:
        view.w = 30
        view.h = 30
        break
      case K.Fork:
      case K.Join: {
        const degree = stats[i]?.degree ?? 0
        const length = clamp(40 * degree + 16, 72, 320)
        view.w = acrossOf(i) ? length : BAR
        view.h = acrossOf(i) ? BAR : length
        break
      }
      case K.Hidden:
        break
      case K.Note:
        view.label = text(node.label, small, fmax(wrapWidth, NOTE_WRAP), 0)
        view.w = view.label.width + 24
        view.h = view.label.height + 16
        break
      case K.State:
      case K.Described: {
        view.label = text(node.label, fontSize, wrapWidth, textStyle)
        let width = view.label.width
        let height = view.label.height + 2 * PAD_Y
        if (view.kind === K.Described) {
          height += 14
          for (const line of node.description) {
            const raw = line === '' ? ' ' : line
            const label = text(raw, small, wrapWidth, textStyle)
            if (label.width > width) width = label.width
            height += label.height
            view.lines.push(label)
          }
        }
        view.w = fmax(width + 2 * PAD_X, 56)
        view.h = height
        break
      }
    }
    const made = c ?? cnode(view.w, view.h, -1)
    // The transitions on one side of a state's box spread along it, clear of its corners.
    if (view.kind === K.State || view.kind === K.Described) {
      made.span = (acrossOf(i) ? view.w : view.h) - 24
    }
    cnodes.push(made)
  }

  const cedges: CEdge[] = []
  const edgeLabels: Label[] = []
  const drawn: StateEdge[] = []
  // A transition between a composite and a state inside it runs between that state and a point
  // just inside the composite, and is then drawn on to the composite's border.
  const anchors = new Map<number, number>()
  const encloses = (composite: number, item: number): boolean => {
    if (cnodes[composite]?.isGroup !== true) return false
    let p = logical[item]
    let hops = 0
    while (p !== undefined) {
      if (p === composite) return true
      hops += 1
      if (hops > states) break
      p = logical[p]
    }
    return false
  }
  for (const edge of graph.edges) {
    const src0 = index.get(edge.start)
    const dst0 = index.get(edge.end)
    if (src0 === undefined || dst0 === undefined) continue
    let src = src0
    let dst = dst0
    const label = text(edge.label, small, wrapWidth, 0)
    const labelW = label.width > 0 ? label.width + 12 : 0
    const enclosedDst = src !== dst && encloses(src, dst)
    const enclosedSrc = src !== dst && !enclosedDst && encloses(dst, src)
    if (src === dst) {
      // The transitions each state makes to itself: how many, their widest label, and their
      // labels' height.
      const stat = stats[src]
      if (stat !== undefined) {
        stat.loopCount += 1
        stat.loopWidth = fmax(stat.loopWidth, labelW)
        stat.loopHeight += label.height
      }
    } else if (enclosedDst || enclosedSrc) {
      const composite = enclosedDst ? src : dst
      const first = enclosedDst
      anchors.set(cedges.length, composite)
      appear.push(first ? -1 : Number.POSITIVE_INFINITY)
      const anchor = views.length
      views.push(view(undefined, K.Hidden))
      cnodes.push(cnode(0, 0, toParent(composite)))
      if (first) src = anchor
      else dst = anchor
    }
    drawn.push(edge)
    cedges.push({
      dst,
      labelH: label.height > 0 ? label.height + 4 : 0,
      labelW,
      labelX: 0,
      labelY: 0,
      minlen: 1,
      route: [],
      src,
    })
    edgeLabels.push(label)
  }

  // A state with notes, or a composite with self-transitions, sits in an unseen group of its own:
  // the notes go beside the state, across the flow, without disturbing its transitions.
  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i] as Stats
    if (stat.owner !== undefined) continue
    const across = acrossOf(i)
    const parent = toParent(logical[i])
    const item = cnodes[i]
    if (item === undefined) continue
    // Loops hang off the right, or below when the flow is horizontal, with their labels beyond
    // them.
    let room = 0
    if (stat.loopCount > 0) {
      const reach = LOOP + (stat.loopCount - 1) * 8
      room = across ? reach + stat.loopWidth : reach * 0.75 + 4 + stat.loopHeight
      if (!item.isGroup) {
        if (across) {
          item.w += 2 * room
          item.h = fmax(item.h, stat.loopHeight)
        } else {
          item.h += 2 * room
          item.w = fmax(item.w, stat.loopWidth)
        }
        room = 0
      }
    }
    if (!stat.noted && room === 0) {
      item.parent = parent
      continue
    }
    const c = across ? group(Dir.Lr, room, 0, 0) : group(Dir.Tb, 0, room, room)
    c.parent = parent
    appear.push(appear[i] ?? Number.POSITIVE_INFINITY)
    const holder = views.length
    views.push(view(undefined, K.Hidden))
    cnodes.push(c)
    item.parent = toParent(holder)
  }
  for (let i = 0; i < stats.length; i++) {
    const owner = (stats[i] as Stats).owner
    if (owner !== undefined) {
      const parent = cnodes[owner]?.parent ?? -1
      const c = cnodes[i]
      if (c !== undefined) c.parent = parent
    }
  }

  {
    // Numbers the tree so that, at every level, initial states come first and the rest follow in
    // the order the transitions introduce them.
    const members: number[][] = []
    for (let i = 0; i < cnodes.length; i++) members.push([])
    const top: number[] = []
    for (let i = 0; i < cnodes.length; i++) {
      const p = (cnodes[i] as CNode).parent
      const list = p >= 0 ? members[p] : undefined
      if (list !== undefined) list.push(i)
      else top.push(i)
    }
    let seq = 0
    sortByFlow(views, appear, top)
    top.reverse()
    const pending = top
    for (;;) {
      const i = pending.pop()
      if (i === undefined) break
      const c = cnodes[i]
      if (c !== undefined) c.seq = seq
      seq += 1
      const inside = members[i] ?? []
      sortByFlow(views, appear, inside)
      for (let k = inside.length - 1; k >= 0; k--) pending.push(inside[k] as number)
    }
  }

  const layoutOptions: LayeredOptions = {
    apart: false,
    edgeSep: EDGE_SEP,
    headRoom: markerTrim('arrow_point'),
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    portSep: 20,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    straight: false,
    tracks: false,
  }
  const layout = compoundLayout(cnodes, cedges, rootDir, layoutOptions)

  const width = Math.ceil(layout.width + 2 * pad)
  const height = Math.ceil(layout.height + 2 * pad)
  const links: LinkInfo[] = []

  // Route points by rounded y, to find the edges that cross a composite's title bar.
  const crossings = new Map<number, number[]>()
  for (const e of cedges) {
    const route = e.route
    let k = 3
    while (k + 3 < route.length) {
      const x = route[k]
      const y = route[k + 1]
      if (x !== undefined && y !== undefined) {
        const at = key(y)
        let list = crossings.get(at)
        if (list === undefined) {
          list = []
          crossings.set(at, list)
        }
        list.push(x)
      }
      k += 3
    }
  }

  const children: number[][] = []
  for (let i = 0; i < cnodes.length; i++) children.push([])
  const order: number[] = []
  for (let i = 0; i < cnodes.length; i++) {
    const p = (cnodes[i] as CNode).parent
    const list = p >= 0 ? children[p] : undefined
    if (list !== undefined) list.push(i)
    else order.push(i)
  }
  const roots = order.slice()
  for (let q = 0; q < order.length; q++) {
    const list = children[order[q] as number]
    if (list !== undefined) order.push(...list)
  }

  const smallAttrs = ` font-size="${num(small)}"`
  let clusters = ''
  const dividers: Buf = { s: '' }
  let nodesOut = ''
  let notesOut = ''
  const frame: Frame = { cnodes, pad, views }
  frameDivide(frame, dividers, roots, pad / 2, pad / 2, width - pad / 2, height - pad / 2)

  for (const i of order) {
    const view = views[i]
    const c = cnodes[i]
    if (view === undefined || c === undefined) continue
    const node = view.node
    const style = view.style
    const classes = kClasses(view.kind)
    if (node === undefined || style === undefined || classes === undefined) continue
    const x = c.x + pad
    const y = c.y + pad
    const w = view.w
    const h = view.h
    const labelAttrs = ` class="ondine-label"${style.text}`

    let body = ''
    switch (view.kind) {
      case K.Composite: {
        const left = x - c.w / 2
        const top = y - c.h / 2
        const rest = ` rx="10" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${style.shape}`
        body += rect(left, top, c.w, c.h, rest)
        if (view.titleH > 0) {
          body += `<path d="M${num(left)},${num(top + view.titleH)}H${num(left + c.w)}"${RULE}${style.line}/>`
          const attrs = ` class="ondine-cluster-label"${style.text}`
          body += labelSvg(
            view.label,
            titleX(c, view.label.width, crossings) + pad,
            top + view.titleH / 2,
            attrs,
            undefined,
          )
        }
        frameDivide(frame, dividers, children[i] ?? [], left, top + view.titleH, left + c.w, top + c.h)
        break
      }
      case K.Start:
        body += `<circle r="7" fill="var(--_l)"${style.shape}/>`
        break
      case K.End:
        body += `<circle r="8.5" fill="var(--_bg)" stroke="var(--_l)"${style.line}/><circle r="5" fill="var(--_l)"${style.shape}/>`
        break
      case K.Choice:
        body += `<polygon points="0,${num(-h / 2)} ${num(w / 2)},0 0,${num(h / 2)} ${num(-w / 2)},0"${SURFACE}${style.shape}/>`
        break
      case K.Fork:
      case K.Join: {
        const rest = ` rx="2" fill="var(--_l)"${style.shape}`
        body += rect(-w / 2, -h / 2, w, h, rest)
        break
      }
      case K.Note: {
        const r = num(w / 2)
        const b = num(h / 2)
        const fold = num(w / 2 - FOLD)
        const corner = num(FOLD - h / 2)
        body += `<path d="M-${r},-${b}H${fold}L${r},${corner}V${b}H-${r}Z" fill="var(--_bg)" stroke="var(--_b)"/><path d="M${fold},-${b}V${corner}H${r}"${RULE}/>`
        const attrs = ` class="ondine-label"${smallAttrs} fill="var(--_m)"`
        body += labelSvg(view.label, 0, 0, attrs, undefined)
        break
      }
      case K.State:
      case K.Described:
      case K.Region:
      case K.Hidden: {
        const rest = ` rx="${num(fmin(CORNER, h / 2))}"${SURFACE}${style.shape}`
        body += rect(-w / 2, -h / 2, w, h, rest)
        if (view.kind === K.State) {
          body += labelSvg(view.label, 0, 0, labelAttrs, undefined)
        } else {
          let at = PAD_Y - h / 2 + view.label.height
          body += `<path d="M${num(-w / 2)},${num(at + 6)}H${num(w / 2)}"${RULE}${style.line}/>`
          body += labelSvg(view.label, 0, at - view.label.height / 2, labelAttrs, undefined)
          at += 14
          const attrs = ` class="ondine-state-description"${smallAttrs}${style.text}`
          for (const line of view.lines) {
            body += labelSvg(line, 0, at + line.height / 2, attrs, undefined)
            at += line.height
          }
        }
        break
      }
    }

    const link = stateDbLink(db, node.id)
    if (link !== undefined) {
      // Entity codes are resolved first, so the URL is checked in the form a browser would
      // follow.
      const tooltip = entities.decode(unquote(link.tooltip))
      if (tooltip !== '') body = `<title>${esc(tooltip)}</title>${body}`
      body = linked(body, safeUrl(unquote(link.url)), node.id, links, url, ' target="_blank"')
    }

    let out = `<g class="${classes}${classNames(stripMermaidClasses(node.cssClasses))}" data-id="${escText(node.id)}"`
    if (view.kind !== K.Composite) out += ` transform="translate(${num(x)},${num(y)})"`
    out += `>${body}</g>`
    if (view.kind === K.Composite) clusters += out
    else if (view.kind === K.Note) notesOut += out
    else nodesOut += out
  }

  const reach: SideReach = sideReachDefault()
  for (let i = 0; i < cedges.length && i < drawn.length; i++) {
    const ce = cedges[i] as CEdge
    const edge = drawn[i] as StateEdge
    if (ce.src === ce.dst || ce.route.length < 6 || edge.pattern === 'dashed') continue
    const dst = cnodes[ce.dst]
    if (dst !== undefined) {
      sideReachAdd(reach, ce.dst, endSide(ce.route, ce.route.length - 3, dst), 'arrow_point')
    }
  }

  let edgesOut = ''
  let labelsOut = ''
  for (let i = 0; i < cedges.length; i++) {
    const edge = drawn[i]
    const label = edgeLabels[i]
    if (edge === undefined || label === undefined) continue
    const note = edge.pattern === 'dashed'
    const endType = note ? 'none' : 'arrow_point'
    const ce = cedges[i] as CEdge
    const src = ce.src
    const dst = ce.dst
    let path: EdgePath
    if (src === dst) {
      const a = cnodes[src]
      const view = views[src]
      const stat = stats[src]
      if (a === undefined || view === undefined || stat === undefined) continue
      const k = stat.loopSeen
      stat.loopSeen += 1
      // The loop hangs off a side the flow does not use: the right, or below when the flow is
      // horizontal.
      const side = acrossOf(src)
      const w = a.isGroup ? a.w : view.w
      const h = a.isGroup ? a.h : view.h
      const out = (side ? w : h) / 2
      const spread = fmax(fmin((side ? h : w) / 2 - 4, 8 + k * 6), 2)
      const loopReach = LOOP + k * 8
      const trim = markerTrim(endType) / orOne(Math.hypot(loopReach, spread))
      // Offsets are given for a loop on the right and turned a quarter for one below.
      const px = (dx: number, dy: number): number => a.x + pad + (side ? out + dx : -dy)
      const py = (dx: number, dy: number): number => a.y + pad + (side ? dy : out + dx)
      const at = (dx: number, dy: number): string => `${num(px(dx, dy))},${num(py(dx, dy))}`
      const d = `M${at(0, -spread)}C${at(loopReach, -2 * spread)} ${at(loopReach, 2 * spread)} ${at(loopReach * trim, spread + spread * trim)}`
      const edx = px(-loopReach, -spread) - px(0, 0)
      const edy = py(-loopReach, -spread) - py(0, 0)
      const len = orOne(Math.hypot(edx, edy))
      path = {
        d,
        edx: edx / len,
        edy: edy / len,
        ex: px(0, spread),
        ey: py(0, spread),
        sdx: 0,
        sdy: 0,
        sx: 0,
        sy: 0,
      }
      // Labels stack beyond the outermost loop, in the order of their transitions.
      const furthest = LOOP + saturatingSub(stat.loopCount, 1) * 8
      const below = stat.loopText + label.height / 2
      stat.loopText += label.height
      const loopHeight = stat.loopHeight
      ce.labelX = side ? a.x + out + furthest + 4 + ce.labelW / 2 : a.x
      ce.labelY = side ? a.y - loopHeight / 2 + below : a.y + out + furthest * 0.75 + 4 + below
    } else {
      const srcNode = cnodes[src]
      const dstNode = cnodes[dst]
      if (srcNode === undefined || dstNode === undefined) continue
      const route = ce.route.slice()
      const last = saturatingSub(route.length, 3)
      const leaves = sideReachOf(reach, src, endSide(route, 0, srcNode))
      const arrives = sideReachOf(reach, dst, endSide(route, last, dstNode))
      for (let p = 0; p + 3 <= route.length; p += 3) {
        route[p] = (route[p] as number) + pad
        route[p + 1] = (route[p + 1] as number) + pad
      }
      frameAttach(frame, route, 0, src)
      frameAttach(frame, route, last, dst)
      const composite = anchors.get(i)
      const g = composite === undefined ? undefined : cnodes[composite]
      const owner = composite === undefined ? undefined : views[composite]
      if (route.length >= 6 && g !== undefined && owner !== undefined) {
        const inward = views[src]?.kind === K.Hidden
        const at = inward ? 0 : route.length - 3
        const near = (g.dir === Dir.Tb || g.dir === Dir.Lr) === inward
        const point = vertical(g.dir)
          ? [route[at] ?? Number.NaN, g.y + pad + (near ? owner.titleH - g.h / 2 : g.h / 2), 0]
          : [g.x + pad + (near ? -g.w / 2 : g.w / 2), route[at + 1] ?? Number.NaN, 1]
        if (inward) route.unshift(...point)
        else route.push(...point)
      }
      path = routePath(route, undefined, 0, markerTrim(endType), leaves, arrives)
    }

    edgesOut += note
      ? '<g class="ondine-edge ondine-note-edge" stroke="var(--_b)" stroke-dasharray="3 4" data-id="'
      : '<g class="ondine-edge ondine-transition" data-id="'
    edgesOut += `${escText(edge.id)}"><path d="${path.d}"/>`
    edgesOut += marker(endType, path.ex, path.ey, path.edx, path.edy, 'var(--_l)')
    edgesOut += '</g>'
    if (label.width > 0) {
      labelsOut += edgeLabelSvg(edge.id, label, ce.labelX + pad, ce.labelY + pad, '', undefined)
    }
  }

  let content = ''
  if (clusters !== '') content += `<g class="ondine-clusters">${clusters}</g>`
  if (dividers.s !== '') {
    content += `<g class="ondine-dividers" stroke-dasharray="4 4"${RULE}>${dividers.s}</g>`
  }
  if (edgesOut !== '') {
    content += `<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>`
  }
  if (labelsOut !== '') {
    content += `<g class="ondine-edge-labels" font-size="${num(small)}">${labelsOut}</g>`
  }
  content += `<g class="ondine-nodes">${nodesOut}${notesOut}</g>`

  const titled = withTitle(db.title, size, pad, width, height, content)
  const accessible: Accessible = { accDescr: db.accDescr, accTitle: db.accTitle }
  const svg = svgDocument('state', titled.width, titled.height, size, options, accessible, titled.content)

  return { height: titled.height, links, svg, width: titled.width }
}

/** A rounded coordinate as a map key. */
function key(value: number): number {
  return asInt(jsRound(value))
}

/** The laid-out boxes the drawing helpers read. */
type Frame = {
  cnodes: CNode[]
  pad: number
  views: View[]
}

/** Draws the dashed lines between the regions among a composite's members. */
function frameDivide(
  self: Frame,
  out: Buf,
  items: number[],
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  const regions = items.filter((i) => self.views[i]?.kind === K.Region)
  if (regions.length < 2) return
  const lo = (i: number, x: boolean): number => {
    const c = self.cnodes[i]
    if (c === undefined) return Number.NaN
    return x ? c.x - c.w / 2 : c.y - c.h / 2
  }
  const hi = (i: number, x: boolean): number => {
    const c = self.cnodes[i]
    if (c === undefined) return Number.NaN
    return x ? c.x + c.w / 2 : c.y + c.h / 2
  }
  for (const x of [true, false]) {
    const sorted = regions.slice()
    sorted.sort((a, b) => {
      const d = lo(a, x) - lo(b, x)
      if (d === 0 || Number.isNaN(d)) return a < b ? -1 : a > b ? 1 : 0
      return d < 0 ? -1 : 1
    })
    // Pele asks whether any region reaches past the next, so `NaN` counts as apart.
    let apart = true
    for (let k = 0; k + 1 < sorted.length; k++) {
      if (hi(sorted[k] as number, x) > lo(sorted[k + 1] as number, x) + 0.5) {
        apart = false
        break
      }
    }
    if (!apart) continue
    for (let k = 0; k + 1 < sorted.length; k++) {
      const a = sorted[k] as number
      const b = sorted[k + 1] as number
      const at = num(midpoint(hi(a, x), lo(b, x)) + self.pad)
      out.s += '<path class="ondine-divider" d="M'
      if (x) out.s += `${at},${num(top)}V${num(bottom)}`
      else out.s += `${num(left)},${at}H${num(right)}`
      out.s += '"/>'
    }
    return
  }
  // Regions that sit neither side by side nor in a stack each get an outline.
  for (const i of regions) {
    const c = self.cnodes[i]
    if (c !== undefined) {
      out.s += rect(
        c.x - c.w / 2 + self.pad,
        c.y - c.h / 2 + self.pad,
        c.w,
        c.h,
        ' class="ondine-divider" rx="10"',
      )
    }
  }
}

/** Moves a route end from the layout box onto the drawn shape, and spreads the ends along a bar. */
function frameAttach(self: Frame, route: number[], at: number, i: number): void {
  const c = self.cnodes[i]
  const view = self.views[i]
  if (c === undefined || view === undefined) return
  if (c.isGroup) return
  const bar = view.kind === K.Fork || view.kind === K.Join
  const other = at === 0 ? 3 : at - 3
  // 1 is the y axis and 0 the x axis. The end sits on a side that faces along `axis`.
  for (let axis = 1; axis >= 0; axis--) {
    const y = axis === 1
    const extent = y ? c.h : c.w
    const drawnExtent = y ? view.h : view.w
    const breadth = y ? view.w : view.h
    const center = (y ? c.y : c.x) + self.pad
    const cross = (y ? c.x : c.y) + self.pad
    const value = route[at + axis]
    if (value === undefined) return
    const delta = value - center
    if (Math.abs(Math.abs(delta) - extent / 2) >= 0.5) continue
    route[at + axis] = value - (jsSign(delta) * (extent - drawnExtent)) / 2
    if (bar && breadth > drawnExtent) {
      const from = route[other + 1 - axis] ?? Number.NaN
      const slot = at + 1 - axis
      if (slot < route.length) {
        route[slot] = clamp(from, cross - breadth / 2 + 6, cross + breadth / 2 - 6)
      }
    }
    return
  }
}

/**
 * Picks where a composite's title sits in its title bar so that edges entering from above do not
 * cross it.
 */
function titleX(c: CNode, width: number, crossings: Map<number, number[]>): number {
  const xs = crossings.get(key(c.y - c.h / 2))
  if (xs === undefined) return c.x
  if (width === 0) return c.x
  const left = c.x - c.w / 2
  const half = width / 2
  let best = c.x
  let bestGap = -1
  for (const x of [c.x, left + GROUP_PAD + half, left + c.w - GROUP_PAD - half]) {
    let gap = Number.POSITIVE_INFINITY
    for (const cx of xs) {
      if (cx > left && cx < left + c.w) gap = fmin(gap, Math.abs(cx - x) - half)
    }
    if (gap >= 6) return x
    if (gap > bestGap + 0.5) {
      bestGap = gap
      best = x
    }
  }
  return best
}
