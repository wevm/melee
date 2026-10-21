/**
 * @module Lexer rules that Mermaid's journey and timeline grammars have in common, ported from the
 * compiled Jison rules: comments, whitespace, and the `accTitle` and `accDescr` statements.
 * Port of Pele's `src/diagrams/common/scan.ts`.
 *
 * Offsets are UTF-16, as in Pele, so a test of the unit after a character sees the second half
 * of a surrogate pair after a supplementary character, which no ASCII test matches.
 */
import { isSpace } from '../../util/chars.ts'

/**
 * `String.prototype.charCodeAt` and `codePointAt`, called through `.call`, which stay direct
 * reads whatever internal kind of string arrives. They stay unexported, as `text/measure.ts`
 * explains.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt
const codePointAt: (this: string, index: number) => number | undefined = String.prototype.codePointAt

/** Tokens of a Jison-style lexer: parallel lists of types, texts, and UTF-16 starts. */
export type Tokens = {
  /** Where each token starts. */
  starts: number[]
  /** The text of each token. */
  texts: string[]
  /** The type of each token. */
  types: number[]
}

/** No tokens. */
export function tokensDefault(): Tokens {
  return { starts: [], texts: [], types: [] }
}

/** Where the line from `from` ends: at the next `\n`, or the end of `src`. */
export function lineEnd(src: string, from: number): number {
  if (from > src.length) return src.length
  const at = src.indexOf('\n', from)
  return at === -1 ? src.length : at
}

/** Whether `word`, in lowercase ASCII letters, is at `p`. The grammars are case-insensitive. */
export function keywordAt(src: string, p: number, word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (p + i >= src.length) return false
    if ((charCodeAt.call(src, p + i) | 32) !== word.charCodeAt(i)) return false
  }
  return true
}

/**
 * Skips comments and whitespace, and stops at a line break that starts a token, which is a
 * `NEWLINE`. Jison compiles `\%%` to a single `%`, so one percent sign starts a comment, and the
 * second comment rule takes any character before `%%` with it, a line break included.
 */
export function skipTrivia(src: string, from: number): number {
  const n = src.length
  let p = from
  while (p < n) {
    const c = codePointAt.call(src, p) as number
    // The units after `c`, or -1. After a supplementary character they are a low surrogate,
    // which no test below matches.
    const wide = c > 0xffff
    const next = p + (wide ? 2 : 1)
    const after0 = !wide && next < n ? charCodeAt.call(src, next) : -1
    const after1 = !wide && next + 1 < n ? charCodeAt.call(src, next + 1) : -1

    if (c === 0x25 && after0 !== 0x7b) {
      p = lineEnd(src, p)
    } else if (c !== 0x7d && after0 === 0x25 && after1 === 0x25) {
      p = lineEnd(src, next + 2)
    } else if (c === 0x0a) {
      return p
    } else if (isSpace(c)) {
      p = next
      while (p < n && isSpace(codePointAt.call(src, p) as number)) p += 1
    } else if (c === 0x23) {
      p = lineEnd(src, p)
    } else {
      return p
    }
  }
  return p
}

function skipSpace(src: string, from: number): number {
  let p = from
  // Every space is in the Basic Multilingual Plane, so stepping one unit steps one character.
  while (p < src.length && isSpace(src.charCodeAt(p))) p += 1
  return p
}

/**
 * Lexes an `accTitle` or `accDescr` statement at `p` into `out` and returns where it ends, or
 * `p` when there is none. The token types `acc_title`, `acc_title_value`, `acc_descr`,
 * `acc_descr_value`, and `acc_descr_multiline_value` are numbered consecutively from `first`.
 */
export function accessibility(src: string, p: number, out: Tokens, first: number): number {
  const descr = keywordAt(src, p, 'accdescr')
  if (!descr && !keywordAt(src, p, 'acctitle')) return p
  const n = src.length
  let q = skipSpace(src, p + 8)
  const c = q < n ? src.charCodeAt(q) : undefined
  const emit = (kind: number, s: number, e: number): void => {
    out.types.push(kind)
    out.texts.push(src.slice(s, e))
    out.starts.push(s)
  }

  if (c === 0x3a) {
    q = skipSpace(src, q + 1)
    const end = lineEnd(src, q)
    emit(descr ? first + 2 : first, p, q)
    emit(descr ? first + 3 : first + 1, q, end)
    return end
  }
  if (!descr || c !== 0x7b) return p

  q = skipSpace(src, q + 1)
  while (!(q < n && src.charCodeAt(q) === 0x7d)) {
    const at = q > n ? -1 : src.indexOf('}', q)
    const end = at === -1 ? n : at
    emit(first + 4, q, end)
    if (q === n) return n
    q = end
  }
  return q + 1
}
