/**
 * @module Rust standard library semantics that differ from JavaScript's built-ins. The compiler
 * is a port of Ondine's Rust crate, and every place where a JavaScript built-in behaves
 * differently from the Rust method it replaces goes through a helper here, so output stays
 * byte-identical.
 */

/** A fallible result for operations whose Rust error type is not the compile error. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

/** A successful result. */
export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value }
}

/** A failed result. */
export function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { error, ok: false }
}

/** A string being built, standing in for a Rust `&mut String` passed to another function. */
export type Buf = { s: string }

/** An empty string builder. */
export function buf(initial = ''): Buf {
  return { s: initial }
}

/** `f64::round`: halves round away from zero, unlike `Math.round`. */
export function round(value: number): number {
  // `Math.round` is exact and rounds halves up, which is away from zero for magnitudes.
  return Math.sign(value) * Math.round(Math.abs(value))
}

/** `f64::max`: a NaN operand is ignored, unlike `Math.max`. */
export function fmax(a: number, b: number): number {
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return a > b ? a : b
}

/** `f64::min`: a NaN operand is ignored, unlike `Math.min`. */
export function fmin(a: number, b: number): number {
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return a < b ? a : b
}

/** `f64::clamp`. NaN stays NaN. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/** `f64::signum`: 1 for +0 and positive values, -1 for -0 and negative values, NaN for NaN. */
export function signum(value: number): number {
  if (Number.isNaN(value)) return Number.NaN
  return value > 0 || Object.is(value, 0) ? 1 : -1
}

/** `f64::powi`, by square-and-multiply as compiler-rt's `__powidf2` computes it. */
export function powi(base: number, exponent: number): number {
  const reciprocal = exponent < 0
  let b = Math.abs(exponent)
  let a = base
  let r = 1
  for (;;) {
    if (b & 1) r *= a
    b = Math.trunc(b / 2)
    if (b === 0) break
    a *= a
  }
  return reciprocal ? 1 / r : r
}

/** `f64::rem_euclid`. */
export function remEuclid(a: number, b: number): number {
  const r = a % b
  return r < 0 ? r + Math.abs(b) : r
}

/**
 * A float cast to an unsigned integer with `as` (`as u8`, `as u32`, `as usize`): truncates toward
 * zero, saturates at `0` and `max`, and maps NaN to `0`.
 */
export function asUint(value: number, max = Number.MAX_SAFE_INTEGER): number {
  if (Number.isNaN(value) || value <= 0) return 0
  if (value >= max) return max
  return Math.trunc(value)
}

/** A float cast to a signed integer with `as` (`as i32`, `as i64`): truncates and saturates. */
export function asInt(value: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  if (Number.isNaN(value)) return 0
  if (value <= min) return min
  if (value >= max) return max
  return Math.trunc(value) || 0
}

/** Integer division as Rust performs it on integer types: truncates toward zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b)
}

/** `usize::saturating_sub`. */
export function saturatingSub(a: number, b: number): number {
  return a > b ? a - b : 0
}

/** Compares numbers as `f64::total_cmp` does for the non-NaN values the compiler sorts. */
export function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** `f64::partial_cmp(..).unwrap_or(Ordering::Equal)`, the usual comparator in the crate. */
export function partialCmp(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** `f64::total_cmp`: orders -0 before +0 and NaN after every number. */
export function totalCmp(a: number, b: number): number {
  const an = Number.isNaN(a)
  const bn = Number.isNaN(b)
  if (an || bn) return an === bn ? 0 : an ? 1 : -1
  if (a < b) return -1
  if (a > b) return 1
  if (a === 0 && b === 0) return Object.is(a, b) ? 0 : Object.is(a, -0) ? -1 : 1
  return 0
}

/** `str::cmp`: compares by Unicode scalar value (UTF-8 byte order), not by UTF-16 unit. */
export function cmpStr(a: string, b: string): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x === y) continue
    // A surrogate (a scalar above U+FFFF) sorts after every BMP unit at or above U+E000.
    const xs = x >= 0xd800 && x <= 0xdfff
    const ys = y >= 0xd800 && y <= 0xdfff
    if (xs !== ys) return xs ? 1 : -1
    return x < y ? -1 : 1
  }
  return a.length - b.length < 0 ? -1 : a.length > b.length ? 1 : 0
}

