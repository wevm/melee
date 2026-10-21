/** @module The quadrant chart database. Port of Pele's `src/diagrams/quadrant/db.ts`. */
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trim, trimEnd, trimStart } from '../../text/label.ts'
import { isHex, isSpace } from '../../util/chars.ts'
import { parse } from '../../util/float.ts'

/** A label: its text, and whether it is markdown. */
export type QuadrantText = {
  /** Whether the text came from a markdown string. */
  markdown: boolean
  /** The text. */
  text: string
}

/** `QuadrantText::default()`. */
export function quadrantTextDefault(): QuadrantText {
  return { markdown: false, text: '' }
}

/** How a point is drawn, from its own styles or its class. */
export type PointStyle = {
  /** A fill color: a hex code with or without `#`. */
  color: string | undefined
  /** A radius in pixels. */
  radius: number | undefined
  /** An outline color: a hex code with or without `#`. */
  strokeColor: string | undefined
  /** An outline width, such as `2px`. */
  strokeWidth: string | undefined
}

/** `PointStyle::default()`. */
export function pointStyleDefault(): PointStyle {
  return { color: undefined, radius: undefined, strokeColor: undefined, strokeWidth: undefined }
}

/** A point of the chart. */
export type QuadrantPoint = {
  /** The class after `:::`, or empty. */
  className: string
  /** Its own styles. */
  style: PointStyle
  /** The label. */
  text: QuadrantText
  /** From 0 at the left to 1 at the right. `NaN` when JavaScript's `Number` cannot read it. */
  x: number
  /** From 0 at the bottom to 1 at the top. */
  y: number
}

/** `QuadrantPoint::default()`. */
export function quadrantPointDefault(): QuadrantPoint {
  return { className: '', style: pointStyleDefault(), text: quadrantTextDefault(), x: 0, y: 0 }
}

/** A semantic error of a quadrant chart. */
function semantic(message: string): CompileError {
  const error = errorNew(Code.Semantic, message)
  error.type = 'quadrantChart'
  return error
}

function invalid(style: string, value: string, kind: string): CompileError {
  return semantic(`value for ${style} ${value} is invalid, please use a valid ${kind}`)
}

/** The first two parts of Mermaid's `style.trim().split(/\s*:\s*\/)`, found in one pass. */
function keyValue(style: string): [string, string] {
  const s = trim(style)
  const colon = s.indexOf(':')
  if (colon < 0) return [s, 'undefined']
  const rest = trimStart(s.slice(colon + 1))
  const key = trimEnd(s.slice(0, colon))
  const next = rest.indexOf(':')
  if (next < 0) return [key, rest]
  return [key, trimEnd(rest.slice(0, next))]
}

/** Whether `text` is one or more ASCII digits. */
function digits(text: string): boolean {
  if (text === '') return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) return false
  }
  return true
}

/** Mermaid's `/^#?([\dA-Fa-f]{6}|[\dA-Fa-f]{3})$/`. */
function hex(text: string): boolean {
  const body = text.startsWith('#') ? text.slice(1) : text
  if (body.length !== 3 && body.length !== 6) return false
  for (let i = 0; i < body.length; i++) {
    if (!isHex(body.charCodeAt(i))) return false
  }
  return true
}

/**
 * Reads Mermaid's point styles: `radius`, `color`, `stroke-color` and `stroke-width`, later ones
 * winning.
 *
 * Throws a semantic error for an invalid value or an unknown style.
 */
export function parseStyles(styles: readonly string[]): PointStyle {
  const out = pointStyleDefault()
  for (const style of styles) {
    const [key, value] = keyValue(style)
    switch (key) {
      case 'radius':
        if (!digits(value)) throw invalid(key, value, 'number')
        out.radius = parse(value) ?? Number.NaN
        break
      case 'color':
        if (!hex(value)) throw invalid(key, value, 'hex code')
        out.color = value
        break
      case 'stroke-color':
        if (!hex(value)) throw invalid(key, value, 'hex code')
        out.strokeColor = value
        break
      case 'stroke-width':
        if (!(value.endsWith('px') && digits(value.slice(0, -2)))) {
          throw invalid(key, value, 'number of pixels (eg. 10px)')
        }
        out.strokeWidth = value
        break
      default:
        throw semantic(`style named ${key} is not supported.`)
    }
  }
  return out
}

/** `2^128 - 1`, the largest `u128`. */
const U128_MAX = (1n << 128n) - 1n

/** The value of a digit character in `radix`, as `char::to_digit` reads it, or `undefined`. */
function toDigit(c: number, radix: number): number | undefined {
  let digit: number
  if (c >= 0x30 && c <= 0x39) digit = c - 0x30
  else if (c >= 0x61 && c <= 0x7a) digit = c - 0x61 + 10
  else if (c >= 0x41 && c <= 0x5a) digit = c - 0x41 + 10
  else return undefined
  return digit < radix ? digit : undefined
}

/** The value of digits in `radix`, as JavaScript reads a `0x`, `0o` or `0b` literal, or `NaN`. */
function radixValue(text: string, radix: number): number {
  if (text === '') return Number.NaN
  let exact = 0n
  let rough = 0
  let overflow = false
  const big = BigInt(radix)
  for (const ch of text) {
    const digit = toDigit(ch.codePointAt(0) as number, radix)
    if (digit === undefined) return Number.NaN
    // ponytail: past 128 bits the value is summed in floating point, which may round
    // differently from V8 in the last place.
    const value = exact * big + BigInt(digit)
    if (!overflow && value <= U128_MAX) {
      exact = value
    } else {
      if (!overflow) {
        rough = Number(exact)
        overflow = true
      }
      rough = rough * radix + digit
    }
  }
  if (overflow) return rough
  return Number(exact)
}

