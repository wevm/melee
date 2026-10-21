/**
 * @module Sanitizes click targets as Mermaid does, and keeps links and images to the schemes a host
 * allows. Port of Pele's `src/util/url.ts`.
 *
 * Rust runs the sanitizing loop over `Vec<u16>`; here a JavaScript string is that same sequence of
 * UTF-16 units, lone surrogates included.
 */
import * as entities from '../text/entities.ts'
import { isLineEnd, isSpace, isWord } from './chars.ts'
import { pushU32 } from '../error.ts'
import { parse } from './float.ts'
import { type Buf, asciiLower, codePoints, eqIgnoreAsciiCase, rsplitOnce, splitOnce, startsWithIgnoreAsciiCase } from './rust.ts'

const BLANK = 'about:blank'

/**
 * `String.prototype.charCodeAt`, called as `charCodeAt.call(text, i)`, which stays a direct read
 * whatever internal kind of string arrives. It stays unexported, as `text/measure.ts` explains.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** A link in a drawing, as Pele's `LinkInfo` reports it. */
export type LinkInfo = {
  /** The sanitized target. */
  href: string
  /** The element the link wraps. */
  id: string
  /** Whether the link points inside the document. */
  internal: boolean
}

/** The render options the link and image helpers read. */
export type UrlOptions = {
  /** Schemes an image may use. `undefined` allows `http` and `https`. */
  imageSchemes?: readonly string[] | undefined
  /** `false` leaves every image out. */
  images?: boolean | undefined
  /** The `rel` of each link. `undefined` writes `noopener`, and an empty value writes none. */
  linkRel?: string | undefined
  /** Schemes a link may use. `undefined` allows `http`, `https`, `mailto`, and `tel`. */
  linkSchemes?: readonly string[] | undefined
  /** `false` leaves every link out. */
  links?: boolean | undefined
}

/** `UrlOptions::default()`. */
export function urlOptionsDefault(): UrlOptions {
  return {
    imageSchemes: undefined,
    images: undefined,
    linkRel: undefined,
    linkSchemes: undefined,
    links: undefined,
  }
}

/** `u32::MAX`, past which Rust's checked and saturating `u32` arithmetic stops. */
const U32_MAX = 4294967295
/** `u64::MAX` as a double, where saturating `u64` arithmetic stops. */
const U64_MAX = 18446744073709551615

const utf8Encoder = new TextEncoder()
/** `String::from_utf8_lossy`: replaces maximal invalid subparts, as WHATWG decoding does, and keeps a BOM. */
const utf8Lossy = new TextDecoder('utf-8', { ignoreBOM: true })

function space(c: number): boolean {
  return isSpace(c)
}

/** Whether a UTF-16 unit (NaN past the end) is the ASCII character `ascii`. */
function unitIs(unit: number, ascii: number): boolean {
  return unit === ascii
}

function unitWord(unit: number): boolean {
  return !Number.isNaN(unit) && isWord(unit)
}

/** The value of an ASCII hexadecimal digit, or `undefined`. */
function hexValue(u: number): number | undefined {
  if (u >= 48 && u <= 57) return u - 48
  if (u >= 97 && u <= 102) return u - 97 + 10
  if (u >= 65 && u <= 70) return u - 65 + 10
  return undefined
}

function unitHex(unit: number): number | undefined {
  if (!(unit >= 0 && unit <= 0xff)) return undefined
  return hexValue(unit)
}

// /[\u0000-\u001F\u007F-\u009F -‍﻿]/
function isCtrl(u: number): boolean {
  return u <= 0x1f || (u >= 0x7f && u <= 0x9f) || (u >= 0x2000 && u <= 0x200d) || u === 0xfeff
}

/** `u8::to_ascii_lowercase`. */
function lowerByte(b: number): number {
  return b >= 65 && b <= 90 ? b + 32 : b
}

// Whether `units` at `at` start with `ascii`, ignoring ASCII case.
function startsIgnoreCase(units: string, at: number, ascii: string): boolean {
  for (let i = 0; i < ascii.length; i++) {
    const u = units.charCodeAt(at + i)
    if (!(u >= 0 && u <= 0xff)) return false
    if (lowerByte(u) !== lowerByte(ascii.charCodeAt(i))) return false
  }
  return true
}

/** The number of leading one bits of a byte. */
function leadingOnes(byte: number): number {
  return Math.clz32(~byte & 0xff) - 24
}

