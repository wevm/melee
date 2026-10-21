/**
 * @module Lays out and draws a flowchart, or a variant of one such as a swimlane diagram. Port of
 * Pele's `src/diagrams/flowchart/render.ts`.
 */
import type { FlowDb } from './db.ts'
import { type FlowGraph, type GraphEdge, type GraphNode, build } from './graph.ts'
import { canonicalShape } from './shapes.ts'
import { LabelType } from './types.ts'
import type { Rendered } from '../../diagrams.ts'
import { runsAcross, tighten, titleRoom, turnToFit } from '../common/fit_width.ts'
import {
  type CEdge,
  type CNode,
  type CompoundResult,
  Dir,
  cnode,
  compoundLayout,
  direction,
  shiftLayout,
} from '../../layout/compound.ts'
import type { LayeredOptions } from '../../layout/layered.ts'
import { esc, escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import {
  type Crossings,
  clusterTitleX,
  markCrossings,
  struckTitle,
  titleCrossed,
} from '../../svg/cluster.ts'
import {
  type EdgePath,
  edgeLabelSvg,
  loopPath,
  marker,
  markerTrim,
  routePath,
  sideReachAdd,
  sideReachDefault,
  sideReachOf,
} from '../../svg/edges.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import {
  drawShape,
  endSide,
  insetRoute,
  shapeHasLabel,
  shapeSize,
  shapeSpan,
} from '../../svg/shapes.ts'
import { RADIUS, type ResolvedStyle, classNames, resolveStyle } from '../../svg/theme.ts'
import * as entities from '../../text/entities.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { buf, fmax, fmin, saturatingSub } from '../../util/rust.ts'
import {
  type LinkInfo,
  type UrlOptions,
  imageUrl,
  linkUrl,
  linked,
  relAttr,
  safeUrl,
  sanitizeUrl,
} from '../../util/url.ts'
import type { Value } from '../../yaml.ts'

const NODE_SEP = 40
const EDGE_SEP = 16
const RANK_SEP = 48
const GROUP_PAD = 20
const LOOP = 26
const SHAPE_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"'
const LINE_ATTRS = ' stroke="var(--_b)"'

/**
 * Draws a top-level group from its box, title, style, classes, escaped id, and the diagram's
 * direction.
 */
export type DrawGroup = (
  c: CNode,
  label: Label,
  style: ResolvedStyle,
  classes: string,
  id: string,
  dir: Dir,
) => string

/**
 * A diagram type that is a flowchart with a different layout, which may draw its top-level groups
 * itself: Pele's `FlowVariant`.
 */
