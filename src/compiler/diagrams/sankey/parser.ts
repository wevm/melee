/**
 * @module The sankey parser: rows of source, target, and amount. Port of Pele's
 * `src/diagrams/sankey/parser.ts`.
 */
import { type SankeyDb, sankeyDbAddLink, sankeyDbFindOrCreateNode } from './db.ts'
import { T, type Token, tName, tokenize } from './lexer.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { parse } from '../../util/float.ts'

/** A blank as Mermaid's sankeyUtils strips it: JavaScript's `\s` without line breaks. */
function isBlank(c: number): boolean {
  if (c === 10 || c === 13) return false
  if (c < 128) return c === 32 || c === 9 || c === 11 || c === 12
  return (
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  )
}

/**
 * Mermaid's sankeyUtils: strips blanks at both ends of the text, then collapses runs of line
 * breaks so that no row is empty.
 */
export function prepareTextForParsing(text: string): string {
  // Every blank is in the Basic Multilingual Plane, so testing UTF-16 units tests characters.
  let start = 0
  let end = text.length
  while (start < end && isBlank(text.charCodeAt(start))) start++
  while (end > start && isBlank(text.charCodeAt(end - 1))) end--
  // Runs between line breaks are copied whole.
  let out = ''
  let from = start
  let i = start
  while (i < end) {
    const c = text.charCodeAt(i)
    if (c === 0x0a || c === 0x0d) {
      out += text.slice(from, i)
      out += '\n'
      i++
      while (i < end) {
        const d = text.charCodeAt(i)
        if (d !== 0x0a && d !== 0x0d) break
        i++
      }
      from = i
    } else i++
  }
  out += text.slice(from, end)
  return trim(out)
}

/** Whether `c` is an ASCII digit. */
function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

/** JavaScript's `parseFloat`: the longest leading decimal literal after whitespace, or `NaN`. */
export function parseFloat(text: string): number {
  text = trim(text)
  const at = (i: number): number | undefined => (i < text.length ? text.charCodeAt(i) : undefined)
  const first = at(0)
  const sign = first === 0x2b || first === 0x2d ? 1 : 0
  const negative = first === 0x2d

  if (text.startsWith('Infinity', sign)) {
    return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  }

  const digits = (from: number): number => {
    let count = 0
    while (from + count < text.length && isAsciiDigit(text.charCodeAt(from + count))) count++
    return count
  }
  const int = digits(sign)
  let end = sign + int
  let fraction = 0
  if (at(end) === 0x2e) {
    fraction = digits(end + 1)
    if (int > 0 || fraction > 0) end += 1 + fraction
  }
  if (int === 0 && fraction === 0) return Number.NaN
  const e = at(end)
  if (e === 0x65 || e === 0x45) {
    const s = at(end + 1)
    const exponentSign = s === 0x2b || s === 0x2d ? 1 : 0
    const exponent = digits(end + 1 + exponentSign)
    if (exponent > 0) end += 1 + exponentSign + exponent
  }
  return parse(text.slice(0, end)) ?? Number.NaN
}

/** `text` with each `""` read as one `"`. */
function unescape(text: string): string {
  return text.indexOf('""') < 0 ? text : text.split('""').join('"')
}

/**
 * Parses prepared sankey text into `db`.
 *
 * Throws a syntax error, with Mermaid's message, where the text leaves the grammar.
 */
export function parseSankey(src: string, db: SankeyDb): void {
  const tokens = tokenize(src)
  const parser: Parser = { i: 0, src, tokens }

  parserExpect(parser, T.Sankey, '')
  parserExpect(parser, T.Newline, '')
  for (;;) {
    const from = parserName(parser)
    parserExpect(parser, T.Comma, ", 'NEWLINE', 'EOF'")
    const to = parserName(parser)
    parserExpect(parser, T.Comma, ", 'NEWLINE', 'EOF'")
    const amount = parserField(parser)
    const source = sankeyDbFindOrCreateNode(db, from)
    const target = sankeyDbFindOrCreateNode(db, to)
    sankeyDbAddLink(db, source, target, parseFloat(amount))
    if (parserKind(parser) !== T.Newline) break
    parser.i += 1
  }
  if (parserKind(parser) === T.Eof) parser.i += 1
  if (parserKind(parser) !== T.End) throw parserFail(parser, "'NEWLINE', 'EOF'")
}

/** The parser's position in the token list. */
type Parser = {
  i: number
  src: string
  tokens: Token[]
}

function parserKind(parser: Parser): T | undefined {
  return parser.tokens[parser.i]?.kind
}

function parserFail(parser: Parser, expected: string): CompileError {
  const token = parser.tokens[parser.i]
  let got: string
  if (token === undefined) got = 'undefined'
  else if (token.kind === T.Stuck) {
    const previous = parser.i > 0 ? parser.tokens[parser.i - 1] : undefined
    got = previous === undefined ? 'undefined' : tName(previous.kind)
  } else got = tName(token.kind)
  let detail = 'Expecting '
  detail += expected
  detail += ", got '"
  detail += got
  detail += "'"
  const offset = token === undefined ? parser.src.length : token.start
  return errorSyntax('sankey', parser.src, offset, detail, false)
}

function parserExpect(parser: Parser, kind: T, also: string): void {
  if (parserKind(parser) !== kind) {
    let expected = "'"
    expected += tName(kind)
    expected += "'"
    expected += also
    throw parserFail(parser, expected)
  }
  parser.i += 1
}

function parserField(parser: Parser): string {
  const token = parser.tokens[parser.i]
  if (token !== undefined && token.kind === T.NonEscapedText) {
    parser.i += 1
    return token.text
  }
  if (parserKind(parser) !== T.Dquote) throw parserFail(parser, "'DQUOTE', 'NON_ESCAPED_TEXT'")
  parser.i += 1
  const text = parser.tokens[parser.i]
  if (text === undefined || text.kind !== T.EscapedText) throw parserFail(parser, "'ESCAPED_TEXT'")
  parser.i += 1
  parserExpect(parser, T.Dquote, '')
  return text.text
}

function parserName(parser: Parser): string {
  return unescape(trim(parserField(parser)))
}
