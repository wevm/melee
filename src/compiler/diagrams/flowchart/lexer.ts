/**
 * @module The flowchart lexer: a state machine equivalent to Mermaid's Jison lexer. Port of Pele's
 * `src/diagrams/flowchart/lexer.ts`.
 *
 * Offsets are UTF-16 indexes. Every delimiter is ASCII, and non-ASCII characters are decoded whole
 * (a surrogate pair as one code point) wherever a test (`\s`, `\p{L}`) looks at them, so token
 * boundaries match the Rust crate, which reads UTF-8 bytes. Each regular expression in Pele is a
 * hand-written matcher below.
 */
import { T } from './tokens.ts'
import { isSpace, isWord } from '../../util/chars.ts'
import { isUnicodeLetter } from '../../util/unicode.ts'

/** A token: its kind, its start as a UTF-16 offset, and its text. */
export type Token = {
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
  DottedEdgeText: 7,
  EdgeText: 8,
  EllipseText: 9,
  Initial: 10,
  MdString: 11,
  ShapeData: 12,
  ShapeDataStr: 13,
  String: 14,
  Text: 15,
  ThickEdgeText: 16,
  TrapText: 17,
} as const

type S = (typeof S)[keyof typeof S]

/**
 * The code past the end of the source or inside a surrogate pair, which no test matches. Pele's
 * `charCodeAt` returns `NaN` there.
 */
const NONE = 4294967295

/** The absent second link character of an edge text state. It never equals a real code. */
const NO_CHAR = 4294967295 - 1

/** Characters of a node string, as Pele's `NODE_CHAR` table marks them. */
const NODE_CHAR: readonly boolean[] = (() => {
  const table: boolean[] = new Array<boolean>(128).fill(false)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!"#$%&\'*+.`?\\_/'
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = true
  return table
})()

/** The arrow families an edge text state ends with. */
const Edge = { Dotted: 0, Normal: 1, Thick: 2 } as const

type Edge = (typeof Edge)[keyof typeof Edge]

/** The link targets, in the order they are tried. */
const LINK_TARGETS: readonly string[] = ['_self', '_blank', '_parent', '_top']

