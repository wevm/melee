/**
 * @module The Ishikawa lexer. Port of Pele's `src/diagrams/ishikawa/lexer.ts`.
 *
 * Pele reads UTF-16 code units, as this port does. Wherever `\s` looks at a character it is
 * decoded whole, so token boundaries match.
 */
import { wordAt } from '../common/caseless.ts'
import { isLineEnd, isSpace, isWord } from '../../util/chars.ts'

/** A token kind. The order mirrors Pele's `T` enum. */
export const T = {
  /** After the end of input. */
  End: 'End',
  /** The end of input. */
  Eof: 'Eof',
  /** Blank lines, or a comment with the white space before it. */
  Spaceline: 'Spaceline',
  /** One line break before text. */
  Nl: 'Nl',
  /** The `ishikawa` or `ishikawa-beta` keyword. */
  Ishikawa: 'Ishikawa',
  /** Indentation. */
  Spacelist: 'Spacelist',
  /** The rest of a line. */
  Text: 'Text',
} as const
export type T = (typeof T)[keyof typeof T]

/** The name Mermaid's parser reports, from Pele's `TOKEN_NAMES`. */
export function tName(t: T): string {
  switch (t) {
    case T.End:
      return '$end'
    case T.Eof:
      return 'EOF'
    case T.Spaceline:
      return 'SPACELINE'
    case T.Nl:
      return 'NL'
    case T.Ishikawa:
      return 'ISHIKAWA'
    case T.Spacelist:
      return 'SPACELIST'
    case T.Text:
      return 'TEXT'
  }
}

/** A token: its kind and its UTF-16 span. */
export type Token = {
  /** End offset. */
  end: number
  /** Start offset. */
  start: number
  /** Kind. */
  t: T
}

/**
 * `String.prototype.charCodeAt`, called through a module-local constant so the optimizer reads
 * the character directly whatever kind of V8 string `src` is (see `text/measure.ts`).
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** Whether the character at `at` is a word character. False at the end. */
function wordCharAt(src: string, at: number): boolean {
  return at < src.length && isWord(charCodeAt.call(src, at))
}

/**
 * The length of `ishikawa-beta`, or failing that `ishikawa`, at `at`, either one ending at a word
 * boundary. 0 when neither is there.
 */
function keyword(src: string, at: number): number {
  if (wordAt(src, at, 'ishikawa-beta') && !wordCharAt(src, at + 13)) return 13
  if (wordAt(src, at, 'ishikawa') && !wordCharAt(src, at + 8)) return 8
  return 0
}

/**
 * Produces the tokens of Mermaid's Jison lexer for Ishikawa diagrams, where the first rule that
 * matches wins: white space up to a comment or up to the last line break in it is a blank line,
 * a single line break before text is a new line, other white space is indentation, and the rest
 * of a line is text. The list ends with `Eof` and `End`.
 */
export function tokenize(src: string): Token[] {
  const n = src.length
  const tokens: Token[] = []
  let i = 0
  while (i < n) {
    // White space and line ends are all in the Basic Multilingual Plane, so testing UTF-16 units
    // stops where testing code points does: a surrogate is neither.
    let j = i
    let lastBreak = -1
    while (j < n) {
      const c = charCodeAt.call(src, j)
      if (!isSpace(c)) break
      if (c === 0x0a) lastBreak = j
      j++
    }

    let t: T
    let end: number
    if (charCodeAt.call(src, j) === 0x25 && charCodeAt.call(src, j + 1) === 0x25) {
      end = j + 2
      while (end < n && !isLineEnd(charCodeAt.call(src, end))) end++
      t = T.Spaceline
    } else if (j === i) {
      const length = keyword(src, i)
      if (length === 0) {
        t = T.Text
        const at = src.indexOf('\n', i)
        end = at < 0 ? n : at
      } else {
        t = T.Ishikawa
        end = i + length
      }
    } else if (lastBreak >= 0 && lastBreak > i) {
      t = T.Spaceline
      end = lastBreak + 1
    } else if (lastBreak >= 0 && lastBreak === i) {
      t = T.Nl
      end = i + 1
    } else {
      t = T.Spacelist
      end = j
    }
    tokens.push({ end, start: i, t })
    i = end
  }

  tokens.push({ end: n, start: n, t: T.Eof })
  tokens.push({ end: n, start: n, t: T.End })
  return tokens
}
