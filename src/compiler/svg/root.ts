/** @module The root SVG document around a diagram's content. Port of Pele's `src/svg/root.ts`. */
import { esc, escText } from './builder.ts'
import { RADIUS, ROOT_STYLE, ROUNDED, fontStyle } from './theme.ts'
import type { Buf } from '../util/rust.ts'
import { pushNumber } from '../yaml.ts'

/**
 * The host's options that the shared SVG modules read. A subset of Pele's `RenderOptions`;
 * diagram modules add the fields they read as they are ported. Ondine has no font options, since
 * fonts come from `--ondine-font` and every width is monospace.
 */
export type RenderOptions = {
  /**
   * Whether a diagram that runs across may be drawn running down when it does not fit
   * `maxWidth`. On unless `false`.
   */
  autoDirection?: boolean | undefined
  /** The width under which a diagram may turn to run down. 640 when absent or not positive. */
  directionBreakpoint?: number | undefined
  /** Font size in pixels. 16 when absent. */
  fontSize?: number | undefined
  /** The prefix of element IDs, so several diagrams can share a page. `pele` when absent. */
  idPrefix?: string | undefined
  /** Schemes an image may use besides a relative address. */
  imageSchemes?: string[] | undefined
  /** Whether images are drawn. On unless `false`. */
  images?: boolean | undefined
  /** The most UTF-16 units of source to accept. 50,000 when absent. */
  limit?: number | undefined
  /** The `rel` of links. `noopener` when absent; empty omits it. */
  linkRel?: string | undefined
  /** Schemes a link may use besides a relative address. */
  linkSchemes?: string[] | undefined
  /** Whether links are drawn. On unless `false`. */
  links?: boolean | undefined
  /** The most edges a flowchart may have. 5,000 when absent. */
  maxEdges?: number | undefined
  /**
   * The width the host has for the diagram, in pixels. A type that can draw itself narrower
   * does, so its text is not shrunk with it.
   */
  maxWidth?: number | undefined
  /**
   * The time a gantt chart schedules against, in milliseconds since the epoch. The epoch
   * when absent, since the compiler reads no clock.
   */
  now?: number | undefined
  /** The most UTF-16 units of SVG to produce. 4,000,000 when absent. */
  outputLimit?: number | undefined
  /** Space around a diagram. 8 when absent. */
  padding?: number | undefined
  /** Whether the document scales down to its container. On unless `false`. */
  responsive?: boolean | undefined
}

/** `RenderOptions::default()`. */
export function renderOptionsDefault(): RenderOptions {
  return {
    autoDirection: undefined,
    directionBreakpoint: undefined,
    fontSize: undefined,
    idPrefix: undefined,
    imageSchemes: undefined,
    images: undefined,
    limit: undefined,
    linkRel: undefined,
    linkSchemes: undefined,
    links: undefined,
    maxEdges: undefined,
    maxWidth: undefined,
    now: undefined,
    outputLimit: undefined,
    padding: undefined,
    responsive: undefined,
  }
}

/** A diagram's accessible title and description. */
export type Accessible = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
}

/** `Accessible::default()`. */
export function accessibleDefault(): Accessible {
  return { accDescr: undefined, accTitle: undefined }
}

/** Whether `c` is an ASCII letter, digit, or `_`. */
function isAsciiWord(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 0x5f
}

/**
 * Moves the themed corner radius of each `<rect>` into its style. Browsers only lately take a
 * variable in the `rx` attribute, and all of them take one in a style. It goes first there, so a
 * radius the diagram's author set comes after it and wins. Also returns whether any moved.
 *
 * `radii` are the offsets of every radius in `content`, in order. Rust scans each `<rect>` tag
 * for one; this visits only the tags around them, and checks that the scan would have found the
 * same tags. Where it cannot tell, it scans as Rust does.
 */
