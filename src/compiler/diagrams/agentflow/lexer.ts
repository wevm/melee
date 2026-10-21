/**
 * @module The agentflow lexer: a state machine equivalent to Mermaid's Jison lexer, which also records
 * each token's span the way Jison counts it. Port of Pele's `src/diagrams/agentflow/lexer.ts`.
 *
 * Offsets are UTF-16 indexes. Every delimiter is ASCII, and non-ASCII characters are decoded whole
 * (a surrogate pair as one code point) wherever a test (`\s`, `\p{L}`) looks at them, so token
 * boundaries match. Columns are counted in UTF-16 units. Each regular expression in Pele is a
 * hand-written matcher below.
 */
import { T } from './tokens.ts'
import type { Loc } from './types.ts'
import { isSpace, isWord } from '../../util/chars.ts'
import { isUnicodeLetter } from '../../util/unicode.ts'

/**
 * A token: its kind, its start as a UTF-16 offset, its text, and its span. The span's fields are
 * the token's own, so a token is the {@link Loc} of where it starts and ends, as Jison counts
 * lines and columns.
 */
export type Token = Loc & {
  /** The token kind. */
  kind: T
  /** The UTF-16 offset of the token in the source. */
  start: number
  /** The matched text. Shape data strings hold a rewritten copy. */
  text: string
}

/** Lexer start conditions, as in Mermaid's grammar. */
const S = {
  AccDescr: 0,
  AccDescrMultiline: 1,
  AccTitle: 2,
  CallbackArgs: 3,
  CallbackName: 4,
  Click: 5,
  Dir: 6,
  EdgeText: 7,
  EllipseText: 8,
  Initial: 9,
  MdString: 10,
  ShapeData: 11,
  ShapeDataStr: 12,
  String: 13,
  Text: 14,
  TrapText: 15,
} as const

type S = (typeof S)[keyof typeof S]

/**
 * The code past the end of the source or inside a surrogate pair, which no test matches. Pele's
 * `charCodeAt` returns `NaN` there. It is above every code point, and small enough for V8 to keep
 * as a small integer, so that functions returning it or a code stay on integers.
 */
const NONE = 0x3fffffff

/** Characters of a node string, as Pele's `NODE_CHAR` table marks them. */
const NODE_CHAR: readonly boolean[] = (() => {
  const table: boolean[] = new Array<boolean>(128).fill(false)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!"#$%&\'*+.`?\\_/'
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = true
  return table
})()

/** The link targets, in the order they are tried. */
const LINK_TARGETS: readonly string[] = ['_self', '_blank', '_parent', '_top']

/** Lexer state. Pele keeps these as closure variables of `tokenize`. */
type Lexer = {
  atNext: number | undefined
  blankFrom: number
  blankTo: number
  col: number
  dirFailed: number
  dirNext: number | undefined
  firstGraph: boolean
  line: number
  lineEnd: number | undefined
  noArrow: number | undefined
  noLink: number | undefined
  p: number
  runAt: number | undefined
  runEnd: number
  src: string
  stack: S[]
  state: S
  tokens: Token[]
  wsFrom: number
  wsTo: number
}

/**
 * Splits `src` into tokens. The list ends with an `End` token, or with an `Error` token where
 * no rule matches.
 */
export function tokenize(src: string): Token[] {
  const at = src.indexOf('@')
  const dir = src.indexOf('direction')
  const lexer: Lexer = {
    atNext: at < 0 ? undefined : at,
    blankFrom: -1,
    blankTo: -1,
    col: 0,
    dirFailed: 0,
    dirNext: dir < 0 ? undefined : dir,
    firstGraph: true,
    line: 1,
    lineEnd: undefined,
    noArrow: undefined,
    noLink: undefined,
    p: 0,
    runAt: undefined,
    runEnd: 0,
    src,
    stack: [],
    state: S.Initial,
    tokens: [],
    wsFrom: -1,
    wsTo: -1,
  }
  lexerRun(lexer)
  return lexer.tokens
}

/** The UTF-16 unit at `i`, or {@link NONE}. */
function lexerByte(lx: Lexer, i: number): number {
  return i < lx.src.length ? lx.src.charCodeAt(i) : NONE
}

/** The character at `i` when `i` starts one, or {@link NONE}. */
function lexerCode(lx: Lexer, i: number): number {
  const src = lx.src
  if (i >= src.length) return NONE
  const c = src.charCodeAt(i)
  if (c < 0x80) return c
  // The second half of a surrogate pair does not start a character.
  if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
    const before = src.charCodeAt(i - 1)
    if (before >= 0xd800 && before <= 0xdbff) return NONE
  }
  return src.codePointAt(i) as number
}

/** The offset after the character at `i`. */
function lexerNext(lx: Lexer, i: number): number {
  if (i >= lx.src.length) return i + 1
  const c = lx.src.codePointAt(i) as number
  return i + (c > 0xffff ? 2 : 1)
}

/** The end of a run of `\s` starting at `i`. */
function lexerSkipSpace(lx: Lexer, i: number): number {
  const src = lx.src
  for (;;) {
    const c = i < src.length ? src.charCodeAt(i) : NONE
    if (c < 0x80) {
      if (!(c === 32 || (c >= 9 && c <= 13))) return i
      i += 1
    } else {
      if (!isSpace(lexerCode(lx, i))) return i
      i = lexerNext(lx, i)
    }
  }
}

