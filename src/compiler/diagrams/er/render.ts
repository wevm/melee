/** @module Lays out and draws an ER diagram. Port of Pele's `src/diagrams/er/render.ts`. */
import type { ErDb } from './db.ts'
import { type ErGraphNode, build } from './graph.ts'
import { MARKER_LENGTH, erMarker } from './markers.ts'
import type { Rendered } from '../../diagrams.ts'
import { runsAcross, turnToFit } from '../common/fit_width.ts'
import { parseGenericTypes } from '../common/generics.ts'
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
import { esc, escText, jsRound, labelSvg, num, sharedStyle, spanStyle, textStyle } from '../../svg/builder.ts'
import { type Crossings, clusterTitleX, markCrossings } from '../../svg/cluster.ts'
import { edgeLabelSvg, routePath } from '../../svg/edges.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS, type ResolvedStyle, classNames, resolveStyle } from '../../svg/theme.ts'
import * as entities from '../../text/entities.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { fmax, fmin, totalCmp } from '../../util/rust.ts'
import { type LinkInfo, type UrlOptions, linkUrl, relAttr, sanitizeUrl } from '../../util/url.ts'
import type { Value } from '../../yaml.ts'

/** Room between nodes in a rank. */
const NODE_SEP = 48.0
/** Room between edges. */
const EDGE_SEP = 20.0
/** Room between ranks. */
const RANK_SEP = 64.0
/** Padding inside a subgraph. */
const GROUP_PAD = 20.0
/** How far a self-relationship reaches out past its markers. */
const LOOP = 28.0
/** The least stretch of side a self-relationship takes. */
const LOOP_BAND = 38.0
/** Least width of an entity. */
const MIN_WIDTH = 96.0
/** Padding beside an entity's name. */
const BOX_PAD_X = 18.0
/** Padding above and below the name of an entity without attributes. */
const BOX_PAD_Y = 12.0
/** Padding above and below the name of an entity with attributes. */
const HEAD_PAD_Y = 9.0
/** Padding beside the attribute table. */
const CELL_PAD_X = 12.0
/** Room between attribute columns. */
const CELL_GAP = 16.0
/** Padding of an attribute row. */
const ROW_PAD = 9.0
/** The width comments wrap at. */
const COMMENT_WRAP = 260.0
/** A width no cell wraps at. */
const NO_WRAP = 1e6
/** Room between edge ends on one side. */
const PORT_GAP = 18.0
/** Room between the outermost edge end and a corner. */
const PORT_MARGIN = 14.0
/** The fill and stroke of an entity box. */
const BOX_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"'

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

/** A positive number option of the `er` section, capped at 2000, or `fallback`. */
function numberOption(config: Value, key: string, fallback: number): number {
  const section = get(config, 'er')
  const value = section === undefined ? undefined : get(section, key)
  if (value !== undefined && value.kind === 'Number' && value._0 > 0) return fmin(value._0, 2000.0)
  return fallback
}

/** An attribute row: its type, name, keys, and comment cells, and its height. */
type Row = {
  cells: [Label, Label, Label, Label]
  h: number
}

/** What a node is drawn as, beside its layout box. */
type NodeView = {
  /** Whether self-relationships loop out of the bottom side rather than the right. */
  below: boolean
  /** Left edge of each column, measured from the left edge of the box. */
  cols: number[]
  h: number
  headH: number
  keySize: number
  label: Label
  node: ErGraphNode
  rowSize: number
  rows: Row[]
  style: ResolvedStyle
  w: number
}

/** A relationship from an entity to itself, with the stretch of the side it loops out of. */
type Loop = {
  at: number
  band: number
  label: Label
}

/** The loops of a node. */
type LoopsOf = {
  node: number
  own: number[]
}

/** The loops of a node without any. Never written to. */
const NO_LOOPS: number[] = []

/**
 * The direction of the level a node is laid out in: its nearest subgraph that sets one, or the
 * diagram's.
 */
