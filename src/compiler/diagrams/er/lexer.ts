/**
 * @module The ER lexer: a state machine equivalent to Mermaid's Jison lexer. Port of Pele's
 * `src/diagrams/er/lexer.ts`.
 *
 * Pele reads UTF-16 code units, as this port does. The Rust crate reads UTF-8 bytes: every
 * delimiter and keyword is ASCII, runs of non-ASCII text are runs of units of 128 and above, and
 * characters are decoded whole wherever the attribute pattern tests them, so token boundaries
 * match. `\s` is all in the Basic Multilingual Plane, so testing it on a unit tests the character.
 * Each regular expression in Pele is a hand-written matcher below.
 */
import { isDigit, isLineEnd, isSpace, isWord } from '../../util/chars.ts'
import { startsWithIgnoreAsciiCase } from '../../util/rust.ts'
import { T } from './tokens.ts'

/**
 * `String.prototype.charCodeAt`, called through a module-local constant so the hot loops below
 * stay monomorphic over the many string representations a source can have (see
 * `text/measure.ts`).
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** A token: its kind, its start as a UTF-16 offset, and its text. */
export type Token = {
  /** The token kind. */
  kind: T
  /** The UTF-16 offset of the token in the source. */
  start: number
  /** The matched text. */
  text: string
}

/** Lexer start conditions, as in Mermaid's grammar. */
const S = {
  AccDescr: 0,
  AccDescrMultiline: 1,
  AccTitle: 2,
  Block: 3,
  BlockBq: 4,
  Initial: 5,
  Style: 6,
} as const
type S = (typeof S)[keyof typeof S]

/** Characters of entity names. */
const TEXT = 1
/** Characters of style text. */
const STYLE_TEXT = 2
/** Characters that may start an attribute word. */
const ATTR_START = 4
/** Characters that may continue an attribute word. */
const ATTR_REST = 8

/** The character classes of ASCII characters. */
const CLASS: Uint8Array = (() => {
  const table = new Uint8Array(128)
  for (let c = 0; c < 128; c++) {
    const digit = c >= 48 && c <= 57
    const word = digit || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (word) table[c] = (table[c] as number) | TEXT | STYLE_TEXT | ATTR_REST
    if (word && !digit) table[c] = (table[c] as number) | ATTR_START
  }
  const add = (ch: string, bits: number): void => {
    const c = ch.charCodeAt(0)
    table[c] = (table[c] as number) | bits
  }
  add('-', TEXT | STYLE_TEXT | ATTR_REST)
  add('*', TEXT | STYLE_TEXT | ATTR_REST | ATTR_START)
  add('.', TEXT | ATTR_REST)
  add('[', ATTR_REST)
  add(']', ATTR_REST)
  add('(', ATTR_REST)
  add(')', ATTR_REST)
  add(',', ATTR_REST)
  return table
})()

/** What `at` returns past the end. It is no character, so every test of it fails. */
const NONE = -1

/** Whether unit `c` is in class `kind`, any unit of a non-ASCII character counting as text. */
function isText(c: number, kind: number): boolean {
  if (c < 0) return false
  return c >= 128 || ((CLASS[c] as number) & kind) !== 0
}

/** Mermaid's attribute pattern is case-insensitive, which lets the micro sign into its `À-￿` range. */
function isAttr(code: number, kind: number): boolean {
  if (code < 0) return false
  if (code < 128) return ((CLASS[code] as number) & kind) !== 0
  return code >= 0xc0 || code === 0xb5
}

/** The code point at `at`, or `NONE` past the end. */
function charAt(src: string, at: number): number {
  if (at >= src.length) return NONE
  return src.codePointAt(at) as number
}

/** The UTF-16 length of code point `code`. */
function lenUtf16(code: number): number {
  return code > 0xffff ? 2 : 1
}

/** Whether the character at `at` is JavaScript `\s`. */
function spaceAt(src: string, at: number): boolean {
  return at < src.length && isSpace(charCodeAt.call(src, at))
}

