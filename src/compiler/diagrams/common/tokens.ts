/**
 * @module Tokenizer for the diagram types Mermaid defines with Langium grammars. Port of Pele's
 * `src/diagrams/common/tokens.ts`.
 *
 * Token types are tried in order and the first match wins, as in Chevrotain. Pele's sticky
 * regular expressions become {@link Pattern} values: literal text, a keyword, or a hand-written
 * matcher that each diagram supplies. Positions are UTF-16 offsets of the source, as Pele's are.
 */
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { isBlank, isLineEnd, isSpace } from '../../util/chars.ts'

/**
 * Answers as a sticky regular expression does: the end of a match that starts at the offset,
 * or `undefined`. The end must be on a character boundary.
 */
export type Matcher = (src: string, at: number) => number | undefined

/** Memory a {@link Scanner} keeps between calls during one {@link tokenize} call. It starts zeroed. */
export type Memo = number[]

/**
 * A {@link Matcher} that may remember what it has scanned, for a pattern that would otherwise
 * rescan the text from every position. Pele makes one with a `scanner` factory per text.
 */
export type Scanner = (src: string, at: number, memo: Memo) => number | undefined

/** What a token type matches. */
export type Pattern =
  /** A word that Mermaid ends only at whitespace, a comment, or the end of input. See {@link keyword}. */
  | { kind: 'Keyword'; _0: string }
  /** Literal text. */
  | { kind: 'Literal'; _0: string }
  /** A hand-written matcher. */
  | { kind: 'Match'; _0: Matcher }
  /** A hand-written matcher with memory. */
  | { kind: 'Scan'; _0: Scanner }

/** A token type, as Pele's `TokenType` describes one. */
export type TokenType = {
  /**
   * Every ASCII character a `Match` or `Scan` pattern's match can start with, when that is
   * known. The type is then tried only at those characters and at characters outside ASCII.
   * Literals and keywords derive it from their text.
   */
  first: string | undefined
  /** Whether matched text is dropped instead of becoming a token. */
  hidden: boolean
  /**
   * Chevrotain's `LONGER_ALT`, as indices into the same table. When this type matches, these
   * are tried at the same place, and the first one that matches more text becomes the token.
   */
  longer: number[]
  /** The name messages print. */
  name: string
  /**
   * Start of a construct that needs a closer, for a `Match` pattern. When this matches but the
   * pattern does not, no closer exists in the rest of the text, so the pattern is not tried
   * again.
   */
  opener: ((src: string, at: number) => boolean) | undefined
  /** What the type matches. */
  pattern: Pattern
}

/** A token: its kind as an index into the token types, and its UTF-16 span. */
export type Token = {
  /** End offset. */
  end: number
  /** Index of the token type, or {@link EOF}. */
  kind: number
  /** Start offset. */
  start: number
}

/** The kind of the token that ends every token list. Pele uses `-1`. */
export const EOF = 65535

/** Tokens of a source, ending with an {@link EOF} token at its end. */
export type Tokens = {
  /** The source. */
  src: string
  /** The tokens, hidden ones left out. */
  tokens: Token[]
}

/** A token type that matches `text`, named after it. */
export function literal(text: string): TokenType {
  return {
    first: undefined,
    hidden: false,
    longer: [],
    name: text,
    opener: undefined,
    pattern: { kind: 'Literal', _0: text },
  }
}

/**
 * A keyword token type. Mermaid ends a keyword only at whitespace, a comment, or the end of
 * input.
 */
export function keyword(word: string): TokenType {
  return {
    ...literal(word),
    pattern: { kind: 'Keyword', _0: word },
  }
}

/** `accDescr: text`, or `accDescr { text }` across lines. */
export const ACC_DESCR: TokenType = {
  ...literal(''),
  first: '\t a',
  name: 'ACC_DESCR',
  pattern: { kind: 'Match', _0: accDescr },
}

/** `accTitle: text`. */
export const ACC_TITLE: TokenType = {
  ...literal(''),
  first: '\t a',
  name: 'ACC_TITLE',
  pattern: { kind: 'Match', _0: accTitle },
}

