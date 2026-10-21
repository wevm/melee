/**
 * @module Draws a pie chart: slices, percentages, and a legend. Port of Pele's
 * `src/diagrams/pie/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { fitWidth, titleRoom } from '../common/fit_width.ts'
import { escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { seriesColor } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD } from '../../text/measure.ts'
import { buf, fmax, midpoint } from '../../util/rust.ts'
import { pushNumber, type Value, valuePushJsString } from '../../yaml.ts'
import type { PieModel } from './model.ts'

const PI = Math.PI

/** The pie radius before fitting. */
const RADIUS = 120.0
/** The side of a legend swatch. */
const SWATCH = 12.0
/** The height of a legend row. */
const ROW = 26.0
/** The space between the pie and a legend beside it. */
const GAP = 32.0
/** The margin a percentage outside the rim needs. */
const OUTSIDE = 28.0

/** The `pie` option `key` of `config`. */
function option(config: Value, key: string): Value | undefined {
  const property = (value: Value, key: string): Value | undefined =>
    value.kind === 'Object' ? value._0.find(([own]) => own === key)?.[1] : undefined
  const section = property(config, 'pie')
  if (section === undefined) return undefined
  return property(section, key)
}

/** The point at `angle` (clockwise from the top) and `radius`. */
function point(angle: number, radius: number): string {
  return `${num(Math.sin(angle) * radius)},${num(-Math.cos(angle) * radius)}`
}

/** An arc command of `radius` up to its end point. */
function arc(radius: number, large: boolean, sweep: boolean): string {
  const r = num(radius)
  return `A${r},${r}${large ? ' 0 1 ' : ' 0 0 '}${sweep ? '1 ' : '0 '}`
}

/** A full circle of radius `r` as two arcs. */
function ring(r: number, sweep: boolean): string {
  const a = arc(r, true, sweep)
  const up = num(-r)
  return `M0,${up}${a}0,${num(r)}${a}0,${up}Z`
}

/** The path of a slice from angle `start` to `end`, a ring when `inner` is positive. */
function slice(start: number, end: number, outer: number, inner: number): string {
  if (end - start >= PI * 2.0 - 1e-9) {
    return inner > 0.0 ? ring(outer, true) + ring(inner, false) : ring(outer, true)
  }

  const large = end - start > PI
  if (inner <= 0.0) {
    return `M0,0L${point(start, outer)}${arc(outer, large, true)}${point(end, outer)}Z`
  }
  return `M${point(start, outer)}${arc(outer, large, true)}${point(end, outer)}L${point(end, inner)}${arc(inner, large, false)}${point(start, inner)}Z`
}

/** `value.toFixed(0)` for a finite value that is not negative. */
function fixed0(value: number): string {
  const out = buf()
  pushNumber(out, jsRound(value))
  return out.s
}

/** Draws `model` with the `pie` section of `config`, narrowed to fit the host's width. */
export function render(model: PieModel, config: Value, options: RenderOptions): Rendered {
  return fitWidth(options, RADIUS * 2.0, 140.0, (diameter, tight) =>
    draw(model, config, options, diameter / 2.0, tight),
  )
}

/** A percentage label placed outside the rim. */
type Outside = {
  width: number
  x: number
  y: number
}