/** The end of a run of JavaScript `\s` characters from `at`. */
function skipSpaces(src: string, at: number): number {
  const n = src.length
  while (at < n && isSpace(charCodeAt.call(src, at))) at++
  return at
}

/** The first `ch` at or after `from`. */
function find(src: string, from: number, ch: string): number | undefined {
  const at = src.indexOf(ch, from)
  return at < 0 ? undefined : at
}

/** Whether `src` at `at` spells the ASCII `word`, letters in any case. */
function startsCi(src: string, at: number, word: string): boolean {
  return startsWithIgnoreAsciiCase(src, word, at)
}

/** The first `direction`, in any case, at or after `from`. */
function findDirection(src: string, from: number): number | undefined {
  // Only `d` and `D` lower-case to `d`, so the search jumps between them.
  let lowerD = src.indexOf('d', from)
  let upperD = src.indexOf('D', from)
  for (;;) {
    if (lowerD < 0 && upperD < 0) return undefined
    const at = lowerD < 0 ? upperD : upperD < 0 ? lowerD : Math.min(lowerD, upperD)
    if (startsCi(src, at, 'direction')) return at
    if (at === lowerD) lowerD = src.indexOf('d', at + 1)
    else upperD = src.indexOf('D', at + 1)
  }
}

/** The end of the next line terminator's line from `from`: its index, or the end of `src`. */
function nextLineEnd(src: string, from: number): number {
  const n = src.length
  for (let at = from; at < n; at++) {
    if (isLineEnd(charCodeAt.call(src, at))) return at
  }
  return n
}

/** `/<word>\s*<sep>\s*\/iy` at `at`: the end of the match. */
function acc(src: string, at: number, word: string, sep: number): number | undefined {
  if (!startsCi(src, at, word)) return undefined
  const q = skipSpaces(src, at + word.length)
  if (q >= src.length || src.charCodeAt(q) !== sep) return undefined
  return skipSpaces(src, q + 1)
}

/**
 * Where `/.*direction\s+XX[^\n]*\/iy` ends when it matches at `p`. `.*` is greedy, so the last
 * `direction` on the line that is followed by the pair wins.
 */
function directionEnd(src: string, p: number, lineEnd: number, pair: string): number | undefined {
  const candidates: number[] = []
  for (let at = p; at < lineEnd; at++) {
    if ((charCodeAt.call(src, at) | 32) === 0x64 && startsCi(src, at, 'direction') && at + 9 <= lineEnd) {
      candidates.push(at)
    }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    const start = candidates[k] as number
    const q = skipSpaces(src, start + 9)
    if (q > start + 9 && startsCi(src, q, pair)) return find(src, q + 2, '\n') ?? src.length
  }
  return undefined
}

/** `Ahead::Unknown`: not searched for yet. */
const UNKNOWN = -1
/** `Ahead::Gone`: there is none further on. Any other value is `Ahead::At`, where it was last found. */
const GONE = -2

/** The lexer's position, state, and the positions it looks ahead to. */
type Lexer = {
  dirFailed: number
  /** The next `direction`. */
  dirNext: number
  lineEnd: number | undefined
  p: number
  src: string
  state: S
  tildeLast: number | undefined
  tildeLine: number | undefined
  /** The next `~`. */
  tildeNext: number
  tokens: Token[]
  wsNext: number | undefined
}

/** Produces the token stream of Mermaid's ER lexer. */
export function tokenize(src: string): Token[] {
  return run({
    dirFailed: 0,
    dirNext: UNKNOWN,
    lineEnd: undefined,
    p: 0,
    src,
    state: S.Initial,
    tildeLast: undefined,
    tildeLine: undefined,
    tildeNext: UNKNOWN,
    tokens: [],
    wsNext: undefined,
  })
}

/** The unit at `i`, or `NONE` past the end. */
function at(self: Lexer, i: number): number {
  const src = self.src
  return i < src.length ? charCodeAt.call(src, i) : NONE
}

