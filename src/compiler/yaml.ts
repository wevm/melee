/**
 * @module A small YAML reader covering what Mermaid feeds to js-yaml with the JSON schema: block
 * and flow collections, quoted and plain scalars, and block scalars. Port of Pele's
 * `src/util/yaml.ts`.
 */
import { isLineEnd, isSpace } from './util/chars.ts'
import { parse as floatParse } from './util/float.ts'
import { type Buf, type Result, buf, err, ok } from './util/rust.ts'

/** A parsed YAML value, shaped like the JavaScript value Pele's reader returns. */
export type Value =
  /** A sequence. */
  | { kind: 'Array'; _0: Value[] }
  /** `true` or `false`. */
  | { kind: 'Bool'; _0: boolean }
  /** `null`, `~`, or an empty value. */
  | { kind: 'Null' }
  /** A number. */
  | { kind: 'Number'; _0: number }
  /** A mapping, in JavaScript property order: integer-like keys ascending, then insertion order. */
  | { kind: 'Object'; _0: [string, Value][] }
  /** A string. */
  | { kind: 'String'; _0: string }

/** Appends the value as JavaScript's `String(value)` writes it. */
export function valuePushJsString(value: Value, out: Buf): void {
  switch (value.kind) {
    case 'Array': {
      const items = value._0
      for (let at = 0; at < items.length; at++) {
        if (at > 0) out.s += ','
        const item = items[at] as Value
        if (item.kind !== 'Null') valuePushJsString(item, out)
      }
      return
    }
    case 'Bool':
      out.s += value._0 ? 'true' : 'false'
      return
    case 'Null':
      out.s += 'null'
      return
    case 'Number':
      pushNumber(out, value._0)
      return
    case 'Object':
      out.s += '[object Object]'
      return
    case 'String':
      out.s += value._0
      return
  }
}

/** A deep copy of the value, as `structuredClone` makes it. */
export function valueClone(value: Value): Value {
  switch (value.kind) {
    case 'Array': {
      const items = value._0
      const out: Value[] = new Array<Value>(items.length)
      for (let i = 0; i < items.length; i++) out[i] = valueClone(items[i] as Value)
      return { kind: 'Array', _0: out }
    }
    case 'Object': {
      const entries = value._0
      const out: [string, Value][] = new Array<[string, Value]>(entries.length)
      for (let i = 0; i < entries.length; i++) {
        const [key, item] = entries[i] as [string, Value]
        out[i] = [key, valueClone(item)]
      }
      return { kind: 'Object', _0: out }
    }
    case 'Bool':
      return { kind: 'Bool', _0: value._0 }
    case 'Null':
      return { kind: 'Null' }
    case 'Number':
      return { kind: 'Number', _0: value._0 }
    case 'String':
      return { kind: 'String', _0: value._0 }
  }
}

/** Whether JavaScript treats the value as true in a condition. */
export function valueTruthy(value: Value): boolean {
  switch (value.kind) {
    case 'Array':
    case 'Object':
      return true
    case 'Bool':
      return value._0
    case 'Null':
      return false
    case 'Number':
      return value._0 !== 0 && !Number.isNaN(value._0)
    case 'String':
      return value._0 !== ''
  }
}

/**
 * Sets a property the way assigning to a JavaScript object does. An existing key keeps its place,
 * and a new array-index key goes before every larger index and every other key.
 */
export function set(object: [string, Value][], key: string, value: Value): void {
  for (let i = 0; i < object.length; i++) {
    const entry = object[i] as [string, Value]
    if (entry[0] === key) {
      entry[1] = value
      return
    }
  }

  const index = arrayIndex(key)
  if (index !== undefined) {
    for (let i = 0; i < object.length; i++) {
      const other = arrayIndex((object[i] as [string, Value])[0])
      if (other === undefined || other > index) {
        object.splice(i, 0, [key, value])
        return
      }
    }
  }
  object.push([key, value])
}

// An array index as JavaScript orders property keys: a canonical integer below 2^32 - 1.
function arrayIndex(key: string): number | undefined {
  if (key.length === 0 || key.length > 10 || (key.length > 1 && key.charCodeAt(0) === 0x30)) return undefined

  let value = 0
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    if (c < 0x30 || c > 0x39) return undefined
    value = value * 10 + (c - 0x30)
  }
  return value < 4294967295 ? value : undefined
}