function horizontal(nodes: ErGraphNode[], index: Map<string, number>, n: number, dir0: string, i: number): boolean {
  let at = i
  // Subgraphs can name each other as members, so the walk up is bounded.
  for (let step = 0; step < n; step++) {
    const parent = nodes[at]?.parentId
    const up = parent === undefined ? undefined : index.get(parent)
    if (up === undefined) break
    const dir = nodes[up]?.dir
    if (dir !== undefined) return dir === 'LR' || dir === 'RL'
    at = up
  }
  return dir0 === 'LR' || dir0 === 'RL'
}

/** Writes a measured label starting at `x`, with the baseline of its first line at `y`. */
function textLeft(label: Label, x: number, y: number, attrs: string): string {
  const lines = label.lines
  if (lines.length === 0) return ''
  if (lines.length === 1) {
    const line = lines[0] as Label['lines'][number]
    const span = line[0]
    if (line.length === 1 && span !== undefined && span.icon === undefined && span.style === 0) {
      return `<text${attrs} x="${num(x)}" y="${num(y)}">${esc(span.text)}</text>`
    }
  }
  const shared = sharedStyle(label)
  let body = ''
  let extra = ''
  for (const line of lines) {
    let hasIcon = false
    for (let i = 0; i < line.length; i++) {
      if ((line[i] as Label['lines'][number][number]).icon !== undefined) {
        hasIcon = true
        break
      }
    }
    let sx = x
    let placed = false
    for (const span of line) {
      const icon = span.icon
      if (icon !== undefined) {
        const side = label.size * 1.1
        extra += `<svg class="ondine-icon" data-icon="${escText(icon)}" x="${num(sx)}" y="${num(y - label.size * 0.35 - side / 2.0)}" width="${num(side)}" height="${num(side)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>`
      } else if (span.text !== '') {
        body += '<tspan'
        if (hasIcon || !placed) body += ` x="${num(sx)}" y="${num(y)}"`
        body += spanStyle(span.style & ~shared)
        body += `>${esc(span.text)}</tspan>`
        placed = true
      }
      sx += span.width
    }
    y += label.lineHeight
  }
  return `<text${textStyle(attrs, shared)} xml:space="preserve">${body}</text>${extra}`
}

/**
 * Mermaid reads `~` pairs as angle brackets. They are written as entities so the label parser
 * does not take `<int>` for a tag.
 */
function cellText(raw: string): string {
  const converted = parseGenericTypes(raw)
  if (converted === raw) return converted
  let out = ''
  let from = 0
  for (let i = 0; i < converted.length; i++) {
    const c = converted.charCodeAt(i)
    if (c === 0x3c || c === 0x3e) {
      out += converted.slice(from, i)
      out += c === 0x3c ? '&lt;' : '&gt;'
      from = i + 1
    }
  }
  return from === 0 ? converted : out + converted.slice(from)
}

/**
 * Removes a leading `default` class and one following whitespace character, as `/^default\s?/`
 * does.
 */
function stripDefault(classes: string): string {
  if (!classes.startsWith('default')) return classes
  const rest = classes.slice(7)
  // `\s` is all in the Basic Multilingual Plane, so a unit is the whole character.
  if (rest.length > 0 && isSpace(rest.charCodeAt(0))) return rest.slice(1)
  return rest
}

/**
 * Draws an ER diagram, turning one that runs across to run down when it does not fit the host's
 * width.
 */
export function render(db: ErDb, config: Value, options: RenderOptions, url: UrlOptions): Rendered {
  if (!runsAcross(db.direction)) return draw(db, config, options, url, false)
  return turnToFit(options, (down) => draw(db, config, options, url, down))
}

