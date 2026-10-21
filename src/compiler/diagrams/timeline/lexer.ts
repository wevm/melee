/**
 * @module The timeline lexer: a port of the rules of Mermaid's timeline grammar. Port of Pele's
 * `src/diagrams/timeline/lexer.ts`.
 *
 * Offsets are UTF-16. Pele steps over one UTF-16 unit after a keyword's space, which is always
 * one character, so this lexer steps over that character.
 */
import { type Tokens, accessibility, keywordAt, lineEnd, skipTrivia } from '../common/scan.ts'
import { isSpace, isWord } from '../../util/chars.ts'

/** The end of the tokens. */
export const END = 0
/** The end of input. */
export const EOF = 1
/** Text no rule matches. */
export const INVALID = 2
/** Line breaks. */
export const NEWLINE = 3
/** `timeline`. */
export const TIMELINE = 4
/** `timeline LR`. */
export const TIMELINE_LR = 5
/** `timeline TD`. */
export const TIMELINE_TD = 6
/** A `title` statement. */
export const TITLE = 7
/** `accTitle:`, followed by its value. The accessibility types are numbered consecutively. */
export const ACC_TITLE = 8
/** A section heading. */
export const SECTION = 13
/** A time period. */
export const PERIOD = 14
/** `: event`. */
export const EVENT = 15

/** `accDescr:`, followed by its value. */
export const ACC_DESCR = ACC_TITLE + 2
/** The text of an `accDescr { ... }` block. */
export const ACC_DESCR_MULTILINE_VALUE = ACC_TITLE + 4

/** The names the generated parser prints, by token type. */
export const TOKEN_NAMES: readonly string[] = [
  '$end',
  'EOF',
  'INVALID',
  'NEWLINE',
  'timeline',
  'timeline_lr',
  'timeline_td',
  'title',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'section',
  'period',
  'event',
]

/** The character at `p`, as a code point, when `p` is inside `src`. */
function codeAt(src: string, p: number): number | undefined {
  return p < src.length ? src.codePointAt(p) : undefined
}

/** The length of the character at `p`, or 1 at the end. */
function lenAt(src: string, p: number): number {
  const c = codeAt(src, p)
  return c !== undefined && c > 0xffff ? 2 : 1
}

/**
 * `String.prototype.charCodeAt`, called through a module-local constant so the optimizer reads
 * the character directly whatever kind of V8 string `src` is (see `text/measure.ts`).
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** Appends a token of type `kind` over `src[s..e]`, and returns `e`. */
function emit(out: Tokens, src: string, kind: number, s: number, e: number): number {
  out.types.push(kind)
  out.texts.push(src.slice(s, e))
  out.starts.push(s)
  return e
}

/**
 * Whether the character at `at` is white space. False at the end. Every space is in the Basic
 * Multilingual Plane, and a surrogate is not one, so the UTF-16 unit decides.
 */
function spaceAt(src: string, at: number): boolean {
  return at < src.length && isSpace(charCodeAt.call(src, at))
}

/** Whether the character at `at` is a word character, which is ASCII. False at the end. */
function wordAt(src: string, at: number): boolean {
  return at < src.length && isWord(charCodeAt.call(src, at))
}

/** Splits preprocessed timeline source into tokens. */
export function tokenize(src: string): Tokens {
  const n = src.length
  const out: Tokens = { starts: [], texts: [], types: [] }
  let p = 0
  for (;;) {
    p = skipTrivia(src, p)
    if (p >= n) break
    const c = charCodeAt.call(src, p)
    if (c === 0x0a) {
      let e = p + 1
      while (charCodeAt.call(src, e) === 0x0a) e++
      p = emit(out, src, NEWLINE, p, e)
      continue
    }
    if (keywordAt(src, p, 'timeline')) {
      let e = p + 8
      while (charCodeAt.call(src, e) === 0x20 || charCodeAt.call(src, e) === 0x09) e++
      const lr = keywordAt(src, e, 'lr')
      if (e > p + 8 && (lr || keywordAt(src, e, 'td')) && !wordAt(src, e + 2)) {
        p = emit(out, src, lr ? TIMELINE_LR : TIMELINE_TD, p, e + 2)
        continue
      }
      if (!wordAt(src, p + 8)) {
        p = emit(out, src, TIMELINE, p, p + 8)
        continue
      }
    }
    // `\s` after a keyword also takes a line break, so `title` alone on a line takes the
    // next line as its text.
    if (keywordAt(src, p, 'title') && spaceAt(src, p + 5)) {
      const after = p + 5 + lenAt(src, p + 5)
      if (after < n && charCodeAt.call(src, after) !== 0x0a) {
        p = emit(out, src, TITLE, p, lineEnd(src, after))
        continue
      }
    }
    const e = accessibility(src, p, out, ACC_TITLE)
    if (e !== p) {
      p = e
      continue
    }
    if (keywordAt(src, p, 'section') && spaceAt(src, p + 7)) {
      const from = p + 7 + lenAt(src, p + 7)
      let e = from
      while (e < n && charCodeAt.call(src, e) !== 0x3a && charCodeAt.call(src, e) !== 0x0a) e++
      if (e > from) {
        p = emit(out, src, SECTION, p, e)
        continue
      }
    }
    if (c !== 0x3a) {
      let e = p + lenAt(src, p)
      while (e < n) {
        const d = charCodeAt.call(src, e)
        if (d === 0x23 || d === 0x3a || d === 0x0a) break
        e++
      }
      p = emit(out, src, PERIOD, p, e)
      continue
    }
    // An event runs to the end of the line or to a colon that is followed by whitespace.
    if (spaceAt(src, p + 1)) {
      const from = p + 1 + lenAt(src, p + 1)
      let e = from
      while (e < n) {
        const d = charCodeAt.call(src, e)
        if (d === 0x0a) break
        if (d === 0x3a && spaceAt(src, e + 1)) break
        e++
      }
      if (e > from) {
        p = emit(out, src, EVENT, p, e)
        continue
      }
    }
    p = emit(out, src, INVALID, p, p + 1)
  }

  // Jison marks its lexer done when a rule runs on empty input, so an accessibility value that
  // matches nothing at the very end of the text is followed by no EOF token.
  const last = out.starts[out.starts.length - 1]
  if (last === undefined || last < n) emit(out, src, EOF, n, n)
  emit(out, src, END, n, n)
  return out
}
