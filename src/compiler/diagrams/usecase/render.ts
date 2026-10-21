/**
 * @module Draws a use case diagram: actors as figures, use cases as ovals or boxes, notes, JSON
 * tables, and system boundaries, joined by relationship edges. Port of Pele's
 * `src/diagrams/usecase/render.ts`.
 */
import { type GraphEdge, type GraphNode, buildUsecaseGraph } from './graph.ts'
import { ActorType, type UsecaseModel } from './types.ts'
import type { Rendered } from '../../diagrams.ts'
import { runsAcross, turnToFit } from '../common/fit_width.ts'
import {
  type CEdge,
  type CNode,
  Dir,
  cnode,
  compoundLayout,
  direction,
  shiftLayout,
} from '../../layout/compound.ts'
import type { LayeredOptions } from '../../layout/layered.ts'
import { esc, escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { type Crossings, markCrossings } from '../../svg/cluster.ts'
import { type EdgePath, edgeLabelSvg, marker, markerTrim, routePath } from '../../svg/edges.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { ROUNDED, type ResolvedStyle, classNames, resolveStyle } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { buf, fmax, fmin, powi } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

/** Room between nodes in a rank. */
const NODE_SEP = 32.0
/** Room between edges. */
const EDGE_SEP = 16.0
/** Room between ranks. */
const RANK_SEP = 72.0
/** Padding inside a boundary. */
const GROUP_PAD = 20.0
/** How far a self-relationship reaches out of its node. */
const LOOP = 26.0
/** Width of an actor's figure. */
const FIGURE_W = 40.0
/** Height of an actor's figure. */
const FIGURE_H = 60.0
/** Room between an actor's figure and its text. */
const FIGURE_GAP = 6.0
/** Padding around a package's title. */
const TAB_PAD = 6.0
/** Padding beside the text of a JSON table cell. */
const CELL_PAD = 10.0
/** Room added to each JSON table row. */
const ROW_PAD = 8.0
/** Size of a note's folded corner. */
const FOLD = 9.0
/** Length of the triangle of a generalization. */
const EXTENSION = 12.0
/** The most room between edge ends on one side of a node. */
const PORT_GAP = 14.0
/** Fill and stroke of a filled outline. */
const SHAPE_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"'

/** How a node is drawn. */
const Kind = {
  /** An actor. */
  Actor: 'Actor',
  /** A system boundary. */
  Boundary: 'Boundary',
  /** A rectangle or a note. */
  Box: 'Box',
  /** An oval. */
  Ellipse: 'Ellipse',
  /** A JSON table. */
  Json: 'Json',
} as const
type Kind = (typeof Kind)[keyof typeof Kind]

/** A node's measured parts. */
type View = {
  /** Height of a JSON table's header. */
  headH: number
  /**
   * Height of what is drawn; the layout box is larger when the node carries a
   * self-relationship.
   */
  h: number
  /** Width of a JSON table's key column. */
  keyW: number
  /** How it is drawn. */
  kind: Kind
  /** Its label. */
  label: Label
  /** A JSON table's key and value labels. */
  rows: [Label, Label][]
  /** Its stereotype. */
  stereotype: Label
  /** Its author styles. */
  style: ResolvedStyle
  /** Width of what is drawn. */
  w: number
}

/** `value` as JavaScript's `Number.prototype.toString` writes it. */
function numberText(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

/** The member `key` of an object. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** A positive number option of the `usecase` section, at most 2000, or `fallback`. */
function numberOption(config: Value, key: string, fallback: number): number {
  const section = property(config, 'usecase')
  const value = section === undefined ? undefined : property(section, key)
  if (value !== undefined && value.kind === 'Number' && value._0 > 0) return fmin(value._0, 2000)
  return fallback
}

/**
 * A plain label is shown as written: no tags, no markdown, no `\n` breaks. Its markup characters
 * are handed to the label parser as character references, which it turns back into characters.
 */
function literal(text: string): string {
  let out = ''
  let kept = 0
  for (let i = 0; i < text.length; i++) {
    let code: string
    switch (text.charCodeAt(i)) {
      case 0x26:
        code = '&#38;'
        break
      case 0x3c:
        code = '&#60;'
        break
      case 0x3e:
        code = '&#62;'
        break
      case 0x5c:
        code = '&#92;'
        break
      default:
        continue
    }
    out += text.slice(kept, i) + code
    kept = i + 1
  }
  if (kept === 0) return text
  return out + text.slice(kept)
}

/** Lays out a label, plain text shown as written. */
function text(raw: string | undefined, markdown: boolean, size: number, wrap: number, base: number): Label {
  if (raw !== undefined && raw !== '' && !markdown) {
    return layoutLabel(literal(raw), false, size, wrap, base, undefined)
  }
  return layoutLabel(raw, markdown, size, wrap, base, undefined)
}

/** Wraps text in guillemets. */
function guillemets(text: string): string {
  return `«${text}»`
}

/**
 * The point of a node's outline on one of its four sides (0 top, 1 right, 2 bottom, 3 left),
 * `along` away from the middle of that side. Lines meet an actor at its figure, not at its label.
 */
function anchor(view: View, c: CNode, side: number, along: number): [number, number] {
  const sign = side === 1 || side === 2 ? 1 : -1
  const upright = side === 1 || side === 3
  let reach = (upright ? view.w : view.h) / 2
  let middle = 0
  if (view.kind === Kind.Actor) {
    if (upright) {
      reach = FIGURE_W / 2 + 3
      middle = (FIGURE_H - view.h) / 2
    } else {
      reach += 2
    }
  } else if (view.kind === Kind.Ellipse) {
    const span = (upright ? view.h : view.w) / 2
    reach *= Math.sqrt(fmax(1 - powi(along / span, 2), 0))
  }
  if (upright) return [c.x + sign * reach, c.y + middle + along]
  return [c.x + along, c.y + sign * reach]
}

/** How much of a side edges may spread over. */
function sideLength(view: View, side: number): number {
  const upright = side === 1 || side === 3
  if (view.kind === Kind.Actor) return upright ? FIGURE_H * 0.5 : FIGURE_W * 0.6
  const length = upright ? view.h : view.w
  return view.kind === Kind.Ellipse ? length * 0.6 : length - 16
}

/** One end of an edge on a side of a node. */
type End = {
  /** The index of its point in the route. */
  at: number
  /** The edge. */
  edge: number
  /** Where the edge heads from there, along the side. */
  toward: number
}

/**
 * The layout brings every edge that ends on one side of a node to the middle of that side. This
 * spaces them along the side in the order they fan out, and puts each on the node's outline.
 */
function attachEnds(cedges: CEdge[], cnodes: CNode[], views: View[]): void {
  // Sides in order of first use, as a `Map` iterates them.
  const sides = new Map<number, End[]>()
  for (let e = 0; e < cedges.length; e++) {
    const edge = cedges[e] as CEdge
    const route = edge.route
    if (edge.src === edge.dst || route.length < 6) continue
    const last = route.length - 3
    attachEnd(sides, cnodes, route, e, edge.src, 0, 3)
    attachEnd(sides, cnodes, route, e, edge.dst, last, last - 3)
  }
  for (const [key, ends] of sides) {
    const index = key >> 2
    const side = key & 3
    const view = views[index]
    const c = cnodes[index]
    if (view === undefined || c === undefined) continue
    const count = ends.length
    const step = ends.length > 1 ? fmin(PORT_GAP, sideLength(view, side) / (count - 1)) : 0
    ends.sort(byToward)
    for (let i = 0; i < ends.length; i++) {
      const end = ends[i] as End
      const [x, y] = anchor(view, c, side, (i - (count - 1) / 2) * step)
      const route = cedges[end.edge]?.route
      if (route !== undefined) {
        if (end.at < route.length) route[end.at] = x
        if (end.at + 1 < route.length) route[end.at + 1] = y
      }
    }
  }
}

function byToward(a: End, b: End): number {
  const d = a.toward - b.toward
  return d < 0 ? -1 : d > 0 ? 1 : 0
}

/** Records the end of edge `e` at route point `at` on its side of node `index`. */
function attachEnd(
  sides: Map<number, End[]>,
  cnodes: CNode[],
  route: number[],
  e: number,
  index: number,
  at: number,
  next: number,
): void {
  const c = cnodes[index]
  if (c === undefined) return
  if (c.isGroup) return
  const dx = (route[at] ?? Number.NaN) - c.x
  const dy = (route[at + 1] ?? Number.NaN) - c.y
  let side: number
  if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) {
    side = dy < 0 ? 0 : 2
  } else if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) {
    side = dx < 0 ? 3 : 1
  } else {
    return
  }
  const key = index * 4 + side
  const end: End = { at, edge: e, toward: route[next + (side & 1)] ?? Number.NaN }
  const found = sides.get(key)
  if (found !== undefined) found.push(end)
  else sides.set(key, [end])
}