/** `turned` draws a diagram that runs across as one that runs down. */
function draw(db: ErDb, config: Value, options: RenderOptions, url: UrlOptions, turned: boolean): Rendered {
  const graph = build(db)
  const size = options.fontSize ?? 16.0
  const smallSize = jsRound(size * 0.875)
  const pad = options.padding ?? 8.0
  const n = graph.nodes.length

  const index = new Map<string, number>()
  for (let i = 0; i < graph.nodes.length; i++) index.set((graph.nodes[i] as ErGraphNode).id, i)

  const cedges: CEdge[] = []
  const edgeLabels: Label[] = []
  const drawn: (typeof graph.edges)[number][] = []
  const loops: Loop[] = []
  // The loops of each node, in the order nodes first got one.
  const loopsOf: LoopsOf[] = []
  /** The loops of each node that has any, by node. */
  const loopsAt = new Map<number, number[]>()
  const loopOf: (number | undefined)[] = []
  for (const edge of graph.edges) {
    const src = index.get(edge.start)
    const dst = index.get(edge.end)
    if (src === undefined || dst === undefined) continue
    const label = layoutLabel(edge.label, true, smallSize, 200.0, 0, undefined)
    let own: number | undefined
    if (src === dst) {
      own = loops.length
      const found = loopsAt.get(src)
      if (found !== undefined) {
        found.push(loops.length)
      } else {
        const list = [loops.length]
        loopsAt.set(src, list)
        loopsOf.push({ node: src, own: list })
      }
      loops.push({ at: 0.0, band: 0.0, label })
    }
    loopOf.push(own)
    drawn.push(edge)
    cedges.push({
      dst,
      labelH: label.height > 0.0 ? label.height + 4.0 : 0.0,
      labelW: label.width > 0.0 ? label.width + 12.0 : 0.0,
      labelX: 0.0,
      labelY: 0.0,
      minlen: 1,
      route: [],
      src,
    })
    edgeLabels.push(label)
  }

  // The direction of the level a node is laid out in: its nearest subgraph that sets one, or the
  // diagram's.

  const views: NodeView[] = []
  const cnodes: CNode[] = []
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i] as ErGraphNode
    const style =
      node.cssStyles.length === 0
        ? resolveStyle(node.cssCompiledStyles)
        : resolveStyle(node.cssCompiledStyles.concat(node.cssStyles))
    const base = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
    const nameSize = style.fontSize ?? size
    const rowSize = style.fontSize ?? smallSize
    const keySize = style.fontSize ?? jsRound(size * 0.75)
    let label: Label
    if (node.isGroup) {
      label = layoutLabel(node.label, true, nameSize, 4000.0, base, undefined)
    } else {
      const name = node.alias === '' ? node.label : node.alias
      label = layoutLabel(name, true, nameSize, 240.0, base, undefined)
    }
    const own: number[] = loopsAt.get(i) ?? NO_LOOPS
    // Loops leave by a side the layout keeps free of other edges: the right when ranks run down,
    // the bottom when they run across.
    const below = own.length > 0 && !node.isGroup && horizontal(graph.nodes, index, n, db.direction, i)
    let reach = 0.0
    let bands = 0.0
    for (const k of own) {
      const item = loops[k]
      if (item === undefined) continue
      item.band = fmax(LOOP_BAND, below ? item.label.width + 12.0 : item.label.height + 6.0)
      bands += item.band
      reach = fmax(reach, below ? item.label.height : item.label.width)
    }
    const minW = fmax(MIN_WIDTH, below ? bands + 8.0 : 0.0)
    const view: NodeView = {
      below,
      cols: [],
      h: 0.0,
      headH: 0.0,
      keySize,
      label,
      node,
      rowSize,
      rows: [],
      style,
      w: 0.0,
    }
    let c: CNode
    if (node.isGroup) {
      c = cnode(0.0, 0.0, -1)
      c.isGroup = true
      c.dir = node.dir === undefined ? undefined : direction(node.dir)
      c.padX = GROUP_PAD
      c.padTop = view.label.height > 0.0 ? view.label.height + 16.0 : GROUP_PAD
      c.padBottom = GROUP_PAD
      c.minW = fmax(view.label.width + 2.0 * GROUP_PAD - 12.0, MIN_WIDTH)
    } else {
      const nameH = fmax(view.label.height, jsRound(nameSize * 1.5))
      if (node.attributes.length === 0) {
        view.w = fmax(view.label.width + 2.0 * BOX_PAD_X, minW)
        view.h = fmax(nameH + 2.0 * BOX_PAD_Y, below ? 0.0 : bands + 8.0)
      } else {
        const rowLine = jsRound(rowSize * 1.5)
        const widths = [0.0, 0.0, 0.0, 0.0]
        for (const attribute of node.attributes) {
          const keys = attribute.keys.join(', ')
          const cells: [Label, Label, Label, Label] = [
            layoutLabel(cellText(attribute.type), true, rowSize, NO_WRAP, base, undefined),
            layoutLabel(cellText(attribute.name), true, rowSize, NO_WRAP, base, undefined),
            layoutLabel(keys, false, keySize, NO_WRAP, base, undefined),
            layoutLabel(cellText(attribute.comment), true, rowSize, COMMENT_WRAP, base, undefined),
          ]
          let h = rowLine
          for (let k = 0; k < 4; k++) {
            const cell = cells[k] as Label
            if (cell.width > (widths[k] as number)) widths[k] = cell.width
            if (cell.height > h) h = cell.height
          }
          view.rows.push({ cells, h: h + ROW_PAD })
          view.h += h + ROW_PAD
        }
        let columns = 0
        let inner = 0.0
        for (const w of widths) {
          if (w === 0.0) continue
          inner += w + (columns > 0 ? CELL_GAP : 0.0)
          columns += 1
        }
        view.w = fmax(fmax(inner + 2.0 * CELL_PAD_X, view.label.width + 2.0 * BOX_PAD_X), minW)
        // A box wider than its table shares the spare width between the columns.
        const spare = columns > 0 ? (view.w - inner - 2.0 * CELL_PAD_X) / columns : 0.0
        let x = CELL_PAD_X
        for (const w of widths) {
          view.cols.push(x)
          if (w > 0.0) x += w + spare + CELL_GAP
        }
        view.headH = nameH + 2.0 * HEAD_PAD_Y
        view.h += view.headH
      }
      // The layout keeps a node centered in its box, so room for loops is added on both sides.
      const room = own.length === 0 ? 0.0 : 2.0 * (MARKER_LENGTH + LOOP * 0.75 + 10.0 + reach)
      c = below ? cnode(view.w, view.h + room, -1) : cnode(view.w + room, view.h, -1)
    }
    c.seq = views.length
    views.push(view)
    cnodes.push(c)
  }
  for (let i = 0; i < graph.nodes.length; i++) {
    const parentId = (graph.nodes[i] as ErGraphNode).parentId
    const parent = parentId === undefined ? undefined : index.get(parentId)
    const c = cnodes[i]
    if (c !== undefined) c.parent = parent ?? -1
  }

  const options_: LayeredOptions = {
    apart: false,
    edgeSep: EDGE_SEP,
    headRoom: 0.0,
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    portSep: 24.0,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    straight: false,
    tracks: false,
  }
  const layout = compoundLayout(cnodes, cedges, turned ? Dir.Tb : direction(db.direction), options_)

  spreadEnds(cedges, cnodes, views)

  // A subgraph gets its size from the layout, so its loops hang outside it and may widen the
  // diagram.
  let layoutWidth = layout.width
  for (const { node: i, own } of loopsOf) {
    const c = cnodes[i]
    if (c === undefined || !c.isGroup) continue
    let reach = 0.0
    for (const k of own) {
      const item = loops[k]
      if (item !== undefined) reach = fmax(reach, item.label.width)
    }
    layoutWidth = fmax(layoutWidth, c.x + c.w / 2.0 + MARKER_LENGTH + LOOP * 0.75 + 10.0 + reach)
  }

  const title = layoutLabel(db.title, false, size, 4000.0, BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 12.0 : 0.0
  const inner = fmax(layoutWidth, title.width)
  const ox = pad + (inner - layoutWidth) / 2.0
  const oy = pad + titleHeight
  shiftLayout(cnodes, cedges, ox, oy)
  const width = Math.ceil(inner + 2.0 * pad)
  const height = Math.ceil(layout.height + titleHeight + 2.0 * pad)
  const links: LinkInfo[] = []

  const crossings: Crossings = new Map()
  if (cnodes.some((c) => c.isGroup)) {
    for (const e of cedges) markCrossings(crossings, e.route)
  }

  let clusters = ''
  let nodesOut = ''
  for (let i = 0; i < views.length; i++) {
    const view = views[i] as NodeView
    const c = cnodes[i]
    if (c === undefined) continue
    const node = view.node
    const classes = classNames(stripDefault(node.cssClasses))
    if (c.isGroup) {
      view.w = c.w
      view.h = c.h
      const x = c.x - c.w / 2.0
      const y = c.y - c.h / 2.0
      const titleX = clusterTitleX(c, view.label.width, crossings, GROUP_PAD)
      clusters += `<g class="ondine-cluster${classes}" data-id="${escText(node.id)}"><rect x="${num(x)}" y="${num(y)}" width="${num(c.w)}" height="${num(c.h)}" rx="${RADIUS}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${view.style.shape}/>`
      const attrs = ` class="ondine-cluster-label" fill="var(--_m)"${view.style.text}`
      clusters += labelSvg(view.label, titleX, y + 8.0 + view.label.height / 2.0, attrs, undefined)
      clusters += '</g>'
      continue
    }

    const w = view.w
    const h = view.h
    const x0 = -w / 2.0
    const y0 = -h / 2.0
    const text = view.style.text
    const shape = `x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}" rx="${RADIUS}"`
    const nameAttrs = ` class="ondine-label"${text}`
    let name = labelSvg(view.label, 0.0, view.rows.length === 0 ? 0.0 : y0 + view.headH / 2.0, nameAttrs, undefined)
    const display = entities.decode(node.alias === '' ? node.label : node.alias)
    const spaced = `${classes} `
    if (spaced.includes(' internal-link ') && name !== '' && url.links !== false) {
      // The name ends up in an href, so it gets the same check as a URL.
      const safe = linkUrl(sanitizeUrl(display), url) !== undefined
      const target = esc(display)
      let anchor = '<a class="internal-link"'
      if (safe) anchor += ` href="${target}"${relAttr(url)}`
      anchor += ` data-href="${target}">${name}</a>`
      name = anchor
      links.push({ href: display, id: node.label, internal: true })
    }

    let body = `<rect ${shape}${BOX_ATTRS}${view.style.shape}/>`
    if (view.rows.length === 0) {
      body += name
    } else {
      const rowLine = jsRound(view.rowSize * 1.5)
      const stroke = view.style.stroke
      const lineColor = stroke !== undefined && stroke !== '' ? esc(stroke) : 'var(--_b)'
      let stripes = ''
      let cells = ''
      let y = y0 + view.headH
      const count = view.rows.length
      const typeAttrs = ` class="ondine-er-type" fill="var(--_m)"${text}`
      const nameCellAttrs = ` class="ondine-er-name"${text}`
      const keyAttrs = ` class="ondine-er-keys" font-size="${num(view.keySize)}" fill="var(--_m)"${text}`
      const commentAttrs = ` class="ondine-er-comment" fill="var(--_m)"${text}`
      for (let r = 0; r < count; r++) {
        const row = view.rows[r] as Row
        if (r % 2 === 0) {
          const span = `x="${num(x0)}" width="${num(w)}"`
          stripes += `<rect ${span} y="${num(y)}" height="${num(row.h)}`
          if (r === count - 1) {
            // The last row follows the box's rounded bottom corners: a rounded rect, squared off
            // on top.
            stripes += `" rx="${RADIUS}"/><rect ${span} y="${num(y)}" height="${num(row.h / 2.0)}`
          }
          stripes += '"/>'
        }
        const baseline = y + ROW_PAD / 2.0 + rowLine / 2.0 + view.rowSize * 0.35
        const rowCells = row.cells
        const cols = view.cols
        cells += textLeft(rowCells[0], x0 + (cols[0] ?? 0.0), baseline, typeAttrs)
        cells += textLeft(rowCells[1], x0 + (cols[1] ?? 0.0), baseline, nameCellAttrs)
        cells += textLeft(rowCells[2], x0 + (cols[2] ?? 0.0), baseline, keyAttrs)
        cells += textLeft(rowCells[3], x0 + (cols[3] ?? 0.0), baseline, commentAttrs)
        y += row.h
      }
      // Over a fill the diagram chose, the shading is a tint of that fill. The opacity is on the
      // group because the two parts of the last row overlap.
      body += '<g class="ondine-er-stripes" fill="var(--_bg)"'
      if (view.style.shape.includes('fill:')) body += ' opacity="0.6"'
      body += `>${stripes}</g><path class="ondine-er-divider" d="M${num(x0)},${num(y0 + view.headH)}H${num(x0 + w)}" stroke="${lineColor}"/><rect ${shape} fill="none" stroke="var(--_b)"${view.style.line}/>`
      body += name
      body += `<g class="ondine-er-attributes" font-size="${num(view.rowSize)}">${cells}</g>`
    }
    nodesOut += `<g class="ondine-node ondine-entity${classes}" data-id="${escText(node.label)}" transform="translate(${num(c.x)},${num(c.y)})">${body}</g>`
  }

  // Self-relationships share the side they loop out of, squeezed together if it is too short for
  // them.
  for (const { node: i, own } of loopsOf) {
    const view = views[i]
    if (view === undefined) continue
    let total = 0.0
    for (const k of own) {
      const item = loops[k]
      if (item !== undefined) total += item.band
    }
    const side = view.below ? view.w : view.h
    const scale = fmin(fmax(side - 8.0, 0.0) / total, 1.0)
    let at = (-total * scale) / 2.0
    for (const k of own) {
      const item = loops[k]
      if (item === undefined) continue
      item.band *= scale
      item.at = at + item.band / 2.0
      at += item.band
    }
  }

  let edgesOut = ''
  let labelsOut = ''
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i] as CEdge
    const edge = drawn[i]
    const label = edgeLabels[i]
    if (edge === undefined || label === undefined) continue
    let d: string
    let start: string
    let end: string
    const k = loopOf[i]
    const item = k === undefined ? undefined : loops[k]
    if (item !== undefined) {
      const c = cnodes[ce.src]
      const view = views[ce.src]
      if (c === undefined || view === undefined) continue
      // `Math.max(Math.min(...))`, which a band too narrow for 1 still leaves at 1.
      const spread = fmax(fmin(item.band / 2.0 - 6.0, 13.0), 1.0)
      const far = MARKER_LENGTH + LOOP * 0.75 + 6.0
      if (view.below) {
        const x = c.x + item.at
        const y = c.y + view.h / 2.0
        const turn = y + MARKER_LENGTH
        const out = y + MARKER_LENGTH + LOOP
        d = `M${num(x - spread)},${num(y)}V${num(turn)}C${num(x - spread)},${num(out)} ${num(x + spread)},${num(out)} ${num(x + spread)},${num(turn)}V${num(y)}`
        ce.labelX = x
        ce.labelY = y + far + label.height / 2.0
        start = erMarker(edge.arrowTypeStart, x - spread, y, 0.0, -1.0)
        end = erMarker(edge.arrowTypeEnd, x + spread, y, 0.0, -1.0)
      } else {
        const x = c.x + view.w / 2.0
        const y = c.y + item.at
        const turn = x + MARKER_LENGTH
        const out = x + MARKER_LENGTH + LOOP
        d = `M${num(x)},${num(y - spread)}H${num(turn)}C${num(out)},${num(y - spread)} ${num(out)},${num(y + spread)} ${num(turn)},${num(y + spread)}H${num(x)}`
        ce.labelX = x + far + label.width / 2.0
        ce.labelY = y
        start = erMarker(edge.arrowTypeStart, x, y - spread, -1.0, 0.0)
        end = erMarker(edge.arrowTypeEnd, x, y + spread, -1.0, 0.0)
      }
    } else {
      const route = straighten(ce.route)
      if (route.length < 6) continue
      const last = route.length - 3
      const srcView = views[ce.src]
      const srcC = cnodes[ce.src]
      if (srcView !== undefined && srcC !== undefined) inset(route, 0, srcView, srcC)
      const dstView = views[ce.dst]
      const dstC = cnodes[ce.dst]
      if (dstView !== undefined && dstC !== undefined) inset(route, last, dstView, dstC)
      // A curve stops short of each box so that the marker sits on a straight run of line.
      const dx = Math.abs((route[last] ?? Number.NaN) - (route[0] ?? Number.NaN))
      const dy = Math.abs((route[last + 1] ?? Number.NaN) - (route[1] ?? Number.NaN))
      const direct = route.length === 6 && (dx < 0.01 || dy < 0.01 || Math.hypot(dx, dy) <= 3.0 * MARKER_LENGTH)
      const stub = direct ? 0.0 : MARKER_LENGTH
      const path = routePath(route, undefined, stub, stub, undefined, undefined)
      d = stub > 0.0 ? `M${num(path.sx)},${num(path.sy)}L${path.d.slice(1)}L${num(path.ex)},${num(path.ey)}` : path.d
      start = erMarker(edge.arrowTypeStart, path.sx, path.sy, path.sdx, path.sdy)
      end = erMarker(edge.arrowTypeEnd, path.ex, path.ey, path.edx, path.edy)
    }
    edgesOut += `<g class="ondine-edge ondine-er-${edge.dashed ? 'non-identifying' : 'identifying'}" data-id="${escText(edge.id)}"><path d="${d}"`
    if (edge.dashed) edgesOut += ' stroke-dasharray="4 3"'
    edgesOut += `/>${start}${end}</g>`
    if (label.width > 0.0) labelsOut += edgeLabelSvg(edge.id, label, ce.labelX, ce.labelY, '', undefined)
  }

  let content = labelSvg(
    title,
    width / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  if (clusters !== '') content += `<g class="ondine-clusters">${clusters}</g>`
  if (edgesOut !== '') {
    content += `<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>`
  }
  if (labelsOut !== '') content += `<g class="ondine-edge-labels" font-size="${num(smallSize)}">${labelsOut}</g>`
  content += `<g class="ondine-nodes">${nodesOut}</g>`

  const accessible: Accessible = { accDescr: db.accDescr, accTitle: db.accTitle }
  const svg = svgDocument('er', width, height, size, options, accessible, content)
  return { height, links, svg, width }
}

