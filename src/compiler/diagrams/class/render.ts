/** @module Lays out and draws a class diagram. Port of Pele's `src/diagrams/class/render.ts`. */
import { type ClassDb, orderedGet } from './db.ts'
import { type GraphEdge, type GraphNode, NodeShape, build } from './graph.ts'
import { classMarker, classMarkerTrim } from './markers.ts'
import { type ClassMember, classMemberDisplayText } from './members.ts'
import type { ClassNode } from './types.ts'
import type { Rendered } from '../../diagrams.ts'
import { runsAcross, tighten, turnToFit } from '../common/fit_width.ts'
import { parseGenericTypes } from '../common/generics.ts'
import { type CEdge, type CNode, Dir, cnode, compoundLayout, direction } from '../../layout/compound.ts'
import { esc, escText, jsRound, labelSvg, pushNum } from '../../svg/builder.ts'
import { type Crossings, clusterTitleX, markCrossings, struckTitle, titleCrossed } from '../../svg/cluster.ts'
import { type EdgePath, edgeLabelSvg, routePath } from '../../svg/edges.ts'
import type { Accessible, RenderOptions } from '../../svg/root.ts'
import { svgDocument } from '../../svg/root.ts'
import { endSide } from '../../svg/shapes.ts'
import { RADIUS, type ResolvedStyle, classNames, resolveStyle } from '../../svg/theme.ts'
import { withTitle } from '../../svg/title.ts'
import * as entities from '../../text/entities.ts'
import { type Label, layoutLabel, trim } from '../../text/label.ts'
import { BOLD, ITALIC, width } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { type Buf, asciiLower, buf, fmax, fmin, totalCmp } from '../../util/rust.ts'
import { type LinkInfo, type UrlOptions, linked } from '../../util/url.ts'
import type { Value } from '../../yaml.ts'

/** Room between nodes in a rank. */
const NODE_SEP = 40.0
/** Room between edges. */
const EDGE_SEP = 16.0
/** Room between ranks. */
const RANK_SEP = 56.0
/** Padding inside a namespace. */
const GROUP_PAD = 20.0
/** How far a self-relation reaches out. */
const LOOP = 26.0
/** Padding beside a class's text. */
const PAD_X = 12.0
/** Padding above and below a class's name. */
const TITLE_PAD = 8.0
/** Padding above and below a member section. */
const SECTION_PAD = 6.0
/** Height of an empty member section. */
const EMPTY_SECTION = 10.0
/** Least width of a class. */
const MIN_WIDTH = 64.0
/** Size of a note's folded corner. */
const FOLD = 8.0
/** The color of lines and markers. */
const LINE = 'var(--_l)'
/** The link targets written out. */
const TARGETS: readonly string[] = ['_self', '_blank', '_parent', '_top']

/** The value under `key` of a YAML mapping. */
function get(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  const entries = value._0
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as [string, Value]
    if (entry[0] === key) return entry[1]
  }
  return undefined
}

/** A positive number option of the class section, capped at 2000, or `fallback`. */
function numberOption(section: Value | undefined, key: string, fallback: number): number {
  const value = section === undefined ? undefined : get(section, key)
  if (value?.kind === 'Number' && value._0 > 0.0) return fmin(value._0, 2000.0)
  return fallback
}

/** A member line, measured. */
type Line = {
  classifier: string
  text: string
  width: number
}

/** What a node is drawn as, beside its layout box. */
type View = {
  annotations: string[]
  attributes: Line[]
  attributesH: number
  fontSize: number
  h: number
  label: Label
  methods: Line[]
  style: ResolvedStyle
  titleH: number
  w: number
}

/** An end of an edge on a side of a class. */
type End = {
  /** Whether the text of this end goes on the right of, or below, its line. */
  after: boolean
  /** The index of the route's point. */
  at: number
  /** The edge. */
  edge: number
  order: number
  room: number
  side: number
  toward: number
}

/** A cardinality text. */
type Card = {
  text: string
  x: number
  y: number
}

/** Measures a member's shown text at `size`. */
function memberLine(member: ClassMember, size: number): Line {
  const decoded = entities.decode(classMemberDisplayText(member))
  const text = trim(decoded)
  const style = member.classifier === '*' ? ITALIC : 0
  return {
    classifier: member.classifier,
    width: width(text, size, style),
    text,
  }
}

/**
 * Removes a leading `default` class and one following whitespace character, as
 * `/^default\s?/` does.
 */
function stripDefault(classes: string): string {
  if (!classes.startsWith('default')) return classes
  const rest = classes.slice(7)
  if (rest.length > 0 && isSpace(rest.charCodeAt(0))) return rest.slice(1)
  return rest
}

/**
 * Draws a class diagram, turning one that runs across to run down, and tightening it, when it
 * does not fit the host's width.
 */
export function render(db: ClassDb, config: Value, options: RenderOptions, url: UrlOptions): Rendered {
  const fitted = (down: boolean): Rendered =>
    tighten(options, (tight) => draw(db, config, options, url, down, tight))
  if (runsAcross(db.direction)) return turnToFit(options, fitted)
  return fitted(false)
}

/**
 * The style of a class: the effective declarations of its class definitions and its own, the
 * last of each property winning. A class may carry the declarations of many definitions many
 * times over, so each distinct declaration is checked once.
 */
type Styler = {
  db: ClassDb
  /** The property each declaration sets, or empty when it has no effect. */
  effect: Map<string, string>
  /** The kept declarations of each list of class names. */
  fromDefs: Map<string, [string, string][]>
  /** The kept declarations by property, in the order the properties were first set. */
  kept: [string, string][]
}

