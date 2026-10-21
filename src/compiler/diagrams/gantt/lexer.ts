/**
 * @module Splits gantt source into tokens with Mermaid's lexer rules. Port of Pele's
 * `src/diagrams/gantt/lexer.ts`.
 *
 * The Rust crate reads UTF-8 bytes and decodes a character whole where a rule looks at one; this
 * port reads UTF-16 units and decodes a character outside the BMP whole in the same places.
 */
import { T, WEEKDAYS } from './tokens.ts'
import { isDigit, isSpace, isWord } from '../../util/chars.ts'
import { startsWithIgnoreAsciiCase } from '../../util/rust.ts'

/** A token: its kind, text, and UTF-16 offset in the source. */
export type Token = {
  /** Where the token starts. */
  start: number
  /** The token's text. */
  text: string
  /** The token's kind. */
  type: T
}

/** Lexer states, as the grammar names them. */
const S = {
  /** After `accDescr:`. */
  AccDescr: 'AccDescr',
  /** Inside `accDescr { ... }`. */
  AccDescrMultiline: 'AccDescrMultiline',
  /** After `accTitle:`. */
  AccTitle: 'AccTitle',
  /** Inside the parentheses of a callback. */
  Callbackargs: 'Callbackargs',
  /** After `call`. */
  Callbackname: 'Callbackname',
  /** After `click`. */
  Click: 'Click',
  /** Inside `href "..."`. */
  Href: 'Href',
  /** Between statements. */
  Initial: 'Initial',
} as const
type S = (typeof S)[keyof typeof S]

/** The weekday names, from Monday. */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** What follows a keyword: `\b`, or one `\s` and then text up to one of the stop characters. */
type Tail =
  /** A word boundary. */
  | { kind: 'Bound' }
  /** Text up to one of the given characters. */
  | { kind: 'Text'; _0: string }

const BOUND: Tail = { kind: 'Bound' }

/** Keyword statements by their first letter, in the grammar's rule order. */
const KEYWORDS: [number, string, Tail, T][] = [
  [0x61, 'axisFormat', { kind: 'Text', _0: '#\n;' }, T.AxisFormat],
  [0x61, 'accDescription', { kind: 'Text', _0: '#\n;' }, T.AccDescription],
  [0x67, 'gantt', BOUND, T.Gantt],
  [0x64, 'dateFormat', { kind: 'Text', _0: '#\n;' }, T.DateFormat],
  [0x69, 'inclusiveEndDates', BOUND, T.InclusiveEndDates],
  [0x69, 'includes', { kind: 'Text', _0: '#\n;' }, T.Includes],
  [0x74, 'topAxis', BOUND, T.TopAxis],
  [0x74, 'tickInterval', { kind: 'Text', _0: '#\n;' }, T.TickInterval],
  [0x74, 'todayMarker', { kind: 'Text', _0: '\n;' }, T.TodayMarker],
  [0x74, 'title', { kind: 'Text', _0: '\n' }, T.Title],
  [0x65, 'excludes', { kind: 'Text', _0: '#\n;' }, T.Excludes],
  [0x73, 'section', { kind: 'Text', _0: '\n' }, T.Section],
]

/** The source being read. */
type Lexer = {
  /** The current UTF-16 offset. */
  p: number
  /** The source. */
  src: string
  /** The lexer state. */
  state: S
  /** The tokens read so far. */
  tokens: Token[]
}

/** The code point at `at`, or `undefined` past the end. */
function charAt(lx: Lexer, at: number): number | undefined {
  return at < lx.src.length ? lx.src.codePointAt(at) : undefined
}

/** The UTF-16 length of code point `c`. */
function charLen(c: number): number {
  return c > 0xffff ? 2 : 1
}

/** The code unit at `at`, or `undefined` past the end. */
function byte(lx: Lexer, at: number): number | undefined {
  return at < lx.src.length ? lx.src.charCodeAt(at) : undefined
}

/** Adds a token from `start` to `end` and moves past it. */
function emit(lx: Lexer, type: T, start: number, end: number): void {
  lx.tokens.push({ start, text: lx.src.slice(start, end), type })
  lx.p = end
}

/** The offset of the next `c` from `from`, or the end. */
function until(lx: Lexer, c: string, from: number): number {
  const at = lx.src.indexOf(c, from)
  return at < 0 ? lx.src.length : at
}

/** The end of a run of `\s` from `at`. */
function spaces(lx: Lexer, from: number): number {
  let at = from
  // Every `\s` character is a single UTF-16 unit.
  while (at < lx.src.length && isSpace(lx.src.charCodeAt(at))) at++
  return at
}

/** Whether `word` is at `at`, ignoring ASCII case: the end of it. */
function word(lx: Lexer, at: number, w: string): number | undefined {
  return startsWithIgnoreAsciiCase(lx.src, w, at) ? at + w.length : undefined
}

/** Whether `at` is a word boundary after a word character: the next one is not `\w`. */
function bound(lx: Lexer, at: number): boolean {
  const b = byte(lx, at)
  return !(b !== undefined && isWord(b))
}