/**
 * Appends `value` as JavaScript's `Number.prototype.toString` writes it: the shortest digits that
 * read back as the same double, in plain or exponent notation.
 */
export function pushNumber(out: Buf, value: number): void {
  // The Rust crate reimplements this conversion, which JavaScript defines and provides.
  out.s += String(value)
}

/** A failure while reading. */
type Fail =
  /** An error to report as is. */
  | { kind: 'Error'; _0: string }
  /** A quoted scalar or flow collection ran past the text read so far. */
  | { kind: 'Incomplete'; _0: string }

function failIntoMessage(fail: Fail): string {
  return fail._0
}

function error(message: string): Fail {
  return { kind: 'Error', _0: message }
}

const MAX_DEPTH = 64

function space(c: number): boolean {
  return isSpace(c)
}

function trim(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && space(text.charCodeAt(start))) start++
  while (end > start && space(text.charCodeAt(end - 1))) end--
  return start === 0 && end === text.length ? text : text.slice(start, end)
}

// The length of the leading whitespace in UTF-16 units. JavaScript whitespace is all in the BMP.
function leading(text: string): number {
  let count = 0
  while (count < text.length && space(text.charCodeAt(count))) count++
  return count
}

// Drops the first `count` characters, as `slice(count)` does over BMP text.
function afterChars(text: string, count: number): string {
  let at = 0
  for (let i = 0; i < count; i++) {
    if (at >= text.length) return ''
    at += (text.codePointAt(at) as number) > 0xffff ? 2 : 1
  }
  return at >= text.length ? '' : text.slice(at)
}

type Reader = {
  i: number
  lines: string[]
}

function readerNew(src: string): Reader {
  const normalized = src.includes('\r') ? src.replace(/\r\n?/g, '\n') : src
  return {
    i: 0,
    lines: normalized.split('\n'),
  }
}

function readerLine(r: Reader): string {
  return r.lines[r.i] ?? ''
}

function readerSkipBlank(r: Reader): void {
  while (r.i < r.lines.length) {
    const t = trim(readerLine(r))
    if (t !== '' && !t.startsWith('#') && t !== '---') break
    r.i += 1
  }
}

function readerIndent(r: Reader): Result<number, Fail> {
  const line = readerLine(r)
  let k = 0
  while (k < line.length && line.charCodeAt(k) === 0x20) k++
  if (line.charCodeAt(k) === 0x09) return err(error('YAML: tabs are not allowed for indentation'))
  return ok(k)
}

// A space, tab, or line break. `c` is `NaN` past the end of the text.
function isBlank(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d
}

/** The characters a plain key cannot start with. */
const KEY_INDICATORS = '#:,[]{}&*!|>\'"%@`'

// Splits `key: rest` at the start of a line. Returns where the raw key ends and where the value starts.
function splitKey(line: string): [number, number] | undefined {
  if (line.length === 0) return undefined
  const first = line.charCodeAt(0)
  let end: number
  let colon: number

  if (first === 0x22 || first === 0x27) {
    let i = 1
    for (;;) {
      if (i >= line.length) return undefined
      const c = line.charCodeAt(i)
      if (first === 0x22 && c === 0x5c) {
        i += 2
      } else if (c === first) {
        if (first === 0x22 || line.charCodeAt(i + 1) !== 0x27) break
        i += 2
      } else {
        i += 1
      }
    }
    end = i + 1
    let at = end
    while (isBlank(line.charCodeAt(at))) at++
    if (line.charCodeAt(at) !== 0x3a) return undefined
    colon = at
  } else {
    const c = line.codePointAt(0) as number
    if (space(c) || (c < 0x80 && KEY_INDICATORS.includes(line[0] as string))) return undefined
    if (first === 0x2d) {
      const second = line.charCodeAt(1)
      if (line.length < 2 || isBlank(second) || second === 0x3a || second === 0x23) return undefined
    }
    let at = 1
    while (at < line.length && line.charCodeAt(at) !== 0x3a && line.charCodeAt(at) !== 0x23) at++
    if (line.charCodeAt(at) !== 0x3a) return undefined
    colon = at
    let back = colon
    while (back > 0 && isBlank(line.charCodeAt(back - 1))) back--
    end = back
  }

  let length = colon + 1
  if (length < line.length && !isBlank(line.charCodeAt(length))) return undefined
  while (isBlank(line.charCodeAt(length))) length++
  return [end, length]
}

