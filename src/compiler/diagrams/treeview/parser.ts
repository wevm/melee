/**
 * @module The tree view parser: Mermaid's Langium tree view grammar over the shared tokenizer. Port
 * of Pele's `src/diagrams/treeview/parser.ts`.
 */
import { accDescr } from '../common/acc_descr.ts'
import {
  ACC_TITLE,
  EOF,
  type Matcher,
  type Memo,
  type Reader,
  TITLE,
  type TokenType,
  accDescrValue,
  accTitleValue,
  keyword,
  literal,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerTake,
  skipBlanks,
  titleValue,
  tokenize,
} from '../common/tokens.ts'
import { trim } from '../../text/label.ts'
import { isBlank } from '../../util/chars.ts'

/** Token kinds, as indices into {@link TREEVIEW_TOKENS}. */
const t = {
  KEYWORD: 0,
  ACC_DESCR: 1,
  ACC_TITLE: 2,
  TITLE: 3,
  CLASS_ANNOTATION: 4,
  ICON_ANNOTATION: 5,
  DESC_ANNOTATION: 6,
  INDENTATION: 7,
  QUOTED_NAME: 8,
  BARE_NAME: 12,
} as const

/** Whether an ASCII letter or `_` is at `at`. */
function letterAt(src: string, at: number): boolean {
  if (at >= src.length) return false
  const b = src.charCodeAt(at)
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f
}

/** Whether `[\w-]` is the unit `b`. */
function wordOrDash(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x2d
}

/** Where a run of `[\w-]` from `at` ends. */
function skipWord(src: string, at: number): number {
  let i = at
  while (i < src.length && wordOrDash(src.charCodeAt(i))) i += 1
  return i
}

/**
 * Whether an annotation starts at `at`, once the blanks before it are read: `##`, `icon(`, or
 * `:::` and a class name.
 */
function annotationAt(src: string, at: number): boolean {
  if (at > src.length) return false
  if (src.startsWith('##', at) || src.startsWith('icon(', at)) return true
  if (!src.startsWith(':::', at)) return false
  return letterAt(src, skipBlanks(src, at + 3))
}

/**
 * `(?!:::|icon\(|##)[^ \t\n\r"'](?:(?![ \t]+:::[ \t]*[A-Za-z_]|[ \t]+icon\(|[ \t]+##)[^\n\r])*`.
 * The pattern looks ahead from every blank for an annotation, which rescans long runs of
 * blanks. This looks once per run.
 */
function bareName(src: string, at: number): number | undefined {
  if (at >= src.length) return undefined
  const first = src.codePointAt(at) as number
  if (isBlank(first) || first === 0x0a || first === 0x0d || first === 0x22 || first === 0x27) return undefined
  if (src.startsWith(':::', at) || src.startsWith('icon(', at) || src.startsWith('##', at)) return undefined

  let i = at + (first > 0xffff ? 2 : 1)
  while (i < src.length) {
    const c = src.charCodeAt(i)
    if (c === 0x0a || c === 0x0d) break
    if (isBlank(c)) {
      const j = skipBlanks(src, i + 1)
      if (annotationAt(src, j)) break
      i = j
    } else {
      i += 1
    }
  }
  // Every stop is at an ASCII unit or the end, so `i` is a character boundary.
  return i
}

/**
 * The tokenizer tries the annotations and the indentation one after another at the same place,
 * and each starts with the same run of blanks. The last run read is kept, for one source.
 */
let runSrc = ''
let runAt = -1
let runEnd = 0

/** {@link skipBlanks}, remembering the last run. */
function blankRun(src: string, at: number): number {
  if (at === runAt && src === runSrc) return runEnd
  const end = skipBlanks(src, at)
  runSrc = src
  runAt = at
  runEnd = end
  return end
}

/** `[ \t]+:::[ \t]*[A-Za-z_][\w-]*`. */
function classAnnotation(src: string, at: number): number | undefined {
  const q = blankRun(src, at)
  if (q === at || !src.startsWith(':::', q)) return undefined
  const r = skipBlanks(src, q + 3)
  return letterAt(src, r) ? skipWord(src, r + 1) : undefined
}

