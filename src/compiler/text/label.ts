/**
 * @module Lays out label text in lines of styled spans: inline HTML emphasis, markdown emphasis,
 * line breaks, Font Awesome icons, and wrapping. Port of Pele's `src/text/label.ts`.
 */
import { jsRound } from '../svg/builder.ts'
import { has, isSpace, isWord } from '../util/chars.ts'
import { eqIgnoreAsciiCase } from '../util/rust.ts'
import { decode } from './entities.ts'
import { type IconResolver, iconMarkup } from './icons.ts'
import * as measure from './measure.ts'
import { BOLD, ITALIC } from './measure.ts'

/** `String.prototype.charCodeAt`, for hot loops over text, as `text/measure.ts` explains. */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** A run of text in one style, or an icon. */
export type Span = {
  /** The icon's name, such as `fa:fa-car`, when the span is an icon. */
  icon: string | undefined
  /** Emphasis bits from {@link measure}. */
  style: number
  /** The text, with entities decoded. Empty for an icon. */
  text: string
  /** The measured width. */
  width: number
}

/** `Span::default()`. */
export function spanDefault(): Span {
  return { icon: undefined, style: 0, text: '', width: 0 }
}

/** A label laid out in lines. */
export type Label = {
  /** Total height: the number of lines times the line height. */
  height: number
  /** Height of one line. */
  lineHeight: number
  /** The spans of each line. */
  lines: Span[][]
  /** Font size. */
  size: number
  /** Width of the widest line. */
  width: number
  /** Width of each line. */
  widths: number[]
}

/** `Label::default()`. */
export function labelDefault(): Label {
  return { height: 0, lineHeight: 0, lines: [], size: 0, width: 0, widths: [] }
}

/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.5

// JavaScript whitespace is all in the Basic Multilingual Plane, so testing UTF-16 units matches
// testing scalar values: a surrogate is never whitespace.

/** `text` without JavaScript whitespace at either end, as `String.prototype.trim` leaves it. */
export function trim(text: string): string {
  return trimEnd(trimStart(text))
}

/** `text` without JavaScript whitespace at its start. */
export function trimStart(text: string): string {
  const n = text.length
  let start = 0
  while (start < n && isSpace(charCodeAt.call(text, start))) start++
  return start === 0 ? text : text.slice(start)
}

/** `text` without JavaScript whitespace at its end. */
export function trimEnd(text: string): string {
  const n = text.length
  let end = n
  while (end > 0 && isSpace(charCodeAt.call(text, end - 1))) end--
  return end === n ? text : text.slice(0, end)
}

/** The number of whitespace characters a line starts with. */
function indent(line: string): number {
  const n = line.length
  let count = 0
  while (count < n && isSpace(charCodeAt.call(line, count))) count++
  return count
}

/** Removes the indentation that every non-blank line shares. */
function dedent(text: string): string {
  let min = Number.MAX_SAFE_INTEGER
  for (const line of text.split('\n')) {
    if (trim(line) === '') continue
    min = Math.min(min, indent(line))
  }
  if (min === Number.MAX_SAFE_INTEGER || min === 0) return text

  let out = ''
  const parts = text.split('\n')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i] as string
    if (i > 0) out += '\n'
    // Indentation is whitespace, which is one UTF-16 unit per character, as Pele counts it.
    const skip = Math.min(min, indent(line))
    out += line.slice(skip)
  }
  return out
}

/** Adds text to a line, joining the last span when it has the same style. */
function pushText(line: Span[], text: string, style: number): void {
  if (text === '') return

  const decoded = decode(text)
  const last = line[line.length - 1]
  if (last !== undefined && last.style === style && last.icon === undefined) {
    last.text += decoded
  } else {
    line.push({ icon: undefined, style, text: decoded, width: 0 })
  }
}

/**
 * Whether `text` at offset `at` starts with Pele's `fa[bklrs]?:fa-`, and the length of that
 * prefix.
 */
function iconPrefix(text: string, at: number): number | undefined {
  if (charCodeAt.call(text, at) !== 0x66 || charCodeAt.call(text, at + 1) !== 0x61) return undefined
  const c = charCodeAt.call(text, at + 2)
  // `b`, `k`, `l`, `r`, `s`.
  if ((c === 0x62 || c === 0x6b || c === 0x6c || c === 0x72 || c === 0x73) && iconColon(text, at + 3)) return 7
  return iconColon(text, at + 2) ? 6 : undefined
}

