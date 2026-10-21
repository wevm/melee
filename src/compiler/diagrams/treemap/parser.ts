/**
 * @module The treemap parser: Mermaid's Langium treemap grammar over the shared tokenizer. Port of
 * Pele's `src/diagrams/treemap/parser.ts`.
 */
import {
  ACC_DESCR,
  ACC_TITLE,
  EOF,
  NEWLINE,
  TITLE,
  type TokenType,
  WHITESPACE,
  accDescrValue,
  accTitleValue,
  literal,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerTake,
  titleValue,
  tokenize,
  type Reader,
} from '../common/tokens.ts'
import { isSpace } from '../../util/chars.ts'
import { parse as floatParse } from '../../util/float.ts'
import { charAt } from '../../util/rust.ts'

/** Token kinds, as indices into {@link TREEMAP_TOKENS}. */
const t = {
  ACC_DESCR: 0,
  ACC_TITLE: 1,
  TITLE: 2,
  KEYWORD: 3,
  CLASS_DEF: 4,
  STYLE_SEPARATOR: 5,
  SEPARATOR: 6,
  COMMA: 7,
  INDENTATION: 8,
  ID: 12,
  NUMBER: 13,
  STRING: 14,
} as const

/** `treemap-beta|treemap`. */
function keyword(src: string, p: number): number | undefined {
  if (p > src.length) return undefined
  for (const word of ['treemap-beta', 'treemap']) {
    if (src.startsWith(word, p)) return p + word.length
  }
  return undefined
}

/** Where a run of JavaScript `\s` from `p` ends. */
function skipSpace(src: string, p: number): number {
  let at = p
  for (;;) {
    const c = charAt(src, at)
    if (c === undefined || !isSpace(c.code)) break
    at += c.length
  }
  return at
}

/** Whether the ASCII letter or `_` is the unit `c`. */
function isLetterOrUnderscore(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f
}

/** Whether the ASCII letter, digit or `_` is the unit `c`. */
function isWordUnit(c: number): boolean {
  return isLetterOrUnderscore(c) || (c >= 0x30 && c <= 0x39)
}

/** A `classDef` statement's parts: its end, its class name, and its style text. */
type ClassDef = {
  end: number
  name: [number, number]
  styles: [number, number] | undefined
}

/**
 * `classDef\s+([a-zA-Z_][a-zA-Z0-9_]+)(?:\s+([^;\r\n]*))?(?:;)?` from `p`. Its whitespace may
 * run across lines.
 */
function classDefAt(src: string, p: number): ClassDef | undefined {
  if (p > src.length || !src.startsWith('classDef', p)) return undefined
  const name = skipSpace(src, p + 8)
  if (name === p + 8 || !(name < src.length && isLetterOrUnderscore(src.charCodeAt(name)))) {
    return undefined
  }
  let end = name + 1
  while (end < src.length && isWordUnit(src.charCodeAt(end))) end += 1
  if (end === name + 1) return undefined

  const def: ClassDef = { end, name: [name, end], styles: undefined }
  const from = skipSpace(src, end)
  if (from > end) {
    let to = src.length
    for (let at = from; at < src.length; at++) {
      const c = src.charCodeAt(at)
      if (c === 0x3b || c === 0x0d || c === 0x0a) {
        to = at
        break
      }
    }
    def.styles = [from, to]
    def.end = to
  }
  if (src.charCodeAt(def.end) === 0x3b) def.end += 1
  return def
}

/** The end of a `classDef` statement at `p`. */
function classDef(src: string, p: number): number | undefined {
  return classDefAt(src, p)?.end
}

/** `%%[^\n]*`. */
function comment(src: string, p: number): number | undefined {
  if (p > src.length || !src.startsWith('%%', p)) return undefined
  const at = src.indexOf('\n', p)
  return at < 0 ? src.length : at
}

/** `[a-zA-Z_][a-zA-Z0-9_]*`. */
function id(src: string, p: number): number | undefined {
  if (!(p < src.length && isLetterOrUnderscore(src.charCodeAt(p)))) return undefined
  let end = p + 1
  while (end < src.length && isWordUnit(src.charCodeAt(end))) end += 1
  return end
}

/** `[0-9_\.\,]+`. */
function number(src: string, p: number): number | undefined {
  let end = p
  while (end < src.length) {
    const c = src.charCodeAt(end)
    if (!((c >= 0x30 && c <= 0x39) || c === 0x5f || c === 0x2e || c === 0x2c)) break
    end += 1
  }
  return end > p ? end : undefined
}

/** `"[^"]*"|'[^']*'`, across lines. */
function string(src: string, p: number): number | undefined {
  if (p >= src.length) return undefined
  const quote = src.charCodeAt(p)
  if (quote !== 0x22 && quote !== 0x27) return undefined
  const at = src.indexOf(String.fromCharCode(quote), p + 1)
  return at < 0 ? undefined : at + 1
}

/** A token type named `name` that `f` matches, starting with a character of `first`. */
function matcher(name: string, first: string, f: (src: string, at: number) => number | undefined): TokenType {
  return {
    ...literal(''),
    first,
    name,
    pattern: { kind: 'Match', _0: f },
  }
}

/**
 * Pele's `TREEMAP_TOKENS`, in matching order. Mermaid's treemap grammar has its own terminals.
 * Every run of spaces or tabs is an `INDENTATION` token, since that comes before `WS`, and line
 * breaks are hidden, so rows are told apart by their tokens alone and the indentation of a row
 * is whatever whitespace precedes it.
 */
