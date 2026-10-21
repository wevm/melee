/** @module Lays out and draws an agentflow. Port of Pele's `src/diagrams/agentflow/render.ts`. */
import { KIND_COUNT, kindSlot } from './color_slots.ts'
import type { AgentflowDb } from './db.ts'
import { type AgentGraph, GRAPH_EDGE_CLASSES, type GraphEdge, type GraphNode } from './graph.ts'
import { LabelType } from './types.ts'
import type { Rendered } from '../../diagrams.ts'
import { runsAcross, turnToFit } from '../common/fit_width.ts'
import { canonicalShape } from '../flowchart/shapes.ts'
import { type CEdge, type CNode, Dir, cnode, compoundLayout, direction, shiftLayout } from '../../layout/compound.ts'
import type { LayeredOptions } from '../../layout/layered.ts'
import { esc, escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { type Crossings, clusterTitleX, markCrossings } from '../../svg/cluster.ts'
import { type EdgePath, edgeLabelSvg, loopPath, marker, markerTrim, routePath } from '../../svg/edges.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { PAD_X, PAD_Y, drawShape, insetRoute, shapeSize } from '../../svg/shapes.ts'
import { RADIUS, type ResolvedStyle, classNames, resolveStyle, seriesColor } from '../../svg/theme.ts'
import * as entities from '../../text/entities.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { buf, type Buf, fmax, fmin, midpoint } from '../../util/rust.ts'
import { type LinkInfo, type UrlOptions, linkUrl, linked, relAttr, sanitizeUrl } from '../../util/url.ts'
import type { Value } from '../../yaml.ts'

/** The number of series colors, which is the palette Mermaid's slot rules are applied to. */
export const PALETTE = 8

const NODE_SEP = 40.0
const EDGE_SEP = 16.0
const RANK_SEP = 48.0
const GROUP_PAD = 20.0
const LOOP = 26.0
const DOTS = 14.0
const COLLAPSED = 'collapsed'

/** The side a flow runs toward, with sides numbered clockwise from the top. */
function flowEnd(dir: Dir): number {
  switch (dir) {
    case Dir.Tb:
      return 2
    case Dir.Rl:
      return 3
    case Dir.Bt:
      return 0
    case Dir.Lr:
      return 1
  }
}

/** The value under `key` of a YAML mapping. */
function get(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

function numberOption(config: Value, key: string, fallback: number): number {
  const section = get(config, 'agentflow')
  const value = section === undefined ? undefined : get(section, key)
  if (value !== undefined && value.kind === 'Number' && value._0 > 0) return fmin(value._0, 2000)
  return fallback
}

/**
 * A palette color as an outline with a light wash of the same color inside. A fill the author
 * set replaces the wash and stays opaque.
 */
function tint(slot: number, wash: string, style: ResolvedStyle): string {
  const color = seriesColor(slot)
  // `/[";]fill:/`.
  const filled = style.shape.includes('"fill:') || style.shape.includes(';fill:')
  const opacity = filled ? '' : ` fill-opacity="${wash}"`
  return ` fill="${color}"${opacity} stroke="${color}"`
}

/** What a node is drawn as, beside its layout box. */
type NodeView = {
  dy: number
  h: number
  label: Label
  node: GraphNode
  shape: string
  style: ResolvedStyle
  w: number
}

/** An edge between a node and a flow around it. */
type Held = {
  dst: number
  edge: GraphEdge
  label: Label
  src: number
}

/**
 * Draws an agentflow, turning one that runs across to run down when it does not fit the host's
 * width.
 */
export function render(
  db: AgentflowDb,
  graph: AgentGraph,
  config: Value,
  options: RenderOptions,
  url: UrlOptions,
): Rendered {
  if (!runsAcross(db.direction)) return draw(db, graph, config, options, url, false)
  return turnToFit(options, (down) => draw(db, graph, config, options, url, down))
}

/**
 * Removes a leading `default` class and one following whitespace character, as
 * `/^default\s?/` does.
 */
function stripDefault(classes: string): string {
  if (!classes.startsWith('default')) return classes
  const rest = classes.slice(7)
  const c = rest.codePointAt(0)
  if (c !== undefined && isSpace(c)) return rest.slice(c > 0xffff ? 2 : 1)
  return rest
}

/** Removes Mermaid's default edge classes, as Pele's global replace does. */
function stripEdgeClasses(classes: string): string {
  let out = classes
  for (const name of ['edge-thickness-normal', 'edge-pattern-solid', 'flowchart-link']) {
    for (let at = out.indexOf(name); at >= 0; at = out.indexOf(name)) {
      out = out.slice(0, at) + out.slice(at + name.length)
    }
  }
  return out
}

/** The classes of every edge, without Mermaid's defaults. */
const EDGE_CLASSES = classNames(stripEdgeClasses(GRAPH_EDGE_CLASSES))

/** `turned` draws a diagram that runs across as one that runs down. */
function draw(
  db: AgentflowDb,
  graph: AgentGraph,
  config: Value,
  options: RenderOptions,
  url: UrlOptions,
  turned: boolean,
): Rendered {
  const size = options.fontSize ?? 16.0
  const edgeSize = jsRound(size * 0.875)
  const wrapWidth = numberOption(config, 'wrappingWidth', 120.0)
  const minWidth = numberOption(config, 'minNodeWidth', 120.0)
  const pad = options.padding ?? 8.0

  const index = new Map<string, number>()
  graph.nodes.forEach((node, i) => index.set(node.id, i))

  const views: NodeView[] = []
  const cnodes: CNode[] = []
  for (const node of graph.nodes) {
    const style =
      node.cssStyles.length === 0
        ? resolveStyle(node.cssCompiledStyles)
        : resolveStyle([...node.cssCompiledStyles, ...node.cssStyles])
    const textStyle = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
    const markdown = node.labelType === LabelType.Markdown
    const fontSize = style.fontSize ?? size
    const labelOf = (width: number): Label => layoutLabel(node.label, markdown, fontSize, width, textStyle, undefined)

    let view: NodeView
    let c: CNode
    if (node.isGroup) {
      const label = labelOf(4000.0)
      c = cnode(0.0, 0.0, -1)
      c.isGroup = true
      c.dir = node.dir !== undefined && node.dir !== '' ? direction(node.dir) : undefined
      c.padX = GROUP_PAD
      c.padTop = label.height > 0 ? label.height + 16.0 : GROUP_PAD
      c.padBottom = GROUP_PAD
      c.minW = label.width + 2.0 * GROUP_PAD - 12.0
      view = { dy: 0, h: 0, label, node, shape: 'group', style, w: 0 }
    } else if (node.shape === 'collapsedGroup') {
      const label = labelOf(wrapWidth)
      const w = fmax(label.width, minWidth) + 2.0 * PAD_X
      const h = label.height + 2.0 * PAD_Y + DOTS
      view = { dy: -DOTS / 2.0, h, label, node, shape: COLLAPSED, style, w }
      c = cnode(w, h, -1)
    } else {
      const shape = canonicalShape(node.shape)
      const label = labelOf(wrapWidth)
      // A diamond grows twice as fast as its label, so it keeps the label's own width.
      const width = shape === 'diam' ? label.width : fmax(label.width, minWidth)
      const s = shapeSize(shape, width, label.height)
      view = { dy: s.dy, h: s.h, label, node, shape, style, w: s.w }
      c = cnode(s.w, s.h, -1)
    }
    c.seq = views.length
    views.push(view)
    cnodes.push(c)
  }

  graph.nodes.forEach((node, i) => {
    const p = node.parentId === undefined ? undefined : index.get(node.parentId)
    const c = cnodes[i]
    if (c !== undefined) c.parent = p === undefined ? -1 : p
  })

  const rootDir = turned ? Dir.Tb : direction(db.direction)
  const parentOf = (i: number): number | undefined => {
    const c = cnodes[i]
    return c === undefined || c.parent < 0 ? undefined : c.parent
  }
  // The direction of the level a node sits in.
  const flowOf = (i: number): Dir => {
    let dir: Dir | undefined
    let p = parentOf(i)
    let hops = 0
    while (p !== undefined) {
      if (dir !== undefined || hops >= 10_000) break
      const parent = cnodes[p]
      if (parent === undefined) break
      dir = parent.dir
      p = parent.parent < 0 ? undefined : parent.parent
      hops += 1
    }
    return dir ?? rootDir
  }
  const flowsSideways = (i: number): boolean => {
    const dir = flowOf(i)
    return dir === Dir.Lr || dir === Dir.Rl
  }

  const n = cnodes.length
  const depth: number[] = new Array<number>(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const chain: number[] = []
    let j: number | undefined = i
    while (j !== undefined) {
      const d = depth[j]
      if (d === undefined || d >= 0 || chain.length > n) break
      chain.push(j)
      j = parentOf(j)
    }
    const first = j === undefined || depth[j] === undefined ? 0 : (depth[j] as number) + 1
    for (let k = 0; k < chain.length; k++) depth[chain[chain.length - 1 - k] as number] = first + k
  }
  const contains = (group: number, i: number): boolean => {
    const from = depth[i]
    const to = depth[group]
    if (from === undefined || to === undefined) return false
    let j: number | undefined = i
    let d = from
    while (d > to) {
      j = j === undefined ? undefined : parentOf(j)
      d -= 1
    }
    return j === group && i !== group
  }

  const cedges: CEdge[] = []
  const edgeLabels: Label[] = []
  const drawn: GraphEdge[] = []
  // Edges between a node and a flow around it. The layout has no place for them, so they are
  // drawn afterwards, between the node and the flow's border.
  const held: Held[] = []
  for (const edge of graph.edges) {
    const src = index.get(edge.start)
    const dst = index.get(edge.end)
    if (src === undefined || dst === undefined) continue
    const markdown = edge.labelType === LabelType.Markdown
    const label = layoutLabel(edge.label, markdown, edgeSize, wrapWidth, 0, undefined)
    if (contains(src, dst) || contains(dst, src)) {
      held.push({ dst, edge, label, src })
      continue
    }

    if (src === dst) {
      // A self-loop sits beside the node, across the flow, and the node's box grows to hold
      // it.
      const sideways = flowsSideways(src)
      const c = cnodes[src]
      if (c !== undefined) {
        if (sideways) c.h += 2.0 * (LOOP + (label.height > 0 ? label.height + 8.0 : 0.0))
        else c.w += 2.0 * (LOOP + (label.width > 0 ? label.width + 12.0 : 0.0))
      }
    }

    cedges.push({
      dst,
      labelH: label.height > 0 ? label.height + 4.0 : 0.0,
      labelW: label.width > 0 ? label.width + 12.0 : 0.0,
      labelX: 0,
      labelY: 0,
      minlen: edge.minlen !== undefined && edge.minlen >= 0 ? edge.minlen : 1,
      route: [],
      src,
    })
    drawn.push(edge)
    edgeLabels.push(label)
  }

  const layoutOptions: LayeredOptions = {
    apart: false,
    edgeSep: EDGE_SEP,
    headRoom: 0.0,
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    portSep: 20.0,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    straight: false,
    tracks: false,
  }
  const layout = compoundLayout(cnodes, cedges, rootDir, layoutOptions)

  const title = layoutLabel(db.title, false, size, 4000.0, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12.0 : 0.0
  const inner = fmax(layout.width, title.width)
  const ox = pad + (inner - layout.width) / 2.0
  const oy = pad + titleHeight
  shiftLayout(cnodes, cedges, ox, oy)
  const width = Math.ceil(inner + 2.0 * pad)
  const height = Math.ceil(layout.height + titleHeight + 2.0 * pad)
  const links: LinkInfo[] = []

  // An edge between a node and a flow around it runs straight between the node and the flow's
  // border: out along the flow, or in against it. If another node is in the way it takes a
  // side instead, and failing that the far end.
  const heldPaths: EdgePath[] = []
  const heldLabels: [number, number][] = []
  const heldRoutes: number[][] = []
  const careful = held.length * n < 2e6
  for (const h of held) {
    const out = contains(h.dst, h.src)
    const outer = out ? h.dst : h.src
    const i = out ? h.src : h.dst
    const g = cnodes[outer]
    const nd = cnodes[i]
    const view = views[i]
    if (g === undefined || nd === undefined || view === undefined) continue
    const end = flowEnd(g.dir ?? flowOf(outer))
    const first = out ? end : (end + 2) & 3
    const toward = (side: number): number[] => {
      const upright = (side & 1) === 0
      const sign = side === 0 || side === 3 ? -1.0 : 1.0
      const nx = upright ? nd.x : nd.x + (sign * nd.w) / 2.0
      const ny = upright ? nd.y + (sign * nd.h) / 2.0 : nd.y
      const bx = upright ? nd.x : g.x + (sign * g.w) / 2.0
      const by = upright ? g.y + (sign * g.h) / 2.0 : nd.y
      const axis = upright ? 0.0 : 1.0
      return out ? [nx, ny, axis, bx, by, axis] : [bx, by, axis, nx, ny, axis]
    }
    const blocked = (r: number[]): boolean => {
      const r0 = r[0] as number
      const r1 = r[1] as number
      const r3 = r[3] as number
      const r4 = r[4] as number
      return cnodes.some(
        (c, k) =>
          k !== i &&
          !c.isGroup &&
          c.x + c.w / 2.0 > fmin(r0, r3) - 1.0 &&
          c.x - c.w / 2.0 < fmax(r0, r3) + 1.0 &&
          c.y + c.h / 2.0 > fmin(r1, r4) - 1.0 &&
          c.y - c.h / 2.0 < fmax(r1, r4) + 1.0,
      )
    }
    let route = toward(first)
    if (careful && blocked(route)) {
      for (const side of [(first + 1) & 3, (first + 3) & 3, (first + 2) & 3]) {
        const other = toward(side)
        if (!blocked(other)) {
          route = other
          break
        }
      }
    }
    heldRoutes.push(route)
    heldLabels.push([midpoint(route[0] as number, route[3] as number), midpoint(route[1] as number, route[4] as number)])
    const drawnRoute = route.slice()
    insetRoute(drawnRoute, out ? 0 : 3, view.shape, view.w, view.h, nd)
    heldPaths.push(routePath(drawnRoute, 'linear', 0.0, markerTrim(h.edge.arrowTypeEnd), undefined, undefined))
  }

  const crossings: Crossings = new Map()
  if (cnodes.some((c) => c.isGroup)) {
    for (const e of cedges) markCrossings(crossings, e.route)
    for (const route of heldRoutes) markCrossings(crossings, route)
  }

  let clusters = ''
  let nodesOut = ''
  views.forEach((view, i) => {
    const c = cnodes[i]
    if (c === undefined) return
    const node = view.node
    const classes = classNames(stripDefault(node.cssClasses))
    const id = escText(node.id)
    const slot = node.colorIndex ?? KIND_COUNT

    if (c.isGroup) {
      const titleX = clusterTitleX(c, view.label.width, crossings, GROUP_PAD)
      const titleAttrs = ' class="ondine-cluster-label" fill="var(--_m)"' + view.style.text
      const rect = `<rect x="${num(c.x - c.w / 2.0)}" y="${num(c.y - c.h / 2.0)}" width="${num(c.w)}" height="${num(c.h)}" rx="${RADIUS}"${tint(slot, '0.06', view.style)}${view.style.shape}/>`
      const title = labelSvg(view.label, titleX, c.y - c.h / 2.0 + 8.0 + view.label.height / 2.0, titleAttrs, undefined)
      clusters += `<g class="ondine-cluster ondine-flow${classes}" data-id="${id}">${rect}${title}</g>`
      return
    }

    const w = view.w
    const h = view.h
    let kind = ''
    let shape: string
    if (view.shape === COLLAPSED) {
      shape = collapsed(view, w, h, slot)
    } else {
      const name = node.kind ?? 'task'
      const kslot = kindSlot(name) ?? 1
      kind += ' ondine-kind-'
      kind += name
      const attrs = tint(kslot, '0.14', view.style) + view.style.shape
      const line = ' stroke="' + seriesColor(kslot) + '"' + view.style.line
      shape = drawShape(view.shape, w, h, attrs, line)
    }

    const labelAttrs = ' class="ondine-label"' + view.style.text
    let text = labelSvg(view.label, 0.0, view.dy, labelAttrs, undefined)

    const internal = (classes + ' ').includes(' internal-link ')
    const label = node.label
    if (label !== undefined && internal && label !== '' && url.links !== false) {
      // The label is a note name, but it still ends up in an href, so it gets the same
      // check as a URL.
      const name = entities.decode(label)
      const safe = linkUrl(sanitizeUrl(name), url) !== undefined
      const target = esc(name)
      let anchor = '<a class="internal-link"'
      if (safe) {
        anchor += ' href="'
        anchor += target
        anchor += '"'
        anchor += relAttr(url)
      }
      anchor += ' data-href="'
      anchor += target
      anchor += '">'
      anchor += text
      anchor += '</a>'
      text = anchor
      links.push({ href: name, id: node.id, internal: true })
    }

    let body = ''
    if (node.tooltip !== undefined && node.tooltip !== '') {
      body += '<title>'
      body += escText(node.tooltip)
      body += '</title>'
    }
    body += shape
    body += text
    if (node.link !== undefined && node.link !== '') {
      let attrs = ''
      if (node.linkTarget !== undefined && node.linkTarget !== '') {
        attrs += ' target="'
        attrs += esc(node.linkTarget)
        attrs += '"'
      }
      body = linked(body, node.link, node.id, links, url, attrs)
    }

    nodesOut += `<g class="ondine-node ondine-shape-${view.shape}${kind}${classes}" data-id="${id}" transform="translate(${num(c.x)},${num(c.y)})">${body}</g>`
  })

  const edgesOut = buf()
  let labelsOut = ''
  const put = (edge: GraphEdge, label: Label, path: EdgePath, x: number, y: number): void => {
    const style =
      edge.style.length === 0 && edge.cssCompiledStyles.length === 0
        ? undefined
        : resolveStyle([...edge.cssCompiledStyles, ...edge.style])
    const endType = edge.arrowTypeEnd
    const stroke = style?.stroke
    const color = stroke !== undefined && stroke !== '' ? esc(stroke) : 'var(--_l)'
    const dotted = edge.thickness === 'dotted'
    const kind = dotted ? 'reference' : endType === 'arrow_cross' ? 'failure' : 'sequence'

    const line = style === undefined ? '' : style.line
    const dash = dotted ? ' stroke-dasharray="3 4"' : ''
    const head = marker(endType, path.ex, path.ey, path.edx, path.edy, color)
    edgesOut.s += `<g class="ondine-edge ondine-edge-${kind}${EDGE_CLASSES}" data-id="${escText(edge.id)}"${line}><path d="${path.d}"${dash}/>${head}</g>`

    if (label.width > 0) {
      const attrs = style === undefined ? '' : style.text
      labelsOut += edgeLabelSvg(edge.id, label, x, y, attrs, undefined)
    }
  }

  const loopSeen: number[] = new Array<number>(views.length).fill(0)
  for (let i = 0; i < cedges.length; i++) {
    const edge = drawn[i]
    const label = edgeLabels[i]
    if (edge === undefined || label === undefined) continue
    const endType = edge.arrowTypeEnd
    const ce = cedges[i] as CEdge
    const src = ce.src
    const dst = ce.dst
    let path: EdgePath
    if (src === dst) {
      const k = loopSeen[src] ?? 0
      if (loopSeen[src] !== undefined) loopSeen[src] = k + 1
      const sideways = flowsSideways(src)
      const v = views[src]
      const vw = v === undefined ? 0 : v.w
      const vh = v === undefined ? 0 : v.h
      const c = cnodes[src] !== undefined ? { ...(cnodes[src] as CNode) } : cnode(0.0, 0.0, -1)
      path = loopPath(c, vw, vh, k, sideways, LOOP, markerTrim(endType), ce)
    } else {
      const srcNode = cnodes[src]
      const dstNode = cnodes[dst]
      const srcView = views[src]
      const dstView = views[dst]
      if (srcNode === undefined || dstNode === undefined || srcView === undefined || dstView === undefined) continue
      const route = ce.route.slice()
      const last = Math.max(0, route.length - 3)
      insetRoute(route, 0, srcView.shape, srcView.w, srcView.h, srcNode)
      insetRoute(route, last, dstView.shape, dstView.w, dstView.h, dstNode)
      const curve = edge.curve !== undefined && edge.curve.kind === 'String' ? edge.curve._0 : undefined
      path = routePath(route, curve, 0.0, markerTrim(endType), undefined, undefined)
    }
    put(edge, label, path, ce.labelX, ce.labelY)
  }
  held.forEach((h, k) => {
    const path = heldPaths[k]
    const at = heldLabels[k]
    if (path !== undefined && at !== undefined) put(h.edge, h.label, path, at[0], at[1])
  })

  const content: Buf = buf(
    labelSvg(title, width / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  )
  if (clusters !== '') {
    content.s += '<g class="ondine-clusters">'
    content.s += clusters
    content.s += '</g>'
  }
  if (edgesOut.s !== '') {
    content.s += '<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">'
    content.s += edgesOut.s
    content.s += '</g>'
  }
  if (labelsOut !== '') {
    content.s += '<g class="ondine-edge-labels" font-size="'
    pushNum(content, edgeSize)
    content.s += '">'
    content.s += labelsOut
    content.s += '</g>'
  }
  content.s += '<g class="ondine-nodes">'
  content.s += nodesOut
  content.s += '</g>'

  const accessible: Accessible = {
    accDescr: db.accDescr,
    accTitle: db.accTitle,
  }
  const svg = svgDocument('agentflow', width, height, size, options, accessible, content.s)

  return { height, links, svg, width }
}

/** A collapsed flow: its box, a dashed rule, and three dots below the title. */
function collapsed(view: NodeView, w: number, h: number, slot: number): string {
  const color = seriesColor(slot)
  const line = h / 2.0 - DOTS - 2.0
  const dots = line + midpoint(DOTS, 2.0)
  const y = num(dots)
  const rect = `<rect x="${num(-w / 2.0)}" y="${num(-h / 2.0)}" width="${num(w)}" height="${num(h)}" rx="${RADIUS}"${tint(slot, '0.06', view.style)}${view.style.shape}/>`
  const rule = `<path d="M${num(-w / 2.0 + 10.0)},${num(line)}H${num(w / 2.0 - 10.0)}" fill="none" stroke="${color}" stroke-dasharray="3 3"${view.style.line}/>`
  // Three dots, at -9, 0, and 9.
  const mark = `${dot(-9.0, y)}${dot(0.0, y)}${dot(9.0, y)}`
  return `${rect}${rule}<path class="ondine-collapsed-mark" d="${mark}" fill="${color}" stroke="none"/>`
}

/** One dot of the collapsed mark, at `x` and the written `y`. */
function dot(x: number, y: string): string {
  return `M${num(x - 1.75)},${y}a1.75,1.75 0 1 0 3.5,0a1.75,1.75 0 1 0 -3.5,0Z`
}