/** Whether `text` at offset `at` starts with `:fa-`. Past the end, `charCodeAt` is `NaN`. */
function iconColon(text: string, at: number): boolean {
  return (
    charCodeAt.call(text, at) === 0x3a &&
    charCodeAt.call(text, at + 1) === 0x66 &&
    charCodeAt.call(text, at + 2) === 0x61 &&
    charCodeAt.call(text, at + 3) === 0x2d
  )
}

/** An ASCII letter, digit, `_`, or `-`. */
function isNameChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 0x5f || c === 0x2d
}

/** The next match of Pele's `/(fa[bklrs]?):fa-([\w-]+)/g` at or after `from`, as offsets. */
function findIcon(text: string, from: number): [number, number] | undefined {
  let at = from
  while (at < text.length) {
    const prefix = iconPrefix(text, at)
    if (prefix !== undefined) {
      let name = 0
      while (at + prefix + name < text.length && isNameChar(text.charCodeAt(at + prefix + name))) name++
      if (name > 0) return [at, at + prefix + name]
      // Without the optional letter the prefix needs `:` where the letter is, so no shorter
      // match starts here.
    }
    at += 1
  }
  return undefined
}

/** Adds text to a line, turning `fa:fa-name` references the host has icons for into icon spans. */
function pushIcons(line: Span[], text: string, style: number, icons: IconResolver | undefined): void {
  if (!has(text, ':fa-')) {
    pushText(line, text, style)
    return
  }

  let last = 0
  let from = 0
  for (let found = findIcon(text, from); found !== undefined; found = findIcon(text, from)) {
    const [start, end] = found
    const icon = text.slice(start, end)
    pushText(line, text.slice(last, start), style)
    last = end
    from = end
    if (iconMarkup(icons, icon) !== '') {
      line.push({ icon, style, text: '', width: 0 })
    } else if (text.charCodeAt(last) === 0x20) {
      // An icon the host does not have leaves no gap, nor the space that set it off from
      // the text.
      last += 1
    } else if (last === text.length) {
      const before = line[line.length - 1]
      if (before !== undefined && before.icon === undefined) {
        before.text = trimEnd(before.text)
      }
    }
  }
  pushText(line, text.slice(last), style)
}

/**
 * Matches Pele's sticky `/<\/?([a-zA-Z][\w-]*)(?:\s[^<>]*)?\/?>/y` at the start of `rest`, and
 * returns the length of the tag and its name.
 */
function matchTag(rest: string): [number, string] | undefined {
  if (rest.charCodeAt(0) !== 0x3c) return undefined

  const start = rest.charCodeAt(1) === 0x2f ? 2 : 1
  if (start >= rest.length) return undefined
  const first = rest.charCodeAt(start)
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return undefined
  let end = start + 1
  while (end < rest.length && isNameChar(rest.charCodeAt(end))) end += 1
  const name = rest.slice(start, end)

  const after = rest.slice(end)
  if (after.length > 0 && isSpace(after.codePointAt(0) as number)) {
    // Attributes run to the first `<` or `>`, and only a `>` closes the tag.
    const close = after.search(/[<>]/)
    if (close < 0) return undefined
    return after.charCodeAt(close) === 0x3e ? [end + close + 1, name] : undefined
  }

  const close = rest.charCodeAt(end) === 0x2f ? end + 1 : end
  return rest.charCodeAt(close) === 0x3e ? [close + 1, name] : undefined
}

