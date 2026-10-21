/**
 * @module The quadrant chart lexer. Port of Pele's `src/diagrams/quadrant/lexer.ts`.
 *
 * Pele reads UTF-16 code units, and so does this port. Every delimiter is ASCII, a non-ASCII
 * character is decoded whole wherever a rule tests it, and a character outside the Basic
 * Multilingual Plane counts as the two units a rule would see in JavaScript.
 */
import { T } from './tokens.ts'
import { wordAt } from '../common/caseless.ts'
import { isDigit, isLetter, isLineEnd, isSpace, isWord } from '../../util/chars.ts'

/**
 * `String.prototype.charCodeAt` and `codePointAt`, called through `.call` so that reads of
 * sources of any V8 string kind stay direct. See `text/measure.ts`.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt
const codePointAt: (this: string, index: number) => number | undefined = String.prototype.codePointAt

/** A token: its kind and its UTF-16 span. */
export type Token = {
  /** End offset. */
  end: number
  /** Start offset. */
  start: number
  /** Kind. */
  t: T
}

/** A start condition of Mermaid's lexer. */
const S = {
  Initial: 0,
  Title: 1,
  AccTitle: 2,
  AccDescr: 3,
  AccDescrMultiline: 4,
  String: 5,
  MdString: 6,
  ClassName: 7,
  PointStart: 8,
  PointX: 9,
  PointY: 10,
} as const
type S = (typeof S)[keyof typeof S]

/** The token the state gives for the empty rest of the input, where it gives one. */
function sAtEnd(state: S): T | undefined {
  switch (state) {
    case S.Initial:
      return T.Eof
    case S.Title:
      return T.TitleValue
    case S.AccTitle:
      return T.AccTitleValue
    case S.AccDescr:
      return T.AccDescrValue
    case S.AccDescrMultiline:
      return T.AccDescrMultilineValue
    case S.String:
      return T.Str
    default:
      return undefined
  }
}

/** The token of a one-character ASCII rule. */
function single(c: number): T | undefined {
  switch (c) {
    case 0x3a:
      return T.Colon
    case 0x2b:
      return T.Plus
    case 0x2c:
      return T.Comma
    case 0x3d:
      return T.Equals
    case 0x2a:
      return T.Mult
    case 0x23:
      return T.Brkt
    case 0x5f:
      return T.Underscore
    case 0x2e:
      return T.Dot
    case 0x26:
      return T.Amp
    case 0x2d:
      return T.Minus
    case 0x20:
    case 0x09:
    case 0x0b:
    case 0x0c:
      return T.Space
    case 0x3b:
      return T.Semi
    case 0x21:
    case 0x24:
    case 0x25:
    case 0x27:
    case 0x60:
    case 0x3f:
    case 0x5c:
    case 0x2f:
      return T.Punctuation
    default:
      return undefined
  }
}

/** The code point at `at`, or `undefined` at the end. */
function charAt(src: string, at: number): number | undefined {
  return at < src.length ? (codePointAt.call(src, at) as number) : undefined
}

/** The code unit at `at`, or 0 at the end. */
function byte(src: string, at: number): number {
  return at < src.length ? charCodeAt.call(src, at) : 0
}

/** Lexer state over one source. */
type Lexer = {
  /** The start and end of the last run of dashes measured. */
  dash0: number
  dash1: number
  /** The start and end of the last run of `\s` after a colon measured. */
  gap0: number
  gap1: number
  p: number
  /** The start and end of the last run of spaces measured. */
  space0: number
  space1: number
  src: string
  stack: S[]
  state: S
  tokens: Token[]
  /** The start and end of the last run of `\s` measured. */
  ws0: number
  ws1: number
}

function lexerEmit(lexer: Lexer, t: T, start: number, end: number): void {
  lexer.tokens.push({ end, start, t })
  lexer.p = end
}

function lexerPush(lexer: Lexer, state: S): void {
  lexer.stack.push(lexer.state)
  lexer.state = state
}

