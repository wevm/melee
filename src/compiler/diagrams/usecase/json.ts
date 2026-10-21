/**
 * @module The body of a `json` node: a JSON object whose keys keep the order they were written in,
 * with the errors Node's `JSON.parse` reports. Port of Pele's `src/diagrams/usecase/json.ts`.
 *
 * Pele parses with `JSON.parse` and walks the text again for its key order. This reads the text
 * once, as V8's JSON parser does, and reports V8's messages at V8's positions.
 */
import { pushUsize, utf16 } from './lexer.ts'
import { Code, CompileError } from '../../error.ts'
import { isDigit, isHex, isWord } from '../../util/chars.ts'
import { parse } from '../../util/float.ts'
import { buf } from '../../util/rust.ts'

/**
 * A JSON value in a [`JsonDoc`]. Children are indices into the document's nodes, so deep
 * nesting needs no recursion to build, read, or drop.
 */
export type JsonValue =
  /** An array of nodes. */
  | { kind: 'Array'; _0: number[] }
  /** `true` or `false`. */
  | { kind: 'Bool'; _0: boolean }
  /** `null`. */
  | { kind: 'Null' }
  /** A number. */
  | { kind: 'Number'; _0: number }
  /** An object: each key once, where it was first written, with the last value written for it. */
  | { kind: 'Object'; _0: [string, number][] }
  /** A string. A lone surrogate escape becomes U+FFFD. */
  | { kind: 'String'; _0: string }

/** A parsed JSON document. The root is the first node. */
export type JsonDoc = {
  /** Every value, parents before their children. */
  nodes: JsonValue[]
}

/** An empty document. */
export function jsonDocDefault(): JsonDoc {
  return { nodes: [] }
}

/** The node at `index`. */
export function jsonDocGet(doc: JsonDoc, index: number): JsonValue | undefined {
  return doc.nodes[index]
}

/**
 * Parses the body of a `json` node. `origin` is the line and column the text starts at in the
 * diagram.
 *
 * Throws `Invalid JSON: <V8's message>` at the position V8 names, mapped into the diagram, or an
 * error when the root is not an object.
 */
export function parseOrderedJson(text: string, origin: [number, number]): JsonDoc {
  const [line, column] = origin
  const result = v8Parse(text)
  if (typeof result === 'string') {
    const message = result
    const [l, c] =
      locationFromMessage(message, text, line, column) ?? locationAt(text, walkError(text), line, column)
    throw jsonError(`Invalid JSON: ${message}`, l, c)
  }
  const doc = result
  if (jsonDocGet(doc, 0)?.kind !== 'Object') {
    throw jsonError('JSON value must have an object root', line, column)
  }
  return doc
}

function jsonError(message: string, line: number, column: number): CompileError {
  const error = new CompileError(Code.Syntax, `${message} (line ${line}, column ${column})`)
  error.column = column
  error.line = line
  error.snippet = ''
  error.type = 'usecase'
  return error
}

/** The unit at `i`, or a value no test matches past the end. */
function at(b: string, i: number): number {
  return i < b.length ? b.charCodeAt(i) : 4294967295
}

/** An open object or array, waiting for its next value. */
type Frame =
  /** An array, by node. */
  | { kind: 'Array'; _0: number }
  /** An object, by node, and the key whose value comes next. */
  | { kind: 'Object'; _0: number; _1: string }

/** V8's JSON parser, reduced to what decides its result and its errors. */
type V8 = {
  /** The cursor. */
  at: number
  /** The text. */
  b: string
  /** The values read so far. */
  nodes: JsonValue[]
  /** The text. */
  text: string
}

/** A thrown V8 message, to unwind the parser as Rust's `?` does. */
class V8Error {
  readonly message: string
  constructor(message: string) {
    this.message = message
  }
}

/** Parses `text`, or returns V8's message for it. */
function v8Parse(text: string): JsonDoc | string {
  const parser: V8 = { at: 0, b: text, nodes: [], text }
  try {
    v8Run(parser)
  } catch (e) {
    if (e instanceof V8Error) return e.message
    throw e
  }
  return { nodes: parser.nodes }
}