/** Chains comparator results as `Ordering::then` does. Not named `then`, which would make the module namespace a thenable. */
export function thenCmp(first: number, second: () => number): number {
  return first !== 0 ? first : second()
}

/** The number of UTF-8 bytes in `text`, for code that reads `str::len` as a measure. */
export function utf8Length(text: string): number {
  let length = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) length += 1
    else if (c < 0x800) length += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4
        i++
      } else length += 3
    } else length += 3
  }
  return length
}

/** `str::chars().count()`: the number of Unicode scalar values. */
export function charCount(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
    }
    count++
  }
  return count
}

/** `str::chars()` as code points. */
export function codePoints(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i) as number
    if (c > 0xffff) i++
    out.push(c)
  }
  return out
}

/**
 * The code point starting at UTF-16 offset `at`, with the number of units it takes, as a
 * `chars()` step over a byte offset reads one scalar. A lone surrogate reads as itself.
 */
export function charAt(text: string, at: number): { readonly code: number; readonly length: number } | undefined {
  if (at < 0 || at >= text.length) return undefined
  const code = text.codePointAt(at) as number
  return { code, length: code > 0xffff ? 2 : 1 }
}

/** `char::is_whitespace`: the Unicode `White_Space` property. Unlike JavaScript's `\s`, it includes U+0085 and excludes U+FEFF. */
export function isWhitespace(c: number): boolean {
  if (c < 0x80) return c === 32 || (c >= 9 && c <= 13)
  return (
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  )
}

/** `str::trim`, which trims `White_Space`, unlike `String.prototype.trim`. */
export function trim(text: string): string {
  return trimEnd(trimStart(text))
}

/** `str::trim_start`. */
export function trimStart(text: string): string {
  let start = 0
  while (start < text.length && isWhitespace(text.charCodeAt(start))) start++
  return start === 0 ? text : text.slice(start)
}

/** `str::trim_end`. */
export function trimEnd(text: string): string {
  let end = text.length
  while (end > 0 && isWhitespace(text.charCodeAt(end - 1))) end--
  return end === text.length ? text : text.slice(0, end)
}

/** `str::trim_matches(c)` for one character. */
export function trimMatches(text: string, c: string): string {
  let start = 0
  let end = text.length
  while (text.startsWith(c, start) && start < end) start += c.length
  while (end - c.length >= start && text.endsWith(c, end)) end -= c.length
  return text.slice(start, end)
}

/** `str::split_whitespace`. */
export function splitWhitespace(text: string): string[] {
  const out: string[] = []
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (isWhitespace(text.charCodeAt(i))) {
      if (start >= 0) out.push(text.slice(start, i))
      start = -1
    } else if (start < 0) start = i
  }
  if (start >= 0) out.push(text.slice(start))
  return out
}

/** `str::split_ascii_whitespace`. */
export function splitAsciiWhitespace(text: string): string[] {
  const out: string[] = []
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20) {
      if (start >= 0) out.push(text.slice(start, i))
      start = -1
    } else if (start < 0) start = i
  }
  if (start >= 0) out.push(text.slice(start))
  return out
}

