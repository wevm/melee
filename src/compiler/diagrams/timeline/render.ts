/**
 * @module Draws a timeline: periods along an axis with their events, grouped by section, across or
 * running down. Port of Pele's `src/diagrams/timeline/render.ts`.
 */
import type { TimelineDb, TimelinePeriod } from './db.ts'
import type { Rendered } from '../../diagrams.ts'
import { fitLabel, plainLabel } from '../common/fit.ts'
import { turnToFit } from '../common/fit_width.ts'
import { escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { ARROW, marker } from '../../svg/edges.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { ROUNDED, seriesColor } from '../../svg/theme.ts'
import { type Label, trim } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { buf, fmax, fmin } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

const PAD_X = 12.0
const PAD_Y = 8.0
const MIN_TEXT = 152.0
const MAX_TEXT = 216.0
const EVENT_TEXT_TD = 264.0
const GAP = 20.0
const AXIS = 20.0
const SPINE = 14.0
const EVENT_GAP = 8.0
const SECTION_GAP = 8.0
const TAIL = 12.0
const ON_COLOR = ' fill="var(--_bg)"'
const LINE = ' fill="none" stroke="var(--_b)"'

/** A section, or the periods before the first one, with its periods' indexes. */
type Group = {
  periods: number[]
  /** The section's index, or `undefined` for the periods before the first section. */
  section: number | undefined
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  const entries = value._0
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k]!
    if (entry[0] === key) return entry[1]
  }
  return undefined
}

/** The series color of a section or period index. */
function series(index: number): string {
  return seriesColor(index)
}

