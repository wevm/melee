/**
 * @module Draws a requirement diagram: boxes with a stereotype, a name, and field rows, joined by
 * relationship edges. Port of Pele's `src/diagrams/requirement/render.ts`.
 */
import type { RequirementDb } from './db.ts'
import { type GraphEdge, buildRequirementGraph } from './graph.ts'
import type { Rendered } from '../../diagrams.ts'
import { runsAcross, turnToFit } from '../common/fit_width.ts'
import { type CEdge, type CNode, Dir, cnode, compoundLayout, direction } from '../../layout/compound.ts'
import { esc, escText, jsRound, labelSvg, pushNum, sharedStyle, spanStyle, textStyle } from '../../svg/builder.ts'
import { type EdgePath, edgeLabelSvg, routePath } from '../../svg/edges.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { ROUNDED, type ResolvedStyle, classNames, resolveStyle } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { type Buf, buf, clamp, fmax, fmin, partialCmp } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'

const NODE_SEP = 40.0
const EDGE_SEP = 16.0
const RANK_SEP = 56.0
const PAD_X = 14.0
const PAD_Y = 10.0
const ROW_GAP = 2.0
const COLUMN_GAP = 12.0
const MIN_WIDTH = 120.0
const NAME_WRAP = 280.0
const VALUE_WRAP = 240.0
const LOOP = 26.0
const CONTAINS_RADIUS = 6.0
const ARROW_LENGTH = 9.0
const ARROW_HALF = 4.5
const END_STEP = 28.0
const END_MARGIN = 14.0

/** A field row: its key and value labels. */
type Row = {
  height: number
  key: Label
  value: Label
}

/** A node's measured parts. */
type NodeView = {
  h: number
  headHeight: number
  keyWidth: number
  kind: Label
  name: Label
  rows: Row[]
  style: ResolvedStyle
  w: number
}

/**
 * Adds bold or italic to a whole label after its markdown is read, since emphasis markers only
 * toggle styles the label does not start with.
 */
function restyle(label: Label, bits: number): Label {
  if (bits === 0 || label.lines.length === 0) return label
  let width = 0
  const widths: number[] = []
  for (const line of label.lines) {
    let total = 0
    for (const span of line) {
      span.style |= bits
      if (span.icon === undefined) span.width = measure.width(span.text, label.size, span.style)
      total += span.width
    }
    widths.push(total)
    if (total > width) width = total
  }
  label.widths = widths
  label.width = width
  return label
}

/** Writes a measured label with its lines starting at `x`, the first line's box starting at `top`. */
function startText(label: Label, x: number, top: number, attrs: string): string {
  let y = top + label.lineHeight / 2 + label.size * 0.35
  const shared = sharedStyle(label)
  const body = buf()
  for (const line of label.lines) {
    let first = true
    for (const span of line) {
      if (span.icon !== undefined || span.text === '') continue
      body.s += '<tspan'
      if (first) {
        body.s += ' x="'
        pushNum(body, x)
        body.s += '" y="'
        pushNum(body, y)
        body.s += '"'
      }
      body.s += spanStyle(span.style & ~shared)
      body.s += '>'
      body.s += esc(span.text)
      body.s += '</tspan>'
      first = false
    }
    y += label.lineHeight
  }
  if (body.s === '') return body.s
  return `<text${textStyle(attrs, shared)} text-anchor="start" xml:space="preserve">${body.s}</text>`
}