/** `str::lines`: splits on `\n`, strips one `\r` before it, and yields no final empty line. */
export function lines(text: string): string[] {
  if (text === '') return []
  const parts = text.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

/** `str::splitn(n, pattern)`: at most `n` pieces, the last holding the remainder. */
export function splitn(text: string, n: number, pattern: string): string[] {
  const out: string[] = []
  let start = 0
  while (out.length < n - 1) {
    const at = text.indexOf(pattern, start)
    if (at < 0) break
    out.push(text.slice(start, at))
    start = at + pattern.length
  }
  out.push(text.slice(start))
  return out
}

/** `str::split_once(pattern)`. */
export function splitOnce(text: string, pattern: string): [string, string] | undefined {
  const at = text.indexOf(pattern)
  if (at < 0) return undefined
  return [text.slice(0, at), text.slice(at + pattern.length)]
}

/** `str::rsplit_once(pattern)`. */
export function rsplitOnce(text: string, pattern: string): [string, string] | undefined {
  const at = text.lastIndexOf(pattern)
  if (at < 0) return undefined
  return [text.slice(0, at), text.slice(at + pattern.length)]
}

/** `str::strip_prefix`. */
export function stripPrefix(text: string, prefix: string): string | undefined {
  return text.startsWith(prefix) ? text.slice(prefix.length) : undefined
}

/** `str::strip_suffix`. */
export function stripSuffix(text: string, suffix: string): string | undefined {
  return text.endsWith(suffix) ? text.slice(0, text.length - suffix.length) : undefined
}

/** `str::to_ascii_lowercase`: changes only ASCII letters, unlike `toLowerCase`. */
export function asciiLower(text: string): string {
  return shiftAscii(text, 65, 90, 32)
}

/** `str::to_ascii_uppercase`. */
export function asciiUpper(text: string): string {
  return shiftAscii(text, 97, 122, -32)
}

/** `text` with the units from `lo` to `hi` moved by `by`. */
function shiftAscii(text: string, lo: number, hi: number, by: number): string {
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (c >= lo && c <= hi) break
    i++
  }
  if (i === text.length) return text
  let out = text.slice(0, i)
  let from = i
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= lo && c <= hi) {
      if (from < i) out += text.slice(from, i)
      out += String.fromCharCode(c + by)
      from = i + 1
    }
  }
  if (from < text.length) out += text.slice(from)
  return out
}

/** An ASCII uppercase letter as lowercase, and any other unit as itself. */
function lowerUnit(c: number): number {
  return c >= 65 && c <= 90 ? c + 32 : c
}

/** `str::eq_ignore_ascii_case`. */
export function eqIgnoreAsciiCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x !== y && lowerUnit(x) !== lowerUnit(y)) return false
  }
  return true
}

/** `str::starts_with` ignoring ASCII case, a common hand-written prefix test in the crate. */
export function startsWithIgnoreAsciiCase(text: string, prefix: string, at = 0): boolean {
  if (at < 0) return eqIgnoreAsciiCase(text.slice(at, at + prefix.length), prefix)
  if (prefix.length === 0) return true
  if (at + prefix.length > text.length) return false
  for (let i = 0; i < prefix.length; i++) {
    const x = text.charCodeAt(at + i)
    const y = prefix.charCodeAt(i)
    if (x !== y && lowerUnit(x) !== lowerUnit(y)) return false
  }
  return true
}

const ALPHABETIC = /\p{Alphabetic}/u
const NUMERIC = /\p{N}/u
const UPPERCASE = /\p{Uppercase}/u
const LOWERCASE = /\p{Lowercase}/u

/** `char::is_alphabetic`: the Unicode `Alphabetic` property. */
export function isAlphabetic(c: number): boolean {
  if (c < 0x80) return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
  return ALPHABETIC.test(String.fromCodePoint(c))
}

/** `char::is_numeric`: the general categories `Nd`, `Nl`, and `No`. */
export function isNumeric(c: number): boolean {
  if (c < 0x80) return c >= 48 && c <= 57
  return NUMERIC.test(String.fromCodePoint(c))
}

/** `char::is_alphanumeric`. */
export function isAlphanumeric(c: number): boolean {
  return isAlphabetic(c) || isNumeric(c)
}

/** `char::is_uppercase`: the Unicode `Uppercase` property. */
export function isUppercase(c: number): boolean {
  if (c < 0x80) return c >= 65 && c <= 90
  return UPPERCASE.test(String.fromCodePoint(c))
}

/** `char::is_lowercase`: the Unicode `Lowercase` property. */
export function isLowercase(c: number): boolean {
  if (c < 0x80) return c >= 97 && c <= 122
  return LOWERCASE.test(String.fromCodePoint(c))
}

