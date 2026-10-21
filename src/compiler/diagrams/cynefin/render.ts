/**
 * @module Draws a Cynefin diagram: four quadrants and the central confusion ellipse with their
 * items, the boundaries between them, and transitions. Port of Pele's
 * `src/diagrams/cynefin/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { marker, markerTrim } from '../../svg/edges.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS, seriesColor } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { type Buf, fmax, fmin, midpoint } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'
import {
  FOLD,
  HORIZON,
  backward,
  cliff,
  curvePath,
  ellipsePath,
  forward,
  resolveSeed,
  wave,
} from './boundaries.ts'
import { type CynefinModel, cynefinModelItems } from './model.ts'

/** `[domain, column, row, series color]`, in drawing order. */
const QUADRANTS: readonly (readonly [string, number, number, number])[] = [
  ['complex', 0, 0, 0],
  ['complicated', 1, 0, 1],
  ['chaotic', 0, 1, 3],
  ['clear', 1, 1, 2],
]
/** The series color of the confusion ellipse. */
const CONFUSION_COLOR = 4

/** `[name, decision model, kind of practice]` of each domain. */
function meta(name: string): [string, string, string] {
  switch (name) {
    case 'complex':
      return ['Complex', 'Probe → Sense → Respond', 'Emergent Practices']
    case 'complicated':
      return ['Complicated', 'Sense → Analyse → Respond', 'Good Practices']
    case 'clear':
      return ['Clear', 'Sense → Categorise → Respond', 'Best Practices']
    case 'chaotic':
      return ['Chaotic', 'Act → Sense → Respond', 'Novel Practices']
    default:
      return ['Confusion', '', 'Disorder']
  }
}

/** The most confusion items drawn before a `+n more` badge. */
const MAX_CONFUSION_ITEMS = 3
/** The width at which item and transition labels wrap. */
const ITEM_MAX_WIDTH = 200
/** Horizontal padding inside a badge. */
const ITEM_PAD_X = 10
/** Vertical padding inside a badge. */
const ITEM_PAD_Y = 4
/** Space between badges. */
const ITEM_GAP = 6
/** Space between a heading and the first badge. */
const HEAD_GAP = 10
/** Space around a block inside its quadrant. */
const MARGIN = 20
/** Space between a block and the ellipse. */
const CLEARANCE = 10
/** Samples along a transition when finding where it leaves and enters blocks. */
const STEPS = 48

/** An item drawn as a badge. */
type Badge = {
  h: number
  label: Label
  overflow: boolean
  text: string
  w: number
}