/** Lexer state. Pele keeps these as closure variables of `tokenize`. */
type Lexer = {
  atNext: number | undefined
  dirFailed: number
  dirNext: number | undefined
  firstGraph: boolean
  lineEnd: number | undefined
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
    dirFailed: 0,
    dirNext: dir < 0 ? undefined : dir,
    firstGraph: true,
    lineEnd: undefined,
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

function lexerEmit(lx: Lexer, kind: T, start: number, end: number): void {
  const tokens = lx.tokens
  tokens[tokens.length] = { kind, start, text: lx.src.slice(start, end) }
  lx.p = end
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

/** The end of the run of whitespace at `q`, memoized like Pele's `wsFrom` and `wsTo`. */
function lexerSpaceRun(lx: Lexer, q: number): number {
  if (q >= lx.wsFrom && q <= lx.wsTo) return lx.wsTo

  if (isSpace(lexerCode(lx, q))) {
    const end = lexerSkipSpace(lx, q)
    lx.wsFrom = q
    lx.wsTo = end
    return end
  }

  return q
}

/**
 * First character after any run of whitespace starting at `q`, skipping one optional x, o
 * or <.
 */
function lexerLinkChar(lx: Lexer, q: number): number {
  const j = lexerSpaceRun(lx, q)
  const d = lexerByte(lx, j)
  if (d === 0x78 || d === 0x6f || d === 0x3c) return lexerByte(lx, j + 1)
  return d
}

function lexerInvisAhead(lx: Lexer, q: number): boolean {
  const j = lexerSpaceRun(lx, q)
  return lexerByte(lx, j) === 0x7e
}

/** Skips an optional `[xo<]` at `i`. */
function lexerArrowTail(lx: Lexer, i: number): number {
  const b = lexerByte(lx, i)
  return b === 0x78 || b === 0x6f || b === 0x3c ? i + 1 : i
}

/** `/\s*[xo<]?CC+[Cxo>]\s*\/y` for line character `C` (`RE_LINK`, `RE_THICK_LINK`). */
function lexerReLineLink(lx: Lexer, q: number, line: number): number | undefined {
  const start = lexerArrowTail(lx, lexerSkipSpace(lx, q))
  let i = start
  while (lexerByte(lx, i) === line) i += 1

  const count = i - start
  const b = lexerByte(lx, i)
  if (count >= 2 && (b === 0x78 || b === 0x6f || b === 0x3e)) i += 1
  else if (count < 3) return undefined
  return lexerSkipSpace(lx, i)
}

/** `/\s*[xo<]?CC\s*\/y` for line character `C` (`RE_START_LINK`, `RE_THICK_START`). */
function lexerReLineStart(lx: Lexer, q: number, line: number): number | undefined {
  const i = lexerArrowTail(lx, lexerSkipSpace(lx, q))
  if (lexerByte(lx, i) === line && lexerByte(lx, i + 1) === line) return lexerSkipSpace(lx, i + 2)
  return undefined
}

/** `/\s*[xo<]?-?\.+-[xo>]?\s*\/y` (`RE_DOTTED_LINK`). */
function lexerReDottedLink(lx: Lexer, q: number): number | undefined {
  let i = lexerArrowTail(lx, lexerSkipSpace(lx, q))
  if (lexerByte(lx, i) === 0x2d) i += 1

  const dots = i
  while (lexerByte(lx, i) === 0x2e) i += 1
  if (i === dots || lexerByte(lx, i) !== 0x2d) return undefined

  i += 1
  const b = lexerByte(lx, i)
  if (b === 0x78 || b === 0x6f || b === 0x3e) i += 1
  return lexerSkipSpace(lx, i)
}

/** `/\s*[xo<]?-\.\s*\/y` (`RE_DOTTED_START`). */
function lexerReDottedStart(lx: Lexer, q: number): number | undefined {
  const i = lexerArrowTail(lx, lexerSkipSpace(lx, q))
  if (lexerByte(lx, i) === 0x2d && lexerByte(lx, i + 1) === 0x2e) return lexerSkipSpace(lx, i + 2)
  return undefined
}

/** `/\s*~~~+\s*\/y` (`RE_INVIS_LINK`). */
function lexerReInvisLink(lx: Lexer, q: number): number | undefined {
  const start = lexerSkipSpace(lx, q)
  let i = start
  while (lexerByte(lx, i) === 0x7e) i += 1
  if (i - start < 3) return undefined
  return lexerSkipSpace(lx, i)
}

/** The closing arrow matcher of an edge text state. */
function lexerReEdge(lx: Lexer, edge: Edge, q: number): number | undefined {
  switch (edge) {
    case Edge.Dotted:
      return lexerReDottedLink(lx, q)
    case Edge.Normal:
      return lexerReLineLink(lx, q, 0x2d)
    case Edge.Thick:
      return lexerReLineLink(lx, q, 0x3d)
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
  const known =
    pair === 'LR' || pair === 'RL' || pair === 'TB' || pair === 'BT' || pair === 'TD' || pair === 'BR'
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

/** The first line terminator (`/[\n\r  ]/g`) at or after `from`, or the end. */
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
  const line = lx.src.slice(q, limit)
  let found: number | undefined
  for (let at = line.indexOf('direction'); at >= 0; at = line.indexOf('direction', at + 9)) {
    const start = q + at + 9
    const i = lexerSkipSpace(lx, start)
    if (i > start && lx.src.startsWith(dir, i)) found = i + 2
  }
  return found === undefined ? undefined : lexerFindByte(lx, '\n', found)
}

/** `/(?:\r?\n)+/y` (`RE_NEWLINE`). */
function lexerReNewline(lx: Lexer, q: number): number | undefined {
  let i = q
  for (;;) {
    const b = lexerByte(lx, i)
    if (b === 10) i += 1
    else if (b === 13 && lexerByte(lx, i + 1) === 10) i += 2
    else break
  }
  return i > q ? i : undefined
}

/** `/[^\S\n\r]+/y` (`RE_SPACE`). */
function lexerReSpace(lx: Lexer, q: number): number | undefined {
  const src = lx.src
  let i = q
  for (;;) {
    const b = i < src.length ? src.charCodeAt(i) : NONE
    if (b < 0x80) {
      if (!(b === 32 || b === 9 || b === 11 || b === 12)) break
      i += 1
      continue
    }
    const c = lexerCode(lx, i)
    if (!isSpace(c)) break
    i = lexerNext(lx, i)
  }
  return i > q ? i : undefined
}

/** `/\(\s*\)/y` (`RE_EMPTY_CALL`). */
function lexerReEmptyCall(lx: Lexer, q: number): number | undefined {
  if (lexerByte(lx, q) !== 0x28) return undefined
  const i = lexerSkipSpace(lx, q + 1)
  return lexerByte(lx, i) === 0x29 ? i + 1 : undefined
}

function lexerQuote(lx: Lexer): void {
  if (lexerByte(lx, lx.p + 1) === 0x60) {
    lexerPush(lx, S.MdString)
    lx.p += 2
  } else {
    lexerPush(lx, S.String)
    lx.p += 1
  }
}

function lexerInvisLink(lx: Lexer): boolean {
  if (!lexerInvisAhead(lx, lx.p)) return false
  const e = lexerReInvisLink(lx, lx.p)
  if (e === undefined) return false
  lexerEmit(lx, T.Link, lx.p, e)
  return true
}

function lexerOpener(lx: Lexer, c: number): boolean {
  const p = lx.p
  const d = lexerByte(lx, p + 1)
  switch (c) {
    case 0x28: // (
      if (d === 0x2d) {
        lexerPush(lx, S.EllipseText)
        lexerEmit(lx, T.EllipseStart, p, p + 2)
      } else if (d === 0x5b) {
        lexerPush(lx, S.Text)
        lexerEmit(lx, T.StadiumStart, p, p + 2)
      } else if (d === 0x28 && lexerByte(lx, p + 2) === 0x28) {
        lexerPush(lx, S.Text)
        lexerEmit(lx, T.DoubleCircleStart, p, p + 3)
      } else {
        lexerPush(lx, S.Text)
        lexerEmit(lx, T.Ps, p, p + 1)
      }
      return true
    case 0x5b: // [
      if (d === 0x5b) {
        lexerPush(lx, S.Text)
        lexerEmit(lx, T.SubroutineStart, p, p + 2)
      } else if (d === 0x28) {
        lexerPush(lx, S.Text)
        lexerEmit(lx, T.CylinderStart, p, p + 2)
      } else if (d === 0x2f) {
        lexerPush(lx, S.TrapText)
        lexerEmit(lx, T.TrapStart, p, p + 2)
      } else if (d === 0x5c) {
        lexerPush(lx, S.TrapText)
        lexerEmit(lx, T.InvTrapStart, p, p + 2)
      } else {
        lexerPush(lx, S.Text)
        lexerEmit(lx, T.Sqs, p, p + 1)
      }
      return true
    case 0x7c: // |
      lexerPush(lx, S.Text)
      lexerEmit(lx, T.Pipe, p, p + 1)
      return true
    case 0x7b: // {
      lexerPush(lx, S.Text)
      lexerEmit(lx, T.DiamondStart, p, p + 1)
      return true
    default:
      return false
  }
}

function lexerGraph(lx: Lexer, len: number): void {
  if (lx.firstGraph) {
    lx.firstGraph = false
    lexerPush(lx, S.Dir)
  }
  lexerEmit(lx, T.Graph, lx.p, lx.p + len)
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
  lexerEmit(lx, T.NodeString, lx.p, q)
  return true
}

function lexerLink(lx: Lexer, c: number): boolean {
  const p = lx.p
  const d = lexerLinkChar(lx, p)
  if (d === 0x2d) {
    let e = lexerReLineLink(lx, p, 0x2d)
    if (e !== undefined) {
      lexerEmit(lx, T.Link, p, e)
      return true
    }
    e = lexerReLineStart(lx, p, 0x2d)
    if (e !== undefined) {
      lexerPush(lx, S.EdgeText)
      lexerEmit(lx, T.StartLink, p, e)
      return true
    }
    e = lexerReDottedLink(lx, p)
    if (e !== undefined) {
      lexerEmit(lx, T.Link, p, e)
      return true
    }
    e = lexerReDottedStart(lx, p)
    if (e !== undefined) {
      lexerPush(lx, S.DottedEdgeText)
      lexerEmit(lx, T.StartLink, p, e)
      return true
    }
  } else if (d === 0x3d) {
    let e = lexerReLineLink(lx, p, 0x3d)
    if (e !== undefined) {
      lexerEmit(lx, T.Link, p, e)
      return true
    }
    e = lexerReLineStart(lx, p, 0x3d)
    if (e !== undefined) {
      lexerPush(lx, S.ThickEdgeText)
      lexerEmit(lx, T.StartLink, p, e)
      return true
    }
  } else if (d === 0x2e) {
    const e = lexerReDottedLink(lx, p)
    if (e !== undefined) {
      lexerEmit(lx, T.Link, p, e)
      return true
    }
  }

  return c !== 0x2d && c !== 0x3d && c !== 0x2e && lexerInvisLink(lx)
}

function lexerKeyword(lx: Lexer, kind: T, len: number): boolean {
  lexerEmit(lx, kind, lx.p, lx.p + len)
  return true
}

function lexerInitial(lx: Lexer, c: number): boolean {
  const p = lx.p
  switch (c) {
    case 0x61: // a
      if (lexerStartsWith(lx, 'acc', p)) {
        let e = lexerReAcc(lx, 'accTitle', 0x3a)
        if (e !== undefined) {
          lexerPush(lx, S.AccTitle)
          lexerEmit(lx, T.AccTitle, p, e)
          return true
        }
        e = lexerReAcc(lx, 'accDescr', 0x3a)
        if (e !== undefined) {
          lexerPush(lx, S.AccDescr)
          lexerEmit(lx, T.AccDescr, p, e)
          return true
        }
        e = lexerReAcc(lx, 'accDescr', 0x7b)
        if (e !== undefined) {
          lexerPush(lx, S.AccDescrMultiline)
          lx.p = e
          return true
        }
      }
      break
    case 0x40: // @
      if (lexerByte(lx, p + 1) === 0x7b) {
        lexerPush(lx, S.ShapeData)
        lx.tokens.push({ kind: T.ShapeData, start: p, text: '' })
        lx.p += 2
        return true
      }
      break
    case 0x63: {
      // c
      let e = lexerReWordSpace(lx, 'call')
      if (e !== undefined) {
        lexerPush(lx, S.CallbackName)
        lx.p = e
        return true
      }
      if (lexerKw(lx, 'classDef')) return lexerKeyword(lx, T.ClassDef, 8)
      if (lexerKw(lx, 'class')) return lexerKeyword(lx, T.Class, 5)
      e = lexerReWordSpace(lx, 'click')
      if (e !== undefined) {
        lexerPush(lx, S.Click)
        lx.p = e
        return true
      }
      break
    }
    case 0x22: // "
      lexerQuote(lx)
      return true
    case 0x73: // s
      if (lexerKw(lx, 'style')) return lexerKeyword(lx, T.Style, 5)
      if (lexerKw(lx, 'swimlane-beta')) {
        lexerGraph(lx, 13)
        return true
      }
      if (lexerKw(lx, 'subgraph')) return lexerKeyword(lx, T.Subgraph, 8)
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
        lexerEmit(lx, T.Href, p, end)
        return true
      }
      break
    case 0x66: // f
      if (lexerKw(lx, 'flowchart-elk')) {
        lexerGraph(lx, 13)
        return true
      }
      if (lexerKw(lx, 'flowchart')) {
        lexerGraph(lx, 9)
        return true
      }
      break
    case 0x67: // g
      if (lexerKw(lx, 'graph')) {
        lexerGraph(lx, 5)
        return true
      }
      break
    case 0x65: // e
      if (lexerKw(lx, 'end')) {
        const e = lexerSkipSpace(lx, p + 3)
        lexerEmit(lx, T.SubgraphEnd, p, e)
        return true
      }
      break
    case 0x5f: // _
      for (const target of LINK_TARGETS) {
        if (lexerKw(lx, target)) return lexerKeyword(lx, T.LinkTarget, target.length)
      }
      break
    default:
      break
  }

  if (lx.dirNext !== undefined && lexerDirection(lx)) return true

  if (lx.atNext !== undefined && lexerLinkId(lx, c)) return true

  if (c >= 48 && c <= 57) {
    let q = p + 1
    while (q < lx.src.length) {
      const b = lx.src.charCodeAt(q)
      if (b < 48 || b > 57) break
      q += 1
    }
    lexerEmit(lx, T.Num, p, q)
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
    case 0x78: // x
    case 0x6f: // o
    case 0x2e: // .
      return lexerLink(lx, c) || lexerNodeString(lx)
    case 0x3c: // <
      if (lexerLink(lx, c)) return true
      return lexerKeyword(lx, T.TagStart, 1)
    case 0x2d: // -
      if (lexerLink(lx, c) || lexerNodeString(lx)) return true
      return lexerKeyword(lx, T.Minus, 1)
    case 0x3d: // =
      return lexerLink(lx, c)
    case 0x7e: // ~
      return lexerInvisLink(lx)
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
    default:
      break
  }

  if (isSpace(c)) {
    if (lexerLink(lx, c)) return true
    let e = lexerReNewline(lx, p)
    if (e !== undefined) {
      lexerEmit(lx, T.Newline, p, e)
      return true
    }
    e = lexerReSpace(lx, p)
    if (e !== undefined) {
      lexerEmit(lx, T.Space, p, e)
      return true
    }
    return false
  }

  if (c < 128) return lexerNodeString(lx)
  if (isUnicodeLetter(c)) {
    const end = lexerNext(lx, p)
    lexerEmit(lx, T.UnicodeText, p, end)
    return true
  }
  return false
}

/** The direction statements, in the order they are tried. */
const DIRECTIONS: readonly (readonly [T, string])[] = [
  [T.DirectionTb, 'TB'],
  [T.DirectionBt, 'BT'],
  [T.DirectionRl, 'RL'],
  [T.DirectionLr, 'LR'],
  [T.DirectionTd, 'TD'],
]

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

  for (const [kind, dir] of DIRECTIONS) {
    const e = lexerReDirection(lx, p, dir)
    if (e !== undefined) {
      lexerEmit(lx, kind, p, e)
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

    const src = lx.src
    let q = p
    while (q < n) {
      const b = src.charCodeAt(q)
      if (b < 0x80) {
        if (b === 0x22 || b === 32 || (b >= 9 && b <= 13)) break
      } else if (isSpace(lexerCode(lx, q))) {
        break
      }
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
    lexerEmit(lx, T.LinkId, p, at + 1)
    return true
  }
  return false
}

function lexerEdgeText(lx: Lexer, c: number, edge: Edge, a: number, b: number): boolean {
  if (c === 0x22) {
    lexerQuote(lx)
    return true
  }

  const p = lx.p
  const d = lexerLinkChar(lx, p)
  if (d === a || d === b) {
    const e = lexerReEdge(lx, edge, p)
    if (e !== undefined) {
      lexerPop(lx)
      lexerEmit(lx, T.Link, p, e)
      return true
    }
  }

  if (c === a && (a !== 0x2d || lexerByte(lx, p + 1) === 0x2d)) return false

  const n = lx.src.length
  let q = p + 1
  while (q < n) {
    const ch = lexerCode(lx, q)
    if (ch === 0x22) break
    if (ch === a) {
      if (a !== 0x2d || lexerByte(lx, q + 1) === 0x2d) break
    } else if (ch === 0x78 || ch === 0x6f || ch === 0x3c || ch === b || isSpace(ch)) {
      const dd = lexerLinkChar(lx, q)
      if ((dd === a || dd === b) && lexerReEdge(lx, edge, q) !== undefined) break
    }
    q += 1
  }
  lexerEmit(lx, T.EdgeText, p, q)
  return true
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
      if (d === 0x29) lexerEmit(lx, T.StadiumEnd, p, p + 2)
      else if (d === 0x5d) lexerEmit(lx, T.SubroutineEnd, p, p + 2)
      else lexerEmit(lx, T.Sqe, p, p + 1)
      break
    case 0x29: // )
      lexerPop(lx)
      if (d === 0x5d) lexerEmit(lx, T.CylinderEnd, p, p + 2)
      else if (d === 0x29 && lexerByte(lx, p + 2) === 0x29) lexerEmit(lx, T.DoubleCircleEnd, p, p + 3)
      else lexerEmit(lx, T.Pe, p, p + 1)
      break
    case 0x7c: // |
      lexerPop(lx)
      lexerEmit(lx, T.Pipe, p, p + 1)
      break
    case 0x7d: // }
      lexerPop(lx)
      lexerEmit(lx, T.DiamondStop, p, p + 1)
      break
    default: {
      if ((c === 0x7e || isSpace(c)) && lexerInvisLink(lx)) return true
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
          ch === 0x22
        ) {
          break
        }
        q += 1
      }
      lexerEmit(lx, T.Text, p, q)
    }
  }
  return true
}

