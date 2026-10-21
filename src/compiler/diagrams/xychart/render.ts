/** @module Draws an XY chart. Port of Pele's `src/diagrams/xychart/render.ts`. */
import { type XyChartDb, xAxisTitle } from './db.ts'
import { tickIndex, tickStep, tickValue, ticksBetween } from './ticks.ts'
import type { Rendered } from '../../diagrams.ts'
import { capWidth } from '../common/fit_width.ts'
import { Code, CompileError, errorNew } from '../../error.ts'
import { esc, escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { seriesColor } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD } from '../../text/measure.ts'
import { asUint, buf, clamp as fclamp, fmax, fmin } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

const TICK = 4
const SWATCH = 12
const ROW = 26
const LEGEND_GAP = 24
const LIMIT = 1e300

/** A labelled place along an axis, as a fraction of its length. */
type Mark = {
  at: number
  label: Label
}

/** JavaScript's `Math.min`, which is `NaN` when either value is. */
function min(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return fmin(a, b)
}

/** JavaScript's `Math.max`, which is `NaN` when either value is. */
function max(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return fmax(a, b)
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** A mapping, or nothing for any other value. */
function record(value: Value | undefined): Value | undefined {
  return value !== undefined && value.kind === 'Object' ? value : undefined
}

/** A boolean setting, or `fallback`. */
function on(config: Value | undefined, key: string, fallback: boolean): boolean {
  const value = config === undefined ? undefined : property(config, key)
  return value !== undefined && value.kind === 'Bool' ? value._0 : fallback
}

function dimension(value: Value | undefined, fallback: number): number {
  if (value !== undefined && value.kind === 'Number' && value._0 > 0) return jsRound(fclamp(value._0, 100, 4000))
  return fallback
}

function finite(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return fclamp(value, -LIMIT, LIMIT)
}

function widest(marks: Mark[]): number {
  return marks.reduce((width, mark) => max(width, mark.label.width), 0)
}

function numberText(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

/** Where a label is anchored. */
const Anchor = { End: 'End', Middle: 'Middle', Start: 'Start' } as const
type Anchor = (typeof Anchor)[keyof typeof Anchor]

function anchorName(anchor: Anchor): string {
  switch (anchor) {
    case Anchor.End:
      return 'end'
    case Anchor.Middle:
      return 'middle'
    case Anchor.Start:
      return 'start'
  }
}

/**
 * Writes a label with its left edge, center or right edge at `x`. A plain one-line label keeps
 * its place when the text is wider or narrower than measured.
 */
function aligned(label: Label, x: number, y: number, anchor: Anchor): string {
  const line = label.lines.length === 1 ? label.lines[0] : undefined
  const span = line !== undefined && line.length === 1 ? line[0] : undefined
  if (span !== undefined && span.icon === undefined && span.style === 0) {
    return `<text x="${num(x)}" y="${num(y + label.size * 0.35)}" text-anchor="${anchorName(anchor)}">${esc(span.text)}</text>`
  }
  const dx = anchor === Anchor.Start ? label.width / 2 : anchor === Anchor.End ? -label.width / 2 : 0
  return labelSvg(label, x + dx, y, '', undefined)
}

function text(raw: string | undefined, fontSize: number, max: number): Label {
  return layoutLabel(raw, false, fontSize, max, 0, undefined)
}

/** The value axis: its range, which the marks round out to whole steps unless it was written. */
type Values = {
  exact: boolean
  hi: number
  lo: number
}

function valuesMarks(values: Values, length: number, spacing: number, small: number): Mark[] {
  const count = fmax(2, fmin(10, Math.floor(length / spacing)))
  const step = tickStep(Math.abs(values.hi - values.lo), count)
  if (!values.exact) {
    values.lo = tickValue(step, Math.floor(tickIndex(step, values.lo) + 1e-9))
    values.hi = tickValue(step, Math.ceil(tickIndex(step, values.hi) - 1e-9))
  }
  const lo = values.lo
  const hi = values.hi
  return ticksBetween(min(lo, hi), max(lo, hi), step).map((value) => ({
    at: (value - lo) / (hi - lo),
    label: text(numberText(value), small, 4000),
  }))
}

/**
 * Draws an XY chart at its configured size, or narrower to fit the host's width.
 *
 * Throws a semantic error for a chart without a series.
 */
export function render(model: XyChartDb, config: Value, options: RenderOptions): Rendered {
  if (model.plots.length === 0) {
    const error: CompileError = errorNew(Code.Semantic, 'No Plot to render, please provide a plot with some data')
    error.type = 'xychart'
    throw error
  }
  const chart = record(property(config, 'xyChart'))
  const setting = (key: string): Value | undefined => (chart === undefined ? undefined : property(chart, key))
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.875)
  const tiny = jsRound(size * 0.75)
  const pad = options.padding ?? 8
  const natural = dimension(setting('width'), 700)
  const width = capWidth(options, natural, 240, 0)
  // A narrower chart is not as much shorter, so that the plot keeps room for its marks.
  const height = jsRound(dimension(setting('height'), 500) * max(0.6, width / natural))
  const horizontal =
    model.horizontal ??
    (() => {
      const o = setting('chartOrientation')
      return o !== undefined && o.kind === 'String' && o._0 === 'horizontal'
    })()
  // The value of a bar is always written past its end, which is what showDataLabelOutsideBar
  // asks for in Mermaid. Inside, whether it fits changes from bar to bar and with the width of
  // the chart.
  const showValues = on(chart, 'showDataLabel', false)
  const x = model.xAxis
  const plots = model.plots
  const lineHeight = text('0', small, 4000).height
  const tinyHeight = text('0', tiny, 4000).height

  const title = layoutLabel(
    on(chart, 'showTitle', true) ? model.title : undefined,
    false,
    size,
    width - 2 * pad,
    BOLD,
    undefined,
  )
  const titleSpace = title.height > 0 ? title.height + 12 : 0

  const legend: [number, Label][] = []
  let legendWidth = 0
  if (on(chart, 'showLegend', true)) {
    for (let index = 0; index < plots.length; index++) {
      const plot = plots[index] as (typeof plots)[number]
      if (plot.title === '') continue
      const label = text(plot.title, small, width * 0.3)
      legendWidth = max(legendWidth, label.width + SWATCH + 8)
      legend.push([index, label])
    }
  }
  const legendSpace = legend.length === 0 ? 0 : legendWidth + LEGEND_GAP

  // The value range: as written, or taken from the data, where bars stand on zero and the
  // range grows to whole steps.
  const bars = plots.filter((plot) => plot.bar).length
  const barsF = bars
  let lo = model.yAxis.min
  let hi = model.yAxis.max
  const exact = model.hasSetYAxis && Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi
  if (exact) {
    lo = finite(lo) ?? Number.NaN
    hi = finite(hi) ?? Number.NaN
  } else {
    lo = Number.POSITIVE_INFINITY
    hi = Number.NEGATIVE_INFINITY
    for (const plot of plots) {
      for (const [, raw] of plot.data) {
        const value = finite(raw)
        if (value === undefined) continue
        if (value < lo) lo = value
        if (value > hi) hi = value
      }
    }
    if (lo > hi) {
      lo = 0
      hi = 0
    }
    if (bars > 0) {
      lo = min(lo, 0)
      hi = max(hi, 0)
    }
    if (lo === hi) {
      if (lo === 0) {
        hi = 1
      } else {
        lo -= Math.abs(lo) / 2
        hi += Math.abs(hi) / 2
      }
    }
  }
  const values: Values = { exact, hi, lo }

  // Places along the category axis are fractions of its length. Categories and bars sit in the
  // middle of equal slots. The points of a line on a numeric axis run from end to end.
  let count = 1
  if (x.kind === 'Band') {
    count = max(x.categories.length, 1)
  } else {
    for (const plot of plots) count = max(count, plot.data.length)
  }
  const band = x.kind === 'Band'
  const slot = 1 / count
  const inset = band || bars > 0 ? slot / 2 : 0
  const x0 = x.kind === 'Linear' ? finite(x._0.min) : undefined
  const x1 = x.kind === 'Linear' ? finite(x._0.max) : undefined
  const ranged = x0 !== undefined && x1 !== undefined && x0 !== x1
  const place = (i: number, n: number): number => {
    if (band) return (i + 0.5) * slot
    const along = n > 1 ? i / (n - 1) : ranged ? 0 : 0.5
    return inset + along * (1 - 2 * inset)
  }

  const categoryConf = record(chart === undefined ? undefined : property(chart, 'xAxis'))
  const valueConf = record(chart === undefined ? undefined : property(chart, 'yAxis'))
  const leftConf = horizontal ? categoryConf : valueConf
  const bottomConf = horizontal ? valueConf : categoryConf
  const leftTitle = text(
    on(leftConf, 'showTitle', true) ? (horizontal ? xAxisTitle(x) : model.yAxis.title) : undefined,
    small,
    height * 0.8,
  )
  const bottomTitle = text(
    on(bottomConf, 'showTitle', true) ? (horizontal ? model.yAxis.title : xAxisTitle(x)) : undefined,
    small,
    width * 0.8,
  )
  const leftTick = on(leftConf, 'showTick', true) ? TICK : 0
  const bottomTick = on(bottomConf, 'showTick', true) ? TICK : 0
  const leftLabels = on(leftConf, 'showLabel', true)
  const bottomLabels = on(bottomConf, 'showLabel', true)

  const wrapAt = horizontal ? width * 0.3 : max(48, (width - 2 * pad - 64 - legendSpace) * slot - 8)
  const categories: Label[] =
    x.kind === 'Band' && on(categoryConf, 'showLabel', true)
      ? x.categories.map((category) => text(category, small, wrapAt))
      : []
  let categoryWidth = 0
  let categoryHeight = 0
  for (const label of categories) {
    categoryWidth = max(categoryWidth, label.width)
    categoryHeight = max(categoryHeight, label.height)
  }

  // The labelled places of the category axis. Labels that would run into each other are
  // thinned out.
  const categoryMarks = (length: number): Mark[] => {
    const marks: Mark[] = []
    if (x.kind === 'Band') {
      const names = x.categories
      const need = categories.length === 0 ? 8 : horizontal ? categoryHeight : categoryWidth + 12
      const everyF = max(1, Math.ceil(need / (length * slot)))
      // A step too large to count in is as good as one past the end.
      const every = Math.max(asUint(everyF), 1)
      let i = 0
      while (i < names.length) {
        const at = (i + 0.5) * slot
        marks.push({ at, label: categories[i] ?? text(undefined, small, 0) })
        i = Math.min(i + every, Number.MAX_SAFE_INTEGER)
      }
    } else if (ranged && x0 !== undefined && x1 !== undefined) {
      const count = fmax(2, fmin(10, Math.floor(length / (horizontal ? 32 : 80))))
      const step = tickStep(Math.abs(x1 - x0), count)
      for (const value of ticksBetween(min(x0, x1), max(x0, x1), step)) {
        marks.push({
          at: inset + ((value - x0) / (x1 - x0)) * (1 - 2 * inset),
          label: text(numberText(value), small, 4000),
        })
      }
    } else if (x0 !== undefined) {
      marks.push({ at: 0.5, label: text(numberText(x0), small, 4000) })
    }
    return marks
  }

  // Room past the end of the value axis for what is written beside a point or a bar.
  let pointLabelWidth = 0
  let valueWidth = 0
  for (const plot of plots) {
    for (const label of plot.pointLabels ?? []) {
      pointLabelWidth = max(pointLabelWidth, measure.width(label, tiny, 0))
    }
    if (showValues && horizontal && plot.bar) {
      for (const [, value] of plot.data) {
        const f = finite(value)
        const written = f === undefined ? '' : numberText(f)
        valueWidth = max(valueWidth, measure.width(written, tiny, 0))
      }
    }
  }

  const bottomLabelHeight = !bottomLabels ? 0 : horizontal || !band ? lineHeight : categoryHeight
  const bottomSpace =
    bottomTick +
    (bottomLabelHeight > 0 ? bottomLabelHeight + 4 : 0) +
    (bottomTitle.height > 0 ? bottomTitle.height + 4 : 0)
  const headroom = horizontal
    ? 0
    : pointLabelWidth > 0 || showValues
      ? tinyHeight + 4
      : leftLabels
        ? lineHeight / 2
        : 0
  const top = pad + titleSpace + headroom
  const plotHeight = max(1, height - pad - bottomSpace - top)
  const bottom = top + plotHeight

  const leftMarks = horizontal ? categoryMarks(plotHeight) : valuesMarks(values, plotHeight, 56, small)
  const leftLabelWidth = leftLabels ? widest(leftMarks) : 0
  const left =
    pad +
    (leftTitle.height > 0 ? leftTitle.height + 6 : 0) +
    (leftLabelWidth > 0 ? leftLabelWidth + 6 : 0) +
    leftTick
  const beside = max(pointLabelWidth > 0 ? pointLabelWidth + 12 : 0, valueWidth > 0 ? valueWidth + 8 : 0)
  const reach = horizontal ? min(width * 0.25, beside) : 0
  let plotWidth = max(1, width - pad - left - legendSpace - reach)
  const bottomMarks = horizontal ? valuesMarks(values, plotWidth, 80, small) : categoryMarks(plotWidth)
  if (bottomLabels && legendSpace + reach === 0) {
    let over = 0
    for (const mark of bottomMarks) {
      over = max(over, mark.at * plotWidth + mark.label.width / 2 - plotWidth)
    }
    plotWidth = max(1, plotWidth - over)
  }
  const right = left + plotWidth
  const vlo = values.lo
  const vhi = values.hi

  const px = (c: number, v: number): number => (horizontal ? left + v * plotWidth : left + c * plotWidth)
  const py = (c: number, v: number): number => (horizontal ? top + c * plotHeight : bottom - v * plotHeight)
  const scale = (value: number): number => (value - vlo) / (vhi - vlo)
  const clamp = (v: number): number => min(max(v, 0), 1)

  // A line across the plot at a place on the value axis.
  const rule = (v: number): string =>
    horizontal ? `M${num(px(0, v))},${num(top)}V${num(bottom)}` : `M${num(left)},${num(py(0, v))}H${num(right)}`

  let grid = ''
  for (const mark of horizontal ? bottomMarks : leftMarks) grid += rule(mark.at)

  let axis = ''
  let labels = ''
  if (on(leftConf, 'showAxisLine', true)) {
    axis += 'M'
    axis += num(left)
    axis += ','
    axis += num(top)
    axis += 'V'
    axis += num(bottom)
  }
  if (on(bottomConf, 'showAxisLine', true)) {
    axis += 'M'
    axis += num(left)
    axis += ','
    axis += num(bottom)
    axis += 'H'
    axis += num(right)
  }
  const leftTickText = leftTick !== 0 ? numberText(-leftTick) : ''
  const bottomTickText = bottomTick !== 0 ? numberText(bottomTick) : ''
  for (const mark of leftMarks) {
    const y = horizontal ? top + mark.at * plotHeight : bottom - mark.at * plotHeight
    if (leftTick !== 0) axis += `M${num(left)},${num(y)}h${leftTickText}`
    if (leftLabels) labels += aligned(mark.label, left - leftTick - 6, y, Anchor.End)
  }
  for (const mark of bottomMarks) {
    const at = left + mark.at * plotWidth
    if (bottomTick !== 0) axis += `M${num(at)},${num(bottom)}v${bottomTickText}`
    if (bottomLabels) {
      labels += aligned(mark.label, at, bottom + bottomTick + 4 + mark.label.height / 2, Anchor.Middle)
    }
  }

  const span = (horizontal ? plotHeight : plotWidth) * slot
  const group = span * 0.7
  const thickness = group / max(barsF, 1)
  const gap = bars > 1 ? min(2, thickness * 0.2) : 0
  const base = clamp(scale(0))
  // Bars that go both ways get a line to stand on.
  if (bars > 0 && base > 0 && base < 1) axis += rule(base)
  // Lines are drawn over the bars wherever they were declared, as a bar would hide part of one
  // under it. A series keeps the color of its place in the source.
  let series = ''
  let lines = ''
  let outside = ''
  let pointLabels = ''
  let bar = 0
  const countSlots = x.kind === 'Band' ? Math.max(x.categories.length, 1) : Number.MAX_SAFE_INTEGER
  for (let index = 0; index < plots.length; index++) {
    const plot = plots[index] as (typeof plots)[number]
    const color = seriesColor(index)
    let id = ''
    if (plot.title !== '') {
      id += ' data-id="'
      id += escText(plot.title)
      id += '"'
    }
    // A series declared before the categories can hold more values than there are categories.
    const n = Math.min(plot.data.length, countSlots)
    if (plot.bar) {
      const offset = (bar - (barsF - 1) / 2) * thickness - (thickness - gap) / 2
      bar += 1
      let rects = ''
      for (let i = 0; i < n; i++) {
        const value = finite(plot.data[i]?.[1])
        if (value === undefined) continue
        const c = place(i, n)
        const v = clamp(scale(value))
        const from = min(base, v)
        const to = max(base, v)
        const bx = horizontal ? px(c, from) : px(c, 0) + offset
        const by = horizontal ? py(c, 0) + offset : py(c, to)
        const bw = horizontal ? (to - from) * plotWidth : thickness - gap
        const bh = horizontal ? thickness - gap : (to - from) * plotHeight
        rects += `<rect x="${num(bx)}" y="${num(by)}" width="${num(bw)}" height="${num(bh)}"/>`
        if (!showValues) continue
        const label = numberText(value)
        const w = measure.width(label, tiny, 0)
        // Towards the end of the bar: 1 when it runs up or right from the baseline, -1
        // the other way.
        const out = v >= base ? 1 : -1
        let tx = bx + bw / 2
        let ty = by + bh / 2
        let anchor = 'middle'
        if (horizontal) {
          if (bh < tiny) continue
          tx = (out > 0 ? bx + bw : bx) + out * 6
          anchor = out > 0 ? 'start' : 'end'
        } else {
          if (w + 2 > span / barsF) continue
          ty = (out > 0 ? by : by + bh) - out * (tinyHeight / 2 + 2)
        }
        outside += `<text x="${num(tx)}" y="${num(ty + tiny * 0.35)}" text-anchor="${anchor}">${label}</text>`
      }
      series += '<g class="ondine-series ondine-bars"'
      series += id
      series += ' fill="'
      series += color
      series += '">'
      series += rects
      series += '</g>'
      continue
    }

    // A line is cut where it leaves the value range, so it stays inside the plot.
    let d = ''
    let dots = ''
    let pen = false
    let pc = 0
    let pv = Number.NaN
    const point = (letter: string, c: number, v: number): string => `${letter}${num(px(c, v))},${num(py(c, v))}`
    for (let i = 0; i < n; i++) {
      const value = finite(plot.data[i]?.[1])
      if (value === undefined) {
        pv = Number.NaN
        continue
      }
      const c = place(i, n)
      const v = scale(value)
      const visible = v >= 0 && v <= 1
      if (Number.isNaN(pv)) {
        if (visible) d += point('M', c, v)
        pen = visible
      } else {
        const dv = v - pv
        let t0 = 0
        let t1 = 1
        if (dv !== 0) {
          const a = -pv / dv
          const b = (1 - pv) / dv
          t0 = max(t0, min(a, b))
          t1 = min(t1, max(a, b))
        } else if (!visible) {
          t0 = 2
        }
        if (t0 <= t1) {
          const c0 = pc + (c - pc) * t0
          const v0 = pv + dv * t0
          const c1 = pc + (c - pc) * t1
          const v1 = pv + dv * t1
          if (!pen || t0 > 0) d += point('M', c0, v0)
          d += point('L', c1, v1)
        }
        pen = visible
      }
      pc = c
      pv = v
      if (!visible) continue
      const cx = px(c, v)
      const cy = py(c, v)
      if (span >= 12) {
        dots += `<circle cx="${num(cx)}" cy="${num(cy)}" r="3"/>`
      }
      const label = text(plot.pointLabels?.[i], tiny, 4000)
      if (label.height > 0) {
        const half = label.width / 2
        pointLabels += horizontal
          ? aligned(label, cx + 10, cy, Anchor.Start)
          : aligned(label, max(min(cx, right - half), left + half), cy - 6 - label.height / 2, Anchor.Middle)
      }
    }
    lines += '<g class="ondine-series ondine-line"'
    lines += id
    lines += ' fill="'
    lines += color
    lines += '">'
    if (d !== '') {
      lines += '<path d="'
      lines += d
      lines += '" fill="none" stroke="'
      lines += color
      lines += '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    }
    lines += dots
    lines += '</g>'
  }

  let titles = ''
  if (leftTitle.height > 0) {
    titles += '<g transform="translate('
    titles += num(pad + leftTitle.height / 2)
    titles += ','
    titles += num(top + plotHeight / 2)
    titles += ') rotate(-90)">'
    titles += labelSvg(leftTitle, 0, 0, '', undefined)
    titles += '</g>'
  }
  titles += labelSvg(bottomTitle, left + plotWidth / 2, height - pad - bottomTitle.height / 2, '', undefined)

  let legendOut = ''
  let legendHeight = 0
  for (const [, label] of legend) legendHeight += max(ROW, label.height + 6)
  let ly = top + max(0, (plotHeight - legendHeight) / 2)
  const lx = right + reach + LEGEND_GAP
  for (const [index, label] of legend) {
    const row = max(ROW, label.height + 6)
    if (ly + row > height) break
    const y = ly + row / 2
    const color = seriesColor(index)
    const plot = plots[index]
    if (plot === undefined) continue
    legendOut += '<g class="ondine-legend-item" data-id="'
    legendOut += escText(plot.title)
    legendOut += '">'
    if (plot.bar) {
      legendOut += '<rect x="'
      legendOut += num(lx)
      legendOut += '" y="'
      legendOut += num(y - SWATCH / 2)
      legendOut += '" width="12" height="12" rx="2" fill="'
      legendOut += color
      legendOut += '"/>'
    } else {
      legendOut += '<path d="M'
      legendOut += num(lx)
      legendOut += ','
      legendOut += num(y)
      legendOut += 'h12" stroke="'
      legendOut += color
      legendOut += '" stroke-width="2" stroke-linecap="round"/>'
    }
    legendOut += labelSvg(label, lx + SWATCH + 8 + label.width / 2, y, '', undefined)
    legendOut += '</g>'
    ly += row
  }

  let content = labelSvg(
    title,
    width / 2,
    pad + title.height / 2,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  if (grid !== '') {
    content += '<path class="ondine-grid" d="'
    content += grid
    content += '" stroke="var(--_a)"/>'
  }
  content += '<g class="ondine-plot">'
  content += series
  content += lines
  content += '</g>'
  if (axis !== '') {
    content += '<path class="ondine-axis" d="'
    content += axis
    content += '" fill="none" stroke="var(--_b)"/>'
  }
  const pushGroup = (cls: string, font: number, extra: string, body: string): void => {
    if (body === '') return
    content += '<g class="'
    content += cls
    content += '" font-size="'
    content += numberText(font)
    content += '"'
    content += extra
    content += '>'
    content += body
    content += '</g>'
  }
  pushGroup('ondine-axis-labels', small, ' fill="var(--_m)"', labels)
  pushGroup('ondine-axis-titles', small, '', titles)
  pushGroup('ondine-data-labels', tiny, '', outside)
  pushGroup('ondine-point-labels', tiny, '', pointLabels)
  pushGroup('ondine-legend', small, '', legendOut)

  return {
    height,
    links: [],
    svg: svgDocument(
      'xychart',
      width,
      height,
      size,
      options,
      { accDescr: model.accDescr, accTitle: model.accTitle },
      content,
    ),
    width,
  }
}