/** The first offset of `needle` at or after `from`. */
function lexerFind(lx: Lexer, needle: string, from: number): number | undefined {
  if (from > lx.src.length) return undefined
  const at = lx.src.indexOf(needle, from)
  return at < 0 ? undefined : at
}

/** The first offset of the ASCII `needle` at or after `from`, or the end of the source. */
function lexerFindByte(lx: Lexer, needle: string, from: number): number {
  if (from > lx.src.length) return lx.src.length
  const at = lx.src.indexOf(needle, from)
  return at < 0 ? lx.src.length : at
}

function lexerStartsWith(lx: Lexer, word: string, at: number): boolean {
  return at <= lx.src.length && lx.src.startsWith(word, at)
}

/** The length of `lexerSlice(lx, from, to)`. */
function spanLength(lx: Lexer, from: number, to: number): number {
  return from > to || to > lx.src.length ? 0 : to - from
}

function lexerSlice(lx: Lexer, from: number, to: number): string {
  if (from > to || to > lx.src.length) return ''
  return lx.src.slice(from, to)
}

/**
 * Moves over one match. Jison counts `\r\n`, `\r`, and `\n` as one line break each, and
 * after a break its column stops at the first U+2028 or U+2029.
 */
function lexerAdvance(lx: Lexer, e: number): void {
  const src = lx.src
  let brk: number | undefined
  let k = lx.p
  while (k < e) {
    const b = k < src.length ? src.charCodeAt(k) : NONE
    if (b === 10) {
      lx.line += 1
      brk = k
    } else if (b === 13) {
      if (k + 1 < e && src.charCodeAt(k + 1) === 10) k += 1
      lx.line += 1
      brk = k
    }
    k += 1
  }

  if (brk === undefined) {
    lx.col += spanLength(lx, lx.p, e)
  } else {
    // The column after the break: the length of the rest, up to its first U+2028 or U+2029.
    const from = brk + 1
    let stop = spanLength(lx, from, e)
    for (let i = 0; i < stop; i++) {
      const c = src.charCodeAt(from + i)
      if (c === 0x2028 || c === 0x2029) {
        stop = i
        break
      }
    }
    lx.col = stop
  }
  lx.p = e
}

/** Adds a token that started on `line` at `column` and ends where the lexer is. */
function lexerToken(lx: Lexer, kind: T, start: number, text: string, line: number, column: number): void {
  const tokens = lx.tokens
  tokens[tokens.length] = {
    firstColumn: column,
    firstLine: line,
    kind,
    lastColumn: lx.col,
    lastLine: lx.line,
    start,
    text,
  }
}

/** Emits the text up to `e`, which may hold line breaks. */
function lexerEmit(lx: Lexer, kind: T, e: number): void {
  const start = lx.p
  const line = lx.line
  const column = lx.col
  lexerAdvance(lx, e)
  lexerToken(lx, kind, start, lexerSlice(lx, start, e), line, column)
}

/** Emits a token that cannot hold a line break. */
function lexerEmitFlat(lx: Lexer, kind: T, e: number): void {
  const start = lx.p
  const column = lx.col
  lx.col += spanLength(lx, start, e)
  lx.p = e
  lexerToken(lx, kind, start, lexerSlice(lx, start, e), lx.line, column)
}

/**
 * Emits a run that Jison matches one character at a time, where `\r\n` counts as two line
 * breaks.
 */
function lexerEmitChars(lx: Lexer, kind: T, e: number): void {
  const start = lx.p
  const line = lx.line
  const column = lx.col
  const text = lexerSlice(lx, start, e)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10 || c === 13) {
      lx.line += 1
      lx.col = 0
    } else {
      lx.col += 1
    }
  }
  lx.p = e
  lexerToken(lx, kind, start, text, line, column)
}

/** Emits a token with rewritten `text`, spanning up to `e`. */
function lexerEmitText(lx: Lexer, kind: T, text: string, e: number): void {
  const start = lx.p
  const line = lx.line
  const column = lx.col
  lexerAdvance(lx, e)
  lexerToken(lx, kind, start, text, line, column)
}

function lexerPush(lx: Lexer, state: S): void {
  lx.stack.push(lx.state)
  lx.state = state
}

function lexerPop(lx: Lexer): void {
  const state = lx.stack.pop()
  if (state !== undefined) lx.state = state
}

/** A keyword at the cursor that no word character follows. */
function lexerKw(lx: Lexer, word: string): boolean {
  return lexerStartsWith(lx, word, lx.p) && !isWord(lexerByte(lx, lx.p + word.length))
}

/**
 * The end of the run of whitespace starting at `q`. The last run is kept, so asking again
 * from inside it costs nothing.
 */
function lexerWsEnd(lx: Lexer, q: number): number {
  if (q >= lx.wsFrom && q <= lx.wsTo) return lx.wsTo
  const end = lexerSkipSpace(lx, q)
  lx.wsFrom = q
  lx.wsTo = end
  return end
}

/** The end of the run of spaces and tabs starting at `q`, kept like {@link lexerWsEnd}. */
function lexerBlankEnd(lx: Lexer, q: number): number {
  if (q >= lx.blankFrom && q <= lx.blankTo) return lx.blankTo
  const end = lexerBlanks(lx, q)
  lx.blankFrom = q
  lx.blankTo = end
  return end
}

