/**
 * @module Lays out and draws a gantt chart: a time axis, one row per task (or packed rows in
 * compact mode), section bands, excluded days, vertical markers, and the today marker. Port of
 * Pele's `src/diagrams/gantt/render.ts`.
 */
import { autoTicks, intervalTicks, timeFormat } from './axis.ts'
import { Unit, add, addDays, intString, jsMax, jsMin } from './dates.ts'
import { type GanttDb, clock, ganttDbGetTasks, ganttDbIsInvalidDate } from './db.ts'
import { type Date, dateSetHours, dateTime } from './js_date.ts'
import type { GanttTask } from './types.ts'
import type { Rendered } from '../../diagrams.ts'
import { capWidth } from '../common/fit_width.ts'
import { esc, escText, jsRound, labelSvg, pushNum } from '../../svg/builder.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { CRITICAL, RADIUS, resolveStyle } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD, width as measureWidth } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { type LinkInfo, type UrlOptions, linked } from '../../util/url.ts'
import { type Buf, fmax, fmin, midpoint, partialCmp } from '../../util/rust.ts'
import type { Value } from '../../yaml.ts'

/** The default width of a chart. */
const WIDTH = 800.0
/** The narrowest the plot gets. */
const MIN_PLOT = 240.0
/** Space between a bar and its label. */
const LABEL_GAP = 8.0

/** The `gantt` section of the configuration. */
function section(config: Value): Value | undefined {
  if (config.kind !== 'Object') {
    return undefined
  }
  return config._0.find(([key]) => key === 'gantt')?.[1]
}

/** A setting of the `gantt` section. */
function get(config: Value, key: string): Value | undefined {
  const s = section(config)
  if (s === undefined || s.kind !== 'Object') {
    return undefined
  }
  return s._0.find(([own]) => own === key)?.[1]
}

/** A finite number setting, clamped to `min` and `max`. */
function setting(config: Value, key: string, min: number, max: number): number | undefined {
  const value = get(config, key)
  if (value !== undefined && value.kind === 'Number' && Number.isFinite(value._0)) {
    return fmin(fmax(value._0, min), max)
  }
  return undefined
}

/** A string setting. */
function text(config: Value, key: string): string | undefined {
  const value = get(config, key)
  return value !== undefined && value.kind === 'String' ? value._0 : undefined
}

/** Whether a setting is `true`. */
function flag(config: Value, key: string): boolean {
  const value = get(config, key)
  return value !== undefined && value.kind === 'Bool' && value._0
}

/** Whether the code unit is an ASCII letter equal to `lower` ignoring case. */
function isLetterCi(c: number, lower: number): boolean {
  return c === lower || c === lower - 32
}

/** `raw` with each `<br>`, `<br/>`, or `<br />` (any case) replaced by a space. */
function noBreaks(raw: string): string {
  let out = ''
  let start = 0
  let at = 0
  while (at < raw.length) {
    let end: number | undefined
    if (raw.charCodeAt(at) === 0x3c && isLetterCi(raw.charCodeAt(at + 1), 0x62) && isLetterCi(raw.charCodeAt(at + 2), 0x72)) {
      let e = at + 3
      // Every `\s` character is a single UTF-16 unit.
      while (e < raw.length && isSpace(raw.charCodeAt(e))) e++
      if (raw.charCodeAt(e) === 0x2f) {
        e += 1
      }
      end = raw.charCodeAt(e) === 0x3e ? e + 1 : undefined
    }
    if (end !== undefined) {
      out += raw.slice(start, at)
      out += ' '
      start = end
      at = end
    } else {
      at += 1
    }
  }
  out += raw.slice(start)
  return out
}

/** A task label sits on one row, so only its first line is kept. */
function oneLine(raw: string, size: number): Label {
  const label = layoutLabel(noBreaks(raw), false, size, 4000.0, 0, undefined)
  if (label.lines.length <= 1) {
    return label
  }
  label.lines.length = 1
  label.widths.length = 1
  label.width = label.widths[0] ?? 0.0
  label.height = label.lineHeight
  return label
}

