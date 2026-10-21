/**
 * @module The packet parser: Mermaid's Langium packet grammar over the shared tokenizer. Port of
 * Pele's `src/diagrams/packet/parser.ts`.
 */
import {
  ACC_DESCR,
  ACC_TITLE,
  DIRECTIVE,
  EOF,
  NEWLINE,
  type Reader,
  SINGLE_LINE_COMMENT,
  STRING,
  TITLE,
  type TokenType,
  WHITESPACE,
  YAML,
  accDescrValue,
  accTitleValue,
  keyword,
  literal,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerTake,
  stringValue,
  titleValue,
  tokenize,
} from '../common/tokens.ts'
import { parse as floatParse } from '../../util/float.ts'

/** Token kinds, as indices into {@link PACKET_TOKENS}. */
const t = {
  PACKET_BETA: 0,
  PACKET: 1,
  DASH: 2,
  PLUS: 3,
  COLON: 4,
  ACC_DESCR: 5,
  ACC_TITLE: 6,
  TITLE: 7,
  INT: 8,
  STRING: 9,
  NEWLINE: 10,
  YAML: 12,
} as const

/**
 * `0|[1-9][0-9]*(?!\.)`: a lone zero, or digits not followed by a dot. Before a dot the run
 * gives up its last digit.
 */
function int(src: string, p: number): number | undefined {
  const c = src.charCodeAt(p)
  if (Number.isNaN(c)) return undefined
  if (c === 0x30) return p + 1
  if (!(c >= 0x31 && c <= 0x39)) return undefined
  let end = p + 1
  while (end < src.length && isAsciiDigit(src.charCodeAt(end))) end += 1
  if (src.charCodeAt(end) !== 0x2e) return end
  return end - 1 > p ? end - 1 : undefined
}

function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

/** Pele's `PACKET_TOKENS`, in matching order. */
export const PACKET_TOKENS: TokenType[] = [
  literal('packet-beta'),
  keyword('packet'),
  // A front matter block also starts with dashes, so Langium lets it win over a dash.
  {
    ...literal('-'),
    longer: [t.YAML],
  },
  literal('+'),
  literal(':'),
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  {
    ...literal(''),
    first: '0123456789',
    name: 'INT',
    pattern: { kind: 'Match', _0: int },
  },
  STRING,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
]

/** One field as written: Pele's `PacketBlockAst`. */
export type PacketBlockAst = {
  /** The width in bits, for a `+bits` field. */
  bits: number | undefined
  /** The last bit, for a `start-end` field. */
  end: number | undefined
  /** The label. */
  label: string
  /** The first bit, for a `start` or `start-end` field. */
  start: number | undefined
}

export function packetBlockAstDefault(): PacketBlockAst {
  return { bits: undefined, end: undefined, label: '', start: undefined }
}

/** The parsed packet diagram: Pele's `PacketAst`. */
export type PacketAst = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** Fields in authored order. */
  blocks: PacketBlockAst[]
  /** The `title` value. */
  title: string | undefined
}

export function packetAstDefault(): PacketAst {
  return { accDescr: undefined, accTitle: undefined, blocks: [], title: undefined }
}

/** Skips line breaks after a statement, which must end its line. */
function endOfLine(r: Reader): void {
  if (readerKind(r) === EOF) return
  if (readerKind(r) !== t.NEWLINE) throw readerFail(r, 'a line break or the end of input')
  while (readerAccept(r, t.NEWLINE)) {}
}

/** JavaScript's `Number` of an `INT` token. */
function number(text: string): number {
  return floatParse(text) ?? Number.NaN
}

/**
 * Parses packet `src` as Pele's `parsePacket` does.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function parsePacket(src: string): PacketAst {
  const r = readerNew(tokenize(src, PACKET_TOKENS, 'packet'), PACKET_TOKENS, 'packet')
  const ast = packetAstDefault()

  while (readerAccept(r, t.NEWLINE)) {}
  if (!readerAccept(r, t.PACKET_BETA)) readerExpect(r, t.PACKET)
  while (readerKind(r) !== EOF) {
    switch (readerKind(r)) {
      case t.NEWLINE:
        r.i += 1
        break
      case t.ACC_DESCR:
        ast.accDescr = accDescrValue(readerTake(r))
        endOfLine(r)
        break
      case t.ACC_TITLE:
        ast.accTitle = accTitleValue(readerTake(r))
        endOfLine(r)
        break
      case t.TITLE:
        ast.title = titleValue(readerTake(r))
        endOfLine(r)
        break
      case t.INT:
      case t.PLUS: {
        const block = packetBlockAstDefault()
        if (readerAccept(r, t.PLUS)) {
          block.bits = number(readerExpect(r, t.INT))
        } else {
          block.start = number(readerTake(r))
          if (readerAccept(r, t.DASH)) block.end = number(readerExpect(r, t.INT))
        }
        readerExpect(r, t.COLON)
        block.label = stringValue(readerExpect(r, t.STRING))
        ast.blocks.push(block)
        endOfLine(r)
        break
      }
      default:
        throw readerFail(r, 'a field, a title, or a line break')
    }
  }
  return ast
}
