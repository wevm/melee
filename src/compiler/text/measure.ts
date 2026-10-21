/**
 * @module Text widths for a monospace font. Every glyph advances by a fixed fraction of the font
 * size, so widths need no font tables, canvas, or DOM, and match in every host.
 */

/**
 * `String.prototype.charCodeAt`, called as `charCodeAt.call(text, i)` in hot loops over text.
 *
 * Text reaches those loops as V8 strings of many internal kinds: sequential, sliced, joined,
 * internalized, one or two bytes per character. Each kind has its own map, so the lookup of
 * `text.charCodeAt` sees too many maps and becomes a generic load and call per character, several
 * times slower than reading the character. Calling the one known function skips the lookup, and
 * the optimizer reads the character directly. Each module that does this keeps its own unexported
 * copy: the optimizer treats that as a constant, but not a binding that is exported or imported.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** Bold text, as a style bit. */
export const BOLD = 1
/** Italic text, as a style bit. */
export const ITALIC = 2
/** Monospace text, as a style bit. Every style measures as monospace. */
export const MONO = 4

/** Advance of an ordinary glyph, in thousandths of an em. */
const ADVANCE = 600
/** Advance of a wide (East Asian or emoji) glyph, in thousandths of an em. */
const WIDE = 1200

/** `u32::MAX`, where the sum of advances saturates. */
const U32_MAX = 4294967295

/**
 * The width of `text` at `size` pixels. `style` is accepted for parity with Pele's measurer and
 * does not change monospace widths.
 */
export function width(text: string, size: number, _style: number): number {
  // Every advance is positive, so saturating the total once is saturating each sum.
  let units = 0
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = charCodeAt.call(text, i)
    if (c >= 0x300) return widthFrom(text, i, units, size)
    if (c >= 32) units += ADVANCE
  }
  return (Math.min(units, U32_MAX) * size) / 1000
}

/** {@link width} of `text` from offset `i`, where a character past U+02FF is, after `units`. */
function widthFrom(text: string, i: number, units: number, size: number): number {
  const n = text.length
  for (; i < n; i++) {
    let c = text.charCodeAt(i)
    if (c < 0x300) {
      if (c >= 32) units += ADVANCE
      continue
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000
        i++
      }
    }
    if (isZeroWidth(c)) continue
    units += isWide(c) ? WIDE : ADVANCE
  }
  return (Math.min(units, U32_MAX) * size) / 1000
}

// Pele tests UTF-16 units and counts a surrogate pair as one wide unit and one zero-width unit,
// so every supplementary character is wide here.
function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    c > 0xffff
  )
}

function isZeroWidth(c: number): boolean {
  return (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f) || c === 0xfeff
}