/**
 * JavaScript's `Number` of a point coordinate as the lexer reads one: `1`, `0`, or `0`, any one
 * character, and digits. The character makes it a decimal fraction, a hex, octal or binary
 * literal, an exponent, or more leading digits, and anything else is `NaN`.
 */
export function coordinate(text: string): number {
  if (!text.startsWith('0')) return parse(text) ?? Number.NaN
  const rest = text.slice(1)
  if (rest === '') return 0
  const kind = String.fromCodePoint(rest.codePointAt(0) as number)
  const tail = rest.slice(kind.length)
  switch (kind) {
    case 'x':
    case 'X':
      return radixValue(tail, 16)
    case 'o':
    case 'O':
      return radixValue(tail, 8)
    case 'b':
    case 'B':
      return radixValue(tail, 2)
    default:
      if (kind === '.' || kind === 'e' || kind === 'E' || (kind >= '0' && kind <= '9' && kind.length === 1)) {
        return parse(text) ?? Number.NaN
      }
      return Number.NaN
  }
}

/**
 * `text.replace(/\n\s+/g, '\n')`: whitespace after each line break removed, line breaks within
 * it included.
 */
export function accDescription(text: string): string {
  let out = ''
  let i = 0
  // Every `\s` character is in the Basic Multilingual Plane.
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i++
    if (c === 10) {
      while (i < text.length && isSpace(text.charCodeAt(i))) i++
    }
  }
  return out
}

function trimmed(label: QuadrantText): QuadrantText {
  return { markdown: label.markdown, text: trim(label.text) }
}

/** The parsed quadrant chart: Pele's `QuadrantDb`. */
export type QuadrantDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Point classes by name, in the order they were first defined. */
  classes: [string, PointStyle][]
  /** Points, in order. */
  points: QuadrantPoint[]
  /** Quadrants 1 to 4: top right, top left, bottom left, bottom right. */
  quadrants: (QuadrantText | undefined)[]
  /** The title. */
  title: string | undefined
  /** The text at the left of the x axis. */
  xAxisLeft: QuadrantText | undefined
  /** The text at the right of the x axis. */
  xAxisRight: QuadrantText | undefined
  /** The text at the bottom of the y axis. */
  yAxisBottom: QuadrantText | undefined
  /** The text at the top of the y axis. */
  yAxisTop: QuadrantText | undefined
}

/** `QuadrantDb::default()`. */
export function quadrantDbDefault(): QuadrantDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    classes: [],
    points: [],
    quadrants: [undefined, undefined, undefined, undefined],
    title: undefined,
    xAxisLeft: undefined,
    xAxisRight: undefined,
    yAxisBottom: undefined,
    yAxisTop: undefined,
  }
}

/** Sets the text of quadrant `index`, from 0 for `quadrant-1`. */
export function quadrantDbSetQuadrantText(db: QuadrantDb, index: number, label: QuadrantText): void {
  if (index < db.quadrants.length) db.quadrants[index] = trimmed(label)
}

/** Sets the text at the left of the x axis. */
export function quadrantDbSetXAxisLeftText(db: QuadrantDb, label: QuadrantText): void {
  db.xAxisLeft = trimmed(label)
}

/** Sets the text at the right of the x axis. */
export function quadrantDbSetXAxisRightText(db: QuadrantDb, label: QuadrantText): void {
  db.xAxisRight = trimmed(label)
}

/** Sets the text at the bottom of the y axis. */
export function quadrantDbSetYAxisBottomText(db: QuadrantDb, label: QuadrantText): void {
  db.yAxisBottom = trimmed(label)
}

/** Sets the text at the top of the y axis. */
export function quadrantDbSetYAxisTopText(db: QuadrantDb, label: QuadrantText): void {
  db.yAxisTop = trimmed(label)
}

/**
 * Adds a point.
 *
 * Throws a semantic error for an invalid style.
 */
export function quadrantDbAddPoint(
  db: QuadrantDb,
  label: QuadrantText,
  className: string,
  x: string,
  y: string,
  styles: readonly string[],
): void {
  const style = parseStyles(styles)
  db.points.push({ className, style, text: trimmed(label), x: coordinate(x), y: coordinate(y) })
}

/**
 * Defines a point class, replacing one of the same name in place.
 *
 * Throws a semantic error for an invalid style.
 */
export function quadrantDbAddClass(db: QuadrantDb, className: string, styles: readonly string[]): void {
  const style = parseStyles(styles)
  const entry = db.classes.find(([name]) => name === className)
  if (entry !== undefined) entry[1] = style
  else db.classes.push([className, style])
}

/** The class named `name`. */
export function quadrantDbClass(db: QuadrantDb, name: string): PointStyle | undefined {
  return db.classes.find(([own]) => own === name)?.[1]
}

/** Sets the title from a `title` statement. */
export function quadrantDbSetDiagramTitle(db: QuadrantDb, text: string): void {
  db.title = text
}

/** Sets the accessible title, without the whitespace it starts with. */
export function quadrantDbSetAccTitle(db: QuadrantDb, text: string): void {
  db.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its lines. */
export function quadrantDbSetAccDescription(db: QuadrantDb, text: string): void {
  db.accDescr = accDescription(text)
}