/** The scalar value ending at UTF-16 offset `at`, as `chars().next_back()` of `text[..at]` reads it. */
function charBefore(text: string, at: number): number | undefined {
  if (at <= 0) return undefined
  const low = text.charCodeAt(at - 1)
  if (low >= 0xdc00 && low <= 0xdfff && at >= 2) {
    const high = text.charCodeAt(at - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(at - 2)
  }
  return low
}

/** Splits inline HTML and, for markdown labels, emphasis markers into styled spans. */
function inline(line: Span[], source: string, markdown: boolean, base: number, icons: IconResolver | undefined): void {
  const n = source.length
  let style = base
  let marked = 0
  let text = ''
  // Characters from `run` to `i` belong to `text` but are not added yet, so a run of plain text
  // is added in one piece.
  let run = 0
  let i = 0
  while (i < n) {
    const code = source.codePointAt(i) as number
    if (code === 0x3c) {
      const tagged = matchTag(source.slice(i))
      if (tagged !== undefined) {
        text += source.slice(run, i)
        const [len, tag] = tagged
        const closing = source.charCodeAt(i + 1) === 0x2f
        const bit =
          eqIgnoreAsciiCase(tag, 'b') || eqIgnoreAsciiCase(tag, 'strong')
            ? BOLD
            : eqIgnoreAsciiCase(tag, 'i') || eqIgnoreAsciiCase(tag, 'em')
              ? ITALIC
              : 0
        if (bit !== 0) {
          pushIcons(line, text, style, icons)
          text = ''
          style = closing ? (style & ~bit) | (base & bit) : style | bit
        }
        i += len
        run = i
        continue
      }
    } else if (markdown && (code === 0x2a || code === 0x5f)) {
      const double = source.charCodeAt(i + 1) === code
      const bit = double ? BOLD : ITALIC
      const len = double ? 2 : 1
      const open = (marked & bit) === 0
      const prev = charBefore(source, i) ?? 0x20
      const next = i + len < n ? ((source.codePointAt(i + len) as number | undefined) ?? 0x20) : 0x20
      // The marker is one or two of the same character, so it reads the same from the source.
      const canOpen = open && !isSpace(next) && source.includes(source.slice(i, i + len), i + len)
      const canClose = !open && !isSpace(prev)
      const wordy = code === 0x5f && isWord(prev) && isWord(next)
      if ((canOpen || canClose) && !wordy) {
        text += source.slice(run, i)
        pushIcons(line, text, style, icons)
        text = ''
        marked = canOpen ? marked | bit : marked & ~bit
        style = canOpen ? style | bit : (style & ~bit) | (base & bit)
        i += len
        run = i
        continue
      }
    }
    i += code > 0xffff ? 2 : 1
  }
  text += source.slice(run, n)
  pushIcons(line, text, style, icons)
}

/** Measures each span of a line and returns the line's width. */
function measureSpans(line: Span[], size: number): number {
  let total = 0
  for (const span of line) {
    span.width = span.icon !== undefined ? size * 1.25 : measure.width(span.text, size, span.style)
    total += span.width
  }
  return total
}

/** The line being wrapped and its width, which Rust passes to [`commit`] as `&mut` references. */
type Wrapping = {
  current: Span[]
  width: number
}

/** Ends a wrapped line, trimming the space at its end. */
function commit(state: Wrapping, size: number, out: Span[][], widths: number[]): void {
  const last = state.current[state.current.length - 1]
  if (last !== undefined && last.icon === undefined) {
    const trimmed = trimEnd(last.text)
    if (trimmed.length !== last.text.length) {
      last.text = trimmed
      const w = measure.width(last.text, size, last.style)
      state.width += w - last.width
      last.width = w
    }
  }
  out.push(state.current)
  state.current = []
  widths.push(state.width)
  state.width = 0
}

/** The pieces Pele's `/\s*\S+\s*|\s+/g` matches: words with the whitespace around them. */
function pieces(text: string): string[] {
  const out: string[] = []
  let rest = text
  while (rest !== '') {
    const word = trimStart(rest)
    let end: number
    if (word === '') {
      end = rest.length
    } else {
      let skip = 0
      while (skip < word.length && !isSpace(word.charCodeAt(skip))) skip++
      const tail = word.slice(skip)
      end = rest.length - trimStart(tail).length
    }
    out.push(rest.slice(0, end))
    rest = rest.slice(end)
  }
  return out
}

/** Wraps a line at whitespace so each part fits in `max`, adding the parts to `out`. */
function wrap(line: Span[], size: number, max: number, out: Span[][], widths: number[]): void {
  const state: Wrapping = { current: [], width: 0 }
  for (const span of line) {
    if (span.icon !== undefined) {
      const w = size * 1.25
      if (state.width > 0 && state.width + w > max) {
        commit(state, size, out, widths)
      }
      state.current.push({ ...span, width: w })
      state.width += w
      continue
    }

    for (const piece of pieces(span.text)) {
      let part = piece
      if (state.width > 0 && state.width + measure.width(trimEnd(part), size, span.style) > max) {
        commit(state, size, out, widths)
        part = trimStart(part)
      }
      const last = state.current[state.current.length - 1]
      if (last !== undefined && last.style === span.style && last.icon === undefined) {
        last.text += part
        last.width = measure.width(last.text, size, last.style)
        state.width = 0
        for (const s of state.current) {
          state.width += s.width
        }
      } else {
        const w = measure.width(part, size, span.style)
        state.current.push({ icon: undefined, style: span.style, text: part, width: w })
        state.width += w
      }
    }
  }
  if (state.current.length > 0 || out.length === 0) {
    commit(state, size, out, widths)
  }
}

/**
 * Whether text holds no markup, as Pele's `/[<\\\n*_]|fa[bklrs]?:fa-/` finds it, no `&` of an
 * entity, and no `\u{fb02}` of a placeholder. One pass over the text tests all three.
 */
function isPlain(text: string): boolean {
  const n = text.length
  for (let at = 0; at < n; at++) {
    const c = charCodeAt.call(text, at)
    // `<`, `\`, `\n`, `*`, `_`, `&`, the placeholder's first character, or the `f` an icon
    // starts with.
    if (c === 0x3c || c === 0x5c || c === 0x0a || c === 0x2a || c === 0x5f || c === 0x26 || c === 0xfb02) return false
    if (c === 0x66 && iconPrefix(text, at) !== undefined) return false
  }
  return true
}

/** The length of a line break at the start of `rest`: Pele's `/<br\s*\/?>|\\n|\n/i`. */
function lineBreak(rest: string): number | undefined {
  if (rest.length === 0) return undefined
  switch (rest.charCodeAt(0)) {
    case 0x0a:
      return 1
    case 0x5c:
      return rest.charCodeAt(1) === 0x6e ? 2 : undefined
    case 0x3c: {
      if (rest.length < 3 || !eqIgnoreAsciiCase(rest.slice(1, 3), 'br')) return undefined
      const after = rest.slice(3)
      let end = 3 + after.length - trimStart(after).length
      if (rest.charCodeAt(end) === 0x2f) end += 1
      return rest.charCodeAt(end) === 0x3e ? end + 1 : undefined
    }
    default:
      return undefined
  }
}

/** Splits text at `<br>` tags, escaped `\n`, and newlines. */
function splitBreaks(text: string): string[] {
  const parts: string[] = []
  let start = 0
  let at = 0
  while (at < text.length) {
    const len = lineBreak(text.slice(at))
    if (len !== undefined) {
      parts.push(text.slice(start, at))
      at += len
      start = at
    } else {
      at += (text.codePointAt(at) as number) > 0xffff ? 2 : 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** A line count as a float. */
function linesF64(count: number): number {
  return Math.min(count, 4294967295)
}

/** Turns `\r\n` and `\r` into `\n`. */
function normalizeNewlines(text: string): string {
  if (!text.includes('\r')) return text

  return text.replace(/\r\n?/g, '\n')
}

/**
 * Lays out a label at font `size`, wrapping lines wider than `maxWidth`. `markdown` reads
 * emphasis markers and dedents, `base` is the style of unmarked text, and `icons` says which
 * `fa:` references the host can draw. An absent or empty label has no lines.
 */
export function layoutLabel(
  raw: string | undefined,
  markdown: boolean,
  size: number,
  maxWidth: number,
  base: number,
  icons: IconResolver | undefined,
): Label {
  if (raw === undefined || raw === '') return labelDefault()
  const lineHeight = jsRound(size * LINE_HEIGHT)

  if (isPlain(raw)) {
    const text = trim(raw)
    const width = measure.width(text, size, base)
    const span: Span = { icon: undefined, style: base, text, width }
    if (width <= maxWidth || !text.includes(' ')) {
      return {
        height: lineHeight,
        lineHeight,
        lines: [[span]],
        size,
        width,
        widths: [width],
      }
    }

    const lines: Span[][] = []
    const widths: number[] = []
    wrap([span], size, maxWidth, lines, widths)
    let widest = 0
    for (const w of widths) {
      if (w > widest) widest = w
    }
    return {
      height: linesF64(lines.length) * lineHeight,
      lineHeight,
      lines,
      size,
      width: widest,
      widths,
    }
  }

  const source = markdown ? trim(dedent(normalizeNewlines(raw))) : trim(raw)
  const lines: Span[][] = []
  const widths: number[] = []
  for (const part of splitBreaks(source)) {
    const line: Span[] = []
    inline(line, trim(part), markdown, base, icons)
    const w = measureSpans(line, size)
    if (w > maxWidth) {
      wrap(line, size, maxWidth, lines, widths)
    } else {
      lines.push(line)
      widths.push(w)
    }
  }

  let width = 0
  for (const w of widths) {
    if (w > width) width = w
  }
  return {
    height: linesF64(lines.length) * lineHeight,
    lineHeight,
    lines,
    size,
    width,
    widths,
  }
}