/** `std::str::from_utf8` of one complete sequence whose continuation bytes are already checked. */
function fromUtf8(octets: number[]): string | undefined {
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = octets
  let code: number
  switch (octets.length) {
    case 2:
      code = ((b0 & 0x1f) << 6) | (b1 & 0x3f)
      if (code < 0x80) return undefined
      break
    case 3:
      code = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f)
      if (code < 0x800 || (code >= 0xd800 && code <= 0xdfff)) return undefined
      break
    case 4:
      code = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
      if (code < 0x10000 || code > 0x10ffff) return undefined
      break
    default:
      return undefined
  }
  return String.fromCodePoint(code)
}

// `decodeURIComponent`, or `undefined` where it throws a URIError.
function decodeUri(units: string): string | undefined {
  const byteAt = (at: number): number | undefined => {
    if (!unitIs(units.charCodeAt(at), 0x25)) return undefined
    const high = unitHex(units.charCodeAt(at + 1))
    if (high === undefined) return undefined
    const low = unitHex(units.charCodeAt(at + 2))
    if (low === undefined) return undefined
    return high * 16 + low
  }

  let out = ''
  let k = 0
  while (k < units.length) {
    const unit = units.charCodeAt(k)
    if (unit !== 0x25) {
      out += units[k]
      k += 1
      continue
    }
    const first = byteAt(k)
    if (first === undefined) return undefined
    k += 3
    if (first < 0x80) {
      out += String.fromCharCode(first)
      continue
    }

    const n = leadingOnes(first)
    if (n === 1 || n > 4) return undefined
    const octets = [first, 0, 0, 0]
    for (let slot = 1; slot < n; slot++) {
      const next = byteAt(k)
      if (next === undefined) return undefined
      if ((next & 0xc0) !== 0x80) return undefined
      octets[slot] = next
      k += 3
    }
    const text = fromUtf8(octets.slice(0, n))
    if (text === undefined) return undefined
    out += text
  }
  return out
}

function decode(units: string): string {
  // Without a `%`, decoding copies the units.
  if (units.indexOf('%') < 0) return units
  return decodeUri(units) ?? units
}

/** Whether `units` has a unit `RE_CTRL` matches. */
function hasCtrl(units: string): boolean {
  const n = units.length
  for (let i = 0; i < n; i++) if (isCtrl(charCodeAt.call(units, i))) return true
  return false
}

// `.replace(RE_CTRL, '')`.
function removeCtrl(units: string): string {
  if (!hasCtrl(units)) return units
  let out = ''
  for (let i = 0; i < units.length; i++) if (!isCtrl(units.charCodeAt(i))) out += units[i]
  return out
}

/** Whether `/&#(\w+)/` matches in `units`. */
function hasEntity(units: string): boolean {
  for (let at = units.indexOf('&#'); at >= 0; at = units.indexOf('&#', at + 1)) {
    if (at + 2 < units.length && isWord(charCodeAt.call(units, at + 2))) return true
  }
  return false
}

// `.replace(/&#(\w+)(^\w|;)?/g, (_m, dec) => String.fromCharCode(dec))`. `^\w` cannot match
// after `&#`, so the group is an optional semicolon.
function replaceEntities(units: string): string {
  // Scanning finds the first match wherever it is, so without one the units stay as they are.
  if (!hasEntity(units)) return units
  let out = ''
  let at = 0
  while (at < units.length) {
    const unit = units.charCodeAt(at)
    if (unitIs(unit, 0x26) && unitIs(units.charCodeAt(at + 1), 0x23)) {
      const start = at + 2
      let end = start
      while (unitWord(units.charCodeAt(end))) end += 1
      if (end > start) {
        // Word characters are ASCII, so the units are the text.
        const word = units.slice(start, end)
        out += String.fromCharCode(charCode(wordNumber(word)))
        at = unitIs(units.charCodeAt(end), 0x3b) ? end + 1 : end
        continue
      }
    }
    out += units[at]
    at += 1
  }
  return out
}

/** `char::is_digit(radix)` for the radixes JavaScript number literals use. */
function digitValue(c: number, radix: number): number | undefined {
  const value = hexValue(c)
  return value !== undefined && value < radix ? value : undefined
}