/** `title text`, or a bare `title`. */
export const TITLE: TokenType = {
  ...literal(''),
  first: '\t t',
  name: 'TITLE',
  pattern: { kind: 'Match', _0: title },
}

/** A double- or single-quoted string with backslash escapes. */
export const STRING: TokenType = {
  ...literal(''),
  first: '"\'',
  name: 'STRING',
  pattern: { kind: 'Match', _0: string },
}

/** A line break. */
export const NEWLINE: TokenType = {
  ...literal(''),
  first: '\r\n',
  name: 'NEWLINE',
  pattern: { kind: 'Match', _0: newline },
}

/** Spaces and tabs, hidden. */
export const WHITESPACE: TokenType = {
  ...literal(''),
  first: '\t ',
  hidden: true,
  name: 'WHITESPACE',
  pattern: { kind: 'Match', _0: whitespace },
}

/** A front matter block, hidden. */
export const YAML: TokenType = {
  ...literal(''),
  first: '-',
  hidden: true,
  name: 'YAML',
  opener: yamlOpener,
  pattern: { kind: 'Match', _0: yaml },
}

/** A `%%{ ... }%%` directive, hidden. */
export const DIRECTIVE: TokenType = {
  ...literal(''),
  first: '\t %',
  hidden: true,
  name: 'DIRECTIVE',
  opener: directiveOpener,
  pattern: { kind: 'Match', _0: directive },
}

/** A `%%` comment to the end of its line, hidden. */
export const SINGLE_LINE_COMMENT: TokenType = {
  ...literal(''),
  first: '\t %',
  hidden: true,
  name: 'SINGLE_LINE_COMMENT',
  pattern: { kind: 'Match', _0: singleLineComment },
}

/**
 * `String.prototype.charCodeAt`, called as `charCodeAt.call(src, i)`. Sources reach the tokenizer
 * as V8 strings of several internal kinds, which makes `src.charCodeAt` a generic call; the one
 * known function reads the unit directly. It stays unexported, as `text/measure.ts` explains.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** Pattern kinds in a {@link Plan}. */
const KEYWORD = 0
const LITERAL = 1
const MATCH = 2
const SCAN = 3

/**
 * What {@link tokenize} derives from a token type table once, in flat arrays by type index, so
 * the loop reads no token type objects, whose shapes differ between tables.
 */
type Plan = {
  /**
   * For each ASCII unit, the indices of the types {@link canStart} allows there, in order. Entry
   * 128 lists every type, for units outside ASCII.
   */
  byUnit: Int32Array[]
  /** The number of types the plan was made for. */
  count: number
  /** Whether each type is hidden. */
  hidden: boolean[]
  /** Each type's pattern kind: {@link KEYWORD}, {@link LITERAL}, {@link MATCH}, or {@link SCAN}. */
  kind: number[]
  /** Each type's `longer` list. */
  longer: number[][]
  /** Each `Match` type's matcher. */
  match: (Matcher | undefined)[]
  /** Each type's opener. */
  opener: (((src: string, at: number) => boolean) | undefined)[]
  /** Each `Scan` type's scanner. */
  scanner: (Scanner | undefined)[]
  /** Each keyword's or literal's text. */
  text: string[]
  /** The table the plan was made from, entry by entry. */
  types: TokenType[]
}

/**
 * Plans by token type table. Tables are module constants, so this holds one entry per table and
 * lets go of a table nobody references.
 */
const plans = new WeakMap<TokenType[], Plan>()

/** Whether `plan` was made from `types` as it is now. */
function planMatches(plan: Plan, types: TokenType[]): boolean {
  if (plan.count !== types.length) return false
  for (let k = 0; k < types.length; k++) {
    if (plan.types[k] !== types[k]) return false
  }
  return true
}