function scalar(raw: string): Value {
  const s = trim(raw)
  switch (s) {
    case '':
    case '~':
    case 'null':
    case 'Null':
    case 'NULL':
      return { kind: 'Null' }
    case 'true':
    case 'True':
    case 'TRUE':
      return { kind: 'Bool', _0: true }
    case 'false':
    case 'False':
    case 'FALSE':
      return { kind: 'Bool', _0: false }
  }

  if (isInt(s) || isFloat(s)) return { kind: 'Number', _0: floatParse(s) ?? Number.NaN }

  const negative = s.startsWith('-')
  const unsigned = stripSign(s)
  const prefix = unsigned.slice(0, 2)
  const radix: [number, string] | undefined =
    prefix === '0x'
      ? [16, unsigned.slice(2)]
      : prefix === '0o'
        ? [8, unsigned.slice(2)]
        : prefix === '0b'
          ? [2, unsigned.slice(2)]
          : undefined
  if (radix !== undefined) {
    const [base, digits] = radix
    if (digits !== '' && [...digits].every((c) => toDigit(c.codePointAt(0) as number, base) !== undefined)) {
      const value = radixNumber(digits, base)
      return { kind: 'Number', _0: negative ? -value : value }
    }
  }

  if (unsigned.startsWith('.')) {
    const name = unsigned.slice(1)
    if (name === 'inf' || name === 'Inf' || name === 'INF') {
      return { kind: 'Number', _0: negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY }
    }
  }
  if (s === '.nan' || s === '.NaN' || s === '.NAN') return { kind: 'Number', _0: Number.NaN }
  return { kind: 'String', _0: s }
}

// `s.strip_prefix(['-', '+']).unwrap_or(s)`.
function stripSign(s: string): string {
  return s.startsWith('-') || s.startsWith('+') ? s.slice(1) : s
}

// `char::to_digit`.
function toDigit(c: number, radix: number): number | undefined {
  let digit: number
  if (c >= 0x30 && c <= 0x39) digit = c - 0x30
  else if (c >= 0x61 && c <= 0x7a) digit = c - 0x61 + 10
  else if (c >= 0x41 && c <= 0x5a) digit = c - 0x41 + 10
  else return undefined
  return digit < radix ? digit : undefined
}

// /^[-+]?(?:0|[1-9][0-9]*)$/
function isInt(s: string): boolean {
  const digits = stripSign(s)
  if (digits === '0') return true
  if (digits === '' || digits.charCodeAt(0) === 0x30) return false
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i)
    if (c < 0x30 || c > 0x39) return false
  }
  return true
}

// /^[-+]?(?:[0-9][0-9]*(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/
function digitRun(bytes: string, from: number): number {
  let at = from
  while (at < bytes.length && bytes.charCodeAt(at) >= 0x30 && bytes.charCodeAt(at) <= 0x39) at++
  return at - from
}

function isFloat(s: string): boolean {
  const bytes = stripSign(s)
  const int = digitRun(bytes, 0)
  let at = int
  if (bytes.charCodeAt(at) === 0x2e) {
    const fraction = digitRun(bytes, at + 1)
    if (int === 0 && fraction === 0) return false
    at += 1 + fraction
  } else if (int === 0) {
    return false
  }

  const e = bytes.charCodeAt(at)
  if (e === 0x65 || e === 0x45) {
    at += 1
    const sign = bytes.charCodeAt(at)
    if (sign === 0x2d || sign === 0x2b) at += 1
    const exponent = digitRun(bytes, at)
    if (exponent === 0) return false
    at += exponent
  }
  return at === bytes.length
}

const U128_MAX = (1n << 128n) - 1n

