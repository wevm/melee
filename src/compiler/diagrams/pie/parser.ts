/**
 * @module The pie parser: Mermaid's Langium pie grammar over the shared tokenizer. Port of Pele's
 * `src/diagrams/pie/parser.ts`.
 */
import {
  ACC_DESCR,
  ACC_TITLE,
  accDescrValue,
  accTitleValue,
  DIRECTIVE,
  EOF,
  keyword,
  literal,
  type Memo,
  NEWLINE,
  type Reader,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerTake,
  SINGLE_LINE_COMMENT,
  STRING,
  stringValue,
  TITLE,
  type TokenType,
  titleValue,
  tokenize,
  WHITESPACE,
  YAML,
} from '../common/tokens.ts'
import { parse } from '../../util/float.ts'

/** Token kinds, as indices into {@link PIE_TOKENS}. */
const t = {
  SHOW_DATA: 0,
  PIE: 1,
  COLON: 2,
  NUMBER: 3,
  ACC_DESCR: 4,
  ACC_TITLE: 5,
  TITLE: 6,
  STRING: 7,
  NEWLINE: 8,
} as const

/** Whether the UTF-16 unit at `at` is an ASCII digit. */
function isDigitAt(src: string, at: number): boolean {
  const c = src.charCodeAt(at)
  return c >= 0x30 && c <= 0x39
}

/** Where a run of ASCII digits from `from` ends. */
function digits(src: string, from: number): number {
  let at = from
  while (isDigitAt(src, at)) at += 1
  return at
}

/**
 * Answers as `NUMBER_PIE`'s pattern `(?:-?[0-9]+\.[0-9]+(?!\.))|(?:-?(0|[1-9][0-9]*)(?!\.))`
 * does. The pattern reads a whole run of digits before it finds there is no fraction, and would
 * do so again from every digit of a long run of zeros, so the run is remembered: `memo[0]` and
 * `memo[1]` are its start and end, and `memo[2]` is one past the fraction's end, or 0.
 */
function number(src: string, p: number, memo: Memo): number | undefined {
  const at = src.charCodeAt(p) === 0x2d ? p + 1 : p
  if (at < (memo[0] as number) || at >= (memo[1] as number)) {
    const end = digits(src, at)
    memo[0] = at
    memo[1] = end
    memo[2] = 0
    if (end > at && src.charCodeAt(end) === 0x2e) {
      const stop = digits(src, end + 1)
      const length = stop - end - 1
      if (length > 0 && src.charCodeAt(stop) !== 0x2e) {
        memo[2] = stop + 1
      } else if (length > 1) {
        memo[2] = stop
      }
    }
  }

  const end = memo[1] as number
  if (end === at) return undefined
  const fraction = memo[2] as number
  if (fraction > 0) return fraction - 1
  if (src.charCodeAt(at) === 0x30) {
    return src.charCodeAt(at + 1) !== 0x2e ? at + 1 : undefined
  }
  if (src.charCodeAt(end) !== 0x2e) return end
  return end - 1 > at ? end - 1 : undefined
}

/** Pele's `PIE_TOKENS`, in matching order. */
export const PIE_TOKENS: TokenType[] = [
  keyword('showData'),
  keyword('pie'),
  literal(':'),
  {
    ...literal(''),
    first: '-0123456789',
    name: 'NUMBER_PIE',
    pattern: { kind: 'Scan', _0: number },
  },
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  STRING,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
]

/** One slice as written. */
export type PieSection = {
  /** The label. */
  label: string
  /** The value. */
  value: number
}

/** The parsed pie chart: Pele's `PieAst`. */
export type PieAst = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** Slices in authored order. */
  sections: PieSection[]
  /** Whether `showData` follows `pie`. */
  showData: boolean
  /** The `title` value. */
  title: string | undefined
}

/** `PieAst::default()`. */
export function pieAstDefault(): PieAst {
  return { accDescr: undefined, accTitle: undefined, sections: [], showData: false, title: undefined }
}

/** Skips line breaks after a statement, which must end its line. */
function endOfLine(r: Reader): void {
  if (readerKind(r) === EOF) return
  if (readerKind(r) !== t.NEWLINE) throw readerFail(r, 'a line break or the end of input')
  while (readerAccept(r, t.NEWLINE)) {}
}

/**
 * Parses pie `src` as Pele's `parsePie` does.
 *
 * Throws a syntax error where the source leaves the grammar.
 */
export function parsePie(src: string): PieAst {
  const r = readerNew(tokenize(src, PIE_TOKENS, 'pie'), PIE_TOKENS, 'pie')
  const ast = pieAstDefault()

  while (readerAccept(r, t.NEWLINE)) {}
  readerExpect(r, t.PIE)
  ast.showData = readerAccept(r, t.SHOW_DATA)
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
      case t.STRING: {
        const label = stringValue(readerTake(r))
        readerExpect(r, t.COLON)
        const value = parse(readerExpect(r, t.NUMBER)) ?? Number.NaN
        ast.sections.push({ label, value })
        endOfLine(r)
        break
      }
      default:
        throw readerFail(r, 'a section, a title, or a line break')
    }
  }
  return ast
}
