/**
 * @module The sankey lexer: Mermaid's CSV grammar for sankey rows. Port of Pele's
 * `src/diagrams/sankey/lexer.ts`.
 *
 * Pele reads UTF-16 code units, as this port does: every token but the keyword is printable
 * ASCII, so any other character stops the lexer at the same place.
 */
import { isWord } from '../../util/chars.ts'

/** A token kind. Variant order mirrors Pele's `T` enum and indexes {@link NAMES}, so it is observable. */
export const T = {
  /** The end of input. */
  End: 0,
  /** Not a Jison token: the reference lexer would return the same empty token forever from here. */
  Stuck: 1,
  /** `sankey` or `sankey-beta`. */
  Sankey: 2,
  /** A line break. */
  Newline: 3,
  /** A field separator. */
  Comma: 4,
  /** A double quote around an escaped field. */
  Dquote: 5,
  /** An unquoted field. */
  NonEscapedText: 6,
  /** The text of a quoted field. */
  EscapedText: 7,
  /** The end of the CSV. */
  Eof: 8,
} as const
export type T = (typeof T)[keyof typeof T]

/** The names Mermaid's parser reports for each token kind, indexed by {@link T}. */
export const NAMES: readonly string[] = [
  '$end',
  'STUCK',
  'SANKEY',
  'NEWLINE',
  'COMMA',
  'DQUOTE',
  'NON_ESCAPED_TEXT',
  'ESCAPED_TEXT',
  'EOF',
]

/** The name Mermaid's parser reports for this kind. */
export function tName(kind: T): string {
  return NAMES[kind] ?? ''
}

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
const S = { Csv: 0, EscapedText: 1, Initial: 2 } as const
type S = (typeof S)[keyof typeof S]

/** RFC 4180 TEXTDATA: printable ASCII except the double quote and the comma. */
function isTextData(c: number): boolean {
  return c >= 32 && c <= 126 && c !== 0x22 && c !== 0x2c
}

/** The code point at `at` and its length in UTF-16 units, or `undefined` past the end. */
function codeAt(src: string, at: number): [number, number] | undefined {
  const c = src.codePointAt(at)
  if (c === undefined) return undefined
  return [c, c > 0xffff ? 2 : 1]
}

/**
 * The end of `word` when the source at `p` spells it in any case and no word character follows,
 * as `src.slice(p, p + word.length).toLowerCase() === word` tests it. The Kelvin sign is the one
 * non-ASCII character JavaScript lowercases to a letter of these keywords.
 */
function keyword(src: string, p: number, word: string): number | undefined {
  if (p > src.length) return undefined
  let at = p
  for (let k = 0; k < word.length; k++) {
    const next = codeAt(src, at)
    if (next === undefined) return undefined
    const [c, len] = next
    let lower: number
    if (c === 0x212a) lower = 0x6b
    else lower = c >= 0x41 && c <= 0x5a ? c + 32 : c
    if (lower !== word.charCodeAt(k)) return undefined
    at += len
  }
  const end = at
  const following = codeAt(src, end)
  if (following !== undefined && isWord(following[0])) return undefined
  return end
}

/**
 * Splits prepared sankey text into tokens. The list ends with {@link T.End}, or with
 * {@link T.Stuck} where no rule consumes a character.
 */
export function tokenize(src: string): Token[] {
  const n = src.length
  const tokens: Token[] = []
  const stack: S[] = []
  let state: S = S.Initial
  let p = 0

  while (p < n) {
    const c = src.charCodeAt(p)
    const start = p
    let q = p
    if (state === S.EscapedText) {
      if (c === 0x22 && (p + 1 >= n || src.charCodeAt(p + 1) !== 0x22)) {
        const previous = stack.pop()
        if (previous !== undefined) state = previous
        tokens.push({ kind: T.Dquote, start: p, text: '"' })
        p += 1
        continue
      }
      while (q < n) {
        const d = src.charCodeAt(q)
        if (isTextData(d) || d === 0x2c || d === 0x0d || d === 0x0a) q += 1
        else if (d === 0x22 && q + 1 < n && src.charCodeAt(q + 1) === 0x22) q += 2
        else break
      }
      tokens.push({ kind: T.EscapedText, start: p, text: src.slice(p, q) })
      p = q
    } else {
      if (state === S.Initial && (c | 32) === 0x73) {
        const end = keyword(src, p, 'sankey-beta') ?? keyword(src, p, 'sankey')
        if (end !== undefined) {
          stack.push(state)
          state = S.Csv
          tokens.push({ kind: T.Sankey, start: p, text: src.slice(p, end) })
          p = end
          continue
        }
      }
      if (c === 0x0a) {
        tokens.push({ kind: T.Newline, start: p, text: '\n' })
        p += 1
        continue
      }
      if (c === 0x0d && p + 1 < n && src.charCodeAt(p + 1) === 0x0a) {
        tokens.push({ kind: T.Newline, start: p, text: '\r\n' })
        p += 2
        continue
      }
      if (c === 0x2c) {
        tokens.push({ kind: T.Comma, start: p, text: ',' })
        p += 1
        continue
      }
      if (c === 0x22) {
        stack.push(state)
        state = S.EscapedText
        tokens.push({ kind: T.Dquote, start: p, text: '"' })
        p += 1
        continue
      }
      while (q < n && isTextData(src.charCodeAt(q))) q += 1
      tokens.push({ kind: T.NonEscapedText, start: p, text: src.slice(p, q) })
      p = q
    }
    // A character outside the CSV alphabet matches as empty text and is never consumed.
    if (q === start) {
      tokens.push({ kind: T.Stuck, start: p, text: '' })
      return tokens
    }
  }

  const last = state === S.EscapedText ? T.EscapedText : T.Eof
  tokens.push({ kind: last, start: n, text: '' })
  tokens.push({ kind: T.End, start: n, text: '' })
  return tokens
}
