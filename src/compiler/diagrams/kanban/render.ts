/**
 * @module Draws a kanban board: columns of cards, folded into rows when the host is narrow. Port
 * of Pele's `src/diagrams/kanban/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { titleRoom } from '../common/fit_width.ts'
import { iconSvg } from '../common/icon.ts'
import { esc, escText, jsRound, labelSvg, num, textStyle } from '../../svg/builder.ts'
import { type RenderOptions, accessibleDefault, svgDocument } from '../../svg/root.ts'
import { CRITICAL, ROUNDED, classNames } from '../../svg/theme.ts'
import { type IconResolver, iconMarkup } from '../../text/icons.ts'
import { type Label, type Span, layoutLabel, trim } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD } from '../../text/measure.ts'
import { type LinkInfo, type UrlOptions, linkUrl, relAttr, safeUrl } from '../../util/url.ts'
import { type Value, pushNumber } from '../../yaml.ts'
import { asUint, buf, clamp, fmax, fmin } from '../../util/rust.ts'
import type { KanbanDb, KanbanNode } from './db.ts'

const COLUMN_GAP = 12.0
const COLUMN_PAD = 8.0
const CARD_PAD = 10.0
const CARD_GAP = 8.0
const META_GAP = 4.0
const ICON_GAP = 6.0

/**
 * Mermaid names five priorities and gives Medium no color. Matching here ignores case. The high
 * ones are marked in the critical color and the low ones in the muted one, the nearer to Medium
 * the fainter. They are not series colors, as a theme may put those in any order.
 */