// JavaScript's `Number` of a `\w+` string.
function wordNumber(word: string): number {
  const prefix = word.length >= 2 ? asciiLower(word.slice(0, 2)) : undefined
  const radix = prefix === '0x' ? 16 : prefix === '0o' ? 8 : prefix === '0b' ? 2 : undefined
  if (radix !== undefined) {
    const digits = word.slice(2)
    if (digits === '') return Number.NaN
    for (let i = 0; i < digits.length; i++) if (digitValue(digits.charCodeAt(i), radix) === undefined) return Number.NaN
    // Past 2^53 the value only feeds `fromCharCode`, which keeps its low 16 bits.
    let acc = 0
    for (let i = 0; i < digits.length; i++) acc = acc * radix + (digitValue(digits.charCodeAt(i), radix) ?? 0)
    return acc
  }
  if (word === 'Infinity') return Number.POSITIVE_INFINITY

  let mantissa = 0
  while (mantissa < word.length && word.charCodeAt(mantissa) >= 48 && word.charCodeAt(mantissa) <= 57) mantissa++
  const rest = word.slice(mantissa)
  const exponent = (() => {
    const first = rest.charCodeAt(0)
    if (first !== 0x65 && first !== 0x45) return false
    const digits = rest.slice(1)
    return digits !== '' && /^[0-9]+$/.test(digits)
  })()
  if (mantissa > 0 && (rest === '' || exponent)) return parse(word) ?? Number.NaN
  return Number.NaN
}

// `String.fromCharCode`, which keeps the value modulo 2^16.
function charCode(value: number): number {
  if (!Number.isFinite(value)) return 0
  let wrapped = Math.trunc(value) % 65536
  wrapped = wrapped < 0 ? wrapped + 65536 : wrapped
  return wrapped
}

/** The length of `&newline;` or `&tab;` in any case at `at` of `units`, or 0. */
function ctrlEntityAt(units: string, at: number): number {
  if (startsIgnoreCase(units, at, '&newline;')) return 9
  if (startsIgnoreCase(units, at, '&tab;')) return 5
  return 0
}

/** Whether `/&(newline|tab);/i` matches in `units`. */
function hasCtrlEntity(units: string): boolean {
  for (let at = units.indexOf('&'); at >= 0; at = units.indexOf('&', at + 1)) {
    if (ctrlEntityAt(units, at) !== 0) return true
  }
  return false
}

// `.replace(/&(newline|tab);/gi, '')`.
function removeCtrlEntities(units: string): string {
  if (!hasCtrlEntity(units)) return units
  let out = ''
  let at = 0
  while (at < units.length) {
    const length = ctrlEntityAt(units, at)
    if (length !== 0) {
      at += length
      continue
    }
    out += units[at]
    at += 1
  }
  return out
}

/** The length of a whitespace escape at `at` of `units`, or `undefined`. */
function wsEscapeAt(units: string, at: number): number | undefined {
  let slash: number
  if (unitIs(units.charCodeAt(at), 0x5c)) slash = 1
  else if (startsIgnoreCase(units, at, '%5c')) slash = 3
  else return undefined
  const next = at + slash
  if (startsIgnoreCase(units, next, '%6e') || startsIgnoreCase(units, next, '%72') || startsIgnoreCase(units, next, '%74'))
    return slash + 3
  const b = units.charCodeAt(next)
  return b === 0x6e || b === 0x72 || b === 0x74 ? slash + 1 : undefined
}

/** Whether `/(\\|%5[cC])((%(6[eE]|72|74))|[nrt])/` matches in `units`. */
function hasWsEscape(units: string): boolean {
  const n = units.length
  for (let at = 0; at < n; at++) {
    const c = charCodeAt.call(units, at)
    if ((c === 0x5c || c === 0x25) && wsEscapeAt(units, at) !== undefined) return true
  }
  return false
}

// `.replace(/(\\|%5[cC])((%(6[eE]|72|74))|[nrt])/g, '')`.
function removeWsEscapes(units: string): string {
  if (!hasWsEscape(units)) return units
  let out = ''
  let at = 0
  while (at < units.length) {
    const length = wsEscapeAt(units, at)
    if (length !== undefined) {
      at += length
      continue
    }
    out += units[at]
    at += 1
  }
  return out
}

function trimUnits(units: string): string {
  let start = 0
  while (start < units.length && space(charCodeAt.call(units, start))) start++
  let end = units.length
  while (end > start && space(charCodeAt.call(units, end - 1))) end--
  return start === 0 && end === units.length ? units : units.slice(start, end)
}

/**
 * Follows the algorithm of `@braintree/sanitize-url`, which Mermaid applies to click targets.
 * A dangerous or malformed URL becomes `about:blank`.
 */
