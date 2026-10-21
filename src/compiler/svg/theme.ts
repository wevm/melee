/**
 * @module Theme variables, author styles, and class names. Port of Pele's `src/svg/theme.ts`.
 *
 * Ondine's deliberate difference: public `--ondine-*` variables replace Pele's `--pele-*` ones,
 * with monochrome defaults, square corners, a monospace font, and a `--ondine-stroke` width.
 */
import { esc } from './builder.ts'
import { trim } from '../text/label.ts'
import { isSpace } from '../util/chars.ts'
import { parse } from '../util/float.ts'
import { remEuclid, type Buf } from '../util/rust.ts'
import { pushNumber } from '../yaml.ts'

/**
 * Private aliases set once on the root element, so each use is short and the public `--ondine-*`
 * variables keep their defaults. Node fills default to the background, and lines, borders,
 * and muted text to the foreground, so setting `--ondine-bg` and `--ondine-fg` themes a diagram.
 * The alternate surface is a light tint of the foreground, as diagrams draw grids, graticules,
 * excluded ranges, and finished work in it, which would vanish into the background. The text color is set as
 * well: an icon is drawn in `currentColor`, which would otherwise be whatever color the page
 * gives the diagram's container. Shapes and edges inherit the stroke width, which defaults to the
 * 2 pixels that the diagrams' fixed-width outlines already use.
 */
export const ROOT_STYLE =
  '--_bg:var(--ondine-bg,#fff);--_fg:var(--ondine-fg,#000);' +
  '--_m:var(--ondine-muted,var(--_fg));--_l:var(--ondine-line,var(--_fg));--_s:var(--ondine-surface,var(--_bg));' +
  '--_a:var(--ondine-surface-alt,color-mix(in srgb,var(--_fg) 20%,var(--_bg)));--_b:var(--ondine-border,var(--_fg));--_c:var(--ondine-accent,var(--_fg));' +
  '--_sw:var(--ondine-stroke,2px);stroke-width:var(--_sw);color:var(--_fg)'

/** The monospace font, as set on the root. */
export const FONT_MONO = 'var(--_fm)'

/** The corner radius of rectangles. (Rust builds it with a `radius!` macro, so constants can embed it.) */
export const RADIUS = 'var(--ondine-radius,0)'
/**
 * The attribute that gives a rectangle the themed corner radius. The root document moves it
 * into the rectangle's style.
 */
export const ROUNDED = ` rx="${RADIUS}"`
/**
 * The style that {@link ROUNDED} becomes once the root document moves it, on a rectangle with no
 * style of its own. The root's scan finds the radius it reads either way, so a rectangle written
 * with this, at the end of its tag, gives the same document as one written with {@link ROUNDED},
 * without the move.
 */
export const ROUNDED_STYLE = ' style="rx:var(--_r)"'

/**
 * {@link ROUNDED_STYLE} joined with `style`, a `style` attribute from {@link resolveStyle} or
 * nothing, as the root document joins them when it moves the radius into a style that follows it.
 */
export function roundedStyle(style: string): string {
  if (style === '') return ROUNDED_STYLE
  // `style` is ` style="...` with its value escaped.
  return ' style="rx:var(--_r);' + style.slice(8)
}

/**
 * The color of what a diagram marks as critical. It is not one of the series colors, as a theme
 * may put those in any order.
 */
export const CRITICAL = 'var(--ondine-critical,var(--_fg))'
/** The stroke width of shapes and edges, as set on the root. */
export const STROKE = 'var(--_sw)'

/** The font stack labels are drawn in when the page sets no `--ondine-font`. */
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace"

/**
 * The root's font declarations at `size` pixels. Ondine measures every font as monospace, so the
 * font comes only from `--ondine-font`, for both Pele's normal and monospace stacks. The rest of
 * what text inherits is pinned, as none of it was measured. Kerning and ligatures are off and
 * glyphs are placed at their exact size, so every character keeps the uniform advance that
 * layout assumed.
 */