/** The UTF-16 index where the last code point of `text` starts, or 0 when it is empty. */
function lastCharStart(text: string): number {
  if (text.length === 0) return 0
  const last = text.charCodeAt(text.length - 1)
  if (last >= 0xdc00 && last <= 0xdfff && text.length >= 2) {
    const prev = text.charCodeAt(text.length - 2)
    if (prev >= 0xd800 && prev <= 0xdbff) return text.length - 2
  }
  return text.length - 1
}

/** Keeps `decl` when it has an effect, as the last value of its property. */
function stylerKeep(self: Styler, decl: string): void {
  let prop = self.effect.get(decl)
  if (prop === undefined) {
    const one = resolveStyle([decl])
    if (one.shape === '' && one.text === '') {
      prop = ''
    } else {
      const colon = decl.indexOf(':')
      const end = colon >= 0 ? colon : lastCharStart(decl)
      prop = asciiLower(trim(decl.slice(0, end)))
    }
    self.effect.set(decl, prop)
  }
  if (prop === '') return
  const kept = self.kept
  for (let i = 0; i < kept.length; i++) {
    const entry = kept[i] as [string, string]
    if (entry[0] === prop) {
      entry[1] = decl
      return
    }
  }
  kept.push([prop, decl])
}

/** The resolved style of `cls`. */
function stylerStyle(self: Styler, cls: ClassNode): ResolvedStyle {
  const kept: [string, string][] = []
  self.kept = kept
  const base = self.fromDefs.get(cls.cssClasses)
  if (base !== undefined) {
    for (let i = 0; i < base.length; i++) {
      const entry = base[i] as [string, string]
      kept.push([entry[0], entry[1]])
    }
  } else {
    const db = self.db
    for (const name of cls.cssClasses.split(' ')) {
      const def = orderedGet(db.styleClasses, name)
      if (def !== undefined) {
        for (const s of def.styles) {
          for (const part of s.split(',')) stylerKeep(self, part)
        }
      }
    }
    const copy: [string, string][] = []
    for (let i = 0; i < kept.length; i++) {
      const entry = kept[i] as [string, string]
      copy.push([entry[0], entry[1]])
    }
    self.fromDefs.set(cls.cssClasses, copy)
  }
  for (const s of cls.styles) stylerKeep(self, s)
  const decls: string[] = []
  for (let i = 0; i < kept.length; i++) decls.push((kept[i] as [string, string])[1])
  return resolveStyle(decls)
}

/** Marks the namespaces from `start` outward as crossed, up to the first already marked. */
function markCrossed(gnodes: GraphNode[], crossed: boolean[], start: number, n: number): void {
  let g = start
  while (g >= 0) {
    if (g < n && !crossed[g]) {
      crossed[g] = true
    } else {
      break
    }
    g = gnodes[g]?.parent ?? -1
  }
}

/** The view of a node drawn as just its label. */
function baseView(label: Label, w: number, h: number, fontSize: number): View {
  return {
    annotations: [],
    attributes: [],
    attributesH: 0.0,
    fontSize,
    h,
    label,
    methods: [],
    style: resolveStyle([]),
    titleH: 0.0,
    w,
  }
}

/** Counts an edge end on a side slot of `item`, keeping the widest text room. */
function meet(crowd: number[], item: number, slot: number, room: number): void {
  const at = item * 4 + slot
  if (at < crowd.length) crowd[at] = (crowd[at] as number) + 1.0
  if (at + 1 < crowd.length && room > (crowd[at + 1] as number)) crowd[at + 1] = room
}

/** The ends on one side of a class, keyed by `item * 4 + side`. */
type Side = {
  key: number
  list: End[]
}

/** Orders ends by where they come from, then by authored order. */
function byToward(a: End, b: End): number {
  return a.toward === b.toward ? a.order - b.order : totalCmp(a.toward, b.toward)
}

/** Attaches an end of edge `edge` at route point `at` to a side of `item`. */
function attach(
  cnodes: CNode[],
  views: View[],
  cedges: CEdge[],
  sideKeys: Map<number, number>,
  sides: Side[],
  edge: number,
  at: number,
  item: number,
  room: number,
): End | undefined {
  const c = cnodes[item]
  const view = views[item]
  const ce = cedges[edge]
  if (c === undefined || view === undefined || ce === undefined) return undefined
  const route = ce.route
  const side = endSide(route, at, c)
  if (side < 0) return undefined
  const slack = (c.w - view.w) / 2.0
  if (at < route.length) {
    if (side === 1) {
      route[at] = (route[at] as number) - slack
    } else if (side === 3) {
      route[at] = (route[at] as number) + slack
    }
  }
  const across = side & 1
  const towardAt = (at === 0 ? 3 : at - 3) + across
  const toward = route[towardAt] ?? Number.NaN
  const bend = toward - (route[at + across] ?? Number.NaN)
  // Ends are never mutated after this, so the side list and the caller share one.
  const end: End = {
    after: across === 1 ? bend > 0.0 : bend >= 0.0,
    at,
    edge,
    order: edge,
    room,
    side,
    toward,
  }
  const key = item * 4 + side
  const k = sideKeys.get(key)
  if (k !== undefined) {
    ;(sides[k] as Side).list.push(end)
  } else {
    sideKeys.set(key, sides.length)
    sides.push({ key, list: [end] })
  }
  return end
}