// JavaScript's `Number` of a `0x`, `0o`, or `0b` literal, rounded once to the nearest double.
function radixNumber(digits: string, base: number): number {
  let exact: bigint | undefined = 0n
  let approx = 0
  for (const c of digits) {
    const digit = toDigit(c.codePointAt(0) as number, base) ?? 0
    if (exact !== undefined) {
      const next: bigint = exact * BigInt(base) + BigInt(digit)
      exact = next > U128_MAX ? undefined : next
    }
    approx = approx * base + digit
  }
  // ponytail: past 128 bits the value accumulates in doubles and may round twice.
  return exact === undefined ? approx : Number(exact)
}

function escape(e: number): number | undefined {
  if (e > 0xff) return undefined
  switch (e) {
    case 0x30: // 0
      return 0
    case 0x61: // a
      return 7
    case 0x62: // b
      return 8
    case 0x74: // t
      return 9
    case 0x6e: // n
      return 10
    case 0x76: // v
      return 11
    case 0x66: // f
      return 12
    case 0x72: // r
      return 13
    case 0x65: // e
      return 0x1b
    case 0x20: // space
      return 32
    case 0x22: // "
      return 34
    case 0x2f: // /
      return 47
    case 0x5c: // \
      return 92
    case 0x4e: // N
      return 0x85
    case 0x5f: // _
      return 0xa0
    case 0x4c: // L
      return 0x2028
    case 0x50: // P
      return 0x2029
    default:
      return undefined
  }
}

// `trim_start_matches([' ', '\t'])`.
function trimStartBlanks(text: string): string {
  let start = 0
  while (start < text.length && (text.charCodeAt(start) === 0x20 || text.charCodeAt(start) === 0x09)) start++
  return text.slice(start)
}

// `trim_end_matches([' ', '\t'])`.
function trimEndBlanks(text: string): string {
  let end = text.length
  while (end > 0 && (text.charCodeAt(end - 1) === 0x20 || text.charCodeAt(end - 1) === 0x09)) end--
  return text.slice(0, end)
}

// Folds the line breaks of a scalar: blanks around a break go, one break becomes a space, and
// each further break stays.
function fold(text: string): string {
  if (!text.includes('\n')) return text

  let joined = ''
  const parts = text.split('\n')
  const last = parts.length - 1
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i] as string
    if (i > 0) part = trimStartBlanks(part)
    if (i < last) part = trimEndBlanks(part)
    if (i > 0) joined += '\n'
    joined += part
  }

  const out = buf()
  let breaks = 0
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i] as string
    if (c === '\n') {
      breaks += 1
      continue
    }
    pushBreaks(out, breaks)
    breaks = 0
    out.s += c
  }
  pushBreaks(out, breaks)
  return out.s
}

function pushBreaks(out: Buf, breaks: number): void {
  if (breaks === 0) return
  if (breaks === 1) {
    out.s += ' '
    return
  }
  for (let i = 1; i < breaks; i++) out.s += '\n'
}

function unquoteDouble(body: string): Result<string, Fail> {
  let joined = ''
  let from = 0
  let i = body.indexOf('\\')
  if (i < 0) i = body.length
  while (i < body.length) {
    if (body.charCodeAt(i) === 0x5c && body.charCodeAt(i + 1) === 0x0a) {
      joined += body.slice(from, i)
      i += 2
      while (body.charCodeAt(i) === 0x20 || body.charCodeAt(i) === 0x09) i++
      from = i
    } else {
      i += 1
    }
  }
  joined += body.slice(from)

  // Escapes count UTF-16 units, as Pele's string indexing does.
  const s = fold(joined)
  const out = buf()
  i = 0
  while (i < s.length) {
    const ch = s.charCodeAt(i)
    if (ch !== 0x5c) {
      const next = s.indexOf('\\', i)
      const stop = next < 0 ? s.length : next
      out.s += i === 0 && stop === s.length ? s : s.slice(i, stop)
      i = stop
      continue
    }
    i += 1
    const e = i < s.length ? s.charCodeAt(i) : 0
    const length = e === 0x78 ? 2 : e === 0x75 ? 4 : e === 0x55 ? 8 : 0
    if (length > 0) {
      const digits = s.slice(i + 1, Math.min(i + 1 + length, s.length))
      const pushed = pushCodePoint(out, parseHex(digits))
      if (!pushed.ok) return pushed
      i += length + 1
    } else {
      const c = i < s.length ? escape(s.charCodeAt(i)) : undefined
      if (c === undefined) return err(error('YAML: unknown escape sequence'))
      out.s += String.fromCharCode(c)
      i += 1
    }
  }
  // `String::from_utf16_lossy`: an unpaired surrogate becomes U+FFFD.
  return ok(out.s.toWellFormed())
}