function lexerPop(lexer: Lexer): void {
  const state = lexer.stack.pop()
  if (state !== undefined) lexer.state = state
}

function lexerLineEnd(lexer: Lexer, q: number): number {
  const at = lexer.src.indexOf('\n', q)
  return at < 0 ? lexer.src.length : at
}

/** The end of the run of spaces at `q`. */
function lexerSpaces(lexer: Lexer, q: number): number {
  while (byte(lexer.src, q) === 0x20) q++
  return q
}

/** The end of the run of `\s` at `q`. */
function lexerRun(lexer: Lexer, q: number): number {
  // Every `\s` character is in the Basic Multilingual Plane.
  const src = lexer.src
  while (q < src.length && isSpace(charCodeAt.call(src, q))) q++
  return q
}

/** Mermaid's `(1)|(0(.\d+)?)`, where the dot is any one code unit within a line. */
function lexerCoordinate(lexer: Lexer, q: number): number | undefined {
  const src = lexer.src
  switch (byte(src, q)) {
    case 0x31:
      return q + 1
    case 0x30: {
      let e = q + 1
      // A unit of a surrogate pair is followed by the other one, never a digit.
      if (e < src.length && !isLineEnd(charCodeAt.call(src, e)) && isDigit(byte(src, e + 1))) {
        e += 2
        while (isDigit(byte(src, e))) e++
      }
      return e
    }
    default:
      return undefined
  }
}

/**
 * Runs the rule of a state that is not the initial one. Returns `undefined` to go on with the
 * initial rules, `true` when a rule matched, and `false` when nothing can.
 */
function lexerStateRule(lexer: Lexer, c: number): boolean | undefined {
  const p = lexer.p
  const src = lexer.src
  const n = src.length
  switch (lexer.state) {
    case S.Initial:
      return undefined
    case S.Title:
    case S.AccTitle:
    case S.AccDescr: {
      const end = lexerLineEnd(lexer, p)
      const t = sAtEnd(lexer.state)
      if (t !== undefined) lexerEmit(lexer, t, p, end)
      lexerPop(lexer)
      return true
    }
    case S.AccDescrMultiline: {
      if (c === 0x7d) {
        lexer.p += 1
        lexerPop(lexer)
      } else {
        const at = src.indexOf('}', p)
        lexerEmit(lexer, T.AccDescrMultilineValue, p, at < 0 ? n : at)
      }
      return true
    }
    case S.String: {
      if (c === 0x22) {
        lexer.p += 1
        lexerPop(lexer)
      } else {
        const at = src.indexOf('"', p)
        lexerEmit(lexer, T.Str, p, at < 0 ? n : at)
      }
      return true
    }
    case S.MdString: {
      if (c === 0x60 && byte(src, p + 1) === 0x22) {
        lexer.p += 2
        lexerPop(lexer)
        return true
      }
      if (c !== 0x60 && c !== 0x22) {
        let e = p + 1
        while (e < n && byte(src, e) !== 0x60 && byte(src, e) !== 0x22) e++
        lexerEmit(lexer, T.MdStr, p, e)
        return true
      }
      return false
    }
    case S.ClassName: {
      if (isWord(c)) {
        let e = p + 1
        while (isWord(byte(src, e))) e++
        lexerEmit(lexer, T.ClassName, p, e)
        lexerPop(lexer)
        return true
      }
      return false
    }
    case S.PointStart: {
      const e = lexerCoordinate(lexer, p)
      if (e !== undefined) {
        lexerEmit(lexer, T.PointX, p, e)
        lexerPush(lexer, S.PointX)
        return true
      }
      const k = lexerRun(lexer, p)
      if (byte(src, k) === 0x5d) {
        lexer.p = lexerSpaces(lexer, k + 1)
        lexerPop(lexer)
        return true
      }
      return false
    }
    case S.PointX: {
      const k = lexerRun(lexer, p)
      if (byte(src, k) === 0x2c) {
        lexer.p = lexerRun(lexer, k + 1)
        lexer.state = S.PointY
        return true
      }
      return false
    }
    case S.PointY: {
      const e = lexerCoordinate(lexer, p)
      if (e !== undefined) {
        lexerEmit(lexer, T.PointY, p, e)
        lexerPop(lexer)
        return true
      }
      return false
    }
  }
}

