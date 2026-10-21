/**
 * @module Mermaid's box-drawing preprocessor: turns `├──`, `└──`, `│` (and the heavy variants) into
 * the indentation the grammar reads. Port of Pele's `src/diagrams/treeview/boxDrawing.ts`.
 */
import { Code, type CompileError, errorNew, pushU32 } from '../../error.ts'
import { jsRound } from '../../svg/builder.ts'
import { trim, trimEnd } from '../../text/label.ts'
import { isBlank, isSpace } from '../../util/chars.ts'
import { asUint, buf, eqIgnoreAsciiCase } from '../../util/rust.ts'

// Every box-drawing character here is in the Basic Multilingual Plane, and no surrogate is one
// or is JavaScript's `\s`, so testing UTF-16 units tests characters.

/** `[─━│┃└┗├┣]`, by UTF-16 unit. */
function isBox(c: number): boolean {
  return (c >= 0x2500 && c <= 0x2503) || c === 0x2514 || c === 0x2517 || c === 0x251c || c === 0x2523
}

/** `[└┗├┣]`, by UTF-16 unit. */
function isBranch(c: number): boolean {
  return c === 0x2514 || c === 0x2517 || c === 0x251c || c === 0x2523
}

/** `[─━]`, by UTF-16 unit. */
function isDash(c: number): boolean {
  return c === 0x2500 || c === 0x2501
}

/** `[─━│┃└┗├┣]`. */
const BOX = /[\u2500-\u2503\u2514\u2517\u251c\u2523]/

/** Whether `text` has a box-drawing character. */
function hasBox(text: string): boolean {
  return BOX.test(text)
}

/** `^[\s│┃]+$`. */
function decorationOnly(line: string): boolean {
  if (line === '') return false
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i)
    if (!(isSpace(c) || c === 0x2502 || c === 0x2503)) return false
  }
  return true
}

/** `^[\s─━│┃└┗├┣]+$`. */
function boxOnly(line: string): boolean {
  if (line === '') return false
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i)
    if (!(isSpace(c) || isBox(c))) return false
  }
  return true
}

/** `text` without the JavaScript `\s` it starts with. */
function trimSpaceStart(text: string): string {
  let at = 0
  while (at < text.length && isSpace(text.charCodeAt(at))) at += 1
  return text.slice(at)
}

/** `^\s*(title[\t ]|accTitle[\t ]*:|accDescr[\t ]*[:{])`. */
function metadataLine(line: string): boolean {
  const rest = trimSpaceStart(line)
  const afterBlanks = (word: string, then: string): boolean => {
    if (!rest.startsWith(word)) return false
    let at = word.length
    while (at < rest.length && isBlank(rest.charCodeAt(at))) at += 1
    return at < rest.length && then.includes(rest.charAt(at))
  }
  return (
    (rest.startsWith('title') && rest.length > 5 && isBlank(rest.charCodeAt(5))) ||
    afterBlanks('accTitle', ':') ||
    afterBlanks('accDescr', ':{')
  )
}

/** `^\s*%%`. */
function commentLine(line: string): boolean {
  return trimSpaceStart(line).startsWith('%%')
}

/** A line that goes through unchanged: blank, a comment, or a title or accessibility statement. */
function passes(line: string): boolean {
  return trim(line) === '' || commentLine(line) || metadataLine(line)
}

/** `line.replace(/\t/g, '    ')`. */
function untab(line: string): string {
  return line.indexOf('\t') < 0 ? line : line.replaceAll('\t', '    ')
}

/** The UTF-16 index of the first branch character of `line`. */
function branchAt(line: string): number | undefined {
  for (let at = 0; at < line.length; at++) {
    if (isBranch(line.charCodeAt(at))) return at
  }
  return undefined
}

/** Pele's `inferSegmentWidth`: where the first branch not at a line's start is, or 4. */
function inferSegmentWidth(content: string[]): number {
  for (const line of content) {
    const index = branchAt(line)
    if (index !== undefined && index > 0) return index
  }
  return 4
}

/**
 * The text after preprocessing, and each output line's original line, both from 1. The map is
 * empty when the text is unchanged.
 */
export type Preprocessed = {
  /** Output line number to original line number, in output order. */
  lineMap: [number, number][]
  /** The text the grammar reads. */
  text: string
}

/** The original line of output line `line`. */
export function preprocessedOriginal(pre: Preprocessed, line: number): number | undefined {
  return pre.lineMap.find(([out]) => out === line)?.[1]
}

