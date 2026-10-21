/** @module Errors reported to callers, with Mermaid-compatible messages and UTF-16 source positions. */
import type { Buf } from './util/rust.ts'

/** The kind of failure, mirroring Pele's `PeleErrorCode`. */
export const Code = {
  /** A configured limit was exceeded. */
  Limit: 'limit',
  /** The source parsed but describes something invalid. */
  Semantic: 'semantic',
  /** The source does not match the diagram's grammar. */
  Syntax: 'syntax',
  /** No supported diagram type was detected. */
  UnsupportedDiagram: 'unsupported-diagram',
} as const

/** The kind of failure. */
export type Code = (typeof Code)[keyof typeof Code]

/** The code as the public API reports it. */
export function codeAsStr(code: Code): string {
  return code
}

/** A compile error. Messages are public contract and match Pele's wording. */
export class CompileError extends Error {
  override name = 'CompileError'

  /** The kind of failure. */
  code: Code
  /** One-based UTF-16 column, or 0 when the error has no position. */
  column = 0
  /** One-based line, or 0 when the error has no position. */
  line = 0
  /** The offending source line with a caret under the column, or empty. */
  snippet = ''
  /** The detected diagram type, when known. */
  type: string | undefined = undefined

  constructor(code: Code, message: string) {
    super(message)
    this.code = code
  }
}

/** Creates an error without a source position. */
export function errorNew(code: Code, message: string): CompileError {
  return new CompileError(code, message)
}

/**
 * Creates a syntax error at a UTF-16 `offset` of `src`, as Pele's `syntaxError` does. Lexical
 * errors report unrecognized text and omit `detail`.
 */
export function errorSyntax(
  type: string,
  src: string,
  offset: number,
  detail: string,
  lexical: boolean,
): CompileError {
  const location = locate(src, offset)

  const message = lexical
    ? `Lexical error on line ${location.line}. Unrecognized text.\n${location.snippet}`
    : `Parse error on line ${location.line}:\n${location.snippet}\n${detail}`

  const error = new CompileError(Code.Syntax, message)
  error.column = location.column
  error.line = location.line
  error.snippet = location.snippet
  error.type = type
  return error
}

/** A source position for diagnostics. */
export type Location = {
  column: number
  line: number
  snippet: string
}

/** Finds the line, UTF-16 column, and caret snippet for a UTF-16 offset. */
export function locate(src: string, offset: number): Location {
  offset = floorBoundary(src, Math.min(offset, src.length))
  const start = offset === 0 ? 0 : src.lastIndexOf('\n', offset - 1) + 1
  const found = src.indexOf('\n', offset)
  const end = found < 0 ? src.length : found
  let line = 1
  for (let at = src.indexOf('\n'); at >= 0 && at < offset; at = src.indexOf('\n', at + 1)) line++
  const width = offset - start

  return {
    column: width + 1,
    line,
    snippet: `${src.slice(start, end)}\n${'-'.repeat(width)}^`,
  }
}

/** Moves an offset inside a surrogate pair back to the pair's start, as a UTF-8 offset inside a scalar moves to its start. */
function floorBoundary(src: string, offset: number): number {
  if (offset > 0 && offset < src.length) {
    const c = src.charCodeAt(offset)
    const before = src.charCodeAt(offset - 1)
    if (c >= 0xdc00 && c <= 0xdfff && before >= 0xd800 && before <= 0xdbff) return offset - 1
  }
  return offset
}

/** Appends a decimal integer. */
export function pushU32(out: Buf, value: number): void {
  out.s += String(value)
}

/** A decimal integer, as `push_u32` writes it. */
export function u32(value: number): string {
  return String(value)
}
