/** @module Draws a quadrant chart. Port of Pele's `src/diagrams/quadrant/render.ts`. */
import { type QuadrantDb, type QuadrantText, quadrantDbClass } from './db.ts'
import type { Rendered } from '../../diagrams.ts'
import { capWidth } from '../common/fit_width.ts'
import { escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS, classNames, resolveStyle, seriesColor } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { buf, fmax, fmin } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

const GAP = 4
const CAREFUL = 300

/** A point drawn on the chart, before its label is placed. */
type Dot = {
  cx: number
  cy: number
  reach: number
  text: Label
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

function setting(config: Value, key: string): Value | undefined {
  const section = property(config, 'quadrantChart')
  return section === undefined ? undefined : property(section, key)
}

function length(config: Value, key: string, fallback: number, max: number): number {
  const value = setting(config, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= 0) return fmin(value._0, max)
  return fallback
}

function hex(color: string): string {
  return color.startsWith('#') ? color : '#' + color
}

/** JavaScript's `parseInt` of a width such as `2px`: its leading digits. */
function parseInt(text: string): number {
  let digits = 0
  while (digits < text.length) {
    const c = text.charCodeAt(digits)
    if (c < 0x30 || c > 0x39) break
    digits++
  }
  return digits === 0 ? Number.NaN : Number(text.slice(0, digits))
}

function numberText(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

/** Draws a quadrant chart at its configured size, or narrower to fit the host's width. */
export function render(model: QuadrantDb, config: Value, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16
  const axisSize = jsRound(size * 0.875)
  const pointSize = jsRound(size * 0.75)
  const natural = jsRound(fmax(100, length(config, 'chartWidth', 500, 4000)))
  const width = jsRound(capWidth(options, natural, 280, 0))
  const height = jsRound((fmax(100, length(config, 'chartHeight', 500, 4000)) * width) / natural)
  const outer = length(config, 'quadrantPadding', options.padding ?? 8, 200)
  const xPad = length(config, 'xAxisLabelPadding', 5, 200)
  const yPad = length(config, 'yAxisLabelPadding', 5, 200)
  const hasPoints = model.points.length !== 0

  const label = (text: QuadrantText | undefined, fontSize: number, max: number): Label =>
    layoutLabel(text?.text, text !== undefined && text.markdown, fontSize, fmax(max, 40), 0, undefined)

  const title = layoutLabel(model.title, false, size, fmax(width - 2 * outer, 40), BOLD, undefined)
  const titlePad = length(config, 'titlePadding', 10, 200)
  const titleSpace = title.height > 0 ? title.height + titlePad : 0

  const filled = (text: QuadrantText | undefined): boolean => text !== undefined && text.text !== ''
  const hasX = filled(model.xAxisLeft) || filled(model.xAxisRight)
  const hasY = filled(model.yAxisBottom) || filled(model.yAxisTop)
  // Mermaid moves the x axis labels below the chart as soon as there are points.
  const xPosition = setting(config, 'xAxisPosition')
  const xBelow = hasPoints || (xPosition !== undefined && xPosition.kind === 'String' && xPosition._0 === 'bottom')
  const yPosition = setting(config, 'yAxisPosition')
  const yRight = yPosition !== undefined && yPosition.kind === 'String' && yPosition._0 === 'right'

  const side = width - 2 * outer
  const xLeft = label(model.xAxisLeft, axisSize, model.xAxisRight !== undefined ? side / 2 - 16 : side)
  const xRight = label(model.xAxisRight, axisSize, side / 2 - 16)
  const xHeight = fmax(xLeft.height, xRight.height)
  const xSpace = hasX ? xHeight + xPad : 0
  const tall = height - 2 * outer - titleSpace - xSpace
  const yBottom = label(model.yAxisBottom, axisSize, model.yAxisTop !== undefined ? tall / 2 - 16 : tall)
  const yTop = label(model.yAxisTop, axisSize, tall / 2 - 16)
  const yHeight = fmax(yBottom.height, yTop.height)
  const ySpace = hasY ? yHeight + yPad : 0

  const left = outer + (yRight ? 0 : ySpace)
  const top = outer + titleSpace + (xBelow ? 0 : xSpace)
  const w = fmax(0, side - ySpace)
  const h = fmax(0, tall)
  const tileW = fmax(0, (w - GAP) / 2)
  const tileH = fmax(0, (h - GAP) / 2)

  // Boxes a point label keeps clear of: the gaps between quadrants, quadrant labels, points,
  // and the labels placed before it.
  const taken: number[] = [
    left + tileW,
    top,
    left + w - tileW,
    top + h,
    left,
    top + tileH,
    left + w,
    top + h - tileH,
  ]
  const isClear = (from: number, x0: number, y0: number, x1: number, y1: number): boolean => {
    // Whole boxes of four from `from`, as `as_chunks::<4>` takes them.
    const end = from + Math.floor(Math.max(0, taken.length - from) / 4) * 4
    for (let i = from; i < end; i += 4) {
      const l = taken[i] as number
      const t = taken[i + 1] as number
      const r = taken[i + 2] as number
      const b = taken[i + 3] as number
      if (x0 < r && x1 > l && y0 < b && y1 > t) return false
    }
    return true
  }

  const textTop = length(config, 'quadrantTextTopPadding', 5, 200)
  let quadrants = ''
  for (let k = 0; k < 4; k++) {
    const x = k === 0 || k === 3 ? left + w - tileW : left
    const y = k < 2 ? top : top + h - tileH
    const text = label(model.quadrants[k], size, tileW - 16)
    const cx = x + tileW / 2
    const cy = hasPoints ? y + textTop + text.height / 2 : y + tileH / 2
    taken.push(cx - text.width / 2, cy - text.height / 2, cx + text.width / 2, cy + text.height / 2)
    quadrants += '<g class="ondine-quadrant" data-id="'
    quadrants += String.fromCharCode(0x31 + k)
    quadrants += '"><rect x="'
    quadrants += num(x)
    quadrants += '" y="'
    quadrants += num(y)
    quadrants += '" width="'
    quadrants += num(tileW)
    quadrants += '" height="'
    quadrants += num(tileH)
    quadrants += '" rx="'
    quadrants += RADIUS
    quadrants += '"/>'
    quadrants += labelSvg(text, cx, cy, ' class="ondine-label" fill="var(--_fg)" stroke="none"', undefined)
    quadrants += '</g>'
  }

  let axes = ''
  if (hasX) {
    const y = xBelow ? top + h + xPad + xHeight / 2 : top - xPad - xHeight / 2
    axes += labelSvg(xLeft, xRight.height > 0 ? left + w / 4 : left + xLeft.width / 2, y, '', undefined)
    axes += labelSvg(xRight, left + (w * 3) / 4, y, '', undefined)
  }
  if (hasY) {
    const x = yRight ? left + w + yPad + yHeight / 2 : left - yPad - yHeight / 2
    const turned = (text: Label, y: number): string => {
      let out = ''
      if (text.height > 0) {
        out += '<g transform="translate('
        out += num(x)
        out += ','
        out += num(y)
        out += ') rotate(-90)">'
        out += labelSvg(text, 0, 0, '', undefined)
        out += '</g>'
      }
      return out
    }
    axes += turned(yBottom, yTop.height > 0 ? top + (h * 3) / 4 : top + h - yBottom.width / 2)
    axes += turned(yTop, top + h / 4)
  }

  const radius = length(config, 'pointRadius', 5, 200)
  const textPad = length(config, 'pointTextPadding', 5, 200)
  const fill = seriesColor(0)
  const dots: Dot[] = []
  const circles: string[] = []
  for (const point of model.points) {
    if (!(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) continue
    const shared = quadrantDbClass(model, point.className)
    const r = fmin(point.style.radius ?? shared?.radius ?? radius, 2000)
    const color = point.style.color ?? shared?.color
    const strokeColorRaw = point.style.strokeColor ?? shared?.strokeColor
    const strokeWidthRaw = point.style.strokeWidth ?? shared?.strokeWidth
    const styles: string[] = []
    if (color !== undefined && color !== '') styles.push('fill:' + hex(color))
    const strokeWidth = strokeWidthRaw !== undefined && strokeWidthRaw !== '' ? strokeWidthRaw : undefined
    const strokeColor = strokeColorRaw !== undefined && strokeColorRaw !== '' ? strokeColorRaw : undefined
    if (strokeWidth !== undefined) {
      if (strokeColor !== undefined) styles.push('stroke:' + hex(strokeColor))
      styles.push('stroke-width:' + strokeWidth)
    }
    const cx = left + point.x * w
    const cy = top + (1 - point.y) * h
    dots.push({
      cx,
      cy,
      reach: r + (strokeWidth === undefined ? 0 : fmin(parseInt(strokeWidth), 400) / 2),
      text: label(point.text, pointSize, 200),
    })

    let circle = '<circle class="ondine-point'
    circle += classNames(point.className)
    circle += '" data-id="'
    circle += escText(point.text.text)
    circle += '" cx="'
    circle += num(cx)
    circle += '" cy="'
    circle += num(cy)
    circle += '" r="'
    circle += num(r)
    circle += '"'
    if (strokeWidth !== undefined && strokeColor === undefined) {
      circle += ' stroke="'
      circle += fill
      circle += '"'
    }
    circle += resolveStyle(styles).shape
    circle += '/>'
    circles.push(circle)
  }

  // A label goes below its point, or above, right or left of it when that is the first place
  // that is inside the chart and free. A second round lets it cross the gaps between quadrants.
  // Large charts skip the search for a free place.
  const careful = dots.length <= CAREFUL
  if (careful) {
    for (const dot of dots) {
      taken.push(dot.cx - dot.reach, dot.cy - dot.reach, dot.cx + dot.reach, dot.cy + dot.reach)
    }
  }
  let labels = ''
  for (const dot of dots) {
    const cx = dot.cx
    const cy = dot.cy
    const text = dot.text
    const halfW = text.width / 2
    const halfH = text.size * 0.6 + (text.height - text.lineHeight) / 2
    const away = dot.reach + textPad
    const spots = [cx, cy + away + halfH, cx, cy - away - halfH, cx + away + halfW, cy, cx - away - halfW, cy]
    let tx = cx
    let ty = spots[1] as number
    let found = false
    for (let k = 0; k < 16; k += 2) {
      const spot = k % 8
      const at = spots[spot] ?? Number.NaN
      const x = spot < 4 && text.width < w ? fmin(fmax(at, left + halfW), left + w - halfW) : at
      const y = spots[spot + 1] ?? Number.NaN
      if (x - halfW < left || x + halfW > left + w || y - halfH < top || y + halfH > top + h) continue
      const free = !careful || isClear(k < 8 ? 0 : 8, x - halfW, y - halfH, x + halfW, y + halfH)
      if (!found || free) {
        tx = x
        ty = y
        found = true
      }
      if (free) break
    }
    if (careful) taken.push(tx - halfW, ty - halfH, tx + halfW, ty + halfH)
    labels += labelSvg(text, tx, ty, ' class="ondine-label"', undefined)
  }

  // Mermaid puts each new point under the ones before it.
  let content = labelSvg(
    title,
    width / 2,
    titlePad / 2 + title.height / 2,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += '<g class="ondine-quadrants" fill="var(--_s)" stroke="var(--_b)">'
  content += quadrants
  content += '</g>'
  if (axes !== '') {
    content += '<g class="ondine-axis-labels" font-size="'
    content += numberText(axisSize)
    content += '" fill="var(--_m)">'
    content += axes
    content += '</g>'
  }
  if (dots.length !== 0) {
    content += '<g class="ondine-points" fill="'
    content += fill
    content += '">'
    for (let i = circles.length - 1; i >= 0; i--) content += circles[i] as string
    content += '</g><g class="ondine-point-labels" font-size="'
    content += numberText(pointSize)
    content += '">'
    content += labels
    content += '</g>'
  }

  return {
    height,
    links: [],
    svg: svgDocument(
      'quadrantChart',
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
