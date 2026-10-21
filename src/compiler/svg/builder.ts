/**
 * @module Escaping, number formatting, and label text for SVG output. Port of Pele's
 * `src/svg/builder.ts`.
 */
import type { Buf } from '../util/rust.ts'
import { decode } from '../text/entities.ts'
import type { IconResolver } from '../text/icons.ts'
import type { Label } from '../text/label.ts'
import { BOLD, ITALIC } from '../text/measure.ts'

/** Rounds as JavaScript's `Math.round` does: halves toward positive infinity. */
export function jsRound(value: number): number {
  const floor = Math.floor(value)
  if (value - floor >= 0.5) return floor + 1
  else return floor
}

/** Whether XML text needs escaping: markup characters, or control characters XML does not allow. */
function needsEsc(c: number): boolean {
  return (
    c === 0x26 ||
    c === 0x3c ||
    c === 0x3e ||
    c === 0x22 ||
    c <= 0x08 ||
    c === 0x0b ||
    c === 0x0c ||
    (c >= 0x0e && c <= 0x1f) ||
    c === 0x7f
  )
}

/** `String.prototype.charCodeAt`, for hot loops over text, as `text/measure.ts` explains. */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** {@link needsEsc} of each ASCII character as 1 or 0. Every character that needs it is ASCII. */
const ESC: Uint8Array = (() => {
  const out = new Uint8Array(128)
  for (let c = 0; c < 128; c++) out[c] = needsEsc(c) ? 1 : 0
  return out
})()

/**
 * Escapes text for XML and drops the control characters XML does not allow. The rare rewrite is
 * a function of its own, which keeps its code out of the scan.
 */
export function esc(text: string): string {
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = charCodeAt.call(text, i)
    if (c < 128 && ESC[c] === 1) return escFrom(text, i)
  }
  return text
}

/** {@link esc} of `text`, whose first character that needs escaping is at `i`. */
function escFrom(text: string, i: number): string {
  const n = text.length
  // Every character that needs escaping is ASCII, so stepping over UTF-16 units is stepping
  // over characters.
  let out = text.slice(0, i)
  let start = i
  for (; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c >= 128 || ESC[c] === 0) continue
    out += text.slice(start, i)
    start = i + 1
    if (c === 0x26) out += '&amp;'
    else if (c === 0x3c) out += '&lt;'
    else if (c === 0x3e) out += '&gt;'
    else if (c === 0x22) out += '&quot;'
    // Any other is dropped.
  }
  return out + text.slice(start)
}

/**
 * Escapes text that is only ever read as text: a tooltip, an accessible name, a `data-id`.
 * Entity codes become their characters first. A value that was checked before it is written,
 * such as a style, a color, or a URL, goes through {@link esc} instead, so what was checked is what
 * is written.
 */
export function escText(text: string): string {
  return esc(decode(text))
}

/** `u64::MAX`, where the cast of a coordinate saturates. */
const U64_MAX = 18446744073709551615n

/** The fraction part of hundredths `0..100`: empty, or a dot and one or two digits. */
const FRACTIONS: readonly string[] = (() => {
  const out: string[] = ['']
  for (let f = 1; f < 100; f++) {
    let s = '.'
    s += String.fromCharCode(0x30 + Math.trunc(f / 10))
    if (f % 10 !== 0) s += String.fromCharCode(0x30 + (f % 10))
    out.push(s)
  }
  return out
})()

/** Hundredths at or above this go through {@link numSlow}. Below it they are small integers. */
const FAST_LIMIT = 2147483647

/** Appends a coordinate rounded to two decimals, without trailing zeros or negative zero. */
export function pushNum(out: Buf, value: number): void {
  out.s += num(value)
}

/** A coordinate rounded to two decimals, without trailing zeros or negative zero. */
export function num(value: number): string {
  // `jsRound(value * 100)`, inlined.
  const scaled = value * 100
  const floor = Math.floor(scaled)
  const n = scaled - floor >= 0.5 ? floor + 1 : floor
  if (n > 0) {
    if (n < FAST_LIMIT) {
      const k = n | 0
      // `%` is exact on whole numbers, and the quotient of a multiple of 100 is exact.
      const fraction = k % 100
      return fraction === 0 ? String(k / 100) : String((k - fraction) / 100) + (FRACTIONS[fraction] as string)
    }
  } else if (n < 0) {
    const m = -n
    if (m < FAST_LIMIT) {
      const fraction = m % 100
      return '-' + String((m - fraction) / 100) + (FRACTIONS[fraction] as string)
    }
  } else if (n === 0) {
    return '0'
  }
  return numSlow(n)
}