// JavaScript's `parseInt(text, 16)`.
function parseHex(text: string): number {
  let at = 0
  while (at < text.length && isSpace(text.charCodeAt(at))) at++

  let negative = false
  const sign = text.charCodeAt(at)
  if (sign === 0x2d || sign === 0x2b) {
    negative = sign === 0x2d
    at++
  }
  if (text.length - at >= 2 && text.charCodeAt(at) === 0x30 && (text.charCodeAt(at + 1) === 0x78 || text.charCodeAt(at + 1) === 0x58)) {
    at += 2
  }

  let value = 0
  let any = false
  for (; at < text.length; at++) {
    const digit = toDigit(text.charCodeAt(at), 16)
    if (digit === undefined) break
    value = value * 16 + digit
    any = true
  }
  if (!any) return Number.NaN
  return negative ? -value : value
}

// `String.fromCodePoint`, which throws a RangeError for a value that is not a code point.
function pushCodePoint(out: Buf, value: number): Result<undefined, Fail> {
  if (!(value >= 0 && value <= 1_114_111) || value % 1 !== 0) {
    const message = buf('Invalid code point ')
    pushNumber(message, value)
    return err({ kind: 'Error', _0: message.s })
  }

  // A surrogate code stays a lone unit, as Rust pushes it when `char::from_u32` refuses it.
  out.s += String.fromCodePoint(value)
  return ok(undefined)
}

function skip(s: string, pos: number, commas: boolean): number {
  while (pos < s.length) {
    const c = s.charCodeAt(pos)
    if (c === 0x20 || c === 0x0a || c === 0x09 || c === 0x0d || (commas && c === 0x2c)) {
      pos += 1
    } else if (c === 0x23 && (pos === 0 || previousIsSpace(s, pos))) {
      const at = s.indexOf('\n', pos)
      pos = at < 0 ? s.length : at
    } else {
      break
    }
  }
  return pos
}

function previousIsSpace(s: string, pos: number): boolean {
  return pos > 0 && pos <= s.length && space(s.charCodeAt(pos - 1))
}

// Entries of a flow collection are separated by exactly one comma, as js-yaml requires.
function entryStart(c: number, separated: boolean): Result<undefined, Fail> {
  if (!separated) return err(error('YAML: missed comma between flow collection entries'))
  if (c === 0x2c) return err(error("YAML: expected the node content, but found ','"))
  return ok(undefined)
}

/** Whether the UTF-16 unit `c` is one of `stops`, as `stops.includes(s[end])` tests. */
function isStop(stops: string, c: number): boolean {
  for (let i = 0; i < stops.length; i++) if (stops.charCodeAt(i) === c) return true
  return false
}

/** Whether the character after a `:` ends a plain key: a space, or one of `,[]{}`. */
function endsPlainKey(n: number): boolean {
  return space(n) || n === 0x2c || n === 0x5b || n === 0x5d || n === 0x7b || n === 0x7d
}

const INCOMPLETE_FLOW = 'YAML: unexpected end of the stream within a flow collection'