/** The end of `\s*--+[x>]\s*` starting at `q`. */
function lexerArrowEnd(lx: Lexer, q: number): number | undefined {
  // Only equality tests read characters, and past the end `charCodeAt` gives `NaN`, which
  // equals none, as `NONE` does.
  const src = lx.src
  const j = lexerWsEnd(lx, q)
  if (j === lx.noArrow || src.charCodeAt(j) !== 0x2d || src.charCodeAt(j + 1) !== 0x2d) return undefined
  let k = j + 2
  while (src.charCodeAt(k) === 0x2d) k += 1
  const b = src.charCodeAt(k)
  if (b === 0x78 || b === 0x3e) return lexerWsEnd(lx, k + 1)
  lx.noArrow = j
  return undefined
}

function lexerLink(lx: Lexer): boolean {
  // Equality tests only, as in `lexerArrowEnd`.
  const src = lx.src
  const j = lexerWsEnd(lx, lx.p)
  if (j === lx.noLink || src.charCodeAt(j) !== 0x2d) return false
  const d = src.charCodeAt(j + 1)
  let k = j + 2
  if (d === 0x2d) {
    while (src.charCodeAt(k) === 0x2d) k += 1
    const b = src.charCodeAt(k)
    if (b === 0x78 || b === 0x3e) {
      const e = lexerWsEnd(lx, k + 1)
      lexerEmit(lx, T.Link, e)
    } else {
      lexerPush(lx, S.EdgeText)
      const e = lexerWsEnd(lx, j + 2)
      lexerEmit(lx, T.StartLink, e)
    }
    return true
  }
  if (d === 0x2e) {
    while (src.charCodeAt(k) === 0x2e) k += 1
    if (src.charCodeAt(k) === 0x2d) {
      const e = lexerWsEnd(lx, k + 1)
      lexerEmit(lx, T.Link, e)
      return true
    }
  }
  lx.noLink = j
  return false
}

/** The end of a `%%` comment not followed by `{`, through the end of its line. */
function lexerCommentEnd(lx: Lexer, q: number): number | undefined {
  const src = lx.src
  // Past the end, `charCodeAt` gives `NaN`, which equals no character, as `NONE` does.
  if (src.charCodeAt(q) !== 0x25 || src.charCodeAt(q + 1) !== 0x25 || src.charCodeAt(q + 2) === 0x7b) {
    return undefined
  }
  return lexerFindByte(lx, '\n', q + 2)
}

function lexerQuote(lx: Lexer): void {
  if (lexerByte(lx, lx.p + 1) === 0x60) {
    lexerPush(lx, S.MdString)
    lexerAdvance(lx, lx.p + 2)
  } else {
    lexerPush(lx, S.String)
    lexerAdvance(lx, lx.p + 1)
  }
}

/** `/NAME\s*C\s*\/y` (`RE_ACC_TITLE`, `RE_ACC_DESCR`, `RE_ACC_DESCR_ML`). */
function lexerReAcc(lx: Lexer, name: string, punct: number): number | undefined {
  if (!lexerStartsWith(lx, name, lx.p)) return undefined
  const i = lexerSkipSpace(lx, lx.p + name.length)
  if (lexerByte(lx, i) !== punct) return undefined
  return lexerSkipSpace(lx, i + 1)
}

/** `/WORD\s+/y` (`RE_CALL`, `RE_CLICK`). */
function lexerReWordSpace(lx: Lexer, word: string): number | undefined {
  if (!lexerStartsWith(lx, word, lx.p)) return undefined
  const start = lx.p + word.length
  const end = lexerSkipSpace(lx, start)
  return end > start ? end : undefined
}

/** `/(?:\r?\n)*\s*\n/y` (`RE_NODIR`): the whitespace run at `q`, up to its last newline. */
function lexerReNodir(lx: Lexer, q: number): number | undefined {
  const end = lexerSkipSpace(lx, q)
  if (end <= q) return undefined
  const at = lx.src.lastIndexOf('\n', end - 1)
  return at >= q ? at + 1 : undefined
}

/** `/\s*(?:LR|RL|TB|BT|TD|BR)\b/y` (`RE_DIR`). */
function lexerReDir(lx: Lexer, q: number): number | undefined {
  const i = lexerSkipSpace(lx, q)
  if (i + 2 > lx.src.length) return undefined
  const pair = lx.src.slice(i, i + 2)
  const known = pair === 'LR' || pair === 'RL' || pair === 'TB' || pair === 'BT' || pair === 'TD' || pair === 'BR'
  return known && !isWord(lexerByte(lx, i + 2)) ? i + 2 : undefined
}

/** `/\s*[<>^]/y` (`RE_DIR_SYM`). */
function lexerReDirSym(lx: Lexer, q: number): number | undefined {
  const i = lexerSkipSpace(lx, q)
  const b = lexerByte(lx, i)
  return b === 0x3c || b === 0x3e || b === 0x5e ? i + 1 : undefined
}

/** `/\s*v\b/y` (`RE_DIR_V`). */
function lexerReDirV(lx: Lexer, q: number): number | undefined {
  const i = lexerSkipSpace(lx, q)
  return lexerByte(lx, i) === 0x76 && !isWord(lexerByte(lx, i + 1)) ? i + 1 : undefined
}

/** The first line terminator (`/[\n\r  ]/g`) at or after `from`, or the end. */
function lexerLineEndFrom(lx: Lexer, from: number): number {
  const src = lx.src
  for (let i = from; i < src.length; i++) {
    const b = src.charCodeAt(i)
    if (b === 10 || b === 13 || b === 0x2028 || b === 0x2029) return i
  }
  return src.length
}