/** `x,y`. */
function point(x: number, y: number): string {
  return `${num(x)},${num(y)}`
}

/** The hollow triangle of a generalization, with its tip at (x, y). */
function extension(x: number, y: number, dx: number, dy: number, color: string): string {
  const bx = x - dx * EXTENSION
  const by = y - dy * EXTENSION
  const half = EXTENSION * 0.5
  return `<path class="ondine-marker" d="M${point(x, y)}L${point(bx - dy * half, by + dx * half)}L${point(
    bx + dy * half,
    by - dx * half,
  )}Z" fill="var(--_bg)" stroke="${color}" stroke-linejoin="round"/>`
}

/** How far a marker of `type` trims the end of its edge. */
function trim(type: string): number {
  return type === 'extension' ? EXTENSION : markerTrim(type)
}

/** Draws a marker of `type` with its tip at (x, y). */
function mark(type: string, x: number, y: number, dx: number, dy: number, color: string): string {
  return type === 'extension' ? extension(x, y, dx, dy, color) : marker(type, x, y, dx, dy, color)
}

/** An actor's figure, centered on the origin. */
function figure(view: View, node: GraphNode): string {
  const shape = view.style.shape
  const line = ` fill="none" stroke="var(--_b)"${view.style.line}`
  let head = -21.0
  let radius = 9.0
  let out = ''
  const type = node.shape.kind === 'Actor' ? node.shape._0 : undefined
  if (type === ActorType.Hollow) {
    radius = 8.0
    out += `<circle cy="-21" r="8" fill="var(--_bg)" stroke="var(--_b)"${shape}/><path d="M-20,-9H20V0H5.5L20,15.5L12,25.5L0,12L-12,25.5L-20,15.5L-5.5,0H-20Z" fill="var(--_bg)" stroke="var(--_b)" stroke-linejoin="round"${shape}/>`
  } else if (type === ActorType.Awesome) {
    out += `<path d="M0,-30A11,11 0 1 1 0,-8A11,11 0 1 1 0,-30ZM-20,25C-20,9 -12,-3 0,-3C12,-3 20,9 20,25C20,28 18,30 15,30H-15C-18,30 -20,28 -20,25Z" fill="var(--_b)"${shape}/>`
  } else if (type === ActorType.Icon) {
    head = -14.0
    radius = 12.0
    out += `<rect x="-22" y="-26" width="44" height="44"${ROUNDED}${SHAPE_ATTRS}${shape}/><svg class="ondine-icon" data-icon="${escText(
      node.icon ?? '',
    )}" x="-14" y="-18" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>`
  } else {
    out += `<circle cy="-21" r="9"${SHAPE_ATTRS}${shape}/><path d="M0,-12V10M-14,-3H14M0,10L-12,30M0,10L12,30"${line}/>`
  }
  if (node.business) {
    // The slash of a business actor: a chord across the lower right of the head.
    out += `<path class="ondine-business" d="M${point(0.12 * radius, head + 0.99 * radius)}L${point(
      0.92 * radius,
      head - 0.39 * radius,
    )}"${line}/>`
  }
  return out
}