export function sanitizeUrl(url: string): string {
  if (url === '') return BLANK

  // The loop runs over UTF-16 units so entity codes can pair surrogates as JavaScript does.
  // Every `space` character is in the BMP, so trimming units trims characters.
  let decoded = decode(trimUnits(url))
  let rounds = 0
  for (;;) {
    // Each round peels one layer of encoding. A URL wrapped this many times is not a real one.
    rounds += 1
    if (rounds > 32) return BLANK
    let step = removeCtrl(decoded)
    step = replaceEntities(step)
    step = removeCtrlEntities(step)
    step = removeCtrl(step)
    step = removeWsEscapes(step)
    decoded = decode(trimUnits(step))

    const more = hasCtrl(decoded) || hasEntity(decoded) || hasCtrlEntity(decoded) || hasWsEscape(decoded)
    if (!more) break
  }

  // A lone surrogate becomes U+FFFD here, where JavaScript would keep it.
  const text = decoded.toWellFormed()
  if (text === '') return BLANK
  if (text.startsWith('.') || text.startsWith('/')) return text

  let from = 0
  while (from < text.length && space(text.charCodeAt(from))) from++
  const trimmed = text.slice(from)
  const found = scheme(trimmed)
  if (found === undefined) return text
  let lower = ''
  // `char::to_lowercase`, one character at a time, which for ASCII is ASCII lowercasing.
  if (isAscii(found)) lower = asciiLower(found)
  else for (const c of found) lower += c.toLowerCase()
  const protocol = trimUnits(lower)
  if (invalidProtocol(protocol)) return BLANK

  const normalized = trimmed.indexOf('\\') < 0 ? trimmed : trimmed.replaceAll('\\', '/')
  if (protocol === 'mailto:' || protocol.includes('://')) return normalized
  if (protocol === 'http:' || protocol === 'https:') return parseHttp(normalized) ?? BLANK
  return normalized
}

// The first match of `/^.+(:|&colon;)/gim`: on the first line that has one, the text up to its
// last colon or `&colon;` after the first character.
function scheme(text: string): string | undefined {
  let start = 0
  for (;;) {
    const rest = text.slice(start)
    // Line ends are in the BMP, one unit each.
    let length = rest.length
    let width = 0
    for (let i = 0; i < rest.length; i++) {
      if (isLineEnd(rest.charCodeAt(i))) {
        length = i
        width = 1
        break
      }
    }
    const line = rest.slice(0, length)

    let end: number | undefined
    // Skip the first character, which may be a surrogate pair. The low half of a later pair
    // starts neither `:` nor `&colon;`, so stepping over units finds the same positions.
    const first = line.length === 0 ? 0 : (line.codePointAt(0) as number) > 0xffff ? 2 : 1
    for (let p = first; p < line.length; p++) {
      if (line.charCodeAt(p) === 0x3a) end = p + 1
      else if (startsWithIgnoreAsciiCase(line, '&colon;', p)) end = p + 7
    }
    if (end !== undefined) return line.slice(0, end)
    if (width === 0) return undefined
    start += length + width
  }
}

// /^([^\w]*)(javascript|data|vbscript)/im
function invalidProtocol(protocol: string): boolean {
  let from = 0
  while (from < protocol.length && !isWord(protocol.charCodeAt(from))) from++
  const rest = protocol.slice(from)
  return ['javascript', 'data', 'vbscript'].some((name) => startsWithIgnoreAsciiCase(rest, name))
}

/** Whether every unit of `text` is ASCII. */
function isAscii(text: string): boolean {
  const n = text.length
  for (let i = 0; i < n; i++) if (charCodeAt.call(text, i) >= 0x80) return false
  return true
}

