/**
 * @module Draws a sankey diagram: node bars, bands between them, and labels beside the bars. Port
 * of Pele's `src/diagrams/sankey/render.ts`.
 */
import type { SankeyDb } from './db.ts'
import { Alignment, type PlacedLink, type PlacedNode, layoutSankey } from './layout.ts'
import type { Rendered } from '../../diagrams.ts'
import { fitWidth, titleRoom } from '../common/fit_width.ts'
import { CompileError } from '../../error.ts'
import { esc, escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { resolveStyle, seriesColor } from '../../svg/theme.ts'
import { layoutLabel } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD } from '../../text/measure.ts'
import { type Buf, type Result, buf, err, fmax, fmin, ok } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

/** Space between a bar and its label. */
const LABEL_GAP = 6.0

/** Extra node padding that makes room for values. */
const VALUE_GAP = 15.0

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** A number option at least `min`, capped at `max`, or `fallback`. */
function numberOption(conf: Value, key: string, fallback: number, min: number, max: number): number {
  const value = property(conf, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= min) return fmin(value._0, max)
  return fallback
}

/** A string option, or a finite number written as JavaScript's `String` writes it, or empty. */
function textOption(conf: Value, key: string): string {
  const value = property(conf, key)
  if (value === undefined) return ''
  if (value.kind === 'String') return value._0
  if (value.kind === 'Number' && Number.isFinite(value._0)) {
    const out = buf()
    pushNumber(out, value._0)
    return out.s
  }
  return ''
}

/** Two decimals, as Mermaid shows values; numbers too large for that are left as they are. */
function rounded(value: number): number {
  return Math.abs(value) < 1e15 ? jsRound(value * 100) / 100 : value
}

/** A colour from the configuration, as an inline style that overrides the series colour. */
function fillStyle(color: Value | undefined): string {
  if (color === undefined || color.kind !== 'String') return ''
  let declaration = 'fill:'
  declaration += color._0
  return resolveStyle([declaration]).shape
}

/**
 * Draws `model` with the `sankey` section of `config`, narrowed to fit the host's width.
 *
 * Throws a semantic error when the links form a cycle.
 */
export function render(model: SankeyDb, config: Value, options: RenderOptions): Rendered {
  const section = property(config, 'sankey')
  const conf: Value = section !== undefined && section.kind === 'Object' ? section : { kind: 'Object', _0: [] }
  const width = numberOption(conf, 'width', 600.0, 1.0, 10000.0)
  const result = fitWidth(options, width, 160.0, (chartWidth) => draw(model, conf, options, chartWidth))
  if (result._0.ok) return result._0.value
  throw result._0.error
}

/** A drawing or the error that stopped it, as {@link fitWidth} takes it. */
type Drawn = {
  _0: Result<Rendered, CompileError>
  readonly width: number
}

function drawn(result: Result<Rendered, CompileError>): Drawn {
  return { _0: result, width: result.ok ? result.value.width : 0 }
}

