/**
 * @module The XY chart lexer. Port of Pele's `src/diagrams/xychart/lexer.ts`.
 *
 * Pele reads UTF-16 code units, and so does this port. Every delimiter is ASCII, a non-ASCII
 * character is decoded whole wherever a rule tests it, and a character outside the Basic
 * Multilingual Plane counts as the two units a rule would see in JavaScript.
 */
import { T } from './tokens.ts'
import { wordAt } from '../common/caseless.ts'
import { isDigit, isLetter, isSpace, isWord } from '../../util/chars.ts'

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
  Initial: 'Initial',
  AxisData: 'AxisData',
  AxisBandData: 'AxisBandData',
  Data: 'Data',
  DataInner: 'DataInner',
  String: 'String',
  AccTitle: 'AccTitle',
  AccDescr: 'AccDescr',
  AccDescrMultiline: 'AccDescrMultiline',
} as const
type S = (typeof S)[keyof typeof S]

/** The token the state gives for the empty rest of the input. */
function sAtEnd(state: S): T {
  switch (state) {
    case S.String:
      return T.Str
    case S.AccTitle:
      return T.AccTitleValue
    case S.AccDescr:
      return T.AccDescrValue
    case S.AccDescrMultiline:
      return T.AccDescrMultilineValue
    default:
      return T.Eof
  }
}

/**
 * Mermaid's grammar means to open a markdown string at `"` followed by a backtick, but its
 * quoting turns the rule into one that matches this text and leaves the current state. Markdown
 * strings are never read.
 */
const BROKEN_RULE: string =
  '`)' +
  '                                    ' +
  '{ this.pushstate(md_string); }\n<md_string>(?:(?!`").)+' +
  '                  ' +
  '{ return md_str; }\n<md_string>(?:`'

/** The token of a one-character ASCII rule. */
function single(c: number): T | undefined {
  switch (c) {
    case 58:
      return T.Colon
    case 43:
      return T.Plus
    case 44:
      return T.Comma
    case 61:
      return T.Equals
    case 42:
      return T.Mult
    case 35:
      return T.Brkt
    case 95:
      return T.Underscore
    case 46:
      return T.Dot
    case 38:
      return T.Amp
    case 45:
      return T.Minus
    case 59:
      return T.Semi
    default:
      return undefined
  }
}

/** The code point at `at`, or `undefined` at the end. */
function charAt(src: string, at: number): number | undefined {
  return at < src.length ? (src.codePointAt(at) as number) : undefined
}

/** The code unit at `at`, or 0 at the end. */
function byte(src: string, at: number): number {
  return at < src.length ? src.charCodeAt(at) : 0
}

/** The end of the run of `\s` at `q`. */
function run(src: string, q: number): number {
  // Every `\s` character is in the Basic Multilingual Plane.
  while (q < src.length && isSpace(src.charCodeAt(q))) q++
  return q
}

/** The end of the run of ASCII digits at `q`. */
function digits(src: string, q: number): number {
  while (isDigit(byte(src, q))) q++
  return q
}

/** Where the next `needle` is from `from`, or the end. */
function upTo(src: string, from: number, needle: string): number {
  const at = src.indexOf(needle, from)
  return at < 0 ? src.length : at
}

/**
 * Produces the tokens of Mermaid's Jison lexer for XY charts. An unrecognized character ends the
 * list with an `Error` token. Otherwise the list ends with what the last state gives for the
 * empty rest of the input, then `End`.
 */