// Parses an `http:` or `https:` URL and serializes it as the WHATWG URL Standard does, for
// `new URL(url).toString()`.
function parseHttp(raw: string): string | undefined {
  let lo = 0
  let hi = raw.length
  while (lo < hi && raw.charCodeAt(lo) <= 0x20) lo++
  while (hi > lo && raw.charCodeAt(hi - 1) <= 0x20) hi--
  const trimmed = raw.slice(lo, hi)
  const input = hasTabOrLineBreak(trimmed) ? trimmed.replace(/[\t\n\r]/g, '') : trimmed
  const colon = input.indexOf(':')
  if (colon < 0) return undefined
  const schemeText = input.slice(0, colon)
  let schemeName: string
  let defaultPort: number
  if (eqIgnoreAsciiCase(schemeText, 'http')) {
    schemeName = 'http'
    defaultPort = 80
  } else if (eqIgnoreAsciiCase(schemeText, 'https')) {
    schemeName = 'https'
    defaultPort = 443
  } else return undefined

  let restStart = colon + 1
  while (restStart < input.length && (input.charCodeAt(restStart) === 0x2f || input.charCodeAt(restStart) === 0x5c))
    restStart++
  const rest = input.slice(restStart)
  const authorityEnd = authorityLength(rest)
  const authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd)
  const tail = authorityEnd < 0 ? '' : rest.slice(authorityEnd)
  const atSign = authority.lastIndexOf('@')
  const credentials = atSign >= 0 ? authority.slice(0, atSign) : undefined
  const hostPort = atSign >= 0 ? authority.slice(atSign + 1) : authority

  // Only a URL whose sole colon on its first line ends the scheme reaches this parser, so a
  // bracketed IPv6 host, which needs colons, is never valid here. Any other `[` is forbidden.
  if (hostPort.includes('[')) return undefined
  const portColon = hostPort.indexOf(':')
  const hostText = portColon >= 0 ? hostPort.slice(0, portColon) : hostPort
  const portText = portColon >= 0 ? hostPort.slice(portColon + 1) : undefined
  if (hostText === '') return undefined
  const host = parseHost(hostText)
  if (host === undefined) return undefined
  let port: number | undefined
  if (portText !== undefined && portText !== '') {
    if (!/^[0-9]+$/.test(portText)) return undefined
    let value = 0
    for (let i = 0; i < portText.length; i++) value = Math.min(value * 10 + (portText.charCodeAt(i) - 48), U32_MAX)
    if (value > 65535) return undefined
    port = value !== defaultPort ? value : undefined
  }

  const out: Buf = { s: schemeName }
  out.s += '://'
  if (credentials !== undefined) {
    const [user, password] = splitOnce(credentials, ':') ?? [credentials, '']
    if (user !== '' || password !== '') {
      encode(out, user, userinfoSet)
      if (password !== '') {
        out.s += ':'
        encode(out, password, userinfoSet)
      }
      out.s += '@'
    }
  }
  out.s += host
  if (port !== undefined) {
    out.s += ':'
    pushU32(out, port)
  }

  const [before, fragment] = splitOnce(tail, '#') ?? [tail, undefined]
  const [pathText, query] = splitOnce(before, '?') ?? [before, undefined]

  const segments: string[] = []
  const first = pathText.charCodeAt(0)
  const path = first === 0x2f || first === 0x5c ? pathText.slice(1) : pathText
  const raws = path.indexOf('\\') < 0 ? path.split('/') : path.split(/[/\\]/)
  const count = raws.length
  for (let i = 0; i < raws.length; i++) {
    const atEnd = i + 1 === count
    const buffer: Buf = { s: '' }
    encode(buffer, raws[i] as string, pathSet)
    if (isDoubleDot(buffer.s)) {
      segments.pop()
      if (atEnd) segments.push('')
    } else if (isSingleDot(buffer.s)) {
      if (atEnd) segments.push('')
    } else segments.push(buffer.s)
  }
  for (const segment of segments) {
    out.s += '/'
    out.s += segment
  }

  if (query !== undefined) {
    out.s += '?'
    encode(out, query, (b) => querySet(b) || b === 0x27)
  }
  if (fragment !== undefined) {
    out.s += '#'
    encode(out, fragment, fragmentSet)
  }
  return out.s
}

/** Whether `text` has a tab, `\n`, or `\r`. */
function hasTabOrLineBreak(text: string): boolean {
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = charCodeAt.call(text, i)
    if (c === 0x09 || c === 0x0a || c === 0x0d) return true
  }
  return false
}

/** `text.search(/[/\\?#]/)`. */
function authorityLength(text: string): number {
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = charCodeAt.call(text, i)
    if (c === 0x2f || c === 0x5c || c === 0x3f || c === 0x23) return i
  }
  return -1
}

function isSingleDot(segment: string): boolean {
  return segment === '.' || eqIgnoreAsciiCase(segment, '%2e')
}

function isDoubleDot(segment: string): boolean {
  return ['..', '.%2e', '%2e.', '%2e%2e'].some((dots) => eqIgnoreAsciiCase(segment, dots))
}

function c0ControlSet(b: number): boolean {
  return !(b >= 0x20 && b <= 0x7e)
}

function fragmentSet(b: number): boolean {
  return c0ControlSet(b) || b === 0x20 || b === 0x22 || b === 0x3c || b === 0x3e || b === 0x60
}

function querySet(b: number): boolean {
  return c0ControlSet(b) || b === 0x20 || b === 0x22 || b === 0x23 || b === 0x3c || b === 0x3e
}

function pathSet(b: number): boolean {
  return querySet(b) || b === 0x3f || b === 0x5e || b === 0x60 || b === 0x7b || b === 0x7d
}

function userinfoSet(b: number): boolean {
  return (
    pathSet(b) ||
    b === 0x2f ||
    b === 0x3a ||
    b === 0x3b ||
    b === 0x3d ||
    b === 0x40 ||
    (b >= 0x5b && b <= 0x5e) ||
    b === 0x7c
  )
}