function rounded(content: string, radii: number[]): [string, boolean] {
  // A tag only changes when it holds the radius, so without one the content is unchanged.
  if (radii.length === 0) return [content, false]

  const edit: Edit = { out: '', start: 0 }
  let moved = false
  // Where the scan for the next tag starts: 0, or just past a tag's `>`.
  let at = 0
  for (const radius of radii) {
    // A second radius in a tag already rewritten.
    if (radius < at) continue
    const tagStart = content.lastIndexOf('<rect', radius)
    // No tag from `at` on starts before the radius, so no tag the scan finds holds it.
    if (tagStart < at) continue
    // The scan reaches `tagStart` unless a `<rect` after the last `>` before it swallows it. A
    // `>` at or after `at - 1` always exists, as `at` follows one.
    const gt = content.lastIndexOf('>', tagStart - 1)
    if (gt + 1 < tagStart && content.slice(gt + 1, tagStart).includes('<rect')) return roundedSlow(content)
    const after = tagStart + 5
    // `\b` after `rect`: the next character is not a word character.
    if (after < content.length && isAsciiWord(content.charCodeAt(after))) continue
    const close = content.indexOf('>', after)
    // The radius has no `>`, so one that starts before the tag's `>` lies in the tag. No earlier
    // radius does, or it would have been rewritten with its tag.
    if (close < 0 || close < radius) continue
    pushRounded(edit, content, tagStart, close, radius)
    moved = true
    at = close + 1
  }
  return [edit.out + content.slice(edit.start), moved]
}

/**
 * {@link rounded} as Rust does it: every `<rect>` tag, in order, rewritten where it holds the
 * radius.
 */
function roundedSlow(content: string): [string, boolean] {
  const edit: Edit = { out: '', start: 0 }
  let moved = false
  let next = content.indexOf(ROUNDED)
  let at = 0
  for (let tagStart = content.indexOf('<rect', at); tagStart >= 0; tagStart = content.indexOf('<rect', at)) {
    const after = tagStart + 5
    // `\b` after `rect`: the next character is not a word character.
    const bounded = !(after < content.length && isAsciiWord(content.charCodeAt(after)))
    const close = content.indexOf('>', after)
    if (!bounded || close < 0) {
      at = tagStart + 1
      continue
    }
    at = close + 1
    if (next >= 0 && next < tagStart) next = content.indexOf(ROUNDED, tagStart)
    // No later tag holds the radius.
    if (next < 0) break
    // The radius has no `>`, so one that starts before the tag's `>` lies in the tag, and it is
    // the tag's first.
    if (next >= close) continue
    pushRounded(edit, content, tagStart, close, next)
    moved = true
  }
  return [edit.out + content.slice(edit.start), moved]
}

/** A rewrite of a string in progress: the output so far, and where the unwritten rest starts. */
type Edit = { out: string; start: number }

/** The characters of ` style="` that can end text joined to the rest of it. */
const STYLE_CHARS = ' style='

/**
 * Rewrites the `<rect>` tag from `tagStart` to its `>` at `close`, whose first themed radius is
 * at `radius`, with the radius moved into its style. Text before the tag that is not yet written
 * is written first.
 */
function pushRounded(edit: Edit, content: string, tagStart: number, close: number, radius: number): void {
  const cut = radius + ROUNDED.length
  // The tag's first ` style="`, which has no `>`, or `close` when it has none.
  const inTag = content.slice(tagStart, close).indexOf(' style="')
  const style = inTag < 0 ? close : tagStart + inTag
  if (style + 8 <= radius) {
    // A style before the radius: the tag up to its quote, the radius, the rest without it.
    edit.out += content.slice(edit.start, style + 8)
    edit.out += 'rx:var(--_r);'
    edit.out += content.slice(style + 8, radius)
    edit.start = cut
    return
  }
  // A style starts neither inside the radius nor across it. Without the radius, though, the text
  // before it could join the text after it into one.
  const joins = STYLE_CHARS.includes(content[radius - 1] as string)
  if (!joins && style < close) {
    // A style after the radius.
    edit.out += content.slice(edit.start, radius)
    edit.out += content.slice(cut, style + 8)
    edit.out += 'rx:var(--_r);'
    edit.start = style + 8
    return
  }
  if (!joins && cut < close) {
    // No style: one goes before the tag's `/>` or `>`.
    const end = content.charCodeAt(close - 1) === 0x2f ? close - 1 : close
    edit.out += content.slice(edit.start, radius)
    edit.out += content.slice(cut, end)
    edit.out += ' style="rx:var(--_r)"'
    edit.start = end
    return
  }
  edit.out += content.slice(edit.start, tagStart)
  edit.out += roundedTag(content.slice(tagStart, close + 1))
  edit.start = close + 1
}