export function fontStyle(size: number): string {
  // Documents mostly share a size, so the last one is kept.
  if (lastFontSize !== undefined && Object.is(size, lastFontSize)) return lastFontStyle
  lastFontStyle = fontStyleOf(size)
  lastFontSize = size
  return lastFontStyle
}

/** The size {@link fontStyle} last wrote, and what it wrote. */
let lastFontSize: number | undefined
let lastFontStyle = ''

/** {@link fontStyle}, written out. */
function fontStyleOf(size: number): string {
  const out: Buf = { s: '' }
  out.s += ';--_fm:var(--ondine-font,'
  out.s += FONT
  out.s += ');font:'
  pushNumber(out, size)
  out.s +=
    'px monospace;letter-spacing:normal;word-spacing:normal;text-transform:none;direction:ltr;font-family:var(--ondine-font,'
  out.s += FONT
  out.s += ');font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision'
  return out.s
}

/** Properties of an author style that apply to a shape, in no particular order. */
const SHAPE_PROPS: readonly string[] = [
  'fill',
  'fill-opacity',
  'opacity',
  'rx',
  'ry',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
]

/** Properties of an author style that apply to text, in no particular order. */
const TEXT_PROPS: readonly string[] = [
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'opacity',
  'text-decoration',
  'word-spacing',
]

/** Author styles split by what they apply to, as attributes ready to write. */
export type ResolvedStyle = {
  /** Whether the text is bold. */
  bold: boolean
  /** A font size in pixels, when one in range was given. */
  fontSize: number | undefined
  /** Whether the text is italic. */
  italic: boolean
  /** A `style` attribute for lines: the shape's declarations without fills. */
  line: string
  /** A `style` attribute for the shape. */
  shape: string
  /** The stroke color, when one was given. */
  stroke: string | undefined
  /** A `style` attribute for the text. */
  text: string
}

/** `ResolvedStyle::default()`. */
export function resolvedStyleDefault(): ResolvedStyle {
  return {
    bold: false,
    fontSize: undefined,
    italic: false,
    line: '',
    shape: '',
    stroke: undefined,
    text: '',
  }
}

/** Whether `text` at `at` starts with the ASCII `word`, ignoring case. */
function startsWithCi(text: string, at: number, word: string): boolean {
  if (at + word.length > text.length) return false
  for (let i = 0; i < word.length; i++) {
    let a = text.charCodeAt(at + i)
    let b = word.charCodeAt(i)
    if (a >= 65 && a <= 90) a += 32
    if (b >= 65 && b <= 90) b += 32
    if (a !== b) return false
  }
  return true
}

/** Whether `word`, then optional whitespace, then `(` starts at `at`. */
function callAt(text: string, at: number, word: string): boolean {
  if (!startsWithCi(text, at, word)) return false
  let rest = at + word.length
  while (rest < text.length && isSpace(text.charCodeAt(rest))) rest++
  return text.charCodeAt(rest) === 0x28
}

/** Pele's `/url\s*\(|expression\s*\(|javascript:|[<>{};\\]|@import|image-set|\/\*\/i`. */
function unsafeValue(value: string): boolean {
  for (let at = 0; at < value.length; at++) {
    const b = value.charCodeAt(at)
    if (
      b === 0x3c ||
      b === 0x3e ||
      b === 0x7b ||
      b === 0x7d ||
      b === 0x3b ||
      b === 0x5c ||
      callAt(value, at, 'url') ||
      callAt(value, at, 'expression') ||
      startsWithCi(value, at, 'javascript:') ||
      startsWithCi(value, at, '@import') ||
      startsWithCi(value, at, 'image-set') ||
      startsWithCi(value, at, '/*')
    )
      return true
  }
  return false
}

