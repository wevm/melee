/**
 * @module The radar parser: Mermaid's Langium radar grammar over the shared tokenizer. Port of
 * Pele's `src/diagrams/radar/parser.ts`.
 */
import { parse } from '../../util/float.ts'
import { accDescr } from '../common/acc_descr.ts'
import {
  ACC_TITLE,
  DIRECTIVE,
  EOF,
  type Memo,
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

/** Token kinds, as indices into {@link RADAR_TOKENS}. */
const t = {
  RADAR_COLON: 0,
  RADAR: 1,
  SHOW_LEGEND: 2,
  GRATICULE: 3,
  CURVE: 4,
  TICKS: 5,
  AXIS: 6,
  MAX: 7,
  MIN: 8,
  COLON: 9,
  COMMA: 10,
  OPEN: 11,
  CLOSE: 12,
  OPEN_BRACE: 13,
  CLOSE_BRACE: 14,
  GRATICULE_VALUE: 15,
  BOOLEAN: 16,
  ACC_DESCR: 17,
  ACC_TITLE: 18,
  TITLE: 19,
  NUMBER: 20,
  STRING: 21,
  ID: 22,
  NEWLINE: 23,
} as const

/** Whether the UTF-16 unit at `at` of `src` is an ASCII digit. */
function isDigitAt(src: string, at: number): boolean {
  const c = src.charCodeAt(at)
  return c >= 48 && c <= 57
}

/** Where a run of ASCII digits from `at` ends. */
function digits(src: string, at: number): number {
  let end = at
  while (isDigitAt(src, end)) end += 1
  return end
}

/**
 * The `NUMBER` pattern `(?:[0-9]+\.[0-9]+(?!\.))|(?:0|[1-9][0-9]*(?!\.))` without its
 * backtracking. As a regular expression it reads to the end of a run of digits from every
 * position in the run, which is quadratic for a long run of zeros, so `memo[0]` and `memo[1]`
 * keep the run's start and end.
 */
function number(src: string, at: number, memo: Memo): number | undefined {
  if (at < (memo[0] as number) || at >= (memo[1] as number)) {
    memo[0] = at
    memo[1] = digits(src, at)
  }
  const whole = memo[1] as number
  if (whole === at) return undefined

  const dot = src.charCodeAt(whole) === 0x2e
  if (dot) {
    const fraction = digits(src, whole + 1)
    const length = fraction - whole - 1
    if (length > 0 && src.charCodeAt(fraction) !== 0x2e) return fraction
    if (length > 1) return fraction - 1
  }
  if (src.charCodeAt(at) === 0x30) return at + 1
  if (!dot) return whole
  return whole - 1 > at ? whole - 1 : undefined
}

/** A character of JavaScript's `\w`. */
function isWord(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 0x5f
}

/** `[\w]([-\w]*\w)?`: a word that may hold dashes but does not end with one. */
function id(src: string, p: number): number | undefined {
  if (p >= src.length || !isWord(src.charCodeAt(p))) return undefined
  let end = p + 1
  let at = p + 1
  while (at < src.length) {
    const c = src.charCodeAt(at)
    if (!(isWord(c) || c === 0x2d)) break
    at += 1
    if (isWord(c)) end = at
  }
  return end
}

/** The first of `words` at `p`. */
function oneOf(src: string, p: number, words: string[]): number | undefined {
  if (p > src.length) return undefined
  const word = words.find((word) => src.startsWith(word, p))
  return word === undefined ? undefined : p + word.length
}

/** `circle|polygon`. */
function graticule(src: string, p: number): number | undefined {
  return oneOf(src, p, ['circle', 'polygon'])
}

/** `true|false`. */
function boolean(src: string, p: number): number | undefined {
  return oneOf(src, p, ['true', 'false'])
}

/** A word that gives way to a longer `ID`. */
function word(text: string): TokenType {
  return { ...literal(text), longer: [t.ID] }
}

/** Pele's `RADAR_TOKENS`, in matching order. */
export const RADAR_TOKENS: TokenType[] = [
  literal('radar-beta:'),
  { ...keyword('radar-beta'), longer: [t.ID] },
  word('showLegend'),
  word('graticule'),
  word('curve'),
  word('ticks'),
  word('axis'),
  word('max'),
  word('min'),
  literal(':'),
  literal(','),
  literal('['),
  literal(']'),
  literal('{'),
  literal('}'),
  {
    ...literal(''),
    first: 'cp',
    name: 'GRATICULE',
    pattern: { kind: 'Match', _0: graticule },
  },
  {
    ...literal(''),
    first: 'ft',
    name: 'BOOLEAN',
    pattern: { kind: 'Match', _0: boolean },
  },
  // In the other grammars an `accDescr {` that never closes ends the lexing. Here `accDescr` is
  // also a name and `{` a token, so each unclosed one would read to the end of the text again.
  accDescr('ACC_DESCR'),
  ACC_TITLE,
  TITLE,
  {
    ...literal(''),
    first: '0123456789',
    name: 'NUMBER',
    pattern: { kind: 'Scan', _0: number },
  },
  STRING,
  {
    ...literal(''),
    first: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz',
    name: 'ID',
    pattern: { kind: 'Match', _0: id },
  },
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
]

/** An axis as written: Pele's `AxisAst`. */
export type AxisAst = {
  /** The label, when one is given. */
  label: string | undefined
  /** The name. */
  name: string
}

/** A curve value as written: Pele's `EntryAst`. */
export type EntryAst = {
  /** The axis named before the value, in the detailed form. */
  axis: string | undefined
  /** The value. */
  value: number
}

/** A curve as written: Pele's `CurveAst`. */
export type CurveAst = {
  /** The values, never empty. */
  entries: EntryAst[]
  /** The label, when one is given. */
  label: string | undefined
  /** The name. */
  name: string
}

/** An option's value. */
export type OptionValue =
  /** `showLegend`'s value. */
  | { kind: 'Bool'; _0: boolean }
  /** `ticks`, `max`, or `min`'s value. */
  | { kind: 'Number'; _0: number }
  /** `graticule`'s value. */
  | { kind: 'Text'; _0: string }

/** An option as written: Pele's `OptionAst`. */
export type OptionAst = {
  /** `showLegend`, `ticks`, `max`, `min`, or `graticule`. */
  name: string
  /** The value. */
  value: OptionValue
}

/** The parsed radar chart: Pele's `RadarAst`. */
export type RadarAst = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** Axes in authored order. */
  axes: AxisAst[]
  /** Curves in authored order. */
  curves: CurveAst[]
  /** Options in authored order. */
  options: OptionAst[]
  /** The `title` value. */
  title: string | undefined
}