/** `[ \t]+icon\([\w-]*(?::[\w-]+)?\)`. */
function iconAnnotation(src: string, at: number): number | undefined {
  const q = blankRun(src, at)
  if (q === at || !src.startsWith('icon(', q)) return undefined
  let i = skipWord(src, q + 5)
  if (src.charCodeAt(i) === 0x3a) {
    const j = skipWord(src, i + 1)
    if (j === i + 1) return undefined
    i = j
  }
  return src.charCodeAt(i) === 0x29 ? i + 1 : undefined
}

/** `[ \t]+##[^\n\r]*`. */
function descAnnotation(src: string, at: number): number | undefined {
  const q = blankRun(src, at)
  if (q === at || !src.startsWith('##', q)) return undefined
  return lineEnd(src, q + 2)
}

/** Where the line from `at` ends: at the first `\n` or `\r`, or the end of `src`. */
function lineEnd(src: string, at: number): number {
  for (let i = at; i < src.length; i++) {
    const c = src.charCodeAt(i)
    if (c === 0x0a || c === 0x0d) return i
  }
  return src.length
}

/** `[ \t]{1,}`, and `[ \t]+`. */
function blanks(src: string, at: number): number | undefined {
  const end = blankRun(src, at)
  return end > at ? end : undefined
}

/** `"[^"]*"|'[^']*'`. */
function quotedName(src: string, at: number): number | undefined {
  if (at >= src.length) return undefined
  const quote = src.charCodeAt(at)
  if (quote !== 0x22 && quote !== 0x27) return undefined
  const close = src.indexOf(String.fromCharCode(quote), at + 1)
  return close < 0 ? undefined : close + 1
}

/** `%%[^\n]*`. */
function comment(src: string, at: number): number | undefined {
  if (at > src.length || !src.startsWith('%%', at)) return undefined
  const found = src.indexOf('\n', at + 2)
  return found < 0 ? src.length : found
}

/** `\r?\n`. */
function newline(src: string, at: number): number | undefined {
  const p = src.charCodeAt(at) === 0x0d ? at + 1 : at
  return src.charCodeAt(p) === 0x0a ? p + 1 : undefined
}

/** A token type with a hand-written matcher. */
function matched(name: string, first: string | undefined, matcher: Matcher): TokenType {
  return {
    ...literal(''),
    first,
    name,
    pattern: { kind: 'Match', _0: matcher },
  }
}

/**
 * `ty`, a `Match` type whose text after the blanks it starts with begins with `word`, tried only
 * where it does. The blanks are the run {@link blankRun} keeps for the types after it.
 */
function afterBlanks(ty: TokenType, word: string): TokenType {
  if (ty.pattern.kind !== 'Match') throw new Error('unreachable: a matcher')
  const inner = ty.pattern._0
  const match = (src: string, at: number): number | undefined =>
    src.startsWith(word, blankRun(src, at)) ? inner(src, at) : undefined
  return { ...ty, pattern: { kind: 'Match', _0: match } }
}

/** {@link afterBlanks} for a `Scan` type, which leaves its memory alone where it cannot start. */
function scanAfterBlanks(ty: TokenType, word: string): TokenType {
  if (ty.pattern.kind !== 'Scan') throw new Error('unreachable: a scanner')
  const inner = ty.pattern._0
  const scan = (src: string, at: number, memo: Memo): number | undefined =>
    src.startsWith(word, blankRun(src, at)) ? inner(src, at, memo) : undefined
  return { ...ty, pattern: { kind: 'Scan', _0: scan } }
}