function lexerEllipseText(lx: Lexer, c: number): boolean {
  const p = lx.p
  const d = lexerByte(lx, p + 1)
  if (c === 0x22) {
    lexerQuote(lx)
  } else if ((c === 0x7e || isSpace(c)) && lexerInvisLink(lx)) {
    return true
  } else if ((c === 0x2d || c === 0x2f || c === 0x29) && d === 0x29) {
    lexerPop(lx)
    lexerEmit(lx, T.EllipseEnd, p, p + 2)
  } else if (c === 0x28 || c === 0x5b || c === 0x7b) {
    lexerOpener(lx, c)
  } else if (c === 0x29 || c === 0x5d || c === 0x7d) {
    return false
  } else {
    const n = lx.src.length
    let q = p + 1
    while (q < n) {
      const ch = lexerCode(lx, q)
      if (
        ch === 0x22 ||
        ch === 0x28 ||
        ch === 0x29 ||
        ch === 0x5b ||
        ch === 0x5d ||
        ch === 0x7b ||
        ch === 0x7d
      ) {
        break
      }
      if ((ch === 0x2d || ch === 0x2f) && lexerByte(lx, q + 1) === 0x29) break
      if (
        (ch === 0x7e || isSpace(ch)) &&
        lexerInvisAhead(lx, q) &&
        lexerReInvisLink(lx, q) !== undefined
      ) {
        break
      }
      q += 1
    }
    lexerEmit(lx, T.Text, p, q)
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
  if ((c === 0x7e || isSpace(c)) && lexerInvisLink(lx)) return true

  const close = 0x5d
  switch (c) {
    case 0x28: // (
      if (d === 0x2d || d === 0x5b || (d === 0x28 && lexerByte(lx, p + 2) === 0x28)) {
        lexerOpener(lx, c)
      } else if (d === close) {
        lexerPop(lx)
        lexerEmit(lx, T.TrapEnd, p, p + 2)
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
        lexerEmit(lx, T.TrapEnd, p, p + 2)
      } else {
        lexerEmit(lx, T.Text, p, p + 1)
      }
      break
    case 0x2f: // /
      if (d === close) {
        lexerPop(lx)
        lexerEmit(lx, T.InvTrapEnd, p, p + 2)
      } else {
        lexerEmit(lx, T.Text, p, p + 1)
      }
      break
    case 0x5d: // ]
    case 0x29: // )
      if (d !== close) return false
      lexerPop(lx)
      lexerEmit(lx, T.TrapEnd, p, p + 2)
      break
    case 0x7d: // }
      return false
    default: {
      if ((c === 0x3f || c === 0x3d) && d === close) {
        lexerPop(lx)
        lexerEmit(lx, T.TrapEnd, p, p + 2)
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
          ch === 0x2f
        ) {
          break
        }
        q += 1
      }
      lexerEmit(lx, T.Text, p, q)
    }
  }
  return true
}