/** `RadarAst::default()`. */
export function radarAstDefault(): RadarAst {
  return {
    accDescr: undefined,
    accTitle: undefined,
    axes: [],
    curves: [],
    options: [],
    title: undefined,
  }
}

/** Skips line breaks. */
function newlines(r: Reader): void {
  while (readerAccept(r, t.NEWLINE)) {
    // Skip.
  }
}

/** Skips line breaks after a statement, which must end its line. */
function endOfLine(r: Reader): void {
  if (readerKind(r) === EOF) return
  if (readerKind(r) !== t.NEWLINE) throw readerFail(r, 'a line break or the end of input')
  newlines(r)
}

/** JavaScript's `Number` of a `NUMBER` token. */
function numberValue(text: string): number {
  return parse(text) ?? Number.NaN
}

/** `["label"]`, when the next token opens one. */
function label(r: Reader): string | undefined {
  if (!readerAccept(r, t.OPEN)) return undefined
  const text = stringValue(readerExpect(r, t.STRING))
  readerExpect(r, t.CLOSE)
  return text
}

/** A curve value, after its axis name in the detailed form. */
function entry(r: Reader, detailed: boolean): EntryAst {
  if (!detailed) {
    return { axis: undefined, value: numberValue(readerExpect(r, t.NUMBER)) }
  }
  const axis = readerExpect(r, t.ID)
  readerAccept(r, t.COLON)
  return { axis, value: numberValue(readerExpect(r, t.NUMBER)) }
}

/** A curve: its name, label, and braced values. */
function curve(r: Reader): CurveAst {
  const name = readerExpect(r, t.ID)
  const lbl = label(r)
  const node: CurveAst = { entries: [], label: lbl, name }
  readerExpect(r, t.OPEN_BRACE)
  newlines(r)
  if (readerKind(r) !== t.NUMBER && readerKind(r) !== t.ID) {
    throw readerFail(r, 'a number or an axis name')
  }
  const detailed = readerKind(r) === t.ID
  node.entries.push(entry(r, detailed))
  while (readerAccept(r, t.COMMA)) {
    newlines(r)
    node.entries.push(entry(r, detailed))
  }
  newlines(r)
  readerExpect(r, t.CLOSE_BRACE)
  return node
}

/** An axis: its name and label. */
function axis(r: Reader): AxisAst {
  const name = readerExpect(r, t.ID)
  return { label: label(r), name }
}

/** An option and its value. */
function option(r: Reader): OptionAst {
  const kind = readerKind(r)
  const name = readerTake(r)
  let value: OptionValue
  switch (kind) {
    case t.SHOW_LEGEND:
      value = { kind: 'Bool', _0: readerExpect(r, t.BOOLEAN) === 'true' }
      break
    case t.GRATICULE:
      value = { kind: 'Text', _0: readerExpect(r, t.GRATICULE_VALUE) }
      break
    default:
      value = { kind: 'Number', _0: numberValue(readerExpect(r, t.NUMBER)) }
  }
  return { name, value }
}

/** Whether the current token starts an option. */
function isOption(r: Reader): boolean {
  const kind = readerKind(r)
  return kind === t.SHOW_LEGEND || kind === t.TICKS || kind === t.MAX || kind === t.MIN || kind === t.GRATICULE
}

/**
 * Parses radar `src` as Pele's `parseRadar` does.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function parseRadar(src: string): RadarAst {
  const r = readerNew(tokenize(src, RADAR_TOKENS, 'radar'), RADAR_TOKENS, 'radar')
  const ast = radarAstDefault()

  newlines(r)
  if (!readerAccept(r, t.RADAR_COLON)) {
    readerExpect(r, t.RADAR)
    readerAccept(r, t.COLON)
  }
  newlines(r)
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
      case t.AXIS:
        r.i += 1
        ast.axes.push(axis(r))
        while (readerAccept(r, t.COMMA)) ast.axes.push(axis(r))
        break
      case t.CURVE:
        r.i += 1
        ast.curves.push(curve(r))
        while (readerAccept(r, t.COMMA)) ast.curves.push(curve(r))
        break
      default:
        if (!isOption(r)) {
          throw readerFail(r, 'an axis, a curve, an option, a title, or a line break')
        }
        ast.options.push(option(r))
        while (readerAccept(r, t.COMMA)) {
          if (!isOption(r)) throw readerFail(r, 'an option')
          ast.options.push(option(r))
        }
    }
  }
  return ast
}