// Parses a flow value starting at `pos`; returns the value and the index after it.
function flow(s: string, pos: number, stops: string, depth: number): Result<[Value, number], Fail> {
  if (depth > MAX_DEPTH) return err(error('YAML: nesting is too deep'))

  pos = skip(s, pos, false)
  const open = s.charCodeAt(pos)
  if (open === 0x7b) {
    const out: [string, Value][] = []
    pos += 1
    let separated = true
    for (;;) {
      pos = skip(s, pos, false)
      if (pos >= s.length) return err({ kind: 'Incomplete', _0: INCOMPLETE_FLOW })
      const c = s.charCodeAt(pos)
      if (c === 0x7d) return ok([{ kind: 'Object', _0: out }, pos + 1])
      const started = entryStart(c, separated)
      if (!started.ok) return started
      const key = flow(s, pos, ':,}', depth + 1)
      if (!key.ok) return key
      pos = skip(s, key.value[1], false)
      let value: Value = { kind: 'Null' }
      if (s.charCodeAt(pos) === 0x3a) {
        const read = flow(s, pos + 1, ',}', depth + 1)
        if (!read.ok) return read
        ;[value, pos] = read.value
      }
      const keyValue = key.value[0]
      let name: string
      if (keyValue.kind === 'String') {
        name = keyValue._0
      } else {
        const text = buf()
        valuePushJsString(keyValue, text)
        name = text.s
      }
      set(out, name, value)
      pos = skip(s, pos, false)
      separated = s.charCodeAt(pos) === 0x2c
      if (separated) pos += 1
    }
  }
  if (open === 0x5b) {
    const out: Value[] = []
    pos += 1
    let separated = true
    for (;;) {
      pos = skip(s, pos, false)
      if (pos >= s.length) return err({ kind: 'Incomplete', _0: INCOMPLETE_FLOW })
      const c = s.charCodeAt(pos)
      if (c === 0x5d) return ok([{ kind: 'Array', _0: out }, pos + 1])
      const started = entryStart(c, separated)
      if (!started.ok) return started
      const read = flow(s, pos, ',]', depth + 1)
      if (!read.ok) return read
      out.push(read.value[0])
      pos = skip(s, read.value[1], false)
      separated = s.charCodeAt(pos) === 0x2c
      if (separated) pos += 1
    }
  }
  if (open === 0x22) {
    let end = pos + 1
    while (end < s.length && s.charCodeAt(end) !== 0x22) end += s.charCodeAt(end) === 0x5c ? 2 : 1
    if (end >= s.length) {
      return err({ kind: 'Incomplete', _0: 'YAML: unexpected end of the stream within a double quoted scalar' })
    }
    const body = s.slice(pos + 1, end)
    const unquoted = unquoteDouble(body)
    if (!unquoted.ok) return unquoted
    return ok([{ kind: 'String', _0: unquoted.value }, end + 1])
  }
  if (open === 0x27) {
    let end = pos + 1
    while (end < s.length) {
      if (s.charCodeAt(end) === 0x27) {
        if (s.charCodeAt(end + 1) !== 0x27) break
        end += 1
      }
      end += 1
    }
    if (end >= s.length) {
      return err({ kind: 'Incomplete', _0: 'YAML: unexpected end of the stream within a single quoted scalar' })
    }
    const folded = fold(s.slice(pos + 1, end))
    let out = ''
    for (let i = 0; i < folded.length; i++) {
      const c = folded[i] as string
      out += c
      if (c === "'" && folded[i + 1] === "'") i++
    }
    return ok([{ kind: 'String', _0: out }, end + 1])
  }

  let end = pos
  while (end < s.length) {
    const c = s.charCodeAt(end)
    if (isStop(stops, c) && (c !== 0x3a || end + 1 >= s.length || endsPlainKey(s.codePointAt(end + 1) as number))) {
      break
    }
    if (c === 0x23 && end > pos && previousIsSpace(s, end)) {
      const raw = trim(s.slice(pos, end))
      const at = s.indexOf('\n', end)
      const after = at < 0 ? s.length : at
      return ok([scalar(fold(raw)), after])
    }
    end += 1
  }
  const raw = trim(s.slice(pos, end))
  return ok([scalar(fold(raw)), end])
}

function stripComment(s: string): string {
  let quote = 0
  let i = 0
  while (i < s.length) {
    const c = s.charCodeAt(i)
    if (quote !== 0) {
      if (c === 0x5c && quote === 0x22) i += 1
      else if (c === quote) quote = 0
    } else if (c === 0x22 || c === 0x27) {
      quote = c
    } else if (c === 0x23 && (i === 0 || s.charCodeAt(i - 1) === 0x20 || s.charCodeAt(i - 1) === 0x09)) {
      return s.slice(0, i)
    }
    i += 1
  }
  return s
}