/** Whether the ASCII letter, digit or `_` is the unit `b`. */
function isWordUnit(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f
}

/**
 * `message.replace(/\bline\s+(\d+)\b/gi, ...)`: each mention of a line the map knows names the
 * original line instead.
 */
export function remapErrorLines(message: string, pre: Preprocessed): string {
  const n = message.length
  const word = (at: number): boolean => at < n && isWordUnit(message.charCodeAt(at))
  const isDigit = (at: number): boolean => {
    const c = message.charCodeAt(at)
    return c >= 0x30 && c <= 0x39
  }
  const out = buf()
  let copied = 0
  let at = 0
  while (at < n) {
    const hit = at + 4 <= n && eqIgnoreAsciiCase(message.slice(at, at + 4), 'line') && (at === 0 || !word(at - 1))
    if (!hit) {
      at += 1
      continue
    }

    let digits = at + 4
    while (digits < n && isSpace(message.charCodeAt(digits))) digits += 1
    let end = digits
    while (end < n && isDigit(end)) end += 1
    if (digits === at + 4 || end === digits || word(end)) {
      at += 1
      continue
    }

    const text = message.slice(digits, end)
    // `str::parse::<u32>`: too many digits do not parse.
    const value = Number(text)
    const original = value <= 4294967295 ? preprocessedOriginal(pre, value) : undefined
    if (original !== undefined) {
      out.s += message.slice(copied, at)
      out.s += 'line '
      pushU32(out, original)
      copied = end
    }
    at = end
  }
  out.s += message.slice(copied)
  return out.s
}

/** A syntax error on original line `line`. */
function fail(line: number, message: string): CompileError {
  const l = Math.min(line, 4294967295)
  const text = buf('Line ')
  pushU32(text, l)
  text.s += ': '
  text.s += message
  const error = errorNew(Code.Syntax, text.s)
  error.line = l
  error.type = 'treeView'
  return error
}

/**
 * Rewrites box-drawing input as indented lines, as Pele's `preprocessBoxDrawing` does.
 *
 * @throws {CompileError} A syntax error for a branch with no name after it, or an indented line
 * without box-drawing characters.
 */
export function preprocessBoxDrawing(input: string): Preprocessed {
  const unchanged = (): Preprocessed => ({ lineMap: [], text: input })
  if (!hasBox(input)) return unchanged()
  const lines = input.split('\n')

  const keyword = lines.findIndex((line) => trim(line) === 'treeView-beta')
  if (keyword < 0) return unchanged()
  const rest = lines.slice(keyword + 1)

  const content = rest.filter((line) => !passes(line) && !decorationOnly(line)).map(untab)
  if (!content.some(hasBox)) return unchanged()

  const segment = inferSegmentWidth(content)
  const out: string[] = []
  const lineMap: [number, number][] = []
  const keep = (text: string, index: number): void => {
    out.push(text)
    lineMap.push([out.length, index + 1])
  }

  for (let i = 0; i <= keyword; i++) keep(lines[i] as string, i)
  for (let i = keyword + 1; i < lines.length; i++) {
    const line = lines[i] as string
    if (passes(line)) {
      keep(line, i)
      continue
    }
    if (decorationOnly(line)) continue

    const normalized = untab(line)
    const index = branchAt(normalized)
    if (index !== undefined) {
      const depth = asUint(jsRound(index / segment) + 1)
      let tail = normalized.slice(index + 1)
      let start = 0
      while (start < tail.length && isDash(tail.charCodeAt(start))) start += 1
      while (start < tail.length && tail.charCodeAt(start) === 0x20) start += 1
      tail = tail.slice(start)
      const text = trimEnd(tail)
      if (text === '') {
        throw fail(i + 1, 'Empty node — expected a filename or directory name after the box-drawing prefix')
      }
      keep('    '.repeat(depth) + text, i)
    } else if (boxOnly(normalized)) {
      // Decoration only.
    } else if (hasBox(normalized)) {
      // A name that happens to contain a box character, such as "Section ─ A.txt", is a
      // root item.
      keep(line, i)
    } else if (normalized.length > 0 && isSpace(normalized.codePointAt(0) as number)) {
      throw fail(
        i + 1,
        'Unexpected indentation without box-drawing characters. In box-drawing format, use ├── or └── prefixes for indented nodes.',
      )
    } else {
      keep(line, i)
    }
  }
  return { lineMap, text: out.join('\n') }
}