function planFor(types: TokenType[]): Plan {
  const cached = plans.get(types)
  if (cached !== undefined && planMatches(cached, types)) return cached
  const byUnit: Int32Array[] = []
  for (let c = 0; c <= 128; c++) {
    const list: number[] = []
    for (let k = 0; k < types.length; k++) {
      if (c === 128 || canStart(types[k] as TokenType, c)) list.push(k)
    }
    byUnit.push(Int32Array.from(list))
  }
  const plan: Plan = {
    byUnit,
    count: types.length,
    hidden: [],
    kind: [],
    longer: [],
    match: [],
    opener: [],
    scanner: [],
    text: [],
    types: types.slice(),
  }
  for (const ty of types) {
    const pattern = ty.pattern
    plan.hidden.push(ty.hidden)
    plan.longer.push(ty.longer.slice())
    plan.opener.push(ty.opener)
    plan.kind.push(
      pattern.kind === 'Keyword' ? KEYWORD : pattern.kind === 'Literal' ? LITERAL : pattern.kind === 'Match' ? MATCH : SCAN,
    )
    plan.text.push(pattern.kind === 'Keyword' || pattern.kind === 'Literal' ? pattern._0 : '')
    plan.match.push(pattern.kind === 'Match' ? pattern._0 : undefined)
    plan.scanner.push(pattern.kind === 'Scan' ? pattern._0 : undefined)
  }
  plans.set(types, plan)
  return plan
}

/**
 * Splits `src` into tokens of `types`. At each place the types that can start there are tried in
 * order and the first match wins.
 *
 * @throws {CompileError} A lexical syntax error for `diagram` where no type matches.
 */
export function tokenize(src: string, types: TokenType[], diagram: string): Tokens {
  const n = src.length
  const plan = planFor(types)
  const byUnit = plan.byUnit
  const hidden = plan.hidden
  const longers = plan.longer
  // Types found dead (1) and `Scan` memory, both filled in as needed.
  const dead: number[] = []
  const memos: Memo[] = []
  const tokens: Token[] = []

  let p = 0
  scan: while (p < n) {
    const c = charCodeAt.call(src, p)
    const candidates = byUnit[c < 128 ? c : 128] as Int32Array
    for (let j = 0; j < candidates.length; j++) {
      const k = candidates[j] as number
      let end = tryType(src, p, plan, k, dead, memos)
      if (end === undefined || !(end > p)) continue

      let kind = k
      const longer = longers[k] as number[]
      for (let a = 0; a < longer.length; a++) {
        const alt = longer[a] as number
        const altEnd = tryType(src, p, plan, alt, dead, memos)
        if (altEnd !== undefined && altEnd > end) {
          kind = alt
          end = altEnd
          break
        }
      }

      if (!(hidden[kind] ?? false)) {
        tokens.push({ end, kind: kind > 65535 ? EOF : kind, start: p })
      }
      p = end
      continue scan
    }
    throw errorSyntax(diagram, src, p, '', true)
  }

  tokens.push({ end: n, kind: EOF, start: n })
  return { src, tokens }
}

/** Whether type `ty` can start with ASCII character `c`, as Pele's `prepare` tables say. */
function canStart(ty: TokenType, c: number): boolean {
  switch (ty.pattern.kind) {
    case 'Keyword':
    case 'Literal':
      return ty.pattern._0.length > 0 && ty.pattern._0.charCodeAt(0) === c
    case 'Match':
    case 'Scan': {
      const first = ty.first
      if (first === undefined) return true
      for (let i = 0; i < first.length; i++) if (first.charCodeAt(i) === c) return true
      return false
    }
  }
}

/** Tries type `k` at `p`, marking it dead when its opener matches but its pattern does not. */
function tryType(src: string, p: number, plan: Plan, k: number, dead: number[], memos: Memo[]): number | undefined {
  if (k >= plan.count || dead[k] === 1) return undefined
  switch (plan.kind[k]) {
    case KEYWORD:
      return keywordEnd(src, p, plan.text[k] as string)
    case LITERAL: {
      if (p > src.length) return undefined
      const text = plan.text[k] as string
      return src.startsWith(text, p) ? p + text.length : undefined
    }
    case MATCH: {
      const end = (plan.match[k] as Matcher)(src, p)
      if (end === undefined) {
        const opener = plan.opener[k]
        if (opener !== undefined && opener(src, p)) dead[k] = 1
      }
      return end
    }
    default: {
      let memo = memos[k]
      if (memo === undefined) {
        memo = [0, 0, 0, 0]
        memos[k] = memo
      }
      return (plan.scanner[k] as Scanner)(src, p, memo)
    }
  }
}