/**
 * `/.*direction\s+XX[^\n]*\/y` (`RE_DIRECTION`). The greedy `.*` picks the last
 * `direction` before the first line terminator, and the match runs to the next `\n`.
 */
function lexerReDirection(lx: Lexer, q: number, dir: string): number | undefined {
  const limit = lexerLineEndFrom(lx, q)
  if (q > limit) return undefined
  const line = lx.src.slice(q, limit)
  let found: number | undefined
  for (let at = line.indexOf('direction'); at >= 0; at = line.indexOf('direction', at + 9)) {
    const start = q + at + 9
    const i = lexerSkipSpace(lx, start)
    if (i > start && lx.src.startsWith(dir, i)) found = i + 2
  }
  return found === undefined ? undefined : lexerFindByte(lx, '\n', found)
}

/** `/\(\s*\)/y` (`RE_EMPTY_CALL`). */
function lexerReEmptyCall(lx: Lexer, q: number): number | undefined {
  if (lexerByte(lx, q) !== 0x28) return undefined
  const i = lexerSkipSpace(lx, q + 1)
  return lexerByte(lx, i) === 0x29 ? i + 1 : undefined
}

function lexerOpener(lx: Lexer, c: number): boolean {
  const p = lx.p
  const d = lexerByte(lx, p + 1)
  switch (c) {
    case 0x28: // (
      if (d === 0x2d) {
        lexerPush(lx, S.EllipseText)
        lexerEmitFlat(lx, T.EllipseStart, p + 2)
      } else if (d === 0x5b) {
        lexerPush(lx, S.Text)
        lexerEmitFlat(lx, T.StadiumStart, p + 2)
      } else if (d === 0x28 && lexerByte(lx, p + 2) === 0x28) {
        lexerPush(lx, S.Text)
        lexerEmitFlat(lx, T.DoubleCircleStart, p + 3)
      } else {
        lexerPush(lx, S.Text)
        lexerEmitFlat(lx, T.Ps, p + 1)
      }
      return true
    case 0x5b: // [
      if (d === 0x5b) {
        lexerPush(lx, S.Text)
        lexerEmitFlat(lx, T.SubroutineStart, p + 2)
      } else if (d === 0x28) {
        lexerPush(lx, S.Text)
        lexerEmitFlat(lx, T.CylinderStart, p + 2)
      } else if (d === 0x2f) {
        lexerPush(lx, S.TrapText)
        lexerEmitFlat(lx, T.TrapStart, p + 2)
      } else if (d === 0x5c) {
        lexerPush(lx, S.TrapText)
        lexerEmitFlat(lx, T.InvTrapStart, p + 2)
      } else {
        lexerPush(lx, S.Text)
        lexerEmitFlat(lx, T.Sqs, p + 1)
      }
      return true
    case 0x7c: // |
      lexerPush(lx, S.Text)
      lexerEmitFlat(lx, T.Pipe, p + 1)
      return true
    case 0x7b: // {
      lexerPush(lx, S.Text)
      lexerEmitFlat(lx, T.DiamondStart, p + 1)
      return true
    default:
      return false
  }
}

function lexerNodeString(lx: Lexer): boolean {
  const src = lx.src
  const n = src.length
  let q = lx.p
  while (q < n) {
    const ch = src.charCodeAt(q)
    if (ch < 128 && NODE_CHAR[ch]) {
      q += 1
    } else if (ch === 0x2d && q + 1 < n) {
      const after = src.charCodeAt(q + 1)
      if (after === 0x3e || after === 0x2d || after === 0x2e) break
      q += 1
    } else {
      break
    }
  }

  if (q === lx.p) return false
  lexerEmitFlat(lx, T.NodeString, q)
  return true
}

/** The end of the run of spaces and tabs starting at `from`. */
function lexerBlanks(lx: Lexer, from: number): number {
  const src = lx.src
  let e = from
  while (e < src.length) {
    const b = src.charCodeAt(e)
    if (b !== 0x20 && b !== 0x09) return e
    e += 1
  }
  return e
}

function lexerKeyword(lx: Lexer, kind: T, len: number): boolean {
  lexerEmitFlat(lx, kind, lx.p + len)
  return true
}