/** A domain's heading and badges, centered on (`cx`, `cy`). */
type Block = {
  badges: Badge[]
  cx: number
  cy: number
  h: number
  name: string
  subtitles: Label[]
  title: Label
  w: number
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/**
 * The `cynefin` option `key` of `config` when it is a number from `min` to `max`, or
 * `fallback`.
 */
function setting(config: Value, key: string, fallback: number, min: number, max: number): number {
  const cynefin = property(config, 'cynefin')
  const value = cynefin === undefined ? undefined : property(cynefin, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= min && value._0 <= max) return value._0
  return fallback
}

/**
 * V8's `Math.hypot` for two values: a compensated sum of squares scaled by the larger value. It
 * differs from `f64::hypot` in the last bit.
 */
function hypot(x: number, y: number): number {
  x = Math.abs(x)
  y = Math.abs(y)
  if (x === Number.POSITIVE_INFINITY || y === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  const max = y > x ? y : x
  if (max === 0) return 0

  // The compensated sum over `x`, then `y`.
  const nx = x / max
  const sx = nx * nx
  const sum1 = 0 + sx
  const compensation = sum1 - 0 - sx
  const ny = y / max
  const sy = ny * ny - compensation
  const sum = sum1 + sy
  return Math.sqrt(sum) * max
}

/** `value || 1`. */
function orOne(value: number): number {
  return value === 0 || Number.isNaN(value) ? 1 : value
}

/** Appends `x,y`. */
function pushPair(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

/** Draws `model` with the `cynefin` section of `config`. */
export function render(model: CynefinModel, config: Value, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16
  const small = jsRound(size * 0.8125)
  const itemSize = jsRound(size * 0.875)
  const pad = options.padding ?? 8
  const cynefinSection = property(config, 'cynefin')
  const descriptions = cynefinSection === undefined ? undefined : property(cynefinSection, 'showDomainDescriptions')
  const showDescriptions = !(descriptions !== undefined && descriptions.kind === 'Bool' && descriptions._0 === false)
  const amplitude = setting(config, 'boundaryAmplitude', 8, 0, 50)
  // Pele seeds from its default prefix. Ondine keeps that seed, so the default boundaries match.
  const seed = resolveSeed(setting(config, 'seed', 0, -1e15, 1e15), options.idPrefix ?? 'pele')
  const itemLine = jsRound(itemSize * 1.5)

  const badge = (text: string, overflow: boolean): Badge => {
    const label = layoutLabel(text, false, itemSize, ITEM_MAX_WIDTH, 0, undefined)
    return {
      h: fmax(label.height, itemLine) + 2 * ITEM_PAD_Y,
      overflow,
      text,
      w: label.width + 2 * ITEM_PAD_X,
      label,
    }
  }

  const block = (name: string): Block => {
    const [heading, modelText, practice] = meta(name)
    const title = layoutLabel(heading, false, size, 4000, BOLD, undefined)
    const subtitles: Label[] = []
    if (showDescriptions) {
      for (const text of [modelText, practice]) {
        if (text !== '') subtitles.push(layoutLabel(text, false, small, 4000, ITALIC, undefined))
      }
    }
    const items = cynefinModelItems(model, name)
    const shown = name === 'confusion' && items.length > MAX_CONFUSION_ITEMS ? MAX_CONFUSION_ITEMS : items.length
    const badges: Badge[] = items.slice(0, shown).map((item) => badge(item, false))
    if (shown < items.length) {
      const text: Buf = { s: '+' }
      pushNumber(text, items.length - shown)
      text.s += ' more'
      badges.push(badge(text.s, true))
    }
    let w = title.width
    let h = title.height
    for (const s of subtitles) {
      w = fmax(w, s.width)
      h += s.height
    }
    if (badges.length > 0) h += HEAD_GAP - ITEM_GAP
    for (const b of badges) {
      w = fmax(w, b.w)
      h += ITEM_GAP + b.h
    }
    return { badges, cx: 0, cy: 0, h, name, subtitles, title, w }
  }

  const quadrants: Block[] = QUADRANTS.map(([name]) => block(name))
  const confusion = block('confusion')
  const rx = fmax(88, confusion.w * 0.71 + 8)
  const ry = fmax(64, confusion.h * 0.71 + 6)

  let quadW = setting(config, 'width', 640, 100, 10000) / 2
  let quadH = setting(config, 'height', 440, 100, 10000) / 2
  for (const b of quadrants) {
    quadW = fmax(quadW, b.w + 2 * MARGIN)
    quadH = fmax(quadH, b.h + 2 * MARGIN)
  }
  // A block sits in the middle of its quadrant, so its inner corner must stay clear of the
  // ellipse.
  for (const b of quadrants) {
    const dx = (quadW - b.w) / 2
    const dy = (quadH - b.h) / 2
    const ex = dx / (rx + CLEARANCE)
    const ey = dy / (ry + CLEARANCE)
    if (ex * ex + ey * ey >= 1) continue
    const wider = b.w + 2 * (rx + CLEARANCE)
    const taller = b.h + 2 * (ry + CLEARANCE)
    if (wider * quadH <= quadW * taller) quadW = fmax(quadW, wider)
    else quadH = fmax(quadH, taller)
  }

  const title = layoutLabel(model.title, false, size, 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0
  const width = 2 * quadW
  const height = 2 * quadH
  const x0 = pad
  const y0 = pad + titleHeight
  const cx = x0 + quadW
  const cy = y0 + quadH
  const right = x0 + width
  const bottom = y0 + height

  const fold = wave(y0, cy, cx, seed, amplitude, { ...FOLD, pinEnd: true, segments: 4 })
  const west = wave(x0, cx, cy, seed + 100, amplitude, { ...HORIZON, pinEnd: true, segments: 4 })
  const east = wave(cx, right, cy, seed + 200, amplitude, { ...HORIZON, pinStart: true, segments: 4 })
  const drop = cliff(cx, cy, bottom, width * 0.03)
  const at = (out: Buf, curve: number[], end: boolean): void => {
    const k = end ? Math.max(curve.length - 2, 0) : 0
    pushPair(out, curve[k] ?? 0, curve[k + 1] ?? 0)
  }

  const region = (name: string): string => {
    const d: Buf = { s: 'M' }
    switch (name) {
      case 'complex':
        pushPair(d, x0, y0)
        d.s += 'L'
        at(d, fold, false)
        forward(d, fold)
        backward(d, west)
        break
      case 'complicated':
        at(d, fold, false)
        d.s += 'L'
        pushPair(d, right, y0)
        d.s += 'L'
        at(d, east, true)
        backward(d, east)
        backward(d, fold)
        break
      case 'chaotic':
        at(d, west, false)
        forward(d, west)
        forward(d, drop)
        d.s += 'L'
        pushPair(d, x0, bottom)
        break
      default:
        at(d, east, false)
        forward(d, east)
        d.s += 'L'
        pushPair(d, right, bottom)
        d.s += 'L'
        at(d, drop, true)
        backward(d, drop)
    }
    d.s += 'Z'
    return d.s
  }

  let fills = ''
  for (const [name, , , color] of QUADRANTS) {
    fills += '<path class="ondine-cynefin-region" data-id="'
    fills += name
    fills += '" d="'
    fills += region(name)
    fills += '" fill="'
    fills += seriesColor(color)
    fills += '" fill-opacity="0.14"/>'
  }
  let boundaries =
    '<g class="ondine-cynefin-boundaries" fill="none" stroke="var(--_b)" stroke-dasharray="6 3">'
  for (const curve of [fold, west, east]) {
    boundaries += '<path d="'
    boundaries += curvePath(curve)
    boundaries += '"/>'
  }
  boundaries += '<path class="ondine-cynefin-cliff" d="'
  boundaries += curvePath(drop)
  boundaries +=
    '" stroke="var(--_l)" stroke-width="2" stroke-dasharray="none" stroke-linecap="round"/></g>'
  const oval = ellipsePath(cx, cy, rx, ry)
  let ellipse = '<path d="'
  ellipse += oval
  ellipse += '" fill="var(--_bg)"/><path class="ondine-cynefin-region" data-id="confusion" d="'
  ellipse += oval
  ellipse += '" fill="'
  ellipse += seriesColor(CONFUSION_COLOR)
  ellipse += '" fill-opacity="0.18" stroke="var(--_b)" stroke-dasharray="4 2"/>'

  const subtitleAttrs: Buf = { s: ' class="ondine-cynefin-subtitle" font-size="' }
  pushNumber(subtitleAttrs, small)
  subtitleAttrs.s += '" font-style="italic" fill="var(--_m)"'
  const itemAttrs: Buf = { s: ' class="ondine-label" font-size="' }
  pushNumber(itemAttrs, itemSize)
  itemAttrs.s += '"'
  const overflowAttrs = itemAttrs.s + ' fill="var(--_m)"'
  const drawBlock = (b: Block): string => {
    let y = b.cy - b.h / 2
    const out: Buf = {
      s: labelSvg(b.title, b.cx, y + b.title.height / 2, ' class="ondine-label" font-weight="var(--_hw)"', undefined),
    }
    y += b.title.height
    for (const s of b.subtitles) {
      out.s += labelSvg(s, b.cx, y + s.height / 2, subtitleAttrs.s, undefined)
      y += s.height
    }
    y += HEAD_GAP - ITEM_GAP
    for (const item of b.badges) {
      y += ITEM_GAP
      out.s += '<g class="ondine-node'
      if (item.overflow) {
        out.s += ' ondine-cynefin-overflow"'
      } else {
        out.s += '" data-id="'
        out.s += escText(item.text)
        out.s += '"'
      }
      out.s += `><rect x="${num(b.cx - item.w / 2)}" y="${num(y)}" width="${num(item.w)}" height="${num(item.h)}" rx="${RADIUS}" fill="var(--_bg)" stroke="var(--_b)"`
      if (item.overflow) out.s += ' stroke-dasharray="3 2"'
      out.s += '/>'
      out.s += labelSvg(item.label, b.cx, y + item.h / 2, item.overflow ? overflowAttrs : itemAttrs.s, undefined)
      out.s += '</g>'
      y += item.h
    }
    let group = '<g class="ondine-cynefin-domain" data-id="'
    group += b.name
    group += '">'
    group += out.s
    group += '</g>'
    return group
  }

  let domains = ''
  for (let q = 0; q < quadrants.length && q < QUADRANTS.length; q++) {
    const b = quadrants[q] as Block
    const [, col, row] = QUADRANTS[q] as readonly [string, number, number, number]
    b.cx = x0 + quadW * (col + 0.5)
    b.cy = y0 + quadH * (row + 0.5)
    domains += drawBlock(b)
  }
  confusion.cx = cx
  confusion.cy = cy
  domains += drawBlock(confusion)

  const find = (name: string): Block | undefined => {
    if (name === 'confusion') return confusion
    return quadrants.find((b) => b.name === name)
  }
  const inside = (b: Block, x: number, y: number): boolean => {
    if (b.name === 'confusion') {
      const ex = (x - cx) / (rx + 4)
      const ey = (y - cy) / (ry + 4)
      return ex * ex + ey * ey <= 1
    }
    return Math.abs(x - b.cx) <= b.w / 2 + 8 && Math.abs(y - b.cy) <= b.h / 2 + 8
  }

  const edges: Buf = { s: '' }
  const seen: [string, string, number][] = []
  for (const transition of model.transitions) {
    const from = find(transition.from)
    const to = find(transition.to)
    if (from === undefined || to === undefined) continue
    if (from.name === to.name) continue
    const key: [string, string] =
      transition.from < transition.to ? [transition.from, transition.to] : [transition.to, transition.from]
    let repeat: number
    const entry = seen.find(([a, b]) => a === key[0] && b === key[1])
    if (entry !== undefined) {
      entry[2] += 1
      repeat = entry[2] - 1
    } else {
      seen.push([key[0], key[1], 1])
      repeat = 0
    }

    const dx = to.cx - from.cx
    const dy = to.cy - from.cy
    const len = orOne(hypot(dx, dy))
    const mx = midpoint(from.cx, to.cx)
    const my = midpoint(from.cy, to.cy)
    // Curves bow away from the middle of the diagram, which keeps them off the ellipse.
    const outward = -dy * (mx - cx) + dx * (my - cy) >= 0 ? 1 : -1
    const nx = (-dy / len) * outward
    const ny = (dx / len) * outward
    // A diagonal runs through the middle, so it bows far enough to pass the ellipse.
    const diagonal = from.name !== 'confusion' && to.name !== 'confusion' && Math.abs(dx) > 1 && Math.abs(dy) > 1
    const bow = (diagonal ? 2 * (hypot(rx * nx, ry * ny) + 16) : len * 0.15) + repeat * 56
    const px = mx + nx * bow
    const py = my + ny * bow
    // The curve's point at `t`, coordinate by coordinate.
    const pointX = (t: number): number => {
      const u = 1 - t
      return u * u * from.cx + 2 * u * t * px + t * t * to.cx
    }
    const pointY = (t: number): number => {
      const u = 1 - t
      return u * u * from.cy + 2 * u * t * py + t * t * to.cy
    }
    const crossing = (b: Block, lo: number, hi: number, leaving: boolean): number => {
      for (let n = 0; n < 16; n++) {
        const mid = midpoint(lo, hi)
        if (inside(b, pointX(mid), pointY(mid)) === leaving) lo = mid
        else hi = mid
      }
      return midpoint(lo, hi)
    }
    let i = 1
    while (i <= STEPS && inside(from, pointX(i / STEPS), pointY(i / STEPS))) {
      i += 1
    }
    if (i > STEPS) continue
    const t0 = crossing(from, (i - 1) / STEPS, i / STEPS, true)
    while (i <= STEPS && !inside(to, pointX(i / STEPS), pointY(i / STEPS))) {
      i += 1
    }
    const t1 = i > STEPS ? 1 : crossing(to, (i - 1) / STEPS, i / STEPS, false)

    const sx = pointX(t0)
    const sy = pointY(t0)
    let ex = pointX(t1)
    let ey = pointY(t1)
    const blossom = (a: number, b: number, c: number): number =>
      (1 - t0) * (1 - t1) * a + ((1 - t0) * t1 + t0 * (1 - t1)) * b + t0 * t1 * c
    const qx = blossom(from.cx, px, to.cx)
    const qy = blossom(from.cy, py, to.cy)
    const el = orOne(hypot(ex - qx, ey - qy))
    const ux = (ex - qx) / el
    const uy = (ey - qy) / el
    const head = marker('arrow_point', ex, ey, ux, uy, 'var(--_l)')
    ex -= ux * markerTrim('arrow_point')
    ey -= uy * markerTrim('arrow_point')

    let text = ''
    if (transition.label !== undefined) {
      const label = layoutLabel(transition.label, false, small, ITEM_MAX_WIDTH, 0, undefined)
      const lmid = midpoint(t0, t1)
      const lx = pointX(lmid)
      const ly = pointY(lmid)
      const away = (Math.abs(nx) * label.width) / 2 + (Math.abs(ny) * label.height) / 2 + 6
      const half = label.width / 2 + 4
      const tx = fmin(fmax(lx + nx * away, x0 + half), fmax(right - half, x0 + half))
      const attrs: Buf = { s: ' class="ondine-edge-label" font-size="' }
      pushNumber(attrs, small)
      attrs.s += '"'
      text = labelSvg(label, tx, ly + ny * away, attrs.s, undefined)
    }
    edges.s += '<g class="ondine-edge" data-id="'
    edges.s += transition.from
    edges.s += '-'
    edges.s += transition.to
    edges.s += '"><path d="M'
    pushPair(edges, sx, sy)
    edges.s += 'Q'
    pushPair(edges, qx, qy)
    edges.s += ' '
    pushPair(edges, ex, ey)
    edges.s += '" fill="none" stroke="var(--_l)"/>'
    edges.s += head
    edges.s += text
    edges.s += '</g>'
  }

  const totalWidth = Math.ceil(fmax(width, title.width) + 2 * pad)
  const totalHeight = Math.ceil(height + titleHeight + 2 * pad)
  let content = labelSvg(
    title,
    x0 + width / 2,
    pad + title.height / 2,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += '<g class="ondine-cynefin-regions">'
  content += fills
  content += '</g>'
  content += boundaries
  content += ellipse
  content += domains
  if (edges.s !== '') {
    content += '<g class="ondine-edges">'
    content += edges.s
    content += '</g>'
  }

  const svg = svgDocument(
    'cynefin',
    totalWidth,
    totalHeight,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content,
  )
  return { height: totalHeight, links: [], svg, width: totalWidth }
}
