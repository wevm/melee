/**
 * @module Reads decimal text as the nearest double, accepting exactly what Rust's
 * `str::parse::<f64>` accepts. JavaScript's `Number` rounds correctly too, so only the accepted
 * syntax is checked here.
 */

/**
 * `String.prototype.charCodeAt`, called as `charCodeAt.call(text, i)`, which stays a direct read
 * whatever internal kind of string arrives. It stays unexported, as `text/measure.ts` explains.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** Powers of ten that doubles hold exactly. */
const POW10 = [
  1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19,
  1e20, 1e21, 1e22,
]

/**
 * `text` from `i` as unsigned `digits[.digits]` with at most 15 digits and no exponent, read
 * exactly: the digits as an integer below 2^53 divided by an exact power of ten, which IEEE
 * division rounds correctly, as `Number` does. `undefined` for any other text.
 */
function shortDecimal(text: string, i: number): number | undefined {
  const n = text.length
  let mantissa = 0
  let digits = 0
  let fraction = -1
  for (; i < n; i++) {
    const c = charCodeAt.call(text, i)
    if (c >= 48 && c <= 57) {
      mantissa = mantissa * 10 + (c - 48)
      digits++
      if (fraction >= 0) fraction++
    } else if (c === 46 && fraction < 0) {
      fraction = 0
    } else {
      return undefined
    }
  }
  if (digits === 0 || digits > 15) return undefined
  return fraction > 0 ? mantissa / (POW10[fraction] as number) : mantissa
}

/**
 * Whether `text` from `i` is unsigned `digits[.digits][e[+-]digits]` with at least one mantissa
 * digit: `^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`.
 */
function isDecimal(text: string, i: number): boolean {
  const n = text.length
  let digits = 0
  let c = 0
  for (; i < n; i++) {
    c = charCodeAt.call(text, i)
    if (c < 48 || c > 57) break
    digits++
  }
  if (i < n && c === 46) {
    for (i++; i < n; i++) {
      c = charCodeAt.call(text, i)
      if (c < 48 || c > 57) break
      digits++
    }
  }
  if (digits === 0) return false
  if (i === n) return true
  if (c !== 101 && c !== 69) return false
  i++
  if (i < n) {
    c = charCodeAt.call(text, i)
    if (c === 43 || c === 45) i++
  }
  if (i === n) return false
  for (; i < n; i++) {
    c = charCodeAt.call(text, i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** `text` as the nearest double with ties to even, or `undefined` where `str::parse::<f64>` fails. */
export function parse(text: string): number | undefined {
  const sign = text.length > 0 ? charCodeAt.call(text, 0) : 0
  const negative = sign === 45
  const from = negative || sign === 43 ? 1 : 0

  // Negating a parsed value is exact, and `Number` reads the sign itself.
  const short = shortDecimal(text, from)
  if (short !== undefined) return negative ? -short : short
  if (isDecimal(text, from)) return Number(text)

  // `inf`, `infinity`, and `nan` in any case, which Rust also reads.
  const lower = text.slice(from).toLowerCase()
  let value: number
  if (lower === 'inf' || lower === 'infinity') value = Number.POSITIVE_INFINITY
  else if (lower === 'nan') value = Number.NaN
  else return undefined
  return negative ? -value : value
}
