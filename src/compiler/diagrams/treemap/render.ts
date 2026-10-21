/**
 * @module Draws a treemap: sections with headers and leaves with names and values. Port of Pele's
 * `src/diagrams/treemap/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { fitText } from '../common/fit_text.ts'
import { capWidth, titleRoom } from '../common/fit_width.ts'
import { esc, escText, jsRound, labelSvg, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS, classNames, resolveStyle, seriesColor } from '../../svg/theme.ts'
import { decode } from '../../text/entities.ts'
import { layoutLabel, trim } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD } from '../../text/measure.ts'
import { type Buf, buf, fmax, fmin } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'
import { format, formatter } from './format.ts'
import { layoutTreemap } from './layout.ts'
import type { TreemapModel } from './model.ts'

/** The height of a section header. */
const HEADER = 28
/** The space a section keeps around its children below its header. */
const SIDE = 6
/** Line height of leaf text, as a multiple of its size. */
const LINE = 1.25

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/**
 * The `treemap` option `key` of `config` when it is a number at least `min`, capped at `max`, or
 * `fallback`.
 */
function option(config: Value, key: string, fallback: number, min: number, max: number): number {
  const treemap = property(config, 'treemap')
  const value = treemap === undefined ? undefined : property(treemap, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= min) return fmin(value._0, max)
  return fallback
}