function lexerInitial(lx: Lexer, c: number): boolean {
  const p = lx.p
  switch (c) {
    case 0x61: {
      // a
      if (lexerStartsWith(lx, 'acc', p)) {
        let e = lexerReAcc(lx, 'accTitle', 0x3a)
        if (e !== undefined) {
          lexerPush(lx, S.AccTitle)
          lexerEmit(lx, T.AccTitle, e)
          return true
        }
        e = lexerReAcc(lx, 'accDescr', 0x3a)
        if (e !== undefined) {
          lexerPush(lx, S.AccDescr)
          lexerEmit(lx, T.AccDescr, e)
          return true
        }
        e = lexerReAcc(lx, 'accDescr', 0x7b)
        if (e !== undefined) {
          lexerPush(lx, S.AccDescrMultiline)
          lexerAdvance(lx, e)
          return true
        }
      }
      if (lexerKw(lx, 'agentflow-beta')) {
        if (lx.firstGraph) {
          lx.firstGraph = false
          lexerPush(lx, S.Dir)
        }
        return lexerKeyword(lx, T.Graph, 14)
      }
      break
    }
    case 0x40: // @
      if (lexerByte(lx, p + 1) === 0x7b) {
        lexerPush(lx, S.ShapeData)
        lexerEmitText(lx, T.ShapeData, '', p + 2)
        return true
      }
      break
    case 0x63: {
      // c
      let e = lexerReWordSpace(lx, 'call')
      if (e !== undefined) {
        lexerPush(lx, S.CallbackName)
        lexerAdvance(lx, e)
        return true
      }
      if (lexerKw(lx, 'classDef')) return lexerKeyword(lx, T.ClassDef, 8)
      if (lexerKw(lx, 'class')) return lexerKeyword(lx, T.Class, 5)
      e = lexerReWordSpace(lx, 'click')
      if (e !== undefined) {
        lexerPush(lx, S.Click)
        lexerAdvance(lx, e)
        return true
      }
      if (lexerKw(lx, 'connector')) return lexerKeyword(lx, T.Connector, 9)
      break
    }
    case 0x22: // "
      lexerQuote(lx)
      return true
    case 0x73: // s
      if (lexerKw(lx, 'style')) return lexerKeyword(lx, T.Style, 5)
      break
    case 0x64: // d
      if (lexerKw(lx, 'default')) return lexerKeyword(lx, T.Default, 7)
      break
    case 0x6c: // l
      if (lexerKw(lx, 'linkStyle')) return lexerKeyword(lx, T.LinkStyle, 9)
      break
    case 0x69: // i
      if (lexerKw(lx, 'interpolate')) return lexerKeyword(lx, T.Interpolate, 11)
      break
    case 0x68: // h
      // The token includes the whitespace character, which may be more than one unit.
      if (lexerStartsWith(lx, 'href', p) && isSpace(lexerCode(lx, p + 4))) {
        const end = lexerNext(lx, p + 4)
        lexerEmit(lx, T.Href, end)
        return true
      }
      break
    case 0x66: // f
      if (lexerKw(lx, 'flow')) return lexerKeyword(lx, T.Flow, 4)
      break
    case 0x67: // g
      if (lexerKw(lx, 'global')) {
        const e = lexerBlanks(lx, p + 6)
        lexerEmitFlat(lx, T.Global, e)
        return true
      }
      break
    case 0x65: // e
      if (lexerKw(lx, 'end')) {
        const e = lexerBlanks(lx, p + 3)
        lexerEmitFlat(lx, T.BlockEnd, e)
        return true
      }
      break
    case 0x5f: // _
      for (const target of LINK_TARGETS) {
        if (lexerKw(lx, target)) return lexerKeyword(lx, T.LinkTarget, target.length)
      }
      break
  }

  if (lexerDirection(lx)) return true

  if (lexerLinkId(lx, c)) return true

  if (c >= 48 && c <= 57) {
    let q = p + 1
    for (;;) {
      const b = lexerByte(lx, q)
      if (b < 48 || b > 57) break
      q += 1
    }
    lexerEmitFlat(lx, T.Num, q)
    return true
  }

  switch (c) {
    case 0x23: // #
      return lexerKeyword(lx, T.Brkt, 1)
    case 0x3a: // :
      if (lexerByte(lx, p + 1) === 0x3a && lexerByte(lx, p + 2) === 0x3a) {
        return lexerKeyword(lx, T.StyleSeparator, 3)
      }
      return lexerKeyword(lx, T.Colon, 1)
    case 0x26: // &
      return lexerKeyword(lx, T.Amp, 1)
    case 0x3b: // ;
      return lexerKeyword(lx, T.Semi, 1)
    case 0x2c: // ,
      return lexerKeyword(lx, T.Comma, 1)
    case 0x2a: // *
      return lexerKeyword(lx, T.Mult, 1)
    case 0x3c: // <
      return lexerKeyword(lx, T.TagStart, 1)
    case 0x2d: // -
      if (lexerLink(lx) || lexerNodeString(lx)) return true
      return lexerKeyword(lx, T.Minus, 1)
    case 0x28: // (
    case 0x7c: // |
    case 0x7b: // {
      return lexerOpener(lx, c)
    case 0x5b: // [
      if (lexerByte(lx, p + 1) === 0x7c) return lexerKeyword(lx, T.VertexWithPropsStart, 2)
      return lexerOpener(lx, c)
    case 0x3e: // >
      lexerPush(lx, S.Text)
      return lexerKeyword(lx, T.TagEnd, 1)
    case 0x5e: // ^
      return lexerKeyword(lx, T.Up, 1)
    case 0x5c: // \
      if (lexerByte(lx, p + 1) === 0x7c) return lexerKeyword(lx, T.Sep, 2)
      return lexerNodeString(lx)
    case 0x76: // v
      if (!isWord(lexerByte(lx, p + 1))) return lexerKeyword(lx, T.Down, 1)
      return lexerNodeString(lx)
    case 0x25: {
      // %
      const e = lexerCommentEnd(lx, p)
      if (e !== undefined) {
        lexerEmit(lx, T.Comment, e)
        return true
      }
      return lexerNodeString(lx)
    }
  }

  if (isSpace(c)) {
    if (lexerLink(lx)) return true
    if (c === 32 || c === 9) {
      const from = lexerBlankEnd(lx, p)
      const e = lexerCommentEnd(lx, from)
      if (e !== undefined) {
        lexerEmit(lx, T.Comment, e)
        return true
      }
    }
    let e = p
    for (;;) {
      const b = lexerByte(lx, e)
      if (b === 10) e += 1
      else if (b === 13 && lexerByte(lx, e + 1) === 10) e += 2
      else break
    }
    if (e > p) {
      lexerEmit(lx, T.Newline, e)
    } else {
      const end = lexerNext(lx, p)
      lexerEmit(lx, T.Space, end)
    }
    return true
  }

  if (c < 128) return lexerNodeString(lx)
  if (isUnicodeLetter(c)) {
    const end = lexerNext(lx, p)
    lexerEmitFlat(lx, T.UnicodeText, end)
    return true
  }
  return false
}