function encode(out: Buf, text: string, set: (b: number) => boolean): void {
  const HEX = '0123456789ABCDEF'
  if (isAscii(text)) {
    // ASCII text is its own UTF-8.
    let s = out.s
    let from = 0
    const n = text.length
    for (let i = 0; i < n; i++) {
      const b = charCodeAt.call(text, i)
      if (set(b)) {
        s += text.slice(from, i)
        s += '%'
        s += HEX[b >> 4]
        s += HEX[b & 15]
        from = i + 1
      }
    }
    out.s = s + text.slice(from)
    return
  }
  for (const b of utf8Encoder.encode(text)) {
    if (set(b)) {
      out.s += '%'
      out.s += HEX[b >> 4]
      out.s += HEX[b & 15]
    } else {
      // Every set encodes bytes above 0x7e, so what is left is ASCII.
      out.s += String.fromCharCode(b)
    }
  }
}

function parseHost(input: string): string | undefined {
  // ASCII without a `%` decodes to itself.
  if (input.indexOf('%') < 0 && isAscii(input)) return hostOf(input)
  const bytes: number[] = []
  const raw = utf8Encoder.encode(input)
  let at = 0
  while (at < raw.length) {
    const b = raw[at] as number
    const high = unitHex(raw[at + 1] ?? Number.NaN)
    const low = unitHex(raw[at + 2] ?? Number.NaN)
    if (b === 0x25 && high !== undefined && low !== undefined) {
      bytes.push(high * 16 + low)
      at += 3
    } else {
      bytes.push(b)
      at += 1
    }
  }

  return hostOf(utf8Lossy.decode(Uint8Array.from(bytes)))
}

/** The host for a percent-decoded `domain`. */
function hostOf(domain: string): string | undefined {
  const ascii = domainToAscii(domain)
  if (ascii === undefined) return undefined
  for (let i = 0; i < ascii.length; i++) if (forbiddenDomain(ascii.charCodeAt(i))) return undefined
  if (endsInNumber(ascii)) return ipv4(ascii)
  return ascii
}

// ponytail: lowercases, Punycode-encodes, and checks `xn--` labels decode, without UTS 46 mapping,
// normalization, or validity tables. Add the tables if hosts beyond plain letters matter.
function domainToAscii(domain: string): string | undefined {
  // An ASCII domain needs only lowercasing, which `char::to_lowercase` does for ASCII as well.
  if (isAscii(domain)) return asciiDomain(asciiLower(domain))

  // UTS 46 maps non-ASCII spaces to a forbidden space and disallows line separators.
  for (const c of domain) {
    const code = c.codePointAt(0) as number
    if (code >= 0x80 && space(code)) return undefined
  }

  let mapped = ''
  for (const c of domain) {
    // `char::to_lowercase`, one character at a time.
    for (const l of c.toLowerCase()) mapped += l === '\u{3002}' || l === '\u{ff0e}' || l === '\u{ff61}' ? '.' : l
  }

  return asciiDomain(mapped)
}

/** The labels of lowercased, mapped `mapped` as ASCII, or `undefined` for an invalid label. */
function asciiDomain(mapped: string): string | undefined {
  const out: Buf = { s: '' }
  const labels = mapped.split('.')
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] as string
    if (i > 0) out.s += '.'
    const encoded = label.startsWith('xn--')
    if (encoded && (!isAscii(label) || !punycodeLabel(label.slice(4)))) return undefined
    if (isAscii(label)) out.s += label
    else {
      out.s += 'xn--'
      if (!punycode(label, out)) return undefined
    }
  }
  return out.s !== '' ? out.s : undefined
}

function forbiddenDomain(c: number): boolean {
  return (
    c <= 0x1f ||
    c === 0x7f ||
    c === 0x20 ||
    c === 0x23 ||
    c === 0x25 ||
    c === 0x2f ||
    c === 0x3a ||
    c === 0x3c ||
    c === 0x3e ||
    c === 0x3f ||
    c === 0x40 ||
    c === 0x5b ||
    c === 0x5c ||
    c === 0x5d ||
    c === 0x5e ||
    c === 0x7c
  )
}

// Encodes a label with RFC 3492 Punycode.
const BASE = 36

// Punycode's bias adaptation (RFC 3492, section 6.1).
function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / 700) : Math.floor(delta / 2)
  d += Math.floor(d / points)
  let k = 0
  while (d > Math.floor(((BASE - 1) * 26) / 2)) {
    d = Math.floor(d / (BASE - 1))
    k += BASE
  }
  return k + Math.floor((BASE * d) / (d + 38))
}

