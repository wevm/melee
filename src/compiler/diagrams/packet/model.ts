/**
 * @module The packet model: fields split into rows of bits. Port of Pele's
 * `src/diagrams/packet/model.ts`.
 */
import type { PacketAst } from './parser.ts'
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { buf, fmin } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

/** A field, or the piece of one in a row. */
export type PacketBlock = {
  /** As Mermaid counts it: one less than the width for the pieces of a field split across rows. */
  bits: number
  /** The last bit. */
  end: number
  /** The label. */
  label: string
  /** The first bit. */
  start: number
}

/** A packet diagram ready to draw: Pele's `PacketModel`. */
export type PacketModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Bits in each row. */
  bitsPerRow: number
  /** The rows of fields. */
  rows: PacketBlock[][]
  /** The title. */
  title: string | undefined
}

/** The most rows a packet is split into. */
const MAX_ROWS = 10_000

/**
 * The `packet` option `key` of `config` when it is a number at least `min`, capped at `max`, or
 * `fallback`.
 */
export function packetOption(config: Value, key: string, fallback: number, min: number, max: number): number {
  const packet = property(config, 'packet')
  const value = packet === undefined ? undefined : property(packet, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= min) return fmin(value._0, max)
  return fallback
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
export function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text.codePointAt(i) as number
    const step = c > 0xffff ? 2 : 1
    out += text.slice(i, i + step)
    i += step
    if (c === 0x0a) {
      while (i < n && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/** A semantic error whose message interleaves `parts` with `numbers`. */
function invalid(parts: string[], numbers: number[]): CompileError {
  const message = buf()
  for (let i = 0; i < parts.length; i++) {
    message.s += parts[i] as string
    const number = numbers[i]
    if (number !== undefined) pushNumber(message, number)
  }
  const error = errorNew(Code.Semantic, message.s)
  error.type = 'packet'
  return error
}

/**
 * Builds the model from `ast`, as Pele's `buildPacket` does. `title` comes from front matter.
 *
 * @throws {CompileError} A semantic error for a field that ends before it starts, does not follow
 *   the one before it, or has no bits.
 */
export function buildPacket(ast: PacketAst, config: Value, title: string | undefined): PacketModel {
  const bitsPerRow = Math.floor(packetOption(config, 'bitsPerRow', 32, 1, 4096))
  const rows: PacketBlock[][] = []
  let lastBit = -1
  let word: PacketBlock[] = []
  let row = 1

  for (const block of ast.blocks) {
    if (block.start !== undefined && block.end !== undefined && block.end < block.start) {
      throw invalid(
        ['Packet block ', ' - ', ' is invalid. End must be greater than start.'],
        [block.start, block.end],
      )
    }
    let start = block.start ?? lastBit + 1
    if (start !== lastBit + 1) {
      throw invalid(
        ['Packet block ', ' - ', ' is not contiguous. It should start from ', '.'],
        [start, block.end ?? start, lastBit + 1],
      )
    }
    if (block.bits === 0) {
      throw invalid(['Packet block ', ' is invalid. Cannot have a zero bit field.'], [start])
    }
    const end = block.end ?? start + (block.bits ?? 1) - 1
    let bits = block.bits ?? end - start + 1
    lastBit = end

    while (word.length <= bitsPerRow + 1 && rows.length < MAX_ROWS) {
      const rowEnd = row * bitsPerRow - 1
      if (end <= rowEnd) {
        word.push({ bits, end, label: block.label, start })
        if (end === rowEnd) {
          rows.push(word)
          word = []
          row += 1
        }
        break
      }
      word.push({ bits: rowEnd - start, end: rowEnd, label: block.label, start })
      rows.push(word)
      word = []
      row += 1
      start = rowEnd + 1
      bits = end - start
    }
  }
  if (word.length > 0) rows.push(word)

  const accDescr = ast.accDescr
  const accTitle = ast.accTitle
  const ownTitle = ast.title
  return {
    accDescr: accDescr !== undefined && accDescr !== '' ? dedentLines(accDescr) : undefined,
    accTitle: accTitle !== undefined && accTitle !== '' ? trimStart(accTitle) : undefined,
    bitsPerRow,
    rows,
    title: ownTitle !== undefined && ownTitle !== '' ? ownTitle : title,
  }
}