/** Where a run of spaces and tabs from `p` ends. */
export function skipBlanks(src: string, p: number): number {
  let at = p
  const n = src.length
  for (; at < n; at++) {
    const c = charCodeAt.call(src, at)
    if (c !== 32 && c !== 9) break
  }
  return at
}

/**
 * Where a run of JavaScript `\s` from `p` ends. Every space is in the Basic Multilingual Plane
 * and no surrogate is a space, so stepping over units steps over the same characters.
 */
function skipSpace(src: string, p: number): number {
  let at = p
  const n = src.length
  while (at < n && isSpace(charCodeAt.call(src, at))) at += 1
  return at
}

/** Where the line from `p` ends: at the first `\n` or `\r`, or the end of `src`. */
function lineEnd(src: string, p: number): number {
  const n = src.length
  for (let at = p; at < n; at++) {
    const c = charCodeAt.call(src, at)
    if (c === 0x0a || c === 0x0d) return at
  }
  return src.length
}

/** `[^\n\r]*?(?=%%)|[^\n\r]*` from `p`: to the first `%%` on the line, or to the line's end. */
function restOfLine(src: string, p: number): number {
  const end = lineEnd(src, p)
  if (p > end) return end
  const at = src.slice(p, end).indexOf('%%')
  return at < 0 ? end : p + at
}

/** `(?:(?=%%)|(?!\S))` at `p`. */
function wordEnds(src: string, p: number): boolean {
  if (p > src.length) return false
  if (src.startsWith('%%', p)) return true
  // No surrogate is a space, so the unit decides as the character would.
  return p >= src.length || isSpace(charCodeAt.call(src, p))
}

function keywordEnd(src: string, p: number, word: string): number | undefined {
  const end = p + word.length
  if (p > src.length) return undefined
  return src.startsWith(word, p) && wordEnds(src, end) ? end : undefined
}

/**
 * The start of an `accDescr` statement: `[\t ]*accDescr(?:[\t ]*:(?:[^\n\r]*?(?=%%)|[^\n\r]*)|\s*({))`.
 * Returns the end and whether the statement is the braced form, which ends after the `{`.
 */
export function accDescrHead(src: string, p: number): [number, boolean] | undefined {
  const q = skipBlanks(src, p)
  if (q > src.length || !src.startsWith('accDescr', q)) return undefined
  const r = q + 8

  const colon = skipBlanks(src, r)
  if (src.charCodeAt(colon) === 0x3a) return [restOfLine(src, colon + 1), false]

  const brace = skipSpace(src, r)
  return src.charCodeAt(brace) === 0x7b ? [brace + 1, true] : undefined
}

function accDescr(src: string, p: number): number | undefined {
  const head = accDescrHead(src, p)
  if (head === undefined) return undefined
  const [end, braced] = head
  if (!braced) return end
  if (end > src.length) return undefined
  const close = src.indexOf('}', end)
  return close < 0 ? undefined : close + 1
}

function accTitle(src: string, p: number): number | undefined {
  const q = skipBlanks(src, p)
  if (q > src.length || !src.startsWith('accTitle', q)) return undefined
  const colon = skipBlanks(src, q + 8)
  return src.charCodeAt(colon) === 0x3a ? restOfLine(src, colon + 1) : undefined
}

function title(src: string, p: number): number | undefined {
  const q = skipBlanks(src, p)
  if (q > src.length || !src.startsWith('title', q)) return undefined
  const r = q + 5
  if (r < src.length && isBlank(src.charCodeAt(r))) return restOfLine(src, r + 1)
  return r
}