function priorityAttrs(priority: string): string | undefined {
  switch (priority) {
    case 'very high':
      return 'stroke="' + CRITICAL + '"'
    case 'high':
      return 'stroke="' + CRITICAL + '" opacity="0.5"'
    case 'low':
      return 'stroke="var(--_m)" opacity="0.5"'
    case 'very low':
      return 'stroke="var(--_m)"'
    default:
      return undefined
  }
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

/** {@link pushNumber} of `value`, as a string. */
function numberText(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

/** Whether `name` is an icon the host has. */
function hasIcon(name: string | undefined, icons: IconResolver | undefined): boolean {
  return name !== undefined && name !== '' && iconMarkup(icons, name) !== ''
}

/** `text` lowercased as JavaScript's `toLowerCase` does it, outside the final-sigma rule. */
function lower(text: string): string {
  let out = ''
  for (const c of text) out += c.toLowerCase()
  return out
}

/**
 * Lays out text for a fixed width. A word too long for a line is broken between characters,
 * because a card cannot grow sideways to hold it.
 */
function fitLabel(raw: string | undefined, markdown: boolean, size: number, max: number, base: number): Label {
  const label = layoutLabel(raw, markdown, size, max, base, undefined)
  if (label.width <= max) return label

  const lines: Span[][] = []
  const widths: number[] = []
  let widest = 0.0
  let line: Span[] = []
  let width = 0.0
  const count = Math.min(label.lines.length, label.widths.length)
  for (let k = 0; k < count; k++) {
    const own = label.lines[k]!
    const ownWidth = label.widths[k]!
    if (ownWidth <= max) {
      lines.push(own.slice())
      line = []
      widths.push(ownWidth)
      widest = fmax(widest, ownWidth)
      width = 0.0
      continue
    }
    for (let j = 0; j < own.length; j++) {
      const span = own[j]!
      if (span.icon !== undefined) {
        if (width > 0.0 && width + span.width > max) {
          lines.push(line)
          line = []
          widths.push(width)
          widest = fmax(widest, width)
          width = 0.0
        }
        line.push(span)
        width += span.width
        continue
      }
      let text = ''
      let from = width
      for (const ch of span.text) {
        const w = measure.width(ch, size, span.style)
        if (width > 0.0 && width + w > max) {
          if (text !== '') {
            line.push({ icon: undefined, style: span.style, text, width: width - from })
            text = ''
          }
          lines.push(line)
          line = []
          widths.push(width)
          widest = fmax(widest, width)
          width = 0.0
          from = 0.0
        }
        text += ch
        width += w
      }
      if (text !== '') {
        line.push({ icon: undefined, style: span.style, text, width: width - from })
      }
    }
    lines.push(line)
    line = []
    widths.push(width)
    widest = fmax(widest, width)
    width = 0.0
  }
  return {
    height: lines.length * label.lineHeight,
    lineHeight: label.lineHeight,
    lines,
    size: label.size,
    width: widest,
    widths,
  }
}

/**
 * Writes a label with every line starting at `x`, or ending there when `end`, and the first
 * line's box starting at `y`.
 */
function textBlock(
  label: Label,
  x: number,
  y: number,
  attrs: string,
  icons: IconResolver | undefined,
  end: boolean,
): string {
  let out = ''
  let cy = y + 0.5 * label.lineHeight
  const lines = label.lines
  const widths = label.widths
  const count = Math.min(lines.length, widths.length)
  const shift = label.size * 0.35
  let xs: string | undefined
  for (let k = 0; k < count; k++) {
    const line = lines[k]!
    const span = line.length === 1 ? line[0]! : undefined
    if (span !== undefined && span.icon === undefined) {
      if (xs === undefined) xs = num(x)
      out += `<text${textStyle(attrs, span.style)} x="${xs}" y="${num(cy + shift)}"${end ? ' text-anchor="end">' : '>'}${esc(span.text)}</text>`
    } else {
      const width = widths[k]!
      const one: Label = {
        height: label.lineHeight,
        lineHeight: label.lineHeight,
        lines: [line.slice()],
        size: label.size,
        width,
        widths: [width],
      }
      const half = end ? -width : width
      out += labelSvg(one, x + half / 2.0, cy, attrs, icons)
    }
    cy += label.lineHeight
  }
  return out
}

/** A card's laid-out text. */
type Card = {
  assigned: Label
  height: number
  item: KanbanNode
  label: Label
  /** Height of the rows under the text that hold the ticket and the assignee. */
  meta: number
  ticket: Label
}

/** Draws `model` with the `kanban` section of `config`. */
export function render(
  model: KanbanDb,
  config: Value,
  options: RenderOptions,
  url: UrlOptions,
  icons: IconResolver | undefined,
): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const line = jsRound(size * 1.5)
  const smallLine = jsRound(small * 1.5)
  const pad = options.padding ?? 8.0
  const conf = property(config, 'kanban')
  const sectionWidth = conf === undefined ? undefined : property(conf, 'sectionWidth')
  const ownWidth =
    sectionWidth !== undefined && sectionWidth.kind === 'Number' && sectionWidth._0 > 0.0
      ? clamp(sectionWidth._0, 80.0, 2000.0)
      : 200.0
  // A board wider than the width the host has is folded into rows of columns, which then share
  // the row between them.
  const maxWidth = options.maxWidth
  const room = maxWidth !== undefined && maxWidth > 0.0 ? maxWidth - 2.0 * pad : Number.POSITIVE_INFINITY
  const sections = model.sections
  const count = sections.length
  const fits = count * (ownWidth + COLUMN_GAP) - COLUMN_GAP <= room
  const perRow = fits ? fmax(count, 1.0) : fmax(1.0, Math.floor((room + COLUMN_GAP) / (ownWidth + COLUMN_GAP)))
  const columnWidth = fits
    ? ownWidth
    : fmax(fmin(ownWidth, room), fmin(Math.floor((room + COLUMN_GAP) / perRow) - COLUMN_GAP, ownWidth * 2.0))
  const ticketBaseUrl = conf === undefined ? undefined : property(conf, 'ticketBaseUrl')
  const baseUrl = ticketBaseUrl !== undefined && ticketBaseUrl.kind === 'String' ? ticketBaseUrl._0 : ''
  const cardWidth = columnWidth - 2.0 * COLUMN_PAD
  const textWidth = cardWidth - 2.0 * CARD_PAD
  const glyph = small * 1.25
  const links: LinkInfo[] = []

  const titles: Label[] = []
  const countWidths: number[] = []
  const cards: Card[][] = []
  let headHeight = line
  const bodyHeights: number[] = []
  for (let index = 0; index < count; index++) {
    const section = sections[index]!
    const countWidth = measure.width(numberText(section.items.length), small, 0)
    const reserved = countWidth + 12.0 + (hasIcon(section.node.icon, icons) ? glyph + ICON_GAP : 0.0)
    const title = fitLabel(section.node.label, true, size, cardWidth - 8.0 - reserved, BOLD)
    headHeight = fmax(headHeight, title.height)
    countWidths.push(countWidth)
    titles.push(title)

    const list: Card[] = []
    let height = 0.0
    const items = section.items
    for (let k = 0; k < items.length; k++) {
      const item = items[k]!
      const iconRoom = hasIcon(item.icon, icons) ? glyph + ICON_GAP : 0.0
      const label = fitLabel(item.label, true, small, textWidth - iconRoom, 0)
      const ticket = fitLabel(item.ticket, false, small, textWidth, 0)
      const assigned = fitLabel(item.assigned, false, small, textWidth, 0)
      const meta =
        ticket.width + assigned.width + 8.0 > textWidth
          ? ticket.height + assigned.height
          : fmax(ticket.height, assigned.height)
      const cardHeight = 2.0 * CARD_PAD + fmax(label.height, smallLine) + (meta === 0.0 ? 0.0 : META_GAP + meta)
      list.push({ assigned, height: cardHeight, item, label, meta, ticket })
      height += cardHeight + CARD_GAP
    }
    cards.push(list)
    bodyHeights.push(height)
  }
  headHeight += 2.0 * COLUMN_PAD

  // `perRow` is a whole number of at least one.
  const perRowCount = Math.max(asUint(perRow), 1)
  const rowHeights: number[] = []
  const rowTops: number[] = []
  let y = 0.0
  for (let start = 0; start < bodyHeights.length; start += perRowCount) {
    let tallest = CARD_GAP
    const stop = Math.min(start + perRowCount, bodyHeights.length)
    for (let k = start; k < stop; k++) tallest = fmax(tallest, bodyHeights[k]!)
    rowTops.push(y)
    rowHeights.push(headHeight + tallest)
    y += headHeight + tallest + COLUMN_GAP
  }
  const rows = rowTops.length
  const boardHeight = rows > 0 ? rowTops[rows - 1]! + rowHeights[rows - 1]! : 0.0

  const title = layoutLabel(model.title, false, size, titleRoom(options), BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 16.0 : 0.0
  const boardWidth = fmax(fmin(count, perRow) * (columnWidth + COLUMN_GAP) - COLUMN_GAP, 0.0)
  const width = fmax(boardWidth, title.width)
  const left = pad + (width - boardWidth) / 2.0
  const edge = columnWidth - COLUMN_PAD - 4.0

  // Text that is the same in every column and on every card.
  const columnText = numberText(columnWidth)
  const countHead = `<text class="ondine-count" x="${numberText(edge)}" y="${num(COLUMN_PAD + line / 2.0 + small * 0.35)}" text-anchor="end" font-size="${numberText(small)}" fill="var(--_m)">`
  const cardRect = `<rect width="${numberText(cardWidth)}" height="`
  const cardTail = `)" font-size="${numberText(small)}">`
  const cardX = numberText(COLUMN_PAD)
  // `String.prototype.replace` with a string pattern replaces the first match only.
  const ticketAt = baseUrl.indexOf('#TICKET#')

  let out = ''
  for (let index = 0; index < count; index++) {
    const section = sections[index]!
    const row = Math.trunc(index / perRowCount)
    const rowHeight = rowHeights[row] ?? 0.0
    let body = `<rect width="${columnText}" height="${num(rowHeight)}"${ROUNDED} fill="var(--_s)"/>`
    body += textBlock(
      titles[index]!,
      COLUMN_PAD + 4.0,
      COLUMN_PAD,
      ' class="ondine-cluster-label" font-weight="var(--_hw)"',
      icons,
      false,
    )
    body += `${countHead}${numberText(section.items.length)}</text>`
    const sectionIcon = section.node.icon
    if (sectionIcon !== undefined && hasIcon(sectionIcon, icons)) {
      body += iconSvg(
        sectionIcon,
        edge - countWidths[index]! - ICON_GAP - glyph,
        COLUMN_PAD + (line - glyph) / 2.0,
        glyph,
        icons,
      )
    }

    let cy = headHeight
    const list = cards[index]!
    for (let k = 0; k < list.length; k++) {
      const card = list[k]!
      const item = card.item
      const priority = item.priority === undefined ? '' : lower(trim(item.priority))
      const color = priority === '' ? undefined : priorityAttrs(priority)
      let inner = `${cardRect}${num(card.height)}"${ROUNDED} fill="var(--_bg)" stroke="var(--_b)"/>`
      if (color !== undefined) {
        inner += `<path class="ondine-priority" d="M2.5,5V${num(card.height - 5.0)}" fill="none" ${color} stroke-width="3" stroke-linecap="round"/>`
      }
      inner += textBlock(card.label, CARD_PAD, CARD_PAD, ' class="ondine-label"', icons, false)
      const icon = item.icon
      if (icon !== undefined && hasIcon(icon, icons)) {
        inner += iconSvg(icon, cardWidth - CARD_PAD - glyph, CARD_PAD + (smallLine - glyph) / 2.0, glyph, icons)
      }
      const bottom = card.height - CARD_PAD
      const ticket = item.ticket
      if (ticket !== undefined && ticket !== '') {
        const top = bottom - card.meta
        const href =
          baseUrl === ''
            ? undefined
            : linkUrl(
                safeUrl(ticketAt < 0 ? baseUrl : baseUrl.slice(0, ticketAt) + ticket + baseUrl.slice(ticketAt + 8)),
                url,
              )
        if (href !== undefined) {
          inner += `<a href="${esc(href)}" target="_blank"${relAttr(url)}>${textBlock(
            card.ticket,
            CARD_PAD,
            top,
            ' class="ondine-ticket" fill="var(--_c)"',
            icons,
            false,
          )}</a>`
          links.push({ href, id: item.id, internal: false })
        } else {
          inner += textBlock(card.ticket, CARD_PAD, top, ' class="ondine-ticket" fill="var(--_m)"', icons, false)
        }
      }
      if (item.assigned !== undefined && item.assigned !== '') {
        inner += textBlock(
          card.assigned,
          cardWidth - CARD_PAD,
          bottom - card.assigned.height,
          ' class="ondine-assigned" fill="var(--_m)"',
          icons,
          true,
        )
      }
      // `replace(' ', '-')` replaces the first space only.
      body += `<g class="ondine-node ondine-card${color !== undefined ? ' ondine-priority-' + priority.replace(' ', '-') : ''}${classNames(item.cssClasses ?? '')}" data-id="${escText(item.id)}" transform="translate(${cardX},${num(cy)}${cardTail}${inner}</g>`
      cy += card.height + CARD_GAP
    }

    out += `<g class="ondine-cluster ondine-column${classNames(section.node.cssClasses ?? '')}" data-id="${escText(section.node.id)}" transform="translate(${num(left + (index % perRowCount) * (columnWidth + COLUMN_GAP))},${num(pad + titleHeight + (rowTops[row] ?? 0.0))})">${body}</g>`
  }

  const totalWidth = Math.ceil(width + 2.0 * pad)
  const totalHeight = Math.ceil(boardHeight + titleHeight + 2.0 * pad)
  const content =
    labelSvg(title, totalWidth / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined) +
    out

  return {
    height: totalHeight,
    links,
    svg: svgDocument('kanban', totalWidth, totalHeight, size, options, accessibleDefault(), content),
    width: totalWidth,
  }
}
