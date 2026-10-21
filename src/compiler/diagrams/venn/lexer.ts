/**
 * @module The venn lexer, which reads tokens one at a time as Mermaid's Jison lexer does: every
 * rule ignores case, the first rule that matches wins, and a keyword must end at a word boundary.
 * Port of Pele's `src/diagrams/venn/lexer.ts`.
 *
 * Pele reads UTF-16 code units, as this port does: every delimiter is ASCII, and a character
 * outside the Basic Multilingual Plane is decoded whole wherever `\s` looks at it.
 */
import { type VennDb, vennDbIndentMode, vennDbSetIndentMode } from './db.ts'
import { trim } from '../../text/label.ts'
import { isDigit, isHex, isSpace, isWord } from '../../util/chars.ts'
import { startsWithIgnoreAsciiCase } from '../../util/rust.ts'

/** A token kind. The order mirrors Pele's `T` enum, and the parser compares kinds by it. */
export const T = {
  /** End of input, after `Eof`. */
  End: 0,
  /** Unrecognized text. */
  Error: 1,
  /** End of input. */
  Eof: 2,
  /** One or more line breaks. */
  Newline: 3,
  /** `venn-beta`. */
  Venn: 4,
  /** `title` and its text. */
  Title: 5,
  /** `set`. */
  Set: 6,
  /** `union`. */
  Union: 7,
  /** `text`. */
  Text: 8,
  /** An indented `text` after a set or union. */
  IndentText: 9,
  /** `style`. */
  Style: 10,
  /** `[label]` or `["label"]`. */
  BracketLabel: 11,
  /** A number. */
  Numeric: 12,
  /** `#rgb` and longer hex colors. */
  HexColor: 13,
  /** `rgb(r, g, b)`. */
  RgbColor: 14,
  /** `rgba(r, g, b, a)`. */
  RgbaColor: 15,
  /** A word. */
  Identifier: 16,
  /** A quoted string, quotes included. */
  String: 17,
  /** `,`. */
  Comma: 18,
  /** `:`. */
  Colon: 19,
} as const
export type T = (typeof T)[keyof typeof T]

/** The names Mermaid's parser reports, from Pele's `TOKEN_NAMES`, indexed by {@link T}. */
const NAMES: readonly string[] = [
  '$end',
  'INVALID',
  'EOF',
  'NEWLINE',
  'VENN',
  'TITLE',
  'SET',
  'UNION',
  'TEXT',
  'INDENT_TEXT',
  'STYLE',
  'BRACKET_LABEL',
  'NUMERIC',
  'HEXCOLOR',
  'RGBCOLOR',
  'RGBACOLOR',
  'IDENTIFIER',
  'STRING',
  'COMMA',
  'COLON',
]

/** The name Mermaid's parser reports, from Pele's `TOKEN_NAMES`. */
export function tName(kind: T): string {
  return NAMES[kind] ?? ''
}

/** Keywords, in the order Pele tries them. */
const KEYWORDS: readonly [string, T][] = [
  ['venn-beta', T.Venn],
  ['set', T.Set],
  ['union', T.Union],
  ['text', T.Text],
  ['style', T.Style],
]

/** The code past the end of the source, which no test matches. Pele's `charCodeAt` returns `NaN`. */
const NONE = 4294967295

/** Reads venn tokens one at a time. */
export type VennLexer = {
  at: number
  ended: boolean
  lineStart: boolean
  src: string
  /** The UTF-16 offset of the token `next` returned last. */
  start: number
  /** The text of the token `next` returned last. */
  text: string
}

/** A lexer at the start of `src`. */
export function vennLexerNew(src: string): VennLexer {
  return { at: 0, ended: false, lineStart: false, src, start: 0, text: '' }
}

/** The unit at `at`, or {@link NONE} past the end. Non-ASCII units match no ASCII test. */
function byte(lexer: VennLexer, at: number): number {
  return at < lexer.src.length ? lexer.src.charCodeAt(at) : NONE
}

/** The character at `at`, decoded whole when it is outside the Basic Multilingual Plane. */
function code(lexer: VennLexer, at: number): number {
  return at < lexer.src.length ? (lexer.src.codePointAt(at) as number) : NONE
}

/** The length in UTF-16 units of the character at `at`. */
function lenAt(lexer: VennLexer, at: number): number {
  const c = lexer.src.codePointAt(at)
  return c !== undefined && c > 0xffff ? 2 : 1
}

function slice(lexer: VennLexer, from: number, to: number): string {
  return lexer.src.slice(from, to)
}

/** Whether `word` (lowercase ASCII) starts at `at`, ignoring case. */
function word(lexer: VennLexer, at: number, word: string): boolean {
  return startsWithIgnoreAsciiCase(lexer.src, word, at)
}

function keyword(lexer: VennLexer, at: number, w: string): boolean {
  return word(lexer, at, w) && !isWord(byte(lexer, at + w.length))
}

/** The end of `rgb(1, 2, 3)` or `rgba(1, 2, 3, 0.5)` whose parenthesis opens at `at`. */
function color(lexer: VennLexer, at: number, parts: number): number | undefined {
  let i = at + 1
  for (let part = 0; part < parts; part++) {
    while (isSpace(code(lexer, i))) i += lenAt(lexer, i)
    const from = i
    while (isDigit(byte(lexer, i)) || byte(lexer, i) === 46) i += 1
    if (i === from) return undefined
    while (isSpace(code(lexer, i))) i += lenAt(lexer, i)
    if (byte(lexer, i) !== (part === parts - 1 ? 41 : 44)) return undefined
    i += 1
  }
  return i
}