/** Emits a token from `s` to `e` and moves to `e`. */
function emit(self: Lexer, kind: T, s: number, e: number): void {
  self.tokens.push({ kind, start: s, text: self.src.slice(s, e) })
  self.p = e
}

/** Matches a lower-case keyword at the position, ignoring case. */
function kw(self: Lexer, word: string): boolean {
  return startsCi(self.src, self.p, word)
}

/** Matches a lower-case keyword at the position, ignoring case, at a word boundary. */
function kwb(self: Lexer, word: string): boolean {
  return kw(self, word) && !isWord(at(self, self.p + word.length))
}

/** The unit at `q`, lower-cased if it is an ASCII letter. */
function lower(self: Lexer, q: number): number {
  const c = at(self, q)
  return c >= 65 && c <= 90 ? c + 32 : c
}

/** The end of a run of digits from `q`. */
function digits(self: Lexer, q: number): number {
  while (isDigit(at(self, q))) q++
  return q
}

/** The direction token kinds, in the order their pairs are tried. */
const DIRECTION_KINDS: readonly T[] = [T.DirectionTb, T.DirectionBt, T.DirectionRl, T.DirectionLr]
/** The direction pairs, in the order they are tried. */
const DIRECTION_PAIRS: readonly string[] = ['TB', 'BT', 'RL', 'LR']

/** A direction statement swallows its whole line, from wherever the lexer stands on it. */
function direction(self: Lexer): boolean {
  const p = self.p
  let next: number
  if (self.dirNext === GONE) return false
  if (self.dirNext >= 0 && self.dirNext >= p) {
    next = self.dirNext
  } else {
    const found = findDirection(self.src, p)
    if (found === undefined) {
      self.dirNext = GONE
      return false
    }
    self.dirNext = found
    next = found
  }
  if (p < self.dirFailed) return false
  let lineEnd: number
  if (self.lineEnd !== undefined && self.lineEnd >= p) {
    lineEnd = self.lineEnd
  } else {
    lineEnd = nextLineEnd(self.src, p)
    self.lineEnd = lineEnd
  }
  if (next >= lineEnd) return false
  for (let k = 0; k < DIRECTION_PAIRS.length; k++) {
    const end = directionEnd(self.src, p, lineEnd, DIRECTION_PAIRS[k] as string)
    if (end !== undefined) {
      emit(self, DIRECTION_KINDS[k] as T, p, end)
      return true
    }
  }
  self.dirFailed = lineEnd
  return false
}

/** A double-quoted entity name, or a quoted word that cannot be one. */
function quoted(self: Lexer): void {
  const p = self.p
  const e = find(self.src, p + 1, '"')
  if (e === undefined) {
    emit(self, T.Char, p, p + 1)
    return
  }
  let name = e > p + 1
  if (name) {
    for (let i = p + 1; i < e; i++) {
      const c = charCodeAt.call(self.src, i)
      if (c === 0x25 || c === 0x5c || c === 0x0d || c === 0x0a || c === 11 || c === 8) {
        name = false
        break
      }
    }
  }
  emit(self, name ? T.EntityName : T.Word, p, e + 1)
}

/** A number, or a cardinality written with digits. */
function number(self: Lexer, c: number): void {
  const p = self.p
  const d = at(self, p + 1)
  if (d === 0x2b && (c === 0x31 || c === 0x30)) {
    emit(self, c === 0x31 ? T.OneOrMore : T.ZeroOrMore, p, p + 2)
    return
  }
  const q = digits(self, p + 1)
  if (at(self, q) === 0x2e && isDigit(at(self, q + 1))) {
    const e = digits(self, q + 2)
    emit(self, T.DecimalNum, p, e)
    return
  }
  if (c === 0x31) {
    if (d >= 0 && isSpace(d)) {
      const r = skipSpaces(self.src, p + 2)
      const f = at(self, r)
      if (isWord(f) || f === 0x22 || f === 0x27) {
        emit(self, T.OnlyOne, p, p + 1)
        return
      }
    } else if ((d === 0x2d || d === 0x2e) && (at(self, p + 2) === 0x2d || at(self, p + 2) === 0x2e)) {
      emit(self, T.OnlyOne, p, p + 1)
      return
    }
    if (!isWord(d)) {
      emit(self, T.EntityOne, p, p + 1)
      return
    }
  }
  emit(self, T.Num, p, q)
}