function string(src: string, p: number): number | undefined {
  if (p >= src.length) return undefined
  const quote = src.charCodeAt(p)
  if (quote !== 0x22 && quote !== 0x27) return undefined

  // Quotes, backslashes, and line ends are in the Basic Multilingual Plane, so stepping over
  // units finds them where stepping over characters would. An escaped surrogate pair leaves its
  // low half to the next step, which matches nothing.
  const n = src.length
  let at = p + 1
  for (;;) {
    if (at >= n) return undefined
    const c = charCodeAt.call(src, at)
    at += 1
    if (c === quote) return at
    if (c === 0x5c) {
      if (at >= n || isLineEnd(charCodeAt.call(src, at))) return undefined
      at += 1
    }
  }
}

function newline(src: string, p: number): number | undefined {
  const at = src.charCodeAt(p) === 0x0d ? p + 1 : p
  return src.charCodeAt(at) === 0x0a ? at + 1 : undefined
}

function whitespace(src: string, p: number): number | undefined {
  return skipBlanks(src, p)
}

/** `(?:\r?\n|(?!\S))` at `p`. */
function blockEnd(src: string, p: number): number | undefined {
  const end = newline(src, p)
  if (end !== undefined) return end
  return p >= src.length || isSpace(charCodeAt.call(src, p)) ? p : undefined
}

/** `---[\t ]*\r?\n`. */
function yamlHead(src: string, p: number): number | undefined {
  if (p > src.length || !src.startsWith('---', p)) return undefined
  return newline(src, skipBlanks(src, p + 3))
}

function yamlOpener(src: string, p: number): boolean {
  return yamlHead(src, p) !== undefined
}

/** `---[\t ]*\r?\n(?:[\S\s]*?\r?\n)?---(?:\r?\n|(?!\S))`. */
function yaml(src: string, p: number): number | undefined {
  const head = yamlHead(src, p)
  if (head === undefined) return undefined
  const close = (at: number): number | undefined => {
    if (at <= src.length && src.startsWith('---', at)) return blockEnd(src, at + 3)
    return undefined
  }

  // The optional group comes first, and its lazy body ends at the earliest line break that a
  // closing `---` follows.
  let from = head
  for (;;) {
    if (from > src.length) break
    const at = src.indexOf('\n', from)
    if (at < 0) break
    const after = at + 1
    const end = close(after)
    if (end !== undefined) return end
    from = after
  }
  return close(head)
}

/** `[\t ]*%%{`. */
function directiveOpener(src: string, p: number): boolean {
  const q = skipBlanks(src, p)
  return q <= src.length && src.startsWith('%%{', q)
}

/** `[\t ]*%%{[\S\s]*?}%%(?:\r?\n|(?!\S))`. */
function directive(src: string, p: number): number | undefined {
  const q = skipBlanks(src, p)
  if (q > src.length || !src.startsWith('%%{', q)) return undefined

  let from = q + 3
  for (;;) {
    if (from > src.length) break
    const at = src.indexOf('}%%', from)
    if (at < 0) break
    const end = blockEnd(src, at + 3)
    if (end !== undefined) return end
    from = at + 1
  }
  return undefined
}

/** `[\t ]*%%[^\n\r]*`. */
function singleLineComment(src: string, p: number): number | undefined {
  const q = skipBlanks(src, p)
  if (q > src.length) return undefined
  return src.startsWith('%%', q) ? lineEnd(src, q + 2) : undefined
}

/** `text` trimmed, with each run of two or more spaces and tabs made one space. */
function single(text: string): string {
  return collapse(trim(text), isBlank, ' ')
}

/**
 * `text` with each run of two or more characters that `cls` takes replaced by `with`. `cls`
 * takes only characters in the Basic Multilingual Plane outside the surrogates, so stepping
 * over units finds the same runs.
 */
