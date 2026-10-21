/**
 * @module The requirement lexer: a state machine equivalent to Mermaid's Jison lexer. Port of
 * Pele's `src/diagrams/requirement/lexer.ts`.
 *
 * It reads UTF-16 code units, as Pele does. Every delimiter and keyword is ASCII, and the
 * characters `\s` tests are all in the Basic Multilingual Plane, so token boundaries match. Each
 * regular expression in Pele is a hand-written matcher below.
 */
import { T, keywordAt, tOffset } from './tokens.ts'
import { trim } from '../../text/label.ts'
import { isLineEnd, isSpace, isWord } from '../../util/chars.ts'

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
  /** The matched text. An unquoted string is trimmed. */
  text: string
}

/** Lexer start conditions, as in Mermaid's grammar. */
const S = {
  AccDescr: 'AccDescr',
  AccDescrMultiline: 'AccDescrMultiline',
  AccTitle: 'AccTitle',
  Initial: 'Initial',
  String: 'String',
  Style: 'Style',
} as const
type S = (typeof S)[keyof typeof S]

/** The longest keyword, in characters. */
const LONGEST_KEYWORD = 22

/** Characters that end an unquoted string: `:,{<>-=` and line breaks. */
function isStop(c: number): boolean {
  return (
    c === 0x3a || c === 0x2c || c === 0x0d || c === 0x0a || c === 0x7b || c === 0x3c || c === 0x3e || c === 0x2d || c === 0x3d
  )
}

/** The character at `at`, as a code point, or `undefined` past the end. */
function charAt(src: string, at: number): number | undefined {
  return at < src.length ? src.codePointAt(at) : undefined
}

/** The end of a run of JavaScript `\s` characters from `at`. */
function skipSpaces(src: string, at: number): number {
  let q = at
  while (q < src.length && isSpace(charCodeAt.call(src, q))) q += 1
  return q
}

/** The end of a run of `\w` characters from `at`. */
function wordEnd(src: string, at: number): number {
  const n = src.length
  let q = at
  while (q < n && isWord(charCodeAt.call(src, q))) q += 1
  return q
}

/** The first character from `at` that ends an unquoted string, or the end of `src`. */
function stopAt(src: string, at: number): number {
  const n = src.length
  let q = at
  while (q < n && !isStop(charCodeAt.call(src, q))) q += 1
  return q
}

/** Whether `src` at `at` spells the ASCII `word` in any case. */
function startsWithCi(src: string, at: number, word: string): boolean {
  const len = word.length
  if (at + len > src.length) return false
  for (let i = 0; i < len; i++) {
    const x = charCodeAt.call(src, at + i)
    const y = charCodeAt.call(word, i)
    if (x !== y && (x >= 65 && x <= 90 ? x + 32 : x) !== (y >= 65 && y <= 90 ? y + 32 : y)) return false
  }
  return true
}

/** `/<word>\s*<sep>\s*\/iy` at `at`: the end of the match. */
function acc(src: string, at: number, word: string, sep: number): number | undefined {
  if (!startsWithCi(src, at, word)) return undefined
  const q = skipSpaces(src, at + word.length)
  if (src.charCodeAt(q) !== sep) return undefined
  return skipSpaces(src, q + 1)
}

/** The direction pairs, in the order they are tried. */
const DIRECTION_PAIRS: readonly string[] = ['TB', 'BT', 'RL', 'LR']

/**
 * The statements `/direction\s+(?:(TB)|(BT)|(RL)|LR)/gi` matches, scanned left to right: where
 * each kind starts and where its keyword ends.
 */
function directions(src: string): [number[], number[]][] {
  const found: [number[], number[]][] = [
    [[], []],
    [[], []],
    [[], []],
    [[], []],
  ]
  const n = src.length
  // Only `d` and `D` lower-case to `d`, so the scan jumps between them.
  let lowerD = src.indexOf('d')
  let upperD = src.indexOf('D')
  let at = 0
  while (at < n) {
    if (lowerD >= 0 && lowerD < at) lowerD = src.indexOf('d', at)
    if (upperD >= 0 && upperD < at) upperD = src.indexOf('D', at)
    if (lowerD < 0 && upperD < 0) break
    at = lowerD < 0 ? upperD : upperD < 0 ? lowerD : Math.min(lowerD, upperD)
    if (startsWithCi(src, at, 'direction')) {
      const q = skipSpaces(src, at + 9)
      if (q !== at + 9 && q + 2 <= n) {
        let kind = -1
        for (let k = 0; k < DIRECTION_PAIRS.length; k++) {
          if (startsWithCi(src, q, DIRECTION_PAIRS[k] as string)) {
            kind = k
            break
          }
        }
        if (kind >= 0) {
          const entry = found[kind] as [number[], number[]]
          const end = q + 2
          entry[0].push(at)
          entry[1].push(end)
          at = end
          continue
        }
      }
    }
    at += 1
  }
  return found
}

