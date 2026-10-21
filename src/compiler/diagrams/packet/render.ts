/**
 * @module Draws a packet diagram: rows of fields with their bit numbers. Port of Pele's
 * `src/diagrams/packet/render.ts`.
 */
import { type PacketBlock, type PacketModel, packetOption, property } from './model.ts'
import type { Rendered } from '../../diagrams.ts'
import { fitText } from '../common/fit_text.ts'
import { titleRoom, turnToFit } from '../common/fit_width.ts'
import { literalLabel } from '../common/literal_label.ts'
import { esc, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS } from '../../svg/theme.ts'
import { decode } from '../../text/entities.ts'
import { type Label, layoutLabel, trim } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { asInt, buf, fmax, fmin, powi } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

/**
 * Draws `model` with the `packet` section of `config`, running down when it does not fit the
 * host's width.
 */
export function render(model: PacketModel, config: Value, options: RenderOptions): Rendered {
  return turnToFit(options, (down) => draw(model, config, options, down))
}

/**
 * The rows of `model` regrouped `bitsPerRow` to a row. The model has split each field at its
 * own rows, so its pieces are joined again first, and a field is only split where one of the
 * new rows ends. A piece counts one bit short.
 */
function regroup(model: PacketModel, bitsPerRow: number): PacketBlock[][] {
  const piece = (block: PacketBlock): boolean => block.bits === block.end - block.start
  const whole: PacketBlock[] = []
  for (const row of model.rows) {
    for (const block of row) {
      const prev = whole[whole.length - 1]
      if (
        prev !== undefined &&
        piece(prev) &&
        piece(block) &&
        prev.label === block.label &&
        block.start === prev.end + 1 &&
        block.start % model.bitsPerRow === 0
      ) {
        prev.end = block.end
        prev.bits = prev.end - prev.start
      } else {
        whole.push({ ...block })
      }
    }
  }

  const rows: PacketBlock[][] = []
  for (const block of whole) {
    let start = block.start
    while (start <= block.end) {
      const end = fmin(block.end, (Math.floor(start / bitsPerRow) + 1) * bitsPerRow - 1)
      const index = Math.floor(start / bitsPerRow)
      // Fields are contiguous from bit 0, so a new row is always the next one.
      while (rows.length <= index) rows.push([])
      const row = rows[index]
      if (row !== undefined) row.push({ ...block, end, start })
      start = end + 1
    }
  }
  return rows
}