/** Runs the initial rules at `p`. Returns false when none matches. */
function lexerInitialRule(lexer: Lexer): boolean {
  const p = lexer.p
  const src = lexer.src
  const c = charAt(src, p)
  if (c === undefined) return false
  const width = c > 0xffff ? 2 : 1
  // The code unit after the first one at `p`: a low surrogate for a character outside the
  // Basic Multilingual Plane.
  const next = width === 2 ? 0xdc00 : byte(src, p + width)

  if (c === 37 && next === 37) {
    lexer.p = lexerLineEnd(lexer, p + 2)
    return true
  }
  // Mermaid's second comment rule takes any character before `%%` with it, a line break included.
  if (c !== 125 && next === 37 && byte(src, p + width + 1) === 0x25) {
    lexer.p = lexerLineEnd(lexer, p + width + 2)
    return true
  }
  if (c === 10 || c === 13) {
    let e = p + 1
    while (byte(src, e) === 10 || byte(src, e) === 13) e++
    lexerEmit(lexer, T.Newline, p, e)
    return true
  }

  const lower = c | 32
  if (lower === 116 && wordAt(src, p, 'title') && !isWord(byte(src, p + 5))) {
    lexerEmit(lexer, T.Title, p, p + 5)
    lexerPush(lexer, S.Title)
    return true
  }
  if (lower === 97 && wordAt(src, p, 'acc')) {
    const descr = wordAt(src, p + 3, 'descr')
    if (descr || wordAt(src, p + 3, 'title')) {
      const k = lexerRun(lexer, p + 8)
      const d = byte(src, k)
      if (d === 0x3a) {
        const end = lexerRun(lexer, k + 1)
        lexerEmit(lexer, descr ? T.AccDescr : T.AccTitle, p, end)
        lexerPush(lexer, descr ? S.AccDescr : S.AccTitle)
        return true
      }
      if (d === 0x7b && descr) {
        lexer.p = lexerRun(lexer, k + 1)
        lexerPush(lexer, S.AccDescrMultiline)
        return true
      }
    }
  }

  // Axis, quadrant and chart keywords and the axis arrow take the spaces around them.
  let j = p
  if (c === 32) {
    if (p < lexer.space0 || p >= lexer.space1) {
      lexer.space0 = p
      lexer.space1 = lexerSpaces(lexer, p)
    }
    j = lexer.space1
  }
  const d = byte(src, j)
  const dl = d | 32
  // The keyword found, and where it ends.
  let found: T | undefined
  let foundEnd = 0
  if (dl === 0x78 && wordAt(src, j, 'x-axis')) {
    found = T.XAxis
    foundEnd = j + 6
  } else if (dl === 0x79 && wordAt(src, j, 'y-axis')) {
    found = T.YAxis
    foundEnd = j + 6
  } else if (d === 0x2d) {
    if (j < lexer.dash0 || j >= lexer.dash1) {
      let to = j
      while (byte(src, to) === 0x2d) to++
      lexer.dash0 = j
      lexer.dash1 = to
    }
    if (lexer.dash1 - j >= 2 && byte(src, lexer.dash1) === 0x3e) {
      found = T.Delimiter
      foundEnd = lexer.dash1 + 1
    }
  } else if (dl === 0x71 && wordAt(src, j, 'quadrant')) {
    const q = byte(src, j + 9)
    if (byte(src, j + 8) === 0x2d && q >= 0x31 && q <= 0x34) {
      found = q === 0x31 ? T.Quadrant1 : q === 0x32 ? T.Quadrant2 : q === 0x33 ? T.Quadrant3 : T.Quadrant4
      foundEnd = j + 10
    } else if (wordAt(src, j + 8, 'chart')) {
      found = T.Quadrant
      foundEnd = j + 13
    }
  }
  if (found !== undefined) {
    const end = lexerSpaces(lexer, foundEnd)
    lexerEmit(lexer, found, p, end)
    return true
  }

  if (lower === 99 && wordAt(src, p, 'classdef') && !isWord(byte(src, p + 8))) {
    lexerEmit(lexer, T.Classdef, p, p + 8)
    return true
  }
  if (c === 34) {
    if (next === 96) {
      lexer.p += 2
      lexerPush(lexer, S.MdString)
    } else {
      lexer.p += 1
      lexerPush(lexer, S.String)
    }
    return true
  }
  if (c === 58 && next === 58 && byte(src, p + 2) === 0x3a) {
    lexer.p += 3
    lexerPush(lexer, S.ClassName)
    return true
  }
  // A point's `: [`, with any whitespace before, between and after, line breaks included.
  if (c === 58 || isSpace(c)) {
    let k = p
    if (c !== 58) {
      if (p < lexer.ws0 || p >= lexer.ws1) {
        lexer.ws0 = p
        lexer.ws1 = lexerRun(lexer, p)
      }
      k = lexer.ws1
    }
    if (byte(src, k) === 0x3a) {
      if (k + 1 < lexer.gap0 || k + 1 >= lexer.gap1) {
        lexer.gap0 = k + 1
        lexer.gap1 = lexerRun(lexer, k + 1)
      }
      if (byte(src, lexer.gap1) === 0x5b) {
        const end = lexerRun(lexer, lexer.gap1 + 1)
        lexerEmit(lexer, T.PointStart, p, end)
        lexerPush(lexer, S.PointStart)
        return true
      }
    }
  }

  if (isLetter(c)) {
    let e = p + 1
    while (isLetter(byte(src, e))) e++
    lexerEmit(lexer, T.Alpha, p, e)
    return true
  }
  if (c >= 128) {
    // Every unit of a character from U+0080 on is at least 0x80.
    let e = p
    while (e < src.length && charCodeAt.call(src, e) >= 128) e++
    lexerEmit(lexer, T.UnicodeText, p, e)
    return true
  }
  if (isDigit(c)) {
    let e = p + 1
    while (isDigit(byte(src, e))) e++
    lexerEmit(lexer, T.Num, p, e)
    return true
  }
  const t = single(c)
  if (t !== undefined) {
    lexerEmit(lexer, t, p, p + 1)
    return true
  }
  return false
}

/**
 * Produces the tokens of Mermaid's Jison lexer for quadrant charts. An unrecognized character
 * ends the list with an `Error` token. Otherwise the list ends with what the last state gives
 * for the empty rest of the input, then `End`.
 */
export function tokenize(src: string): Token[] {
  const n = src.length
  const lexer: Lexer = {
    dash0: 0,
    dash1: 0,
    gap0: 0,
    gap1: 0,
    p: 0,
    space0: 0,
    space1: 0,
    src,
    stack: [],
    state: S.Initial,
    tokens: [],
    ws0: 0,
    ws1: 0,
  }

  while (lexer.p < n) {
    const matched = lexerStateRule(lexer, byte(src, lexer.p)) ?? lexerInitialRule(lexer)
    if (!matched) break
  }

  const tokens = lexer.tokens
  if (lexer.p < n) {
    tokens.push({ end: lexer.p, start: lexer.p, t: T.Error })
    return tokens
  }
  // Jison tries the rules of the current state once more against the empty rest of the input.
  const t = sAtEnd(lexer.state)
  if (t !== undefined) tokens.push({ end: n, start: n, t })
  tokens.push({ end: n, start: n, t: T.End })
  return tokens
}