/** Whether a point lies on the border of one of the namespaces around a class. */
function onBorder(cnodes: CNode[], item: number, x: number, y: number): boolean {
  let g = cnodes[item]?.parent ?? -1
  let hops = 0
  while (g >= 0) {
    if (hops >= 10_000) break
    const c = cnodes[g]
    if (c === undefined) break
    const dx = Math.abs(x - c.x)
    const dy = Math.abs(y - c.y)
    if (
      (Math.abs(dy - c.h / 2.0) < 0.5 && dx <= c.w / 2.0 + 0.5) ||
      (Math.abs(dx - c.w / 2.0) < 0.5 && dy <= c.h / 2.0 + 0.5)
    ) {
      return true
    }
    g = c.parent
    hops += 1
  }
  return false
}

/** Runs an end with text straight for the length of the text. */
function straighten(route: number[], end: End | undefined, room: number, first: boolean, tinyHeight: number): void {
  if (end === undefined) return
  if (room <= 0.0 || route.length < 6) return
  const across = end.side & 1
  const at = first ? 0 : route.length - 3
  const along = at + 1 - across
  const next = (first ? 3 : at - 3) + 1 - across
  const reach = Math.abs((route[next] ?? Number.NaN) - (route[along] ?? Number.NaN))
  const length = fmin(across === 1 ? room + 10.0 : tinyHeight + 6.0, reach * 0.35)
  if (length < 4.0) return
  let p0 = route[at] ?? 0.0
  let p1 = route[at + 1] ?? 0.0
  const p2 = route[at + 2] ?? 0.0
  const delta = (end.side === 0 || end.side === 3 ? -1.0 : 1.0) * length
  if (across === 1) {
    p0 = p0 + delta
  } else {
    p1 = p1 + delta
  }
  route.splice(first ? 3 : at, 0, p0, p1, p2)
}

/**
 * `turned` draws a diagram that runs across as one that runs down. `tight` gives up the room
 * that keeps a namespace's name clear of an edge coming in beside it.
 */