/** {@link num} of hundredths `n` that are large, infinite, or `NaN`. */
function numSlow(n: number): string {
  if (Number.isNaN(n)) return 'NaN'
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity'

  let out = ''
  if (n < 0) {
    out += '-'
    n = -n
  }

  // ponytail: Pele prints hundredths of 1e11 and more with `String(n / 100)`, which turns to
  // exponents past 1e21. This keeps the two-decimal form, saturating at `u64::MAX`.
  let fraction: number
  if (n <= Number.MAX_SAFE_INTEGER) {
    // `%` is exact on whole doubles, and the quotient of a multiple of 100 below 2^53 is exact.
    fraction = n % 100
    out += String((n - fraction) / 100)
  } else {
    // `n` is a whole double, so `BigInt` holds it exactly.
    const big = n >= 18446744073709551615 ? U64_MAX : BigInt(n)
    out += String(big / 100n)
    fraction = Number(big % 100n)
  }
  return out + (FRACTIONS[fraction] as string)
}

/**
 * Writes a measured label as SVG text centered on (`cx`, `cy`). `attrs` go on the text element;
 * `icons` draws the label's icons.
 */
export function labelSvg(
  label: Label,
  cx: number,
  cy: number,
  attrs: string,
  icons: IconResolver | undefined,
): string {
  const lines = label.lines
  if (lines.length === 0) return ''

  const lh = label.lineHeight
  const shift = label.size * 0.35
  let y = cy - label.height / 2 + lh / 2 + shift

  const only = lines.length === 1 ? lines[0] : undefined
  const single = only !== undefined && only.length === 1 ? only[0] : undefined
  if (single !== undefined && single.icon === undefined && single.style === 0) {
    return `<text${attrs} x="${num(cx)}" y="${num(y)}" text-anchor="middle">${esc(single.text)}</text>`
  }

  const shared = sharedStyle(label)
  let body = ''
  let extra = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as Label['lines'][number]
    let iconic = false
    for (let j = 0; j < line.length; j++) {
      if ((line[j] as Label['lines'][number][number]).icon !== undefined) {
        iconic = true
        break
      }
    }
    if (iconic) {
      let x = cx - (label.widths[i] ?? Number.NaN) / 2
      for (const span of line) {
        const icon = span.icon
        if (icon !== undefined) {
          const side = label.size * 1.1
          extra += `<svg class="ondine-icon" data-icon="${escText(icon)}" x="${num(x)}" y="${num(y - shift - side / 2)}" width="${num(side)}" height="${num(side)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`
          if (icons !== undefined) {
            const inner = icons(icon)
            if (inner !== undefined) extra += inner
          }
          extra += '</svg>'
        } else if (span.text !== '') {
          body += `<tspan x="${num(x)}" y="${num(y)}" text-anchor="start"${spanStyle(span.style & ~shared)}>${esc(span.text)}</tspan>`
        }
        x += span.width
      }
    } else {
      for (let j = 0; j < line.length; j++) {
        const span = line[j] as Label['lines'][number][number]
        if (j === 0) body += `<tspan x="${num(cx)}" y="${num(y)}"${spanStyle(span.style & ~shared)}>${esc(span.text)}</tspan>`
        else body += `<tspan${spanStyle(span.style & ~shared)}>${esc(span.text)}</tspan>`
      }
      if (line.length === 0) body += `<tspan x="${num(cx)}" y="${num(y)}"> </tspan>`
    }
    y += lh
  }

  return `<text${textStyle(attrs, shared)} text-anchor="middle" xml:space="preserve">${body}</text>${extra}`
}

/** The attribute that makes text bold, at the weight the root sets. */
const BOLD_ATTR = ' font-weight="var(--_w)"'
/** The attribute that makes text italic. */
const ITALIC_ATTR = ' font-style="italic"'

/** The attributes for a span's emphasis bits. */
export function spanStyle(style: number): string {
  const bold = (style & BOLD) !== 0
  const italic = (style & ITALIC) !== 0
  if (bold && italic) return ' font-weight="var(--_w)" font-style="italic"'
  if (bold) return BOLD_ATTR
  if (italic) return ITALIC_ATTR
  return ''
}

/**
 * The emphasis every span of a label has. It is written once, on the text element, where a CSS
 * rule for the label reaches it.
 */
export function sharedStyle(label: Label): number {
  let shared = BOLD | ITALIC
  let any = false
  for (const line of label.lines) {
    for (const span of line) {
      if (span.icon !== undefined || span.text === '') continue
      shared &= span.style
      any = true
    }
  }
  return any ? shared : 0
}

/**
 * Adds that emphasis to a text element's attributes, unless they give a weight or style of
 * their own.
 */
export function textStyle(attrs: string, shared: number): string {
  const bold = (shared & BOLD) !== 0 && !attrs.includes(' font-weight="')
  const italic = (shared & ITALIC) !== 0 && !attrs.includes(' font-style="')
  if (!bold && !italic) return attrs

  let out = attrs
  if (bold) out += BOLD_ATTR
  if (italic) out += ITALIC_ATTR
  return out
}