/** Drops the middle points of straight runs. */
function straighten(route: number[]): number[] {
  const out: number[] = route.slice(0, 3)
  const len = route.length
  for (let k = 3; k < len; k += 3) {
    const prev = Math.max(out.length - 3, 0)
    if (!(k + 3 < len && (flat(route, out, prev, k, 0) || flat(route, out, prev, k, 1)))) {
      for (let j = k; j < Math.min(k + 3, len); j++) out.push(route[j] as number)
    }
  }
  return out
}

/** Whether point `k` of `route` is in line with the kept point before it and the point after it on `axis`. */
function flat(route: number[], out: number[], prev: number, k: number, axis: number): boolean {
  const v = route[k + axis] ?? Number.NaN
  return (
    Math.abs((out[prev + axis] ?? Number.NaN) - v) < 0.01 && Math.abs(v - (route[k + 3 + axis] ?? Number.NaN)) < 0.01
  )
}

/**
 * JavaScript's order for `a - b` where the difference is a number: equal values, including both
 * zeros, compare equal.
 */
function compare(a: number, b: number): number {
  return a === b ? 0 : totalCmp(a, b)
}

/** An end of an edge on a side of a node. */
type End = {
  at: number
  edge: number
  toward: number
}

/**
 * The layout brings every edge that ends on one side of a box to the middle of that side, where
 * their markers would cover each other. This spaces them along the side, in the order they fan
 * out.
 */
