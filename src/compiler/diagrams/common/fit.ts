/** @module Plain labels, and labels cut to fit a box. Port of Pele's `src/diagrams/common/fit.ts`. */
import { type Label, layoutLabel, trim } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { eqIgnoreAsciiCase } from '../../util/rust.ts'

/**
 * Lays out text the way Mermaid's journey and timeline draw it: as plain text in which only
 * `<br>` is markup, so other tags and icon names show as written instead of being read as
 * formatting.
 */
export function plainLabel(raw: string | undefined, size: number, max: number, base: number): Label {
  let text: string | undefined
  if (raw !== undefined) {
    text = raw.includes('<') ? escapeTags(raw) : raw
    if (text.includes(':fa-')) text = text.split(':fa-').join('&colon;fa-')
  }
  // Icon names are escaped above, so no host icon can be drawn.
  return layoutLabel(text, false, size, max, base, undefined)
}

/** `text.replace(/<(?!br\s*\/?>)/gi, '&lt;')`. */
function escapeTags(text: string): string {
  let out = ''
  for (let at = 0; at < text.length; at++) {
    const c = text.charCodeAt(at)
    if (c === 0x3c && lineBreakLen(text, at) === undefined) out += '&lt;'
    else out += text[at] as string
  }
  return out
}

/** The length of `<br\s*\/?>` at `at`, with `br` in either case. */
function lineBreakLen(text: string, at: number): number | undefined {
  if (at > text.length) return undefined
  const rest = text.slice(at)
  if (!rest.startsWith('<')) return undefined
  if (rest.length < 3) return undefined
  if (!eqIgnoreAsciiCase(rest.slice(1, 3), 'br')) return undefined
  let end = 3
  for (;;) {
    if (end >= rest.length) break
    const c = rest.codePointAt(end) as number
    if (!isSpace(c)) break
    end += c > 0xffff ? 2 : 1
  }
  if (rest.charCodeAt(end) === 0x2f) end += 1
  return rest.charCodeAt(end) === 0x3e ? end + 1 : undefined
}

/** Whether a UTF-16 unit is an ASCII letter, digit, or `_`. */
function isWordUnit(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
}

/**
 * The length of the piece at `at` that a word can be cut before or after: a line break, an
 * encoded entity, or one character. Mirrors Pele's `RE_UNIT`.
 */
function unitLen(text: string, at: number): number {
  const rest = at <= text.length ? text.slice(at) : ''
  const len = lineBreakLen(text, at)
  if (len !== undefined) return len

  // `ﬂ°°?\w+¶ß`, the form `encodeEntities` gives an entity.
  if (rest.startsWith('\u{fb02}°')) {
    let tail = rest.slice(2)
    if (tail.startsWith('°')) tail = tail.slice(1)
    let word = 0
    while (word < tail.length && isWordUnit(tail.charCodeAt(word))) word++
    if (word > 0 && tail.startsWith('¶ß', word)) {
      return rest.length - tail.length + word + '¶ß'.length
    }
  }

  // `&#?\w+;`
  if (rest.startsWith('&')) {
    let tail = rest.slice(1)
    if (tail.startsWith('#')) tail = tail.slice(1)
    let word = 0
    while (word < tail.length && isWordUnit(tail.charCodeAt(word))) word++
    if (word > 0 && tail.charCodeAt(word) === 0x3b) {
      return rest.length - tail.length + word + 1
    }
  }

  if (rest.length === 0) return 1
  return (rest.codePointAt(0) as number) > 0xffff ? 2 : 1
}

/** {@link plainLabel}, and for a box of fixed width, also cuts any word too long to fit `max`. */
export function fitLabel(raw: string | undefined, size: number, max: number, base: number): Label {
  const label = plainLabel(raw, size, max, base)
  if (raw === undefined) return label
  if (label.width <= max) return label

  let out = ''
  let width = 0
  let at = 0
  while (at < raw.length) {
    const len = unitLen(raw, at)
    const unit = raw.slice(at, at + len)
    at += len

    // Pele measures a piece longer than two UTF-16 units as one `x`.
    const long = unit.length > 2
    if (trim(unit) === '' || (long && unit.startsWith('<'))) {
      width = 0
    } else {
      const w = measure.width(long ? 'x' : unit, size, base)
      if (width > 0 && width + w > max) {
        out += '\n'
        width = 0
      }
      width += w
    }
    out += unit
  }
  return plainLabel(out, size, max, base)
}