function threshold(step: number, bias: number): number {
  if (step <= bias) return 1
  else if (step >= bias + 26) return 26
  else return step - bias
}

// Whether the part of an `xn--` label after the prefix decodes to a label that is not plain ASCII.
// Code points below U+00A0 stand in for the UTS 46 validity tables.
function punycodeLabel(encoded: string): boolean {
  const [basic, deltas] = rsplitOnce(encoded, '-') ?? ['', encoded]
  const output = codePoints(basic)
  let code = 0x80
  let bias = 72
  let i = 0
  // `deltas` is ASCII: the caller checked the label.
  let next = 0
  let pending = deltas.length > 0
  while (pending) {
    const old = i
    let weight = 1
    let step = BASE
    for (;;) {
      if (next >= deltas.length) return false
      const b = deltas.charCodeAt(next++)
      let digit: number
      if (b >= 97 && b <= 122) digit = b - 97
      else if (b >= 65 && b <= 90) digit = b - 65
      else if (b >= 48 && b <= 57) digit = b - 48 + 26
      else return false
      const add = digit * weight
      if (add > U32_MAX || i + add > U32_MAX) return false
      i += add
      const t = threshold(step, bias)
      if (digit < t) break
      const nextWeight = weight * (BASE - t)
      if (nextWeight > U32_MAX) return false
      weight = nextWeight
      step += BASE
    }
    const points = output.length + 1
    bias = adapt(i - old, points, old === 0)
    const nextCode = code + Math.floor(i / points)
    if (nextCode > U32_MAX) return false
    code = nextCode
    i %= points
    // `char::from_u32`.
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return false
    output.splice(i, 0, code)
    i += 1
    pending = next < deltas.length
  }
  return output.some((c) => c >= 0x80) && output.every((c) => !(c >= 0x80 && c < 0xa0))
}

function punycode(label: string, out: Buf): boolean {
  // Digits 0 to 25 are `a` to `z`, and 26 to 35 are `0` to `9`.
  const digit = (d: number): string => (d < 26 ? String.fromCharCode(0x61 + d) : String.fromCharCode(0x30 + d - 26))

  const input = codePoints(label)
  const length = input.length
  const basic = input.filter((c) => c < 0x80).length
  for (const c of input) if (c < 0x80) out.s += String.fromCodePoint(c)
  if (basic > 0) out.s += '-'

  let code = 0x80
  let delta = 0
  let bias = 72
  let handled = basic
  while (handled < length) {
    let next: number | undefined
    for (const c of input) if (c >= code && (next === undefined || c < next)) next = c
    if (next === undefined) return false
    const add = (next - code) * (handled + 1)
    if (add > U32_MAX || delta + add > U32_MAX) return false
    delta += add
    code = next
    for (const c of input) {
      if (c < code) {
        if (delta + 1 > U32_MAX) return false
        delta += 1
      }
      if (c === code) {
        let rest = delta
        let step = BASE
        for (;;) {
          const t = threshold(step, bias)
          if (rest < t) break
          out.s += digit(t + ((rest - t) % (BASE - t)))
          rest = Math.floor((rest - t) / (BASE - t))
          step += BASE
        }
        out.s += digit(rest)
        bias = adapt(delta, handled + 1, handled === basic)
        delta = 0
        handled += 1
      }
    }
    if (delta + 1 > U32_MAX) return false
    delta += 1
    code += 1
  }
  return true
}

function ipv4Number(text: string): number | undefined {
  if (text === '') return undefined
  let base: number
  let digits: string
  const head = text.slice(0, 2)
  if (head === '0x' || head === '0X') {
    base = 16
    digits = text.slice(2)
  } else if (text.length >= 2 && text.startsWith('0')) {
    base = 8
    digits = text.slice(1)
  } else {
    base = 10
    digits = text
  }
  let acc = 0
  for (const c of digits) {
    // `char::to_digit` reads only ASCII digits and letters.
    const value = c.length === 1 ? digitValue(c.charCodeAt(0), base) : undefined
    if (value === undefined) return undefined
    // Saturates as `u64` does; every value past 2^32 is refused alike.
    acc = Math.min(acc * base + value, U64_MAX)
  }
  return acc
}

function endsInNumber(domain: string): boolean {
  const labels = domain.split('.')
  if (labels[labels.length - 1] === '') {
    if (labels.length === 1) return false
    labels.pop()
  }
  const last = labels[labels.length - 1] ?? ''
  return (last !== '' && /^[0-9]+$/.test(last)) || ipv4Number(last) !== undefined
}

