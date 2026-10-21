/** @module The XY chart database. Port of Pele's `src/diagrams/xychart/db.ts`. */
import { trim, trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { buf } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'

/** A value of a series with its label, as written. */
export type DataPoint = {
  /** The label after the value, untrimmed, or empty. */
  label: string
  /** The value. */
  value: number
}

/** `DataPoint::default()`. */
export function dataPointDefault(): DataPoint {
  return { label: '', value: 0 }
}

/** The x axis: categories, or a numeric range. */
export type XAxis =
  /** Categories in order. */
  | {
      kind: 'Band'
      /** The categories, trimmed. */
      categories: string[]
      /** The title. */
      title: string
    }
  /** A numeric range. */
  | { kind: 'Linear'; _0: LinearAxis }

/** The title. */
export function xAxisTitle(axis: XAxis): string {
  return axis.kind === 'Band' ? axis.title : axis._0.title
}

/** Replaces the title. */
function xAxisSetTitle(axis: XAxis, title: string): void {
  if (axis.kind === 'Band') axis.title = title
  else axis._0.title = title
}

/** A numeric axis. */
export type LinearAxis = {
  /** The largest value. */
  max: number
  /** The smallest value. */
  min: number
  /** The title. */
  title: string
}

/** A series: a line or bars. */
export type Plot = {
  /** Whether it is drawn as bars. */
  bar: boolean
  /**
   * Each value with its place on the x axis: a category, or a number written as text. A
   * category with no value has `undefined`.
   */
  data: [string, number | undefined][]
  /** The trimmed labels of the points of a line, when any is not empty. */
  pointLabels: string[] | undefined
  /** The title, trimmed. */
  title: string
}

/** The parsed XY chart: Pele's `XyChartDb`. */
export type XyChartDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  hasSetXAxis: boolean
  /** False while the y range comes from the data and not from a `y-axis` statement. */
  hasSetYAxis: boolean
  /** Whether the chart runs `horizontal`, when a statement says how it runs. */
  horizontal: boolean | undefined
  /** Series, in order. */
  plots: Plot[]
  /** The title. */
  title: string | undefined
  /** The x axis. */
  xAxis: XAxis
  /** The y axis. */
  yAxis: LinearAxis
}

/** `XyChartDb::default()`. */
export function xyChartDbDefault(): XyChartDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    hasSetXAxis: false,
    hasSetYAxis: false,
    horizontal: undefined,
    plots: [],
    title: undefined,
    xAxis: { categories: [], kind: 'Band', title: '' },
    yAxis: { max: Number.NEGATIVE_INFINITY, min: Number.POSITIVE_INFINITY, title: '' },
  }
}

/** `value` as JavaScript's template literals write a number. */
function numberText(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

/**
 * `text.replace(/\n\s+/g, '\n')`: whitespace after each line break removed, line breaks within
 * it included.
 */
function accDescription(text: string): string {
  let out = ''
  let i = 0
  // Every `\s` character is in the Basic Multilingual Plane.
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i++
    if (c === 10) {
      while (i < text.length && isSpace(text.charCodeAt(i))) i++
    }
  }
  return out
}

/** Sets how the chart runs: `horizontal`, or else vertical. */
export function xyChartDbSetOrientation(db: XyChartDb, orientation: string): void {
  db.horizontal = orientation === 'horizontal'
}

/** Sets the title of the x axis. */
export function xyChartDbSetXAxisTitle(db: XyChartDb, title: string): void {
  xAxisSetTitle(db.xAxis, trim(title))
}

/** Makes the x axis a numeric range. */
export function xyChartDbSetXAxisRangeData(db: XyChartDb, min: number, max: number): void {
  const title = xAxisTitle(db.xAxis)
  xAxisSetTitle(db.xAxis, '')
  db.xAxis = { _0: { max, min, title }, kind: 'Linear' }
  db.hasSetXAxis = true
}

/** Makes the x axis categories. */
export function xyChartDbSetXAxisBand(db: XyChartDb, categories: string[]): void {
  const title = xAxisTitle(db.xAxis)
  xAxisSetTitle(db.xAxis, '')
  db.xAxis = { categories: categories.map((c) => trim(c)), kind: 'Band', title }
  db.hasSetXAxis = true
}

/** Sets the title of the y axis. */
export function xyChartDbSetYAxisTitle(db: XyChartDb, title: string): void {
  db.yAxis.title = trim(title)
}

/** Sets the range of the y axis. */
export function xyChartDbSetYAxisRangeData(db: XyChartDb, min: number, max: number): void {
  db.yAxis.min = min
  db.yAxis.max = max
  db.hasSetYAxis = true
}

function xyChartDbPlotData(db: XyChartDb, values: number[]): [string, number | undefined][] {
  if (values.length === 0) return []
  // The first series fixes the x range when no x-axis statement did.
  if (!db.hasSetXAxis) xyChartDbSetXAxisRangeData(db, 1, values.length)
  const axis = db.xAxis
  if (axis.kind === 'Band' && values.length > axis.categories.length) {
    values = values.slice(0, axis.categories.length)
  }
  if (!db.hasSetYAxis) {
    for (const value of values) {
      if (value < db.yAxis.min) db.yAxis.min = value
      if (value > db.yAxis.max) db.yAxis.max = value
    }
  }
  if (axis.kind === 'Band') {
    return axis.categories.map((category, i) => [category, values[i]])
  }
  const linear = axis._0
  if (values.length === 1) return [[numberText(linear.min), values[0]]]
  const step = (linear.max - linear.min) / (values.length - 1)
  return values.map((value, i) => {
    const at = linear.min + i * step
    return [numberText(at), value]
  })
}

function xyChartDbAddPlot(db: XyChartDb, bar: boolean, title: string, data: DataPoint[]): void {
  const values = data.map((d) => d.value)
  const pointLabels =
    !bar && data.some((d) => trim(d.label) !== '') ? data.map((d) => trim(d.label)) : undefined
  const plot: Plot = {
    bar,
    data: xyChartDbPlotData(db, values),
    // Mermaid accepts labels on the points of a bar series and ignores them.
    pointLabels,
    title: trim(title),
  }
  db.plots.push(plot)
}

/** Adds a line series. */
export function xyChartDbSetLineData(db: XyChartDb, title: string, data: DataPoint[]): void {
  xyChartDbAddPlot(db, false, title, data)
}

/** Adds a bar series. */
export function xyChartDbSetBarData(db: XyChartDb, title: string, data: DataPoint[]): void {
  xyChartDbAddPlot(db, true, title, data)
}

/** Sets the title from a `title` statement. */
export function xyChartDbSetDiagramTitle(db: XyChartDb, text: string): void {
  db.title = text
}

/** Sets the accessible title, without the whitespace it starts with. */
export function xyChartDbSetAccTitle(db: XyChartDb, text: string): void {
  db.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its lines. */
export function xyChartDbSetAccDescription(db: XyChartDb, text: string): void {
  db.accDescr = accDescription(text)
}