function draw(
  db: ClassDb,
  config: Value,
  options: RenderOptions,
  url: UrlOptions,
  turned: boolean,
  tight: boolean,
): Rendered {
  const classSection = get(config, 'class')
  const conf = classSection?.kind === 'Object' ? classSection : undefined
  const hierarchicalValue = conf === undefined ? undefined : get(conf, 'hierarchicalNamespaces')
  const hierarchical = !(hierarchicalValue?.kind === 'Bool' && hierarchicalValue._0 === false)
  const graph = build(db, hierarchical)
  const hideValue = conf === undefined ? undefined : get(conf, 'hideEmptyMembersBox')
  const hideEmpty = hideValue?.kind === 'Bool' && hideValue._0 === true
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const tiny = jsRound(size * 0.8)
  const tinyHeight = jsRound(tiny * 1.4)
  const pad = options.padding ?? 8.0
  const rootDir = turned ? Dir.Tb : direction(db.direction)
  const n = graph.nodes.length

  const styler: Styler = {
    db,
    effect: new Map(),
    fromDefs: new Map(),
    kept: [],
  }

  const gnodes = graph.nodes
  const children: number[] = []
  const crossed: boolean[] = []
  for (let i = 0; i < n; i++) {
    children.push(0)
    crossed.push(false)
  }
  for (let i = 0; i < n; i++) {
    const p = (gnodes[i] as GraphNode).parent
    if (p >= 0 && p < n) children[p] = (children[p] as number) + 1
  }

  // Namespaces that an edge may cross into are made wide enough for the title to sit beside it.
  for (const edge of graph.edges) {
    if (edge.source === undefined || edge.target === undefined) continue
    const a = gnodes[edge.source]?.parent ?? -1
    const b = gnodes[edge.target]?.parent ?? -1
    if (a === b) continue
    markCrossed(gnodes, crossed, a, n)
    markCrossed(gnodes, crossed, b, n)
  }

  const views: View[] = []
  const cnodes: CNode[] = []
  for (let i = 0; i < n; i++) {
    const node = gnodes[i] as GraphNode
    let view: View
    let c: CNode
    if (node.isGroup) {
      const label = layoutLabel(node.label, false, size, 4000.0, 0, undefined)
      if ((children[i] ?? 0) > 0) {
        c = cnode(0.0, 0.0, -1)
        c.isGroup = true
        c.padX = GROUP_PAD
        c.padTop = label.height > 0.0 ? label.height + 16.0 : GROUP_PAD
        c.padBottom = GROUP_PAD
        c.minW =
          label.width +
          2.0 * GROUP_PAD -
          12.0 +
          ((crossed[i] ?? false) && !tight ? fmin(label.width + 24.0, 240.0) : 0.0)
        view = baseView(label, 0.0, 0.0, size)
      } else {
        const w = fmax(label.width + 2.0 * GROUP_PAD, 80.0)
        const h = label.height + 2.0 * GROUP_PAD
        view = baseView(label, w, h, size)
        c = cnode(w, h, -1)
      }
    } else if (node.classNode !== undefined) {
      view = classView(styler, node.classNode, size, tiny, tinyHeight, hideEmpty)
      c = cnode(view.w, view.h, -1)
    } else if (node.shape === NodeShape.Note) {
      const label = layoutLabel(node.label, true, small, 260.0, 0, undefined)
      const w = fmax(label.width + 2.0 * PAD_X, 40.0)
      const h = label.height + 2.0 * TITLE_PAD
      view = baseView(label, w, h, small)
      c = cnode(w, h, -1)
    } else {
      const label = layoutLabel(node.label, false, small, 200.0, 0, undefined)
      const w = fmax(label.width, 12.0) + 4.0
      const h = fmax(label.height, 12.0)
      view = baseView(label, w, h, small)
      c = cnode(w, h, -1)
    }
    c.parent = node.parent
    c.seq = i
    views.push(view)
    cnodes.push(c)
  }

  const cedges: CEdge[] = []
  const drawn: GraphEdge[] = []
  const edgeLabels: Label[] = []
  const startRoom: number[] = []
  const endRoom: number[] = []
  // Edges leave one side of a class and arrive at the other, so a class with many of them is
  // widened until they, and the text at their ends, fit side by side.
  const crowd: number[] = []
  for (let i = 0; i < n * 4; i++) crowd.push(0.0)
  for (const edge of graph.edges) {
    const source = edge.source
    const target = edge.target
    if (source === undefined || target === undefined) continue
    const label = layoutLabel(edge.label, true, small, 200.0, 0, undefined)
    const startW = edge.startLabelRight === '' ? 0.0 : width(entities.decode(edge.startLabelRight), tiny, 0)
    const endW = edge.endLabelLeft === '' ? 0.0 : width(entities.decode(edge.endLabelLeft), tiny, 0)
    if (source === target) {
      const c = cnodes[source]
      if (c !== undefined) {
        c.w += 2.0 * (LOOP + (label.width > 0.0 ? label.width + 12.0 : 0.0))
      }
    } else {
      meet(crowd, source, 0, startW)
      meet(crowd, target, 2, endW)
    }
    startRoom.push(startW)
    endRoom.push(endW)
    drawn.push(edge)
    cedges.push({
      dst: target,
      labelH: label.height > 0.0 ? label.height + 4.0 : 0.0,
      labelW: label.width > 0.0 ? label.width + 12.0 : 0.0,
      labelX: 0.0,
      labelY: 0.0,
      minlen: 1,
      route: [],
      src: source,
    })
    edgeLabels.push(label)
  }

  if (rootDir === Dir.Tb || rootDir === Dir.Bt) {
    for (let i = 0; i < n; i++) {
      const node = gnodes[i] as GraphNode
      if (node.classNode === undefined) continue
      let need = 0.0
      for (let slot = 0; slot <= 2; slot += 2) {
        const count = crowd[i * 4 + slot] ?? 0.0
        const room = crowd[i * 4 + slot + 1] ?? 0.0
        if (count > 1.0) {
          need = fmax(need, (count - 1.0) * (room > 0.0 ? room + 24.0 : 14.0) + 24.0)
        }
      }
      need = fmin(need, 480.0)
      const view = views[i]
      const c = cnodes[i]
      if (view !== undefined && c !== undefined && need > view.w) {
        c.w += need - view.w
        view.w = need
      }
    }
  }

  let lettered = false
  for (let i = 0; i < Math.min(startRoom.length, endRoom.length); i++) {
    if ((startRoom[i] as number) > 0.0 || (endRoom[i] as number) > 0.0) {
      lettered = true
      break
    }
  }
  const layout = compoundLayout(cnodes, cedges, rootDir, {
    apart: true,
    edgeSep: EDGE_SEP,
    headRoom: 0.0,
    nodeSep: numberOption(conf, 'nodeSpacing', NODE_SEP),
    portSep: 20.0,
    rankSep: numberOption(conf, 'rankSpacing', lettered ? RANK_SEP + 16.0 : RANK_SEP),
    straight: false,
    tracks: false,
  })

  // Every edge reaches the middle of a side. Where several share a side they are spread along
  // it, in the order of where they come from. An end with text runs straight for the length of
  // the text, which sits beside it on the side the line then bends toward, away from the
  // neighbors that bend the other way. Neighbors are set apart far enough for the text between
  // them.
  const sideKeys = new Map<number, number>()
  const sides: Side[] = []
  const starts: (End | undefined)[] = []
  const ends: (End | undefined)[] = []
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i] as CEdge
    const src = ce.src
    const dst = ce.dst
    const len = ce.route.length
    const routed = src !== dst && len >= 6
    starts.push(routed ? attach(cnodes, views, cedges, sideKeys, sides, i, 0, src, startRoom[i] ?? 0.0) : undefined)
    ends.push(routed ? attach(cnodes, views, cedges, sideKeys, sides, i, len - 3, dst, endRoom[i] ?? 0.0) : undefined)
  }

  const gaps: number[] = []
  for (let si = 0; si < sides.length; si++) {
    const sideEntry = sides[si] as Side
    const key = sideEntry.key
    const list = sideEntry.list
    if (list.length < 2) continue
    const item = key >> 2
    const across = key & 1
    const view = views[item]
    if (view === undefined) continue
    const length = across === 1 ? view.h : view.w
    // Equal values, both zeros included, fall back to authored order, as `a - b || ...`
    // does in JavaScript.
    list.sort(byToward)
    let total = 0.0
    let gapCount = 0
    for (let w = 0; w + 1 < list.length; w++) {
      const a = list[w] as End
      const b = list[w + 1] as End
      let gap = across === 1 ? 20.0 : 24.0
      if (a.room > 0.0 && a.after) gap += across === 1 ? tinyHeight + 6.0 : a.room
      if (b.room > 0.0 && !b.after) gap += across === 1 ? tinyHeight + 6.0 : b.room
      if (gapCount < gaps.length) {
        gaps[gapCount] = gap
      } else {
        gaps.push(gap)
      }
      gapCount++
      total += gap
    }
    const scale = fmin((length - 24.0) / total, 1.0)
    if (scale <= 0.0) continue
    const c = cnodes[item]
    if (c === undefined) continue
    let at = (across === 1 ? c.y : c.x) - (total * scale) / 2.0
    for (let j = 0; j < list.length; j++) {
      const end = list[j] as End
      const route = cedges[end.edge]?.route
      if (route === undefined) continue
      // An edge that crosses the border of the class's namespace close by runs straight to
      // it: the point where it crosses moves into line with its end.
      const forward = end.at === 0
      const first = forward ? end.at + 3 : end.at - 3
      const level = route[first + across] ?? Number.NaN
      let border = -1
      let k = first
      while (k >= 0 && k + 1 < route.length && k + across < route.length) {
        const x = route[k] as number
        const y = route[k + 1] as number
        const v = route[k + across] as number
        if (!(Math.abs(v - level) < 0.5)) break
        if (onBorder(cnodes, item, x, y)) {
          border = k
          break
        }
        if (forward) {
          k += 3
        } else if (k >= 3) {
          k -= 3
        } else {
          break
        }
      }
      if (border >= 0 && Math.abs(level - at) <= 24.0) {
        let q = first
        for (;;) {
          if (q + across < route.length) route[q + across] = at
          if (q === border) break
          q = forward ? q + 3 : q - 3
        }
      }
      if (end.at + across < route.length) route[end.at + across] = at
      at += (j < gapCount ? (gaps[j] as number) : Number.NaN) * scale
    }
  }

  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i] as CEdge
    straighten(ce.route, starts[i], startRoom[i] ?? 0.0, true, tinyHeight)
    straighten(ce.route, ends[i], endRoom[i] ?? 0.0, false, tinyHeight)
  }

  let minX = 0.0
  let minY = 0.0
  let maxX = layout.width
  let maxY = layout.height
  const cards: Card[] = []
  const card = (raw: string, cardWidth: number, x: number, y: number, side: number, after: boolean): void => {
    if (raw === '') return
    let cx = x
    let cy = y
    if ((side & 1) === 1) {
      cx += (side === 3 ? -1.0 : 1.0) * (5.0 + cardWidth / 2.0)
      cy += (after ? 1.0 : -1.0) * (7.0 + tinyHeight / 2.0)
    } else {
      cx += (after ? 1.0 : -1.0) * (9.0 + cardWidth / 2.0)
      cy += (side === 0 ? -1.0 : 1.0) * (3.0 + tinyHeight / 2.0)
    }
    cards.push({ text: entities.decode(raw), x: cx, y: cy })
    minX = fmin(minX, cx - cardWidth / 2.0)
    maxX = fmax(maxX, cx + cardWidth / 2.0)
    minY = fmin(minY, cy - tinyHeight / 2.0)
    maxY = fmax(maxY, cy + tinyHeight / 2.0)
  }
  const loopSeen: number[] = []
  for (let i = 0; i < n; i++) loopSeen.push(0)
  const loopAt: number[] = []
  for (let i = 0; i < cedges.length; i++) loopAt.push(0)
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i] as CEdge
    const edge = drawn[i]
    if (edge === undefined) continue
    const sRoom = startRoom[i] ?? 0.0
    const eRoom = endRoom[i] ?? 0.0
    const route = ce.route
    if (ce.src === ce.dst) {
      const k = loopSeen[ce.src] ?? 0
      if (ce.src < loopSeen.length) loopSeen[ce.src] = k + 1
      if (i < loopAt.length) loopAt[i] = k
      const c = cnodes[ce.src]
      const view = views[ce.src]
      if (c === undefined || view === undefined) continue
      const x = c.x + view.w / 2.0
      const spread = fmin(view.h / 2.0 - 4.0, 8.0 + k * 6.0)
      card(edge.startLabelRight, sRoom, x, c.y - spread, 1, false)
      card(edge.endLabelLeft, eRoom, x, c.y + spread, 1, true)
    } else if (route.length >= 6) {
      const last = route.length - 3
      const from = starts[i]
      const to = ends[i]
      card(
        edge.startLabelRight,
        sRoom,
        route[0] ?? 0.0,
        route[1] ?? 0.0,
        from === undefined ? 2 : from.side,
        from === undefined || from.after,
      )
      card(
        edge.endLabelLeft,
        eRoom,
        route[last] ?? 0.0,
        route[last + 1] ?? 0.0,
        to === undefined ? 0 : to.side,
        to === undefined || to.after,
      )
    }
  }

  const ox = pad - minX
  const oy = pad - minY
  const totalWidth = Math.ceil(maxX - minX + 2.0 * pad)
  const totalHeight = Math.ceil(maxY - minY + 2.0 * pad)
  const links: LinkInfo[] = []

  const crossings: Crossings = new Map()
  if (graph.nodes[0]?.isGroup === true) {
    for (const e of cedges) markCrossings(crossings, e.route)
  }

  const clusters = buf()
  let struckTitles = ''
  const nodesOut = buf()
  const count = Math.min(views.length, graph.nodes.length)
  const sizes: Sizes = { size, tiny, tinyHeight }
  const smallAttrs = labelAttrs(small)
  for (let i = 0; i < count; i++) {
    const view = views[i] as View
    const node = graph.nodes[i] as GraphNode
    const c = cnodes[i]
    if (c === undefined) continue
    const x = c.x + ox
    const y = c.y + oy
    const id = escText(node.id)
    const w = c.isGroup ? c.w : view.w
    const h = c.isGroup ? c.h : view.h
    if (node.isGroup) {
      const titleX = c.isGroup ? clusterTitleX(c, view.label.width, crossings, GROUP_PAD) : c.x
      const titleY = y - h / 2.0 + 8.0 + view.label.height / 2.0
      const titleAttrs = ' class="ondine-cluster-label" fill="var(--_m)"'
      const struck = c.isGroup && titleCrossed(c, view.label.width, titleX, crossings)
      if (struck) {
        struckTitles += struckTitle(view.label, titleX + ox, titleY, titleAttrs, id, cnodes, i, undefined)
      }
      clusters.s += '<g class="ondine-cluster ondine-namespace" data-id="'
      clusters.s += id
      clusters.s += '"><rect x="'
      pushNum(clusters, x - w / 2.0)
      clusters.s += '" y="'
      pushNum(clusters, y - h / 2.0)
      clusters.s += '" width="'
      pushNum(clusters, w)
      clusters.s += '" height="'
      pushNum(clusters, h)
      clusters.s += '" rx="'
      clusters.s += RADIUS
      clusters.s += '" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"/>'
      if (!struck) {
        clusters.s += labelSvg(view.label, titleX + ox, titleY, titleAttrs, undefined)
      }
      clusters.s += '</g>'
      continue
    }

    const at = buf(' transform="translate(')
    pushNum(at, x)
    at.s += ','
    pushNum(at, y)
    at.s += ')"'
    if (node.classNode !== undefined) {
      nodesOut.s += classSvg(view, node.classNode, id, at.s, sizes, url, links)
    } else if (node.shape === NodeShape.Note) {
      const r = w / 2.0
      const t = -h / 2.0
      nodesOut.s += '<g class="ondine-node ondine-note" data-id="'
      nodesOut.s += id
      nodesOut.s += '"'
      nodesOut.s += at.s
      nodesOut.s += '><path d="M'
      pushNum(nodesOut, -r)
      nodesOut.s += ','
      pushNum(nodesOut, t)
      nodesOut.s += 'H'
      pushNum(nodesOut, r - FOLD)
      nodesOut.s += 'L'
      pushNum(nodesOut, r)
      nodesOut.s += ','
      pushNum(nodesOut, t + FOLD)
      nodesOut.s += 'V'
      pushNum(nodesOut, -t)
      nodesOut.s += 'H'
      pushNum(nodesOut, -r)
      nodesOut.s += 'Z" fill="var(--_a)" stroke="var(--_b)" stroke-linejoin="round"/><path d="M'
      pushNum(nodesOut, r - FOLD)
      nodesOut.s += ','
      pushNum(nodesOut, t)
      nodesOut.s += 'V'
      pushNum(nodesOut, t + FOLD)
      nodesOut.s += 'H'
      pushNum(nodesOut, r)
      nodesOut.s += '" fill="none" stroke="var(--_b)" stroke-linejoin="round"/>'
      nodesOut.s += labelSvg(view.label, 0.0, 0.0, smallAttrs, undefined)
      nodesOut.s += '</g>'
    } else {
      nodesOut.s += '<g class="ondine-node ondine-interface" data-id="'
      nodesOut.s += id
      nodesOut.s += '"'
      nodesOut.s += at.s
      nodesOut.s += '>'
      nodesOut.s += labelSvg(view.label, 0.0, 0.0, smallAttrs, undefined)
      nodesOut.s += '</g>'
    }
  }

  let edgesOut = ''
  let labelsOut = ''
  for (let i = 0; i < cedges.length; i++) {
    const edge = drawn[i]
    const label = edgeLabels[i]
    if (edge === undefined || label === undefined) continue
    const startType = edge.arrowTypeStart
    const endType = edge.arrowTypeEnd
    const startTrim = classMarkerTrim(startType)
    const endTrim = classMarkerTrim(endType)
    const ce = cedges[i] as CEdge
    let path: EdgePath
    if (ce.src === ce.dst) {
      const c = cnodes[ce.src]
      const view = views[ce.src]
      if (c === undefined || view === undefined) continue
      const k = loopAt[i] ?? 0
      const x = c.x + ox + view.w / 2.0
      const y = c.y + oy
      const spread = fmin(view.h / 2.0 - 4.0, 8.0 + k * 6.0)
      const reach = LOOP + k * 8.0
      const d = buf('M')
      pushNum(d, x + startTrim)
      d.s += ','
      pushNum(d, y - spread)
      d.s += 'C'
      pushNum(d, x + reach + startTrim)
      d.s += ','
      pushNum(d, y - spread)
      d.s += ' '
      pushNum(d, x + reach + endTrim)
      d.s += ','
      pushNum(d, y + spread)
      d.s += ' '
      pushNum(d, x + endTrim)
      d.s += ','
      pushNum(d, y + spread)
      ce.labelX = c.x + view.w / 2.0 + reach + 4.0 + ce.labelW / 2.0
      ce.labelY = c.y
      path = {
        d: d.s,
        edx: -1.0,
        edy: 0.0,
        ex: x,
        ey: y + spread,
        sdx: -1.0,
        sdy: 0.0,
        sx: x,
        sy: y - spread,
      }
    } else {
      for (let k = 0; k + 1 < ce.route.length; k += 3) {
        ce.route[k] = (ce.route[k] as number) + ox
        ce.route[k + 1] = (ce.route[k + 1] as number) + oy
      }
      path = routePath(ce.route, undefined, startTrim, endTrim, undefined, undefined)
    }
    const attrs = edge.dashed ? ' stroke-dasharray="6 4"' : edge.dotted ? ' stroke-dasharray="2 4"' : ''
    edgesOut += '<g class="ondine-edge'
    edgesOut += edge.dotted ? ' ondine-note-edge' : ' ondine-relation'
    edgesOut += '" data-id="'
    edgesOut += escText(edge.id)
    edgesOut += '"><path d="'
    edgesOut += path.d
    edgesOut += '"'
    edgesOut += attrs
    edgesOut += '/>'
    edgesOut += classMarker(startType, path.sx, path.sy, path.sdx, path.sdy, LINE)
    edgesOut += classMarker(endType, path.ex, path.ey, path.edx, path.edy, LINE)
    edgesOut += '</g>'
    if (label.width > 0.0) {
      labelsOut += edgeLabelSvg(edge.id, label, ce.labelX + ox, ce.labelY + oy, '', undefined)
    }
  }

  const cardsOut = buf()
  for (const item of cards) {
    cardsOut.s += '<text class="ondine-cardinality" x="'
    pushNum(cardsOut, item.x + ox)
    cardsOut.s += '" y="'
    pushNum(cardsOut, item.y + oy + tiny * 0.35)
    cardsOut.s += '" text-anchor="middle">'
    cardsOut.s += esc(item.text)
    cardsOut.s += '</text>'
  }

  const content = buf()
  if (clusters.s !== '') {
    content.s += '<g class="ondine-clusters">'
    content.s += clusters.s
    content.s += '</g>'
  }
  if (edgesOut !== '') {
    content.s += '<g class="ondine-edges" fill="none" stroke="'
    content.s += LINE
    content.s += '" stroke-linecap="round">'
    content.s += edgesOut
    content.s += '</g>'
  }
  if (struckTitles !== '') {
    content.s += '<g class="ondine-cluster-titles">'
    content.s += struckTitles
    content.s += '</g>'
  }
  if (labelsOut !== '') {
    content.s += '<g class="ondine-edge-labels" font-size="'
    pushNum(content, small)
    content.s += '">'
    content.s += labelsOut
    content.s += '</g>'
  }
  if (cardsOut.s !== '') {
    content.s += '<g class="ondine-cardinalities" font-size="'
    pushNum(content, tiny)
    content.s += '" fill="var(--_m)">'
    content.s += cardsOut.s
    content.s += '</g>'
  }
  content.s += '<g class="ondine-nodes">'
  content.s += nodesOut.s
  content.s += '</g>'

  const titled = withTitle(db.title, size, pad, totalWidth, totalHeight, content.s)
  const accessible: Accessible = {
    accDescr: db.accDescr,
    accTitle: db.accTitle,
  }
  const svg = svgDocument('class', titled.width, titled.height, size, options, accessible, titled.content)

  return {
    height: titled.height,
    links,
    svg,
    width: titled.width,
  }
}