function ipv4(domain: string): string | undefined {
  const parts = domain.split('.')
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  if (parts.length > 4) return undefined
  const numbers: number[] = []
  for (const part of parts) {
    const n = ipv4Number(part)
    if (n === undefined) return undefined
    numbers.push(n)
  }
  const last = numbers[numbers.length - 1]
  if (last === undefined) return undefined
  const init = numbers.slice(0, -1)
  if (init.some((n) => n > 255)) return undefined
  const width = 5 - numbers.length
  if (last >= 256 ** width) return undefined

  let address = last
  for (let i = 0; i < init.length; i++) address += (init[i] as number) * 256 ** (3 - i)
  const out: Buf = { s: '' }
  for (const shift of [24, 16, 8, 0]) {
    if (shift !== 24) out.s += '.'
    pushU32(out, Math.floor(address / 2 ** shift) % 256)
  }
  return out.s
}

/** A URL as written in a diagram: entity codes are read first, so they cannot hide a scheme. */
export function safeUrl(url: string): string {
  return sanitizeUrl(entities.decode(url))
}

const LINK_SCHEMES: readonly string[] = ['http', 'https', 'mailto', 'tel']
const IMAGE_SCHEMES: readonly string[] = ['http', 'https']

// Stricter than Mermaid, which lets any scheme but three through: a diagram in a shared note
// could otherwise open a local file, a network share, or another application.
function allow(url: string, schemes: readonly string[]): string | undefined {
  const b0 = url.charCodeAt(0)
  const b1 = url.charCodeAt(1)
  if ((b0 === 0x2f || b0 === 0x5c) && (b1 === 0x2f || b1 === 0x5c)) return undefined

  const isAlpha = (b: number) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122)
  let nameLength = 0
  if (isAlpha(b0)) {
    nameLength = 1
    for (;;) {
      const b = url.charCodeAt(nameLength)
      if (!(isAlpha(b) || (b >= 48 && b <= 57) || b === 0x2b || b === 0x2e || b === 0x2d)) break
      nameLength++
    }
  }
  if (nameLength === 0 || url.charCodeAt(nameLength) !== 0x3a) return url
  const name = asciiLower(url.slice(0, nameLength))
  return schemes.some((scheme) => scheme === name) ? url : undefined
}

/**
 * Keeps a URL that `sanitizeUrl` has passed when it is relative or its scheme is one the host
 * allows for links. A refused link is left out of the drawing: written as `about:blank`, it
 * would still navigate the page when clicked.
 */
export function linkUrl(url: string, options: UrlOptions): string | undefined {
  if (options.links === false) return undefined
  return allow(url, options.linkSchemes ?? LINK_SCHEMES)
}

/**
 * Keeps a URL that `sanitizeUrl` has passed when it is relative or its scheme is one the host
 * allows for images.
 */
export function imageUrl(url: string, options: UrlOptions): string | undefined {
  if (options.images === false) return undefined
  return allow(url, options.imageSchemes ?? IMAGE_SCHEMES)
}

/**
 * Wraps `body` in a link to `url` and records it in `links`, or returns `body` alone when the
 * link is refused. `attrs` is written into the `<a>` tag as is.
 */
export function linked(
  body: string,
  url: string,
  id: string,
  links: LinkInfo[],
  options: UrlOptions,
  attrs: string,
): string {
  const href = linkUrl(url, options)
  if (href === undefined) return body
  links.push({ href, id, internal: false })

  const out: Buf = { s: '<a href="' }
  pushEscaped(out, href)
  out.s += '"'
  out.s += attrs
  out.s += relAttr(options)
  out.s += '>'
  out.s += body
  out.s += '</a>'
  return out.s
}

/** The ` rel="..."` attribute for links, or nothing when the host sets an empty `rel`. */
export function relAttr(options: UrlOptions): string {
  const rel = options.linkRel ?? 'noopener'
  if (rel === '') return ''
  const out: Buf = { s: ' rel="' }
  pushEscaped(out, rel)
  out.s += '"'
  return out.s
}

// Pele's `esc`: escapes XML text and drops the control characters XML does not allow. Kept here
// until `svg::builder` is ported.
function pushEscaped(out: Buf, text: string): void {
  // Every character it changes is ASCII, so stepping over UTF-16 units is stepping over characters.
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x26) out.s += '&amp;'
    else if (c === 0x3c) out.s += '&lt;'
    else if (c === 0x3e) out.s += '&gt;'
    else if (c === 0x22) out.s += '&quot;'
    else if (c <= 0x08 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || c === 0x7f) {
      // Dropped.
    } else out.s += text[i]
  }
}
