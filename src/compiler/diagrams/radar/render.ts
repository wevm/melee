/**
 * @module Draws a radar chart: a graticule, axes, one closed curve per series, and a legend. Port
 * of Pele's `src/diagrams/radar/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { seriesColor } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { type Buf, buf, fmax, fmin } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'
import { fitWidth, titleRoom } from '../common/fit_width.ts'
import type { RadarModel } from './model.ts'

/** The side of a legend swatch. */
const SWATCH = 12
/** The height of a legend row. */
const ROW = 26
/** The space between the chart and its legend. */
const GAP = 24

/** A point of the chart, around its center. */
type Point = {
  x: number
  y: number
}

/**
 * The `radar` option `key` of `config` when it is a number at least `min`, capped at `max`, or
 * `fallback`.
 */
function option(config: Value, key: string, fallback: number, min: number, max: number): number {
  const radar = property(config, 'radar')
  const value = radar === undefined ? undefined : property(radar, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= min) return fmin(value._0, max)
  return fallback
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** The distance from the center of `value` between `min` at the center and `max` at `radius`. */
function relativeRadius(value: number, min: number, max: number, radius: number): number {
  const clipped = fmin(fmax(value, min), max)
  return (radius * (clipped - min)) / (max - min)
}

/** Appends `x,y`. */
function pushPoint(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

/** A closed Catmull-Rom spline through the points, as cubic Bézier segments. */
function closedRoundCurve(points: Point[], tension: number): string {
  const n = points.length
  const first = points[0]
  if (first === undefined) return 'M'
  let d = `M${num(first.x)},${num(first.y)}`
  for (let i = 0; i < n; i++) {
    const p0 = points[(i + n - 1) % n] as Point
    const p1 = points[i % n] as Point
    const p2 = points[(i + 1) % n] as Point
    const p3 = points[(i + 2) % n] as Point
    d += ` C${num(p1.x + (p2.x - p0.x) * tension)},${num(p1.y + (p2.y - p0.y) * tension)} ${num(p2.x - (p3.x - p1.x) * tension)},${num(p2.y - (p3.y - p1.y) * tension)} ${num(p2.x)},${num(p2.y)}`
  }
  d += ' Z'
  return d
}

/** The `points` attribute of a polygon through `points`. */
function polygon(points: Point[]): string {
  let out = ''
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point
    out += i === 0 ? `${num(p.x)},${num(p.y)}` : ` ${num(p.x)},${num(p.y)}`
  }
  return out
}

/** Draws `model` with the `radar` section of `config`, narrowed to fit the host's width. */
export function render(model: RadarModel, config: Value, options: RenderOptions): Rendered {
  const natural = option(config, 'width', 320, 1, 4000)
  return fitWidth(options, natural, 160, (width, tight) => {
    const height = (option(config, 'height', 320, 1, 4000) * width) / natural
    return draw(model, config, options, width, height, tight)
  })
}

/** `tight` is set when the chart does not fit the width it has with its legend beside it. */
function draw(
  model: RadarModel,
  config: Value,
  options: RenderOptions,
  width: number,
  height: number,
  tight: boolean,
): Rendered {
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8

  const axisScale = option(config, 'axisScaleFactor', 1, 0, 10)
  const labelFactor = option(config, 'axisLabelFactor', 1.05, 0, 10)
  const tension = option(config, 'curveTension', 0.17, 0, 1)
  const radius = fmin(width, height) / 2

  const axes = model.axes
  const curves = model.curves
  const ticks = model.options.ticks
  const circle = model.options.graticule === 'circle'
  const min = model.options.min
  const count = axes.length
  const unit: Point[] = axes.map((_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })

  const max =
    model.options.max ??
    (() => {
      let max = Number.NEGATIVE_INFINITY
      for (const curve of curves) {
        for (const value of curve.entries) {
          if (value > max) max = value
        }
      }
      return max
    })()

  // The chart is drawn around the origin. Margins reserve space; labels and the legend widen it.
  let x0 = -width / 2 - option(config, 'marginLeft', 16, 0, 2000)
  let x1 = width / 2 + option(config, 'marginRight', 16, 0, 2000)
  let y0 = -height / 2 - option(config, 'marginTop', 16, 0, 2000)
  let y1 = height / 2 + option(config, 'marginBottom', 16, 0, 2000)

  const grid = buf()
  let i = 0
  while (i < ticks) {
    const r = fmin(radius, (radius * (i + 1)) / ticks)
    if (circle) {
      grid.s += '<circle r="'
      pushNum(grid, r)
      grid.s += '"/>'
    } else {
      const points: Point[] = unit.map((u) => ({ x: u.x * r, y: u.y * r }))
      grid.s += '<polygon points="'
      grid.s += polygon(points)
      grid.s += '"/>'
    }
    i += 1
  }

  const spokes = buf()
  let labels = ''
  const pairs = Math.min(unit.length, axes.length)
  for (let k = 0; k < pairs; k++) {
    const u = unit[k] as Point
    const axis = axes[k] as RadarModel['axes'][number]
    const reach = radius * axisScale
    spokes.s += 'M0,0L'
    pushPoint(spokes, u.x * reach, u.y * reach)
    const label = layoutLabel(axis.label, false, small, 4000, 0, undefined)
    const at = radius * labelFactor + 6
    // Each label hangs off its axis on the side away from the center.
    const away = (along: number, extent: number): number => {
      if (along > 0.01) return extent / 2
      if (along < -0.01) return -extent / 2
      return 0
    }
    const cx = u.x * at + away(u.x, label.width)
    const cy = u.y * at + away(u.y, label.height)
    labels += '<g class="ondine-axis-label" data-id="'
    labels += escText(axis.name)
    labels += '">'
    labels += labelSvg(label, cx, cy, '', undefined)
    labels += '</g>'
    x0 = fmin(x0, cx - label.width / 2)
    x1 = fmax(x1, cx + label.width / 2)
    y0 = fmin(y0, cy - label.height / 2)
    y1 = fmax(y1, cy + label.height / 2)
  }

  let shapes = ''
  for (let index = 0; index < curves.length; index++) {
    const curve = curves[index] as RadarModel['curves'][number]
    // Mermaid leaves out a curve that does not have a value for every axis.
    if (curve.entries.length !== axes.length) continue
    const points: Point[] = curve.entries.map((value, k) => {
      const u = unit[k] as Point
      const r = relativeRadius(value, min, max, radius)
      const safe = Number.isFinite(r) ? r : 0
      return { x: u.x * safe, y: u.y * safe }
    })
    const color = seriesColor(index)
    let attrs = ' class="ondine-curve" data-id="'
    attrs += escText(curve.name)
    attrs += '" fill="'
    attrs += color
    attrs += '" stroke="'
    attrs += color
    attrs += '"'
    if (circle) {
      shapes += '<path'
      shapes += attrs
      shapes += ' d="'
      shapes += closedRoundCurve(points, tension)
    } else {
      shapes += '<polygon'
      shapes += attrs
      shapes += ' points="'
      shapes += polygon(points)
    }
    shapes += '"/>'
  }

  const legend: Label[] = model.options.showLegend
    ? curves.map((curve) => layoutLabel(curve.label, false, small, 4000, 0, undefined))
    : []
  let legendWidth = 0
  for (const label of legend) legendWidth = fmax(legendWidth, label.width)
  const legendHeight = legend.length * ROW
  const legendX = tight ? -(SWATCH + 8 + legendWidth) / 2 : x1 + GAP
  const legendTop = tight ? y1 + GAP / 2 : -legendHeight / 2
  if (legend.length > 0 && tight) {
    x0 = fmin(x0, legendX)
    x1 = fmax(x1, -legendX)
    y1 = legendTop + legendHeight
  } else if (legend.length > 0) {
    x1 = legendX + SWATCH + 8 + legendWidth
    y0 = fmin(y0, -legendHeight / 2)
    y1 = fmax(y1, legendHeight / 2)
  }
  const legendOut = buf()
  for (let index = 0; index < legend.length && index < curves.length; index++) {
    const label = legend[index] as Label
    const curve = curves[index] as RadarModel['curves'][number]
    const y = legendTop + index * ROW + ROW / 2
    const color = seriesColor(index)
    legendOut.s += '<g class="ondine-legend-item" data-id="'
    legendOut.s += escText(curve.name)
    legendOut.s += '"><rect x="'
    pushNum(legendOut, legendX)
    legendOut.s += '" y="'
    pushNum(legendOut, y - SWATCH / 2)
    legendOut.s += '" width="12" height="12" rx="2" fill="'
    legendOut.s += color
    legendOut.s += '" fill-opacity="0.4" stroke="'
    legendOut.s += color
    legendOut.s += '"/>'
    legendOut.s += labelSvg(label, legendX + SWATCH + 8 + label.width / 2, y, '', undefined)
    legendOut.s += '</g>'
  }

  const title = layoutLabel(model.title, false, size, titleRoom(options), BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 8 : 0
  const bodyWidth = fmax(x1 - x0, title.width)
  const totalWidth = Math.ceil(bodyWidth + 2 * pad)
  const totalHeight = Math.ceil(y1 - y0 + titleHeight + 2 * pad)

  const content = buf(
    labelSvg(
      title,
      totalWidth / 2,
      pad + title.height / 2,
      ' class="ondine-title" font-weight="var(--_tw)"',
      undefined,
    ),
  )
  content.s += '<g transform="translate('
  pushPoint(content, pad + (bodyWidth - (x1 - x0)) / 2 - x0, pad + titleHeight - y0)
  content.s += ')">'
  if (grid.s !== '') {
    content.s += '<g class="ondine-graticule" fill="none" stroke="var(--_a)">'
    content.s += grid.s
    content.s += '</g>'
  }
  if (spokes.s !== '') {
    content.s += '<path class="ondine-axes" d="'
    content.s += spokes.s
    content.s += '" fill="none" stroke="var(--_b)"/>'
  }
  if (shapes !== '') {
    content.s +=
      '<g class="ondine-curves" fill-opacity="0.2" stroke-width="1.5" stroke-linejoin="round">'
    content.s += shapes
    content.s += '</g>'
  }
  if (labels !== '') {
    content.s += '<g class="ondine-axis-labels" font-size="'
    pushNumber(content, small)
    content.s += '">'
    content.s += labels
    content.s += '</g>'
  }
  if (legendOut.s !== '') {
    content.s += '<g class="ondine-legend" font-size="'
    pushNumber(content, small)
    content.s += '">'
    content.s += legendOut.s
    content.s += '</g>'
  }
  content.s += '</g>'

  const svg = svgDocument(
    'radar',
    totalWidth,
    totalHeight,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content.s,
  )
  return { height: totalHeight, links: [], svg, width: totalWidth }
}