function lineEnd(lexer: VennLexer, from: number): number {
  const at = lexer.src.indexOf('\n', from)
  return at < 0 ? lexer.src.length : at
}

function token(lexer: VennLexer, kind: T, end: number): T {
  lexer.text = slice(lexer, lexer.at, end)
  lexer.at = end
  return kind
}

/**
 * Reads the next token. `host` says whether an indented `text` continues a set, and hears when a
 * line starts with something else.
 */
export function vennLexerNext(lexer: VennLexer, host: VennDb): T {
  const n = lexer.src.length
  for (;;) {
    let i = lexer.at
    lexer.start = i
    lexer.text = ''
    if (i >= n) {
      if (lexer.ended) return T.End
      lexer.ended = true
      return T.Eof
    }
    const c = byte(lexer, i)
    // A comment runs to the end of the line. It also takes the character before it along,
    // whatever that is: a line break, or the last letter of a word. Pele reads code units, so a
    // character outside the Basic Multilingual Plane is never the one before.
    const next = i + lenAt(lexer, i)
    if (
      (c === 37 && byte(lexer, i + 1) === 37 && byte(lexer, i + 2) !== 123) ||
      (c !== 125 && lenAt(lexer, i) < 2 && byte(lexer, next) === 37 && byte(lexer, next + 1) === 37)
    ) {
      const from = c === 37 ? i + 2 : next + 1
      lexer.at = lineEnd(lexer, from)
      continue
    }
    if (lexer.lineStart) {
      if (c === 32 || c === 9) {
        let j = i + 1
        while (byte(lexer, j) === 32 || byte(lexer, j) === 9) j += 1
        lexer.at = j
        if (keyword(lexer, j, 'text') && vennDbIndentMode(host)) {
          // The word `text` itself is dropped, and the indentation stands for it.
          lexer.at = j + 4
          lexer.lineStart = false
          lexer.text = slice(lexer, i, j)
          return T.IndentText
        }
        continue
      }
      if (c !== 10 && c !== 13) {
        vennDbSetIndentMode(host, false)
        lexer.lineStart = false
      }
    }
    if (c === 10 || c === 13) {
      i += 1
      while (byte(lexer, i) === 10 || byte(lexer, i) === 13) i += 1
      lexer.lineStart = true
      return token(lexer, T.Newline, i)
    }
    if (c === 37 && byte(lexer, i + 1) === 37) {
      lexer.at = lineEnd(lexer, i)
      continue
    }
    if (c === 32 || c === 9) {
      i += 1
      while (byte(lexer, i) === 32 || byte(lexer, i) === 9) i += 1
      lexer.at = i
      continue
    }

    if (((c | 32) >= 97 && (c | 32) <= 122) || c === 95) {
      if (word(lexer, i, 'title') && isSpace(code(lexer, i + 5))) {
        const body = i + 5 + lenAt(lexer, i + 5)
        let end = body
        while (end < n) {
          const b = byte(lexer, end)
          if (b === 35 || b === 10 || b === 59) break
          end += 1
        }
        if (end > body) return token(lexer, T.Title, end)
      }
      for (const [w, kind] of KEYWORDS) {
        if (keyword(lexer, i, w)) return token(lexer, kind, i + w.length)
      }
      if (word(lexer, i, 'rgb')) {
        const alpha = (byte(lexer, i + 3) | 32) === 97
        const open = i + (alpha ? 4 : 3)
        const end = byte(lexer, open) === 40 ? color(lexer, open, alpha ? 4 : 3) : undefined
        if (end !== undefined) return token(lexer, alpha ? T.RgbaColor : T.RgbColor, end)
      }
      i += 1
      while (isWord(byte(lexer, i)) || byte(lexer, i) === 45) i += 1
      return token(lexer, T.Identifier, i)
    }
    if (c === 91) {
      if (byte(lexer, i + 1) === 34) {
        const found = lexer.src.indexOf('"', i + 2)
        if (found < 0 || byte(lexer, found + 1) !== 93) return T.Error
        lexer.at = found + 2
        lexer.text = slice(lexer, i + 2, found)
        return T.BracketLabel
      }
      let end = i + 1
      while (end < n) {
        const b = byte(lexer, end)
        if (b === 93 || b === 34) break
        end += 1
      }
      if (end === i + 1 || byte(lexer, end) !== 93) return T.Error
      lexer.at = end + 1
      lexer.text = trim(slice(lexer, i + 1, end))
      return T.BracketLabel
    }
    if (isDigit(c) || c === 46 || c === 43 || c === 45) {
      if (c === 43 || c === 45) i += 1
      const from = i
      while (isDigit(byte(lexer, i))) i += 1
      const fraction = byte(lexer, i) === 46 && isDigit(byte(lexer, i + 1))
      if (i === from && !fraction) return T.Error
      if (fraction) {
        i += 2
        while (isDigit(byte(lexer, i))) i += 1
      }
      return token(lexer, T.Numeric, i)
    }
    if (c === 35) {
      let end = i + 1
      while (end < i + 9 && isHex(byte(lexer, end))) end += 1
      return end >= i + 4 ? token(lexer, T.HexColor, end) : T.Error
    }
    if (c === 34) {
      const found = lexer.src.indexOf('"', i + 1)
      return found >= 0 ? token(lexer, T.String, found + 1) : T.Error
    }
    if (c === 44) return token(lexer, T.Comma, i + 1)
    if (c === 58) return token(lexer, T.Colon, i + 1)
    return T.Error
  }
}