/** One `<rect>` tag that holds the themed radius, with the radius moved into its style. */
function roundedTag(tag: string): string {
  const at = tag.indexOf(ROUNDED)
  const rest = tag.slice(0, at) + tag.slice(at + ROUNDED.length)
  const style = rest.indexOf(' style="')
  if (style >= 0) return rest.slice(0, style + 8) + 'rx:var(--_r);' + rest.slice(style + 8)

  const end = rest.endsWith('/>') ? rest.length - 2 : Math.max(rest.length - 1, 0)
  return rest.slice(0, end) + ' style="rx:var(--_r)"' + rest.slice(end)
}

/**
 * The weights of bold text, each set only in a diagram that has such text: the alias and the
 * name in its public variable.
 */
const WEIGHTS: readonly (readonly [string, string])[] = [
  ['--_tw', 'title'],
  ['--_hw', 'heading'],
  ['--_w', 'bold'],
]

/**
 * Wraps a diagram's content in the root `<svg>` document of the given size, with its theme,
 * font at `fontSize`, accessible title and description, and diagram `type` class.
 */
export function svgDocument(
  type: string,
  width: number,
  height: number,
  fontSize: number,
  options: RenderOptions,
  acc: Accessible,
  content: string,
): string {
  const prefix = esc(options.idPrefix ?? 'ondine')
  let head = ''
  let aria = ''
  const title = acc.accTitle
  if (title !== undefined && title !== '') {
    head += '<title id="'
    head += prefix
    head += '-title">'
    head += escText(title)
    head += '</title>'
    aria += ' aria-labelledby="'
    aria += prefix
    aria += '-title"'
  }
  const descr = acc.accDescr
  if (descr !== undefined && descr !== '') {
    head += '<desc id="'
    head += prefix
    head += '-desc">'
    head += escText(descr)
    head += '</desc>'
    aria += ' aria-describedby="'
    aria += prefix
    aria += '-desc"'
  }

  // One scan finds the themed radius and every alias the content reads: `var(--_r)` and the
  // weights' `var(--_tw)`, `var(--_hw)`, and `var(--_w)`.
  let radius = false
  const radii: number[] = []
  const used = [false, false, false]
  const back = ROUNDED.length - RADIUS.length - 1
  for (let at = content.indexOf('var(--'); at >= 0; at = content.indexOf('var(--', at + 6)) {
    const lead = content.charCodeAt(at + 6)
    if (lead !== 0x5f) {
      // The radius reads `var(--ondine-radius,0)`.
      if (lead === 0x6f && content.startsWith(ROUNDED, at - back)) radii.push(at - back)
      continue
    }
    const first = content.charCodeAt(at + 7)
    const second = content.charCodeAt(at + 8)
    if (second === 0x29) {
      // `r)` or `w)`.
      if (first === 0x72) radius = true
      else if (first === 0x77) used[2] = true
    } else if (second === 0x77 && content.charCodeAt(at + 9) === 0x29) {
      // `tw)` or `hw)`.
      if (first === 0x74) used[0] = true
      else if (first === 0x68) used[1] = true
    }
  }

  let body = content
  if (radii.length > 0) {
    const [roundedContent, moved] = rounded(content, radii)
    radius ||= moved
    body = roundedContent
  }

  let weights = ''
  if (radius) {
    weights += ';--_r:'
    weights += RADIUS
  }
  for (let i = 0; i < WEIGHTS.length; i++) {
    if (used[i]) {
      const [alias, name] = WEIGHTS[i] as readonly [string, string]
      weights += ';'
      weights += alias
      weights += ':var(--ondine-'
      weights += name
      weights += '-weight,bold)'
    }
  }

  const out: Buf = { s: '' }
  out.s += '<svg xmlns="http://www.w3.org/2000/svg" class="ondine ondine-'
  out.s += type
  out.s += '" viewBox="0 0 '
  pushNumber(out, width)
  out.s += ' '
  pushNumber(out, height)
  out.s += '" width="'
  pushNumber(out, width)
  out.s += '" height="'
  pushNumber(out, height)
  out.s += '" style="'
  if (options.responsive !== false) out.s += 'max-width:100%;height:auto;'
  out.s += ROOT_STYLE
  out.s += weights
  out.s += fontStyle(fontSize)
  out.s += '" fill="var(--_fg)" role="graphics-document document" aria-roledescription="'
  out.s += type
  out.s += '"'
  out.s += aria
  out.s += '>'
  out.s += head
  out.s += body
  out.s += '</svg>'
  return out.s
}
