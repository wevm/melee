/**
 * @module The tokens of Mermaid's Chevrotain lexer for use case diagrams, and source positions for
 * errors. Port of Pele's `src/diagrams/usecase/lexer.ts`.
 *
 * Offsets are UTF-16 units. Every character the lexer tests is ASCII, so a unit outside ASCII
 * fails each test as it does in Mermaid. Positions in messages are UTF-16.
 */
import { T } from './tokens.ts'
import { Code, CompileError, pushU32 } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { isBlank, isDigit, isHex, isLetter, isWord } from '../../util/chars.ts'
import type { Buf } from '../../util/rust.ts'

/** A token: its type and its range in the source. */
export type Tok = {
  /** End offset, exclusive. */
  end: number
  /** Token type. */
  kind: T
  /** Start offset. */
  start: number
}

/**
 * `String.prototype.charCodeAt`, called through a module-local constant so the optimizer reads the
 * character directly whatever internal kind the source string is (see `text/measure.ts`).
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** The unit at `i`, or a value no test matches past the end, as `charCodeAt` gives `NaN`. */
function at(b: string, i: number): number {
  return i < b.length ? charCodeAt.call(b, i) : 4294967295
}

/** Whether `word` is at `i`. */
function starts(b: string, i: number, word: string): boolean {
  return b.startsWith(word, i)
}

/** Mermaid's INCLUDE and EXTEND are the only keywords matched without regard to case. */
function startsNoCase(b: string, i: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) {
    if ((at(b, i + k) | 32) >>> 0 !== word.charCodeAt(k)) return false
  }
  return true
}

/** The length of each keyword. */
function keywordLength(t: T): number {
  switch (t) {
    case T.Usecase:
      return 12
    case T.Actor:
    case T.Style:
    case T.Class:
    case T.False:
      return 5
    case T.SystemBoundary:
      return 14
    case T.End:
    case T.For:
      return 3
    case T.Direction:
      return 9
    case T.Note:
    case T.Json:
    case T.True:
      return 4
    case T.ClassDef:
      return 8
    case T.Include:
      return 7
    case T.Extend:
      return 6
    default:
      return 2
  }
}

/** The keyword that is a prefix of the text at `i`, tried in the order of Mermaid's token list. */
function keywordAt(b: string, i: number, c: number): T | undefined {
  switch (c) {
    case 0x61: // a
      return starts(b, i, 'actor') ? T.Actor : undefined
    case 0x73: // s
      if (starts(b, i, 'systemBoundary')) return T.SystemBoundary
      return starts(b, i, 'style') ? T.Style : undefined
    case 0x65: // e
      if (starts(b, i, 'end')) return T.End
      return startsNoCase(b, i, 'extend') ? T.Extend : undefined
    case 0x45: // E
      return startsNoCase(b, i, 'extend') ? T.Extend : undefined
    case 0x64: // d
      return starts(b, i, 'direction') ? T.Direction : undefined
    case 0x54: // T
      if (starts(b, i, 'TD')) return T.Td
      return starts(b, i, 'TB') ? T.Tb : undefined
    case 0x42: // B
      return starts(b, i, 'BT') ? T.Bt : undefined
    case 0x4c: // L
      return starts(b, i, 'LR') ? T.Lr : undefined
    case 0x52: // R
      return starts(b, i, 'RL') ? T.Rl : undefined
    case 0x6e: // n
      return starts(b, i, 'note') ? T.Note : undefined
    case 0x66: // f
      if (starts(b, i, 'for')) return T.For
      return starts(b, i, 'false') ? T.False : undefined
    case 0x6a: // j
      return starts(b, i, 'json') ? T.Json : undefined
    case 0x63: // c
      if (starts(b, i, 'classDef')) return T.ClassDef
      return starts(b, i, 'class') ? T.Class : undefined
    case 0x69: // i
    case 0x49: // I
      return startsNoCase(b, i, 'include') ? T.Include : undefined
    case 0x74: // t
      return starts(b, i, 'true') ? T.True : undefined
    case 0x75: // u
      return starts(b, i, 'usecase-beta') ? T.Usecase : undefined
    default:
      return undefined
  }
}