/** Appends `x,y`. */
function pushPoint(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

/**
 * The containment mark: a circled plus whose rim touches (x, y), where (dx, dy) points at the
 * node.
 */
function containsMarker(x: number, y: number, dx: number, dy: number): string {
  const r = CONTAINS_RADIUS
  const cx = x - dx * r
  const cy = y - dy * r
  const out = buf('<circle class="ondine-marker" cx="')
  pushNum(out, cx)
  out.s += '" cy="'
  pushNum(out, cy)
  out.s += '" r="'
  pushNumber(out, r)
  out.s += '"/><path class="ondine-marker" d="M'
  pushPoint(out, cx - dx * r, cy - dy * r)
  out.s += 'L'
  pushPoint(out, cx + dx * r, cy + dy * r)
  out.s += 'M'
  pushPoint(out, cx + dy * r, cy - dx * r)
  out.s += 'L'
  pushPoint(out, cx - dy * r, cy + dx * r)
  out.s += '"/>'
  return out.s
}

/** An open arrowhead with its tip at (x, y), pointing along (dx, dy). */
function arrowMarker(x: number, y: number, dx: number, dy: number): string {
  const bx = x - dx * ARROW_LENGTH
  const by = y - dy * ARROW_LENGTH
  const out = buf('<path class="ondine-marker" d="M')
  pushPoint(out, bx - dy * ARROW_HALF, by + dx * ARROW_HALF)
  out.s += 'L'
  pushPoint(out, x, y)
  out.s += 'L'
  pushPoint(out, bx + dy * ARROW_HALF, by - dx * ARROW_HALF)
  out.s += '" stroke-linejoin="round"/>'
  return out.s
}

/**
 * One end of an edge on a side of a node: the edge, the index of its point in the route, and
 * where the edge heads from there.
 */
type End = {
  at: number
  edge: number
  toward: number
}

/** The ends on one side of a node, keyed by `node * 4 + side`. */
type Side = {
  key: number
  list: End[]
}

/** Files the end of edge `e` at route point `at` under the side of `node` it reaches. */
function addEnd(
  cnodes: CNode[],
  sides: Side[],
  sideAt: Map<number, number>,
  route: number[],
  e: number,
  at: number,
  node: number,
): void {
  const c = cnodes[node]
  if (c === undefined) return
  const dx = (route[at] ?? 0) - c.x
  const dy = (route[at + 1] ?? 0) - c.y
  const next = at === 0 ? 3 : at - 3
  let side: number
  if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) side = dy < 0 ? 0 : 2
  else if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) side = dx < 0 ? 3 : 1
  else return
  const key = node * 4 + side
  const end: End = { at, edge: e, toward: route[side % 2 === 0 ? next : next + 1] ?? 0 }
  const k = sideAt.get(key)
  if (k !== undefined) {
    ;(sides[k] as Side).list.push(end)
  } else {
    sideAt.set(key, sides.length)
    sides.push({ key, list: [end] })
  }
}

/** Orders ends by where they head. */
function byToward(a: End, b: End): number {
  return partialCmp(a.toward - b.toward, 0)
}

/**
 * The layout attaches every edge to the middle of a node's side. Ends that share a side are
 * spread along it, in the order of where they head, so their markers do not sit on each other.
 */
function spreadEnds(cnodes: CNode[], cedges: CEdge[], views: NodeView[]): void {
  // Sides in order of first use, as a `Map` iterates them.
  const sides: Side[] = []
  const sideAt = new Map<number, number>()
  for (let e = 0; e < cedges.length; e++) {
    const edge = cedges[e] as CEdge
    const route = edge.route
    if (edge.src === edge.dst || route.length < 6) continue
    addEnd(cnodes, sides, sideAt, route, e, 0, edge.src)
    addEnd(cnodes, sides, sideAt, route, e, route.length - 3, edge.dst)
  }

  for (let si = 0; si < sides.length; si++) {
    const sideEntry = sides[si] as Side
    const key = sideEntry.key
    const list = sideEntry.list
    if (list.length < 2) continue
    const node = key >> 2
    const vertical = key % 2 === 1
    const view = views[node]
    if (view === undefined) continue
    const span = (vertical ? view.h : view.w) - 2 * END_MARGIN
    const step = clamp(span / (list.length - 1), 0, END_STEP)
    list.sort(byToward)
    const count = list.length
    const c = cnodes[node]
    if (c === undefined) continue
    for (let j = 0; j < list.length; j++) {
      const end = list[j] as End
      const offset = (j - (count - 1) / 2) * step
      const route = cedges[end.edge]?.route
      if (route === undefined) continue
      if (vertical) {
        if (end.at + 1 < route.length) route[end.at + 1] = c.y + offset
      } else if (end.at < route.length) {
        route[end.at] = c.x + offset
      }
    }
  }
}

/** Draws `model`, turned to run down when it runs across and does not fit the host's width. */
export function render(model: RequirementDb, options: RenderOptions): Rendered {
  if (!runsAcross(model.direction)) return draw(model, options, false)
  return turnToFit(options, (down) => draw(model, options, down))
}