/** The ends on one side of a node, keyed by `node * 4 + side`. */
type Side = {
  ends: End[]
  key: number
}

/** Files an edge end under the side of `node` it reaches. */
function addEnd(
  cnodes: CNode[],
  keys: Map<number, number>,
  sides: Side[],
  node: number,
  edge: number,
  route: number[],
  at: number,
  next: number,
): void {
  const c = cnodes[node]
  if (c === undefined) return
  const dx = (route[at] ?? Number.NaN) - c.x
  const dy = (route[at + 1] ?? Number.NaN) - c.y
  let side: number
  if (Math.abs(Math.abs(dy) - c.h / 2.0) < 0.5) side = dy < 0.0 ? 0 : 2
  else if (Math.abs(Math.abs(dx) - c.w / 2.0) < 0.5) side = dx < 0.0 ? 3 : 1
  else return
  const key = node * 4 + side
  const end: End = { at, edge, toward: route[next + (side & 1)] ?? Number.NaN }
  const k = keys.get(key)
  if (k !== undefined) {
    ;(sides[k] as Side).ends.push(end)
  } else {
    keys.set(key, sides.length)
    sides.push({ ends: [end], key })
  }
}

/** Orders ends by where they fan out to. */
function byToward(a: End, b: End): number {
  return compare(a.toward, b.toward)
}

