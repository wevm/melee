/**
 * @module What the four railroad grammars share: the title and accessibility tokens (which, unlike
 * the ones in Mermaid's common grammar, do not take leading blanks), the hidden tokens, the
 * statements before the first rule, string values, and the walk from a syntax tree to the rule
 * model. Port of Pele's `src/diagrams/railroad/common.ts`.
 */
import {
  accDescrValue,
  accTitleValue,
  EOF,
  keyword,
  literal,
  type Memo,
  type Reader,
  readerExpect,
  readerKind,
  readerNew,
  readerTake,
  STRING,
  type TokenType,
  titleValue,
  tokenize,
} from '../common/tokens.ts'
import { isSpace } from '../../util/chars.ts'
import { type RailroadNode, type RailroadRule } from './types.ts'

/** The ASCII letters. */
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** The ASCII letters and `_`. */
const LETTERS_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'

/** An index that names no node, as Rust's `usize::MAX` does. */
export const NONE = Number.MAX_SAFE_INTEGER

/** Where the line from `at` ends: at `\n`, `\r`, or `%%`. */
function toComment(src: string, at: number): number {
  let i = at
  const n = src.length
  while (i < n) {
    const c = src.charCodeAt(i)
    if (c === 0x0a || c === 0x0d || (c === 0x25 && src.charCodeAt(i + 1) === 0x25)) break
    i += 1
  }
  return i
}

/** Whether the UTF-16 unit at `at` is a space or a tab. */
function isBlankAt(src: string, at: number): boolean {
  const c = src.charCodeAt(at)
  return c === 0x20 || c === 0x09
}

/** `title(?:[\t ][^\n\r]*?(?=%%)|[\t ][^\n\r]*|)`. */
function title(src: string, at: number): number | undefined {
  if (at > src.length || !src.startsWith('title', at)) return undefined
  const r = at + 5
  if (isBlankAt(src, r)) return toComment(src, r + 1)
  return r
}

/** `accTitle[\t ]*:(?:[^\n\r]*?(?=%%)|[^\n\r]*)`. */
function accTitle(src: string, at: number): number | undefined {
  if (at > src.length || !src.startsWith('accTitle', at)) return undefined
  let i = at + 8
  while (isBlankAt(src, i)) i += 1
  return src.charCodeAt(i) === 0x3a ? toComment(src, i + 1) : undefined
}

/**
 * `accDescr(?:[\t ]*:([^\n\r]*?(?=%%)|[^\n\r]*)|\s*{([^}]*)})`. The braced form scans to the
 * next closing brace. Once none is found, none exists further on either, so later braced
 * descriptions fail without scanning again. `memo[0]` is one past the brace that found none.
 */
function accDescr(src: string, at: number, memo: Memo): number | undefined {
  if (at > src.length || !src.startsWith('accDescr', at)) return undefined
  let i = at + 8
  while (isBlankAt(src, i)) i += 1
  if (src.charCodeAt(i) === 0x3a) return toComment(src, i + 1)
  // Every character `\s` matches is in the Basic Multilingual Plane, so stepping by units is
  // stepping by characters.
  while (i < src.length && isSpace(src.charCodeAt(i))) i += 1
  const m0 = memo[0] as number
  if (src.charCodeAt(i) !== 0x7b || (m0 !== 0 && i + 1 >= m0)) return undefined
  const close = src.indexOf('}', i + 1)
  if (close < 0) {
    memo[0] = i + 1
    return undefined
  }
  return close + 1
}

/** The railroad `title` token type. */
export const TITLE: TokenType = {
  ...literal(''),
  first: 't',
  name: 'TITLE',
  pattern: { kind: 'Match', _0: title },
}

/** The railroad `accTitle` token type. */
export const ACC_TITLE: TokenType = {
  ...literal(''),
  first: 'a',
  name: 'ACC_TITLE',
  pattern: { kind: 'Match', _0: accTitle },
}

/** The railroad `accDescr` token type. */
export const ACC_DESCR: TokenType = {
  ...literal(''),
  first: 'a',
  name: 'ACC_DESCR',
  pattern: { kind: 'Scan', _0: accDescr },
}

/** A literal token type with longer alternatives. */
export function word(name: string, longer: number[]): TokenType {
  return { ...literal(name), longer }
}

/** The diagram's keyword. A name that starts with it and goes on is a name. */
export function opening(word: string, name: number[]): TokenType {
  return { ...keyword(word), longer: name }
}