/** Skips JSON whitespace. */
function v8Skip(self: V8): void {
  for (;;) {
    const c = at(self.b, self.at)
    if (c === 32 || c === 9 || c === 10 || c === 13) self.at += 1
    else break
  }
}

/** The unit at the cursor. */
function v8Peek(self: V8): number {
  return at(self.b, self.at)
}

/** Adds a node and returns its index. */
function v8Push(self: V8, value: JsonValue): number {
  self.nodes.push(value)
  return self.nodes.length - 1
}

/** `template` at `pos`, with V8's position, line, and column. */
function v8Positioned(self: V8, template: string, pos: number): string {
  const units = self.text
  const end = utf16(self.text, pos)
  // JSON allows only CR and LF as line terminators, and CRLF counts once.
  let line = 1
  let lastBreak = 0
  let cursor = 0
  while (cursor < end) {
    if (units.charCodeAt(cursor) === 13 && cursor + 1 < end && units.charCodeAt(cursor + 1) === 10) {
      cursor += 1
    }
    const unit = units.charCodeAt(cursor)
    if (unit === 13 || unit === 10) {
      line += 1
      lastBreak = cursor + 1
    }
    cursor += 1
  }
  const out = buf(template)
  out.s += ' in JSON at position '
  pushUsize(out, end)
  out.s += ` (line ${line} column `
  pushUsize(out, 1 + cursor - lastBreak)
  out.s += ')'
  return out.s
}

/** V8's message for the character at `pos` where no token may start. */
function v8Unexpected(self: V8, pos: number): string {
  /** How many characters V8 quotes on each side of the error. */
  const CONTEXT = 10
  const c = at(self.b, pos)
  if (c === 4294967295) return 'Unexpected end of JSON input'
  if (c === 34) return v8Positioned(self, 'Unexpected string', pos)
  if (c === 45 || isDigit(c)) return v8Positioned(self, 'Unexpected number', pos)
  const units = self.text
  const length = units.length
  const p = utf16(self.text, pos)
  let out = "Unexpected token '"
  const ch = self.text.codePointAt(pos)
  if (ch !== undefined) out += String.fromCodePoint(ch)
  out += "', "
  const slice = (from: number, to: number): string =>
    from <= Math.min(to, length) ? units.slice(from, Math.min(to, length)).toWellFormed() : ''
  if (length < CONTEXT * 2 + 1) {
    out += `"${self.text}" is not valid JSON`
  } else if (p < CONTEXT) {
    out += `"${slice(0, p + CONTEXT)}"... is not valid JSON`
  } else if (p < length - CONTEXT) {
    out += `..."${slice(p - CONTEXT, p + CONTEXT)}"... is not valid JSON`
  } else {
    out += `..."${slice(p - CONTEXT, length)}" is not valid JSON`
  }
  return out
}

/** Reads a key after the comma or brace before it: its string, then a colon. */
function v8Key(self: V8, missing: string): string {
  v8Skip(self)
  if (v8Peek(self) !== 34) throw new V8Error(v8Positioned(self, missing, self.at))
  self.at += 1
  const key = v8String(self)
  v8Skip(self)
  if (v8Peek(self) !== 58) {
    throw new V8Error(v8Positioned(self, "Expected ':' after property name", self.at))
  }
  self.at += 1
  return key
}