function lexerRun(lx: Lexer): void {
  const src = lx.src
  const n = src.length
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
        default:
          kind = undefined
      }
      if (kind !== undefined) lexerEmit(lx, kind, n, n)
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
            lx.p += 2
          } else {
            lexerPop(lx)
            lx.p += 1
          }
        } else {
          const e = lexerFindByte(lx, '"', p)
          lexerEmit(lx, T.Str, p, e)
        }
        ok = true
        break
      case S.MdString:
        if (c === 0x60) {
          if (lexerByte(lx, p + 1) === 0x22) {
            lexerPop(lx)
            lx.p += 2
            ok = true
          } else {
            ok = false
          }
        } else if (c === 0x22) {
          lexerQuote(lx)
          ok = true
        } else {
          let q = p + 1
          while (q < n) {
            const ch = src.charCodeAt(q)
            if (ch === 0x60 || ch === 0x22) break
            q += 1
          }
          lexerEmit(lx, T.MdStr, p, q)
          ok = true
        }
        break
      case S.AccTitle:
      case S.AccDescr: {
        const e = lexerFindByte(lx, '\n', p)
        const kind = lx.state === S.AccTitle ? T.AccTitleValue : T.AccDescrValue
        lexerPop(lx)
        lexerEmit(lx, kind, p, e)
        ok = true
        break
      }
      case S.AccDescrMultiline:
        if (c === 0x7d) {
          lexerPop(lx)
          lx.p += 1
        } else {
          const e = lexerFindByte(lx, '}', p)
          lexerEmit(lx, T.AccDescrMultilineValue, p, e)
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
          lexerEmit(lx, T.NoDir, p, nodir)
          ok = true
          break
        }
        const e = lexerReDir(lx, p) ?? lexerReDirSym(lx, p) ?? lexerReDirV(lx, p)
        if (e !== undefined) {
          lexerPop(lx)
          lexerEmit(lx, T.Dir, p, e)
          ok = true
          break
        }
        ok = lexerInvisLink(lx) || lexerOpener(lx, c)
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
        ok = lexerEdgeText(lx, c, Edge.Normal, 0x2d, NO_CHAR)
        break
      case S.ThickEdgeText:
        ok = lexerEdgeText(lx, c, Edge.Thick, 0x3d, NO_CHAR)
        break
      case S.DottedEdgeText:
        ok = lexerEdgeText(lx, c, Edge.Dotted, 0x2e, 0x2d)
        break
      case S.Click:
        if (c === 0x22) {
          lexerQuote(lx)
        } else if (isSpace(c)) {
          lexerPop(lx)
          lx.p = lexerNext(lx, p)
        } else {
          let q = p + 1
          while (q < n && !isSpace(lexerCode(lx, q))) q += 1
          lexerEmit(lx, T.Click, p, q)
        }
        ok = true
        break
      case S.CallbackName:
        if (c === 0x28) {
          const e = lexerReEmptyCall(lx, p)
          lexerPop(lx)
          if (e !== undefined) {
            lx.p = e
          } else {
            lexerPush(lx, S.CallbackArgs)
            lx.p += 1
          }
        } else {
          const e = lexerFindByte(lx, '(', p)
          lexerEmit(lx, T.CallbackName, p, e)
        }
        ok = true
        break
      case S.CallbackArgs:
        if (c === 0x29) {
          lexerPop(lx)
          lx.p += 1
        } else {
          const e = lexerFindByte(lx, ')', p)
          lexerEmit(lx, T.CallbackArgs, p, e)
        }
        ok = true
        break
      case S.ShapeData:
        if (c === 0x22) {
          lexerPush(lx, S.ShapeDataStr)
          lexerEmit(lx, T.ShapeData, p, p + 1)
          ok = true
        } else if (c === 0x7d) {
          lexerPop(lx)
          lx.p += 1
          ok = true
        } else if (c === 0x5e) {
          ok = false
        } else {
          let q = p + 1
          while (q < n) {
            const ch = src.charCodeAt(q)
            if (ch === 0x7d || ch === 0x5e || ch === 0x22) break
            q += 1
          }
          lexerEmit(lx, T.ShapeData, p, q)
          ok = true
        }
        break
      case S.ShapeDataStr:
        if (c === 0x22) {
          lexerPop(lx)
          lexerEmit(lx, T.ShapeData, p, p + 1)
        } else {
          const e = lexerFindByte(lx, '"', p)
          const text = src.slice(p, e)
          lx.tokens.push({ kind: T.ShapeData, start: p, text: breakLines(text) })
          lx.p = e
        }
        ok = true
        break
    }

    if (!ok) {
      lx.tokens.push({ kind: T.Error, start: lx.p, text: '' })
      return
    }
  }

  lx.tokens.push({ kind: T.End, start: n, text: '' })
}

/** `text.replace(/\n\s*\/g, '<br/>')`. */
function breakLines(text: string): string {
  return text.replace(/\n\s*/g, '<br/>')
}
