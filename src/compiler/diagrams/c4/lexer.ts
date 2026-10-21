/**
 * @module The C4 lexer. Port of Pele's `src/diagrams/c4/lexer.ts`.
 *
 * Pele reads UTF-16 code units, as this port does. Every delimiter is ASCII, and every character
 * `\s` matches is in the Basic Multilingual Plane, so stepping over UTF-16 units where `\s` looks
 * finds the same token boundaries as the Rust crate's whole characters.
 */
import { isLineEnd, isSpace, isWord } from '../../util/chars.ts'
import { T, tKeyword } from './tokens.ts'

/** A token: its kind and its UTF-16 span. Its text is the source between them. */
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
  Struct: 1,
  Attribute: 2,
  String: 3,
  StringKv: 4,
  StringKvKey: 5,
  StringKvValue: 6,
  Acc: 7,
  AccDescrMultiline: 8,
} as const
type S = (typeof S)[keyof typeof S]

/** The `direction` statements, in the order Mermaid's rules try them. */
const DIRECTIONS: readonly [string, T][] = [
  ['TB', T.DirectionTb],
  ['BT', T.DirectionBt],
  ['RL', T.DirectionRl],
  ['LR', T.DirectionLr],
]

/** The UTF-16 unit at `at`, or 0 at the end. */
function byte(src: string, at: number): number {
  return at < src.length ? src.charCodeAt(at) : 0
}

/** The end of the run of `\s` at `q`. */
function skipWs(src: string, q: number): number {
  while (q < src.length && isSpace(src.charCodeAt(q))) q += 1
  return q
}

/** Where the next `needle` is from `from`, or the end. */
function upTo(src: string, from: number, needle: string): number {
  if (from > src.length) return src.length
  const at = src.indexOf(needle, from)
  return at < 0 ? src.length : at
}

/**
 * Mermaid's `/.*direction\s+XX[^\n]*\/y` at `p`, where `lineEnd` is the first line terminator
 * from `p`: the end of the match, or `undefined`. The greedy `.*` takes the last `direction`
 * before the line ends that matches.
 */
function direction(src: string, p: number, lineEnd: number, word: string): number | undefined {
  if (p > lineEnd || lineEnd > src.length) return undefined
  const line = src.slice(p, lineEnd)
  const starts: number[] = []
  for (let at = line.indexOf('direction'); at >= 0; at = line.indexOf('direction', at + 9)) {
    starts.push(p + at)
  }
  while (starts.length > 0) {
    const start = starts.pop() as number
    const gap = start + 9
    const after = skipWs(src, gap)
    if (after > gap && src.startsWith(word, after)) {
      return upTo(src, after + word.length, '\n')
    }
  }
  return undefined
}

/**
 * What the search for `direction` statements has found so far, so that the rest of the input
 * is searched once, and each line at most once.
 */
type Directions = {
  /** Whether no `direction` is left. */
  done: boolean
  /** Before this offset, no direction statement can start. */
  failed: number
  /** The first line terminator from where the last search ran. */
  lineEnd: number | undefined
  /** Where the next `direction` is, when it was searched for. */
  next: number | undefined
}

/** The direction statement starting at `p`: its token and its end. */
function directionsAt(self: Directions, src: string, p: number): [T, number] | undefined {
  if (self.done || p < self.failed) return undefined
  if (self.next === undefined || self.next < p) {
    const at = p > src.length ? -1 : src.indexOf('direction', p)
    self.next = at < 0 ? undefined : at
    if (self.next === undefined) {
      self.done = true
      return undefined
    }
  }
  const next = self.next
  if (self.lineEnd === undefined || self.lineEnd < p) {
    let end = p
    while (end < src.length && !isLineEnd(src.charCodeAt(end))) end += 1
    self.lineEnd = end
  }
  const end = self.lineEnd
  if (next >= end) return undefined
  let found: [T, number] | undefined
  for (const [word, t] of DIRECTIONS) {
    const stop = direction(src, p, end, word)
    if (stop !== undefined) {
      found = [t, stop]
      break
    }
  }
  if (found === undefined) {
    // No direction statement starts anywhere in the rest of this line either.
    self.failed = end
  }
  return found
}

/**
 * Follows the lexer Jison compiles from `c4Diagram.jison`: its rule order, its start
 * conditions, and what it returns once the input runs out in each of them.
 */