/** Draws `model`, running down when `down` is set. */
function draw(model: PacketModel, config: Value, options: RenderOptions, down: boolean): Rendered {
  const size = options.fontSize ?? 16
  const labelSize = jsRound(size * 0.875)
  const bitSize = jsRound(size * 0.625)
  const pad = options.padding ?? 8

  const packet = property(config, 'packet')
  const rowHeight = packetOption(config, 'rowHeight', 32, 1, 400)
  let bitWidth = packetOption(config, 'bitWidth', 32, 1, 400)
  const paddingX = packetOption(config, 'paddingX', 5, 0, 400)
  const paddingY = packetOption(config, 'paddingY', 5, 0, 400)
  const showBitsValue = packet === undefined ? undefined : property(packet, 'showBits')
  const showBits = !(showBitsValue !== undefined && showBitsValue.kind === 'Bool' && !showBitsValue._0)
  const orderValue = packet === undefined ? undefined : property(packet, 'bitOrder')
  const descending = orderValue !== undefined && orderValue.kind === 'String' && orderValue._0 === 'descending'
  let bitsPerRow = model.bitsPerRow
  let rows: PacketBlock[][]
  if (down) {
    const room = (options.maxWidth ?? 320) - 2 * pad
    const count = fmax(Math.floor(room / fmin(bitWidth, 18)), 1)
    // A byte is the shortest row. Below that every label is one character to a line, and a
    // long packet is a row to a bit.
    const power = powi(2, asInt(Math.floor(Math.log2(count)), -2147483648, 2147483647))
    bitsPerRow = fmin(bitsPerRow, fmax(8, power))
    const lastRow = model.rows[model.rows.length - 1]
    const lastBlock = lastRow === undefined ? undefined : lastRow[lastRow.length - 1]
    const last = lastBlock === undefined ? 0 : lastBlock.end
    if (Math.ceil((last + 1) / bitsPerRow) > 10000) bitsPerRow = model.bitsPerRow
    bitWidth = fmin(bitWidth, fmax(18, room / bitsPerRow))
    rows = regroup(model, bitsPerRow)
  } else {
    // Drawing only reads the rows, so the model's own serve.
    rows = model.rows
  }

  const labels: Label[][] = down
    ? rows.map((row) =>
        row.map((block) => {
          const room = fmax(1, (block.end - block.start + 1) * bitWidth - fmin(paddingX, bitWidth - 1) - 6)
          return literalLabel(trim(decode(block.label)), labelSize, room, 0)
        }),
      )
    : []
  // Bit numbers sit above each row and need room of their own.
  const numbers = showBits ? bitSize + 4 : 0
  const rowHeights: number[] = rows.map((_, index) => {
    let height = rowHeight
    for (const label of labels[index] ?? []) height = fmax(height, label.height + 10)
    return height
  })
  const tops: number[] = []
  let rowsHeight = 0
  for (const height of rowHeights) {
    tops.push(rowsHeight)
    rowsHeight += numbers + height + paddingY
  }
  if (rows.length > 0) rowsHeight -= paddingY

  const gap = fmin(paddingX, bitWidth - 1)
  const width = rows.length === 0 ? 0 : bitsPerRow * bitWidth - gap
  const title = layoutLabel(model.title, false, size, down ? titleRoom(options) : 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + (rowsHeight > 0 ? 12 : 0) : 0

  const left = pad + fmax(0, (title.width - width) / 2)
  const fields = buf()
  const bits = buf()
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] as PacketBlock[]
    const y = pad + (tops[index] ?? 0) + numbers
    const thisHeight = rowHeights[index] ?? rowHeight
    for (let at = 0; at < row.length; at++) {
      const block = row[at] as PacketBlock
      const count = block.end - block.start + 1
      const first = block.start % bitsPerRow
      const x = left + (descending ? bitsPerRow - first - count : first) * bitWidth
      const w = count * bitWidth - gap

      fields.s += '<g class="ondine-node" data-id="'
      pushNumber(fields, block.start)
      fields.s += '-'
      pushNumber(fields, block.end)
      fields.s += `"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(thisHeight)}" rx="${RADIUS}" fill="var(--_s)" stroke="var(--_b)"/>`
      if (down) {
        const label = labels[index]?.[at]
        if (label !== undefined) fields.s += labelSvg(label, x + w / 2, y + thisHeight / 2, '', undefined)
      } else {
        const text = fitText(trim(decode(block.label)), w - 6, labelSize, jsRound(size * 0.5), 0)
        if (text !== undefined && text.size <= thisHeight) {
          fields.s += `<text x="${num(x + w / 2)}" y="${num(y + thisHeight / 2 + text.size * 0.35)}"`
          if (text.size !== labelSize) {
            fields.s += ' font-size="'
            pushNum(fields, text.size)
            fields.s += '"'
          }
          fields.s += '>'
          fields.s += esc(text.text)
          fields.s += '</text>'
        }
      }
      fields.s += '</g>'

      if (!showBits) continue
      const leading = descending ? block.end : block.start
      const trailing = descending ? block.start : block.end
      const by = num(y - 4)
      if (count === 1) {
        bits.s += `<text x="${num(x + w / 2)}" y="${by}" text-anchor="middle">`
        pushNumber(bits, leading)
        bits.s += '</text>'
      } else {
        bits.s += `<text x="${num(x)}" y="${by}">`
        pushNumber(bits, leading)
        bits.s += `</text><text x="${num(x + w)}" y="${by}" text-anchor="end">`
        pushNumber(bits, trailing)
        bits.s += '</text>'
      }
    }
  }

  const totalWidth = Math.ceil(fmax(width, title.width) + 2 * pad)
  const totalHeight = Math.ceil(rowsHeight + titleHeight + 2 * pad)
  const content = buf()
  if (fields.s !== '') {
    content.s += '<g class="ondine-packet-fields" font-size="'
    pushNumber(content, labelSize)
    content.s += '" text-anchor="middle">'
    content.s += fields.s
    content.s += '</g>'
  }
  if (bits.s !== '') {
    content.s += '<g class="ondine-packet-bits" font-size="'
    pushNumber(content, bitSize)
    content.s += '" fill="var(--_m)">'
    content.s += bits.s
    content.s += '</g>'
  }
  // Mermaid puts a packet's title under it.
  content.s += labelSvg(
    title,
    totalWidth / 2,
    totalHeight - pad - title.height / 2,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )

  const svg = svgDocument(
    'packet',
    totalWidth,
    totalHeight,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content.s,
  )
  return { height: totalHeight, links: [], svg, width: totalWidth }
}

