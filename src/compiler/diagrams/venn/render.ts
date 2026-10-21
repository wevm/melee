/** @module Draws a venn diagram. Port of Pele's `src/diagrams/venn/render.ts`. */
import { type VennDb, normalizeText } from './db.ts'
import { type Circle, type Spot, findSpot, hypot, layoutCircles, regionPath } from './layout.ts'
import type { Rendered } from '../../diagrams.ts'
import { escText, jsRound, labelSvg, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, accessibleDefault, svgDocument } from '../../svg/root.ts'
import { type ResolvedStyle, resolveStyle, resolvedStyleDefault, seriesColor } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { buf, fmax, fmin } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'

const RADIUS = 100.0
const MAX_GROWTH = 1.6

/** A line written in a region: its label first, then its texts. */
type Line = {
  base: number
  /** The id of a text, or `undefined` for the region's own label. */
  id: string | undefined
  label: Label
  raw: string
  size: number
}

/** A set or stated overlap, where it is written, and how it looks. */
type Region = {
  inside: number[]
  lines: Line[]
  sets: string[]
  spot: Spot
  style: ResolvedStyle
}

/** A key for a list of ids. */
function listKey(ids: readonly string[]): string {
  return JSON.stringify(ids)
}

/**
 * The declarations for each list of targets (by {@link listKey}), merged in insertion order,
 * later ones winning.
 */
type Styles = Map<string, [string, string][]>

function styleOf(styles: Styles, key: readonly string[]): ResolvedStyle {
  const declared = styles.get(listKey(key))
  if (declared === undefined) return resolvedStyleDefault()
  const list = declared.map(([property, value]) => `${property}:${value}`)
  return resolveStyle(list)
}