/** `text` without any `!important`, in any case. */
function stripImportant(text: string): string {
  const WORD = '!important'
  let any = false
  for (let at = 0; at < text.length; at++) {
    if (startsWithCi(text, at, WORD)) {
      any = true
      break
    }
  }
  if (!any) return text

  let out = ''
  let start = 0
  let at = 0
  while (at < text.length) {
    if (startsWithCi(text, at, WORD)) {
      out += text.slice(start, at)
      at += WORD.length
      start = at
    } else at += 1
  }
  out += text.slice(start)
  return out
}

/**
 * Sets `key` in an insertion-ordered map, keeping the position of an existing key as a
 * JavaScript `Map` does.
 */
function set(map: [string, string][], key: string, value: string): void {
  const entry = map.find(([k]) => k === key)
  if (entry !== undefined) entry[1] = value
  else map.push([key, value])
}

function isAsciiDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

/** JavaScript's `parseFloat` over text of digits and dots: the longest leading decimal number. */
function parseFloat(text: string): number | undefined {
  let int = 0
  while (int < text.length && isAsciiDigit(text.charCodeAt(int))) int++
  let end = int
  let digits = int
  if (text.charCodeAt(end) === 0x2e) {
    let frac = 0
    while (end + 1 + frac < text.length && isAsciiDigit(text.charCodeAt(end + 1 + frac))) frac++
    digits += frac
    if (frac > 0) end += 1 + frac
  }
  if (digits === 0) return undefined
  return parse(text.slice(0, end))
}

/** `u64::MAX`, the largest value `u64::from_str_radix` reads. */
const U64_MAX = 18446744073709551615n

/** Digits `u64::from_str_radix` accepts in each radix, without a sign. */
const RADIX_DIGITS: Record<number, RegExp> = {
  16: /^[0-9a-fA-F]+$/,
  8: /^[0-7]+$/,
  2: /^[01]+$/,
}

/** The prefix `BigInt` reads for each radix. */
const RADIX_PREFIX: Record<number, string> = { 16: '0x', 8: '0o', 2: '0b' }

/** JavaScript's `Number(text)`, for the forms a font weight can take. */
function jsNumber(input: string): number {
  const text = trim(input)
  if (text === '') return 0

  const prefixes: [string, number][] = [
    ['0x', 16],
    ['0X', 16],
    ['0o', 8],
    ['0O', 8],
    ['0b', 2],
    ['0B', 2],
  ]
  for (const [prefix, radix] of prefixes) {
    if (text.startsWith(prefix)) {
      const digits = text.slice(prefix.length)
      // `u64::from_str_radix` takes a `+`, which the filter then refuses, and no `-`.
      if (!(RADIX_DIGITS[radix] as RegExp).test(digits)) return Number.NaN
      const value = BigInt(`${RADIX_PREFIX[radix]}${digits}`)
      if (value > U64_MAX) return Number.NaN
      // `u64 as f64` and `Number(bigint)` both round to nearest, ties to even.
      return Number(value)
    }
  }

  switch (text) {
    case 'Infinity':
    case '+Infinity':
      return Number.POSITIVE_INFINITY
    case '-Infinity':
      return Number.NEGATIVE_INFINITY
  }

  // Rust also reads `inf` and `nan`, which JavaScript does not, so only number characters pass.
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (!(isAsciiDigit(c) || c === 0x2e || c === 0x65 || c === 0x45 || c === 0x2b || c === 0x2d)) return Number.NaN
  }
  return parse(text) ?? Number.NaN
}

/** Lowercases as JavaScript's `toLowerCase` does, for property names. */
function lowercase(text: string): string {
  // Rust lowercases each character alone, with no final-sigma rule.
  let out = ''
  for (const c of text) out += c.toLowerCase()
  return out
}

