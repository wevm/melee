/**
 * @module The user journey lexer: a port of the rules of Mermaid's journey grammar. Port of Pele's
 * `src/diagrams/journey/lexer.ts`.
 *
 * Offsets are UTF-16. Pele steps over one UTF-16 unit after a keyword's space, which is always
 * one character, so this lexer steps over that character.
 */
import { type Tokens, accessibility, keywordAt, skipTrivia } from '../common/scan.ts'
import { isSpace, isWord } from '../../util/chars.ts'

/** The end of the tokens. */
export const END = 0
/** The end of input. */
export const EOF = 1
/** Text no rule matches. */
export const INVALID = 2
/** Line breaks. */
export const NEWLINE = 3
/** `journey`. */
export const JOURNEY = 4
/** A `title` statement. */
export const TITLE = 5
/** `accTitle:`, followed by its value. The accessibility types are numbered consecutively. */
export const ACC_TITLE = 6
/** `accDescr:`, followed by its value. */
export const ACC_DESCR = ACC_TITLE + 2
/** The text of an `accDescr { ... }` block. */
export const ACC_DESCR_MULTILINE_VALUE = ACC_TITLE + 4
/** A section heading. */
export const SECTION = 11
/** A task's name. */
export const TASK_NAME = 12
/** A task's score and actors, from the colon. */
export const TASK_DATA = 13

/** The names the generated parser prints, by token type. */
export const TOKEN_NAMES: readonly string[] = [
  '$end',
  'EOF',
  'INVALID',
  'NEWLINE',
  'journey',
  'title',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'section',
  'taskName',
  'taskData',
  ':',
]

/** A lone colon. */
const COLON = 14

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

/** Whether the character at `at` is white space. False at the end. */
function spaceAt(src: string, at: number): boolean {
  // Every space is in the Basic Multilingual Plane, and a surrogate is not one.
  return at < src.length && isSpace(charCodeAt.call(src, at))
}

/** `#`, a line break, and `;` end every kind of text; a colon also ends a task name or a section. */
function textEnd(src: string, from: number, colon: boolean): number {
  let e = from
  const n = src.length
  while (e < n) {
    const c = charCodeAt.call(src, e)
    if (c === 0x23 || c === 0x0a || c === 0x3b) break
    if (c === 0x3a && colon) break
    e++
  }
  return e
}

/** Splits preprocessed journey source into tokens. */
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
    if (keywordAt(src, p, 'journey')) {
      // A word character is ASCII, and a surrogate is not one.
      if (!(p + 7 < n && isWord(charCodeAt.call(src, p + 7)))) {
        p = emit(out, src, JOURNEY, p, p + 7)
        continue
      }
    }
    // `\s` after a keyword also takes a line break, so `title` alone on a line takes the
    // next line as its text.
    if (keywordAt(src, p, 'title') && spaceAt(src, p + 5)) {
      const from = p + 5 + lenAt(src, p + 5)
      const e = textEnd(src, from, false)
      if (e > from) {
        p = emit(out, src, TITLE, p, e)
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
      const e = textEnd(src, from, true)
      if (e > from) {
        p = emit(out, src, SECTION, p, e)
        continue
      }
    }
    if (c === 0x3a) {
      const e = textEnd(src, p + 1, false)
      p = e > p + 1 ? emit(out, src, TASK_DATA, p, e) : emit(out, src, COLON, p, p + 1)
    } else if (c === 0x3b) {
      p = emit(out, src, INVALID, p, p + 1)
    } else {
      const e = textEnd(src, p + lenAt(src, p), true)
      p = emit(out, src, TASK_NAME, p, e)
    }
  }

  // Jison marks its lexer done when a rule runs on empty input, so an accessibility value that
  // matches nothing at the very end of the text is followed by no EOF token.
  const last = out.starts[out.starts.length - 1]
  if (last === undefined || last < n) emit(out, src, EOF, n, n)
  emit(out, src, END, n, n)
  return out
}
