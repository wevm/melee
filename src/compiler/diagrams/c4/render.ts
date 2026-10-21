/** @module Draws a C4 diagram. Port of Pele's `src/diagrams/c4/render.ts`. */
import type { Rendered } from '../../diagrams.ts'
import { type Drawn, tighten, titleRoom } from '../common/fit_width.ts'
import { leftLabelSvg } from '../common/literal_label.ts'
import { Code, CompileError, errorNew } from '../../error.ts'
import { esc, escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { ARROW, marker, markerTrim } from '../../svg/edges.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { drawShape } from '../../svg/shapes.ts'
import { RADIUS, type ResolvedStyle, resolveStyle } from '../../svg/theme.ts'
import { type Label, labelDefault, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { type LinkInfo, type UrlOptions, linked, sanitizeUrl } from '../../util/url.ts'
import { type Buf, clamp, fmax, fmin } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'
import type { C4Db } from './db.ts'
import { HEAD_LEFT, HEAD_TOP, layoutC4 } from './layout.ts'
import {
  Form,
  formName,
  HEAD,
  LANE,
  type Route,
  crosses,
  cylRy,
  lanesDefault,
  lanesFrame,
  queueRx,
  route,
} from './route.ts'

const PAIR_SHIFT = 7.0
const NARROW_GAP = 36.0
const WIDEN = 24.0
const MAX_OFFSET = 2000.0
/** A label may cover this much of a shape's edge, where there is no text. */
const EDGE = 8.0
/** Places along a relation to try for its label, nearest the middle first. */
const SLIDE: readonly number[] = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]
/**
 * Above this many box comparisons, labels stay at the middle and lines are not steered around
 * shapes.
 */
const CARE_BUDGET = 2_000_000.0

function userStyle(fill: string | undefined, stroke: string | undefined, color: string | undefined): ResolvedStyle {
  const declarations: string[] = []
  if (fill !== undefined && fill !== '') declarations.push('fill:' + fill)
  if (stroke !== undefined && stroke !== '') declarations.push('stroke:' + stroke)
  if (color !== undefined && color !== '') declarations.push('color:' + color)
  return resolveStyle(declarations)
}

/**
 * Entity encoding has hidden any `#name;` in an address. This puts it back, so that the check
 * sees what a browser would.
 */
function unhide(url: string): string {
  if (!url.includes('¶ß')) return url
  // Pele replaces `ﬂ°` or `ﬂ°°` first, then `¶ß`. Neither can make or break the other, so one
  // pass does both.
  let out = ''
  let i = 0
  const n = url.length
  while (i < n) {
    if (url.startsWith('ﬂ°', i)) {
      out += '#'
      i += 2
      if (url.startsWith('°', i)) i += 1
    } else if (url.startsWith('¶ß', i)) {
      out += ';'
      i += 2
    } else {
      out += url.charAt(i)
      i += 1
    }
  }
  return out
}

/** The context every link of one drawing shares. */
type Links = {
  links: LinkInfo[]
  url: UrlOptions
}

function linksLink(self: Links, body: string, url: string | undefined, id: string): string {
  if (url !== undefined && url !== '') {
    return linked(body, sanitizeUrl(unhide(url)), id, self.links, self.url, '')
  }
  return body
}

/** A drawing or the error that stopped it, as {@link tighten} takes it. */
type Drawing = Drawn & {
  result: { ok: true; value: Rendered } | { ok: false; error: CompileError }
}

function drawing(result: Drawing['result']): Drawing {
  return { result, width: result.ok ? result.value.width : 0 }
}

/** Runs `draw`, catching the compile error it throws. */
function attempt(
  db: C4Db,
  options: RenderOptions,
  url: UrlOptions,
  tight: boolean,
  gap: number,
): { ok: true; value: [Rendered, number] } | { ok: false; error: CompileError } {
  try {
    return { ok: true, value: draw(db, options, url, tight, gap) }
  } catch (error) {
    if (error instanceof CompileError) return { ok: false, error }
    throw error
  }
}

/**
 * Draws a C4 diagram, more tightly when it does not fit the host's width.
 *
 * Throws a semantic error for a relation that names an unknown shape or boundary.
 */
export function render(db: C4Db, options: RenderOptions, url: UrlOptions): Rendered {
  const result = tighten(options, (tight): Drawing => {
    if (!tight) {
      const drawn = attempt(db, options, url, false, NARROW_GAP)
      return drawing(drawn.ok ? { ok: true, value: drawn.value[0] } : drawn)
    }
    const first = attempt(db, options, url, true, NARROW_GAP)
    if (!first.ok) return drawing(first)
    let [best, squeezed] = first.value
    let gap = NARROW_GAP + WIDEN
    while (squeezed > 0 && gap <= NARROW_GAP + 3 * WIDEN) {
      const drawn = attempt(db, options, url, true, gap)
      if (!drawn.ok) return drawing(drawn)
      const [wider, left] = drawn.value
      if (left < squeezed) {
        best = wider
        squeezed = left
      }
      gap += WIDEN
    }
    return drawing({ ok: true, value: best })
  })
  if (!result.result.ok) throw result.result.error
  return result.result.value
}

function unknown(from: string, to: string): CompileError {
  const error = errorNew(Code.Semantic, `C4 rel "${from}" -> "${to}" references an unknown shape or boundary`)
  error.type = 'c4'
  return error
}

function draw(db: C4Db, options: RenderOptions, url: UrlOptions, tight: boolean, gap: number): [Rendered, number] {
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.8125)
  const pad = options.padding ?? 8
  const links: Links = { links: [], url }
  const room = tight ? fmax(80, (options.maxWidth ?? 320) - 2 * pad) : undefined
  const layout = layoutC4(db, size, small, room, gap)
  const rootGroup = layout.groups[0]
  const rootFound = rootGroup === undefined ? undefined : layout.boxes[rootGroup.id]
  const root = rootFound === undefined ? { h: 0, w: 0 } : { h: rootFound.h, w: rootFound.w }

  let minX = 0
  let minY = 0
  let maxX = root.w
  let maxY = root.h
  const grow = (x0: number, y0: number, x1: number, y1: number): void => {
    minX = fmin(minX, x0)
    minY = fmin(minY, y0)
    maxX = fmax(maxX, x1)
    maxY = fmax(maxY, y1)
  }

  // `c4DbGetC4Shape`, then the box of what it finds: shapes first.
  const boxOf = (alias: string): number | undefined => {
    const shape = db.shapeIndex.get(alias)
    if (shape !== undefined) return layout.shapeBoxes[shape]
    const boundary = db.boundaryIndex.get(alias)
    return boundary === undefined ? undefined : layout.boundaryBoxes[boundary]
  }
  // Both ends of each relation, as box indices, and the pairs of them as `a * boxCount + b`.
  const ends: number[] = []
  const boxCount = layout.boxes.length
  const pairs = new Set<number>()
  for (const rel of db.rels) {
    const a = rel.fromAttr !== undefined ? undefined : boxOf(rel.from)
    const b = rel.toAttr !== undefined ? undefined : boxOf(rel.to)
    if (a === undefined || b === undefined) throw unknown(rel.from, rel.to)
    ends.push(a, b)
    pairs.add(a * boxCount + b)
  }

  // What a relation's label should not cover: shapes, arrowheads, boundary headings, and the
  // labels placed before it.
  const nodes: number[] = []
  const taken: number[] = []
  for (const at of layout.order) {
    for (const node of layout.groups[at]?.nodes ?? []) {
      nodes.push(node.id)
      const b = layout.boxes[node.id]
      if (b !== undefined) taken.push(b.x + EDGE, b.y + EDGE, b.x + b.w - EDGE, b.y + b.h - EDGE)
    }
  }
  const careful = db.rels.length * (nodes.length + layout.order.length + 3 * db.rels.length) <= CARE_BUDGET
  const covered = (taken: number[], x0: number, y0: number, x1: number, y1: number): number => {
    let area = 0
    for (let i = 0; i + 4 <= taken.length; i += 4) {
      const left = taken[i] as number
      const top = taken[i + 1] as number
      const right = taken[i + 2] as number
      const bottom = taken[i + 3] as number
      const w = fmin(x1, right) - fmax(x0, left)
      if (w <= 0) continue
      const h = fmin(y1, bottom) - fmax(y0, top)
      if (h > 0) area += w * h
    }
    return area
  }
  const offset = (value: number | undefined): number => {
    if (value !== undefined && value !== 0 && !Number.isNaN(value)) return clamp(value, -MAX_OFFSET, MAX_OFFSET)
    return 0
  }

  // Every line is drawn before any label is placed, so that labels can keep off the arrowheads.
  let edgesOut = ''
  const trim = markerTrim('arrow_point')
  const lanes = lanesDefault()
  for (let k = 1; k < layout.order.length; k++) {
    const g = layout.groups[layout.order[k] as number]
    const b = g === undefined ? undefined : layout.boxes[g.id]
    if (b !== undefined) lanesFrame(lanes, b)
  }
  const routes: Route[] = []
  for (let index = 0; index < db.rels.length && 2 * index < ends.length; index++) {
    const rel = db.rels[index] as (typeof db.rels)[number]
    const a = ends[2 * index] as number
    const b = ends[2 * index + 1] as number
    const style = userStyle(undefined, rel.lineColor, undefined)
    const color = style.stroke !== undefined && style.stroke !== '' ? esc(style.stroke) : 'var(--_l)'
    const startArrow = rel.type === 'birel' || rel.type === 'rel_b'
    const endArrow = rel.type !== 'rel_b'
    const reverse = a !== b && pairs.has(b * boxCount + a)
    const r = route(
      layout.boxes,
      [a, b],
      reverse ? PAIR_SHIFT : 0,
      careful ? nodes : undefined,
      lanes,
      startArrow ? trim : 0,
      endArrow ? trim : 0,
    )
    grow(fmin(r.x0, r.x1), fmin(r.y0, r.y1), fmax(r.x0, r.x1), fmax(r.y0, r.y1))
    if (startArrow && careful) taken.push(r.sx - ARROW, r.sy - ARROW, r.sx + ARROW, r.sy + ARROW)
    if (endArrow && careful) taken.push(r.ex - ARROW, r.ey - ARROW, r.ex + ARROW, r.ey + ARROW)
    const startMarker = startArrow ? marker('arrow_point', r.sx, r.sy, r.sdx, r.sdy, color) : ''
    const endMarker = endArrow ? marker('arrow_point', r.ex, r.ey, r.edx, r.edy, color) : ''
    edgesOut += `<g class="ondine-edge" data-id="${escText(`${rel.from}-${rel.to}`)}"${style.line}><path d="${r.d}"/>${startMarker}${endMarker}</g>`
    routes.push(r)
  }

  // A boundary's heading goes at the left, the middle or the right of its top edge: the first
  // of them no line crosses.
  for (const at of layout.order) {
    const group = layout.groups[at]
    if (group === undefined) continue
    if (!careful || group.headW === 0) continue
    const own = layout.boxes[group.id]
    if (own === undefined) continue
    const top = own.y + HEAD_TOP
    const bottom = own.y + group.head - LANE
    let fewest = Number.POSITIVE_INFINITY
    for (const x of [HEAD_LEFT, (own.w - group.headW) / 2, own.w - HEAD_LEFT - group.headW]) {
      let count = 0
      for (const r of routes) {
        if (crosses(r.points, own.x + x - 4, top, own.x + x + group.headW + 4, bottom)) count += 1
      }
      if (count < fewest) {
        fewest = count
        group.headX = x
      }
      if (count === 0) break
    }
    taken.push(own.x + group.headX - 4, top, own.x + group.headX + group.headW + 4, bottom)
  }

  let labelsOut = ''
  for (let index = 0; index < db.rels.length && index < routes.length; index++) {
    const rel = db.rels[index] as (typeof db.rels)[number]
    const r = routes[index] as Route
    const id = `${rel.from}-${rel.to}`
    const style = userStyle(undefined, undefined, rel.textColor)
    const text: Buf = { s: '' }
    if (db.c4Type === 'C4Dynamic') {
      pushNumber(text, index + 1)
      text.s += ': '
    }
    text.s += rel.label
    const label = layoutLabel(text.s, false, small, r.room, 0, undefined)
    const technText = rel.techn !== undefined && rel.techn !== '' ? `[${rel.techn}]` : undefined
    const techn = layoutLabel(technText, false, small, r.room, ITALIC, undefined)
    const lw = fmax(label.width, techn.width) + 8
    const lh = label.height + techn.height
    if (lh === 0) continue

    // The label sits on the line, or just beside it when another relation runs the opposite
    // way.
    const beside = Math.abs(r.nx) * (lw / 2) + Math.abs(r.ny) * (lh / 2) + 2
    const aside = r.lean === 0 ? beside : fmax(0, fmin(r.lean, beside - 14))
    // Manual offsets are tuned to the original spacing. Reposition compact labels beside
    // their routed arrows so an offset cannot leave them floating outside a boundary.
    let dx = r.nx * aside + (tight ? 0 : offset(rel.offsetX))
    let dy = r.ny * aside + (tight ? 0 : offset(rel.offsetY))
    let at = 0.5
    if (careful) {
      // Slide along the line to the spot that covers least. Offsets from the diagram are
      // kept unless a spot on the line itself covers less than any they lead to: they are
      // often tuned for Mermaid's spacing.
      let least = Number.POSITIVE_INFINITY
      const moved = dx !== r.nx * aside || dy !== r.ny * aside
      const passes = moved ? 2 : 1
      let pass = 0
      while (pass < passes && least > 0) {
        const px = pass === 0 ? dx : r.nx * aside
        const py = pass === 0 ? dy : r.ny * aside
        for (const t of SLIDE) {
          const cx = r.x0 + (r.x1 - r.x0) * t + px
          const cy = r.y0 + (r.y1 - r.y0) * t + py
          const area = covered(taken, cx - lw / 2, cy - lh / 2, cx + lw / 2, cy + lh / 2)
          if (area < least) {
            least = area
            at = t
            dx = px
            dy = py
          }
          if (area === 0) break
        }
        pass += 1
      }
    }
    const cx = r.x0 + (r.x1 - r.x0) * at + dx
    const top = r.y0 + (r.y1 - r.y0) * at + dy - lh / 2
    if (careful) taken.push(cx - lw / 2, top, cx + lw / 2, top + lh)
    grow(cx - lw / 2, top, cx + lw / 2, top + lh)

    const descr = rel.descr !== undefined && rel.descr !== '' ? `<title>${escText(rel.descr)}</title>` : ''
    const rect = `<rect x="${num(cx - lw / 2)}" y="${num(top)}" width="${num(lw)}" height="${num(lh)}" rx="3" fill="var(--_bg)"/>`
    let body = labelSvg(label, cx, top + label.height / 2, style.text, undefined)
    const technAttrs = ` class="ondine-c4-techn" fill="var(--_m)"${style.text}`
    body += labelSvg(techn, cx, top + label.height + techn.height / 2, technAttrs, undefined)
    labelsOut += `<g class="ondine-edge-label" data-id="${escText(id)}">${descr}${rect}${linksLink(links, body, rel.link, id)}</g>`
  }

  const smallText: Buf = { s: '' }
  pushNumber(smallText, small)
  const smallerText: Buf = { s: '' }
  pushNumber(smallerText, small - 1)
  let clusters = ''
  let nodesOut = ''
  for (const at of layout.order) {
    const group = layout.groups[at]
    if (group === undefined) continue
    const boundary = db.boundaries[group.boundary]
    const own = layout.boxes[group.id]
    if (at !== 0 && boundary !== undefined && own !== undefined) {
      const style = userStyle(boundary.bgColor, boundary.borderColor, boundary.fontColor)
      const x = own.x + group.headX
      let y = own.y + HEAD_TOP
      const empty = labelDefault()
      const heading = (k: number): Label => group.labels[k] ?? empty
      let text = leftLabelSvg(
        heading(0),
        x,
        y,
        ` class="ondine-cluster-label" font-weight="var(--_hw)"${style.text}`,
      )
      y += heading(0).height
      text += leftLabelSvg(
        heading(1),
        x,
        y,
        ` class="ondine-c4-type" font-size="${smallText.s}" fill="var(--_m)"${style.text}`,
      )
      y += heading(1).height
      text += leftLabelSvg(
        heading(2),
        x,
        y,
        ` class="ondine-c4-descr" font-size="${smallText.s}" fill="var(--_m)"${style.text}`,
      )
      const deployment = boundary.nodeType !== undefined && boundary.nodeType !== ''
      const dash = deployment ? '' : ' stroke-dasharray="6 4"'
      clusters += `<g class="ondine-cluster ondine-c4-${deployment ? 'node' : 'boundary'}" data-id="${escText(boundary.alias)}"><rect x="${num(own.x)}" y="${num(own.y)}" width="${num(own.w)}" height="${num(own.h)}" rx="${RADIUS}" fill="none" stroke="var(--_b)"${dash}${style.shape}/>${linksLink(links, text, boundary.link, boundary.alias)}</g>`
    }
    for (const node of group.nodes) {
      const shape = db.shapes[node.shape]
      const own = layout.boxes[node.id]
      if (shape === undefined || own === undefined) continue
      const external = shape.kind.startsWith('external')
      const style = userStyle(shape.bgColor, shape.borderColor, shape.fontColor)
      let stroke = ' stroke="var(--_b)"'
      if (external) stroke += ' stroke-dasharray="4 3"'
      const w = own.w
      const h = own.h
      const form = own.form
      const labels = node.labels
      const dx = form === Form.HCyl ? -queueRx(h) / 2 : 0
      const dy = form === Form.Person ? HEAD / 2 : form === Form.Cyl ? cylRy(w) / 2 : 0
      const muted = ` fill="var(--_m)"${style.text}`
      let y = dy - node.textH / 2
      let text = labelSvg(
        labels[0],
        dx,
        y + labels[0].height / 2,
        ` class="ondine-c4-type" font-size="${smallerText.s}"${muted}`,
        undefined,
      )
      y += labels[0].height
      text += labelSvg(
        labels[1],
        dx,
        y + labels[1].height / 2,
        ` class="ondine-label" font-weight="var(--_hw)"${style.text}`,
        undefined,
      )
      y += labels[1].height
      text += labelSvg(
        labels[2],
        dx,
        y + labels[2].height / 2,
        ` class="ondine-c4-techn" font-size="${smallText.s}"${muted}`,
        undefined,
      )
      y += labels[2].height + 4
      text += labelSvg(
        labels[3],
        dx,
        y + labels[3].height / 2,
        ` class="ondine-c4-descr" font-size="${smallText.s}"${style.text}`,
        undefined,
      )
      const name = formName(form)
      const head = `<g class="ondine-node ondine-shape-${name} ondine-c4-${shape.kind}${external ? ' ondine-c4-external' : ''}" data-id="${escText(shape.alias)}" transform="translate(${num(own.x + w / 2)},${num(own.y + h / 2)})">`
      const fill = ` fill="var(${external ? '--_bg' : '--_s'})"${stroke}${style.shape}`
      let body = drawShape(name, w, h, fill, stroke + style.line)
      body += text
      nodesOut += `${head}${linksLink(links, body, shape.link, shape.alias)}</g>`
    }
  }

  const title = layoutLabel(db.title, false, size, tight ? titleRoom(options) : 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const inner = fmax(maxX - minX, title.width)
  const width = Math.ceil(inner + 2 * pad)
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad)
  const ox = pad - minX + (inner - (maxX - minX)) / 2
  const oy = pad + titleHeight - minY

  const titleSvg = labelSvg(title, width / 2, pad + title.height / 2, ' class="ondine-title" font-weight="var(--_tw)"', undefined)
  const clustersSvg = clusters !== '' ? `<g class="ondine-clusters">${clusters}</g>` : ''
  const edgesSvg =
    edgesOut !== '' ? `<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>` : ''
  const nodesSvg = nodesOut !== '' ? `<g class="ondine-nodes">${nodesOut}</g>` : ''
  const labelsSvg = labelsOut !== '' ? `<g class="ondine-edge-labels" font-size="${smallText.s}">${labelsOut}</g>` : ''
  const content = `${titleSvg}<g transform="translate(${num(ox)},${num(oy)})">${clustersSvg}${edgesSvg}${nodesSvg}${labelsSvg}</g>`

  const svg = svgDocument(
    'c4',
    width,
    height,
    size,
    options,
    { accDescr: db.accDescr, accTitle: db.accTitle },
    content,
  )
  return [{ height, links: links.links, svg, width }, lanes.squeezed]
}
