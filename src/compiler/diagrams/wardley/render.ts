/**
 * @module Draws a Wardley map: the evolution axis with its stages, components, links, pipelines,
 * trends, annotations, notes, and forces. Port of Pele's `src/diagrams/wardley/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { esc, escText, jsRound, labelSvg, num, pushNum, sharedStyle, spanStyle, textStyle } from '../../svg/builder.ts'
import { marker, markerTrim } from '../../svg/edges.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { buf, type Buf, fmax, fmin, midpoint, partialCmp } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'
import { fitWidth } from '../common/fit_width.ts'
import { Flow, type WardleyNode } from './builder.ts'
import type { WardleyModel } from './model.ts'

/** The stages when the map names none. */
const DEFAULT_STAGES = ['Genesis', 'Custom Built', 'Product', 'Commodity']
/** Mermaid's canvas has this much room around the plot on every side. */
const CANVAS_MARGIN = 48
/** The radius of a component. */
const R = 6
/** The side of a pipeline parent's square. */
const SQUARE = 10
/** How far a label sits from its component. */
const LABEL_OFFSET = 8
/** Room in a pipeline box beside its outer components. */
const PIPELINE_PAD = 15
/** The length of a force arrow. */
const FORCE_WIDTH = 60
/** The thickness of a force arrow's body. */
const FORCE_HEIGHT = 30
/** The length of a force arrow's head. */
const FORCE_HEAD = 20
/** The color of trends. */
const ACCENT = 'var(--_c)'
/** The color of lines. */
const LINE = 'var(--_l)'

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** A number setting of the `wardley-beta` section within `min` and `max`, or `fallback`. */
function setting(config: Value, key: string, fallback: number, min: number, max: number): number {
  const section = property(config, 'wardley-beta')
  const value = section === undefined ? undefined : property(section, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= min && value._0 <= max) return value._0
  return fallback
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/** The plot's side from the map's own size, the configuration, or `fallback`. */
function dimension(config: Value, given: number | undefined, key: string, fallback: number): number {
  const value = given !== undefined && Number.isFinite(given) ? given : setting(config, key, fallback, 1, 1e6)
  return clamp(value, 200, 10000) - 2 * CANVAS_MARGIN
}

/** Writes a label with its lines starting at `x` and its first baseline at `y`. */
function startLabel(label: Label, x: number, y: number, attrs: string): string {
  const shared = sharedStyle(label)
  const body = buf()
  let baseline = y
  for (const line of label.lines) {
    let first = true
    for (const span of line) {
      if (span.icon !== undefined) continue
      body.s += '<tspan'
      if (first) {
        body.s += ' x="'
        pushNum(body, x)
        body.s += '" y="'
        pushNum(body, baseline)
        body.s += '"'
      }
      body.s += spanStyle(span.style & ~shared)
      body.s += '>'
      body.s += esc(span.text)
      body.s += '</tspan>'
      first = false
    }
    baseline += label.lineHeight
  }
  if (body.s === '') return body.s
  return `<text${textStyle(attrs, shared)} xml:space="preserve">${body.s}</text>`
}

/** Draws `model` with the `wardley-beta` section of `config`, narrowed to fit the host's width. */
export function render(model: WardleyModel, config: Value, options: RenderOptions): Rendered {
  const natural = dimension(config, model.build.size?.[0], 'width', 900)
  return fitWidth(options, natural, 160, (plotW, tight) => draw(model, config, options, plotW, natural, tight))
}

/** The extent of what is drawn. */
type Bounds = {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

function boundsGrow(bounds: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < bounds.minX) bounds.minX = x0
  if (y0 < bounds.minY) bounds.minY = y0
  if (x1 > bounds.maxX) bounds.maxX = x1
  if (y1 > bounds.maxY) bounds.maxY = y1
}

/** A label centered on (`cx`, `cy`). */
function boundsCentered(bounds: Bounds, label: Label, cx: number, cy: number, attrs: string): string {
  boundsGrow(bounds, cx - label.width / 2, cy - label.height / 2, cx + label.width / 2, cy + label.height / 2)
  return labelSvg(label, cx, cy, attrs, undefined)
}

/** A label starting at `x` with its first baseline at `y`. */
function boundsStarting(bounds: Bounds, label: Label, x: number, y: number, attrs: string): string {
  boundsGrow(bounds, x, y - label.size, x + label.width, y - label.size + label.height + 4)
  return startLabel(label, x, y, attrs)
}

/** ` class="…" font-size="{size}"` and the rest of `tail`. */
function sized(head: string, size: number, tail: string): string {
  const out = buf(head)
  out.s += ' font-size="'
  pushNumber(out, size)
  out.s += '"'
  out.s += tail
  return out.s
}

/** How far from a node's center a line to it stops, along (`ux`, `uy`). */
function reach(node: WardleyNode, anchorLabel: Label | undefined, small: number, ux: number, uy: number): number {
  if (node.className === 'anchor') {
    const width = anchorLabel === undefined ? 0 : anchorLabel.width
    return 1 / Math.hypot(ux / (width / 2 + 5), uy / (small * 0.8))
  }
  if (node.isPipelineParent) return SQUARE / Math.SQRT2
  return node.sourceStrategy !== undefined && node.sourceStrategy !== '' ? 2 * R : R
}

/**
 * The quadrant bit a link along (`ux`, `uy`) takes: 1 up and right, 2 down and right, 4 up and
 * left, 8 down and left. Nearly straight links take none.
 */
function quadrant(ux: number, uy: number): number {
  if (Math.abs(ux) < 0.25 || Math.abs(uy) < 0.25) return 0
  if (ux > 0) return uy < 0 ? 1 : 2
  return uy < 0 ? 4 : 8
}

/** Appends `x,y`. */
function pushPair(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

function draw(
  model: WardleyModel,
  config: Value,
  options: RenderOptions,
  plotW: number,
  naturalW: number,
  tight: boolean,
): Rendered {
  const build = model.build
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.8125)
  const tiny = jsRound(size * 0.6875)
  const pad = options.padding ?? 8

  // A narrower map is not as much shorter, so that components keep some room between them.
  const plotH = dimension(config, build.size?.[1], 'height', 600) * fmax(0.75, plotW / naturalW)
  const section = property(config, 'wardley-beta')
  const grid = section === undefined ? undefined : property(section, 'showGrid')
  const showGrid = grid !== undefined && grid.kind === 'Bool' && grid._0

  const bounds: Bounds = { maxX: plotW, maxY: plotH, minX: 0, minY: 0 }
  const wrap = tight ? fmax(64, fmin(120, plotW / 2)) : 4000
  const text = (raw: string, fontSize: number, maxWidth: number, style: number): Label =>
    layoutLabel(raw, false, fontSize, maxWidth, style, undefined)
  const projectX = (value: number): number => (value / 100) * plotW
  const projectY = (value: number): number => plotH - (value / 100) * plotH

  const ownStages = build.axes.stages
  const stages: string[] = ownStages !== undefined && ownStages.length > 0 ? ownStages : DEFAULT_STAGES
  const ownBoundaries = build.axes.stageBoundaries
  const boundaries = ownBoundaries !== undefined && ownBoundaries.length === stages.length ? ownBoundaries : undefined
  const count = stages.length
  const frame = buf()
  let stageLabels = ''
  let stageBottom = plotH
  let previous = 0
  const stageAttrs = sized(' class="ondine-wardley-stage-label"', small, ' fill="var(--_m)"')
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index] as string
    const i = index
    let start: number
    let end: number
    if (boundaries !== undefined) {
      start = previous
      end = clamp(boundaries[index] ?? Number.NaN, 0, 1)
    } else {
      start = i / count
      end = (i + 1) / count
    }
    previous = end
    if (index > 0) {
      frame.s += '<path class="ondine-wardley-stage" d="M'
      pushNum(frame, start * plotW)
      frame.s += ',0V'
      pushNum(frame, plotH)
      frame.s += '" stroke="var(--_b)" stroke-dasharray="4 4"/>'
    }
    const label = text(stage, small, fmax(48, Math.abs(end - start) * plotW - 12), 0)
    stageLabels += boundsCentered(
      bounds,
      label,
      midpoint(start, end) * plotW,
      plotH + 8 + label.height / 2,
      stageAttrs,
    )
    stageBottom = fmax(stageBottom, plotH + 8 + label.height)
  }
  if (showGrid) {
    for (let i = 1; i < 4; i++) {
      frame.s += '<path class="ondine-wardley-grid" d="M'
      pushNum(frame, (plotW * i) / 4)
      frame.s += ',0V'
      pushNum(frame, plotH)
      frame.s += 'M0,'
      pushNum(frame, (plotH * i) / 4)
      frame.s += 'H'
      pushNum(frame, plotW)
      frame.s += '" stroke="var(--_b)" stroke-dasharray="2 6"/>'
    }
  }
  frame.s += '<path class="ondine-wardley-axis" d="M0,0V'
  pushNum(frame, plotH)
  frame.s += 'H'
  pushNum(frame, plotW)
  frame.s += '" stroke="'
  frame.s += LINE
  frame.s += '"/>'
  const xTitle = text('Evolution', small, wrap, 0)
  const yTitle = text('Visibility', small, wrap, 0)
  const axisAttrs = sized(' class="ondine-wardley-axis-label"', small, ' font-weight="var(--_hw)"')
  let axisLabels = boundsCentered(bounds, xTitle, plotW / 2, stageBottom + 6 + xTitle.height / 2, axisAttrs)
  const rotated = buf(axisAttrs)
  rotated.s += ' transform="rotate(-90 -16 '
  pushNum(rotated, plotH / 2)
  rotated.s += ')"'
  axisLabels += labelSvg(yTitle, -16, plotH / 2, rotated.s, undefined)
  boundsGrow(bounds, -16 - yTitle.height / 2, 0, 0, 0)
  const legendTop = stageBottom + 6 + xTitle.height + 10

  const nodes = build.nodes
  const ids = new Map<string, number>()
  const positions: [number, number][] = []
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at] as WardleyNode
    ids.set(node.id, at)
    positions.push([projectX(node.x), projectY(node.y)])
  }

  // Pipelines: a box around the components, with the parent as a square on its top edge.
  const pipelines = buf()
  const members = new Map<string, Set<string>>()
  for (const pipeline of build.pipelines) {
    members.set(pipeline.nodeId, new Set(pipeline.componentIds))
    const parts: [number, number][] = []
    for (const id of pipeline.componentIds) {
      const at = ids.get(id)
      const position = at === undefined ? undefined : positions[at]
      if (position !== undefined) parts.push([position[0], position[1]])
    }
    if (parts.length === 0) continue
    parts.sort((a, b) => partialCmp(a[0], b[0]))
    const first = parts[0]
    const last = parts[parts.length - 1]
    if (first === undefined || last === undefined) continue
    const [left, y] = first
    const right = last[0]
    const top = y - 2 * R
    const parentAt = ids.get(pipeline.nodeId)
    if (parentAt !== undefined && parentAt < positions.length) {
      positions[parentAt] = [midpoint(left, right), top - SQUARE / 6]
    }
    boundsGrow(bounds, left - PIPELINE_PAD, top, right + PIPELINE_PAD, top + 4 * R)
    pipelines.s += '<g class="ondine-wardley-pipeline" data-id="'
    pipelines.s += escText(pipeline.nodeId)
    pipelines.s += '"><rect x="'
    pushNum(pipelines, left - PIPELINE_PAD)
    pipelines.s += '" y="'
    pushNum(pipelines, top)
    pipelines.s += '" width="'
    pushNum(pipelines, right - left + 2 * PIPELINE_PAD)
    pipelines.s += '" height="'
    pushNum(pipelines, 4 * R)
    pipelines.s += '" rx="'
    pipelines.s += RADIUS
    pipelines.s += '" fill="var(--_s)" stroke="var(--_b)"/>'
    if (parts.length > 1) {
      pipelines.s += '<path d="M'
      pushPair(pipelines, left, y)
      pipelines.s += 'H'
      pushNum(pipelines, right)
      pipelines.s += '" stroke="'
      pipelines.s += LINE
      pipelines.s += '" stroke-dasharray="4 4"/>'
    }
    pipelines.s += '</g>'
  }

  // Anchor labels, measured once when a line first reaches the anchor.
  const anchorWrap = tight ? fmax(64, plotW / 2) : 4000
  const anchorLabels: (Label | undefined)[] = []
  for (let at = 0; at < nodes.length; at++) anchorLabels.push(undefined)
  const reachOf = (at: number, ux: number, uy: number): number => {
    const node = nodes[at]
    if (node === undefined) return R
    if (node.className === 'anchor' && at < anchorLabels.length && anchorLabels[at] === undefined) {
      anchorLabels[at] = text(node.label, small, anchorWrap, BOLD)
    }
    const label = anchorLabels[at]
    return reach(node, label, small, ux, uy)
  }

  const taken: number[] = []
  for (let at = 0; at < nodes.length; at++) taken.push(0)
  const links = buf()
  const edgeLabelAttrs = sized(' class="ondine-edge-label"', tiny + 1, ' fill="var(--_m)"')
  for (const link of build.links) {
    const from = ids.get(link.source)
    const to = ids.get(link.target)
    if (from === undefined || to === undefined) continue
    if (from === to) continue
    // A pipeline component belongs to its parent already.
    if (members.get(link.target)?.has(link.source) === true) continue
    const fromAt = positions[from]
    const toAt = positions[to]
    if (fromAt === undefined || toAt === undefined) continue
    const [fx, fy] = fromAt
    const [tx, ty] = toAt
    const dx = tx - fx
    const dy = ty - fy
    const distance = Math.hypot(dx, dy)
    if (distance < 0.01) continue
    const ux = dx / distance
    const uy = dy / distance
    const start = reachOf(from, ux, uy)
    const end = reachOf(to, ux, uy)
    if (start + end >= distance) continue
    if (from < taken.length) taken[from] = (taken[from] as number) | quadrant(ux, uy)
    if (to < taken.length) taken[to] = (taken[to] as number) | quadrant(-ux, -uy)
    let x1 = fx + ux * start
    let y1 = fy + uy * start
    let x2 = tx - ux * end
    let y2 = ty - uy * end
    let heads = ''
    const trim = markerTrim('arrow_point')
    if (link.flow === Flow.Forward || link.flow === Flow.Bidirectional) {
      heads += marker('arrow_point', x2, y2, ux, uy, LINE)
      x2 -= ux * trim
      y2 -= uy * trim
    }
    if (link.flow === Flow.Backward || link.flow === Flow.Bidirectional) {
      heads += marker('arrow_point', x1, y1, -ux, -uy, LINE)
      x1 += ux * trim
      y1 += uy * trim
    }
    let caption = ''
    const textValue = link.label
    if (textValue !== undefined && textValue !== '') {
      const label = text(textValue, tiny + 1, 200, 0)
      // Beside the middle of the line, on its upper side.
      const side = ux >= 0 ? 1 : -1
      const px = uy * side
      const py = -ux * side
      const away = 5 + (Math.abs(px) * label.width) / 2 + (Math.abs(py) * label.height) / 2
      caption = boundsCentered(
        bounds,
        label,
        midpoint(fx, tx) + px * away,
        midpoint(fy, ty) + py * away,
        edgeLabelAttrs,
      )
    }
    links.s += `<g class="ondine-edge${link.dashed ? ' ondine-wardley-dashed' : ''}" data-id="${escText(link.source)}-${escText(link.target)}"><path d="M${num(x1)},${num(y1)}L${num(x2)},${num(y2)}" stroke="${LINE}"${link.dashed ? ' stroke-dasharray="6 6"' : ''}/>${heads}${caption}</g>`
  }

  // Evolution: a dashed arrow to where the component is heading, drawn as an open circle.
  const trends = buf()
  for (const trend of build.trends) {
    const at = ids.get(trend.nodeId)
    if (at === undefined) continue
    const origin = positions[at]
    if (origin === undefined) continue
    const [ox, oy] = origin
    const tx = projectX(trend.targetX)
    const ty = projectY(trend.targetY)
    const dx = tx - ox
    const dy = ty - oy
    const distance = Math.hypot(dx, dy)
    const arrow = buf()
    const start = distance > 0 ? reachOf(at, dx / distance, dy / distance) : 0
    if (distance > start + R + 4) {
      const ux = dx / distance
      const uy = dy / distance
      const ex = tx - ux * (R + 2)
      const ey = ty - uy * (R + 2)
      const trim = markerTrim('arrow_point')
      arrow.s += '<path d="M'
      pushPair(arrow, ox + ux * start, oy + uy * start)
      arrow.s += 'L'
      pushPair(arrow, ex - ux * trim, ey - uy * trim)
      arrow.s += '" stroke="'
      arrow.s += ACCENT
      arrow.s += '" stroke-dasharray="4 4"/>'
      arrow.s += marker('arrow_point', ex, ey, ux, uy, ACCENT)
    }
    boundsGrow(bounds, tx - R, ty - R, tx + R, ty + R)
    trends.s += '<g class="ondine-wardley-trend" data-id="'
    trends.s += escText(trend.nodeId)
    trends.s += '">'
    trends.s += arrow.s
    trends.s += '<circle cx="'
    pushNum(trends, tx)
    trends.s += '" cy="'
    pushNum(trends, ty)
    trends.s += '" r="6" fill="var(--_bg)" stroke="'
    trends.s += ACCENT
    trends.s += '"/></g>'
  }

  const drawnNodes = buf()
  const anchorAttrs = sized(' class="ondine-label"', small, ' font-weight="var(--_hw)"')
  const labelAttrs = sized(' class="ondine-label"', small, '')
  const tri = 1.2 * R
  const dot = 0.7 * R
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at] as WardleyNode
    const position = positions[at]
    if (position === undefined) continue
    const [x, y] = position
    const anchor = node.className === 'anchor'
    const strategy = node.sourceStrategy !== undefined && node.sourceStrategy !== '' ? node.sourceStrategy : undefined
    const shape = buf()
    if (strategy !== undefined) {
      let fill: string
      switch (strategy) {
        case 'outsource':
          fill = 'var(--_m)'
          break
        case 'buy':
          fill = 'var(--_a)'
          break
        case 'build':
          fill = 'var(--_s)'
          break
        default:
          fill = 'var(--_bg)'
      }
      shape.s += `<circle class="ondine-wardley-${strategy}" cx="${num(x)}" cy="${num(y)}" r="12" fill="${fill}" stroke="${LINE}"/>`
    }
    if (strategy === 'market') {
      const bx = tri * Math.cos(Math.PI / 6)
      const by = y + tri * Math.sin(Math.PI / 6)
      shape.s += '<path d="M'
      pushPair(shape, x, y - tri)
      shape.s += 'L'
      pushPair(shape, x - bx, by)
      shape.s += 'H'
      pushNum(shape, x + bx)
      shape.s += 'Z" fill="none" stroke="'
      shape.s += LINE
      shape.s += '"/>'
      const corners: [number, number][] = [
        [x, y - tri],
        [x - bx, by],
        [x + bx, by],
      ]
      for (const [cx, cy] of corners) {
        shape.s += '<circle cx="'
        pushNum(shape, cx)
        shape.s += '" cy="'
        pushNum(shape, cy)
        shape.s += '" r="'
        pushNum(shape, dot)
        shape.s += '" fill="var(--_bg)" stroke="'
        shape.s += LINE
        shape.s += '"/>'
      }
    } else if (node.isPipelineParent) {
      shape.s += '<rect x="'
      pushNum(shape, x - SQUARE / 2)
      shape.s += '" y="'
      pushNum(shape, y - SQUARE / 2)
      shape.s += '" width="10" height="10" fill="var(--_bg)" stroke="'
      shape.s += LINE
      shape.s += '"/>'
    } else if (!anchor) {
      shape.s += `<circle cx="${num(x)}" cy="${num(y)}" r="6" fill="var(--_bg)" stroke="${LINE}"/>`
    }
    if (node.inertia === true) {
      const offset = (node.isPipelineParent ? SQUARE / 2 : R) + 10 + (strategy !== undefined ? R + 4 : 0)
      shape.s += '<rect class="ondine-wardley-inertia" x="'
      pushNum(shape, x + offset)
      shape.s += '" y="'
      pushNum(shape, y - R)
      shape.s += '" width="4" height="12" fill="'
      shape.s += LINE
      shape.s += '"/>'
    }
    const ox = node.labelOffsetX === undefined ? undefined : clamp(node.labelOffsetX, -5000, 5000)
    const oy = node.labelOffsetY === undefined ? undefined : clamp(node.labelOffsetY, -5000, 5000)
    let caption: string
    if (anchor) {
      const label = anchorLabels[at] ?? text(node.label, small, anchorWrap, BOLD)
      caption = boundsCentered(
        bounds,
        label,
        x + (ox ?? 0),
        y + (oy ?? -3),
        anchorAttrs,
      )
    } else {
      const label = text(node.label, small, wrap, 0)
      const attrs = labelAttrs
      const lift = LABEL_OFFSET + (strategy !== undefined ? 10 : 0)
      if (ox !== undefined || oy !== undefined) {
        caption = boundsStarting(bounds, label, x + (ox ?? lift), y + (oy ?? -lift), attrs)
      } else if (node.inPipeline) {
        caption = boundsCentered(bounds, label, x, y + 2 * R + 4 + label.height / 2, attrs)
      } else {
        // The label goes up and to the right unless a link leaves that way; then the next
        // free corner.
        const busy = taken[at] ?? 0
        let corner = 1
        if ((busy & 1) === 0) corner = 1
        else if ((busy & 2) === 0) corner = 2
        else if ((busy & 4) === 0) corner = 4
        else if ((busy & 8) === 0) corner = 8
        const right = corner === 1 || corner === 2
        const up = corner === 1 || corner === 4
        caption = boundsStarting(
          bounds,
          label,
          right ? x + lift : x - lift - label.width,
          up ? y - lift : y + lift + small * 0.75,
          attrs,
        )
      }
    }
    boundsGrow(bounds, x - 2 * R, y - 2 * R, x + 2 * R + 20, y + 2 * R)
    const kind = anchor
      ? 'anchor'
      : node.isPipelineParent
        ? 'pipeline-parent'
        : node.inPipeline
          ? 'pipeline-component'
          : 'component'
    drawnNodes.s += `<g class="ondine-node ondine-wardley-${kind}" data-id="${escText(node.id)}">${shape.s}${caption}</g>`
  }

  const annotations = buf()
  const markAttrs = sized('', tiny, ' font-weight="var(--_hw)"')
  for (const annotation of build.annotations) {
    const number = buf()
    pushNumber(number, annotation.number)
    const label = text(number.s, tiny, 4000, BOLD)
    const marks = buf()
    for (const [cx, cy] of annotation.coordinates) {
      const x = projectX(cx)
      const y = projectY(cy)
      const r = fmax(10, label.width / 2 + 4)
      boundsGrow(bounds, x - r, y - r, x + r, y + r)
      marks.s += '<circle cx="'
      pushNum(marks, x)
      marks.s += '" cy="'
      pushNum(marks, y)
      marks.s += '" r="'
      pushNum(marks, r)
      marks.s += '" fill="var(--_bg)" stroke="'
      marks.s += LINE
      marks.s += '"/>'
      marks.s += labelSvg(label, x, y, markAttrs, undefined)
    }
    annotations.s += '<g class="ondine-wardley-annotation" data-id="'
    annotations.s += escText(number.s)
    annotations.s += '">'
    annotations.s += marks.s
    annotations.s += '</g>'
  }
  const listed: [number, string][] = []
  for (const annotation of build.annotations) {
    const body = annotation.text
    if (body !== undefined && body !== '') listed.push([annotation.number, body])
  }
  if (listed.length > 1) listed.sort((a, b) => partialCmp(a[0] - b[0], 0))
  if (listed.length > 0) {
    const listWrap = tight ? fmax(80, plotW - 20) : 320
    const lines: Label[] = listed.map(([number, body]) => {
      const line = buf()
      pushNumber(line, number)
      line.s += '. '
      line.s += body
      return text(line.s, small, listWrap, 0)
    })
    let width = 0
    let height = 0
    for (const line of lines) {
      width = fmax(width, line.width)
      height += line.height
    }
    width += 20
    height += 14
    // Without a position the list goes under the map, where it covers nothing.
    let bx: number
    let by: number
    const box = build.annotationsBox
    if (box !== undefined) {
      bx = clamp(projectX(box[0]), 0, fmax(0, plotW - width))
      by = clamp(projectY(box[1]), 0, fmax(0, plotH - height))
    } else {
      bx = 0
      by = legendTop
    }
    boundsGrow(bounds, bx, by, bx + width, by + height)
    let rows = ''
    let y = by + 7
    const attrs = sized('', small, '')
    for (const line of lines) {
      rows += startLabel(line, bx + 10, y + line.lineHeight / 2 + small * 0.35, attrs)
      y += line.height
    }
    annotations.s += '<g class="ondine-wardley-annotations"><rect x="'
    pushNum(annotations, bx)
    annotations.s += '" y="'
    pushNum(annotations, by)
    annotations.s += '" width="'
    pushNum(annotations, width)
    annotations.s += '" height="'
    pushNum(annotations, height)
    annotations.s += '" rx="'
    annotations.s += RADIUS
    annotations.s += '" fill="var(--_bg)" stroke="var(--_b)"/>'
    annotations.s += rows
    annotations.s += '</g>'
  }

  let notes = ''
  const noteAttrs = sized(' class="ondine-wardley-note"', small, ' font-weight="var(--_hw)"')
  for (const note of build.notes) {
    const label = text(note.text, small, fmin(360, plotW * 0.6), BOLD)
    notes += boundsStarting(bounds, label, projectX(note.x), projectY(note.y), noteAttrs)
  }

  // Accelerators point right, deaccelerators left.
  const forces = buf()
  const forceAttrs = sized('', tiny + 1, ' font-weight="var(--_hw)"')
  for (let pass = 0; pass < 2; pass++) {
    const forward = pass === 0
    const list = forward ? build.accelerators : build.deaccelerators
    for (const force of list) {
      const x = projectX(force.x)
      const y = projectY(force.y)
      const half = FORCE_HEIGHT / 2
      const [tip, tail, neck] = forward
        ? [x + FORCE_WIDTH, x, x + FORCE_WIDTH - FORCE_HEAD]
        : [x, x + FORCE_WIDTH, x + FORCE_HEAD]
      boundsGrow(bounds, x, y - half - 8, x + FORCE_WIDTH, y + half + 8)
      forces.s += '<g class="ondine-wardley-'
      forces.s += forward ? 'accelerator' : 'deaccelerator'
      forces.s += '" data-id="'
      forces.s += escText(force.name)
      forces.s += '"><path d="M'
      pushPair(forces, tail, y - half)
      forces.s += 'H'
      pushNum(forces, neck)
      forces.s += 'V'
      pushNum(forces, y - half - 8)
      forces.s += 'L'
      pushPair(forces, tip, y)
      forces.s += 'L'
      pushPair(forces, neck, y + half + 8)
      forces.s += 'V'
      pushNum(forces, y + half)
      forces.s += 'H'
      pushNum(forces, tail)
      forces.s += 'Z" fill="var(--_s)" stroke="'
      forces.s += LINE
      forces.s += '"/>'
      const label = text(force.name, tiny + 1, 160, BOLD)
      forces.s += boundsCentered(bounds, label, x + FORCE_WIDTH / 2, y + half + 8 + 12, forceAttrs)
      forces.s += '</g>'
    }
  }

  const title = layoutLabel(model.title, false, size, tight ? fmax(80, plotW) : 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const left = fmin(bounds.minX, plotW / 2 - title.width / 2)
  const right = fmax(bounds.maxX, plotW / 2 + title.width / 2)
  const tx = pad - left
  const ty = pad + titleHeight - bounds.minY
  const totalWidth = Math.ceil(right - left + 2 * pad)
  const totalHeight = Math.ceil(bounds.maxY - bounds.minY + titleHeight + 2 * pad)

  const content = buf(
    labelSvg(title, tx + plotW / 2, pad + title.height / 2, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  )
  content.s += '<g transform="translate('
  pushPair(content, tx, ty)
  content.s += ')"><g class="ondine-wardley-frame" fill="none">'
  content.s += frame.s
  content.s += '</g>'
  content.s += stageLabels
  content.s += axisLabels
  content.s += pipelines.s
  if (links.s !== '') {
    content.s += '<g class="ondine-edges" fill="none">'
    content.s += links.s
    content.s += '</g>'
  }
  if (trends.s !== '') {
    content.s += '<g class="ondine-wardley-trends" fill="none">'
    content.s += trends.s
    content.s += '</g>'
  }
  content.s += drawnNodes.s
  content.s += annotations.s
  content.s += notes
  content.s += forces.s
  content.s += '</g>'

  return {
    height: totalHeight,
    links: [],
    svg: svgDocument(
      'wardley',
      totalWidth,
      totalHeight,
      size,
      options,
      { accDescr: model.accDescr, accTitle: model.accTitle },
      content.s,
    ),
    width: totalWidth,
  }
}