/** The task's start as a time value, NaN when unset. */
function startOf(task: GanttTask): number {
  return task.startTime === undefined ? Number.NaN : dateTime(task.startTime)
}

/** The task's end as a time value, NaN when unset. */
function endOf(task: GanttTask): number {
  return task.endTime === undefined ? Number.NaN : dateTime(task.endTime)
}

/**
 * Whether scheduling gave the task a start and an end. One that waits on a task that never
 * resolves has neither.
 */
function scheduled(task: GanttTask): boolean {
  return Number.isFinite(startOf(task)) && Number.isFinite(endOf(task))
}

/**
 * Mermaid's compact mode: within a section, a task goes on the first row that is free when it
 * starts. Returns the number of rows the section takes.
 */
function packRows(tasks: GanttTask[], group: number[], offset: number, rowOf: (number | undefined)[]): number {
  const sorted = group.filter((i) => {
    const task = tasks[i]
    return task !== undefined && scheduled(task)
  })
  sorted.sort((a, b) => {
    const ta = tasks[a]
    const tb = tasks[b]
    const aStart = ta === undefined ? Number.NaN : startOf(ta)
    const aOrder = ta === undefined ? 0 : ta.order
    const bStart = tb === undefined ? Number.NaN : startOf(tb)
    const bOrder = tb === undefined ? 0 : tb.order
    return partialCmp(aStart, bStart) || (aOrder < bOrder ? -1 : aOrder > bOrder ? 1 : 0)
  })

  const free: number[] = []
  for (const i of sorted) {
    const task = tasks[i]
    if (task === undefined) {
      continue
    }
    const start = startOf(task)
    let row = 0
    while (row < free.length && start < (free[row] as number)) {
      row += 1
    }
    if (row < free.length) {
      free[row] = endOf(task)
    } else {
      free.push(endOf(task))
    }
    if (i < rowOf.length) {
      rowOf[i] = offset + row
    }
  }
  let rows = free.length
  for (const i of group) {
    if (i < rowOf.length && rowOf[i] === undefined) {
      rowOf[i] = offset + rows
      rows += 1
    }
  }
  return Math.max(rows, 1)
}

/** A drawn task bar and where its label goes. */
type Bar = {
  /** Whether the label fits inside the bar. */
  inside: boolean
  /** The task label. */
  label: Label
  /** The center of the label. */
  labelX: number
  /** The row the bar is on. */
  row: number
  /** The index of the task. */
  task: number
  /** The left edge, NaN for an unscheduled task. */
  x0: number
  /** The right edge, NaN for an unscheduled task. */
  x1: number
}

/** The `x` attribute value of a `<text>` and its `y`, written as `x="..." y="..."`. */
function pushXy(out: Buf, x: number, y: number): void {
  out.s += '<text x="'
  pushNum(out, x)
  out.s += '" y="'
  pushNum(out, y)
  out.s += '" '
}

/**
 * Draws a gantt chart, scheduling its tasks against the host's `now`.
 *
 * Throws the scheduler's errors: a start that is not a date, or too much work.
 */