export const TREEMAP_TOKENS: TokenType[] = [
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  matcher('TREEMAP_KEYWORD', 't', keyword),
  matcher('CLASS_DEF', 'c', classDef),
  { ...literal(':::'), name: 'STYLE_SEPARATOR' },
  { ...literal(':'), name: 'SEPARATOR' },
  { ...literal(','), name: 'COMMA' },
  { ...WHITESPACE, hidden: false, name: 'INDENTATION' },
  { ...WHITESPACE, name: 'WS' },
  { ...matcher('ML_COMMENT', '%', comment), hidden: true },
  { ...NEWLINE, hidden: true, name: 'NL' },
  matcher('ID2', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz', id),
  matcher('NUMBER2', '0123456789_.,', number),
  matcher('STRING2', '"\'', string),
]

/** A section or a leaf as written: Pele's `SectionAst` or `LeafAst`. */
export type ItemAst = {
  /** The class after `:::`. */
  classSelector: string | undefined
  /** The name, without its quotes. */
  name: string
  /** The value, for a leaf. */
  value: number | undefined
}

/** A row: Pele's `TreemapRowAst` or `ClassDefAst`. */
export type RowAst =
  /** A `classDef` statement. */
  | {
      kind: 'ClassDef'
      /** The class name. */
      className: string
      /** The whitespace before the row. */
      indent: number | undefined
      /** The declarations, when any are given. */
      styleText: string | undefined
    }
  /** A section or a leaf. */
  | {
      kind: 'Item'
      /** The whitespace before the row. */
      indent: number | undefined
      /** The node. */
      item: ItemAst
    }

/** The parsed treemap: Pele's `TreemapAst`. */
export type TreemapAst = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** Rows in authored order. */
  rows: RowAst[]
  /** The `title` value. */
  title: string | undefined
}

/**
 * JavaScript's `parseFloat` of `[0-9_.]` text: digits with an optional fraction, read up to the
 * first character that cannot continue them, or `NaN` when no digit leads.
 */
function parseFloat(text: string): number {
  const isDigit = (at: number): boolean => {
    const c = text.charCodeAt(at)
    return c >= 0x30 && c <= 0x39
  }
  let end = 0
  while (end < text.length && isDigit(end)) end += 1
  const int = end
  if (text.charCodeAt(end) === 0x2e) {
    let fraction = end + 1
    while (fraction < text.length && isDigit(fraction)) fraction += 1
    if (int > 0 || fraction > end + 1) end = fraction
  }
  if (end === 0) return Number.NaN
  let num = text.slice(0, end)
  if (num.endsWith('.')) num = num.slice(0, -1)
  if (num.startsWith('.')) return floatParse(`0${num}`) ?? Number.NaN
  return floatParse(num) ?? Number.NaN
}

/**
 * Parses treemap `src` as Pele's `parseTreemap` does.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function parseTreemap(src: string): TreemapAst {
  const r: Reader = readerNew(tokenize(src, TREEMAP_TOKENS, 'treemap'), TREEMAP_TOKENS, 'treemap')
  const ast: TreemapAst = { accDescr: undefined, accTitle: undefined, rows: [], title: undefined }
  const kindAt = (i: number): number => r.tokens.tokens[i]?.kind ?? EOF

  readerExpect(r, t.KEYWORD)
  while (readerKind(r) !== EOF) {
    const kind = readerKind(r)
    switch (kind) {
      case t.ACC_DESCR:
        ast.accDescr = accDescrValue(readerTake(r))
        continue
      case t.ACC_TITLE:
        ast.accTitle = accTitleValue(readerTake(r))
        continue
      case t.TITLE:
        ast.title = titleValue(readerTake(r))
        continue
      case t.INDENTATION:
      case t.STRING:
      case t.CLASS_DEF:
        break
      default:
        throw readerFail(r, 'a node, a class definition, or a title')
    }

    const indent = kind === t.INDENTATION ? readerTake(r).length : undefined
    if (readerKind(r) === t.CLASS_DEF) {
      const text = readerTake(r)
      const def = classDefAt(text, 0)
      if (def === undefined) continue
      const styles = def.styles === undefined ? undefined : text.slice(def.styles[0], def.styles[1])
      ast.rows.push({
        kind: 'ClassDef',
        className: text.slice(def.name[0], def.name[1]),
        indent,
        styleText: styles !== undefined && styles !== '' ? styles : undefined,
      })
      continue
    }

    const quoted = readerExpect(r, t.STRING)
    const name = quoted.slice(1, quoted.length - 1)
    // A leaf is a name followed by a colon or comma, with or without whitespace before it.
    const after = kindAt(r.i) === t.INDENTATION ? r.i + 1 : r.i
    const item: ItemAst = { classSelector: undefined, name, value: undefined }
    const next = kindAt(after)
    if (next === t.SEPARATOR || next === t.COMMA) {
      r.i = after + 1
      readerAccept(r, t.INDENTATION)
      const text = readerExpect(r, t.NUMBER)
      const digits = text.indexOf(',') < 0 ? text : text.replaceAll(',', '')
      item.value = parseFloat(digits)
    }
    if (readerAccept(r, t.STYLE_SEPARATOR)) {
      item.classSelector = readerExpect(r, t.ID)
    }
    ast.rows.push({ kind: 'Item', indent, item })
  }
  return ast
}