/** Splits Mermaid style declarations into what applies to a shape and what applies to its text. */
export function resolveStyle(declarations: readonly string[]): ResolvedStyle {
  if (declarations.length === 0) return resolvedStyleDefault()

  const shape: [string, string][] = []
  const text: [string, string][] = []
  for (const decl of declarations) {
    const at = decl.indexOf(':')
    if (!(at > 0)) continue
    const prop = lowercase(trim(decl.slice(0, at)))
    const value = trim(stripImportant(decl.slice(at + 1)))
    if (value === '' || unsafeValue(value)) continue
    if (SHAPE_PROPS.includes(prop)) set(shape, prop, value)
    if (TEXT_PROPS.includes(prop)) set(text, prop === 'color' ? 'fill' : prop, value)
  }
  if (shape.length === 0 && text.length === 0) return resolvedStyleDefault()

  const shapeCss: Buf = { s: '' }
  const lineCss: Buf = { s: '' }
  for (const [prop, value] of shape) {
    pushDeclaration(shapeCss, prop, value)
    if (prop !== 'fill' && prop !== 'fill-opacity') pushDeclaration(lineCss, prop, value)
  }
  const textCss: Buf = { s: '' }
  for (const [prop, value] of text) pushDeclaration(textCss, prop, value)

  const get = (map: [string, string][], key: string): string | undefined => map.find(([k]) => k === key)?.[1]
  const weight = get(text, 'font-weight')
  const size = get(text, 'font-size')
  const px = (() => {
    if (size === undefined) return undefined
    const digits = size.endsWith('px') ? size.slice(0, -2) : size
    if (digits === '') return undefined
    for (let i = 0; i < digits.length; i++) {
      const c = digits.charCodeAt(i)
      if (!(isAsciiDigit(c) || c === 0x2e)) return undefined
    }
    return parseFloat(digits)
  })()
  return {
    bold: weight !== undefined && (weight === 'bold' || weight === 'bolder' || jsNumber(weight) >= 600),
    fontSize: px !== undefined && px > 0 && px <= 200 ? px : undefined,
    italic: get(text, 'font-style') === 'italic',
    line: styleAttr(lineCss.s),
    shape: styleAttr(shapeCss.s),
    stroke: get(shape, 'stroke'),
    text: styleAttr(textCss.s),
  }
}

/** Appends `prop:value;`. */
function pushDeclaration(out: Buf, prop: string, value: string): void {
  out.s += prop
  out.s += ':'
  out.s += value
  out.s += ';'
}

/** A `style` attribute holding `css`, or nothing when it is empty. */
function styleAttr(css: string): string {
  if (css === '') return ''
  return ` style="${esc(css)}"`
}

/**
 * Author class names as a ` class` suffix: every run of characters outside `[\w-]` becomes one
 * space. Empty when nothing is left.
 */
export function classNames(raw: string): string {
  let out = ''
  // Only ASCII characters are kept, so stepping over UTF-16 units is stepping over characters.
  // Each run of kept characters is added whole, after a space.
  let start = -1
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (isAsciiDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 0x5f || c === 0x2d) {
      if (start < 0) start = i
    } else if (start >= 0) {
      out += ' ' + raw.slice(start, i)
      start = -1
    }
  }
  if (start >= 0) out += ' ' + raw.slice(start)
  return out
}

/**
 * The share of the foreground in each series' default shade. Every shade is at least half the
 * foreground, so thin lines, outlines under a wash, and labels drawn in the background color stay
 * readable on it. Neighboring series differ by at least 15 points.
 */
const SERIES_SHADES: readonly string[] = ['100', '57', '86', '50', '79', '64', '93', '71']

/**
 * Color for the nth data series in a chart, cycling through eight variables. Each defaults to a
 * shade between the foreground and background, so charts stay monochrome and follow the scheme.
 */
export function seriesColor(index: number): string {
  const k = remEuclid(index, 8)
  let out = 'var(--ondine-series-'
  out += String.fromCharCode(0x31 + k)
  out += ',color-mix(in srgb,var(--_fg) '
  out += SERIES_SHADES[k] ?? '100'
  out += '%,var(--_bg)))'
  return out
}