/** `word\s*` followed by `c` and `\s*`, as the accessibility rules match. */
function wordThen(lx: Lexer, w: string, c: number): number | undefined {
  const after = word(lx, lx.p, w)
  if (after === undefined) return undefined
  const at = spaces(lx, after)
  return byte(lx, at) === c ? spaces(lx, at + 1) : undefined
}

/** `word\s+`, and the character that must follow when `next` is given. */
function wordSpaces(lx: Lexer, w: string, next: number | undefined): number | undefined {
  const after = word(lx, lx.p, w)
  if (after === undefined) return undefined
  const at = spaces(lx, after)
  if (at === after) {
    return undefined
  }
  if (next === undefined) return at
  return byte(lx, at) === next ? at + 1 : undefined
}

/** One of `names` after `word\s+`, followed by `\b`: the end and the index of the name. */
function wordChoice(lx: Lexer, w: string, names: string[]): [number, number] | undefined {
  const after = word(lx, lx.p, w)
  if (after === undefined) return undefined
  const at = spaces(lx, after)
  if (at === after) {
    return undefined
  }
  for (let index = 0; index < names.length; index++) {
    const end = word(lx, at, names[index] as string)
    if (end !== undefined && bound(lx, end)) return [end, index]
  }
  return undefined
}

/** Whether code unit `c` is one of the code units of `stops`. */
function isStop(stops: string, c: number): boolean {
  for (let j = 0; j < stops.length; j++) {
    if (stops.charCodeAt(j) === c) return true
  }
  return false
}

/** Reads a keyword statement starting with `c`. Whether one matched. */
function keyword(lx: Lexer, c: number): boolean {
  const lower = c | 32
  switch (lower) {
    case 0x61: {
      let e = wordThen(lx, 'accTitle', 0x3a)
      if (e !== undefined) {
        lx.state = S.AccTitle
        emit(lx, T.AccTitle, lx.p, e)
        return true
      }
      e = wordThen(lx, 'accDescr', 0x3a)
      if (e !== undefined) {
        lx.state = S.AccDescr
        emit(lx, T.AccDescr, lx.p, e)
        return true
      }
      e = wordThen(lx, 'accDescr', 0x7b)
      if (e !== undefined) {
        lx.state = S.AccDescrMultiline
        lx.p = e
        return true
      }
      break
    }
    case 0x68: {
      const e = wordSpaces(lx, 'href', 0x22)
      if (e !== undefined) {
        lx.state = S.Href
        lx.p = e
        return true
      }
      break
    }
    case 0x63: {
      let e = wordSpaces(lx, 'call', undefined)
      if (e !== undefined) {
        lx.state = S.Callbackname
        lx.p = e
        return true
      }
      e = wordSpaces(lx, 'click', undefined)
      if (e !== undefined) {
        lx.state = S.Click
        lx.p = e
        return true
      }
      break
    }
    case 0x77: {
      let found = wordChoice(lx, 'weekday', DAYS)
      if (found !== undefined) {
        const kind = WEEKDAYS[found[1]] ?? T.WeekdayMonday
        emit(lx, kind, lx.p, found[0])
        return true
      }
      found = wordChoice(lx, 'weekend', ['friday', 'saturday'])
      if (found !== undefined) {
        const kind = found[1] === 0 ? T.WeekendFriday : T.WeekendSaturday
        emit(lx, kind, lx.p, found[0])
        return true
      }
      break
    }
    default:
      break
  }

  for (const [first, w, tail, kind] of KEYWORDS) {
    if (first !== lower) {
      continue
    }
    const after = word(lx, lx.p, w)
    if (after === undefined) {
      continue
    }
    let end: number | undefined
    if (tail.kind === 'Bound') {
      end = bound(lx, after) ? after : undefined
    } else {
      // One `\s`, then one or more characters other than `stops`.
      const space = charAt(lx, after)
      if (space === undefined || !isSpace(space)) {
        continue
      }
      const from = after + charLen(space)
      let stop = lx.src.length
      const stops = tail._0
      for (let i = from; i < lx.src.length; i++) {
        if (isStop(stops, lx.src.charCodeAt(i))) {
          stop = i
          break
        }
      }
      const length = stop - from
      end = length > 0 ? from + length : undefined
    }
    if (end !== undefined) {
      emit(lx, kind, lx.p, end)
      return true
    }
  }
  return false
}

/** A `\d\d\d\d-\d\d-\d\d\b` date at the current position. */
function date(lx: Lexer): boolean {
  const digit = (at: number): boolean => {
    const b = byte(lx, at)
    return b !== undefined && isDigit(b)
  }
  const p = lx.p
  return (
    digit(p) &&
    digit(p + 1) &&
    digit(p + 2) &&
    digit(p + 3) &&
    byte(lx, p + 4) === 0x2d &&
    digit(p + 5) &&
    digit(p + 6) &&
    byte(lx, p + 7) === 0x2d &&
    digit(p + 8) &&
    digit(p + 9) &&
    bound(lx, p + 10)
  )
}