// /^[|>][-+0-9]*\s*(?:#.*)?$/
function isBlockHeader(rest: string): boolean {
  let at = 1
  while (at < rest.length) {
    const c = rest.charCodeAt(at)
    if (c === 0x2d || c === 0x2b || (c >= 0x30 && c <= 0x39)) at++
    else break
  }
  while (at < rest.length && space(rest.charCodeAt(at))) at++
  const tail = rest.slice(at)
  if (tail === '') return true
  if (!tail.startsWith('#')) return false
  for (let i = 0; i < tail.length; i++) if (isLineEnd(tail.charCodeAt(i))) return false
  return true
}

function blockScalar(r: Reader, header: string, parentIndent: number): string {
  const folded = header.startsWith('>')
  const chomp = header.includes('-') ? '-' : header.includes('+') ? '+' : ''
  const explicit = /[1-9]/.exec(header)
  let indent = explicit === null ? -1 : parentIndent + Number(explicit[0])

  const out: string[] = []
  while (r.i < r.lines.length) {
    const line = readerLine(r)
    if (trim(line) === '') {
      out.push('')
      r.i += 1
      continue
    }
    const k = leading(line)
    if (indent === -1) {
      if (k <= parentIndent) break
      indent = k
    }
    if (k < indent) break
    out.push(afterChars(line, Math.abs(indent)))
    r.i += 1
  }

  let trailing = 0
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop()
    trailing += 1
  }

  let text = ''
  if (folded) {
    for (let i = 0; i < out.length; i++) {
      const cur = out[i] as string
      if (i > 0) {
        const prev = out[i - 1] as string
        if (cur === '') {
          text += '\n'
        } else if (prev !== '') {
          const indented = (s: string): boolean => s.startsWith(' ') || s.startsWith('\t')
          text += indented(prev) || indented(cur) ? '\n' : ' '
        }
      }
      text += cur
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      if (i > 0) text += '\n'
      text += out[i] as string
    }
  }

  if (out.length === 0) return chomp === '+' ? '\n'.repeat(trailing) : ''
  if (chomp === '+') text += '\n'.repeat(trailing + 1)
  else if (chomp !== '-') text += '\n'
  return text
}

function inlineValue(r: Reader, rest: string, indent: number): Result<Value, Fail> {
  if ((rest.startsWith('|') || rest.startsWith('>')) && isBlockHeader(rest)) {
    return ok({ kind: 'String', _0: blockScalar(r, rest, indent) })
  }

  if (rest.startsWith('{') || rest.startsWith('[') || rest.startsWith('"') || rest.startsWith("'")) {
    // The value may continue on later lines. Read them in growing batches until it closes.
    const start = r.i
    let text = rest
    let taken = 0
    let batch = 1
    for (;;) {
      const read = flow(text, 0, '', 0)
      if (read.ok) {
        const [value, end] = read.value
        const head = text.slice(0, end)
        let used = 0
        for (let at = head.indexOf('\n'); at >= 0; at = head.indexOf('\n', at + 1)) used++
        const tail = text.slice(end)
        const at = tail.indexOf('\n')
        const line = at < 0 ? tail : tail.slice(0, at)
        if (trim(stripComment(line)) !== '') return err(error('YAML: unexpected content after a value'))
        r.i = start + used
        return ok(value)
      }
      const fail = read.error
      if (fail.kind !== 'Incomplete') return read
      if (start + taken >= r.lines.length) return err({ kind: 'Error', _0: fail._0 })
      const to = Math.min(start + taken + batch, r.lines.length)
      for (const line of r.lines.slice(start + taken, to)) text += `\n${line}`
      taken += to - (start + taken)
      batch *= 2
    }
  }

  let text = trim(stripComment(rest))
  const deeper = (line: string): boolean => leading(line) > indent
  while (r.i < r.lines.length) {
    const line = readerLine(r)
    if (trim(line) === '') {
      let j = r.i
      while (j < r.lines.length && trim(r.lines[j] as string) === '') j++
      if (j >= r.lines.length || !deeper(r.lines[j] as string)) break
      text += '\n'.repeat(j - r.i)
      r.i = j
      continue
    }
    if (!deeper(line)) break
    const more = trim(stripComment(line))
    if (!text.endsWith('\n')) text += ' '
    text += more
    r.i += 1
  }
  return ok(scalar(text))
}