function collapse(text: string, cls: (c: number) => boolean, with_: string): string {
  const n = text.length
  let out = ''
  let from = 0
  let i = 0
  while (i < n) {
    if (!cls(charCodeAt.call(text, i))) {
      i += 1
      continue
    }
    let j = i + 1
    while (j < n && cls(charCodeAt.call(text, j))) j += 1
    if (j - i >= 2) {
      out += text.slice(from, i)
      out += with_
      from = j
    }
    i = j
  }
  return from === 0 ? text : out + text.slice(from)
}

/** The value of a `title` token: Pele's `titleValue`. Empty when `text` has no `title`. */
export function titleValue(text: string): string {
  const at = text.indexOf('title')
  if (at < 0) return ''
  const r = at + 5
  if (!(r < text.length && isBlank(text.charCodeAt(r)))) return ''
  return single(text.slice(r, lineEnd(text, r)))
}

/** The value of an `accTitle` token: Pele's `accTitleValue`. Empty when `text` has none. */
export function accTitleValue(text: string): string {
  for (let at = text.indexOf('accTitle'); at >= 0; at = text.indexOf('accTitle', at + 8)) {
    const colon = skipBlanks(text, at + 8)
    if (text.charCodeAt(colon) === 0x3a) {
      return single(text.slice(colon + 1, lineEnd(text, colon + 1)))
    }
  }
  return ''
}

/**
 * The value of an `accDescr` token: Pele's `accDescrValue`. The braced form keeps its lines,
 * without their indentation, trailing whitespace, or blank lines between them. Empty when
 * `text` has none.
 */
export function accDescrValue(text: string): string {
  for (let at = text.indexOf('accDescr'); at >= 0; at = text.indexOf('accDescr', at + 8)) {
    const r = at + 8
    const colon = skipBlanks(text, r)
    if (text.charCodeAt(colon) === 0x3a) {
      return single(text.slice(colon + 1, lineEnd(text, colon + 1)))
    }

    const brace = skipSpace(text, r)
    if (text.charCodeAt(brace) !== 0x7b) continue
    const close = text.indexOf('}', brace + 1)
    if (close < 0) continue
    let body = text.slice(brace + 1, close)
    body = stripLineEnds(stripLineStarts(body))
    body = collapse(body, isBlank, ' ')
    return collapse(body, (c) => c === 10 || c === 13, '\n')
  }
  return ''
}

/**
 * `text.replace(/^\s{0,}/gm, '')` (Pele's `/^\s` + `*` + `/gm`): whitespace removed where each line starts. A run removed this
 * way takes the blank lines after it too.
 */
function stripLineStarts(text: string): string {
  let out = ''
  let lineStart = true
  let skipping = false
  for (const c of text) {
    const code = c.codePointAt(0) as number
    if (lineStart && isSpace(code)) skipping = true
    if (skipping && isSpace(code)) {
      lineStart = isLineEnd(code)
      continue
    }
    skipping = false
    out += c
    lineStart = isLineEnd(code)
  }
  return out
}

/**
 * `text.replace(/\s+$/gm, '')`: whitespace removed where each line ends. A run of whitespace
 * keeps what follows its last line break, or goes entirely at the end of `text`.
 */
function stripLineEnds(text: string): string {
  const chars = Array.from(text)
  const space = (c: string | undefined): boolean => c !== undefined && isSpace(c.codePointAt(0) as number)
  let out = ''
  let i = 0
  while (i < chars.length) {
    const c = chars[i] as string
    if (!space(c)) {
      out += c
      i += 1
      continue
    }

    let e = i
    while (space(chars[e])) e += 1
    let keep: number
    if (e === chars.length) {
      keep = e
    } else {
      keep = i
      for (let j = e - 1; j >= i + 1; j--) {
        if (isLineEnd((chars[j] as string).codePointAt(0) as number)) {
          keep = j
          break
        }
      }
    }
    for (let j = keep; j < e; j++) out += chars[j] as string
    i = e
  }
  return out
}