/** Reads one value and checks that only whitespace follows it. */
function v8Run(self: V8): void {
  const stack: Frame[] = []
  for (;;) {
    let value: number
    for (;;) {
      v8Skip(self)
      const c = v8Peek(self)
      if (c === 34) {
        self.at += 1
        const text = v8String(self)
        value = v8Push(self, { kind: 'String', _0: text })
        break
      }
      if (c === 45 || (c >= 48 && c <= 57)) {
        const number = v8Number(self)
        value = v8Push(self, { kind: 'Number', _0: number })
        break
      }
      if (c === 123) {
        self.at += 1
        v8Skip(self)
        const node = v8Push(self, { kind: 'Object', _0: [] })
        if (v8Peek(self) === 125) {
          self.at += 1
          value = node
          break
        }
        const key = v8Key(self, "Expected property name or '}'")
        stack.push({ kind: 'Object', _0: node, _1: key })
        continue
      }
      if (c === 91) {
        self.at += 1
        v8Skip(self)
        const node = v8Push(self, { kind: 'Array', _0: [] })
        if (v8Peek(self) === 93) {
          self.at += 1
          value = node
          break
        }
        stack.push({ kind: 'Array', _0: node })
        continue
      }
      if (c === 116) {
        v8Literal(self, 'true')
        value = v8Push(self, { kind: 'Bool', _0: true })
        break
      }
      if (c === 102) {
        v8Literal(self, 'false')
        value = v8Push(self, { kind: 'Bool', _0: false })
        break
      }
      if (c === 110) {
        v8Literal(self, 'null')
        value = v8Push(self, { kind: 'Null' })
        break
      }
      throw new V8Error(v8Unexpected(self, self.at))
    }

    for (;;) {
      const frame = stack.length > 0 ? stack[stack.length - 1] : undefined
      if (frame === undefined) {
        v8Skip(self)
        if (self.at < self.b.length) {
          throw new V8Error(v8Positioned(self, 'Unexpected non-whitespace character after JSON', self.at))
        }
        return
      }
      if (frame.kind === 'Object') {
        const node = frame._0
        const key = frame._1
        frame._1 = ''
        const target = self.nodes[node]
        if (target !== undefined && target.kind === 'Object') {
          // ponytail: a linear search per key, quadratic in an object's size.
          const entry = target._0.find(([own]) => own === key)
          if (entry !== undefined) entry[1] = value
          else target._0.push([key, value])
        }
        v8Skip(self)
        if (v8Peek(self) === 44) {
          self.at += 1
          const next = v8Key(self, 'Expected double-quoted property name')
          frame._1 = next
          break
        }
        if (v8Peek(self) !== 125) {
          throw new V8Error(v8Positioned(self, "Expected ',' or '}' after property value", self.at))
        }
        self.at += 1
        stack.pop()
        value = node
      } else {
        const node = frame._0
        const target = self.nodes[node]
        if (target !== undefined && target.kind === 'Array') target._0.push(value)
        v8Skip(self)
        if (v8Peek(self) === 44) {
          self.at += 1
          break
        }
        if (v8Peek(self) !== 93) {
          throw new V8Error(v8Positioned(self, "Expected ',' or ']' after array element", self.at))
        }
        self.at += 1
        stack.pop()
        value = node
      }
    }
  }
}

/** Reads a string whose opening quote is behind the cursor. */
function v8String(self: V8): string {
  let units = ''
  for (;;) {
    const c = v8Peek(self)
    if (c === 4294967295) throw new V8Error(v8Positioned(self, 'Unterminated string', self.at))
    if (c === 34) {
      self.at += 1
      // `String::from_utf16_lossy`: an unpaired surrogate becomes U+FFFD.
      return units.toWellFormed()
    }
    if (c < 0x20) {
      throw new V8Error(v8Positioned(self, 'Bad control character in string literal', self.at))
    }
    if (c !== 92) {
      const ch = self.text.codePointAt(self.at)
      if (ch === undefined) throw new V8Error(v8Positioned(self, 'Unterminated string', self.at))
      const s = String.fromCodePoint(ch)
      units += s
      self.at += s.length
      continue
    }
    self.at += 1
    let unit: number
    switch (v8Peek(self)) {
      case 34:
        unit = 34
        break
      case 92:
        unit = 92
        break
      case 47:
        unit = 47
        break
      case 98:
        unit = 8
        break
      case 102:
        unit = 12
        break
      case 110:
        unit = 10
        break
      case 114:
        unit = 13
        break
      case 116:
        unit = 9
        break
      case 117: {
        let value = 0
        for (let k = 0; k < 4; k++) {
          self.at += 1
          const digit = v8Peek(self)
          if (!isHex(digit)) throw new V8Error(v8Positioned(self, 'Bad Unicode escape', self.at))
          value = (value * 16 + Number.parseInt(String.fromCharCode(digit), 16)) & 0xffff
        }
        unit = value
        break
      }
      default:
        throw new V8Error(v8Positioned(self, 'Bad escaped character', self.at))
    }
    units += String.fromCharCode(unit)
    self.at += 1
  }
}