function draw(model: SankeyDb, conf: Value, options: RenderOptions, chartWidth: number): Drawn {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8.0

  const chartHeight = numberOption(conf, 'height', 400.0, 1.0, 10000.0)
  const nodeWidth = fmin(numberOption(conf, 'nodeWidth', 10.0, 1.0, 200.0), chartWidth)
  const showValuesValue = property(conf, 'showValues')
  const showValues = !(showValuesValue !== undefined && showValuesValue.kind === 'Bool' && !showValuesValue._0)
  const prefix = textOption(conf, 'prefix')
  const suffix = textOption(conf, 'suffix')
  const labelStyle = property(conf, 'labelStyle')
  const outlined = labelStyle !== undefined && labelStyle.kind === 'String' && labelStyle._0 === 'outlined'
  const nodeAlignment = property(conf, 'nodeAlignment')
  let alignment: Alignment = Alignment.Justify
  if (nodeAlignment !== undefined && nodeAlignment.kind === 'String') {
    if (nodeAlignment._0 === 'left') alignment = Alignment.Left
    else if (nodeAlignment._0 === 'right') alignment = Alignment.Right
    else if (nodeAlignment._0 === 'center') alignment = Alignment.Center
  }
  const linkColorValue = property(conf, 'linkColor')
  const linkColor = linkColorValue !== undefined && linkColorValue.kind === 'String' ? linkColorValue._0 : 'gradient'

  let nodes: PlacedNode[]
  let links: PlacedLink[]
  try {
    ;[nodes, links] = layoutSankey(model, {
      alignment,
      height: chartHeight,
      labelHeight: small * 1.15,
      nodePadding: numberOption(conf, 'nodePadding', 12.0, 0.0, 200.0) + (showValues ? VALUE_GAP : 0.0),
      nodeWidth,
      width: chartWidth,
    })
  } catch (error) {
    if (error instanceof CompileError) return drawn(err(error))
    throw error
  }

  // Configured colours by node name. Only looked up, so mapping order does not matter.
  const custom: [string, string][] = []
  const nodeColors = property(conf, 'nodeColors')
  if (nodeColors !== undefined && nodeColors.kind === 'Object') {
    for (const [id, color] of nodeColors._0) {
      const style = fillStyle(color)
      if (style !== '') custom.push([id, style])
    }
  }
  const nodeStyle = (i: number): string => {
    const node = model.nodes[i]
    if (node === undefined) return ''
    return custom.find(([id]) => id === node.id)?.[1] ?? ''
  }

  // Labels sit beside the bars, on the side that faces the middle of the chart.
  let central = 0
  let most = 0.0
  for (const node of nodes) {
    if (node.value > most) {
      most = node.value
      central = node.layer
    }
  }
  let minX = 0.0
  let maxX = chartWidth
  let minY = 0.0
  let maxY = chartHeight
  let labelsOut = ''
  const nodesOut: Buf = buf()
  const nodeWidthText = num(nodeWidth)
  // Escaped node names by index, for the links too.
  const escIds: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as PlacedNode
    const id = model.nodes[i]?.id ?? ''
    const height = fmax(node.height, 1.0)
    const escId = escText(id)
    escIds.push(escId)
    nodesOut.s += `<rect class="ondine-sankey-node" data-id="${escId}" x="${num(node.x)}" y="${num(node.y)}" width="${nodeWidthText}" height="${num(height)}" rx="${num(fmin(2.0, height / 2.0))}" fill="${seriesColor(i)}"${nodeStyle(i)}/>`

    let value = ''
    if (showValues) {
      // `String` writes numbers as `pushNumber` does, and faster.
      value = `${prefix}${String(rounded(node.value))}${suffix}`
    }
    const after = outlined ? node.layer >= central : node.x < chartWidth / 2.0
    let textWidth: number
    if (value === '') textWidth = measure.width(id, small, 0)
    else {
      let both = id
      both += ' '
      both += value
      textWidth = measure.width(both, small, 0)
    }
    const x = after ? node.x + nodeWidth + LABEL_GAP : node.x - LABEL_GAP
    const y = node.y + node.height / 2.0
    minX = fmin(minX, after ? x : x - textWidth)
    maxX = fmax(maxX, after ? x + textWidth : x)
    minY = fmin(minY, y - small * 0.75)
    maxY = fmax(maxY, y + small * 0.75)

    const position = ` x="${num(x)}" y="${num(y + small * 0.35)}" text-anchor="${after ? 'start' : 'end'}"`

    labelsOut += '<g class="ondine-label" data-id="'
    labelsOut += escId
    labelsOut += '">'
    if (outlined) {
      labelsOut += '<text'
      labelsOut += position
      labelsOut += ' fill="none" stroke="var(--_bg)" stroke-width="3" stroke-linejoin="round">'
      labelsOut += esc(id)
      if (value !== '') {
        labelsOut += ' '
        labelsOut += esc(value)
      }
      labelsOut += '</text>'
    }
    labelsOut += '<text'
    labelsOut += position
    labelsOut += '>'
    labelsOut += esc(id)
    if (value !== '') {
      labelsOut += ' <tspan class="ondine-sankey-value" fill="var(--_m)">'
      labelsOut += esc(value)
      labelsOut += '</tspan>'
    }
    labelsOut += '</text></g>'
  }

  const fixed =
    linkColor === 'gradient' || linkColor === 'source' || linkColor === 'target'
      ? ''
      : fillStyle(property(conf, 'linkColor'))
  const out: Buf = buf()
  const escPrefix = escText(prefix)
  const escSuffix = escText(suffix)
  for (const link of links) {
    // Without definitions there are no gradients, so a gradient link takes its source's colour.
    const end = linkColor === 'target' ? link.target : link.source
    const half = fmax(link.thickness, 1.0) / 2.0
    const x0 = (nodes[link.source]?.x ?? 0.0) + nodeWidth
    const x1 = nodes[link.target]?.x ?? 0.0
    // JavaScript rounds the sum, then halves it.
    const mid = num((x0 + x1) / 2.0)
    const from = escIds[link.source] ?? ''
    const to = escIds[link.target] ?? ''
    const sx = num(x0)
    const tx = num(x1)
    const s0 = num(link.sourceY - half)
    const s1 = num(link.sourceY + half)
    const t0 = num(link.targetY - half)
    const t1 = num(link.targetY + half)
    const style = fixed === '' ? nodeStyle(end) : fixed
    out.s += `<path class="ondine-sankey-link" data-id="${from}-&gt;${to}" d="M${sx},${s0}C${mid},${s0} ${mid},${t0} ${tx},${t0}L${tx},${t1}C${mid},${t1} ${mid},${s1} ${sx},${s1}Z" fill="${seriesColor(end)}"${style}><title>${from} → ${to}: ${escPrefix}${String(rounded(link.value))}${escSuffix}</title></path>`
  }
  const linksOut = out.s

  const title = layoutLabel(model.title, false, size, titleRoom(options), BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 12.0 : 0.0
  const inner = fmax(maxX - minX, title.width)
  const ox = pad - minX + (inner - (maxX - minX)) / 2.0
  const oy = pad + titleHeight - minY
  const width = Math.ceil(inner + 2.0 * pad)
  const height = Math.ceil(maxY - minY + titleHeight + 2.0 * pad)

  const content = buf(
    labelSvg(title, width / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  )
  content.s += '<g transform="translate('
  pushNum(content, ox)
  content.s += ','
  pushNum(content, oy)
  content.s += ')"><g class="ondine-sankey-links" fill-opacity="0.4">'
  content.s += linksOut
  content.s += '</g><g class="ondine-sankey-nodes">'
  content.s += nodesOut.s
  content.s += '</g><g class="ondine-labels" font-size="'
  pushNumber(content, small)
  content.s += '">'
  content.s += labelsOut
  content.s += '</g></g>'

  const accessible: Accessible = {
    accDescr: model.accDescr,
    accTitle: model.accTitle,
  }
  const svg = svgDocument('sankey', width, height, size, options, accessible, content.s)

  return drawn(
    ok({
      height,
      links: [],
      svg,
      width,
    }),
  )
}