/** A box with the themed corner radius. */
function box(x: number, y: number, w: number, h: number, attrs: string): string {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${ROUNDED}${attrs}/>`
}

/** A period's dot on the axis. */
function dot(x: number, y: number, color: string): string {
  return `<circle class="ondine-dot" cx="${num(x)}" cy="${num(y)}" r="4" fill="${color}" stroke="var(--_bg)" stroke-width="2"/>`
}

/** Lays out `raw`, cut to fit when `fit`. */
function label(fit: boolean, raw: string | undefined, size: number, max: number): Label {
  return fit ? fitLabel(raw, size, max, 0) : plainLabel(raw, size, max, 0)
}

/** The periods' labels, then each period's events' labels. */
function layoutPeriods(periods: readonly TimelinePeriod[], fit: boolean, size: number, max: number): Label[] {
  const out: Label[] = []
  for (let i = 0; i < periods.length; i++) out.push(label(fit, periods[i]!.text, size, max))
  return out
}

/** Each period's events' labels. */
function layoutEvents(periods: readonly TimelinePeriod[], fit: boolean, size: number, max: number): Label[][] {
  const out: Label[][] = []
  for (let i = 0; i < periods.length; i++) {
    const events = periods[i]!.events
    const labels: Label[] = []
    for (let k = 0; k < events.length; k++) labels.push(label(fit, events[k]!, size, max))
    out.push(labels)
  }
  return out
}

/** The color of a period in `section`. */
function colorOf(section: number | undefined, hasSections: boolean, multicolor: boolean, period: number): string {
  if (section !== undefined) return series(section)
  if (hasSections) return 'var(--_m)'
  return series(multicolor ? period : 0)
}

/** The opening of a section's group, when it is a section. */
function openSection(model: TimelineDb, group: Group): string {
  if (group.section === undefined) return ''
  const name = model.sections[group.section]
  return name === undefined ? '' : `<g class="ondine-cluster ondine-section" data-id="${escText(trim(name))}">`
}

/**
 * Draws `model` with the `timeline` section of `config`. A `TD` timeline always runs down;
 * another runs down when across does not fit.
 */
export function render(model: TimelineDb, config: Value, options: RenderOptions): Rendered {
  if (model.direction === 'TD') return draw(model, config, options, true)
  return turnToFit(options, (down) => draw(model, config, options, down))
}

function draw(model: TimelineDb, config: Value, options: RenderOptions, vertical: boolean): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8.0
  const conf = property(config, 'timeline')
  const disable = conf === undefined ? undefined : property(conf, 'disableMulticolor')
  const multicolor = !(disable !== undefined && disable.kind === 'Bool' && disable._0 === true)
  const periods = model.periods
  const hasSections = model.sections.length > 0

  // Mermaid draws nothing for periods that come before the first section; here they lead, in a
  // neutral color.
  const groups: Group[] = []
  for (let section = 0; section < model.sections.length; section++) groups.push({ periods: [], section })
  const leading: Group = { periods: [], section: undefined }
  for (let i = 0; i < periods.length; i++) {
    const at = periods[i]!.sectionIndex
    const group = (at >= 0 ? groups[at] : undefined) ?? leading
    group.periods.push(i)
  }
  if (leading.periods.length > 0) groups.unshift(leading)

  // Columns widen, up to a point, for a word that would not fit; past that the word is cut.
  // Running down, the two columns share the width the host has.
  const maxWidth = options.maxWidth
  const room = maxWidth !== undefined && vertical && maxWidth > 0.0 ? maxWidth - 2.0 * pad : Number.POSITIVE_INFINITY
  const taken = AXIS + SPINE * 2.0 + 4.0 * PAD_X
  const periodText = fmin(MIN_TEXT, fmax(80.0, jsRound((room - taken) * 0.38)))
  const eventText = fmin(EVENT_TEXT_TD, fmax(110.0, room - taken - periodText))
  let textW = periodText
  let periodLabels = layoutPeriods(periods, false, size, textW)
  let eventLabels = layoutEvents(periods, false, small, vertical ? eventText : textW)
  let widest = 0.0
  for (let i = 0; i < periodLabels.length; i++) widest = fmax(widest, periodLabels[i]!.width)
  let overflow = false
  for (let i = 0; i < eventLabels.length; i++) {
    const labels = eventLabels[i]!
    for (let k = 0; k < labels.length; k++) {
      const w = labels[k]!.width
      if (!vertical) widest = fmax(widest, w)
      else if (w > eventText) overflow = true
    }
  }
  overflow = widest > textW || overflow
  if (overflow) {
    const cap = room === Number.POSITIVE_INFINITY ? MAX_TEXT : periodText
    textW = fmin(fmax(Math.ceil(widest), periodText), cap)
    periodLabels = layoutPeriods(periods, true, size, textW)
    eventLabels = layoutEvents(periods, true, small, vertical ? eventText : textW)
  }

  const lineHeight = jsRound(size * 1.5)
  const smallLine = jsRound(small * 1.5)
  const colW = textW + 2.0 * PAD_X
  const eventW = (vertical ? eventText : textW) + 2.0 * PAD_X

  let hasEvents = false
  for (let i = 0; i < eventLabels.length; i++) {
    if (eventLabels[i]!.length > 0) {
      hasEvents = true
      break
    }
  }
  let slots = 0
  for (let g = 0; g < groups.length; g++) slots += Math.max(groups[g]!.periods.length, 1)

  const pitch = colW + GAP
  const drawn = periods.length > 0
  let bodyW: number
  if (vertical) {
    bodyW = colW + (hasEvents ? AXIS + SPINE * 2.0 + eventW : drawn ? AXIS + TAIL : 0.0)
  } else if (slots > 0) {
    bodyW = slots * pitch - GAP + (drawn ? TAIL + ARROW : 0.0)
  } else {
    bodyW = 0.0
  }
  const title = fitLabel(model.title, size, fmax(bodyW, 320.0), BOLD)
  const titleH = title.height > 0.0 ? title.height + 16.0 : 0.0
  const width = fmax(bodyW, title.width)
  const left = pad + (width - bodyW) / 2.0
  const top = pad + titleH

  const fontSizeBuf = buf(' font-size="')
  pushNumber(fontSizeBuf, small)
  fontSizeBuf.s += '"'
  const fontSize = fontSizeBuf.s

  let body = ''
  let height: number

  if (vertical) {
    const axisX = left + colW + AXIS
    const spineX = axisX + SPINE
    const eventsX = spineX + SPINE
    const axisText = num(axisX)
    const spineText = num(spineX)
    const eventsText = num(eventsX)
    let y = top
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!
      body += openSection(model, group)
      if (group.section !== undefined) {
        const label = fitLabel(model.sections[group.section], size, bodyW - 2.0 * PAD_X, BOLD)
        const h = fmax(label.height, lineHeight) + 2.0 * PAD_Y
        body += box(left, y, bodyW, h, ' fill="' + series(group.section) + '"')
        body += labelSvg(label, left + bodyW / 2.0, y + h / 2.0, ' font-weight="var(--_hw)"' + ON_COLOR, undefined)
        y += h + SECTION_GAP + 4.0
      }
      const list = group.periods
      for (let k = 0; k < list.length; k++) {
        const i = list[k]!
        const color = colorOf(group.section, hasSections, multicolor, i)
        const periodLabel = periodLabels[i]
        const h = periodLabel === undefined ? 0.0 : fmax(periodLabel.height, lineHeight) + 2.0 * PAD_Y
        const cy = y + h / 2.0
        const cyText = num(cy)
        let d = `M${num(left + colW)},${cyText}H${axisText}`
        let cards = ''
        let ey = y
        let last = cy
        const events = eventLabels[i] ?? []
        const tint = ' fill="' + color + '" fill-opacity="0.16"'
        for (let e = 0; e < events.length; e++) {
          const label = events[e]!
          const eh = fmax(label.height, smallLine) + 2.0 * PAD_Y
          last = ey + eh / 2.0
          d += `M${spineText},${num(last)}H${eventsText}`
          cards += `<g class="ondine-node ondine-event">${box(eventsX, ey, eventW, eh, tint)}${labelSvg(label, eventsX + eventW / 2.0, ey + eh / 2.0, fontSize, undefined)}</g>`
          ey += eh + EVENT_GAP
        }
        if (cards !== '') {
          d += `M${axisText},${cyText}H${spineText}V${num(last)}`
        }
        body += `<g class="ondine-node ondine-period" data-id="${escText(trim(periods[i]?.text ?? ''))}">${box(left, y, colW, h, ' fill="' + color + '"')}`
        if (periodLabel !== undefined) {
          body += labelSvg(periodLabel, left + colW / 2.0, y + h / 2.0, ON_COLOR, undefined)
        }
        body += `<path class="ondine-edge" d="${d}"${LINE}/>${dot(axisX, cy, color)}${cards}</g>`
        y = fmax(y + h, ey - EVENT_GAP) + GAP
      }
      if (list.length === 0) y += GAP - SECTION_GAP - 4.0
      if (group.section !== undefined) body += '</g>'
    }
    if (groups.length > 0) y -= GAP
    if (drawn) {
      const tip = y + TAIL + ARROW
      body = `<path class="ondine-axis" d="M${axisText},${num(top)}V${num(tip - ARROW + 1.0)}" fill="none" stroke="var(--_l)"/>${marker('arrow_point', axisX, tip, 0.0, 1.0, 'var(--_l)')}${body}`
      y = tip
    }
    height = y + pad
  } else {
    let headerH = 0.0
    const sectionLabels: (Label | undefined)[] = []
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!
      if (group.section === undefined) {
        sectionLabels.push(undefined)
        continue
      }
      const span = Math.max(group.periods.length, 1)
      const label = fitLabel(model.sections[group.section], size, span * pitch - GAP - 2.0 * PAD_X, BOLD)
      headerH = fmax(headerH, fmax(label.height, lineHeight) + 2.0 * PAD_Y)
      sectionLabels.push(label)
    }
    let chipH = 0.0
    for (let i = 0; i < periodLabels.length; i++) {
      chipH = fmax(chipH, fmax(periodLabels[i]!.height, lineHeight) + 2.0 * PAD_Y)
    }
    const periodsY = top + (hasSections ? headerH + SECTION_GAP : 0.0)
    const axisY = periodsY + chipH + (chipH > 0.0 ? AXIS : 0.0)
    const eventsY = axisY + AXIS
    const stemTop = num(periodsY + chipH)
    let bottom = drawn ? axisY + TAIL : top + headerH
    let slot = 0
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!
      const label = sectionLabels[g]
      const span = Math.max(group.periods.length, 1)
      const gx = left + slot * pitch
      body += openSection(model, group)
      if (label !== undefined && group.section !== undefined) {
        const w = span * pitch - GAP
        body += box(gx, top, w, headerH, ' fill="' + series(group.section) + '"')
        body += labelSvg(label, gx + w / 2.0, top + headerH / 2.0, ' font-weight="var(--_hw)"' + ON_COLOR, undefined)
      }
      const list = group.periods
      for (let k = 0; k < list.length; k++) {
        const i = list[k]!
        const color = colorOf(group.section, hasSections, multicolor, i)
        const x = gx + k * pitch
        const cx = x + colW / 2.0
        const cxText = num(cx)
        const events = eventLabels[i] ?? []
        const tint = ' fill="' + color + '" fill-opacity="0.16"'
        let d = `M${cxText},${stemTop}V${num(events.length === 0 ? axisY : eventsY)}`
        let cards = ''
        let ey = eventsY
        for (let e = 0; e < events.length; e++) {
          const label = events[e]!
          const eh = fmax(label.height, smallLine) + 2.0 * PAD_Y
          if (ey > eventsY) {
            d += `M${cxText},${num(ey - EVENT_GAP)}V${num(ey)}`
          }
          cards += `<g class="ondine-node ondine-event">${box(x, ey, eventW, eh, tint)}${labelSvg(label, x + eventW / 2.0, ey + eh / 2.0, fontSize, undefined)}</g>`
          ey += eh + EVENT_GAP
        }
        bottom = fmax(bottom, ey - EVENT_GAP)
        body += `<g class="ondine-node ondine-period" data-id="${escText(trim(periods[i]?.text ?? ''))}">${box(x, periodsY, colW, chipH, ' fill="' + color + '"')}`
        const periodLabel = periodLabels[i]
        if (periodLabel !== undefined) {
          body += labelSvg(periodLabel, x + colW / 2.0, periodsY + chipH / 2.0, ON_COLOR, undefined)
        }
        body += `<path class="ondine-edge" d="${d}"${LINE}/>${dot(cx, axisY, color)}${cards}</g>`
      }
      if (group.section !== undefined) body += '</g>'
      slot += span
    }
    if (drawn) {
      const tip = left + bodyW
      body = `<path class="ondine-axis" d="M${num(left)},${num(axisY)}H${num(tip - ARROW + 1.0)}" fill="none" stroke="var(--_l)"/>${marker('arrow_point', tip, axisY, 1.0, 0.0, 'var(--_l)')}${body}`
    }
    height = bottom + pad
  }

  const totalWidth = Math.ceil(width + 2.0 * pad)
  const totalHeight = Math.ceil(fmax(height, pad * 2.0))
  const content =
    labelSvg(title, totalWidth / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined) +
    body
  return {
    height: totalHeight,
    links: [],
    svg: svgDocument(
      'timeline',
      totalWidth,
      totalHeight,
      size,
      options,
      { accDescr: model.accDescr, accTitle: model.accTitle },
      content,
    ),
    width: totalWidth,
  }
}
