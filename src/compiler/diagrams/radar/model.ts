/**
 * @module The radar model: axes, curves with a value per axis, and chart options. Port of Pele's
 * `src/diagrams/radar/model.ts`.
 */
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import type { RadarAst } from './parser.ts'

/** An axis: Pele's `RadarAxis`. */
export type RadarAxis = {
  /** The label, or the name when none is given. */
  label: string
  /** The name. */
  name: string
}

/** A curve: Pele's `RadarCurve`. */
export type RadarCurve = {
  /** Values in axis order, or as written when the curve does not name its axes. */
  entries: number[]
  /** The label, or the name when none is given. */
  label: string
  /** The name. */
  name: string
}

/** Chart options: Pele's `RadarOptions`. */
export type RadarOptions = {
  /** `circle` or `polygon`. */
  graticule: string
  /** The value at the rim, or the largest value when `undefined`. */
  max: number | undefined
  /** The value at the center. */
  min: number
  /** Whether the legend is drawn. */
  showLegend: boolean
  /** The number of graticule rings, at most {@link MAX_TICKS}. */
  ticks: number
}

/** A radar chart ready to draw: Pele's `RadarModel`. */
export type RadarModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Axes in authored order. */
  axes: RadarAxis[]
  /** Curves in authored order. */
  curves: RadarCurve[]
  /** Chart options. */
  options: RadarOptions
  /** The title. */
  title: string | undefined
}

/** The most graticule rings. */
const MAX_TICKS = 32

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 0x0a) {
      while (i < text.length && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/** A semantic error with `message`. */
function invalid(message: string): CompileError {
  const error = errorNew(Code.Semantic, message)
  error.type = 'radar'
  return error
}

/**
 * Builds the model from `ast`, as Pele's `buildRadar` does. `title` comes from front matter.
 *
 * @throws {CompileError} A semantic error for a curve that names axes before any axis exists,
 * or misses one.
 */
export function buildRadar(ast: RadarAst, title: string | undefined): RadarModel {
  const axes: RadarAxis[] = ast.axes.map((axis) => ({
    label: axis.label ?? axis.name,
    name: axis.name,
  }))

  const curves: RadarCurve[] = []
  for (const curve of ast.curves) {
    const detailed = curve.entries[0]?.axis !== undefined
    let entries: number[]
    if (detailed) {
      if (axes.length === 0) {
        throw invalid('Axes must be populated before curves for reference entries')
      }
      // The first value for each axis counts.
      const byAxis = new Map<string, number>()
      for (const entry of curve.entries) {
        if (entry.axis !== undefined && !byAxis.has(entry.axis)) byAxis.set(entry.axis, entry.value)
      }
      entries = []
      for (const axis of axes) {
        const value = byAxis.get(axis.name)
        if (value === undefined) throw invalid(`Missing entry for axis ${axis.label}`)
        entries.push(value)
      }
    } else {
      entries = curve.entries.map((entry) => entry.value)
    }
    curves.push({
      entries,
      label: curve.label ?? curve.name,
      name: curve.name,
    })
  }

  const options: RadarOptions = {
    graticule: 'circle',
    max: undefined,
    min: 0,
    showLegend: true,
    ticks: 5,
  }
  for (const option of ast.options) {
    const value = option.value
    switch (option.name) {
      case 'showLegend':
        if (value.kind === 'Bool') options.showLegend = value._0
        break
      case 'graticule':
        if (value.kind === 'Text') options.graticule = value._0
        break
      case 'ticks':
        if (value.kind === 'Number') options.ticks = value._0
        break
      case 'max':
        if (value.kind === 'Number') options.max = value._0
        break
      case 'min':
        if (value.kind === 'Number') options.min = value._0
        break
    }
  }
  if (options.ticks > MAX_TICKS) options.ticks = MAX_TICKS

  return {
    accDescr: ast.accDescr !== undefined && ast.accDescr !== '' ? dedentLines(ast.accDescr) : undefined,
    accTitle: ast.accTitle !== undefined && ast.accTitle !== '' ? trimStart(ast.accTitle) : undefined,
    axes,
    curves,
    options,
    title: ast.title !== undefined && ast.title !== '' ? ast.title : title,
  }
}