/**
 * `class` without a leading `default` and one whitespace character after it, as `/^default\s?/`
 * removes them.
 */
function withoutDefault(classes: string): string {
  if (!classes.startsWith('default')) return classes
  const rest = classes.slice(7)
  const c = rest.codePointAt(0)
  if (c !== undefined && isSpace(c)) return rest.slice(c > 0xffff ? 2 : 1)
  return rest
}

/** Adds a field row unless its text is empty. */
function addRow(rows: Row[], label: string, text: string, bodySize: number, base: number): void {
  if (text === '') return
  const key = restyle(layoutLabel(label, false, bodySize, 4000, 0, undefined), base)
  const value = restyle(layoutLabel(text, true, bodySize, VALUE_WRAP, 0, undefined), base)
  rows.push({ height: fmax(key.height, value.height), key, value })
}

/**
 * A point of a self-loop in the node's local frame: `out` points away from the node, `along`
 * runs along its side.
 */
function loopPoint(d: Buf, sideways: boolean, cx: number, cy: number, view: NodeView, out: number, along: number): void {
  if (sideways) pushPoint(d, cx + along, cy + view.h / 2 + out)
  else pushPoint(d, cx + view.w / 2 + out, cy + along)
}

/** Wraps text in guillemets, as a stereotype. */
function stereotype(text: string): string {
  return `«${text}»`
}