/** Reads a number at the cursor. */
function v8Number(self: V8): number {
  const start = self.at
  if (v8Peek(self) === 45) self.at += 1
  if (v8Peek(self) === 48) {
    self.at += 1
    if (isDigit(v8Peek(self))) throw new V8Error(v8UnexpectedNumber(self))
  } else {
    if (!isDigit(v8Peek(self))) throw new V8Error(v8Positioned(self, 'No number after minus sign', self.at))
    while (isDigit(v8Peek(self))) self.at += 1
  }
  if (v8Peek(self) === 46) {
    self.at += 1
    if (!isDigit(v8Peek(self))) {
      throw new V8Error(v8Positioned(self, 'Unterminated fractional number', self.at))
    }
    while (isDigit(v8Peek(self))) self.at += 1
  }
  if ((v8Peek(self) | 32) >>> 0 === 101) {
    self.at += 1
    if (v8Peek(self) === 43 || v8Peek(self) === 45) self.at += 1
    if (!isDigit(v8Peek(self))) {
      throw new V8Error(v8Positioned(self, 'Exponent part is missing a number', self.at))
    }
    while (isDigit(v8Peek(self))) self.at += 1
  }
  return parse(self.text.slice(start, self.at)) ?? 0
}

function v8UnexpectedNumber(self: V8): string {
  return v8Positioned(self, 'Unexpected number', self.at)
}

/** Reads `word`, whose first character was already seen. */
function v8Literal(self: V8, word: string): void {
  const remaining = self.b.length - self.at
  if (self.b.slice(self.at + 1, self.at + word.length) === word.slice(1) && self.at + word.length <= self.b.length) {
    self.at += word.length
    return
  }
  self.at += 1
  const count = Math.min(word.length - 1, remaining - 1)
  for (let i = 0; i < count; i++) {
    if (word.charCodeAt(1 + i) !== v8Peek(self)) throw new V8Error(v8Unexpected(self, self.at))
    self.at += 1
  }
  throw new V8Error('Unexpected end of JSON input')
}

/** The line and column of UTF-16 `offset` in `text`, which starts at `line` and `column`. */
function locationAt(text: string, offset: number, line: number, column: number): [number, number] {
  let previous = 0
  const stop = Math.min(offset, text.length)
  for (let i = 0; i < stop; i++) {
    const unit = text.charCodeAt(i)
    if (unit === 13) {
      line += 1
      column = 1
    } else if (unit === 10) {
      if (i === 0 || previous !== 13) {
        line += 1
        column = 1
      }
    } else {
      column += 1
    }
    previous = unit
  }
  return [line, column]
}

/** The digits starting at `i`, as a number, and where they end. Saturates past `u32::MAX`. */
function digits(b: string, i: number): [number, number] | undefined {
  let end = i
  let value = 0
  while (isDigit(at(b, end))) {
    value = Math.min(value * 10 + (at(b, end) - 48), 4294967295)
    end += 1
  }
  return end > i ? [value, end] : undefined
}

/** Whether a `\b` sits before `i`, at the start of a word. */
function wordStart(b: string, i: number): boolean {
  return i === 0 || !isWord(at(b, i - 1))
}

/** Pele's `/\bposition (\d+)\b/`. */
function findPosition(b: string): number | undefined {
  for (let i = 0; i < b.length; i++) {
    if (!wordStart(b, i) || !b.startsWith('position ', i)) continue
    const found = digits(b, i + 9)
    if (found !== undefined && !isWord(at(b, found[1]))) return found[0]
  }
  return undefined
}

/** Pele's `/\bline (\d+) column (\d+)\b/`. */
function findLineColumn(b: string): [number, number] | undefined {
  for (let i = 0; i < b.length; i++) {
    if (!wordStart(b, i) || !b.startsWith('line ', i)) continue
    const first = digits(b, i + 5)
    if (first === undefined) continue
    const [line, end] = first
    if (!b.startsWith(' column ', end)) continue
    const second = digits(b, end + 8)
    if (second === undefined) continue
    if (!isWord(at(b, second[1]))) return [line, second[0]]
  }
  return undefined
}

/** Whether `b` contains `word`, ignoring ASCII case. */
function containsNoCase(b: string, word: string): boolean {
  const lower = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
  return lower(b).includes(lower(word))
}