/** The value of a quoted string token, with its escapes read: Pele's `stringValue`. */
export function stringValue(text: string): string {
  if (text.indexOf('\\') < 0) {
    // The text between the first and the last character, of which there must be two.
    const n = text.length
    const firstLength = n > 1 && isPair(text, 0) ? 2 : 1
    if (firstLength >= n) return ''
    const lastLength = n - 2 >= firstLength && isPair(text, n - 2) ? 2 : 1
    return text.slice(firstLength, n - lastLength)
  }
  const chars = Array.from(text)
  if (chars.length < 2) return ''
  const first = (chars[0] as string).length
  const close = text.length - (chars[chars.length - 1] as string).length
  if (!text.includes('\\')) return text.slice(first, close)

  // An escape just before the closing quote takes the quote, as in Pele.
  let out = ''
  let at = first
  let i = 1
  while (i < chars.length) {
    const c = chars[i] as string
    if (at >= close) break
    at += c.length
    i += 1
    if (c !== '\\') {
      out += c
      continue
    }
    if (i >= chars.length) break
    const next = chars[i] as string
    at += next.length
    i += 1
    switch (next) {
      case 'b':
        out += '\u0008'
        break
      case 'f':
        out += '\u000c'
        break
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 't':
        out += '\t'
        break
      case 'v':
        out += '\u000b'
        break
      case '0':
        out += '\0'
        break
      default:
        out += next
    }
  }
  return out
}

/** Whether units `at` and `at + 1` of `text` are a surrogate pair. */
function isPair(text: string, at: number): boolean {
  const high = charCodeAt.call(text, at)
  if (high < 0xd800 || high > 0xdbff) return false
  const low = charCodeAt.call(text, at + 1)
  return low >= 0xdc00 && low <= 0xdfff
}

/** Reads tokens for a hand-written parser, with Chevrotain-style messages on failure. */
export type Reader = {
  /** The diagram type errors name. */
  diagram: string
  /** Index of the current token. */
  i: number
  /** The tokens. */
  tokens: Tokens
  /** The token types the kinds index. */
  types: TokenType[]
}

/** A reader at the first token. */
export function readerNew(tokens: Tokens, types: TokenType[], diagram: string): Reader {
  return { diagram, i: 0, tokens, types }
}

/** The current token's kind. Past the end it reads as {@link EOF}, where Pele reads `undefined`. */
export function readerKind(reader: Reader): number {
  return reader.tokens.tokens[reader.i]?.kind ?? EOF
}

/** The text of the current token. */
export function readerText(reader: Reader): string {
  return readerTextAt(reader, reader.i)
}

/** The text of token `index`, or empty past the end. */
export function readerTextAt(reader: Reader, index: number): string {
  const token = reader.tokens.tokens[index]
  if (token === undefined) return ''
  const src = reader.tokens.src
  if (token.start > token.end || token.end > src.length) return ''
  return src.slice(token.start, token.end)
}

/** The UTF-16 offset where the current token starts, or the end of the source past the end. */
export function readerStart(reader: Reader): number {
  return reader.tokens.tokens[reader.i]?.start ?? reader.tokens.src.length
}

/** The current token's text, moving past it. */
export function readerTake(reader: Reader): string {
  const text = readerText(reader)
  reader.i += 1
  return text
}

/** Moves past the current token when it is of `kind`. */
export function readerAccept(reader: Reader, kind: number): boolean {
  if (readerKind(reader) !== kind) return false
  reader.i += 1
  return true
}

/**
 * The current token's text when it is of `kind`, moving past it.
 *
 * @throws {CompileError} A syntax error naming `kind` otherwise.
 */
export function readerExpect(reader: Reader, kind: number): string {
  if (readerKind(reader) !== kind) {
    const name = reader.types[kind]?.name ?? ''
    throw readerFail(reader, `token of type '${name}'`)
  }
  return readerTake(reader)
}

/** A syntax error at the current token: `Expecting {expected} but found ...`. */
export function readerFail(reader: Reader, expected: string): CompileError {
  let detail = `Expecting ${expected} but found `
  if (readerKind(reader) === EOF) detail += 'end of input'
  else detail += `\`${readerText(reader)}\``
  detail += '.'
  return errorSyntax(reader.diagram, reader.tokens.src, readerStart(reader), detail, false)
}