/**
 * Produces the token stream of Mermaid's requirement lexer. Its rules are tried in order and the
 * first match wins, so a line that holds a direction statement anywhere is one token.
 */
export function tokenize(src: string): Token[] {
  const n = src.length
  const tokens: Token[] = []
  const stack: S[] = []
  let state: S = S.Initial
  let p = 0

  // Where each kind of direction statement starts and where its keyword ends, found in one pass.
  const dirs = directions(src)
  const anyDir = dirs.some(([starts]) => starts.length > 0)
  const dirSeen = [0, 0, 0, 0]
  let lineEnd: number | undefined

  const at = (i: number): number | undefined => (i < n ? src.charCodeAt(i) : undefined)
  const lineBreak = (q: number): number => {
    const e = src.indexOf('\n', q)
    return e < 0 ? n : e
  }
  const emit = (kind: T, s: number, e: number): number => {
    tokens.push({ kind, start: s, text: src.slice(s, e) })
    return e
  }

  while (p < n) {
    const c = charCodeAt.call(src, p)
    let ok: boolean
    switch (state) {
      case S.Initial:
        ok = initial(c)
        break
      case S.Style:
        ok = style(c)
        break
      case S.String: {
        if (c === 0x22) {
          const previous = stack.pop()
          if (previous !== undefined) state = previous
          p += 1
        } else {
          const e = src.indexOf('"', p)
          p = emit(T.QString, p, e < 0 ? n : e)
        }
        ok = true
        break
      }
      case S.AccTitle:
      case S.AccDescr: {
        const kind = state === S.AccTitle ? T.AccTitleValue : T.AccDescrValue
        const previous = stack.pop()
        if (previous !== undefined) state = previous
        p = emit(kind, p, lineBreak(p))
        ok = true
        break
      }
      case S.AccDescrMultiline: {
        if (c === 0x7d) {
          const previous = stack.pop()
          if (previous !== undefined) state = previous
          p += 1
        } else {
          const e = src.indexOf('}', p)
          p = emit(T.AccDescrMultilineValue, p, e < 0 ? n : e)
        }
        ok = true
        break
      }
    }
    if (!ok) {
      tokens.push({ kind: T.Error, start: p, text: '' })
      return tokens
    }
  }

  // At the end of input Jison still tries the rules that can match nothing, once.
  let last: T | undefined
  switch (state as S) {
    case S.Initial:
      last = T.Eof
      break
    case S.String:
      last = T.QString
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
    case S.Style:
      last = undefined
      break
  }
  if (last !== undefined) emit(last, n, n)
  emit(T.End, n, n)
  return tokens

  function initial(c: number): boolean {
    const lower = c | 32
    if (lower === 0x74 && startsWithCi(src, p + 1, 'itle')) {
      const space = charAt(src, p + 5)
      if (space !== undefined && isSpace(space)) {
        const from = p + 5 + (space > 0xffff ? 2 : 1)
        let q = from
        for (;;) {
          const d = at(q)
          if (d === undefined || d === 0x23 || d === 0x0a || d === 0x3b) break
          q += 1
        }
        if (q > from) {
          p = emit(T.Title, p, q)
          return true
        }
      }
    }
    if (lower === 0x61 && ((at(p + 1) ?? 0) | 32) === 0x63 && ((at(p + 2) ?? 0) | 32) === 0x63) {
      let e = acc(src, p, 'accTitle', 0x3a)
      if (e !== undefined) {
        stack.push(state)
        state = S.AccTitle
        p = emit(T.AccTitle, p, e)
        return true
      }
      e = acc(src, p, 'accDescr', 0x3a)
      if (e !== undefined) {
        stack.push(state)
        state = S.AccDescr
        p = emit(T.AccDescr, p, e)
        return true
      }
      e = acc(src, p, 'accDescr', 0x7b)
      if (e !== undefined) {
        stack.push(state)
        state = S.AccDescrMultiline
        p = e
        return true
      }
    }
    const here = charAt(src, p)
    if (anyDir && !(here !== undefined && isLineEnd(here))) {
      // `.*direction\s+XX[^\n]*`: the last such statement that starts on this line decides the
      // token.
      if (lineEnd === undefined || lineEnd < p) {
        let end = n
        for (let q = p; q < n; q++) {
          if (isLineEnd(charCodeAt.call(src, q))) {
            end = q
            break
          }
        }
        lineEnd = end
        for (let k = 0; k < dirs.length; k++) {
          const starts = (dirs[k] as [number[], number[]])[0]
          let seen = dirSeen[k] as number
          while (seen < starts.length && (starts[seen] as number) <= end) seen += 1
          dirSeen[k] = seen
        }
      }
      let found: [number, number] | undefined
      for (let k = 0; k < dirs.length; k++) {
        const seen = dirSeen[k] as number
        if (seen === 0) continue
        const j = seen - 1
        const [starts, ends] = dirs[k] as [number[], number[]]
        const start = starts[j]
        const end = ends[j]
        if (start === undefined || end === undefined) continue
        if (start >= p) {
          found = [k, end]
          break
        }
      }
      if (found !== undefined) {
        const [k, end] = found
        p = emit(tOffset(T.DirectionTb, k), p, lineBreak(end))
        return true
      }
    }

    if (c === 0x0a || (c === 0x0d && at(p + 1) === 0x0a)) {
      let q = p
      for (;;) {
        const d = at(q)
        if (d === 0x0a) q += 1
        else if (d === 0x0d && at(q + 1) === 0x0a) q += 2
        else break
      }
      p = emit(T.Newline, p, q)
      return true
    }
    if (isSpace(c)) {
      p = skipSpaces(src, p)
      return true
    }
    if (c === 0x23 || c === 0x25) {
      p = lineBreak(p)
      return true
    }

    if (isWord(c)) {
      const start = p
      const q = wordEnd(src, start + 1)
      if (q - start <= LONGEST_KEYWORD) {
        const kind = keywordAt(src, start, q)
        if (kind !== undefined) {
          if (kind === T.Style || kind === T.Classdef || kind === T.Class) {
            stack.push(state)
            state = S.Style
          }
          p = emit(kind, p, q)
          return true
        }
      }
      const e = stopAt(src, q)
      tokens.push({ kind: T.UnqString, start, text: trim(src.slice(start, e)) })
      p = e
      return true
    }

    switch (c) {
      case 0x7b:
        p = emit(T.StructStart, p, p + 1)
        break
      case 0x7d:
        p = emit(T.StructStop, p, p + 1)
        break
      case 0x3a:
        p =
          at(p + 1) === 0x3a && at(p + 2) === 0x3a
            ? emit(T.StyleSeparator, p, p + 3)
            : emit(T.Colonsep, p, p + 1)
        break
      case 0x3c:
        if (at(p + 1) !== 0x2d) return false
        p = emit(T.EndArrowL, p, p + 2)
        break
      case 0x2d:
        p = at(p + 1) === 0x3e ? emit(T.EndArrowR, p, p + 2) : emit(T.Line, p, p + 1)
        break
      case 0x22:
        stack.push(state)
        state = S.String
        p += 1
        break
      case 0x2c:
        p = emit(T.Comma, p, p + 1)
        break
      default:
        return false
    }
    return true
  }

  function style(c: number): boolean {
    if (isWord(c)) {
      p = emit(T.Alpha, p, wordEnd(src, p + 1))
      return true
    }
    let single: T | undefined
    switch (c) {
      case 0x3a:
        single = T.Colon
        break
      case 0x3b:
        single = T.Semicolon
        break
      case 0x25:
        single = T.Percent
        break
      case 0x2d:
        single = T.Minus
        break
      case 0x23:
        single = T.Brkt
        break
      case 0x2c:
        single = T.Comma
        break
    }
    if (single !== undefined) {
      p = emit(single, p, p + 1)
      return true
    }
    switch (c) {
      case 0x20:
        p += 1
        return true
      case 0x22:
        stack.push(state)
        state = S.String
        p += 1
        return true
      case 0x0a: {
        const previous = stack.pop()
        if (previous !== undefined) state = previous
        p += 1
        return true
      }
      default:
        return false
    }
  }
}