/** `char::is_control`: the general category `Cc`. */
export function isControl(c: number): boolean {
  return c < 0x20 || (c >= 0x7f && c <= 0x9f)
}

/**
 * `str::parse` for an unsigned integer type: ASCII digits with an optional `+`, no whitespace,
 * failing past `max`.
 */
export function parseUint(text: string, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const digits = text.startsWith('+') ? text.slice(1) : text
  if (!allDigits(digits)) return undefined
  const value = Number(digits)
  return value > max ? undefined : value
}

/** Whether `text` is one or more ASCII digits. */
function allDigits(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** `str::parse` for a signed integer type. */
export function parseInt(
  text: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const negative = text.startsWith('-')
  const digits = text.startsWith('+') || negative ? text.slice(1) : text
  if (!allDigits(digits)) return undefined
  const value = negative ? -Number(digits) : Number(digits)
  return value < min || value > max ? undefined : value
}

/** `Vec::retain`, in place, so aliases of the array observe the removal as in Rust. */
export function retain<T>(items: T[], keep: (item: T, index: number) => boolean): void {
  let to = 0
  for (let from = 0; from < items.length; from++) {
    const item = items[from] as T
    if (keep(item, from)) items[to++] = item
  }
  items.length = to
}

/** `Vec::dedup_by_key`, in place. */
export function dedupBy<T>(items: T[], same: (a: T, b: T) => boolean): void {
  if (items.length === 0) return
  let to = 1
  for (let from = 1; from < items.length; from++) {
    const item = items[from] as T
    if (!same(item, items[to - 1] as T)) items[to++] = item
  }
  items.length = to
}

/** `Vec::swap_remove`. */
export function swapRemove<T>(items: T[], index: number): T {
  const item = items[index] as T
  const last = items.pop() as T
  if (index < items.length) items[index] = last
  return item
}

/**
 * `slice::binary_search_by`: `{ found: true, index }` for a match, or the insertion point. As in
 * Rust, which match is returned among equal elements is unspecified, so callers rely on it only
 * for unique keys.
 */
export function binarySearchBy<T>(
  items: readonly T[],
  compare: (item: T) => number,
): { readonly found: boolean; readonly index: number } {
  let size = items.length
  let base = 0
  if (size === 0) return { found: false, index: 0 }
  // Rust's implementation, so ties resolve to the same index.
  while (size > 1) {
    const half = size >> 1
    const mid = base + half
    if (compare(items[mid] as T) <= 0) base = mid
    size -= half
  }
  const cmp = compare(items[base] as T)
  if (cmp === 0) return { found: true, index: base }
  return { found: false, index: base + (cmp < 0 ? 1 : 0) }
}

/** `slice::partition_point`. */
export function partitionPoint<T>(items: readonly T[], pred: (item: T) => boolean): number {
  // `binarySearchBy` with a comparator that is -1 where `pred` holds and 1 elsewhere.
  let size = items.length
  let base = 0
  if (size === 0) return 0
  while (size > 1) {
    const half = size >> 1
    const mid = base + half
    if (pred(items[mid] as T)) base = mid
    size -= half
  }
  return pred(items[base] as T) ? base + 1 : base
}

/** The smallest normal double, doubled: below it, halving loses precision. */
const MIDPOINT_LO = 2.2250738585072014e-308 * 2
/** Half the largest double: above it, a sum can overflow. */
const MIDPOINT_HI = Number.MAX_VALUE / 2

/** `f64::midpoint`: the average of `a` and `b`, without overflow, as Rust computes it. */
export function midpoint(a: number, b: number): number {
  const absA = Math.abs(a)
  const absB = Math.abs(b)
  if (absA <= MIDPOINT_HI && absB <= MIDPOINT_HI) return (a + b) / 2
  if (absA < MIDPOINT_LO) return a + b / 2
  if (absB < MIDPOINT_LO) return a / 2 + b
  return a / 2 + b / 2
}