/** The number of UTF-16 units before `offset` of `src`. Offsets are already UTF-16 here. */
export function utf16(src: string, offset: number): number {
  return Math.min(offset, src.length)
}

/** Appends a count in decimal. */
export function pushUsize(out: Buf, value: number): void {
  pushU32(out, Math.min(value, 4294967295))
}

/** The one-based line and UTF-16 column of `offset`. CR, LF, and CRLF each end a line. */
export function lineColumn(src: string, offset: number): [number, number] {
  const b = src
  let line = 1
  let lineStart = 0
  let i = 0
  const stop = Math.min(offset, b.length)
  while (i < stop) {
    const c = at(b, i)
    if (c === 10 || c === 13) {
      if (c === 13 && i + 1 < offset && at(b, i + 1) === 10) {
        i += 1
      }
      line += 1
      lineStart = i + 1
    }
    i += 1
  }
  const column = lineStart <= offset && offset <= src.length ? offset - lineStart : 0
  return [line, column + 1]
}

/** `line L, column C [start,end)`, with UTF-16 offsets. */
export function locationText(src: string, start: number, end: number): string {
  const [line, column] = lineColumn(src, start)
  return `line ${line}, column ${column} [${utf16(src, start)},${utf16(src, end)})`
}

/** A use case error at `offset`, with Pele's code and message. */
export function error(src: string, code: Code, message: string, offset: number): CompileError {
  const [line, column] = lineColumn(src, offset)
  const e = new CompileError(code, message)
  e.column = column
  e.line = line
  e.snippet = ''
  e.type = 'usecase'
  return e
}

/** The end of a quoted string that opens at `i`, or `undefined` when the line ends first. */
function stringEnd(b: string, i: number, quote: number): number | undefined {
  for (let k = i + 1; k < b.length; k++) {
    const c = at(b, k)
    if (c === quote) return k + 1
    if (c === 10 || c === 13) return undefined
  }
  return undefined
}

/** Whether a token may start at `i`: anything but a quote that opens no string. */
function startsToken(b: string, i: number): boolean {
  const c = at(b, i)
  if (c !== 34 && c !== 39) return true
  return (c === 34 && at(b, i + 1) === 96) || stringEnd(b, i, c) !== undefined
}

/**
 * Mermaid reports the first character no token starts with, and how many characters its lexer
 * skipped before one did.
 */
function lexError(src: string, offset: number, length: number): CompileError {
  const [line, column] = lineColumn(src, offset)
  const start = utf16(src, offset)
  const end = utf16(src, offset + length)
  let message = 'Error lexing usecase diagram: unexpected character: ->'
  const c = src.codePointAt(offset)
  if (offset < src.length && c !== undefined) message += String.fromCodePoint(c)
  message += `<- at offset: ${start}, skipped ${end - start} characters. at line ${line}, column ${column} [${start},${end})`
  return error(src, Code.Syntax, message, offset)
}

/**
 * Produces the tokens of Mermaid's Chevrotain lexer for use case diagrams: the first pattern in
 * its list that matches wins, a keyword gives way to a longer identifier, and `json id@` and
 * `<<` switch to modes that read a JSON object and a stereotype. Three `Eof` tokens end the
 * list, for lookahead.
 *
 * Throws Mermaid's lexing error for an unclosed quoted string or an empty stereotype.
 */