/** The keywords and relationship symbols, by lower-cased first character. */
function keyword(self: Lexer, lc: number): boolean {
  const p = self.p
  const d = at(self, p + 1)
  switch (lc) {
    case 0x65: // e
      if (kwb(self, 'erdiagram')) emit(self, T.ErDiagram, p, p + 9)
      else if (kwb(self, 'end')) {
        const e = skipSpaces(self.src, p + 3)
        emit(self, T.EndKw, p, e)
      } else return false
      break
    case 0x73: // s
      if (kwb(self, 'style')) {
        self.state = S.Style
        emit(self, T.Style, p, p + 5)
      } else if (kwb(self, 'subgraph')) emit(self, T.Subgraph, p, p + 8)
      else return false
      break
    case 0x63: // c
      if (kwb(self, 'classdef')) {
        self.state = S.Style
        emit(self, T.Classdef, p, p + 8)
      } else if (kwb(self, 'class')) emit(self, T.Class, p, p + 5)
      else return false
      break
    case 0x6f: // o
      if (kwb(self, 'one or zero')) emit(self, T.ZeroOrOne, p, p + 11)
      else if (kwb(self, 'one or more') || kwb(self, 'one or many')) emit(self, T.OneOrMore, p, p + 11)
      else if (kwb(self, 'one')) emit(self, T.OnlyOne, p, p + 3)
      else if (kwb(self, 'only one')) emit(self, T.OnlyOne, p, p + 8)
      else if (d === 0x7c) emit(self, T.ZeroOrOne, p, p + 2)
      else if (d === 0x7b) emit(self, T.ZeroOrMore, p, p + 2)
      else if (kwb(self, 'optionally to')) emit(self, T.NonIdentifying, p, p + 13)
      else return false
      break
    case 0x7a: // z
      if (kwb(self, 'zero or one')) emit(self, T.ZeroOrOne, p, p + 11)
      else if (kwb(self, 'zero or more') || kwb(self, 'zero or many')) emit(self, T.ZeroOrMore, p, p + 12)
      else return false
      break
    case 0x6d: // m
      if (kw(self, 'many(0)')) emit(self, T.ZeroOrMore, p, p + 7)
      else if (kw(self, 'many(1)')) emit(self, T.OneOrMore, p, p + 7)
      else if (kwb(self, 'many')) emit(self, T.ZeroOrMore, p, p + 4)
      else return false
      break
    case 0x74: // t
      if (!kwb(self, 'to')) return false
      emit(self, T.Identifying, p, p + 2)
      break
    case 0x75: // u
      if (!(d === 0x2e || d === 0x2d || d === 0x7c)) return false
      emit(self, T.MdParent, p, p + 1)
      break
    case 0x7c: {
      // |
      const o = lower(self, p + 1) === 0x6f && !isWord(at(self, p + 2))
      if (o) emit(self, T.ZeroOrOne, p, p + 2)
      else if (d === 0x7c) emit(self, T.OnlyOne, p, p + 2)
      else if (d === 0x7b) emit(self, T.OneOrMore, p, p + 2)
      else return false
      break
    }
    case 0x7d: {
      // }
      const o = lower(self, p + 1) === 0x6f && !isWord(at(self, p + 2))
      if (o) emit(self, T.ZeroOrMore, p, p + 2)
      else if (d === 0x7c) emit(self, T.OneOrMore, p, p + 2)
      else return false
      break
    }
    case 0x2e: // .
      if (!(d === 0x2e || d === 0x2d)) return false
      emit(self, T.NonIdentifying, p, p + 2)
      break
    case 0x2d: // -
      if (d === 0x2d) emit(self, T.Identifying, p, p + 2)
      else if (d === 0x2e) emit(self, T.NonIdentifying, p, p + 2)
      else return false
      break
    default:
      return false
  }
  return true
}