/** The direction statement tokens, in the order they are tried. */
const DIRECTION_KINDS: readonly T[] = [T.DirectionTb, T.DirectionBt, T.DirectionRl, T.DirectionLr, T.DirectionTd]

/** The direction each of {@link DIRECTION_KINDS} names. */
const DIRECTION_NAMES: readonly string[] = ['TB', 'BT', 'RL', 'LR', 'TD']

/** A `direction XX` statement anywhere on the current line. */
function lexerDirection(lx: Lexer): boolean {
  const p = lx.p
  let next = lx.dirNext
  if (next === undefined) return false
  if (p < lx.dirFailed) return false

  if (next < p) {
    lx.dirNext = lexerFind(lx, 'direction', p)
    if (lx.dirNext === undefined) return false
    next = lx.dirNext
  }

  let lineEnd: number
  if (lx.lineEnd !== undefined && lx.lineEnd >= p) {
    lineEnd = lx.lineEnd
  } else {
    lineEnd = lexerLineEndFrom(lx, p)
    lx.lineEnd = lineEnd
  }
  if (next >= lineEnd) return false

  for (let i = 0; i < DIRECTION_KINDS.length; i++) {
    const e = lexerReDirection(lx, p, DIRECTION_NAMES[i] as string)
    if (e !== undefined) {
      lexerEmit(lx, DIRECTION_KINDS[i] as T, e)
      return true
    }
  }

  // No direction statement starts anywhere in the rest of this line either.
  lx.dirFailed = lineEnd
  return false
}

/**
 * A link id is a run of non-space characters up to its last `@` that is not followed by
 * `{` or `"`.
 */
function lexerLinkId(lx: Lexer, c: number): boolean {
  if (lx.atNext === undefined || c === 0x22 || isSpace(c)) return false

  const p = lx.p
  const n = lx.src.length
  if (p >= lx.runEnd) {
    if (lx.atNext !== undefined && lx.atNext < p) lx.atNext = lexerFind(lx, '@', p)

    let q = p
    while (q < n) {
      const ch = lexerCode(lx, q)
      if (ch === 0x22 || isSpace(ch)) break
      q += 1
    }

    lx.runEnd = q
    lx.runAt = undefined
    const at = lx.atNext
    if (at !== undefined && at < q) {
      // Pele starts at `min(q, n - 1) - 1`, so a run that ends the source never
      // considers its last unit.
      const top = Math.min(q, n - 1)
      for (let k = top - 1; k >= at; k--) {
        if (lx.src.charCodeAt(k) !== 0x40) continue
        const after = lexerByte(lx, k + 1)
        if (after !== 0x7b && after !== 0x22) {
          lx.runAt = k
          break
        }
      }
    }
  }

  const at = lx.runAt
  if (at !== undefined && at > p) {
    lexerEmitFlat(lx, T.LinkId, at + 1)
    return true
  }
  return false
}

function lexerTextState(lx: Lexer, c: number): boolean {
  const p = lx.p
  const d = lexerByte(lx, p + 1)
  switch (c) {
    case 0x22: // "
      lexerQuote(lx)
      break
    case 0x28: // (
    case 0x5b: // [
    case 0x7b: // {
      lexerOpener(lx, c)
      break
    case 0x5d: // ]
      lexerPop(lx)
      if (d === 0x29) lexerEmitFlat(lx, T.StadiumEnd, p + 2)
      else if (d === 0x5d) lexerEmitFlat(lx, T.SubroutineEnd, p + 2)
      else lexerEmitFlat(lx, T.Sqe, p + 1)
      break
    case 0x29: // )
      lexerPop(lx)
      if (d === 0x5d) lexerEmitFlat(lx, T.CylinderEnd, p + 2)
      else if (d === 0x29 && lexerByte(lx, p + 2) === 0x29) lexerEmitFlat(lx, T.DoubleCircleEnd, p + 3)
      else lexerEmitFlat(lx, T.Pe, p + 1)
      break
    case 0x7c: // |
      lexerPop(lx)
      lexerEmitFlat(lx, T.Pipe, p + 1)
      break
    case 0x7d: // }
      lexerPop(lx)
      lexerEmitFlat(lx, T.DiamondStop, p + 1)
      break
    case 0x25: {
      // %
      // Jison drops the lone `%` from Mermaid's text pattern, so only a comment may
      // start with one.
      const e = lexerCommentEnd(lx, p)
      if (e === undefined) return false
      lexerAdvance(lx, e)
      break
    }
    default: {
      const src = lx.src
      let q = p + 1
      while (q < src.length) {
        const ch = src.charCodeAt(q)
        if (
          ch === 0x5b ||
          ch === 0x5d ||
          ch === 0x28 ||
          ch === 0x29 ||
          ch === 0x7b ||
          ch === 0x7d ||
          ch === 0x7c ||
          ch === 0x22 ||
          ch === 0x25
        ) {
          break
        }
        q += 1
      }
      lexerEmit(lx, T.Text, q)
    }
  }
  return true
}