export function tokenize(src: string): Tok[] {
  const b = src
  const n = b.length
  const out: Tok[] = []
  const push = (kind: T, start: number, end: number): void => {
    out.push({ end, kind, start })
  }
  let i = 0
  // Whether only blanks came before on this line, where comments and accessibility lines may
  // start.
  let lineStart = true
  let noBrace = false

  while (i < n) {
    const c = at(b, i)
    if (c === 32 || c === 9) {
      i += 1
      continue
    }
    let kind: T | undefined
    let end = i + 1
    let fresh = false

    if (isWord(c)) {
      if (c === 0x61 && lineStart && starts(b, i, 'acc')) {
        const descr = starts(b, i + 3, 'Descr')
        if (descr || starts(b, i + 3, 'Title')) {
          let j = i + 8
          while (isBlank(at(b, j))) j += 1
          const next = at(b, j)
          if (next === 58) {
            kind = descr ? T.AccDescrLine : T.AccTitleLine
            end = j + 1
            while (end < n && at(b, end) !== 10 && at(b, end) !== 13) end += 1
          } else if (next === 123 && descr && !noBrace) {
            const close = j + 1 <= n ? src.indexOf('}', j + 1) : -1
            if (close < 0) {
              noBrace = true
            } else {
              kind = T.AccDescrBlock
              end = close + 1
            }
          }
        }
      } else if (c === 0x6a && starts(b, i, 'json') && isBlank(at(b, i + 4))) {
        let j = i + 5
        while (isBlank(at(b, j))) j += 1
        const id = j
        while (isWord(at(b, j))) j += 1
        if (j > id) {
          while (isBlank(at(b, j))) j += 1
          if (at(b, j) === 64) {
            j += 1
            while (isBlank(at(b, j))) j += 1
            if (at(b, j) === 123) {
              push(T.JsonDeclarationStart, i, j)
              let depth = 0
              let quoted = false
              let escaped = false
              let k = j
              while (k < n) {
                const ch = at(b, k)
                if (quoted) {
                  if (escaped) {
                    escaped = false
                  } else if (ch === 92) {
                    escaped = true
                  } else if (ch === 34) {
                    quoted = false
                  }
                } else if (ch === 34) {
                  quoted = true
                } else if (ch === 123) {
                  depth += 1
                } else if (ch === 125) {
                  depth = Math.max(depth - 1, 0)
                  if (depth === 0) break
                }
                k += 1
              }
              const closed = k < n
              i = closed ? k + 1 : n
              push(closed ? T.JsonObjectLiteral : T.UnclosedJsonObjectLiteral, j, i)
              lineStart = false
              continue
            }
          }
        }
      }
      if (kind === undefined) {
        while (end < n && isWord(at(b, end))) end += 1
        const keyword = keywordAt(b, i, c)
        if (keyword !== undefined) {
          // A keyword that is only the start of a longer word is an identifier.
          if (keyword === T.Usecase || end - i === keywordLength(keyword)) {
            kind = keyword
            end = i + keywordLength(keyword)
          } else {
            kind = T.Identifier
          }
        } else if ((c === 0x6f || c === 0x78) && at(b, i + 1) === 45 && at(b, i + 2) === 45) {
          kind = c === 0x6f ? T.BackwardCircle : T.BackwardCross
          end = i + 3
        } else if (isDigit(c)) {
          // `1mg` is an identifier, and `1.5px` is a number because the identifier stops at
          // the dot.
          let digits = i + 1
          while (isDigit(at(b, digits))) digits += 1
          if (at(b, digits) === 46 && isDigit(at(b, digits + 1))) {
            kind = T.Number
            end = digits + 2
            while (isDigit(at(b, end))) end += 1
            while (isLetter(at(b, end))) end += 1
          } else {
            kind = T.Identifier
          }
        } else {
          kind = T.Identifier
          while (at(b, end) === 45 && isWord(at(b, end + 1))) {
            kind = T.CssIdentifier
            end += 2
            while (isWord(at(b, end))) end += 1
          }
        }
      }
    } else if (c === 10) {
      kind = T.Newline
      fresh = true
    } else if (c === 13) {
      kind = T.Newline
      fresh = true
      if (at(b, end) === 10) end += 1
    } else if (c === 34 || c === 39) {
      if (c === 34 && at(b, i + 1) === 96) {
        const close = i + 2 <= n ? src.indexOf('`"', i + 2) : -1
        if (close >= 0) {
          kind = T.MarkdownString
          end = close + 2
        } else {
          kind = T.UnclosedMarkdownString
          end = n
        }
      } else {
        kind = T.PlainString
        const close = stringEnd(b, i, c)
        if (close !== undefined) {
          end = close
        } else {
          let resume = i + 1
          while (resume < n && !startsToken(b, resume)) resume += 1
          throw lexError(src, i, resume - i)
        }
      }
    } else if (c === 37) {
      if (lineStart && at(b, end) === 37) {
        kind = T.Comment
        while (end < n && at(b, end) !== 10 && at(b, end) !== 13) end += 1
      } else {
        kind = T.Percent
      }
    } else if (c === 45) {
      if (at(b, end) === 45) {
        while (at(b, end) === 45) end += 1
        const next = at(b, end)
        const two = end - i === 2
        if (two && next === 124 && at(b, end + 1) === 62) {
          kind = T.Generalization
          end += 2
        } else if (next === 62) {
          kind = T.ForwardSolid
          end += 1
        } else if (two && (next === 0x6f || next === 0x78)) {
          kind = next === 0x6f ? T.ForwardCircle : T.ForwardCross
          end += 1
        } else {
          kind = T.MarkerlessSolid
        }
      } else {
        kind = T.Dash
      }
    } else if (c === 46) {
      const next = at(b, end)
      if (next === 46 && at(b, end + 1) === 62) {
        kind = T.DependencyArrow
        end += 2
      } else if (isDigit(next)) {
        kind = T.Number
        while (isDigit(at(b, end))) end += 1
        while (isLetter(at(b, end))) end += 1
      } else {
        kind = T.Dot
      }
    } else if (c === 60) {
      if (at(b, end) === 60) {
        push(T.StereotypeStart, i, i + 2)
        i += 2
        if (i >= n) break
        if (at(b, i) === 62 && at(b, i + 1) === 62) {
          kind = T.StereotypeEnd
          end = i + 2
        } else {
          let close = i
          let found = false
          while (close < n) {
            const ch = at(b, close)
            if (ch === 10 || ch === 13) break
            if (ch === 62 && at(b, close + 1) === 62) {
              found = true
              break
            }
            close += 1
          }
          if (found && trim(src.slice(i, close)) !== '') {
            push(T.StereotypeText, i, close)
            kind = T.StereotypeEnd
            i = close
            end = close + 2
          } else {
            while (close < n && at(b, close) !== 10 && at(b, close) !== 13) close += 1
            if (close === i) {
              while (close < n && (at(b, close) === 10 || at(b, close) === 13)) close += 1
              throw lexError(src, i, close - i)
            }
            kind = T.UnclosedStereotypeText
            end = close
          }
        }
      } else if (at(b, end) === 45 && at(b, end + 1) === 45) {
        kind = T.BackwardSolid
        end += 2
        while (at(b, end) === 45) end += 1
      } else {
        kind = T.LabelPunctuation
      }
    } else if (c === 58) {
      if (at(b, end) === 58 && at(b, end + 1) === 58) {
        kind = T.ClassSeparator
        end += 2
      } else {
        kind = T.Colon
      }
    } else if (c === 64) {
      if (at(b, end) === 123) {
        kind = T.MetadataStart
        end += 1
      } else {
        kind = T.At
      }
    } else if (c === 123) {
      kind = T.LBrace
    } else if (c === 125) {
      kind = T.RBrace
    } else if (c === 91) {
      kind = T.LBracket
    } else if (c === 93) {
      kind = T.RBracket
    } else if (c === 40) {
      kind = T.LParen
    } else if (c === 41) {
      kind = T.RParen
    } else if (c === 44) {
      kind = T.Comma
    } else if (c === 35) {
      while (isHex(at(b, end))) end += 1
      kind = end > i + 1 ? T.HashColor : T.CssPunctuation
    } else if (c === 92) {
      if (at(b, end) === 44) {
        kind = T.CssEscapedComma
        end += 1
      } else {
        kind = T.LabelPunctuation
      }
    } else if (c < 127 && c > 32) {
      kind = '!#$&*+/=?^|~'.includes(b[i] ?? '') ? T.CssPunctuation : T.LabelPunctuation
    } else {
      kind = T.LabelSymbol
      while (end < n) {
        const ch = at(b, end)
        if ((ch >= 32 && ch < 127) || ch === 9 || ch === 10 || ch === 13) break
        end += 1
      }
    }

    push(kind ?? T.LabelSymbol, i, end)
    i = end
    lineStart = fresh
  }

  for (let k = 0; k < 3; k++) push(T.Eof, n, n)
  return out
}
