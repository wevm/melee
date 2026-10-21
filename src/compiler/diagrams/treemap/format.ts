/**
 * @module The parts of d3-format's specifier that treemap values use: an optional `$`, `,` for
 * thousands separators, a precision, and a type of `f`, `%`, `d`, `e` or none. Fill, alignment
 * and width are read and ignored. Anything else falls back to the default, `,`. Port of Pele's
 * `src/diagrams/treemap/format.ts`.
 */
import { jsRound } from '../../svg/builder.ts'
import { isLineEnd } from '../../util/chars.ts'
import { parse as floatParse } from '../../util/float.ts'

/** A parsed specifier: the groups of Pele's `RE_SPEC` that change the output. */
export type Format = {
  /** Whether thousands are separated by commas. */
  comma: boolean
  /** Whether a `$` goes before the number. */
  currency: boolean
  /** Whether a `+` goes before a number that is not negative. */
  plus: boolean
  /** Digits after the point or significant digits, at most 20. */
  precision: number | undefined
  /** Whether trailing zeros are trimmed. */
  trim: boolean
  /** The type character, or `undefined`. */
  type: string | undefined
}

/** `Format::default()`. */
export function formatDefault(): Format {
  return { comma: false, currency: false, plus: false, precision: undefined, trim: false, type: undefined }
}

function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

/**
 * Reads `^([-+( ])?(\$)?0?\d*(,)?(?:\.(\d+))?(~)?([a-zA-Z%])?$` from `rest`, which follows the
 * optional fill and alignment.
 */
function tail(rest: string): Format | undefined {
  let at = 0
  const format = formatDefault()
  const n = rest.length

  const sign = rest.charCodeAt(at)
  if (at < n && (sign === 0x2d || sign === 0x2b || sign === 0x28 || sign === 0x20)) {
    format.plus = sign === 0x2b
    at += 1
  }
  if (rest.charCodeAt(at) === 0x24) {
    format.currency = true
    at += 1
  }
  while (at < n && isAsciiDigit(rest.charCodeAt(at))) at += 1
  if (rest.charCodeAt(at) === 0x2c) {
    format.comma = true
    at += 1
  }
  if (rest.charCodeAt(at) === 0x2e) {
    const from = at + 1
    let end = from
    while (end < n && isAsciiDigit(rest.charCodeAt(end))) end += 1
    if (end === from) return undefined
    // `Math.min(Number(digits), 20)`: past its leading zeros, a run of three digits is
    // above 20.
    let digits = rest.slice(from, end)
    let lead = 0
    while (lead < digits.length && digits.charCodeAt(lead) === 0x30) lead += 1
    digits = digits.slice(lead)
    format.precision = digits.length > 2 ? 20 : Math.min(digits === '' ? 0 : Number(digits), 20)
    at = end
  }
  if (rest.charCodeAt(at) === 0x7e) {
    format.trim = true
    at += 1
  }
  if (at < n) {
    const c = rest.charCodeAt(at)
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x25) {
      format.type = String.fromCharCode(c)
      at += 1
    }
  }
  return at === n ? format : undefined
}

/** A d3-format alignment character. */
function isAlign(c: string): boolean {
  return c === '<' || c === '>' || c === '=' || c === '^'
}

/**
 * Reads a specifier as `RE_SPEC` does: `^(?:.?[<>=^])?` and then {@link tail}. The fill is one
 * UTF-16 unit that is not a line terminator, so a character outside the BMP cannot be one.
 */
function spec(text: string): Format | undefined {
  const chars = Array.from(text)
  const first = chars[0]
  const second = chars[1]

  if (first !== undefined && second !== undefined && first.length === 1) {
    if (!isLineEnd(first.codePointAt(0) as number) && isAlign(second)) {
      const format = tail(text.slice(first.length + 1))
      if (format !== undefined) return format
    }
  }
  if (first !== undefined && isAlign(first)) {
    const format = tail(text.slice(1))
    if (format !== undefined) return format
  }
  return tail(text)
}

/**
 * Reads `spec` for {@link format}. Mermaid documents `$0,0` for a dollar amount with thousands
 * separators.
 */
export function formatter(text: string): Format {
  const t = text === '$0,0' ? '$,' : text
  return spec(t) ?? spec(',') ?? formatDefault()
}

// `toFixed`, `toExponential` and `toPrecision` below are JavaScript's own. The specification
// defines each over the exact value of the double, rounding half up, and V8 computes them
// exactly, so they match the Rust port's expansion of the exact decimal digits. `String` writes a
// number as `pushNumber` does.

/** `10 ** p` for the precisions a format can have, each exact. */
const POW10: readonly number[] = Array.from({ length: 21 }, (_, p) => 10 ** p)

/** `value.toFixed(digits)` for a value that is not negative. */
function toFixed(value: number, digits: number): string {
  return value.toFixed(digits)
}

/** `value.toExponential(digits)` for a finite value that is not negative. */
function toExponential(value: number, digits: number): string {
  return value.toExponential(digits)
}

/** `value.toPrecision(p)` for a finite value that is not negative. */
function toPrecision(value: number, p: number): string {
  return value.toPrecision(p)
}

/** `digits` with a comma before each group of three from the right. */
function group(digits: string): string {
  // The text is ASCII, so its UTF-16 units are its characters.
  const count = digits.length
  let first = count % 3
  if (first === 0) first = 3
  if (count <= 3) return digits
  let out = digits.slice(0, first)
  for (let i = first; i < count; i += 3) {
    out += ','
    out += digits.slice(i, i + 3)
  }
  return out
}

/** `body.replace(/\.?0+$/, '')`: trailing zeros, and a point they leave last. */
function trimZeros(body: string): string {
  let end = body.length
  while (end > 0 && body.charCodeAt(end - 1) === 0x30) end -= 1
  if (end === body.length) return body
  const trimmed = body.slice(0, end)
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed
}

/** Writes `value` as `format` reads it. */
export function format(format: Format, value: number): string {
  const abs = Math.abs(value)
  let suffix = ''
  let body: string
  switch (format.type) {
    case 'f':
      body = toFixed(abs, format.precision ?? 6)
      break
    case '%':
      suffix = '%'
      body = toFixed(abs * 100, format.precision ?? 6)
      break
    case 'd':
      body = toFixed(jsRound(abs), 0)
      break
    case 'e':
      body = toExponential(abs, format.precision ?? 6)
      break
    default: {
      const p = Math.max(format.precision ?? 12, 1)
      if (abs % 1 === 0 && abs < (POW10[p] as number)) {
        // A whole number of at most `p` digits is written exactly, and reads back as itself.
        body = String(abs)
      } else {
        const text = toPrecision(abs, p)
        // The text of a finite value is a decimal literal, which `Number` reads as `parse` does.
        body = String(Number.isFinite(abs) ? Number(text) : (floatParse(text) ?? Number.NaN))
      }
    }
  }

  if (format.trim && body.includes('.') && !body.includes('e')) {
    body = trimZeros(body)
  }
  if (format.comma && !body.includes('e')) {
    const dot = body.indexOf('.')
    body = dot < 0 ? group(body) : group(body.slice(0, dot)) + body.slice(dot)
  }

  let out = ''
  if (value < 0) out += '-'
  else if (format.plus) out += '+'
  if (format.currency) out += '$'
  out += body
  out += suffix
  return out
}