/** Whether `c` is an ASCII letter. */
function isAsciiAlpha(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
}

/** Whether `c` is an ASCII letter or digit. */
function isAsciiAlnum(c: number): boolean {
  return isAsciiAlpha(c) || (c >= 0x30 && c <= 0x39)
}

/** `[A-Z_a-z][\w-]*`. */
function identifierEnd(src: string, at: number): number | undefined {
  if (at >= src.length) return undefined
  const first = src.charCodeAt(at)
  if (!(isAsciiAlpha(first) || first === 0x5f)) return undefined
  let i = at + 1
  while (i < src.length) {
    const b = src.charCodeAt(i)
    if (!(isAsciiAlnum(b) || b === 0x5f || b === 0x2d)) break
    i += 1
  }
  return i
}

/** An identifier token type: `[A-Z_a-z][\w-]*`. */
export function identifier(name: string): TokenType {
  return {
    ...literal(''),
    first: LETTERS_,
    name,
    pattern: { kind: 'Match', _0: identifierEnd },
  }
}

/** A quoted string token type: `"([^"\\]|\\.)*"|'([^'\\]|\\.)*'`. */
export function quoted(name: string): TokenType {
  return { ...STRING, name }
}

/** `[\t \r\n]+`. */
function whitespaceEnd(src: string, at: number): number | undefined {
  let i = at
  while (i < src.length) {
    const c = src.charCodeAt(i)
    if (!(c === 0x09 || c === 0x20 || c === 0x0d || c === 0x0a)) break
    i += 1
  }
  return i > at ? i : undefined
}

/** The hidden whitespace token type every railroad grammar lists first among its hidden tokens. */
export function whitespace(name: string): TokenType {
  return {
    ...literal(''),
    first: '\t \r\n',
    hidden: true,
    name,
    pattern: { kind: 'Match', _0: whitespaceEnd },
  }
}

/** `\/\*`. */
export function blockCommentOpener(src: string, at: number): boolean {
  return at <= src.length && src.startsWith('/*', at)
}

/** `\/\*[\s\S]*?\*\/`. */
export function blockComment(src: string, at: number): number | undefined {
  if (!blockCommentOpener(src, at)) return undefined
  const close = src.indexOf('*/', at + 2)
  if (close < 0) return undefined
  return close + 2
}

/** `text` without its first and last characters. */
function inner(text: string): string {
  const n = text.length
  // The first character is a surrogate pair when a high surrogate starts it and a low one
  // follows; the last is one when it ends with a low surrogate after a high one.
  let start = 1
  const head = text.charCodeAt(0)
  if (head >= 0xd800 && head <= 0xdbff && n > 1) {
    const next = text.charCodeAt(1)
    if (next >= 0xdc00 && next <= 0xdfff) start = 2
  }
  let end = n - 1
  const tail = text.charCodeAt(n - 1)
  if (tail >= 0xdc00 && tail <= 0xdfff && n > 1) {
    const before = text.charCodeAt(n - 2)
    if (before >= 0xd800 && before <= 0xdbff) end = n - 2
  }
  return end > start ? text.slice(start, end) : ''
}

/** A string token without its quotes, the first and last characters, which are ASCII quotes. */
export function unquote(text: string): string {
  return inner(text)
}

/**
 * Mermaid's railroad value converters know three escapes; any other escaped character stands
 * for itself. A backslash just before the closing quote stays.
 */
export function unescape(text: string): string {
  if (!text.includes('\\')) return unquote(text)
  const chars = Array.from(inner(text))
  let out = ''
  let i = 0
  while (i < chars.length) {
    const c = chars[i] as string
    i += 1
    if (c === '\\' && i < chars.length) {
      const next = chars[i] as string
      i += 1
      out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next
    } else {
      out += c
    }
  }
  return out
}

/** The statements before the first rule, and the rules: Pele's `Grammar`. */
export type Grammar<R> = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** Rules in authored order. */
  rules: R[]
  /** The `title` value, unquoted. */
  title: string | undefined
}

/**
 * Parses the keyword, then any titles and accessibility statements, then rules to the end of
 * the text. Every table starts with its keyword and has `TITLE`, `ACC_TITLE`, and `ACC_DESCR`
 * in a row from `meta`.
 *
 * Throws a syntax error where the source leaves the grammar.
 */