function isSequenceItem(line: string): boolean {
  return line === '-' || line.startsWith('- ')
}

function block(r: Reader, minIndent: number, depth: number): Result<Value, Fail> {
  if (depth > MAX_DEPTH) return err(error('YAML: nesting is too deep'))

  readerSkipBlank(r)
  if (r.i >= r.lines.length) return ok({ kind: 'Null' })
  const indented = readerIndent(r)
  if (!indented.ok) return indented
  const indent = indented.value
  if (indent < minIndent) return ok({ kind: 'Null' })
  const line = readerLine(r).slice(indent)
  const signed = indent

  if (isSequenceItem(line)) {
    const out: Value[] = []
    while (r.i < r.lines.length) {
      readerSkipBlank(r)
      if (r.i >= r.lines.length) break
      const k = readerIndent(r)
      if (!k.ok) return k
      if (k.value !== indent) break
      const cur = readerLine(r).slice(indent)
      if (!isSequenceItem(cur)) break
      const rest = cur.slice(1)
      const pad = leading(rest) + 1
      const body = trim(stripComment(rest))
      if (body === '') {
        r.i += 1
        const item = block(r, indent + 1, depth + 1)
        if (!item.ok) return item
        out.push(item.value)
      } else if (splitKey(body) !== undefined) {
        const rewritten = ' '.repeat(indent + pad) + rest.slice(leading(rest))
        if (r.i < r.lines.length) r.lines[r.i] = rewritten
        const item = block(r, indent + pad, depth + 1)
        if (!item.ok) return item
        out.push(item.value)
      } else {
        r.i += 1
        const item = inlineValue(r, trim(rest), signed)
        if (!item.ok) return item
        out.push(item.value)
      }
    }
    return ok({ kind: 'Array', _0: out })
  }

  if (splitKey(line) === undefined) {
    r.i += 1
    return inlineValue(r, trim(line), signed - 1)
  }

  const out: [string, Value][] = []
  while (r.i < r.lines.length) {
    readerSkipBlank(r)
    if (r.i >= r.lines.length) break
    const indentedK = readerIndent(r)
    if (!indentedK.ok) return indentedK
    const k = indentedK.value
    if (k < indent) break
    if (k > indent) return err(error('YAML: bad indentation of a mapping entry'))
    const cur = readerLine(r).slice(indent)
    const split = splitKey(cur)
    if (split === undefined) return err(error('YAML: can not read a block mapping entry'))
    const [end, length] = split
    const key = buf()
    const read = flow(cur.slice(0, end), 0, '', 0)
    if (!read.ok) return read
    valuePushJsString(read.value[0], key)
    const rest = cur.slice(length)
    r.i += 1

    let value: Value
    if (trim(stripComment(rest)) === '') {
      readerSkipBlank(r)
      if (r.i < r.lines.length) {
        const nextIndent = readerIndent(r)
        if (!nextIndent.ok) return nextIndent
        const next = nextIndent.value
        const seq = isSequenceItem(readerLine(r).slice(next))
        if (next > indent || (seq && next === indent)) {
          const read = block(r, seq ? indent : indent + 1, depth + 1)
          if (!read.ok) return read
          value = read.value
        } else {
          value = { kind: 'Null' }
        }
      } else {
        value = { kind: 'Null' }
      }
    } else {
      const read = inlineValue(r, trim(rest), signed)
      if (!read.ok) return read
      value = read.value
    }
    set(out, key.s, value)
  }
  return ok({ kind: 'Object', _0: out })
}

/** Parses `src`. Errors carry js-yaml's message. */
export function parse(src: string): Result<Value, string> {
  const trimmed = trim(src)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const read = flow(trimmed, 0, '', 0)
    if (!read.ok) return err(failIntoMessage(read.error))
    const [value, end] = read.value
    if (skip(trimmed, end, false) === trimmed.length) return ok(value)
  }

  const r = readerNew(src)
  const value = block(r, 0, 0)
  if (!value.ok) return err(failIntoMessage(value.error))
  readerSkipBlank(r)
  if (r.i < r.lines.length && trim(readerLine(r)) !== '...') {
    return err('YAML: end of the stream or a document separator is expected')
  }
  return ok(value.value)
}