/** Draws `model` with the `treemap` section of `config`. */
export function render(model: TreemapModel, config: Value, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.875)
  const tiny = jsRound(size * 0.75)
  const least = jsRound(size * 0.5625)
  const treemap = property(config, 'treemap')
  const pad = options.padding ?? option(config, 'diagramPadding', 8, 0, 2000)

  // Mermaid sizes the diagram as ten times `nodeWidth` by ten times `nodeHeight`.
  const width = jsRound(capWidth(options, option(config, 'nodeWidth', 64, 1, 400) * 10, 200, 2 * pad))
  const height = jsRound(option(config, 'nodeHeight', 40, 1, 400) * 10)
  const showValuesValue = treemap === undefined ? undefined : property(treemap, 'showValues')
  const showValues = !(showValuesValue !== undefined && showValuesValue.kind === 'Bool' && !showValuesValue._0)
  const specValue = treemap === undefined ? undefined : property(treemap, 'valueFormat')
  const spec = specValue !== undefined && specValue.kind === 'String' ? formatter(specValue._0) : formatter(',')
  const [boxes, placed] = layoutTreemap(model.roots, width, height, {
    gap: option(config, 'padding', 4, 0, 200),
    header: HEADER,
    side: SIDE,
  })

  const title = layoutLabel(model.title, false, size, titleRoom(options), BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 8 : 0
  const left = pad + fmax(0, (title.width - width) / 2)
  const top = pad + titleHeight

  let sections = ''
  let leaves = ''
  for (const k of placed) {
    const b = boxes[k]
    if (b === undefined) continue
    const node = b.node
    const style = resolveStyle(node.cssCompiledStyles ?? [])
    const color = seriesColor(b.series)
    const x = left + b.x
    const y = top + b.y
    const decoded = decode(node.name)
    const name = trim(decoded)
    const value = showValues ? format(spec, b.value) : ''
    const classes = classNames(node.classSelector ?? '')

    const rect: Buf = buf('data-id="')
    rect.s += escText(node.name)
    rect.s += '"><rect x="'
    pushNum(rect, x)
    rect.s += '" y="'
    pushNum(rect, y)
    rect.s += '" width="'
    pushNum(rect, b.w)
    rect.s += '" height="'
    pushNum(rect, b.h)
    rect.s += '" rx="'
    rect.s += RADIUS
    rect.s += '" fill="'
    rect.s += color
    rect.s += '"'

    if (node.children !== undefined) {
      const text = buf()
      if (b.h >= HEADER) {
        const room = b.w - 2 * SIDE - 4
        const valueWidth = value === '' ? 0 : measure.width(value, tiny, 0)
        const withValue = valueWidth > 0 && room - valueWidth - 12 >= 3 * small
        const label = fitText(name, withValue ? room - valueWidth - 12 : room, small, small, BOLD)
        const baseline = y + HEADER / 2 + 1
        if (label !== undefined) {
          text.s += '<text x="'
          pushNum(text, x + SIDE + 2)
          text.s += '" y="'
          pushNum(text, baseline + small * 0.35)
          text.s += '" font-weight="var(--_hw)"'
          text.s += style.text
          text.s += '>'
          text.s += esc(label.text)
          text.s += '</text>'
        }
        if (withValue) {
          text.s += '<text class="ondine-value" x="'
          pushNum(text, x + b.w - SIDE - 2)
          text.s += '" y="'
          pushNum(text, baseline + tiny * 0.35)
          text.s += '" font-size="'
          pushNumber(text, tiny)
          text.s += '" text-anchor="end" fill="var(--_m)"'
          text.s += style.text
          text.s += '>'
          text.s += esc(value)
          text.s += '</text>'
        }
      }
      // A section is a tint of its color, unless a class gives it a fill of its own.
      const ownFill = style.shape.includes('"fill:') || style.shape.includes(';fill:')
      sections += '<g class="ondine-node ondine-section'
      sections += classes
      sections += '" '
      sections += rect.s
      if (!ownFill) sections += ' fill-opacity="0.12"'
      sections += ' stroke="'
      sections += color
      sections += '"'
      sections += style.shape
      sections += '/>'
      sections += text.s
      sections += '</g>'
      continue
    }

    const text = buf()
    const room = b.w - 8
    const tallest = fmin(size, Math.floor((b.h - 4) / LINE))
    const label = tallest >= least ? fitText(name, room, tallest, least, 0) : undefined
    if (label !== undefined) {
      const cxBuf = buf()
      pushNum(cxBuf, x + b.w / 2)
      const cx = cxBuf.s
      const cy = y + b.h / 2
      const valueSize = fmax(least, jsRound(label.size * 0.8))
      const lines = (label.size + valueSize) * LINE
      const pushText = (out: Buf, cls: string, ty: number, sz: number, body: string): void => {
        out.s += '<text'
        out.s += cls
        out.s += ' x="'
        out.s += cx
        out.s += '" y="'
        pushNum(out, ty + sz * 0.35)
        out.s += '" font-size="'
        pushNum(out, sz)
        out.s += '"'
        out.s += style.text
        out.s += '>'
        out.s += esc(body)
        out.s += '</text>'
      }
      if (value !== '' && lines <= b.h - 4 && measure.width(value, valueSize, 0) <= room) {
        const first = cy - lines / 2 + (label.size * LINE) / 2
        const second = cy + lines / 2 - (valueSize * LINE) / 2
        pushText(text, '', first, label.size, label.text)
        pushText(text, ' class="ondine-value"', second, valueSize, value)
      } else {
        pushText(text, '', cy, label.size, label.text)
      }
    }
    leaves += '<g class="ondine-node ondine-leaf'
    leaves += classes
    leaves += '" '
    leaves += rect.s
    leaves += style.shape
    leaves += '/>'
    leaves += text.s
    leaves += '</g>'
  }

  const totalWidth = Math.ceil(fmax(width, title.width) + 2 * pad)
  const totalHeight = Math.ceil(height + titleHeight + 2 * pad)
  const content = buf(
    labelSvg(title, totalWidth / 2, pad + title.height / 2, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  )
  if (sections !== '') {
    content.s += '<g class="ondine-sections" font-size="'
    pushNumber(content, small)
    content.s += '">'
    content.s += sections
    content.s += '</g>'
  }
  if (leaves !== '') {
    content.s += '<g class="ondine-leaves" text-anchor="middle" fill="var(--_bg)">'
    content.s += leaves
    content.s += '</g>'
  }

  const svg = svgDocument(
    'treemap',
    totalWidth,
    totalHeight,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content.s,
  )
  return { height: totalHeight, links: [], svg, width: totalWidth }
}