export function tokenize(src: string): Token[] {
  const n = src.length
  const tokens: Token[] = []
  const stack: S[] = []
  let state: S = S.Initial
  let p = 0

  const emit = (t: T, start: number, end: number): number => {
    tokens.push({ end, start, t })
    return end
  }
  const pop = (): void => {
    const previous = stack.pop()
    if (previous !== undefined) state = previous
  }
  const keyword = (p: number, word: string): boolean => wordAt(src, p, word) && !isWord(byte(src, p + word.length))

  while (p < n) {
    const c = charAt(src, p)
    if (c === undefined) break
    const width = c > 0xffff ? 2 : 1

    if (state === S.String) {
      if (c === 34) {
        p += 1
        pop()
      } else {
        p = emit(T.Str, p, upTo(src, p, '"'))
      }
      continue
    }
    if (state === S.AccTitle || state === S.AccDescr) {
      p = emit(sAtEnd(state), p, upTo(src, p, '\n'))
      pop()
      continue
    }
    if (state === S.AccDescrMultiline) {
      if (c === 125) {
        p += 1
        pop()
      } else {
        p = emit(T.AccDescrMultilineValue, p, upTo(src, p, '}'))
      }
      continue
    }

    // The code unit after the first one at `p`: a low surrogate for a character outside the
    // Basic Multilingual Plane.
    const next = width === 2 ? 0xdc00 : byte(src, p + width)
    if (c === 37 && next === 37) {
      p = upTo(src, p + 2, '\n')
      continue
    }
    // Mermaid's second comment rule takes any character before `%%` with it, a line break included.
    if (c !== 125 && next === 37 && byte(src, p + width + 1) === 0x25) {
      p = upTo(src, p + width + 2, '\n')
      continue
    }
    if (c === 10 || c === 13) {
      // Only a line break that directly follows an axis or a series ends it. One after
      // spaces is skipped with them, and the state carries on to the next line.
      if ((state === S.AxisData || state === S.Data) && (c === 10 || next === 10)) {
        p = emit(T.Newline, p, c === 10 ? p + 1 : p + 2)
        pop()
        continue
      }
      let e = p + 1
      while (byte(src, e) === 10 || byte(src, e) === 13) e++
      p = emit(T.Newline, p, e)
      continue
    }

    let matched = false
    switch (c | 32) {
      case 116:
        if (keyword(p, 'title')) {
          p = emit(T.Title, p, p + 5)
          matched = true
        }
        break
      case 97:
        if (wordAt(src, p, 'acc')) {
          const descr = wordAt(src, p + 3, 'descr')
          if (descr || wordAt(src, p + 3, 'title')) {
            const k = run(src, p + 8)
            const d = byte(src, k)
            if (d === 0x3a) {
              const t = descr ? T.AccDescr : T.AccTitle
              p = emit(t, p, run(src, k + 1))
              stack.push(state)
              state = descr ? S.AccDescr : S.AccTitle
              matched = true
            } else if (d === 0x7b && descr) {
              p = run(src, k + 1)
              stack.push(state)
              state = S.AccDescrMultiline
              matched = true
            }
          }
        }
        break
      case 120:
        if (keyword(p, 'xychart-beta')) {
          p = emit(T.Xychart, p, p + 12)
          matched = true
        } else if (keyword(p, 'xychart')) {
          p = emit(T.Xychart, p, p + 7)
          matched = true
        } else if (keyword(p, 'x-axis')) {
          p = emit(T.XAxis, p, p + 6)
          stack.push(state)
          state = S.AxisData
          matched = true
        }
        break
      case 121:
        if (keyword(p, 'y-axis')) {
          p = emit(T.YAxis, p, p + 6)
          stack.push(state)
          state = S.AxisData
          matched = true
        }
        break
      case 118:
        if (wordAt(src, p, 'vertical')) {
          p = emit(T.ChartOrientation, p, p + 8)
          matched = true
        }
        break
      case 104:
        if (wordAt(src, p, 'horizontal')) {
          p = emit(T.ChartOrientation, p, p + 10)
          matched = true
        }
        break
      case 108:
        if (keyword(p, 'line')) {
          p = emit(T.Line, p, p + 4)
          stack.push(state)
          state = S.Data
          matched = true
        }
        break
      case 98:
        if (keyword(p, 'bar')) {
          p = emit(T.Bar, p, p + 3)
          stack.push(state)
          state = S.Data
          matched = true
        }
        break
    }
    if (matched) continue

    if (c === 91) {
      if (state === S.AxisData) {
        stack.push(state)
        state = S.AxisBandData
      } else if (state === S.Data) {
        stack.push(state)
        state = S.DataInner
      }
      p = emit(T.SquareBracesStart, p, p + 1)
      continue
    }
    if (c === 93) {
      if (state === S.DataInner || state === S.AxisBandData) pop()
      p = emit(T.SquareBracesEnd, p, p + 1)
      continue
    }
    if (state === S.AxisData && c === 45 && next === 45 && byte(src, p + 2) === 0x3e) {
      p = emit(T.ArrowDelimiter, p, p + 3)
      continue
    }
    if (state === S.AxisData || state === S.DataInner) {
      const q = c === 43 || c === 45 ? p + 1 : p
      const d = byte(src, q)
      let end: number | undefined
      if (isDigit(d)) {
        let e = digits(src, q + 1)
        if (byte(src, e) === 0x2e && isDigit(byte(src, e + 1))) e = digits(src, e + 2)
        end = e
      } else if (d === 0x2e && isDigit(byte(src, q + 1))) {
        end = digits(src, q + 2)
      }
      if (end !== undefined) {
        p = emit(T.NumberWithDecimal, p, end)
        continue
      }
    }
    if (c === 96 && wordAt(src, p, BROKEN_RULE)) {
      p += BROKEN_RULE.length
      pop()
      continue
    }
    if (c === 34) {
      p += 1
      stack.push(state)
      state = S.String
      continue
    }
    if (isLetter(c)) {
      let e = p + 1
      while (isLetter(byte(src, e))) e++
      p = emit(T.Alpha, p, e)
      continue
    }
    if (isDigit(c)) {
      p = emit(T.Num, p, digits(src, p + 1))
      continue
    }
    if (isSpace(c)) {
      p = run(src, p + width)
      continue
    }
    const t = single(c)
    if (t !== undefined) {
      p = emit(t, p, p + 1)
      continue
    }
    break
  }

  if (p < n) {
    tokens.push({ end: p, start: p, t: T.Error })
    return tokens
  }
  // Jison tries the rules of the current state once more against the empty rest of the input.
  tokens.push({ end: n, start: n, t: sAtEnd(state) })
  tokens.push({ end: n, start: n, t: T.End })
  return tokens
}