/** `turned` draws a diagram that runs across as one that runs down. */
function draw(model: RequirementDb, options: RenderOptions, turned: boolean): Rendered {
  const graph = buildRequirementGraph(model)
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8

  const index = new Map<string, number>()
  const views: NodeView[] = []
  const cnodes: CNode[] = []
  for (const node of graph.nodes) {
    const style = resolveStyle(node.cssStyles)
    const base = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
    const nameSize = style.fontSize ?? size
    const bodySize = style.fontSize ?? small
    const kindText = stereotype(node.requirement?.type ?? 'Element')
    const kind = restyle(layoutLabel(kindText, false, bodySize, 4000, 0, undefined), base)
    const name = restyle(layoutLabel(node.id, true, nameSize, NAME_WRAP, 0, undefined), base | BOLD)
    const rows: Row[] = []
    if (node.requirement !== undefined) {
      const r = node.requirement
      addRow(rows, 'ID', r.requirementId, bodySize, base)
      addRow(rows, 'Text', r.text, bodySize, base)
      addRow(rows, 'Risk', r.risk, bodySize, base)
      addRow(rows, 'Verification', r.verifyMethod, bodySize, base)
    } else if (node.element !== undefined) {
      const e = node.element
      addRow(rows, 'Type', e.type, bodySize, base)
      addRow(rows, 'Doc Ref', e.docRef, bodySize, base)
    }
    let keyWidth = 0
    let valueWidth = 0
    let bodyHeight = 0
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] as Row
      keyWidth = fmax(keyWidth, row.key.width)
      valueWidth = fmax(valueWidth, row.value.width)
      bodyHeight += row.height + ROW_GAP
    }
    if (rows.length > 0) bodyHeight += 2 * PAD_Y - ROW_GAP
    const headHeight = 2 * PAD_Y + kind.height + name.height
    const w = fmax(
      fmax(MIN_WIDTH, fmax(kind.width, name.width) + 2 * PAD_X),
      rows.length === 0 ? 0 : keyWidth + COLUMN_GAP + valueWidth + 2 * PAD_X,
    )
    // A requirement and an element may share a name; relationships then go to the requirement.
    if (!index.has(node.id)) index.set(node.id, views.length)
    const c = cnode(w, headHeight + bodyHeight, -1)
    c.seq = views.length
    views.push({ h: headHeight + bodyHeight, headHeight, keyWidth, kind, name, rows, style, w })
    cnodes.push(c)
  }

  const rootDir = turned ? Dir.Tb : direction(graph.direction)
  const sideways = rootDir === Dir.Lr || rootDir === Dir.Rl
  const cedges: CEdge[] = []
  const edgeLabels: Label[] = []
  const drawn: GraphEdge[] = []
  for (const edge of graph.edges) {
    const src = edge.start === undefined ? undefined : index.get(edge.start)
    const dst = edge.end === undefined ? undefined : index.get(edge.end)
    if (src === undefined || dst === undefined) continue
    const label = layoutLabel(stereotype(edge.type), false, small, 4000, 0, undefined)
    const c = src === dst ? cnodes[src] : undefined
    if (c !== undefined) {
      // A self-loop sits beside the node, across the flow, and the node's box grows to hold it.
      if (sideways) c.h += 2 * (LOOP + label.height + 8)
      else c.w += 2 * (LOOP + label.width + 12)
    }
    cedges.push({
      dst,
      labelH: label.height + 4,
      labelW: label.width + 12,
      labelX: 0,
      labelY: 0,
      minlen: 1,
      route: [],
      src,
    })
    drawn.push(edge)
    edgeLabels.push(label)
  }

  const layout = compoundLayout(cnodes, cedges, rootDir, {
    apart: false,
    edgeSep: EDGE_SEP,
    headRoom: 0,
    nodeSep: NODE_SEP,
    portSep: 20,
    rankSep: RANK_SEP,
    straight: false,
    tracks: false,
  })

  spreadEnds(cnodes, cedges, views)

  const title = layoutLabel(model.title, false, size, 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const inner = fmax(layout.width, title.width)
  const ox = pad + (inner - layout.width) / 2
  const oy = pad + titleHeight
  const width = Math.ceil(inner + 2 * pad)
  const height = Math.ceil(layout.height + titleHeight + 2 * pad)

  const nodesOut = buf()
  for (let i = 0; i < views.length; i++) {
    const view = views[i] as NodeView
    const node = graph.nodes[i]
    const c = cnodes[i]
    if (node === undefined || c === undefined) continue
    const w = view.w
    const h = view.h
    const style = view.style
    const left = -w / 2
    const top = -h / 2

    const body = buf('<rect x="')
    pushNum(body, left)
    body.s += '" y="'
    pushNum(body, top)
    body.s += '" width="'
    pushNum(body, w)
    body.s += '" height="'
    pushNum(body, h)
    body.s += '"'
    body.s += ROUNDED
    body.s += ' fill="var(--_s)" stroke="var(--_b)"'
    body.s += style.shape
    body.s += '/>'

    let attrs = buf(' class="ondine-stereotype" font-size="')
    pushNumber(attrs, view.kind.size)
    attrs.s += '" fill="var(--_m)"'
    attrs.s += style.text
    body.s += labelSvg(view.kind, 0, top + PAD_Y + view.kind.height / 2, attrs.s, undefined)
    attrs = buf(' class="ondine-label" font-size="')
    pushNumber(attrs, view.name.size)
    attrs.s += '" font-weight="var(--_hw)"'
    attrs.s += style.text
    body.s += labelSvg(view.name, 0, top + PAD_Y + view.kind.height + view.name.height / 2, attrs.s, undefined)

    const first = view.rows[0]
    if (first !== undefined) {
      const divider = top + view.headHeight
      body.s += '<path class="ondine-divider" d="M'
      pushPoint(body, left, divider)
      body.s += 'H'
      pushNum(body, -left)
      body.s += '" stroke="var(--_b)"'
      body.s += style.line
      body.s += '/>'

      const keyAttrs = ` class="ondine-field" fill="var(--_m)"${style.text}`
      const valueAttrs = ` class="ondine-value"${style.text}`
      let y = divider + PAD_Y
      let rows = ''
      for (const row of view.rows) {
        rows += startText(row.key, left + PAD_X, y, keyAttrs)
        rows += startText(row.value, left + PAD_X + view.keyWidth + COLUMN_GAP, y, valueAttrs)
        y += row.height + ROW_GAP
      }
      body.s += '<g class="ondine-fields" font-size="'
      pushNumber(body, first.key.size)
      body.s += '">'
      body.s += rows
      body.s += '</g>'
    }

    nodesOut.s += '<g class="ondine-node '
    nodesOut.s += node.requirement !== undefined ? 'ondine-requirement' : 'ondine-element'
    nodesOut.s += classNames(withoutDefault(node.cssClasses))
    nodesOut.s += '" data-id="'
    nodesOut.s += escText(node.id)
    nodesOut.s += '" transform="translate('
    pushPoint(nodesOut, c.x + ox, c.y + oy)
    nodesOut.s += ')">'
    nodesOut.s += body.s
    nodesOut.s += '</g>'
  }

  const edgesOut = buf()
  let labelsOut = ''
  const loopSeen = new Map<number, number>()
  const pairs = Math.min(cedges.length, drawn.length, edgeLabels.length)
  for (let e = 0; e < pairs; e++) {
    const ce = cedges[e] as CEdge
    const edge = drawn[e] as GraphEdge
    const label = edgeLabels[e] as Label
    const startTrim = edge.contains ? 2 * CONTAINS_RADIUS : 0
    let labelX = ce.labelX + ox
    let labelY = ce.labelY + oy
    let path: EdgePath
    if (ce.src === ce.dst) {
      const view = views[ce.src]
      const c = cnodes[ce.src]
      if (view === undefined || c === undefined) continue
      const cx = c.x + ox
      const cy = c.y + oy
      const k = loopSeen.get(ce.src) ?? 0
      loopSeen.set(ce.src, k + 1)
      const half = (sideways ? view.w : view.h) / 2
      const spread = fmin(half - 4, 12 + k * 6)
      const reach = LOOP + k * 8
      // Local frame: `out` points away from the node, `along` runs along its side.
      // A cubic whose control points are this far out peaks at `reach`.
      const pull = reach / 0.75
      const d = buf('M')
      loopPoint(d, sideways, cx, cy, view, startTrim, -spread)
      d.s += 'C'
      loopPoint(d, sideways, cx, cy, view, pull, -spread)
      d.s += ' '
      loopPoint(d, sideways, cx, cy, view, pull, spread)
      d.s += ' '
      loopPoint(d, sideways, cx, cy, view, 0, spread)
      if (sideways) {
        labelX = cx
        labelY = cy + view.h / 2 + reach + 4 + ce.labelH / 2
      } else {
        labelX = cx + view.w / 2 + reach + 4 + ce.labelW / 2
        labelY = cy
      }
      path = {
        d: d.s,
        edx: sideways ? 0 : -1,
        edy: sideways ? -1 : 0,
        ex: sideways ? cx + spread : cx + view.w / 2,
        ey: sideways ? cy + view.h / 2 : cy + spread,
        sdx: sideways ? 0 : -1,
        sdy: sideways ? -1 : 0,
        sx: sideways ? cx - spread : cx + view.w / 2,
        sy: sideways ? cy + view.h / 2 : cy - spread,
      }
    } else {
      const route = ce.route.slice()
      for (let j = 0; j + 1 < route.length; j += 3) {
        route[j] = (route[j] as number) + ox
        route[j + 1] = (route[j + 1] as number) + oy
      }
      path = routePath(route, undefined, startTrim, 0, undefined, undefined)
    }

    edgesOut.s += '<g class="ondine-edge ondine-relationship-'
    edgesOut.s += edge.contains ? 'contains' : 'arrow'
    edgesOut.s += '" data-id="'
    edgesOut.s += escText(edge.id)
    edgesOut.s += '"><path d="'
    edgesOut.s += path.d
    edgesOut.s += '"'
    if (!edge.contains) edgesOut.s += ' stroke-dasharray="5 4"'
    edgesOut.s += '/>'
    if (edge.contains) edgesOut.s += containsMarker(path.sx, path.sy, path.sdx, path.sdy)
    else edgesOut.s += arrowMarker(path.ex, path.ey, path.edx, path.edy)
    edgesOut.s += '</g>'
    labelsOut += edgeLabelSvg(edge.id, label, labelX, labelY, '', undefined)
  }

  const content = buf(
    labelSvg(title, width / 2, pad + title.height / 2, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  )
  if (edgesOut.s !== '') {
    content.s += '<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">'
    content.s += edgesOut.s
    content.s += '</g>'
  }
  if (labelsOut !== '') {
    content.s += '<g class="ondine-edge-labels" font-size="'
    pushNumber(content, small)
    content.s += '" fill="var(--_m)">'
    content.s += labelsOut
    content.s += '</g>'
  }
  content.s += '<g class="ondine-nodes">'
  content.s += nodesOut.s
  content.s += '</g>'

  const svg = svgDocument(
    'requirement',
    width,
    height,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content.s,
  )

  return { height, links: [], svg, width }
}
