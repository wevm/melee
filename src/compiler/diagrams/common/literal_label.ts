/**
 * @module Labels that keep every character, labels broken between characters, and labels written from
 * their start. Port of Pele's `src/diagrams/common/literal-label.ts`.
 */
import { esc, jsRound, labelSvg, pushNum, sharedStyle, spanStyle, textStyle } from '../../svg/builder.ts'
import { LINE_HEIGHT, type Label, type Span, trimEnd } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { buf, fmax } from '../../util/rust.ts'

/**
 * Lays out `text` at font `size` in lines no wider than `room`. Literal labels, including
 * filenames and protocol fields, keep every character but the spaces a line breaks at. Long
 * words break between characters, and measuring stays bounded by one line of text.
 */
export function literalLabel(text: string, size: number, room: number, style: number): Label {
  let lines: string[] = []
  for (const raw of text.split('\n')) {
    // UTF-16 offsets of each character and of the end, so characters `a..b` are
    // `raw.slice(bounds[a], bounds[b])`.
    const bounds: number[] = []
    for (let at = 0; at < raw.length; ) {
      bounds.push(at)
      at += (raw.codePointAt(at) as number) > 0xffff ? 2 : 1
    }
    bounds.push(raw.length)
    const count = bounds.length - 1
    const piece = (a: number, b: number): string => {
      const from = bounds[a]
      const to = bounds[b]
      if (from === undefined || to === undefined || from > to) return ''
      return raw.slice(from, to)
    }
    const space = (i: number): boolean => {
      const p = piece(i, i + 1)
      return p !== '' && isSpace(p.codePointAt(0) as number)
    }

    if (count === 0) lines.push('')
    let from = 0
    while (from < count) {
      const fits = (length: number): boolean => measure.width(piece(from, from + length), size, style) <= room
      let hi = 1
      while (hi < count - from && fits(hi)) hi = Math.min(count - from, hi * 2)
      let lo = 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(mid)) lo = mid
        else hi = mid - 1
      }

      let take = lo
      const wraps = from + take < count
      if (wraps && !space(from + take)) {
        for (let i = take - 1; i >= 1; i--) {
          if (space(from + i)) {
            take = i + 1
            break
          }
        }
      }

      const line = piece(from, from + take)
      const trimmed = trimEnd(line)
      lines.push(wraps && trimmed !== '' ? trimmed : line)
      from += take
      while (wraps && from < count && space(from)) from += 1
    }
  }
  if (text === '') lines = []

  const widths = lines.map((line) => measure.width(line, size, style))
  const width = widths.reduce((width, w) => fmax(width, w), 0)
  const lineHeight = jsRound(size * LINE_HEIGHT)
  const height = lines.length * lineHeight
  return {
    height,
    lineHeight,
    lines: lines.map((text, i) => [
      {
        icon: undefined,
        style,
        text,
        width: widths[i] as number,
      },
    ]),
    size,
    width,
    widths,
  }
}

/** A copy of a span. */
function cloneSpan(span: Span): Span {
  return { icon: span.icon, style: span.style, text: span.text, width: span.width }
}

/** Breaks the lines of `label` wider than `room` between characters, keeping icons whole. */
export function breakLabel(label: Label, room: number): Label {
  if (label.width <= room) {
    return {
      height: label.height,
      lineHeight: label.lineHeight,
      lines: label.lines.map((spans) => spans.map(cloneSpan)),
      size: label.size,
      width: label.width,
      widths: label.widths.slice(),
    }
  }

  const lines: Span[][] = []
  const widths: number[] = []
  for (let i = 0; i < label.lines.length; i++) {
    const spans = label.lines[i] as Span[]
    const lineWidth = label.widths[i] ?? Number.NaN
    if (lineWidth <= room) {
      lines.push(spans.map(cloneSpan))
      widths.push(lineWidth)
      continue
    }

    let current: Span[] = []
    let width = 0
    for (const span of spans) {
      if (span.icon !== undefined) {
        if (current.length > 0 && width + span.width > room) {
          lines.push(current)
          current = []
          widths.push(width)
          width = 0
        }
        current.push(cloneSpan(span))
        width += span.width
        continue
      }

      for (const ch of span.text) {
        const joins = (last: Span | undefined): boolean =>
          last !== undefined && last.icon === undefined && last.style === span.style
        let last = current[current.length - 1]
        let joined = joins(last)
        let added =
          last !== undefined && joined
            ? measure.width(last.text + ch, label.size, span.style) - last.width
            : measure.width(ch, label.size, span.style)
        if (current.length > 0 && width + added > room) {
          lines.push(current)
          current = []
          widths.push(width)
          width = 0
          joined = false
          added = measure.width(ch, label.size, span.style)
        }
        last = current[current.length - 1]
        if (last !== undefined && joined) {
          last.text += ch
          last.width += added
        } else {
          current.push({
            icon: undefined,
            style: span.style,
            text: ch,
            width: added,
          })
        }
        width += added
      }
    }
    if (current.length > 0 || spans.length === 0) {
      lines.push(current)
      widths.push(width)
    }
  }

  const width = widths.reduce((width, w) => fmax(width, w), 0)
  const height = lines.length * label.lineHeight
  return {
    height,
    lineHeight: label.lineHeight,
    lines,
    size: label.size,
    width,
    widths,
  }
}

/**
 * Writes `label` with every line starting at `x`, from `top` down. `attrs` go on each text
 * element. A line is anchored at its start and keeps its spaces, so where it begins does not
 * depend on how its text was measured. A line with icons is centered on its width and, as in
 * Pele, draws them without the host's markup.
 */
export function leftLabelSvg(label: Label, x: number, top: number, attrs: string): string {
  const shared = sharedStyle(label)
  const open = `<text${textStyle(attrs, shared)}`

  const body = buf()
  for (let i = 0; i < label.lines.length; i++) {
    const spans = label.lines[i] as Span[]
    const cy = top + (i + 0.5) * label.lineHeight
    if (spans.some((span) => span.icon !== undefined)) {
      const width = label.widths[i] ?? Number.NaN
      const one: Label = {
        height: label.lineHeight,
        lineHeight: label.lineHeight,
        lines: [spans.map(cloneSpan)],
        size: label.size,
        width,
        widths: [width],
      }
      body.s += labelSvg(one, x + width / 2, cy, attrs, undefined)
      continue
    }

    let text = ''
    for (const span of spans) {
      const own = spanStyle(span.style & ~shared & 0xff)
      if (own === '') {
        text += esc(span.text)
      } else {
        text += `<tspan${own}>${esc(span.text)}</tspan>`
      }
    }
    if (text !== '') {
      body.s += open
      body.s += ' x="'
      pushNum(body, x)
      body.s += '" y="'
      pushNum(body, cy + label.size * 0.35)
      body.s += '" text-anchor="start" xml:space="preserve">'
      body.s += text
      body.s += '</text>'
    }
  }
  return body.s
}