/** Pele's `TREEVIEW_TOKENS`, in matching order. */
export const TREEVIEW_TOKENS: TokenType[] = [
  { ...keyword('treeView-beta'), longer: [t.BARE_NAME] },
  scanAfterBlanks(accDescr('ACC_DESCR'), 'accDescr'),
  afterBlanks(ACC_TITLE, 'accTitle'),
  afterBlanks(TITLE, 'title'),
  matched('CLASS_ANNOTATION', '\t ', classAnnotation),
  matched('ICON_ANNOTATION', '\t ', iconAnnotation),
  matched('DESC_ANNOTATION', '\t ', descAnnotation),
  matched('INDENTATION', '\t ', blanks),
  matched('QUOTED_NAME', '"\'', quotedName),
  { ...matched('WS', '\t ', blanks), hidden: true },
  { ...matched('ML_COMMENT', '%', comment), hidden: true },
  { ...matched('NL', '\r\n', newline), hidden: true },
  matched('BARE_NAME', undefined, bareName),
]

/** A tree node as written: Pele's `TreeNodeAst`. */
export type TreeNodeAst = {
  /** The `:::` class, when one is given. */
  classAnnotation: string | undefined
  /** The `##` description, when one is given. */
  descAnnotation: string | undefined
  /** The `icon()` name, when one is given. */
  iconAnnotation: string | undefined
  /** The width of the indentation, when the line is indented. */
  indent: number | undefined
  /** The name. */
  name: string
}

/** The parsed tree view: Pele's `TreeViewAst`. */
export type TreeViewAst = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** Nodes in authored order. */
  nodes: TreeNodeAst[]
  /** The `title` value. */
  title: string | undefined
}

/** `text` without the spaces and tabs it ends with. */
function trimBlanksEnd(text: string): string {
  let end = text.length
  while (end > 0 && isBlank(text.charCodeAt(end - 1))) end -= 1
  return text.slice(0, end)
}

/** The `:::` class of a `CLASS_ANNOTATION` token, as Mermaid's value converter reads it. */
function classValue(text: string): string {
  return trim(trim(text).slice(3))
}

/** The icon name of an `ICON_ANNOTATION` token. */
function iconValue(text: string): string {
  const trimmed = trim(text)
  const end = Math.max(trimmed.length - 1, 0)
  return end < 5 ? '' : trimmed.slice(5, end)
}

/** The description of a `DESC_ANNOTATION` token. */
function descValue(text: string): string {
  return trim(trim(text).slice(2))
}

/**
 * Parses tree view `src` as Pele's `parseTreeView` does.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function parseTreeView(src: string): TreeViewAst {
  const tokens = tokenize(src, TREEVIEW_TOKENS, 'treeView')
  // Let go of the source the blank runs were read from.
  runSrc = ''
  runAt = -1
  const r: Reader = readerNew(tokens, TREEVIEW_TOKENS, 'treeView')
  const ast: TreeViewAst = { accDescr: undefined, accTitle: undefined, nodes: [], title: undefined }
  readerExpect(r, t.KEYWORD)
  for (;;) {
    const kind = readerKind(r)
    if (kind === t.ACC_DESCR) ast.accDescr = accDescrValue(readerTake(r))
    else if (kind === t.ACC_TITLE) ast.accTitle = accTitleValue(readerTake(r))
    else if (kind === t.TITLE) ast.title = titleValue(readerTake(r))
    else break
  }

  while (readerKind(r) !== EOF) {
    const node: TreeNodeAst = {
      classAnnotation: undefined,
      descAnnotation: undefined,
      iconAnnotation: undefined,
      indent: undefined,
      name: '',
    }
    if (readerKind(r) === t.INDENTATION) node.indent = readerTake(r).length
    const kind = readerKind(r)
    if (kind === t.QUOTED_NAME) {
      const text = readerTake(r)
      node.name = text.slice(1, Math.max(text.length - 1, 0))
    } else if (kind === t.BARE_NAME) {
      node.name = trimBlanksEnd(readerTake(r))
    } else {
      throw readerFail(r, 'a name')
    }
    for (;;) {
      const k = readerKind(r)
      if (k === t.CLASS_ANNOTATION) node.classAnnotation = classValue(readerTake(r))
      else if (k === t.ICON_ANNOTATION) node.iconAnnotation = iconValue(readerTake(r))
      else if (k === t.DESC_ANNOTATION) node.descAnnotation = descValue(readerTake(r))
      else break
    }
    ast.nodes.push(node)
  }
  return ast
}