/** The attributes of a note's or an interface's label. */
function labelAttrs(small: number): string {
  const attrs = buf(' class="ondine-label" font-size="')
  pushNum(attrs, small)
  attrs.s += '"'
  return attrs.s
}

/** The diagram's font sizes that a class box reads. */
type Sizes = {
  size: number
  tiny: number
  tinyHeight: number
}

/** Measures a class box: its name, annotations, and member sections. */
function classView(
  styler: Styler,
  cls: ClassNode,
  size: number,
  tiny: number,
  tinyHeight: number,
  hideEmpty: boolean,
): View {
  const style = stylerStyle(styler, cls)
  const fontSize = style.fontSize ?? size
  const memberSize = jsRound(fontSize * 0.875)
  const lineHeight = jsRound(memberSize * 1.5)
  // The generic type is escaped so that `<T>` is not read as a tag.
  let text = cls.label
  if (cls.type !== '') {
    text += '&lt;'
    for (const c of parseGenericTypes(cls.type)) {
      if (c === '<') {
        text += '&lt;'
      } else if (c === '>') {
        text += '&gt;'
      } else {
        text += c
      }
    }
    text += '&gt;'
  }
  const label = layoutLabel(text, false, fontSize, 4000.0, BOLD | (style.italic ? ITALIC : 0), undefined)
  const annotations: string[] = []
  for (let i = 0; i < cls.annotations.length; i++) {
    annotations.push(`\u{ab}${trim(entities.decode(cls.annotations[i] as string))}\u{bb}`)
  }
  const attributes: Line[] = []
  for (let i = 0; i < cls.members.length; i++) attributes.push(memberLine(cls.members[i] as ClassMember, memberSize))
  const methods: Line[] = []
  for (let i = 0; i < cls.methods.length; i++) methods.push(memberLine(cls.methods[i] as ClassMember, memberSize))
  let inner = label.width
  for (const a of annotations) inner = fmax(inner, width(a, tiny, 0))
  for (const line of attributes) inner = fmax(inner, line.width)
  for (const line of methods) inner = fmax(inner, line.width)
  const sections = !(hideEmpty && attributes.length === 0 && methods.length === 0)
  const titleH = 2.0 * TITLE_PAD + annotations.length * tinyHeight + fmax(label.height, jsRound(fontSize * 1.5))
  const attributesH = sectionHeight(sections, attributes.length, lineHeight)
  const h = titleH + attributesH + sectionHeight(sections, methods.length, lineHeight)
  return {
    annotations,
    attributes,
    attributesH,
    fontSize,
    h,
    label,
    methods,
    style,
    titleH,
    w: fmax(inner + 2.0 * PAD_X, MIN_WIDTH),
  }
}

