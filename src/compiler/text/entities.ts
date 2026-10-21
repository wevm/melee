/** @module Decodes Mermaid's entity placeholders and HTML entities, as Pele's `decodeEntities` does. */
import { binarySearchBy, cmpStr } from '../util/rust.ts'

/** Named entities Pele recognizes, sorted by name for binary search. */
const NAMED: readonly (readonly [string, number])[] = [
  ['Alpha', 913],
  ['Beta', 914],
  ['Chi', 935],
  ['Dagger', 8225],
  ['Delta', 916],
  ['Epsilon', 917],
  ['Eta', 919],
  ['Gamma', 915],
  ['Iota', 921],
  ['Kappa', 922],
  ['Lambda', 923],
  ['Mu', 924],
  ['Nu', 925],
  ['Omega', 937],
  ['Omicron', 927],
  ['Phi', 934],
  ['Pi', 928],
  ['Prime', 8243],
  ['Psi', 936],
  ['Rho', 929],
  ['Sigma', 931],
  ['Tau', 932],
  ['Theta', 920],
  ['Upsilon', 933],
  ['Xi', 926],
  ['Zeta', 918],
  ['alpha', 945],
  ['amp', 38],
  ['and', 8743],
  ['apos', 39],
  ['ast', 42],
  ['asymp', 8776],
  ['bdquo', 8222],
  ['beta', 946],
  ['bsol', 92],
  ['bull', 8226],
  ['cap', 8745],
  ['cent', 162],
  ['check', 10003],
  ['chi', 967],
  ['clubs', 9827],
  ['colon', 58],
  ['comma', 44],
  ['commat', 64],
  ['cong', 8773],
  ['copy', 169],
  ['cross', 10007],
  ['cup', 8746],
  ['curren', 164],
  ['dArr', 8659],
  ['dagger', 8224],
  ['darr', 8595],
  ['deg', 176],
  ['delta', 948],
  ['diams', 9830],
  ['divide', 247],
  ['dollar', 36],
  ['empty', 8709],
  ['epsilon', 949],
  ['equals', 61],
  ['equiv', 8801],
  ['eta', 951],
  ['euro', 8364],
  ['excl', 33],
  ['exist', 8707],
  ['forall', 8704],
  ['frac12', 189],
  ['frac14', 188],
  ['frac34', 190],
  ['gamma', 947],
  ['ge', 8805],
  ['grave', 96],
  ['gt', 62],
  ['hArr', 8660],
  ['harr', 8596],
  ['hat', 94],
  ['hearts', 9829],
  ['hellip', 8230],
  ['iexcl', 161],
  ['infin', 8734],
  ['int', 8747],
  ['iota', 953],
  ['iquest', 191],
  ['isin', 8712],
  ['kappa', 954],
  ['lArr', 8656],
  ['lambda', 955],
  ['laquo', 171],
  ['larr', 8592],
  ['lbrace', 123],
  ['lbrack', 91],
  ['ldquo', 8220],
  ['le', 8804],
  ['lowbar', 95],
  ['loz', 9674],
  ['lpar', 40],
  ['lsaquo', 8249],
  ['lsquo', 8216],
  ['lt', 60],
  ['mdash', 8212],
  ['micro', 181],
  ['middot', 183],
  ['minus', 8722],
  ['mu', 956],
  ['nabla', 8711],
  ['nbsp', 160],
  ['ndash', 8211],
  ['ne', 8800],
  ['ni', 8715],
  ['not', 172],
  ['notin', 8713],
  ['nu', 957],
  ['num', 35],
  ['omega', 969],
  ['omicron', 959],
  ['oplus', 8853],
  ['or', 8744],
  ['otimes', 8855],
  ['para', 182],
  ['part', 8706],
  ['percnt', 37],
  ['period', 46],
  ['permil', 8240],
  ['perp', 8869],
  ['phi', 966],
  ['pi', 960],
  ['plus', 43],
  ['plusmn', 177],
  ['pound', 163],
  ['prime', 8242],
  ['prod', 8719],
  ['psi', 968],
  ['quest', 63],
  ['quot', 34],
  ['rArr', 8658],
  ['radic', 8730],
  ['raquo', 187],
  ['rarr', 8594],
  ['rbrace', 125],
  ['rbrack', 93],
  ['rdquo', 8221],
  ['reg', 174],
  ['rho', 961],
  ['rpar', 41],
  ['rsaquo', 8250],
  ['rsquo', 8217],
  ['sbquo', 8218],
  ['sdot', 8901],
  ['sect', 167],
  ['semi', 59],
  ['sigma', 963],
  ['sigmaf', 962],
  ['sim', 8764],
  ['sol', 47],
  ['spades', 9824],
  ['sub', 8834],
  ['sube', 8838],
  ['sum', 8721],
  ['sup', 8835],
  ['sup1', 185],
  ['sup2', 178],
  ['sup3', 179],
  ['supe', 8839],
  ['tau', 964],
  ['there4', 8756],
  ['theta', 952],
  ['tilde', 126],
  ['times', 215],
  ['trade', 8482],
  ['uArr', 8657],
  ['uarr', 8593],
  ['upsilon', 965],
  ['vert', 124],
  ['xi', 958],
  ['yen', 165],
  ['zeta', 950],
]