/**
 * Draws `model` with the `usecase` section of `config`, turned to run down when it runs across
 * and does not fit the host's width.
 */
export function render(model: UsecaseModel, config: Value, options: RenderOptions): Rendered {
  if (!runsAcross(model.direction)) return draw(model, config, options, false)
  return turnToFit(options, (down) => draw(model, config, options, down))
}

/**
 * `classes` without a leading `default` and one whitespace character after it, as
 * `/^default\s?/` removes them.
 */
function withoutDefault(classes: string): string {
  if (!classes.startsWith('default')) return classes
  const rest = classes.slice(7)
  return rest.length > 0 && isSpace(rest.charCodeAt(0)) ? rest.slice(1) : rest
}

/** An edge's author classes: its classes without `/^default relationship relationship-\S+\s?/`. */
function edgeClasses(classes: string): string {
  const prefix = 'default relationship relationship-'
  if (!classes.startsWith(prefix)) return classes
  let rest = classes.slice(prefix.length)
  let kind = 0
  while (kind < rest.length && !isSpace(rest.charCodeAt(kind))) kind += 1
  if (kind === 0) return classes
  rest = rest.slice(kind)
  return rest.length > 0 && isSpace(rest.charCodeAt(0)) ? rest.slice(1) : rest
}

/** Measures a node. */
function measure(node: GraphNode, size: number, small: number, tiny: number): View {
  const style =
    node.cssStyles.length === 0
      ? resolveStyle(node.cssCompiledStyles)
      : resolveStyle([...node.cssCompiledStyles, ...node.cssStyles])
  const base = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
  const fontSize = style.fontSize ?? size
  const markdown = node.markdown
  const stereotype = text(
    node.stereotype === undefined ? undefined : guillemets(node.stereotype),
    false,
    tiny,
    200,
    base,
  )
  const view: View = {
    headH: 0,
    h: 0,
    keyW: 0,
    kind: Kind.Box,
    label: stereotype,
    rows: [],
    stereotype,
    style,
    w: 0,
  }
  if (node.shape.kind === 'Boundary') {
    view.kind = Kind.Boundary
    view.label = text(node.label, markdown, fontSize, 4000, base)
    return view
  }
  if (node.jsonRows !== undefined) {
    view.kind = Kind.Json
    view.label = text(node.label, false, fontSize, 4000, base | BOLD)
    let valueW = 0
    for (const row of node.jsonRows) {
      const key = text(row.key, false, small, 4000, base)
      const value = text(row.value, false, small, 260, base)
      view.keyW = fmax(view.keyW, key.width)
      valueW = fmax(valueW, value.width)
      view.h += fmax(value.height, jsRound(small * 1.5)) + ROW_PAD
      view.rows.push([key, value])
    }
    // The root of an empty object has a value and no key, and then there is no key column.
    if (view.keyW > 0) view.keyW += 2 * CELL_PAD
    view.headH = fmax(view.label.height, jsRound(fontSize * 1.5)) + ROW_PAD
    view.w = fmax(
      fmax(view.label.width + 2 * CELL_PAD, view.rows.length === 0 ? 0 : view.keyW + valueW + 2 * CELL_PAD),
      72,
    )
    view.h += view.headH
    return view
  }
  if (node.shape.kind === 'Actor') {
    view.kind = Kind.Actor
    view.label = text(node.label, markdown, fontSize, 140, base)
    view.w = fmax(fmax(FIGURE_W, view.label.width), view.stereotype.width)
    view.h = FIGURE_H + FIGURE_GAP + view.stereotype.height + view.label.height
    return view
  }
  const note = node.shape.kind === 'Note'
  view.label = text(node.label, markdown, note ? small : fontSize, 180, base)
  const tw = fmax(view.label.width, view.stereotype.width)
  const th = view.label.height + view.stereotype.height
  switch (node.shape.kind) {
    case 'Ellipse':
    case 'Business':
      view.kind = Kind.Ellipse
      // An oval needs more room around its text than a box, and a business oval room for its
      // slash.
      view.w = fmax(tw + 2 * node.padding + (node.business ? 16 : 4), 88)
      view.h = fmax(th + 28, 48)
      break
    case 'Note':
      view.w = tw + 2 * node.padding + 6
      view.h = th + 18
      break
    default:
      view.w = fmax(tw + 2 * node.padding + 12, 80)
      view.h = fmax(th + 24, 44)
  }
  return view
}