export type Variant = {
  /** Draws top-level groups. Groups use the flowchart's drawing without it. */
  drawGroup: DrawGroup | undefined
  /** Lays out the nodes and edges in a direction. The flag asks for tighter spacing. */
  layout: (nodes: CNode[], edges: CEdge[], dir: Dir, options: LayeredOptions, tight: boolean) => CompoundResult
  /** Adjusts the graph before it is measured. */
  prepare: (graph: FlowGraph) => void
  /** The diagram type, which names its config section and the SVG's type. */
  type: string
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

/** `n` zeros. */
function zeros(n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(0)
  return out
}

function numberOption(section: Value | undefined, key: string, fallback: number): number {
  const value = section === undefined ? undefined : get(section, key)
  if (value?.kind === 'Number' && value._0 > 0) return fmin(value._0, 2000)
  return fallback
}

function assetSize(value: number | undefined, fallback: number): number {
  if (value !== undefined && value > 0 && value <= 4000) return value
  return fallback
}

/**
 * Draws a flowchart, or the flowchart `variant`, turning one that runs across to run down, and
 * tightening its spacing, when it does not fit the host's width.
 */
export function render(
  db: FlowDb,
  config: Value,
  options: RenderOptions,
  url: UrlOptions,
  variant: Variant | undefined,
): Rendered {
  const fitted = (down: boolean): Rendered =>
    tighten(options, (tight: boolean) => draw(db, config, options, url, variant, down, tight))

  if (runsAcross(db.direction)) return turnToFit(options, fitted)
  return fitted(false)
}

/** `turned` draws a flowchart that runs across as one that runs down. `tight` sets nodes closer. */
function draw(
  db: FlowDb,
  config: Value,
  options: RenderOptions,
  url: UrlOptions,
  variant: Variant | undefined,
  turned: boolean,
  tight: boolean,
): Rendered {
  const groupPad = tight ? 12 : GROUP_PAD
  const ownValue = variant === undefined ? undefined : get(config, variant.type)
  let flow: Value | undefined
  if (ownValue?.kind === 'Object') {
    flow = ownValue
  } else {
    const flowValue = get(config, 'flowchart')
    flow = flowValue?.kind === 'Object' ? flowValue : undefined
  }
  const curveValue = flow === undefined ? undefined : get(flow, 'curve')
  const curve = curveValue?.kind === 'String' ? curveValue._0 : undefined
  const graph = build(db, curve)
  if (variant !== undefined) variant.prepare(graph)
  const size = options.fontSize ?? 16
  const edgeSize = jsRound(size * 0.875)
  const squeezed = variant !== undefined && tight
  // `fmin` with infinity, as Rust takes it when not squeezed, leaves the option as it is.
  const wrapWidth = squeezed
    ? fmin(numberOption(flow, 'wrappingWidth', 200), 100)
    : numberOption(flow, 'wrappingWidth', 200)
  const groupTitleWidth = squeezed ? fmax(80, titleRoom(options) / 2) : 4000
  const pad = options.padding ?? 8

  // Each node's place in `graph.nodes`, by id. A variant may have changed the nodes, so its
  // index is taken afresh, the last node with an id winning as in Rust's map.
  let index = graph.index
  if (variant !== undefined) {
    index = new Map()
    for (let i = 0; i < graph.nodes.length; i++) index.set((graph.nodes[i] as GraphNode).id, i)
  }

  const views: NodeView[] = []
  const cnodes: CNode[] = []

  for (const node of graph.nodes) {
    let style: ResolvedStyle
    if (node.cssStyles.length === 0) {
      style = resolveStyle(node.cssCompiledStyles)
    } else {
      const all = node.cssCompiledStyles.slice()
      all.push(...node.cssStyles)
      style = resolveStyle(all)
    }
    const textStyle = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
    const markdown = node.labelType === LabelType.Markdown
    const fontSize = style.fontSize ?? size

    let view: NodeView
    let c: CNode
    if (node.isGroup) {
      const label = layoutLabel(node.label, markdown, fontSize, groupTitleWidth, textStyle, undefined)
      c = cnode(0, 0, -1)
      c.isGroup = true
      c.dir = node.dir === undefined ? undefined : direction(node.dir)
      c.padX = groupPad
      c.padTop = label.height > 0 ? label.height + 16 : GROUP_PAD
      c.padBottom = groupPad
      c.minW = label.width + 2 * groupPad - 12
      view = { dy: 0, h: 0, label, node, shape: 'group', style, w: 0 }
    } else {
      const shape = canonicalShape(node.shape)
      const hasAsset = present(node.img) || present(node.icon)
      const text = hasAsset || shapeHasLabel(shape) ? node.label : undefined
      const label = layoutLabel(text, markdown, fontSize, wrapWidth, textStyle, undefined)

      let w: number
      let h: number
      let dy: number
      if (hasAsset) {
        const boxed = present(node.img) ? 80 : 48
        const aw = assetSize(node.assetWidth, boxed)
        const ah = assetSize(node.assetHeight, boxed)
        w = fmax(aw, label.width + 8)
        h = ah + (label.height > 0 ? label.height + 6 : 0)
        dy = label.height === 0 ? 0 : node.pos === 't' ? -ah / 2 : ah / 2
      } else {
        const s = shapeSize(shape, label.width, label.height)
        w = s.w
        h = s.h
        dy = s.dy
      }

      view = { dy, h, label, node, shape, style, w }
      c = cnode(w, h, -1)
    }

    c.seq = views.length
    views.push(view)
    cnodes.push(c)
  }

  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i] as GraphNode
    const p = node.parentId === undefined ? undefined : index.get(node.parentId)
    const parent = p ?? -1
    const c = cnodes[i]
    if (c !== undefined) c.parent = parent
  }

  const rootDir = turned ? Dir.Tb : direction(db.direction)
  const flowsSideways = (cnodes: CNode[], i: number): boolean => {
    let dir: Dir | undefined
    let p = cnodes[i]?.parent ?? -1
    let hops = 0
    while (p >= 0) {
      if (dir !== undefined || hops >= 10_000) break
      const parent = cnodes[p]
      if (parent === undefined) break
      dir = parent.dir
      p = parent.parent
      hops += 1
    }
    const resolved = dir ?? rootDir
    return resolved === Dir.Lr || resolved === Dir.Rl
  }

  // The edges on one side of a node spread along it; a picture or an icon keeps them at its middle.
  for (let i = 0; i < views.length; i++) {
    const view = views[i]
    if (view === undefined) continue
    let span: number | undefined
    if (view.node.isGroup) {
      span = Number.POSITIVE_INFINITY
    } else if (!present(view.node.img) && !present(view.node.icon)) {
      span = shapeSpan(view.shape, view.w, view.h, flowsSideways(cnodes, i))
    } else {
      span = undefined
    }
    const c = cnodes[i]
    if (span !== undefined && c !== undefined) c.span = span
  }

  const cedges: CEdge[] = []
  const edgeLabels: Label[] = []
  const drawn: GraphEdge[] = []
  const loops: number[] = zeros(views.length)

  for (const edge of graph.edges) {
    const src = index.get(edge.start)
    const dst = index.get(edge.end)
    if (src === undefined || dst === undefined) continue
    const markdown = edge.labelType === LabelType.Markdown
    const label = layoutLabel(edge.label, markdown, edgeSize, wrapWidth, 0, undefined)

    if (src === dst) {
      // A self-loop sits beside the node, across the flow, and the node's box grows to hold it.
      if (loops[src] !== undefined) loops[src] += 1
      const sideways = flowsSideways(cnodes, src)
      const c = cnodes[src]
      if (c !== undefined) {
        if (sideways) c.h += 2 * (LOOP + (label.height > 0 ? label.height + 8 : 0))
        else c.w += 2 * (LOOP + (label.width > 0 ? label.width + 12 : 0))
      }
    }

    cedges.push({
      dst,
      labelH: label.height > 0 ? label.height + 4 : 0,
      labelW: label.width > 0 ? label.width + 12 : 0,
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
    headRoom: markerTrim('arrow_point'),
    nodeSep: numberOption(flow, 'nodeSpacing', NODE_SEP) * (tight ? 0.5 : 1),
    portSep: 20,
    rankSep: numberOption(flow, 'rankSpacing', RANK_SEP) * (tight ? 0.75 : 1),
    straight: curve === 'linear',
    tracks: curve !== undefined && curve.startsWith('step'),
  }
  const layout =
    variant === undefined
      ? compoundLayout(cnodes, cedges, rootDir, layoutOptions)
      : variant.layout(cnodes, cedges, rootDir, layoutOptions, tight)

  const titleWidth = tight ? titleRoom(options) : 4000
  const title = layoutLabel(db.title, false, size, titleWidth, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const inner = fmax(layout.width, title.width)
  const ox = pad + (inner - layout.width) / 2
  const oy = pad + titleHeight
  shiftLayout(cnodes, cedges, ox, oy)
  const width = Math.ceil(inner + 2 * pad)
  const height = Math.ceil(layout.height + titleHeight + 2 * pad)
  const links: LinkInfo[] = []

  const crossings: Crossings = new Map()
  let anyGroup = false
  for (let i = 0; i < cnodes.length; i++) if ((cnodes[i] as CNode).isGroup) anyGroup = true
  if (anyGroup) {
    for (const e of cedges) markCrossings(crossings, e.route)
  }

  let clusters = ''
  const drawGroup = variant?.drawGroup
  let struckTitles = ''
  let nodesOut = ''

  for (let i = 0; i < views.length; i++) {
    const view = views[i] as NodeView
    const c = cnodes[i]
    if (c === undefined) continue
    const node = view.node
    const classes = nodeClasses(node.cssClasses)
    const id = escText(node.id)

    if (c.isGroup && c.parent < 0 && drawGroup !== undefined) {
      clusters += drawGroup(c, view.label, view.style, classes, id, rootDir)
      continue
    }

    if (c.isGroup) {
      const titleX = clusterTitleX(c, view.label.width, crossings, groupPad)
      const titleY = c.y - c.h / 2 + 8 + view.label.height / 2
      let titleAttrs = ' class="ondine-cluster-label" fill="var(--_m)"'
      titleAttrs += view.style.text
      const struck = titleCrossed(c, view.label.width, titleX, crossings)
      if (struck) {
        struckTitles += struckTitle(view.label, titleX, titleY, titleAttrs, id, cnodes, i, undefined)
      }

      clusters += `<g class="ondine-cluster${classes}" data-id="${id}"><rect x="${num(c.x - c.w / 2)}" y="${num(c.y - c.h / 2)}" width="${num(c.w)}" height="${num(c.h)}" rx="${RADIUS}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${view.style.shape}/>`
      if (!struck) clusters += labelSvg(view.label, titleX, titleY, titleAttrs, undefined)
      clusters += '</g>'
      continue
    }

    const w = view.w
    const h = view.h
    let innerSvg: string
    if (node.img !== undefined && node.img !== '') {
      innerSvg = image(node, view, node.img, url)
    } else if (node.icon !== undefined && node.icon !== '') {
      innerSvg = iconSvg(node, view, node.icon)
    } else {
      innerSvg = drawShape(view.shape, w, h, SHAPE_ATTRS + view.style.shape, LINE_ATTRS + view.style.line)
    }

    let text = labelSvg(view.label, 0, view.dy, ' class="ondine-label"' + view.style.text, undefined)

    const internal = classes.includes(' internal-link') && (classes + ' ').includes(' internal-link ')
    const label = node.label
    if (label !== undefined && internal && label !== '' && url.links !== false) {
      // The label is a note name, but it still ends up in an href, so it gets the same check
      // as a URL.
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
    body += innerSvg
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

    nodesOut += `<g class="ondine-node ondine-shape-${view.shape}${classes}" data-id="${id}" transform="translate(${num(c.x)},${num(c.y)})">${body}</g>`
  }

  const reach = sideReachDefault()
  for (let i = 0; i < cedges.length && i < drawn.length; i++) {
    const ce = cedges[i] as CEdge
    const edge = drawn[i] as GraphEdge
    if (ce.src === ce.dst || edge.thickness === 'invisible' || ce.route.length < 6) continue
    const src = cnodes[ce.src]
    const dst = cnodes[ce.dst]
    if (src !== undefined && dst !== undefined) {
      sideReachAdd(reach, ce.src, endSide(ce.route, 0, src), edge.arrowTypeStart)
      sideReachAdd(reach, ce.dst, endSide(ce.route, ce.route.length - 3, dst), edge.arrowTypeEnd)
    }
  }

  let edgesOut = ''
  let labelsOut = ''
  const loopSeen: number[] = zeros(views.length)

  for (let i = 0; i < cedges.length; i++) {
    const edge = drawn[i]
    const label = edgeLabels[i]
    if (edge === undefined || label === undefined) continue
    let style: ResolvedStyle | undefined
    if (edge.style.length === 0 && edge.cssCompiledStyles.length === 0) {
      style = undefined
    } else {
      const all = edge.cssCompiledStyles.slice()
      all.push(...edge.style)
      style = resolveStyle(all)
    }
    const invisible = edge.thickness === 'invisible'

    if (!invisible) {
      const startType = edge.arrowTypeStart
      const endType = edge.arrowTypeEnd
      const ce = cedges[i]
      if (ce === undefined) continue
      const src = ce.src
      const dst = ce.dst

      let path: EdgePath
      if (src === dst) {
        const k = loopSeen[src] ?? 0
        if (loopSeen[src] !== undefined) loopSeen[src] += 1
        const sideways = flowsSideways(cnodes, src)
        const srcView = views[src]
        const vw = srcView === undefined ? 0 : srcView.w
        const vh = srcView === undefined ? 0 : srcView.h
        const own = cnodes[src]
        const c = own === undefined ? cnode(0, 0, -1) : { ...own }
        path = loopPath(c, vw, vh, k, sideways, LOOP, markerTrim(endType), ce)
      } else {
        const srcNode = cnodes[src]
        const dstNode = cnodes[dst]
        const srcView = views[src]
        const dstView = views[dst]
        if (
          srcNode === undefined ||
          dstNode === undefined ||
          srcView === undefined ||
          dstView === undefined
        ) {
          continue
        }
        // Nothing reads the laid-out route after this edge is drawn, so it is inset in place.
        const route = ce.route
        const last = saturatingSub(route.length, 3)
        const leaves = sideReachOf(reach, src, endSide(route, 0, srcNode))
        const arrives = sideReachOf(reach, dst, endSide(route, last, dstNode))
        insetRoute(route, 0, srcView.shape, srcView.w, srcView.h, srcNode)
        insetRoute(route, last, dstView.shape, dstView.w, dstView.h, dstNode)
        path = routePath(route, edge.curve, markerTrim(startType), markerTrim(endType), leaves, arrives)
      }

      const stroke = style?.stroke
      const color = stroke !== undefined && stroke !== '' ? esc(stroke) : 'var(--_l)'
      let attrs: string
      switch (edge.thickness) {
        case 'thick':
          attrs = ' stroke-width="2.5"'
          break
        case 'dotted':
          attrs = ' stroke-dasharray="3 4"'
          break
        default:
          attrs = ''
      }
      const classes = edgeClasses(edge.classes)

      edgesOut += `<g class="ondine-edge${classes}" data-id="${escText(edge.id)}"${style === undefined ? '' : style.line}><path d="${path.d}"${attrs}/>${marker(startType, path.sx, path.sy, path.sdx, path.sdy, color)}${marker(endType, path.ex, path.ey, path.edx, path.edy, color)}</g>`
    }

    const ce = cedges[i]
    if (label.width > 0 && ce !== undefined) {
      const attrs = style === undefined ? '' : style.text
      labelsOut += edgeLabelSvg(edge.id, label, ce.labelX, ce.labelY, attrs, undefined)
    }
  }

  const content = buf(
    labelSvg(
      title,
      width / 2,
      pad + title.height / 2,
      ' class="ondine-title" font-weight="var(--_tw)"',
      undefined,
    ),
  )
  if (clusters !== '') {
    content.s += '<g class="ondine-clusters">'
    content.s += clusters
    content.s += '</g>'
  }
  if (edgesOut !== '') {
    content.s +=
      '<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">'
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
  const svg = svgDocument(variant === undefined ? 'flowchart' : variant.type, width, height, size, options, accessible, content.s)

  return { height, links, svg, width }
}

function present(value: string | undefined): boolean {
  return value !== undefined && value !== ''
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

/** The last raw node classes {@link nodeClasses} saw, and what it made of them. */
let lastNodeRaw = ''
let lastNodeClasses = classNames(stripDefault(''))

/** `classNames(stripDefault(raw))`. Nodes mostly share their classes, so the last is kept. */
function nodeClasses(raw: string): string {
  if (raw !== lastNodeRaw) {
    lastNodeClasses = classNames(stripDefault(raw))
    lastNodeRaw = raw
  }
  return lastNodeClasses
}

/** The last raw edge classes {@link edgeClasses} saw, and what it made of them. */
let lastEdgeRaw = ''
let lastEdgeClasses = classNames(stripEdgeClasses(''))

/** `classNames(stripEdgeClasses(raw))`. Edges mostly share their classes, so the last is kept. */
function edgeClasses(raw: string): string {
  if (raw !== lastEdgeRaw) {
    lastEdgeClasses = classNames(stripEdgeClasses(raw))
    lastEdgeRaw = raw
  }
  return lastEdgeClasses
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

function image(node: GraphNode, view: NodeView, img: string, url: UrlOptions): string {
  const aw = assetSize(node.assetWidth, 80)
  const ah = assetSize(node.assetHeight, 80)
  let top: number
  if (view.label.height > 0) top = node.pos === 't' ? view.h / 2 - ah : -view.h / 2
  else top = -ah / 2
  const safe = safeUrl(img)
  const src = imageUrl(safe, url)
  if (src === undefined) return ''

  const out = buf('<image href="')
  out.s += esc(src)
  out.s += '" x="'
  pushNum(out, -aw / 2)
  out.s += '" y="'
  pushNum(out, top)
  out.s += '" width="'
  pushNum(out, aw)
  out.s += '" height="'
  pushNum(out, ah)
  out.s += '" preserveAspectRatio="'
  out.s += node.constraint === 'on' ? 'xMidYMid meet' : 'none'
  out.s += '"/>'
  return out.s
}

/**
 * An icon node. Icon glyphs need a host resolver, which WebAssembly hosts do not pass yet, so
 * only the frame and an empty glyph box are drawn.
 */
function iconSvg(node: GraphNode, view: NodeView, icon: string): string {
  const side = assetSize(node.assetHeight, 48)
  let top: number
  if (view.label.height > 0) top = node.pos === 't' ? view.h / 2 - side : -view.h / 2
  else top = -side / 2

  const out = buf()
  switch (node.shape) {
    case 'icon':
      break
    case 'iconCircle':
      out.s += '<circle cy="'
      pushNum(out, top + side / 2)
      out.s += '" r="'
      pushNum(out, side / 2)
      out.s += '"'
      out.s += SHAPE_ATTRS
      out.s += view.style.shape
      out.s += '/>'
      break
    default:
      out.s += '<rect x="'
      pushNum(out, -side / 2)
      out.s += '" y="'
      pushNum(out, top)
      out.s += '" width="'
      pushNum(out, side)
      out.s += '" height="'
      pushNum(out, side)
      out.s += '" rx="'
      out.s += node.shape === 'iconRounded' ? '8' : '0'
      out.s += '"'
      out.s += SHAPE_ATTRS
      out.s += view.style.shape
      out.s += '/>'
  }

  const glyph = side * 0.6
  out.s += '<svg class="ondine-icon" data-icon="'
  out.s += escText(icon)
  out.s += '" x="'
  pushNum(out, -glyph / 2)
  out.s += '" y="'
  pushNum(out, top + (side - glyph) / 2)
  out.s += '" width="'
  pushNum(out, glyph)
  out.s += '" height="'
  pushNum(out, glyph)
  out.s +=
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>'
  return out.s
}