function spreadEnds(cedges: CEdge[], cnodes: CNode[], views: NodeView[]): void {
  const keys = new Map<number, number>()
  const sides: Side[] = []
  for (let i = 0; i < cedges.length; i++) {
    const e = cedges[i] as CEdge
    if (e.route.length < 3) continue
    const last = e.route.length - 3
    if (e.src === e.dst || last < 3) continue
    addEnd(cnodes, keys, sides, e.src, i, e.route, 0, 3)
    addEnd(cnodes, keys, sides, e.dst, i, e.route, last, last - 3)
  }
  for (let si = 0; si < sides.length; si++) {
    const sideEntry = sides[si] as Side
    const key = sideEntry.key
    const ends = sideEntry.ends
    if (ends.length < 2) continue
    const node = Math.floor(key / 4)
    const vertical = (key & 1) === 1
    const c = cnodes[node]
    const view = views[node]
    if (c === undefined || view === undefined) continue
    const bw = c.isGroup ? c.w : view.w
    const bh = c.isGroup ? c.h : view.h
    const length = vertical ? bh : bw
    const step = fmax(fmin(PORT_GAP, (length - 2.0 * PORT_MARGIN) / (ends.length - 1)), 0.0)
    const center = vertical ? c.y : c.x
    ends.sort(byToward)
    const count = ends.length
    for (let i = 0; i < ends.length; i++) {
      const end = ends[i] as End
      const route = cedges[end.edge]?.route
      const at = end.at + (vertical ? 1 : 0)
      if (route !== undefined && at < route.length) route[at] = center + (i - (count - 1.0) / 2.0) * step
    }
  }
}

/**
 * An entity with a self-relationship is laid out larger than it is drawn. This moves a route end
 * from the side of that larger box onto the entity's own side.
 */
function inset(route: number[], at: number, view: NodeView, c: CNode): void {
  if (c.isGroup) return
  const dx = (route[at] ?? Number.NaN) - c.x
  const dy = (route[at + 1] ?? Number.NaN) - c.y
  if (c.w !== view.w && Math.abs(Math.abs(dx) - c.w / 2.0) < 0.5 && at < route.length) {
    route[at] = (route[at] as number) - (jsSign(dx) * (c.w - view.w)) / 2.0
  }
  if (c.h !== view.h && Math.abs(Math.abs(dy) - c.h / 2.0) < 0.5 && at + 1 < route.length) {
    route[at + 1] = (route[at + 1] as number) - (jsSign(dy) * (c.h - view.h)) / 2.0
  }
}

/** JavaScript's `Math.sign`: zero for zero. */
function jsSign(value: number): number {
  return Math.sign(value)
}