/** `turned` draws a diagram that runs across as one that runs down. */
function draw(model: UsecaseModel, config: Value, options: RenderOptions, turned: boolean): Rendered {
  const graph = buildUsecaseGraph(model)
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.875)
  const tiny = jsRound(size * 0.8125)
  const pad = options.padding ?? 8
  const rootDir = turned ? Dir.Tb : direction(model.direction)
  const sideways = rootDir === Dir.Lr || rootDir === Dir.Rl

  // Ids by node, the last node of an id winning, as a `Map` set in order keeps it.
  const index = new Map<string, number>()
  for (let i = 0; i < graph.nodes.length; i++) index.set((graph.nodes[i] as GraphNode).id, i)

  const views: View[] = []
  const cnodes: CNode[] = []
  for (const node of graph.nodes) {
    const view = measure(node, size, small, tiny)
    let c: CNode
    if (view.kind === Kind.Boundary) {
      const titleH = view.label.height
      c = cnode(0, 0, -1)
      c.isGroup = true
      c.padX = GROUP_PAD
      c.padBottom = GROUP_PAD
      c.padTop = node.package ? titleH + 2 * TAB_PAD + 16 : titleH > 0 ? titleH + 16 : GROUP_PAD
      c.minW = view.label.width + 2 * GROUP_PAD
    } else {
      c = cnode(view.w, view.h, -1)
    }
    c.seq = views.length
    views.push(view)
    cnodes.push(c)
  }
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i] as GraphNode
    const c = cnodes[i] as CNode
    const at = node.parentId === undefined ? undefined : index.get(node.parentId)
    c.parent = at ?? -1
  }

  const cedges: CEdge[] = []
  const edgeLabels: Label[] = []
  const drawn: GraphEdge[] = []
  for (const edge of graph.edges) {
    const src = index.get(edge.start)
    const dst = index.get(edge.end)
    if (src === undefined || dst === undefined) continue
    const semantic = edge.relationshipType === 'include' || edge.relationshipType === 'extend'
    let label: Label
    if (edge.label !== undefined && semantic) {
      label = text(guillemets(edge.label[0]), edge.label[1], small, 200, 0)
    } else if (edge.label !== undefined) {
      label = text(edge.label[0], edge.label[1], small, 200, 0)
    } else {
      label = text(undefined, false, small, 200, 0)
    }
    if (src === dst) {
      // A self-relationship loops out across the flow, and the node's box grows to hold it.
      const c = cnodes[src]
      if (c !== undefined) {
        if (sideways) {
          c.h += 2 * (LOOP + (label.height > 0 ? label.height + 8 : 0))
        } else {
          c.w += 2 * (LOOP + (label.width > 0 ? label.width + 12 : 0))
        }
      }
    }
    cedges.push({
      dst,
      labelH: label.height > 0 ? label.height + 4 : 0,
      labelW: label.width > 0 ? label.width + 12 : 0,
      labelX: 0,
      labelY: 0,
      minlen: edge.minlen,
      route: [],
      src,
    })
    drawn.push(edge)
    edgeLabels.push(label)
  }

  const layoutOptions: LayeredOptions = {
    apart: false,
    edgeSep: EDGE_SEP,
    headRoom: 0,
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    portSep: 20,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    straight: false,
    tracks: false,
  }
  const layout = compoundLayout(cnodes, cedges, rootDir, layoutOptions)

  const title = layoutLabel(model.title, false, size, 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const inner = fmax(layout.width, title.width)
  const ox = pad + (inner - layout.width) / 2
  const oy = pad + titleHeight
  shiftLayout(cnodes, cedges, ox, oy)
  const width = Math.ceil(inner + 2 * pad)
  const height = Math.ceil(layout.height + titleHeight + 2 * pad)

  // Where edges cross each boundary's top border, so that a title can keep out of their way.
  const crossings: Crossings = new Map()
  for (const e of cedges) markCrossings(crossings, e.route)
  attachEnds(cedges, cnodes, views)

  const stereotypeAttrs = ` class="ondine-stereotype" font-size="${numberText(tiny)}" fill="var(--_m)"`
  const smallText = numberText(small)
  let clusters = ''
  let nodesOut = ''
  const count = Math.min(views.length, cnodes.length, graph.nodes.length)
  for (let i = 0; i < count; i++) {
    const view = views[i] as View
    const c = cnodes[i] as CNode
    const node = graph.nodes[i] as GraphNode
    const classes = classNames(withoutDefault(node.cssClasses))
    const id = escText(node.id)
    const textAttrs = view.style.text
    const shape = view.style.shape
    const w = view.w
    const h = view.h

    if (view.kind === Kind.Boundary) {
      const x = c.x - c.w / 2
      const y = c.y - c.h / 2
      const boxed = ` fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${shape}`
      const titleAttrs = ` class="ondine-cluster-label" fill="var(--_m)"${textAttrs}`
      let body = ''
      if (node.package) {
        const tabW = fmin(view.label.width + 2 * TAB_PAD + 8, c.w)
        const tabH = view.label.height + 2 * TAB_PAD
        body += `<rect class="ondine-boundary-tab" x="${num(x)}" y="${num(y)}" width="${num(tabW)}" height="${num(tabH)}"${boxed}/>`
        body += `<rect x="${num(x)}" y="${num(y + tabH)}" width="${num(c.w)}" height="${num(c.h - tabH)}"${boxed}/>`
        body += labelSvg(view.label, x + tabW / 2, y + tabH / 2, titleAttrs, undefined)
      } else {
        body += `<rect x="${num(x)}" y="${num(y)}" width="${num(c.w)}" height="${num(c.h)}"${ROUNDED}${boxed}/>`
        body += labelSvg(
          view.label,
          titleX(c, view.label.width, crossings),
          y + 8 + view.label.height / 2,
          titleAttrs,
          undefined,
        )
      }
      clusters += `<g class="ondine-cluster ondine-boundary${classes}" data-id="${id}">${body}</g>`
      continue
    }

    let body = ''
    let kind: string
    if (view.kind === Kind.Actor) {
      const top = -h / 2
      const stereotypeY = top + FIGURE_H + FIGURE_GAP + view.stereotype.height / 2
      body += `<g class="ondine-actor-figure" transform="translate(0,${num(top + FIGURE_H / 2)})">`
      body += figure(view, node)
      body += '</g>'
      body += labelSvg(view.stereotype, 0, stereotypeY, stereotypeAttrs, undefined)
      body += labelSvg(view.label, 0, h / 2 - view.label.height / 2, ` class="ondine-label"${textAttrs}`, undefined)
      kind = 'ondine-actor'
    } else if (view.kind === Kind.Json) {
      const x0 = -w / 2
      let y = -h / 2 + view.headH
      let cells = ''
      let lines = `M${point(x0, y)}H${num(x0 + w)}`
      if (view.keyW > 0) lines += `M${point(x0 + view.keyW, y)}V${num(h / 2)}`
      const valueAttrs = ` class="ondine-json-value"${textAttrs}`
      for (const [key, value] of view.rows) {
        const rowH = fmax(value.height, jsRound(small * 1.5)) + ROW_PAD
        cells += labelSvg(
          key,
          x0 + CELL_PAD + key.width / 2,
          y + rowH / 2,
          ' class="ondine-json-key" fill="var(--_m)"',
          undefined,
        )
        cells += leftLabel(value, x0 + view.keyW + CELL_PAD, y + rowH / 2, valueAttrs)
        y += rowH
      }
      body += `<rect x="${num(x0)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}"${ROUNDED}${SHAPE_ATTRS}${shape}/>`
      body += `<path class="ondine-json-lines" d="${lines}" fill="none" stroke="var(--_b)"${view.style.line}/>`
      body += labelSvg(
        view.label,
        0,
        -h / 2 + view.headH / 2,
        ` class="ondine-label" font-weight="var(--_hw)"${textAttrs}`,
        undefined,
      )
      body += `<g font-size="${smallText}">${cells}</g>`
      kind = 'ondine-json'
    } else {
      const labelY = view.stereotype.height / 2
      const note = node.shape.kind === 'Note'
      if (view.kind === Kind.Ellipse) {
        body += `<ellipse rx="${num(w / 2)}" ry="${num(h / 2)}"${SHAPE_ATTRS}${shape}/>`
        if (node.business) {
          // The slash of a business use case, cutting off the right end of the oval beside the
          // text.
          const from = w / 2 - 15
          const to = w / 2 - 5
          const arc = (at: number): number => (h / 2) * Math.sqrt(1 - powi(at / (w / 2), 2))
          body += `<path class="ondine-business" d="M${point(from, arc(from))}L${point(to, -arc(to))}" fill="none" stroke="var(--_b)"${view.style.line}/>`
        }
        kind = 'ondine-usecase'
      } else if (note) {
        const r = w / 2
        const b = h / 2
        body += `<path d="M${point(-r, -b)}H${num(r - FOLD)}L${point(r, FOLD - b)}V${num(b)}H${num(-r)}Z" fill="var(--_a)" stroke="var(--_b)" stroke-linejoin="round"${shape}/>`
        body += `<path d="M${point(r - FOLD, -b)}V${num(FOLD - b)}H${num(r)}" fill="none" stroke="var(--_b)" stroke-linejoin="round"${view.style.line}/>`
        kind = 'ondine-note'
      } else {
        body += `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}"${ROUNDED}${SHAPE_ATTRS}${shape}/>`
        kind = 'ondine-usecase'
      }
      body += labelSvg(view.stereotype, 0, -view.label.height / 2, stereotypeAttrs, undefined)
      let attrs = ' class="ondine-label"'
      if (note) attrs += ` font-size="${smallText}"`
      attrs += textAttrs
      body += labelSvg(view.label, 0, labelY, attrs, undefined)
    }
    nodesOut += `<g class="ondine-node ${kind}${classes}" data-id="${id}" transform="translate(${point(c.x, c.y)})">${body}</g>`
  }

  let edgesOut = ''
  let labelsOut = ''
  const loopSeen: [number, number][] = []
  const edgeCount = Math.min(cedges.length, drawn.length, edgeLabels.length)
  for (let i = 0; i < edgeCount; i++) {
    const ce = cedges[i] as CEdge
    const edge = drawn[i] as GraphEdge
    const label = edgeLabels[i] as Label
    const style =
      edge.style.length === 0 && edge.cssCompiledStyles.length === 0
        ? undefined
        : resolveStyle([...edge.cssCompiledStyles, ...edge.style])
    const startType = edge.arrowStart
    const endType = edge.arrowEnd
    let path: EdgePath
    if (ce.src === ce.dst) {
      const c = cnodes[ce.src]
      const view = views[ce.src]
      if (c === undefined || view === undefined) continue
      let k: number
      const seen = loopSeen.find(([node]) => node === ce.src)
      if (seen !== undefined) {
        seen[1] += 1
        k = seen[1] - 1
      } else {
        loopSeen.push([ce.src, 1])
        k = 0
      }
      const side = sideways ? 2 : 1
      const spread = fmin(sideLength(view, side) / 2, 8 + k * 6)
      const reach = LOOP + k * 8
      const [ax, ay] = anchor(view, c, side, -spread)
      const [bx, by] = anchor(view, c, side, spread)
      const hypot = Math.hypot(reach, spread)
      const len = hypot === 0 || Number.isNaN(hypot) ? 1 : hypot
      const ux = sideways ? spread / len : reach / len
      const uy = sideways ? reach / len : spread / len
      const st = trim(startType)
      const et = trim(endType)
      // Both ends leave the node leaning away from each other, and the curve joins them outside
      // it.
      const out = (x: number, y: number, sign: number, far: number): string => {
        const lean = sign * spread * (far === 0 ? 0 : 1)
        return sideways ? point(x + lean, y + far) : point(x + far, y + lean)
      }
      const sx = sideways ? ax - ux * st : ax + ux * st
      const sy = sideways ? ay + uy * st : ay - uy * st
      const ex = bx + ux * et
      const ey = by + uy * et
      const d = `M${point(sx, sy)}C${out(ax, ay, -1, reach)} ${out(bx, by, 1, reach)} ${point(ex, ey)}`
      if (sideways) {
        ce.labelX = c.x
        ce.labelY = fmax(ay, by) + reach * 0.75 + 6 + label.height / 2
      } else {
        ce.labelX = fmax(ax, bx) + reach * 0.75 + 8 + label.width / 2
        ce.labelY = c.y
      }
      path = {
        d,
        edx: -ux,
        edy: -uy,
        ex: bx,
        ey: by,
        sdx: sideways ? ux : -ux,
        sdy: sideways ? -uy : uy,
        sx: ax,
        sy: ay,
      }
    } else {
      if (ce.route.length < 6) continue
      path = routePath(ce.route, undefined, trim(startType), trim(endType), undefined, undefined)
    }
    const stroke = style?.stroke
    const color = stroke !== undefined && stroke !== '' ? esc(stroke) : 'var(--_l)'
    // Mermaid animates these dashes. A still picture keeps the dashes.
    const dashes = edge.internal ? '2 3' : edge.dotted ? '5 4' : edge.animate ? '9 5' : ''
    edgesOut += `<g class="ondine-edge ondine-${edge.relationshipType}${classNames(edgeClasses(edge.classes))}" data-id="${escText(edge.id)}"`
    if (style !== undefined) edgesOut += style.line
    edgesOut += `><path d="${path.d}"`
    if (dashes !== '') edgesOut += ` stroke-dasharray="${dashes}"`
    edgesOut += '/>'
    edgesOut += mark(startType, path.sx, path.sy, path.sdx, path.sdy, color)
    edgesOut += mark(endType, path.ex, path.ey, path.edx, path.edy, color)
    edgesOut += '</g>'
    if (label.width > 0) {
      const semantic = edge.relationshipType === 'include' || edge.relationshipType === 'extend'
      let attrs = ''
      if (semantic) attrs += ' fill="var(--_m)"'
      if (style !== undefined) attrs += style.text
      labelsOut += edgeLabelSvg(edge.id, label, ce.labelX, ce.labelY, attrs, undefined)
    }
  }

  let content = labelSvg(
    title,
    width / 2,
    pad + title.height / 2,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  if (clusters !== '') content += `<g class="ondine-clusters">${clusters}</g>`
  if (edgesOut !== '') {
    content += `<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>`
  }
  if (labelsOut !== '') {
    content += `<g class="ondine-edge-labels" font-size="${numberText(small)}">${labelsOut}</g>`
  }
  content += `<g class="ondine-nodes">${nodesOut}</g>`

  const accessible: Accessible = { accDescr: model.accDescr, accTitle: model.accTitle }
  const svg = svgDocument('usecase', width, height, size, options, accessible, content)
  return { height, links: [], svg, width }
}

/** `i64::MAX as f64` and `i64::MIN as f64`, where an `as i64` cast saturates. */
const I64_LIMIT = 9223372036854775808

/** `js_round(y) as i64`, a crossings key. */
function crossingKey(y: number): number {
  const rounded = jsRound(y)
  if (Number.isNaN(rounded)) return 0
  if (rounded >= I64_LIMIT) return I64_LIMIT
  if (rounded <= -I64_LIMIT) return -I64_LIMIT
  return Math.trunc(rounded) || 0
}

/**
 * A boundary's title sits in the middle of its top edge. Where edges enter through that edge it
 * moves into the stretch between them that is nearest the middle, or the widest if none has
 * room.
 */
function titleX(c: CNode, width: number, crossings: Crossings): number {
  const xs = crossings.get(crossingKey(c.y - c.h / 2))
  if (xs === undefined || width === 0) return c.x
  const left = c.x - c.w / 2 + 6
  const right = c.x + c.w / 2 - 6
  const cuts = xs.filter((x) => x > left && x < right)
  cuts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  cuts.push(right)
  const need = width / 2 + 6
  let best = c.x
  let bestOff = Number.POSITIVE_INFINITY
  let widest = 0
  let from = left
  for (const cut of cuts) {
    if (cut - from >= 2 * need) {
      const x = fmin(fmax(c.x, from + need), cut - need)
      if (Math.abs(x - c.x) < bestOff) {
        bestOff = Math.abs(x - c.x)
        best = x
      }
    } else if (bestOff === Number.POSITIVE_INFINITY && cut - from > widest) {
      widest = cut - from
      best = (from + cut) / 2
    }
    from = cut
  }
  return best
}

/** Writes a label with each line starting at `x`, centered on `cy`. */
function leftLabel(label: Label, x: number, cy: number, attrs: string): string {
  if (label.lines.length < 2) return labelSvg(label, x + label.width / 2, cy, attrs, undefined)
  let out = ''
  const n = Math.min(label.lines.length, label.widths.length)
  for (let i = 0; i < n; i++) {
    const width = label.widths[i] as number
    const one: Label = {
      height: label.lineHeight,
      lineHeight: label.lineHeight,
      lines: [label.lines[i] as Label['lines'][number]],
      size: label.size,
      width: label.width,
      widths: [width],
    }
    out += labelSvg(one, x + width / 2, cy - label.height / 2 + (i + 0.5) * label.lineHeight, attrs, undefined)
  }
  return out
}