/** `String.prototype.charCodeAt`, for hot loops over text, as `text/measure.ts` explains. */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** Opens a Mermaid placeholder (`ﬂ°`); a second `°` marks a numeric code. */
const OPEN = '\u{fb02}\u{b0}'
/** Closes a Mermaid placeholder (`¶ß`). */
const CLOSE = '\u{b6}\u{df}'

/**
 * Turns Mermaid's `#35;` and `#quot;` codes, as hidden by preprocessing, and HTML entities into
 * characters. Unknown or invalid references stay as written.
 */
export function decode(text: string): string {
  // Most text is short and has neither `&` nor the `¶` that closes a placeholder. One pass over
  // its characters finds that sooner than a search for each.
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = charCodeAt.call(text, i)
    if (c === 0x26 || c === 0xb6) return decodeFound(text)
  }
  return text
}

/** {@link decode} of text that has a `&` or a `¶`. */
function decodeFound(text: string): string {
  const placeholders = text.includes(CLOSE) ? decodePlaceholders(text) : text

  if (!placeholders.includes('&')) return placeholders
  return decodeHtml(placeholders)
}

function lookup(name: string): string | undefined {
  const found = binarySearchBy(NAMED, ([entry]) => cmpStr(entry, name))
  if (!found.found) return undefined
  const entry = NAMED[found.index]
  return entry === undefined ? undefined : fromU32(entry[1])
}

/** `char::from_u32`: a Unicode scalar value, so neither a surrogate nor past U+10FFFF. */
function fromU32(code: number): string | undefined {
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return undefined
  return String.fromCodePoint(code)
}

function codePoint(value: number): string | undefined {
  if (value === 0 || value > 0x10ffff) return undefined
  return fromU32(value)
}

function decodePlaceholders(text: string): string {
  let out = ''
  let last = 0
  let from = text.indexOf(OPEN)

  while (from >= 0) {
    const start = from
    const bodyStart = start + OPEN.length
    const stop = text.indexOf('\u{b6}', bodyStart)
    if (stop < 0) break
    const after = stop + 1

    if (text.startsWith('\u{df}', after)) {
      const end = after + 1
      const numeric = text.startsWith('\u{b0}', bodyStart)
      const body = text.slice(numeric ? bodyStart + 1 : bodyStart, stop)

      out += text.slice(last, start)
      if (numeric) {
        const value = parseDecimal(body)
        const c = value === undefined ? undefined : codePoint(value)
        if (c !== undefined) out += c
        else out += text.slice(start, end)
      } else {
        const c = lookup(body)
        if (c !== undefined) out += c
        else out += `&${body};`
      }
      last = end
    }

    from = text.indexOf(OPEN, after)
  }

  if (last === 0) return text
  out += text.slice(last)
  return out
}

function isAsciiDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

function isAsciiHexDigit(c: number): boolean {
  return isAsciiDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

function isAsciiAlphanumeric(c: number): boolean {
  return isAsciiDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

// Matches `&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(\w+));`, replacing references that resolve.
function decodeHtml(text: string): string {
  let out = ''
  let last = 0
  let at = 0

  for (let start = text.indexOf('&', at); start >= 0; start = text.indexOf('&', at)) {
    let end = start + 1
    // `undefined` when the reference has no digits or name; otherwise what it resolves to.
    let decoded: { resolved: string | undefined } | undefined
    if (text.charCodeAt(end) === 0x23) {
      end += 1
      const marker = text.charCodeAt(end)
      if (marker === 0x78 || marker === 0x58) {
        end += 1
        const digits = end
        while (isAsciiHexDigit(text.charCodeAt(end))) end += 1
        decoded = end > digits ? { resolved: codePoint(parseHex(text.slice(digits, end))) } : undefined
      } else {
        const digits = end
        while (isAsciiDigit(text.charCodeAt(end))) end += 1
        if (end > digits) {
          const value = parseDecimal(text.slice(digits, end))
          decoded = { resolved: value === undefined ? undefined : codePoint(value) }
        } else decoded = undefined
      }
    } else {
      const name = end
      while (end < text.length && (isAsciiAlphanumeric(text.charCodeAt(end)) || text.charCodeAt(end) === 0x5f)) end += 1
      decoded = end > name ? { resolved: lookup(text.slice(name, end)) } : undefined
    }

    if (decoded !== undefined && text.charCodeAt(end) === 0x3b) {
      if (decoded.resolved !== undefined) {
        out += text.slice(last, start)
        out += decoded.resolved
        last = end + 1
      }
      at = end + 1
    } else at = start + 1
  }

  out += text.slice(last)
  return out
}

/** `u64::MAX` as a double, where the saturating folds stop. */
const U64_MAX = 18446744073709551615

// Saturates, so an overlong number is rejected as out of range, as `Number()` gives a huge value.
function parseDecimal(digits: string): number | undefined {
  if (digits === '') return undefined
  for (let i = 0; i < digits.length; i++) if (!isAsciiDigit(digits.charCodeAt(i))) return undefined
  let n = 0
  for (let i = 0; i < digits.length; i++) n = Math.min(n * 10 + (digits.charCodeAt(i) - 48), U64_MAX)
  return n
}

function parseHex(digits: string): number {
  let n = 0
  for (let i = 0; i < digits.length; i++) {
    const b = digits.charCodeAt(i)
    const d = b >= 48 && b <= 57 ? b - 48 : b >= 97 && b <= 102 ? b - 97 + 10 : b - 65 + 10
    n = Math.min(n * 16 + d, U64_MAX)
  }
  return n
}