/** Reads in the initial state. Whether lexing must stop. */
function initial(lx: Lexer): boolean {
  const p = lx.p
  const c = charAt(lx, p)
  if (c === undefined) {
    return false
  }
  const len = charLen(c)
  // The UTF-16 unit after `c`: the second half of a surrogate pair is never `%`.
  const d = len === 2 ? undefined : byte(lx, p + len)

  if (c === 0x25) {
    if (d !== 0x25) {
      let e = until(lx, '\n', p + 1)
      while (byte(lx, e) === 0x0a) {
        e += 1
      }
      lx.p = e
    } else if (byte(lx, p + 2) === 0x7b) {
      // The grammar enters a lexer state it never defines, so nothing can follow.
      emit(lx, T.OpenDirective, p, p + 3)
      emit(lx, T.Error, p, p)
      return true
    } else {
      lx.p = until(lx, '\n', p + 2)
    }
  } else if (c !== 0x7d && d === 0x25) {
    // Any character but `}` followed by `%` starts a comment that runs to the end of the line.
    lx.p = until(lx, '\n', p + len + 1)
  } else if (c === 0x0a) {
    let e = p + 1
    while (byte(lx, e) === 0x0a) {
      e += 1
    }
    emit(lx, T.Nl, p, e)
  } else if (isSpace(c)) {
    lx.p = spaces(lx, p)
  } else if (c < 256 && keyword(lx, c)) {
    // The keyword rule emitted its token.
  } else if (isDigit(c) && date(lx)) {
    emit(lx, T.Date, p, p + 10)
  } else if (c !== 0x3a) {
    let e = lx.src.length
    for (let i = p + len; i < lx.src.length; i++) {
      const b = lx.src.charCodeAt(i)
      if (b === 0x3a || b === 0x0a) {
        e = i
        break
      }
    }
    emit(lx, T.TaskTxt, p, e)
  } else {
    let e = lx.src.length
    for (let i = p + 1; i < lx.src.length; i++) {
      const b = lx.src.charCodeAt(i)
      if (b === 0x23 || b === 0x0a || b === 0x3b) {
        e = i
        break
      }
    }
    emit(lx, e > p + 1 ? T.TaskData : T.Colon, p, e)
  }
  return false
}

/** Splits `src` into tokens, ending with an `End` token. */
export function tokenize(src: string): Token[] {
  const n = src.length
  const lx: Lexer = { p: 0, src, state: S.Initial, tokens: [] }

  for (;;) {
    if (lx.p >= n) {
      let type: T
      switch (lx.state) {
        case S.AccTitle:
          type = T.AccTitleValue
          break
        case S.AccDescr:
          type = T.AccDescrValue
          break
        case S.AccDescrMultiline:
          type = T.AccDescrMultilineValue
          break
        case S.Href:
          type = T.Href
          break
        case S.Callbackname:
          type = T.Callbackname
          break
        case S.Callbackargs:
          type = T.Callbackargs
          break
        case S.Click:
          type = T.Click
          break
        case S.Initial:
          type = T.Eof
          break
      }
      emit(lx, type, n, n)
      break
    }

    const p = lx.p
    const c = charAt(lx, p) ?? 0
    switch (lx.state) {
      case S.Initial:
        if (initial(lx)) {
          return lx.tokens
        }
        break
      case S.AccTitle:
      case S.AccDescr: {
        const type = lx.state === S.AccTitle ? T.AccTitleValue : T.AccDescrValue
        lx.state = S.Initial
        const e = until(lx, '\n', p)
        emit(lx, type, p, e)
        break
      }
      case S.AccDescrMultiline:
        if (c === 0x7d) {
          lx.state = S.Initial
          lx.p += 1
        } else {
          const e = until(lx, '}', p)
          emit(lx, T.AccDescrMultilineValue, p, e)
        }
        break
      case S.Href:
        if (c === 0x22) {
          lx.state = S.Initial
          lx.p += 1
        } else {
          const e = until(lx, '"', p)
          emit(lx, T.Href, p, e)
        }
        break
      case S.Callbackname:
        if (c === 0x28) {
          const close = spaces(lx, p + 1)
          if (byte(lx, close) === 0x29) {
            lx.state = S.Initial
            lx.p = close + 1
          } else {
            lx.state = S.Callbackargs
            lx.p += 1
          }
        } else {
          const e = until(lx, '(', p)
          emit(lx, T.Callbackname, p, e)
        }
        break
      case S.Callbackargs:
        if (c === 0x29) {
          lx.state = S.Initial
          lx.p += 1
        } else {
          const e = until(lx, ')', p)
          emit(lx, T.Callbackargs, p, e)
        }
        break
      case S.Click:
        if (isSpace(c)) {
          lx.state = S.Initial
          lx.p += charLen(c)
        } else {
          let e = p + charLen(c)
          for (;;) {
            const ch = charAt(lx, e)
            if (ch === undefined || isSpace(ch)) break
            e += charLen(ch)
          }
          emit(lx, T.Click, p, e)
        }
        break
    }
  }

  lx.tokens.push({ start: n, text: '', type: T.End })
  return lx.tokens
}