/** The rules of the initial state. */
function initial(self: Lexer, c: number): void {
  const p = self.p
  if ((c === 0x61 || c === 0x41) && kw(self, 'acc')) {
    let e = acc(self.src, p, 'accTitle', 0x3a)
    if (e !== undefined) {
      self.state = S.AccTitle
      emit(self, T.AccTitle, p, e)
      return
    }
    e = acc(self.src, p, 'accDescr', 0x3a)
    if (e !== undefined) {
      self.state = S.AccDescr
      emit(self, T.AccDescr, p, e)
      return
    }
    e = acc(self.src, p, 'accDescr', 0x7b)
    if (e !== undefined) {
      self.state = S.AccDescrMultiline
      self.p = e
      return
    }
  }
  if (direction(self)) return

  switch (c) {
    case 0x20:
    case 0x09:
    case 0x0d: {
      let e = p + 1
      for (let d = at(self, e); d === 0x20 || d === 0x09 || d === 0x0d; d = at(self, e)) e++
      self.p = e
      return
    }
    case 0x0a: {
      let e = p + 1
      while (at(self, e) === 0x0a) e++
      emit(self, T.Newline, p, e)
      return
    }
    case 0x22:
      quoted(self)
      return
    case 0x7b:
      self.state = S.Block
      emit(self, T.BlockStart, p, p + 1)
      return
    case 0x23:
      emit(self, T.Brkt, p, p + 1)
      return
    case 0x2c:
      emit(self, T.Comma, p, p + 1)
      return
    case 0x3a:
      if (at(self, p + 1) === 0x3a && at(self, p + 2) === 0x3a) emit(self, T.StyleSeparator, p, p + 3)
      else emit(self, T.Colon, p, p + 1)
      return
    case 0x5b:
      emit(self, T.Sqs, p, p + 1)
      return
    case 0x5d:
      emit(self, T.Sqe, p, p + 1)
      return
    default:
      break
  }
  if (isDigit(c)) {
    number(self, c)
    return
  }
  if (keyword(self, c >= 65 && c <= 90 ? c + 32 : c)) return
  if (isText(c, TEXT)) {
    let e = p + 1
    while (isText(at(self, e), TEXT)) e++
    emit(self, T.UnicodeText, p, e)
    return
  }
  emit(self, T.Char, p, p + 1)
}

/**
 * Mermaid's generic type rule: a run of non-space characters holding a `~`, through the last `~`
 * on the line.
 */
function generic(self: Lexer): boolean {
  const p = self.p
  const src = self.src
  let tildeNext: number
  if (self.tildeNext === GONE) return false
  if (self.tildeNext >= 0 && self.tildeNext >= p) {
    tildeNext = self.tildeNext
  } else {
    const found = find(src, p, '~')
    if (found === undefined) {
      self.tildeNext = GONE
      return false
    }
    self.tildeNext = found
    tildeNext = found
  }
  let wsNext: number
  if (self.wsNext !== undefined && self.wsNext >= p) {
    wsNext = self.wsNext
  } else {
    let q = p
    while (q < src.length && !isSpace(charCodeAt.call(src, q))) q++
    self.wsNext = q
    wsNext = q
  }
  if (tildeNext >= wsNext) return false
  if (self.tildeLine === undefined || self.tildeLine < p) {
    const line = nextLineEnd(src, p)
    self.tildeLine = line
    const last = line > 0 ? src.lastIndexOf('~', line - 1) : -1
    self.tildeLast = last < 0 ? undefined : last
  }
  const last = self.tildeLast
  if (last === undefined || last <= tildeNext) return false
  let e = last + 1
  while (e < src.length && !isSpace(charCodeAt.call(src, e))) e++
  emit(self, T.AttributeWord, p, e)
  return true
}