function lexerEllipseText(lx: Lexer, c: number): boolean {
  const p = lx.p
  const d = lexerByte(lx, p + 1)
  const comment = c === 0x25 ? lexerCommentEnd(lx, p) : undefined
  if (c === 0x22) {
    lexerQuote(lx)
  } else if (comment !== undefined) {
    lexerAdvance(lx, comment)
  } else if ((c === 0x2d || c === 0x2f || c === 0x29) && d === 0x29) {
    lexerPop(lx)
    lexerEmitFlat(lx, T.EllipseEnd, p + 2)
  } else if (c === 0x28 || c === 0x5b || c === 0x7b) {
    lexerOpener(lx, c)
  } else if (c === 0x29 || c === 0x5d || c === 0x7d) {
    return false
  } else {
    const src = lx.src
    const n = src.length
    let q = p + 1
    while (q < n) {
      const ch = src.charCodeAt(q)
      if (ch === 0x22 || ch === 0x28 || ch === 0x29 || ch === 0x5b || ch === 0x5d || ch === 0x7b || ch === 0x7d) {
        break
      }
      if ((ch === 0x2d || ch === 0x2f) && lexerByte(lx, q + 1) === 0x29) break
      if (ch === 0x25 && lexerByte(lx, q + 1) === 0x25 && lexerByte(lx, q + 2) !== 0x7b) break
      q += 1
    }
    lexerEmitChars(lx, T.Text, q)
  }
  return true
}

function lexerTrapText(lx: Lexer, c: number): boolean {
  const p = lx.p
  const d = lexerByte(lx, p + 1)
  if (c === 0x22) {
    lexerQuote(lx)
    return true
  }

  const close = 0x5d
  switch (c) {
    case 0x28: // (
      if (d === 0x2d || d === 0x5b || (d === 0x28 && lexerByte(lx, p + 2) === 0x28)) {
        lexerOpener(lx, c)
      } else if (d === close) {
        lexerPop(lx)
        lexerEmitFlat(lx, T.TrapEnd, p + 2)
      } else {
        lexerOpener(lx, c)
      }
      break
    case 0x5b: // [
    case 0x7b: // {
      lexerOpener(lx, c)
      break
    case 0x5c: // \
      if (d === close) {
        lexerPop(lx)
        lexerEmitFlat(lx, T.TrapEnd, p + 2)
      } else {
        lexerEmitFlat(lx, T.Text, p + 1)
      }
      break
    case 0x2f: // /
      if (d === close) {
        lexerPop(lx)
        lexerEmitFlat(lx, T.InvTrapEnd, p + 2)
      } else {
        lexerEmitFlat(lx, T.Text, p + 1)
      }
      break
    case 0x5d: // ]
    case 0x29: // )
      if (d !== close) return false
      lexerPop(lx)
      lexerEmitFlat(lx, T.TrapEnd, p + 2)
      break
    case 0x7d: // }
      return false
    case 0x25: {
      // %
      const e = lexerCommentEnd(lx, p)
      if (e === undefined) return false
      lexerAdvance(lx, e)
      break
    }
    default: {
      if ((c === 0x3f || c === 0x3d) && d === close) {
        lexerPop(lx)
        lexerEmitFlat(lx, T.TrapEnd, p + 2)
        return true
      }
      const src = lx.src
      let q = p + 1
      while (q < src.length) {
        const ch = src.charCodeAt(q)
        if (
          ch === 0x5c ||
          ch === 0x5b ||
          ch === 0x5d ||
          ch === 0x28 ||
          ch === 0x29 ||
          ch === 0x7b ||
          ch === 0x7d ||
          ch === 0x2f ||
          ch === 0x25
        ) {
          break
        }
        q += 1
      }
      lexerEmit(lx, T.Text, q)
    }
  }
  return true
}

function lexerEdgeText(lx: Lexer, c: number): boolean {
  if (c === 0x22) {
    lexerQuote(lx)
    return true
  }

  const p = lx.p
  const e = lexerArrowEnd(lx, p)
  if (e !== undefined) {
    lexerPop(lx)
    lexerEmit(lx, T.Link, e)
    return true
  }
  if (c === 0x2d && lexerByte(lx, p + 1) === 0x2d) return false

  const n = lx.src.length
  let q = lexerNext(lx, p)
  while (q < n) {
    const ch = lexerCode(lx, q)
    if (ch === 0x22) break
    if (ch === 0x2d) {
      if (lexerByte(lx, q + 1) === 0x2d) break
    } else if (isSpace(ch) && lexerArrowEnd(lx, q) !== undefined) {
      break
    }
    q = lexerNext(lx, q)
  }
  lexerEmitChars(lx, T.EdgeText, q)
  return true
}