/** The height of a member section of `count` lines, or 0 when sections are hidden. */
function sectionHeight(sections: boolean, count: number, lineHeight: number): number {
  if (!sections) return 0.0
  if (count > 0) return 2.0 * SECTION_PAD + count * lineHeight
  return EMPTY_SECTION
}

/** `text` without its last character, as `String::pop` leaves it. */
function popChar(text: string): string {
  return text.slice(0, lastCharStart(text))
}

/** Draws a class box. */
function classSvg(
  view: View,
  cls: ClassNode,
  id: string,
  at: string,
  sizes: Sizes,
  url: UrlOptions,
  links: LinkInfo[],
): string {
  const w = view.w
  const h = view.h
  const style = view.style
  const left = -w / 2.0
  const top = -h / 2.0
  const memberSize = jsRound(view.fontSize * 0.875)
  const lineHeight = jsRound(memberSize * 1.5)

  const body: Buf = buf('<rect x="')
  pushNum(body, left)
  body.s += '" y="'
  pushNum(body, top)
  body.s += '" width="'
  pushNum(body, w)
  body.s += '" height="'
  pushNum(body, h)
  body.s += '" rx="'
  body.s += RADIUS
  body.s += '" fill="var(--_s)" stroke="var(--_b)"'
  body.s += style.shape
  body.s += '/>'

  const first = top + view.titleH
  const second = first + view.attributesH
  if (h > view.titleH) {
    body.s += '<path class="ondine-divider" d="M'
    pushNum(body, left)
    body.s += ','
    pushNum(body, first)
    body.s += 'H'
    pushNum(body, -left)
    body.s += 'M'
    pushNum(body, left)
    body.s += ','
    pushNum(body, second)
    body.s += 'H'
    pushNum(body, -left)
    body.s += '" fill="none" stroke="var(--_b)"'
    if (style.stroke !== undefined && style.stroke !== '') {
      body.s += ' style="stroke:'
      body.s += esc(style.stroke)
      body.s += '"'
    }
    body.s += '/>'
  }

  let y = top + TITLE_PAD
  for (const annotation of view.annotations) {
    body.s += '<text class="ondine-annotation" x="0" y="'
    pushNum(body, y + sizes.tinyHeight / 2.0 + sizes.tiny * 0.35)
    body.s += '" text-anchor="middle" font-size="'
    pushNum(body, sizes.tiny)
    body.s += '" fill="var(--_m)">'
    body.s += esc(annotation)
    body.s += '</text>'
    y += sizes.tinyHeight
  }

  const titleAttrs = buf(' class="ondine-label"')
  if (view.fontSize !== sizes.size) {
    titleAttrs.s += ' font-size="'
    pushNum(titleAttrs, view.fontSize)
    titleAttrs.s += '"'
  }
  titleAttrs.s += ' font-weight="var(--_hw)"'
  titleAttrs.s += style.text
  body.s += labelSvg(view.label, 0.0, (y + first - TITLE_PAD) / 2.0, titleAttrs.s, undefined)

  if (view.attributes.length > 0 || view.methods.length > 0) {
    body.s += '<g class="ondine-members" font-size="'
    pushNum(body, memberSize)
    body.s += '">'
    body.s += memberLines(view.attributes, 'attribute', first, lineHeight, memberSize, left, style)
    body.s += memberLines(view.methods, 'method', second, lineHeight, memberSize, left, style)
    body.s += '</g>'
  }

  let bodyText = body.s
  if (cls.tooltip !== undefined && cls.tooltip !== '') {
    bodyText = `<title>${escText(cls.tooltip)}</title>${bodyText}`
  }
  if (cls.link !== undefined && cls.link !== '') {
    let attrs = ''
    const target = cls.linkTarget
    if (target !== undefined && TARGETS.includes(target)) {
      attrs += ` target="${target}"`
    }
    bodyText = linked(bodyText, cls.link, cls.id, links, url, attrs)
  }

  let out = '<g class="ondine-node ondine-class'
  out += classNames(stripDefault(cls.cssClasses))
  out += '" data-id="'
  out += id
  out += '"'
  out += at
  out += '>'
  out += bodyText
  out += '</g>'
  return out
}

/** Draws the lines of a member section. */
function memberLines(
  list: Line[],
  kind: string,
  from: number,
  lineHeight: number,
  memberSize: number,
  left: number,
  style: ResolvedStyle,
): string {
  const out = buf()
  let baseline = from + SECTION_PAD + lineHeight / 2.0 + memberSize * 0.35
  for (const line of list) {
    out.s += '<text class="ondine-member ondine-'
    out.s += kind
    switch (line.classifier) {
      case '$':
        out.s += ' ondine-static"'
        if (style.text === '') {
          out.s += ' style="text-decoration:underline"'
        } else {
          out.s += popChar(style.text)
          out.s += 'text-decoration:underline"'
        }
        break
      case '*':
        out.s += ' ondine-abstract" font-style="italic"'
        out.s += style.text
        break
      default:
        out.s += '"'
        out.s += style.text
        break
    }
    out.s += ' x="'
    pushNum(out, left + PAD_X)
    out.s += '" y="'
    pushNum(out, baseline)
    out.s += '">'
    out.s += esc(line.text)
    out.s += '</text>'
    baseline += lineHeight
  }
  return out.s
}