/** The rules inside an attribute block. */
function block(self: Lexer, c: number): void {
  const p = self.p
  const src = self.src
  if (spaceAt(src, p)) {
    self.p = skipSpaces(src, p)
    return
  }
  const lc = c | 32
  if (lc === 0x70 || lc === 0x66 || lc === 0x75) {
    const d = at(self, p + 1)
    if (d >= 0 && (d | 32) === 0x6b && !isWord(at(self, p + 2))) {
      emit(self, T.AttributeKey, p, p + 2)
      return
    }
  }
  if (generic(self)) return
  const ch = charAt(src, p)
  if (isAttr(ch, ATTR_START)) {
    let e = p + lenUtf16(ch)
    for (let d = charAt(src, e); isAttr(d, ATTR_REST); d = charAt(src, e)) e += lenUtf16(d)
    emit(self, T.AttributeWord, p, e)
    return
  }
  if (c === 0x60) {
    self.state = S.BlockBq
    self.p += 1
    return
  }
  if (c === 0x22) {
    const e = find(src, p + 1, '"')
    if (e !== undefined) {
      emit(self, T.Comment, p, e + 1)
      return
    }
  } else if (c === 0x7d) {
    self.state = S.Initial
    emit(self, T.BlockStop, p, p + 1)
    return
  }
  emit(self, T.Char, p, p + lenUtf16(ch))
}

/** Reads the whole source. */
function run(self: Lexer): Token[] {
  const src = self.src
  const n = src.length
  while (self.p < n) {
    const p = self.p
    const c = charCodeAt.call(src, p)
    switch (self.state) {
      case S.Initial:
        initial(self, c)
        break
      case S.Block:
        block(self, c)
        break
      case S.BlockBq:
        if (c === 0x60) {
          self.state = S.Block
          self.p += 1
        } else {
          emit(self, T.AttributeWord, p, find(src, p, '`') ?? n)
        }
        break
      case S.AccTitle:
      case S.AccDescr: {
        const e = find(src, p, '\n') ?? n
        emit(self, self.state === S.AccTitle ? T.AccTitleValue : T.AccDescrValue, p, e)
        self.state = S.Initial
        break
      }
      case S.AccDescrMultiline:
        if (c === 0x7d) {
          self.state = S.Initial
          self.p += 1
        } else {
          emit(self, T.AccDescrMultilineValue, p, find(src, p, '}') ?? n)
        }
        break
      case S.Style:
        if (c === 0x0a) {
          let e = p + 1
          while (at(self, e) === 0x0a) e++
          self.state = S.Initial
          emit(self, T.Newline, p, e)
        } else if (spaceAt(src, p)) {
          self.p = skipSpaces(src, p)
        } else if (c === 0x3a) {
          emit(self, T.Colon, p, p + 1)
        } else if (c === 0x2c) {
          emit(self, T.Comma, p, p + 1)
        } else if (c === 0x23) {
          emit(self, T.Brkt, p, p + 1)
        } else if (c === 0x3b) {
          emit(self, T.Semi, p, p + 1)
        } else if (isText(c, STYLE_TEXT)) {
          let e = p + 1
          while (isText(at(self, e), STYLE_TEXT)) e++
          emit(self, T.StyleText, p, e)
        } else {
          self.tokens.push({ kind: T.Error, start: p, text: '' })
          return self.tokens
        }
        break
    }
  }

  // At the end of input Jison's INITIAL state yields EOF, the title and description states yield
  // an empty value, and the block and style states yield nothing.
  let last: T | undefined
  switch (self.state) {
    case S.Initial:
      last = T.Eof
      break
    case S.AccTitle:
      last = T.AccTitleValue
      break
    case S.AccDescr:
      last = T.AccDescrValue
      break
    case S.AccDescrMultiline:
      last = T.AccDescrMultilineValue
      break
    default:
      last = undefined
  }
  if (last !== undefined) emit(self, last, n, n)
  emit(self, T.End, n, n)
  return self.tokens
}