/** Draws a venn diagram. */
export function render(model: VennDb, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const tiny = jsRound(size * 0.8125)
  const pad = options.padding ?? 8.0

  const circles = layoutCircles(model.subsets)
  const index = new Map<string, number>()
  for (let i = 0; i < circles.length; i++) index.set((circles[i] as Circle).id, i)

  // Styles for the same targets add up, later declarations winning.
  const styles: Styles = new Map()
  for (const style of model.styles) {
    const key = listKey(style.targets)
    let merged = styles.get(key)
    if (merged === undefined) {
      merged = []
      styles.set(key, merged)
    }
    for (const [property, value] of style.styles) {
      const entry = merged.find(([own]) => own === property)
      if (entry !== undefined) entry[1] = value
      else merged.push([property, value])
    }
  }

  // Circles that touch each circle. Only those can cut into a region of it.
  const neighbors: number[][] = circles.map(() => [])
  for (let a = 0; a < circles.length; a++) {
    const ca = circles[a] as Circle
    for (let b = a + 1; b < circles.length; b++) {
      const cb = circles[b] as Circle
      if (hypot(ca.x - cb.x, ca.y - cb.y) < ca.r + cb.r) {
        neighbors[a]?.push(b)
        neighbors[b]?.push(a)
      }
    }
  }
  const radius = (i: number): number => circles[i]?.r ?? 0.0

  // One region for each set and each stated overlap. A later statement about the same sets
  // replaces an earlier one.
  const stated: number[] = []
  const statedAt = new Map<string, number>()
  const keys: string[] = []
  for (let i = 0; i < model.subsets.length; i++) {
    const key = listKey(model.subsets[i]?.sets ?? [])
    keys.push(key)
    const at = statedAt.get(key)
    if (at !== undefined) stated[at] = i
    else {
      statedAt.set(key, stated.length)
      stated.push(i)
    }
  }
  const regions: Region[] = []
  const regionAt = new Map<string, number>()
  // The regions of single sets, by the set's id: the entries of `regionAt` with one id.
  const singleAt = new Map<string, number>()
  for (const i of stated) {
    const subset = model.subsets[i]
    if (subset === undefined) continue
    const seen = new Set<string>()
    const sets = subset.sets.filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    const inside = sets.map((id) => index.get(id) ?? 0)
    let smallest = inside[0] ?? 0
    for (const i of inside) if (radius(i) < radius(smallest)) smallest = i
    const style = styleOf(styles, subset.sets)
    const only = subset.sets.length === 1 ? subset.sets[0] : undefined
    const text = subset.label ?? only
    const base = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0)
    const outside = (neighbors[smallest] ?? []).filter((i) => !inside.includes(i))
    let spot = findSpot(circles, inside, outside)
    // A region that other circles cover, or all but cover, is written across them instead.
    if (spot.margin < radius(smallest) * 0.2) spot = findSpot(circles, inside, [])
    const lines: Line[] = []
    if (text !== undefined && text !== '') {
      const fontSize = sets.length === 1 ? size : small
      lines.push({
        base,
        id: undefined,
        label: layoutLabel(text, false, fontSize, 4000.0, base, undefined),
        raw: text,
        size: fontSize,
      })
    }
    regionAt.set(keys[i] as string, regions.length)
    if (subset.sets.length === 1) singleAt.set(subset.sets[0] as string, regions.length)
    regions.push({ inside, lines, sets, spot, style })
  }
  for (const node of model.textNodes) {
    const raw = node.label ?? node.id
    const at = regionAt.get(listKey(node.sets))
    const region = at === undefined ? undefined : regions[at]
    if (region !== undefined) {
      region.lines.push({
        base: 0,
        id: node.id,
        label: layoutLabel(raw, false, tiny, 4000.0, 0, undefined),
        raw,
        size: tiny,
      })
    }
  }

  // Lengths so far are in units of the layout. The scale gives the largest circle a set radius,
  // and grows, within limits, until every region holds what is written in it.
  let largest = 0.0
  for (const c of circles) if (c.r > largest) largest = c.r
  let scale = largest > 0.0 ? RADIUS / largest : 1.0
  let growth = 1.0
  for (const region of regions) {
    if (region.spot.margin <= 0.0) continue
    let width = 0.0
    let height = 0.0
    for (const line of region.lines) {
      width = fmax(width, line.label.width)
      height += line.label.height
    }
    const need = hypot(width, height) / 2.0 + 4.0
    growth = fmax(growth, fmin(need / (region.spot.margin * scale), MAX_GROWTH))
  }
  scale *= growth

  // What is still too wide for its region is wrapped to it.
  for (const region of regions) {
    const room = fmax(region.spot.margin * scale * 1.8, 72.0)
    for (const line of region.lines) {
      if (line.label.width > room) {
        line.label = layoutLabel(line.raw, false, line.size, room, line.base, undefined)
      }
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const c of circles) {
    minX = fmin(minX, (c.x - c.r) * scale)
    minY = fmin(minY, (c.y - c.r) * scale)
    maxX = fmax(maxX, (c.x + c.r) * scale)
    maxY = fmax(maxY, (c.y + c.r) * scale)
  }
  for (const region of regions) {
    let wide = 0.0
    let tall = 0.0
    for (const line of region.lines) {
      wide = fmax(wide, line.label.width)
      tall += line.label.height
    }
    minX = fmin(minX, region.spot.x * scale - wide / 2.0)
    maxX = fmax(maxX, region.spot.x * scale + wide / 2.0)
    minY = fmin(minY, region.spot.y * scale - tall / 2.0)
    maxY = fmax(maxY, region.spot.y * scale + tall / 2.0)
  }
  if (circles.length === 0) {
    minX = 0.0
    minY = 0.0
    maxX = 0.0
    maxY = 0.0
  }

  const title = layoutLabel(
    model.title === undefined ? undefined : normalizeText(model.title),
    false,
    size,
    4000.0,
    BOLD,
    undefined,
  )
  const titleHeight = title.height > 0.0 ? title.height + 12.0 : 0.0
  const inner = fmax(maxX - minX, title.width)
  const ox = pad + (inner - (maxX - minX)) / 2.0 - minX
  const oy = pad + titleHeight - minY
  const width = Math.ceil(inner + 2.0 * pad)
  const height = Math.ceil(maxY - minY + titleHeight + 2.0 * pad)
  const placed: Circle[] = circles.map((c) => ({
    id: c.id,
    r: c.r * scale,
    x: c.x * scale + ox,
    y: c.y * scale + oy,
  }))

  const sets = buf()
  for (let i = 0; i < placed.length; i++) {
    const c = placed[i] as Circle
    const color = seriesColor(i)
    const at = singleAt.get(c.id)
    const region = at === undefined ? undefined : regions[at]
    const style = region === undefined ? '' : region.style.shape
    sets.s += '<circle class="ondine-venn-set" data-id="'
    sets.s += escText(c.id)
    sets.s += '" cx="'
    pushNum(sets, c.x)
    sets.s += '" cy="'
    pushNum(sets, c.y)
    sets.s += '" r="'
    pushNum(sets, c.r)
    sets.s += '" fill="'
    sets.s += color
    sets.s += '" fill-opacity="0.2" stroke="'
    sets.s += color
    sets.s += '"'
    sets.s += style
    sets.s += '/>'
  }

  let overlaps = ''
  let labels = ''
  for (const region of regions) {
    const id = escText(region.sets.join('|'))
    // An overlap is only drawn when a style gives it a look of its own. Otherwise the circles show
    // it.
    if (region.sets.length > 1 && region.style.shape !== '') {
      const shared: Circle[] = []
      for (const i of region.inside) {
        const c = placed[i]
        if (c !== undefined) shared.push({ ...c })
      }
      const d = regionPath(shared)
      if (d !== '') {
        overlaps += '<path class="ondine-venn-overlap" data-id="'
        overlaps += id
        overlaps += '" d="'
        overlaps += d
        overlaps += '" fill="none"'
        overlaps += region.style.shape
        overlaps += '/>'
      }
    }
    let total = 0.0
    for (const line of region.lines) total += line.label.height
    if (total === 0.0) continue
    const x = region.spot.x * scale + ox
    let y = region.spot.y * scale + oy - total / 2.0
    let content = ''
    for (const line of region.lines) {
      const attrs = buf()
      if (line.id === undefined) {
        attrs.s += ' class="ondine-label"'
        if (line.size !== size) {
          attrs.s += ' font-size="'
          pushNumber(attrs, line.size)
          attrs.s += '"'
        }
        attrs.s += region.style.text
      } else {
        attrs.s += ' class="ondine-venn-text" data-id="'
        attrs.s += escText(line.id)
        attrs.s += '" font-size="'
        pushNumber(attrs, tiny)
        attrs.s += '" fill="var(--_m)"'
        attrs.s += styleOf(styles, [line.id]).text
      }
      content += labelSvg(line.label, x, y + line.label.height / 2.0, attrs.s, undefined)
      y += line.label.height
    }
    labels += '<g class="ondine-venn-region" data-id="'
    labels += id
    labels += '">'
    labels += content
    labels += '</g>'
  }

  let content = labelSvg(
    title,
    width / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += '<g class="ondine-venn-sets">'
  content += sets.s
  content += '</g>'
  if (overlaps !== '') {
    content += '<g class="ondine-venn-overlaps">'
    content += overlaps
    content += '</g>'
  }
  if (labels !== '') {
    content += '<g class="ondine-venn-labels">'
    content += labels
    content += '</g>'
  }

  const svg = svgDocument('venn', width, height, size, options, accessibleDefault(), content)
  return { height, links: [], svg, width }
}