export function tokenize(src: string): Token[] {
  const n = src.length
  const tokens: Token[] = []
  let state: S = S.Initial
  let accValue: T = T.AccTitleValue
  let p = 0
  let done = false
  const directions: Directions = { done: false, failed: 0, lineEnd: undefined, next: undefined }

  const emit = (t: T, start: number, end: number): number => {
    tokens.push({ end, start, t })
    return end
  }
  // `word\s[^#\n;]+`
  const statement = (p: number, word: string): number | undefined => {
    if (!src.startsWith(word, p)) return undefined
    const at = p + word.length
    if (at >= n || !isSpace(src.charCodeAt(at))) return undefined
    const from = at + 1
    let q = from
    while (q < n) {
      const d = src.charCodeAt(q)
      if (d === 0x23 || d === 0x0a || d === 0x3b) break
      q += 1
    }
    return q > from ? q : undefined
  }

  for (;;) {
    // Jison notes the end of input one call before it reports it, so a rule that matches
    // nothing gets one last turn.
    if (done) {
      emit(T.End, n, n)
      break
    }
    if (p >= n) done = true
    // Every test on `c` is ASCII or `\s`, which no surrogate or astral code point meets, so the
    // UTF-16 unit answers as the code point would.
    const c = p < n ? src.charCodeAt(p) : 4294967295

    switch (state) {
      case S.Initial: {
        if (p >= n) {
          p = emit(T.Eof, n, n)
          continue
        }
        const dir = directionsAt(directions, src, p)
        if (dir !== undefined) {
          p = emit(dir[0], p, dir[1])
          continue
        }
        if (c === 116) {
          const end = statement(p, 'title')
          if (end !== undefined) {
            p = emit(T.Title, p, end)
            continue
          }
        }
        if (c === 97) {
          const end = statement(p, 'accDescription')
          if (end !== undefined) {
            p = emit(T.AccDescription, p, end)
            continue
          }
          const title = src.startsWith('accTitle', p)
          if (title || src.startsWith('accDescr', p)) {
            const q = skipWs(src, p + 8)
            const d = byte(src, q)
            if (d === 0x3a) {
              const t = title ? T.AccTitle : T.AccDescr
              p = emit(t, p, skipWs(src, q + 1))
              accValue = title ? T.AccTitleValue : T.AccDescrValue
              state = S.Acc
              continue
            }
            if (d === 0x7b && !title) {
              p = skipWs(src, q + 1)
              state = S.AccDescrMultiline
              continue
            }
          }
        }
        if (c === 37 && byte(src, p + 1) === 0x25) {
          // A comment takes the line breaks after it, so no NEWLINE follows.
          let q = upTo(src, p + 2, '\n')
          while (q < n) {
            const d = src.charCodeAt(q)
            if (d !== 0x0a && d !== 0x0d) break
            q += 1
          }
          p = q
          continue
        }
        if (isSpace(c)) {
          let q = p
          let last: number | undefined
          while (q < n) {
            const d = src.charCodeAt(q)
            if (!isSpace(d)) break
            if (d === 0x0a) last = q
            q += 1
          }
          p = last === undefined ? q : emit(T.Newline, p, last + 1)
          continue
        }
        if (c === 123) {
          p = emit(T.Lbrace, p, p + 1)
          continue
        }
        if (c === 125) {
          p = emit(T.Rbrace, p, p + 1)
          continue
        }
        if (isWord(c)) {
          let q = p + 1
          while (q < n && isWord(src.charCodeAt(q))) q += 1
          const found = q - p <= 19 ? tKeyword(src.slice(p, q)) : undefined
          if (found !== undefined) {
            if (found > T.C4Deployment) state = S.Struct
            p = emit(found, p, q)
            continue
          }
        }
        emit(T.Error, p, p)
        break
      }
      case S.Struct: {
        if (p >= n) {
          p = emit(T.EofInStruct, n, n)
        } else if (c === 40) {
          let q = p + 1
          while (byte(src, q) === 0x20) q += 1
          if (byte(src, q) === 0x2c) {
            p = emit(T.AttributeEmpty, p, q + 1)
          } else {
            p += 1
          }
          state = S.Attribute
        } else if (c === 41) {
          p += 1
          state = S.Initial
        } else {
          emit(T.Error, p, p)
          break
        }
        continue
      }
      case S.Attribute: {
        if (p >= n) continue
        if (c === 41) {
          p += 1
          state = S.Initial
        } else if (c === 44) {
          if (byte(src, p + 1) === 0x2c) {
            p = emit(T.AttributeEmpty, p, p + 2)
          } else {
            p += 1
          }
        } else {
          let q = p
          while (byte(src, q) === 0x20) q += 1
          const d = byte(src, q)
          if (d === 0x22) {
            if (byte(src, q + 1) === 0x22) {
              p = emit(T.AttributeEmpty, p, q + 2)
            } else {
              p = q + 1
              state = S.String
            }
          } else if (d === 0x24) {
            p = q + 1
            state = S.StringKv
          } else {
            // An unquoted value runs to the next comma, through closing parentheses and line
            // breaks.
            p = emit(T.Str, p, upTo(src, p, ','))
          }
        }
        continue
      }
      case S.String: {
        if (c === 34) {
          p += 1
          state = S.Attribute
        } else {
          p = emit(T.Str, p, upTo(src, p, '"'))
        }
        continue
      }
      case S.StringKv: {
        p = emit(T.StrKey, p, upTo(src, p, '='))
        state = S.StringKvKey
        continue
      }
      case S.StringKvKey: {
        if (p >= n) continue
        let q = p + 1
        if (c === 61) {
          while (byte(src, q) === 0x20) q += 1
        }
        if (c !== 61 || byte(src, q) !== 0x22) {
          emit(T.Error, p, p)
          break
        }
        p = q + 1
        state = S.StringKvValue
        continue
      }
      case S.StringKvValue: {
        if (p >= n) continue
        if (c === 34) {
          p += 1
          state = S.Attribute
        } else {
          p = emit(T.StrValue, p, upTo(src, p, '"'))
        }
        continue
      }
      case S.Acc: {
        p = emit(accValue, p, upTo(src, p, '\n'))
        state = S.Initial
        continue
      }
      case S.AccDescrMultiline: {
        if (c === 125) {
          p += 1
          state = S.Initial
        } else {
          p = emit(T.AccDescrMultilineValue, p, upTo(src, p, '}'))
        }
        continue
      }
    }
    // Only an error token leaves the switch without `continue`.
    break
  }

  return tokens
}