export function render(model: GanttDb, config: Value, options: RenderOptions, url: UrlOptions): Rendered {
  const size = options.fontSize ?? 16.0
  const pad = options.padding ?? 8.0
  const now = clock(options.now)

  const labelSize = setting(config, 'fontSize', 4.0, 72.0) ?? jsRound(size * 0.8125)
  const sectionSize = setting(config, 'sectionFontSize', 4.0, 72.0) ?? labelSize
  const tickSize = jsRound(size * 0.75)
  const barHeight = setting(config, 'barHeight', 4.0, 400.0) ?? jsRound(labelSize * 1.85)
  const barGap = setting(config, 'barGap', 0.0, 400.0) ?? jsRound(barHeight / 4.0)
  const rowHeight = barHeight + barGap
  const sectionStyles = jsRound(setting(config, 'numberSectionStyles', 1.0, 1000.0) ?? 4.0)
  const compact = model.displayMode === 'compact'
  const topAxis = model.topAxis || flag(config, 'topAxis')

  const tasks: GanttTask[] = ganttDbGetTasks(model, now).slice()
  const rowTasks: number[] = []
  const verts: number[] = []
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i] as GanttTask
    if (!t.vert) rowTasks.push(i)
    if (t.vert && scheduled(t)) verts.push(i)
  }

  const categories: string[] = []
  for (const i of rowTasks) {
    const task = tasks[i]
    if (task !== undefined && !categories.includes(task.section)) {
      categories.push(task.section)
    }
  }
  const category = (s: string): number => {
    const at = categories.indexOf(s)
    return at < 0 ? 0 : at
  }

  const rowOf: (number | undefined)[] = []
  for (let i = 0; i < tasks.length; i++) rowOf.push(undefined)
  const rowSection: string[] = []
  if (compact) {
    const groups: [string, number[]][] = []
    for (const i of rowTasks) {
      const task = tasks[i]
      if (task === undefined) {
        continue
      }
      const found = groups.find(([own]) => own === task.section)
      if (found !== undefined) {
        found[1].push(i)
      } else {
        groups.push([task.section, [i]])
      }
    }
    for (const [s, group] of groups) {
      const rows = packRows(tasks, group, rowSection.length, rowOf)
      for (let r = 0; r < rows; r++) {
        rowSection.push(s)
      }
    }
  } else {
    for (const i of rowTasks) {
      const task = tasks[i]
      if (i < rowOf.length && task !== undefined) {
        rowOf[i] = rowSection.length
        rowSection.push(task.section)
      }
    }
  }
  const rowCount = rowSection.length

  let start = Number.POSITIVE_INFINITY
  let stop = Number.NEGATIVE_INFINITY
  for (const task of tasks) {
    if (!scheduled(task)) continue
    start = fmin(start, startOf(task))
    stop = fmax(stop, endOf(task))
  }
  const hasPlot = start <= stop

  const title = layoutLabel(model.title, false, size, 4000.0, BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 16.0 : 0.0
  const acc: Accessible = { accDescr: model.accDescr, accTitle: model.accTitle }

  if (!hasPlot) {
    const width = Math.ceil(fmax(title.width, 1.0) + 2.0 * pad)
    const height = Math.ceil(fmax(title.height, 1.0) + 2.0 * pad)
    const content = labelSvg(title, width / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined)
    return {
      height,
      links: [],
      svg: svgDocument('gantt', width, height, size, options, acc, content),
      width,
    }
  }

  const sectionLabels: Label[] = []
  let sectionWidth = 0.0
  for (const s of categories) {
    const label = layoutLabel(s, false, sectionSize, 180.0, 0, undefined)
    sectionWidth = jsMax(sectionWidth, label.width)
    sectionLabels.push(label)
  }

  const axisFormat = model.axisFormat !== '' ? model.axisFormat : model.dateFormat === 'D' ? '%d' : (text(config, 'axisFormat') ?? '%Y-%m-%d')
  const tickLabel = (t: number): string => timeFormat(axisFormat, t)
  const sampleWidth = jsMax(measureWidth(tickLabel(start), tickSize, 0), measureWidth(tickLabel(stop), tickSize, 0))

  const left = pad + (setting(config, 'leftPadding', 0.0, 2000.0) ?? jsMax(sectionWidth > 0.0 ? sectionWidth + 24.0 : 0.0, sampleWidth / 2.0))
  const rightPadding = setting(config, 'rightPadding', 0.0, 2000.0) ?? jsMax(16.0, sampleWidth / 2.0)
  const target = capWidth(options, setting(config, 'useWidth', 100.0, 20000.0) ?? WIDTH, 280.0, 0.0)
  const plotWidth = jsMax(MIN_PLOT, target - left - rightPadding - pad)
  const right = left + plotWidth
  const scale = stop > start ? plotWidth / (stop - start) : 0.0
  const x = (t: number): number => (scale === 0.0 ? left + plotWidth / 2.0 : left + (t - start) * scale)

  const tickHeight = jsRound(tickSize * 1.75)
  const topPadding = setting(config, 'topPadding', 0.0, 2000.0)
  const gridStart = setting(config, 'gridLineStartPadding', 0.0, 2000.0)
  const headHeight = pad + titleHeight + (topAxis ? tickHeight : 0.0)
  const plotTop = jsMax(headHeight, topPadding ?? 0.0)
  // Mermaid starts its grid lines above the first row by the difference between these two
  // settings. Here that only uses room a larger `topPadding` leaves free.
  const gridLead =
    topPadding !== undefined && gridStart !== undefined ? jsMax(0.0, jsMin(topPadding - gridStart, plotTop - headHeight)) : 0.0
  const plotHeight = Math.max(rowCount, 1) * rowHeight
  const plotBottom = plotTop + plotHeight

  // Bars and where their labels go: inside when they fit, otherwise beside the bar on the side
  // with room.
  const bars: Bar[] = []
  let extent = right + rightPadding
  for (const i of rowTasks) {
    const task = tasks[i]
    if (task === undefined) {
      continue
    }
    const label = oneLine(task.task, labelSize)
    const row = rowOf[i] ?? 0
    if (!scheduled(task)) {
      const labelX = left + LABEL_GAP + label.width / 2.0
      extent = jsMax(extent, labelX + label.width / 2.0)
      bars.push({ inside: false, label, labelX, row, task: i, x0: Number.NaN, x1: Number.NaN })
      continue
    }
    let x0 = x(startOf(task))
    const renderEnd = task.renderEndTime === undefined ? endOf(task) : dateTime(task.renderEndTime)
    let x1 = jsMax(x(renderEnd), x0 + (task.milestone ? 0.0 : 2.0))
    if (task.milestone) {
      const mid = x0 + (x(endOf(task)) - x0) / 2.0
      x0 = mid - barHeight / 2.0
      x1 = mid + barHeight / 2.0
    }
    const inside = !task.milestone && label.width + 2.0 * LABEL_GAP <= x1 - x0
    let labelX = midpoint(x0, x1)
    if (!inside) {
      const fitsRight = x1 + LABEL_GAP + label.width <= right + rightPadding
      const fitsLeft = x0 - LABEL_GAP - label.width >= left
      labelX = fitsRight || !fitsLeft ? x1 + LABEL_GAP + label.width / 2.0 : x0 - LABEL_GAP - label.width / 2.0
      extent = jsMax(extent, labelX + label.width / 2.0)
    }
    bars.push({ inside, label, labelX, row, task: i, x0, x1 })
  }

  let interval = ''
  if (model.tickInterval !== undefined && model.tickInterval !== '') {
    interval = model.tickInterval
  } else {
    const configured = text(config, 'tickInterval')
    if (configured !== undefined && configured !== '') interval = configured
  }
  const weekday = model.weekday ?? text(config, 'weekday') ?? 'sunday'
  const count = jsMax(2.0, jsMin(10.0, Math.floor(plotWidth / (sampleWidth + 24.0))))
  const ticks = intervalTicks(interval, weekday, start, stop, Math.ceil(plotWidth / 3.0)) ?? autoTicks(start, stop, count)

  const grid: Buf = { s: '' }
  const axisBottom: Buf = { s: '' }
  const axisTop: Buf = { s: '' }
  let lastRight = Number.NEGATIVE_INFINITY
  let lastLabel = ''
  const bottomY = plotBottom + tickHeight / 2.0 + 2.0
  const topY = plotTop - gridLead - tickHeight / 2.0 - 2.0
  for (const t of ticks) {
    const tx = x(t)
    grid.s += 'M'
    pushNum(grid, tx)
    grid.s += ','
    pushNum(grid, plotTop - gridLead)
    grid.s += 'V'
    pushNum(grid, plotBottom)
    const label = tickLabel(t)
    const width = measureWidth(label, tickSize, 0)
    // A label is skipped when it would run into the one before it or only repeat it. Its grid
    // line stays.
    if (tx - width / 2.0 < lastRight + 8.0 || label === lastLabel) {
      continue
    }
    lastRight = tx + width / 2.0
    extent = jsMax(extent, lastRight)
    const body = 'text-anchor="middle">' + esc(label) + '</text>'
    pushXy(axisBottom, tx, bottomY + tickSize * 0.35)
    axisBottom.s += body
    if (topAxis) {
      pushXy(axisTop, tx, topY + tickSize * 0.35)
      axisTop.s += body
    }
    lastLabel = label
  }

  // Vertical markers take no row. Their labels go under the axis, on as many lines as it takes
  // to keep them apart.
  const vertLines: Buf = { s: '' }
  let vertLabels = ''
  const vertEnds: number[] = []
  const vertTop = plotBottom + tickHeight + 4.0
  const vertLine = jsRound(labelSize * 1.5)
  const vertKey = (i: number): number => {
    const t = tasks[i]
    return t === undefined ? Number.NaN : startOf(t)
  }
  verts.sort((a, b) => partialCmp(vertKey(a), vertKey(b)))
  for (const i of verts) {
    const task = tasks[i]
    if (task === undefined) {
      continue
    }
    const vx = x(startOf(task))
    const label = oneLine(task.task, labelSize)
    const cx = jsMax(pad + label.width / 2.0, vx)
    let line = 0
    while (line < vertEnds.length && cx - label.width / 2.0 < (vertEnds[line] as number) + 8.0) {
      line += 1
    }
    const end = cx + label.width / 2.0
    if (line < vertEnds.length) {
      vertEnds[line] = end
    } else {
      vertEnds.push(end)
    }
    extent = jsMax(extent, end)
    const id = escText(task.id)
    vertLines.s += '<path class="ondine-vert" data-id="'
    vertLines.s += id
    vertLines.s += '" d="M'
    pushNum(vertLines, vx)
    vertLines.s += ','
    pushNum(vertLines, plotTop - gridLead)
    vertLines.s += 'V'
    pushNum(vertLines, plotBottom)
    vertLines.s += '"/>'
    const attrs = ' class="ondine-vert-label" data-id="' + id + '"'
    vertLabels += labelSvg(label, cx, vertTop + line * vertLine + vertLine / 2.0, attrs, undefined)
  }

  const width = Math.ceil(jsMax(extent, pad + title.width) + pad)
  const vertHeight = vertEnds.length === 0 ? 0.0 : 4.0 + vertEnds.length * vertLine
  const height = Math.ceil(plotBottom + tickHeight + vertHeight + pad)

  // Section bands, one per run of rows that share a section, shaded on alternate sections.
  const bands: Buf = { s: '' }
  let sectionOut = ''
  let row = 0
  while (row < rowSection.length) {
    const s = rowSection[row] as string
    let end = row + 1
    while (end < rowSection.length && rowSection[end] === s) {
      end += 1
    }
    const categoryIndex = category(s)
    const style = categoryIndex % sectionStyles
    const y = plotTop + row * rowHeight
    const h = (end - row) * rowHeight
    if (categories.length > 1 || s !== '') {
      bands.s += '<rect class="ondine-section ondine-section-'
      bands.s += intString(style)
      bands.s += '" x="0" y="'
      pushNum(bands, y)
      bands.s += '" width="'
      bands.s += intString(width)
      bands.s += '" height="'
      pushNum(bands, h)
      bands.s += '" fill="'
      bands.s += style % 2.0 === 0.0 ? 'var(--_s)' : 'none'
      bands.s += '"/>'
    }
    const label = sectionLabels[categoryIndex]
    if (label !== undefined) {
      const attrs = ' class="ondine-section-label" data-id="' + escText(s) + '"'
      sectionOut += labelSvg(label, pad + 8.0 + label.width / 2.0, y + h / 2.0, attrs, undefined)
    }
    row = end
  }

  // Excluded days, as Mermaid marks them: a day at a time from the first task's start, and not at
  // all when the chart spans more than five years.
  const excluded: Buf = { s: '' }
  if ((model.excludes.length > 0 || model.includes.length > 0) && dateTime(add(start, 6.0, Unit.Year)) > stop) {
    let run: [Date, Date] | undefined
    const flush = (): void => {
      if (run === undefined) {
        return
      }
      const [from, to] = run
      run = undefined
      const dayStart = dateSetHours(from, 0.0, 0.0, 0.0, 0.0)
      const dayEnd = dateSetHours(to, 23.0, 59.0, 59.0, 999.0)
      const ex0 = jsMax(left, x(dateTime(dayStart)))
      const ex1 = jsMin(right, x(dateTime(dayEnd)))
      if (ex1 > ex0) {
        excluded.s += '<rect x="'
        pushNum(excluded, ex0)
        excluded.s += '" y="'
        pushNum(excluded, plotTop)
        excluded.s += '" width="'
        pushNum(excluded, ex1 - ex0)
        excluded.s += '" height="'
        pushNum(excluded, plotHeight)
        excluded.s += '"/>'
      }
    }
    let day: Date = start
    while (dateTime(day) <= stop) {
      if (ganttDbIsInvalidDate(model, day)) {
        run = run === undefined ? [day, day] : [run[0], day]
      } else {
        flush()
      }
      day = addDays(day, 1.0)
    }
    flush()
  }

  const links: LinkInfo[] = []
  let tasksOut = ''
  for (const bar of bars) {
    const task = tasks[bar.task]
    if (task === undefined) {
      continue
    }
    const cy = plotTop + bar.row * rowHeight + rowHeight / 2.0
    const state = task.active ? 'active' : task.done ? 'done' : ''
    let classes = 'ondine-task'
    if (state !== '') {
      classes += ' ondine-' + state
    }
    if (task.crit) {
      classes += ' ondine-crit'
    }
    if (task.milestone) {
      classes += ' ondine-milestone'
    }
    if (task.classes.includes('clickable')) {
      classes += ' ondine-clickable'
    }

    const shape: Buf = { s: '' }
    let textFill = ''
    if (Number.isNaN(bar.x0)) {
      classes += ' ondine-unscheduled'
      textFill = ' fill="var(--_m)"'
    } else {
      // A critical task takes the critical color in place of the accent. Done, it keeps the fill
      // of finished work and only its border is in that color.
      const color = task.crit ? CRITICAL : 'var(--_c)'
      let paint: string
      if (state === 'done') {
        paint = 'fill="var(--_a)"'
      } else if (state === 'active') {
        paint = 'fill="' + color + '" fill-opacity="0.25"'
      } else {
        paint = 'fill="' + color + '"'
      }
      const stroke = 'stroke="' + (state === 'done' && !task.crit ? 'var(--_b)' : color) + '"'
      if (task.milestone) {
        const cx = midpoint(bar.x0, bar.x1)
        const r = barHeight / 2.0
        shape.s += '<path d="M'
        const points: [number, number][] = [
          [cx, cy - r],
          [cx + r, cy],
          [cx, cy + r],
          [cx - r, cy],
        ]
        points.forEach(([px, py], i) => {
          if (i > 0) {
            shape.s += 'L'
          }
          pushNum(shape, px)
          shape.s += ','
          pushNum(shape, py)
        })
        shape.s += 'Z" '
        shape.s += paint
        shape.s += ' '
        shape.s += stroke
        shape.s += ' stroke-linejoin="round"/>'
      } else {
        shape.s += '<rect x="'
        pushNum(shape, bar.x0)
        shape.s += '" y="'
        pushNum(shape, cy - barHeight / 2.0)
        shape.s += '" width="'
        pushNum(shape, bar.x1 - bar.x0)
        shape.s += '" height="'
        pushNum(shape, barHeight)
        shape.s += '" rx="'
        shape.s += RADIUS
        shape.s += '" '
        shape.s += paint
        shape.s += ' '
        shape.s += stroke
        shape.s += '/>'
      }
      if (bar.inside) {
        if (state === '') {
          textFill = ' fill="var(--_bg)"'
        }
      } else if (state === 'done') {
        textFill = ' fill="var(--_m)"'
      }
    }

    const attrs = ' class="ondine-label"' + textFill
    let body = shape.s + labelSvg(bar.label, bar.labelX, cy, attrs, undefined)
    const link = model.links.find(([id]) => id === task.id)
    if (link !== undefined) {
      body = linked(body, link[1], task.id, links, url, '')
    }
    tasksOut += '<g class="' + classes + '" data-id="' + escText(task.id) + '">' + body + '</g>'
  }

  const today: Buf = { s: '' }
  if (model.todayMarker !== 'off' && now >= start && now <= stop && stop > start) {
    const tx = x(now)
    const top = plotTop - gridLead
    const style = model.todayMarker === '' ? '' : resolveStyle(model.todayMarker.split(',')).line
    today.s += '<g class="ondine-today"><path d="M'
    pushNum(today, tx)
    today.s += ','
    pushNum(today, top)
    today.s += 'V'
    pushNum(today, plotBottom)
    today.s += '" fill="none" stroke="var(--_c)" stroke-width="2"'
    today.s += style
    today.s += '/>'
    if (style === '') {
      today.s += '<path d="M'
      pushNum(today, tx - 4.0)
      today.s += ','
      pushNum(today, top - 5.0)
      today.s += 'H'
      pushNum(today, tx + 4.0)
      today.s += 'L'
      pushNum(today, tx)
      today.s += ','
      pushNum(today, top + 1.0)
      today.s += 'Z" fill="var(--_c)"/>'
    }
    today.s += '</g>'
  }

  const axisLine: Buf = { s: 'M' }
  pushNum(axisLine, left)
  axisLine.s += ','
  pushNum(axisLine, plotBottom)
  axisLine.s += 'H'
  pushNum(axisLine, right)
  if (topAxis) {
    axisLine.s += 'M'
    pushNum(axisLine, left)
    axisLine.s += ','
    pushNum(axisLine, plotTop - gridLead)
    axisLine.s += 'H'
    pushNum(axisLine, right)
  }

  const content: Buf = {
    s: labelSvg(title, width / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  }
  if (bands.s !== '') {
    content.s += '<g class="ondine-sections">' + bands.s + '</g>'
  }
  if (excluded.s !== '') {
    content.s += '<g class="ondine-excluded" fill="var(--_a)">' + excluded.s + '</g>'
  }
  content.s += '<g class="ondine-grid" fill="none"><path d="'
  content.s += grid.s
  content.s += '" stroke="var(--_b)" stroke-dasharray="1 3"/><path d="'
  content.s += axisLine.s
  content.s += '" stroke="var(--_b)"/></g>'
  if (vertLines.s !== '') {
    content.s +=
      '<g class="ondine-verts" fill="none" stroke="var(--_l)" stroke-width="1.5" stroke-dasharray="4 3">' + vertLines.s + '</g>'
  }
  content.s += today.s
  content.s += '<g class="ondine-tasks" font-size="'
  pushNum(content, labelSize)
  content.s += '">'
  content.s += tasksOut
  content.s += '</g><g class="ondine-section-labels" font-size="'
  pushNum(content, sectionSize)
  content.s += '">'
  content.s += sectionOut
  content.s += '</g><g class="ondine-axis" font-size="'
  content.s += intString(tickSize)
  content.s += '" fill="var(--_m)">'
  content.s += axisBottom.s
  content.s += axisTop.s
  content.s += '</g>'
  if (vertLabels !== '') {
    content.s += '<g class="ondine-vert-labels" font-size="'
    pushNum(content, labelSize)
    content.s += '">'
    content.s += vertLabels
    content.s += '</g>'
  }

  return {
    height,
    links,
    svg: svgDocument('gantt', width, height, size, options, acc, content.s),
    width,
  }
}