export function parseGrammar<R>(
  src: string,
  types: TokenType[],
  meta: number,
  unquote: (text: string) => string,
  rule: (r: Reader) => R,
): Grammar<R> {
  const r = readerNew(tokenize(src, types, 'railroad'), types, 'railroad')
  const ast: Grammar<R> = { accDescr: undefined, accTitle: undefined, rules: [], title: undefined }
  readerExpect(r, 0)
  for (;;) {
    const kind = readerKind(r)
    if (kind === meta) {
      const title = titleValue(readerTake(r))
      const quote = title.charCodeAt(0)
      const quoted = (quote === 0x22 || quote === 0x27) && title.charCodeAt(title.length - 1) === quote
      ast.title = quoted ? unquote(title) : title
    } else if (kind === meta + 1) {
      ast.accTitle = accTitleValue(readerTake(r))
    } else if (kind === meta + 2) {
      ast.accDescr = accDescrValue(readerTake(r))
    } else {
      break
    }
  }
  while (readerKind(r) !== EOF) ast.rules.push(rule(r))
  return ast
}

/** A node of a grammar's syntax tree: its kind and its parts, as indices into the same tree. */
export type AstNode<K> = {
  /** What the node is. */
  kind: K
  /** The node's parts, in order. */
  parts: number[]
}

/** Adds a node of `kind` without parts to `ast`, returning its index. */
export function add<K>(ast: AstNode<K>[], kind: K): number {
  ast.push({ kind, parts: [] })
  return ast.length - 1
}

/** Adds `part` to the parts of node `node` of `ast`. */
export function attach<K>(ast: AstNode<K>[], node: number, part: number): void {
  ast[node]?.parts.push(part)
}

/**
 * Rebuilds a tree bottom-up without recursion, so that nesting depth is bounded by memory, not
 * by the stack. `children` gives a node's parts and `build` makes a node's result from its
 * parts' results.
 */
export function fold<R>(
  root: number,
  children: (node: number) => number[],
  build: (node: number, results: R[]) => R,
): R {
  const nodes: number[] = [root]
  const lists: number[][] = [children(root)]
  const done: R[][] = [[]]
  for (;;) {
    const list = lists[lists.length - 1]
    const results = done[done.length - 1]
    if (list === undefined || results === undefined) break
    const child = list[results.length]
    if (child !== undefined) {
      nodes.push(child)
      lists.push(children(child))
      done.push([])
      continue
    }
    if (nodes.length === 1) break
    const node = nodes.pop() as number
    const kids = done.pop() as R[]
    lists.pop()
    const value = build(node, kids)
    done[done.length - 1]?.push(value)
  }
  return build(root, done.pop() ?? [])
}

/** Adds `node` to `nodes`, returning its index. */
export function push(nodes: RailroadNode[], node: RailroadNode): number {
  nodes.push(node)
  return nodes.length - 1
}

/** A sequence of `elements`. A sequence of one is that one, in every notation. */
export function sequence(nodes: RailroadNode[], elements: number[]): number {
  if (elements.length === 1) return elements[0] as number
  return push(nodes, { kind: 'Sequence', _0: elements })
}

/** A choice of `alternatives`. A choice of one is that one, in every notation. */
export function choice(nodes: RailroadNode[], alternatives: number[]): number {
  if (alternatives.length === 1) return alternatives[0] as number
  return push(nodes, { kind: 'Choice', _0: alternatives })
}

/** An optional `element`. */
export function optional(nodes: RailroadNode[], element: number): number {
  return push(nodes, { kind: 'Optional', _0: element })
}

/** `element` repeated at least `min` times, without bound. */
export function repetition(nodes: RailroadNode[], element: number, min: number): number {
  return push(nodes, { kind: 'Repetition', element, max: Number.POSITIVE_INFINITY, min })
}

/** The first part's result, which every node with parts has. */
export function first(kids: number[]): number {
  return kids[0] ?? NONE
}

/**
 * Turns each rule's syntax tree in `ast` into the common model, given how one node is built
 * from its parts: Pele's `toRules`.
 */
export function toRules<K>(
  ast: AstNode<K>[],
  rules: [string, number][],
  nodes: RailroadNode[],
  build: (kind: K, kids: number[], nodes: RailroadNode[]) => number,
): RailroadRule[] {
  return rules.map(([name, definition]) => ({
    definition: fold<number>(
      definition,
      (node) => ast[node]?.parts ?? [],
      (node, kids) => {
        const part = ast[node]
        return part === undefined ? NONE : build(part.kind, kids, nodes)
      },
    ),
    name,
  }))
}