function lexerRun(lx: Lexer): void {
  const n = lx.src.length
  for (;;) {
    if (lx.p >= n) {
      let kind: T | undefined
      switch (lx.state) {
        case S.Initial:
          kind = T.Eof
          break
        case S.AccTitle:
          kind = T.AccTitleValue
          break
        case S.AccDescr:
          kind = T.AccDescrValue
          break
        case S.AccDescrMultiline:
          kind = T.AccDescrMultilineValue
          break
        case S.Click:
          kind = T.Click
          break
        case S.CallbackName:
          kind = T.CallbackName
          break
        case S.CallbackArgs:
          kind = T.CallbackArgs
          break
      }
      if (kind !== undefined) lexerEmitFlat(lx, kind, n)
      break
    }

    const p = lx.p
    const c = lexerCode(lx, p)
    let ok: boolean
    switch (lx.state) {
      case S.Initial:
        ok = lexerInitial(lx, c)
        break
      case S.String:
        if (c === 0x22) {
          if (lexerByte(lx, p + 1) === 0x60) {
            lexerPush(lx, S.MdString)
            lexerAdvance(lx, p + 2)
          } else {
            lexerPop(lx)
            lexerAdvance(lx, p + 1)
          }
        } else {
          const e = lexerFindByte(lx, '"', p)
          lexerEmit(lx, T.Str, e)
        }
        ok = true
        break
      case S.MdString:
        if (c === 0x60) {
          if (lexerByte(lx, p + 1) === 0x22) {
            lexerPop(lx)
            lexerAdvance(lx, p + 2)
            ok = true
          } else {
            ok = false
          }
        } else if (c === 0x22) {
          lexerQuote(lx)
          ok = true
        } else {
          let q = p + 1
          for (;;) {
            const ch = lexerByte(lx, q)
            if (ch === NONE || ch === 0x60 || ch === 0x22) break
            q += 1
          }
          lexerEmit(lx, T.MdStr, q)
          ok = true
        }
        break
      case S.AccTitle:
      case S.AccDescr: {
        const e = lexerFindByte(lx, '\n', p)
        const kind = lx.state === S.AccTitle ? T.AccTitleValue : T.AccDescrValue
        lexerPop(lx)
        lexerEmit(lx, kind, e)
        ok = true
        break
      }
      case S.AccDescrMultiline:
        if (c === 0x7d) {
          lexerPop(lx)
          lexerAdvance(lx, p + 1)
        } else {
          const e = lexerFindByte(lx, '}', p)
          lexerEmit(lx, T.AccDescrMultilineValue, e)
        }
        ok = true
        break
      case S.Dir: {
        if (c === 0x22) {
          lexerQuote(lx)
          ok = true
          break
        }
        const nodir = lexerReNodir(lx, p)
        if (nodir !== undefined) {
          lexerPop(lx)
          lexerEmit(lx, T.NoDir, nodir)
          ok = true
          break
        }
        const e = lexerReDir(lx, p) ?? lexerReDirSym(lx, p) ?? lexerReDirV(lx, p)
        if (e !== undefined) {
          lexerPop(lx)
          lexerEmit(lx, T.Dir, e)
          ok = true
        } else {
          ok = lexerOpener(lx, c)
        }
        break
      }
      case S.Text:
        ok = lexerTextState(lx, c)
        break
      case S.EllipseText:
        ok = lexerEllipseText(lx, c)
        break
      case S.TrapText:
        ok = lexerTrapText(lx, c)
        break
      case S.EdgeText:
        ok = lexerEdgeText(lx, c)
        break
      case S.Click:
        if (c === 0x22) {
          lexerQuote(lx)
        } else if (isSpace(c)) {
          lexerPop(lx)
          const end = lexerNext(lx, p)
          lexerAdvance(lx, end)
        } else {
          let q = p + 1
          while (q < n && !isSpace(lexerCode(lx, q))) q += 1
          lexerEmitFlat(lx, T.Click, q)
        }
        ok = true
        break
      case S.CallbackName:
        if (c === 0x28) {
          const e = lexerReEmptyCall(lx, p)
          lexerPop(lx)
          if (e !== undefined) {
            lexerAdvance(lx, e)
          } else {
            lexerPush(lx, S.CallbackArgs)
            lexerAdvance(lx, p + 1)
          }
        } else {
          const e = lexerFindByte(lx, '(', p)
          lexerEmit(lx, T.CallbackName, e)
        }
        ok = true
        break
      case S.CallbackArgs:
        if (c === 0x29) {
          lexerPop(lx)
          lexerAdvance(lx, p + 1)
        } else {
          const e = lexerFindByte(lx, ')', p)
          lexerEmit(lx, T.CallbackArgs, e)
        }
        ok = true
        break
      case S.ShapeData:
        if (c === 0x22) {
          lexerPush(lx, S.ShapeDataStr)
          lexerEmitFlat(lx, T.ShapeData, p + 1)
          ok = true
        } else if (c === 0x7d) {
          lexerPop(lx)
          lexerAdvance(lx, p + 1)
          ok = true
        } else if (c === 0x5e) {
          ok = false
        } else {
          let q = p + 1
          for (;;) {
            const ch = lexerByte(lx, q)
            if (ch === NONE || ch === 0x7d || ch === 0x5e || ch === 0x22) break
            q += 1
          }
          lexerEmit(lx, T.ShapeData, q)
          ok = true
        }
        break
      case S.ShapeDataStr:
        if (c === 0x22) {
          lexerPop(lx)
          lexerEmitFlat(lx, T.ShapeData, p + 1)
        } else {
          const e = lexerFindByte(lx, '"', p)
          const text = breakLines(lexerSlice(lx, p, e))
          lexerEmitText(lx, T.ShapeData, text, e)
        }
        ok = true
        break
      default:
        ok = false
    }

    if (!ok) {
      lexerToken(lx, T.Error, lx.p, '', lx.line, lx.col)
      return
    }
  }

  lexerToken(lx, T.End, n, '', lx.line, lx.col)
}

/** `text.replace(/\n\s*\/g, '<br/>')`. */
function breakLines(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (c !== 10) {
      out += text[i]
      i += 1
      continue
    }
    out += '<br/>'
    i += 1
    for (;;) {
      if (i >= text.length) break
      const code = text.codePointAt(i) as number
      if (!isSpace(code)) break
      i += code > 0xffff ? 2 : 1
    }
  }
  return out
}