/** `tight` is set when the chart does not fit the width it has with its legend beside it. */
function draw(model: PieModel, config: Value, options: RenderOptions, radius: number, tight: boolean): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8.0

  const positionValue = option(config, 'textPosition')
  const textPosition =
    positionValue !== undefined &&
    positionValue.kind === 'Number' &&
    positionValue._0 >= 0.0 &&
    positionValue._0 <= 1.0
      ? positionValue._0
      : 0.75
  const holeValue = option(config, 'donutHole')
  const inner =
    holeValue !== undefined && holeValue.kind === 'Number' && holeValue._0 > 0.0 && holeValue._0 <= 0.9
      ? holeValue._0 * radius
      : 0.0
  const placedValue = option(config, 'legendPosition')
  let placed: string
  if (placedValue === undefined || placedValue.kind === 'Null') {
    placed = 'right'
  } else {
    const out = buf()
    valuePushJsString(placedValue, out)
    placed = out.s
  }
  const legendPosition = tight && (placed === 'left' || placed === 'right') ? 'bottom' : placed

  const entries = model.sections
  let sum = 0.0
  for (const [, value] of entries) sum += value

  const legend: Label[] = entries.map(([label, value]) => {
    let text: string
    if (model.showData) {
      const out = buf(label)
      out.s += ' ['
      pushNumber(out, value)
      out.s += ']'
      text = out.s
    } else {
      text = label
    }
    return layoutLabel(text, false, small, 4000.0, 0, undefined)
  })
  let legendWidth = 0.0
  for (const label of legend) legendWidth = fmax(legendWidth, label.width)
  legendWidth += legend.length === 0 ? 0.0 : SWATCH + 8.0
  const legendHeight = legend.length * ROW

  const title = layoutLabel(model.title, false, size, titleRoom(options), BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 16.0 : 0.0

  // A slice too thin for its percentage gets the label outside the rim, which needs a margin.
  // Each drawn slice's percentage, written once.
  const shares: number[] = []
  const percents: string[] = []
  const narrow: boolean[] = []
  let anyNarrow = false
  for (let index = 0; index < entries.length; index++) {
    const value = (entries[index] as [string, number])[1]
    let share = sum > 0.0 ? value / sum : 0.0
    let percent = ''
    if (share * 100.0 >= 1.0) {
      const whole = fixed0(share * 100.0)
      if (whole !== '0') percent = `${whole}%`
      else share = 0.0
    } else {
      share = 0.0
    }
    let thin = false
    if (share !== 0.0 && share < 0.5) {
      const chord = 2.0 * radius * textPosition * Math.sin(share * PI)
      thin = chord < measure.width(percent, small, 0) + 6.0
    }
    shares.push(share)
    percents.push(percent)
    narrow.push(thin)
    if (thin) anyNarrow = true
  }
  const margin = anyNarrow ? OUTSIDE : 0.0

  const side =
    legendPosition === 'left' || legendPosition === 'right' || legendPosition === 'center' ? legendPosition : ''
  const stacked = legendPosition === 'top' || legendPosition === 'bottom'
  const diameter = (radius + margin) * 2.0
  let width = diameter
  let height = diameter
  if (side === 'left' || side === 'right') {
    width += legendWidth > 0.0 ? GAP + legendWidth : 0.0
    height = fmax(height, legendHeight)
  } else if (stacked) {
    width = fmax(width, legendWidth)
    height += legendHeight > 0.0 ? 20.0 + legendHeight : 0.0
  }
  width = fmax(width, title.width)

  const cx =
    pad + (side === 'left' ? legendWidth + GAP + diameter / 2.0 : side === 'right' ? diameter / 2.0 : width / 2.0)
  const bodyTop = pad + titleHeight
  const cy =
    bodyTop +
    (legendPosition === 'top' ? legendHeight + 20.0 + diameter / 2.0 : stacked ? diameter / 2.0 : height / 2.0)

  const slices = buf()
  const labels = buf()
  const outside = buf()
  let angle = 0.0
  const rim = radius + OUTSIDE / 2.0
  const placedOutside: Outside[] = []
  const clear = (placed: Outside[], x: number, y: number, width: number): boolean =>
    placed.every(
      (other) => Math.abs(x - other.x) >= midpoint(width, other.width) + 2.0 || Math.abs(y - other.y) >= small + 2.0,
    )
  const count = Math.min(entries.length, shares.length)
  for (let index = 0; index < count; index++) {
    const [label] = entries[index] as [string, number]
    const share = shares[index] as number
    if (share === 0.0) continue
    const end = angle + share * PI * 2.0
    slices.s += '<path class="ondine-slice" data-id="'
    slices.s += escText(label)
    slices.s += '" d="'
    slices.s += slice(angle, end, radius, inner)
    slices.s += '" fill="'
    slices.s += seriesColor(index)
    slices.s += '"/>'

    const mid = midpoint(angle, end)
    const text = percents[index] as string
    if (narrow[index] ?? false) {
      const width = measure.width(text, small, 0)
      let at = mid
      let step = 0
      while (step < 360 && !clear(placedOutside, Math.sin(at) * rim, -Math.cos(at) * rim, width)) {
        at += 2.0 / rim
        step += 1
      }
      const x = Math.sin(at) * rim
      const y = -Math.cos(at) * rim
      placedOutside.push({ width, x, y })
      outside.s += '<text x="'
      pushNum(outside, x)
      outside.s += '" y="'
      pushNum(outside, y + small * 0.35)
      outside.s += '">'
      outside.s += text
      outside.s += '</text>'
    } else {
      const r = radius * textPosition
      labels.s += '<text x="'
      pushNum(labels, Math.sin(mid) * r)
      labels.s += '" y="'
      pushNum(labels, -Math.cos(mid) * r + small * 0.35)
      labels.s += '">'
      labels.s += text
      labels.s += '</text>'
    }
    angle = end
  }
  if (slices.s === '') {
    slices.s += '<circle class="ondine-slice" r="'
    pushNumber(slices, radius)
    slices.s += '" fill="none" stroke="var(--_b)"/>'
  }

  let lx: number
  let ly: number
  if (side === 'right') {
    lx = cx + diameter / 2.0 + GAP
    ly = bodyTop + (height - legendHeight) / 2.0
  } else if (side === 'left') {
    lx = pad
    ly = bodyTop + (height - legendHeight) / 2.0
  } else if (side === 'center') {
    lx = cx - legendWidth / 2.0
    ly = cy - legendHeight / 2.0
  } else {
    lx = pad + (width - legendWidth) / 2.0
    ly = legendPosition === 'top' ? bodyTop : bodyTop + diameter + 20.0
  }
  const legendOut = buf()
  const rows = Math.min(legend.length, entries.length)
  for (let index = 0; index < rows; index++) {
    const label = legend[index] as Label
    const [name] = entries[index] as [string, number]
    const y = ly + index * ROW + ROW / 2.0
    legendOut.s += '<g class="ondine-legend-item" data-id="'
    legendOut.s += escText(name)
    legendOut.s += '"><rect x="'
    pushNum(legendOut, lx)
    legendOut.s += '" y="'
    pushNum(legendOut, y - SWATCH / 2.0)
    legendOut.s += '" width="12" height="12" rx="2" fill="'
    legendOut.s += seriesColor(index)
    legendOut.s += '"/>'
    legendOut.s += labelSvg(label, lx + SWATCH + 8.0 + label.width / 2.0, y, '', undefined)
    legendOut.s += '</g>'
  }

  const totalWidth = Math.ceil(width + 2.0 * pad)
  const totalHeight = Math.ceil(height + titleHeight + 2.0 * pad)
  const translate = buf(' transform="translate(')
  pushNum(translate, cx)
  translate.s += ','
  pushNum(translate, cy)
  translate.s += ')"'

  const content = buf(
    labelSvg(
      title,
      totalWidth / 2.0,
      pad + title.height / 2.0,
      ' class="ondine-title" font-weight="var(--_tw)"',
      undefined,
    ),
  )
  content.s += '<g class="ondine-slices"'
  content.s += translate.s
  content.s += ' stroke="var(--_bg)" stroke-width="1" stroke-linejoin="round">'
  content.s += slices.s
  content.s += '</g>'
  if (labels.s !== '') {
    content.s += '<g class="ondine-slice-labels"'
    content.s += translate.s
    content.s += ' font-size="'
    pushNumber(content, small)
    content.s += '" text-anchor="middle" fill="var(--_bg)">'
    content.s += labels.s
    content.s += '</g>'
  }
  if (outside.s !== '') {
    content.s += '<g class="ondine-slice-labels"'
    content.s += translate.s
    content.s += ' font-size="'
    pushNumber(content, small)
    content.s += '" text-anchor="middle">'
    content.s += outside.s
    content.s += '</g>'
  }
  if (legendOut.s !== '') {
    content.s += '<g class="ondine-legend" font-size="'
    pushNumber(content, small)
    content.s += '">'
    content.s += legendOut.s
    content.s += '</g>'
  }

  const svg = svgDocument(
    'pie',
    totalWidth,
    totalHeight,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content.s,
  )
  return { height: totalHeight, links: [], svg, width: totalWidth }
}