/** Engines word `JSON.parse` errors differently: some give an offset, some a line and column. */
function locationFromMessage(
  message: string,
  text: string,
  line: number,
  column: number,
): [number, number] | undefined {
  const b = message
  const position = findPosition(b)
  if (position !== undefined) return locationAt(text, position, line, column)
  const found = findLineColumn(b)
  if (found !== undefined) {
    const [localLine, localColumn] = found
    return [
      Math.max(Math.min(line + localLine, 4294967295) - 1, 0),
      localLine === 1 ? Math.max(Math.min(column + localColumn, 4294967295) - 1, 0) : localColumn,
    ]
  }
  if (containsNoCase(b, 'unexpected end') || containsNoCase(b, 'end of json input')) {
    return locationAt(text, Number.MAX_SAFE_INTEGER, line, column)
  }
  return undefined
}

/**
 * Where Pele's key-order walk of `text` stops, as a UTF-16 offset: the first character that is
 * not valid JSON.
 */
function walkError(text: string): number {
  const offset = walk(text) ?? 0
  return utf16(text, offset)
}

/** Pele's `propertyOrder` walk, kept for where it fails. Each frame is whether it is an object. */
function walk(b: string): number | undefined {
  const After = 0
  const Key = 1
  const Value = 2
  const n = b.length
  let i = 0
  const skip = (): void => {
    for (;;) {
      const c = at(b, i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i += 1
      else break
    }
  }
  /** Reads a string; returns the error offset, or `undefined` when it closes. */
  const readString = (): number | undefined => {
    i += 1
    while (i < n) {
      const start = i
      const ch = at(b, i)
      i += 1
      if (ch === 34) return undefined
      if (ch < 0x20) return start
      if (ch !== 92) continue
      const escapeAt = i
      const escape = at(b, i)
      i += 1
      if (escape === 0x75) {
        for (let k = 0; k < 4; k++) if (!isHex(at(b, i + k))) return i
        i += 4
      } else if (!'"\\/bfnrt'.split('').some((c) => c.charCodeAt(0) === escape)) {
        return escapeAt
      }
    }
    return i
  }
  const stack: boolean[] = []
  let state = Value
  skip()
  for (;;) {
    if (state === Value) {
      skip()
      const c = at(b, i)
      state = After
      if (c === 123) {
        i += 1
        skip()
        if (at(b, i) === 125) {
          i += 1
        } else {
          stack.push(true)
          state = Key
        }
      } else if (c === 91) {
        i += 1
        skip()
        if (at(b, i) === 93) {
          i += 1
        } else {
          stack.push(false)
          state = Value
        }
      } else if (c === 34) {
        const failed = readString()
        if (failed !== undefined) return failed
      } else if (c === 116 || c === 102 || c === 110) {
        const word = c === 116 ? 'true' : c === 102 ? 'false' : 'null'
        for (let k = 0; k < word.length; k++) {
          if (at(b, i + k) !== word.charCodeAt(k)) return i + k
        }
        i += word.length
      } else if (c === 45 || isDigit(c)) {
        if (at(b, i) === 45) i += 1
        if (at(b, i) === 48) {
          i += 1
        } else if (isDigit(at(b, i))) {
          while (isDigit(at(b, i))) i += 1
        } else {
          return i
        }
        if (at(b, i) === 46) {
          i += 1
          if (!isDigit(at(b, i))) return i
          while (isDigit(at(b, i))) i += 1
        }
        if ((at(b, i) | 32) >>> 0 === 101) {
          i += 1
          if (at(b, i) === 43 || at(b, i) === 45) i += 1
          if (!isDigit(at(b, i))) return i
          while (isDigit(at(b, i))) i += 1
        }
      } else {
        return i
      }
    } else if (state === Key) {
      if (at(b, i) !== 34) return i
      const failed = readString()
      if (failed !== undefined) return failed
      skip()
      if (at(b, i) !== 58) return i
      i += 1
      state = Value
    } else {
      const object = stack.length > 0 ? stack[stack.length - 1] : undefined
      if (object === undefined) break
      skip()
      const c = at(b, i)
      if (c === (object ? 125 : 93)) {
        i += 1
        stack.pop()
      } else if (c !== 44) {
        return i
      } else {
        i += 1
        skip()
        state = object ? Key : Value
      }
    }
  }
  skip()
  if (i !== n) return i
  return undefined
}
