/**
 * @module Draws an event model: frames as boxes in swimlanes with time running across, or as cards
 * running down when that fits the host better. Port of Pele's
 * `src/diagrams/eventmodeling/render.ts`.
 */
import { type EmBox, EntityKind, type EventModelingModel, entityKindAsStr } from './model.ts'
import type { Rendered } from '../../diagrams.ts'
import { turnToFit } from '../common/fit_width.ts'
import { breakLabel, leftLabelSvg, literalLabel } from '../common/literal_label.ts'
import { esc, escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { marker, markerTrim } from '../../svg/edges.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { FONT_MONO, RADIUS, seriesColor } from '../../svg/theme.ts'
import { decode } from '../../text/entities.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD, MONO } from '../../text/measure.ts'
import { buf, fmax, fmin, midpoint, saturatingSub } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'

/** The series slot of each kind of entity. A UI has none and is drawn plain. */
function series(kind: EntityKind): number | undefined {
  switch (kind) {
    case EntityKind.Command:
      return 0
    case EntityKind.Event:
      return 1
    case EntityKind.Readmodel:
      return 2
    case EntityKind.Processor:
      return 6
    case EntityKind.Ui:
      return undefined
  }
}

/** Space inside a box beside its text. */
const BOX_PAD_X = 12.0
/** Space inside a box above and below its text. */
const BOX_PAD_Y = 10.0
/** The narrowest box. */
const BOX_MIN_WIDTH = 96.0
/** Space between boxes in one lane. */
const BOX_GAP = 16.0
/** How far a box in a new lane may start before the end of the box before it. */
const STAGGER = 80.0
/** Space inside a lane around its boxes. */
const LANE_PAD = 12.0
/** Space between lanes. */
const LANE_GAP = 8.0
/** The widest line of a box's data, in characters. */
const DATA_COLUMNS = 48
/** The widest line of a note or specification, in characters. */
const NOTE_COLUMNS = 80
/** Space between cards. */
const CARD_GAP = 8.0
/** Space between rails beside the cards when running down. */
const RAIL_GAP = 8.0
/** The narrowest card when running down. */
const CARD_MIN = 120.0
/** Room a lane heading leaves for an arrow passing beside it. */
const ARROW_ROOM = 20.0

/** Splits text into lines of at most `columns` UTF-16 units, keeping its own line breaks. */
function hardWrap(text: string, columns: number): string[] {
  const decoded = decode(text)
  if (decoded.length <= columns && !decoded.includes('\n')) return [decoded]
  const out: string[] = []
  for (const line of decoded.split('\n')) {
    const units = line.length
    if (units <= columns) {
      out.push(line)
      continue
    }

    // ponytail: a character split by a column boundary goes whole to the earlier line,
    // where Pele splits its UTF-16 pair. Rows and widths match; the text differs only there.
    const rows = out.length + Math.ceil(units / columns)
    let piece = ''
    let at = 0
    let next = columns
    for (const c of line) {
      if (at >= next) {
        out.push(piece)
        piece = ''
        next += columns
      }
      piece += c
      at += c.length
    }
    out.push(piece)
    if (out.length > rows) out.length = rows
    while (out.length < rows) out.push('')
  }
  return out
}

/** One `<text>` with a `<tspan>` per non-empty row, `step` apart from `y` down. */
function lines(rows: string[], x: number, y: number, step: number, attrs: string): string {
  let body = ''
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row === '') continue
    body += `<tspan x="${num(x)}" y="${num(y + i * step)}">${esc(row)}</tspan>`
  }
  if (body === '') return body
  return `<text${attrs} xml:space="preserve">${body}</text>`
}

/** The text of each line of `label`. */
function labelRows(label: Label): string[] {
  return label.lines.map((spans) => spans.map((span) => span.text).join(''))
}

/** The widest of `rows` at `size`. */
function widest(rows: string[], size: number, style: number): number {
  let width = 0.0
  for (const row of rows) width = fmax(width, measure.width(row, size, style))
  return width
}

/** ` font-size="{size}"`, with the size as JavaScript writes a number. */
function fontSize(size: number): string {
  const out = buf(' font-size="')
  pushNumber(out, size)
  out.s += '"'
  return out.s
}

/** The heading of a note or specification card. */
function cardHeading(model: EventModelingModel, heading: string, frame: string): string {
  let text = heading
  text += ' · '
  text += frame
  for (let i = model.boxes.length - 1; i >= 0; i--) {
    const found = model.boxes[i]!
    if (found.id === frame) {
      text += ' '
      text += found.name
      break
    }
  }
  return text
}

/** The rows of a specification card, before wrapping. */
function specificationRows(given: string[], when: string[], then: string[]): string[] {
  const row = (head: string, names: string[]): string => head + names.join(', ')
  const rows = [row('Given  ', given)]
  if (when.length > 0) rows.push(row('When  ', when))
  rows.push(row('Then  ', then))
  return rows
}

/** The `class` and `data-id` of a box's group, and its opening tag. */
function boxOpen(item: EmBox): string {
  const reset = item.reset ? ' ondine-em-reset' : ''
  return `<g class="ondine-node ondine-em-${entityKindAsStr(item.kind)}${reset}" data-id="${escText(item.id)}">`
}

/** A box's frame attributes: position, size, and corner radius. */
function frameAttrs(x: number, y: number, w: number, h: number): string {
  return `x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${RADIUS}"`
}

/** A rectangle in a series color, over the box's background. */
function seriesRect(frame: string, slot: number): string {
  const color = seriesColor(slot)
  return `<rect ${frame} fill="${color}" fill-opacity="0.22" stroke="${color}"/>`
}

/** An edge's group: its path and arrowhead. */
function edge(model: EventModelingModel, relation: [number, number], d: string, head: string): string {
  const from = escText(model.boxes[relation[0]]?.id ?? '')
  const to = escText(model.boxes[relation[1]]?.id ?? '')
  return `<g class="ondine-edge" data-id="${from}-${to}"><path d="${d}" fill="none" stroke="var(--_l)"/>${head}</g>`
}

/** `M{x},{y}`. */
function move(x: number, y: number): string {
  return `M${num(x)},${num(y)}`
}

/** Draws `model`, running down when across does not fit the host. */
export function render(model: EventModelingModel, options: RenderOptions): Rendered {
  return turnToFit(options, (down) => (down ? vertical(model, options) : horizontal(model, options)))
}

/** The document around drawn content. */
function document(
  model: EventModelingModel,
  options: RenderOptions,
  width: number,
  height: number,
  size: number,
  content: string,
): Rendered {
  return {
    height,
    links: [],
    svg: svgDocument(
      'eventmodeling',
      width,
      height,
      size,
      options,
      { accDescr: model.accDescr, accTitle: model.accTitle },
      content,
    ),
    width,
  }
}

/** A box placed in its lane. */
type Placed = {
  /** Wrapped data lines. */
  data: string[]
  /** Height. */
  h: number
  /** The name, laid out. */
  name: Label
  /** Width. */
  w: number
  /** Left edge. */
  x: number
  /** Top edge. */
  y: number
}

/** A lane's band across the drawing. */
type Band = {
  /** Height. */
  h: number
  /** The heading, laid out. */
  label: Label
  /** Where the last box in the lane ends. */
  right: number
  /** Top edge. */
  y: number
}

/** Draws `model` with time running across and one band per lane. */
function horizontal(model: EventModelingModel, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16.0
  const nameSize = jsRound(size * 0.875)
  const small = jsRound(size * 0.8125)
  const mono = jsRound(size * 0.75)
  const monoStep = jsRound(mono * 1.4)
  const smallStep = jsRound(small * 1.5)
  const pad = options.padding ?? 8.0

  const bands: Band[] = []
  let labelColumn = 0.0
  for (const lane of model.lanes) {
    const label = layoutLabel(lane.label, false, small, 4000.0, BOLD, undefined)
    labelColumn = fmax(labelColumn, label.width)
    bands.push({ h: 0.0, label, right: Number.NEGATIVE_INFINITY, y: 0.0 })
  }
  labelColumn += 2.0 * LANE_PAD

  // Time runs left to right. A frame in a new lane starts under the end of the one before it,
  // so the arrow between them can drop straight down; a frame in the same lane follows on.
  const placed: Placed[] = []
  let previous: number | undefined
  for (const item of model.boxes) {
    const name = layoutLabel(item.name, false, nameSize, 4000.0, BOLD, undefined)
    const data = item.data !== undefined && item.data !== '' ? hardWrap(item.data, DATA_COLUMNS) : []
    const w = fmax(BOX_MIN_WIDTH, fmax(name.width, widest(data, mono, MONO)) + 2.0 * BOX_PAD_X)
    const h = 2.0 * BOX_PAD_Y + name.height + (data.length === 0 ? 0.0 : 6.0 + data.length * monoStep)
    const right = bands[item.lane]?.right ?? Number.NEGATIVE_INFINITY
    let x: number
    const before = previous === undefined ? undefined : placed[previous]
    const beforeBox = previous === undefined ? undefined : model.boxes[previous]
    if (before === undefined || beforeBox === undefined) {
      x = 0.0
    } else {
      const stagger = before.x + fmax(before.w / 2.0, before.w - STAGGER)
      x = beforeBox.lane === item.lane ? right + BOX_GAP : fmax(stagger, right + BOX_GAP)
    }
    const band = bands[item.lane]
    if (band !== undefined) {
      band.right = x + w
      band.h = fmax(band.h, h)
    }
    previous = placed.length
    placed.push({ data, h, name, w, x, y: 0.0 })
  }

  let contentRight = 0.0
  for (const item of placed) contentRight = fmax(contentRight, item.x + item.w)
  const laneWidth = labelColumn + contentRight + LANE_PAD

  const title = layoutLabel(model.title, false, size, 4000.0, BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 12.0 : 0.0
  const left = pad
  const top = pad + titleHeight

  let y = top
  let lanes = ''
  const attrs = ' class="ondine-cluster-label"' + fontSize(small) + ' font-weight="var(--_hw)" fill="var(--_m)"'
  for (let i = 0; i < bands.length && i < model.lanes.length; i++) {
    const band = bands[i]!
    const lane = model.lanes[i]!
    band.y = y
    band.h += 2.0 * LANE_PAD
    const heading = labelSvg(band.label, left + LANE_PAD + band.label.width / 2.0, y + band.h / 2.0, attrs, undefined)
    lanes += `<g class="ondine-cluster ondine-em-lane" data-id="${escText(lane.label)}"><rect x="${num(left)}" y="${num(y)}" width="${num(laneWidth)}" height="${num(band.h)}" rx="${RADIUS}" fill="var(--_s)"/>${heading}</g>`
    y += band.h + LANE_GAP
  }
  let bottom = bands.length === 0 ? top : y - LANE_GAP

  let nodes = ''
  const nameAttrs = ' class="ondine-label"' + fontSize(nameSize) + ' font-weight="var(--_hw)"'
  const dataAttrs = ' class="ondine-em-data" font-family="' + FONT_MONO + '"' + fontSize(mono)
  for (let i = 0; i < placed.length && i < model.boxes.length; i++) {
    const item = placed[i]!
    const info = model.boxes[i]!
    const band = bands[info.lane]
    if (band === undefined) continue
    item.x += left + labelColumn
    item.y = band.y + (band.h - item.h) / 2.0
    const frame = frameAttrs(item.x, item.y, item.w, item.h)
    nodes += boxOpen(info)
    nodes += '<rect '
    nodes += frame
    const slot = series(info.kind)
    if (slot === undefined) {
      nodes += ' fill="var(--_bg)" stroke="var(--_b)"/>'
    } else {
      nodes += ' fill="var(--_bg)"/>'
      nodes += seriesRect(frame, slot)
    }
    const nameY = item.y + BOX_PAD_Y + item.name.height / 2.0
    nodes += labelSvg(item.name, item.x + item.w / 2.0, nameY, nameAttrs, undefined)
    nodes += lines(
      item.data,
      item.x + BOX_PAD_X,
      item.y + BOX_PAD_Y + item.name.height + 6.0 + monoStep / 2.0 + mono * 0.35,
      monoStep,
      dataAttrs,
    )
    nodes += '</g>'
  }

  let edges = ''
  const trim = markerTrim('arrow_point')
  for (const relation of model.relations) {
    const s = placed[relation[0]]
    const t = placed[relation[1]]
    if (s === undefined || t === undefined) continue
    if (relation[0] === relation[1]) continue
    const sameLane = model.boxes[relation[0]]?.lane === model.boxes[relation[1]]?.lane
    let d: string
    let head: string
    if (sameLane) {
      // Along the lane, from the side of one box to the side of the other.
      const forward = t.x >= s.x
      const sx = forward ? s.x + s.w : s.x
      const tx = forward ? t.x : t.x + t.w
      const sy = s.y + s.h / 2.0
      const ty = t.y + t.h / 2.0
      const dir = tx >= sx ? 1.0 : -1.0
      d = `M${num(sx)},${num(sy)}L${num(tx - dir * trim)},${num(ty)}`
      head = marker('arrow_point', tx, ty, dir, 0.0, 'var(--_l)')
    } else {
      // Between lanes, straight down or up where the boxes overlap, else in an S.
      const down = t.y > s.y
      const from = fmax(s.x, t.x)
      const to = fmin(s.x + s.w, t.x + t.w)
      const inset = (w: number): number => fmin(24.0, w / 4.0)
      const overlap = to - from >= 16.0
      const sx = overlap ? midpoint(from, to) : t.x > s.x ? s.x + s.w - inset(s.w) : s.x + inset(s.w)
      const tx = overlap ? sx : t.x > s.x ? t.x + inset(t.w) : t.x + t.w - inset(t.w)
      const sy = down ? s.y + s.h : s.y
      const ty = down ? t.y : t.y + t.h
      const dir = down ? 1.0 : -1.0
      const end = ty - dir * trim
      const mid = midpoint(sy, end)
      if (sx === tx) {
        d = `M${num(sx)},${num(sy)}V${num(end)}`
      } else {
        d = `M${num(sx)},${num(sy)}C${num(sx)},${num(mid)} ${num(tx)},${num(mid)} ${num(tx)},${num(end)}`
      }
      head = marker('arrow_point', tx, ty, 0.0, dir, 'var(--_l)')
    }
    edges += edge(model, relation, d, head)
  }

  // Notes and given/when/then specifications, listed under the lanes with the frame they
  // belong to.
  let cards = ''
  let cardsRight = 0.0
  const smallAttrs = fontSize(small) + ' font-weight="var(--_hw)"'
  const rowAttrs = fontSize(small)
  const card = (kind: string, heading: string, frame: string, rows: string[]): void => {
    const head = layoutLabel(cardHeading(model, heading, frame), false, small, 4000.0, BOLD, undefined)
    const w = fmax(head.width, widest(rows, small, 0)) + 2.0 * BOX_PAD_X
    const h = 2.0 * BOX_PAD_Y + head.height + rows.length * smallStep
    const cy = bottom + (cards === '' && bands.length === 0 ? 0.0 : CARD_GAP)
    cards += `<g class="ondine-em-${kind}" data-id="${escText(frame)}"><rect x="${num(left)}" y="${num(cy)}" width="${num(w)}" height="${num(h)}" rx="${RADIUS}" fill="var(--_bg)" stroke="var(--_b)"/>`
    cards += labelSvg(head, left + BOX_PAD_X + head.width / 2.0, cy + BOX_PAD_Y + head.height / 2.0, smallAttrs, undefined)
    cards += lines(
      rows,
      left + BOX_PAD_X,
      cy + BOX_PAD_Y + head.height + smallStep / 2.0 + small * 0.35,
      smallStep,
      rowAttrs,
    )
    cards += '</g>'
    bottom = cy + h
    cardsRight = fmax(cardsRight, w)
  }
  for (const note of model.notes) card('note', 'Note', note.frame, hardWrap(note.text, NOTE_COLUMNS))
  for (const spec of model.specifications) {
    const rows = specificationRows(spec.given, spec.when, spec.then).flatMap((row) => hardWrap(row, NOTE_COLUMNS))
    card('specification', 'Given / When / Then', spec.frame, rows)
  }

  const width = fmax(fmax(bands.length === 0 ? 0.0 : laneWidth, cardsRight), title.width)
  const totalWidth = Math.ceil(width + 2.0 * pad)
  const totalHeight = Math.ceil(bottom + pad)
  let content = labelSvg(
    title,
    totalWidth / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += lanes
  content += edges
  content += nodes
  content += cards
  return document(model, options, totalWidth, totalHeight, size, content)
}

/** A card placed when running down. */
type Card = {
  /** Height. */
  h: number
  /** The card's position in frame order. */
  index: number
  /** The width of its lane heading. */
  lane: number
  /** Width. */
  w: number
  /** Top edge. */
  y: number
}

/** Draws `model` as cards running down, with relations that skip cards on rails beside them. */
function vertical(model: EventModelingModel, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const mono = jsRound(size * 0.75)
  const pad = options.padding ?? 8.0
  const room = fmax(160.0, (options.maxWidth ?? 320.0) - 2.0 * pad)

  // A relation that skips a card runs down a rail beside the cards. Relations into one card
  // share a rail; others whose runs overlap take the next rail out, so that no two follow the
  // same line.
  const runs: [number, [number, number]][] = []
  // A relation between neighbouring cards passes the lower card's lane heading.
  const passed: boolean[] = new Array(model.boxes.length).fill(false)
  for (const [s, t] of model.relations) {
    if (s === t || s >= model.boxes.length || t >= model.boxes.length) continue
    if (Math.abs(s - t) < 2) {
      const at = Math.max(s, t)
      if (at < passed.length) passed[at] = true
      continue
    }
    const found = runs.find(([target]) => target === t)
    if (found !== undefined) {
      const run = found[1]
      run[0] = Math.min(run[0], s)
      run[1] = Math.max(run[1], s)
    } else {
      runs.push([t, [Math.min(s, t), Math.max(s, t)]])
    }
  }
  runs.sort((a, b) => a[1][0] - b[1][0])
  const railOf: [number, number][] = []
  const railEnds: number[] = []
  for (const [target, [from, to]] of runs) {
    let rail = railEnds.findIndex((end) => end < from)
    if (rail < 0) rail = railEnds.length
    if (rail < railEnds.length) railEnds[rail] = to
    else railEnds.push(to)
    railOf.push([target, rail])
  }
  const gutter = 24.0 + RAIL_GAP * saturatingSub(railEnds.length, 1)
  // Rails are never shared to save room: past what the width allows, the drawing is wider.
  const cardWidth = fmax(CARD_MIN, room - gutter)
  const textRoom = cardWidth - 2.0 * BOX_PAD_X
  const title = layoutLabel(model.title, false, size, room, BOLD, undefined)
  let y = pad + (title.height > 0.0 ? title.height + 12.0 : 0.0)
  let bottom = pad + title.height
  let width = fmax(title.width, cardWidth + gutter)
  let nodes = ''
  let edges = ''
  let cards = ''
  const placed: Card[] = []
  const text = (raw: string, size: number, style: number): Label => literalLabel(decode(raw), size, textRoom, style)

  const laneAttrs = ' class="ondine-cluster-label"' + fontSize(small) + ' font-weight="var(--_hw)" fill="var(--_m)"'
  const nameAttrs = ' class="ondine-label"' + fontSize(small) + ' font-weight="var(--_hw)"'
  const monoSize = fontSize(mono)
  const dataAttrs = ' class="ondine-em-data" font-family="' + FONT_MONO + '"' + monoSize
  for (let index = 0; index < model.boxes.length; index++) {
    const item = model.boxes[index]!
    const laneLabel = model.lanes[item.lane]?.label ?? ''
    const laneRoom = (passed[index] ?? false) ? textRoom - ARROW_ROOM : textRoom
    const lane = breakLabel(layoutLabel(laneLabel, false, small, laneRoom, BOLD, undefined), laneRoom)
    const name = layoutLabel(item.name, false, small, textRoom - 36.0, BOLD, undefined)
    const data = item.data !== undefined && item.data !== '' ? text(item.data, mono, MONO) : undefined
    const w = fmax(
      fmax(fmax(cardWidth, lane.width + 2.0 * BOX_PAD_X), name.width + 2.0 * BOX_PAD_X + 36.0),
      (data === undefined ? 0.0 : data.width) + 2.0 * BOX_PAD_X,
    )
    const headH = lane.height + 12.0
    const h = 2.0 * BOX_PAD_Y + name.height + (data === undefined ? 0.0 : data.height + 6.0)
    const cy = y + headH
    const frame = frameAttrs(pad, cy, w, h)
    nodes += '<g class="ondine-cluster ondine-em-lane" data-id="'
    nodes += escText(laneLabel)
    nodes += '">'
    nodes += leftLabelSvg(lane, pad + BOX_PAD_X, y, laneAttrs)
    nodes += boxOpen(item)
    nodes += '<rect '
    nodes += frame
    nodes += ' fill="var(--_bg)" stroke="var(--_b)"/>'
    const slot = series(item.kind)
    if (slot !== undefined) nodes += seriesRect(frame, slot)
    nodes += labelSvg(name, pad + BOX_PAD_X + name.width / 2.0, cy + BOX_PAD_Y + name.height / 2.0, nameAttrs, undefined)
    nodes += `<text class="ondine-em-frame" x="${num(pad + w - BOX_PAD_X)}" y="${num(cy + BOX_PAD_Y + small)}" text-anchor="end"${monoSize} fill="var(--_m)">${esc(item.id)}</text>`
    if (data !== undefined) {
      nodes += lines(
        labelRows(data),
        pad + BOX_PAD_X,
        cy + BOX_PAD_Y + name.height + 6.0 + data.lineHeight / 2.0 + mono * 0.35,
        data.lineHeight,
        dataAttrs,
      )
    }
    nodes += '</g></g>'
    placed.push({ h, index, lane: lane.width, w, y: cy })
    width = fmax(width, w + gutter)
    bottom = cy + h
    y = bottom + 28.0
  }

  const trim = markerTrim('arrow_point')
  for (const relation of model.relations) {
    const s = placed[relation[0]]
    const t = placed[relation[1]]
    if (s === undefined || t === undefined) continue
    if (relation[0] === relation[1]) continue
    const down = t.y > s.y
    const dir = down ? 1.0 : -1.0
    const sy = down ? s.y + s.h : s.y
    const ty = down ? t.y : t.y + t.h
    let d = ''
    let head: string
    if (Math.abs(s.index - t.index) === 1) {
      // The lower card's lane heading sits in the gap, and wraps to leave the arrow room
      // beside it.
      const lower = down ? t : s
      const cx = pad + fmax(fmin(s.w, t.w) / 2.0, BOX_PAD_X + lower.lane + 16.0)
      d += move(cx, sy)
      d += 'V'
      d += num(ty - dir * trim)
      head = marker('arrow_point', cx, ty, 0.0, dir, 'var(--_l)')
    } else {
      const slot = railOf.find(([target]) => target === relation[1])?.[1] ?? 0
      const rail = pad + width - gutter + 12.0 + RAIL_GAP * slot
      // A card can send one relation and receive another: they leave above and arrive
      // below its middle.
      const from = s.y + s.h / 2.0 - 5.0
      const to = t.y + t.h / 2.0 + 5.0
      d += move(pad + s.w, from)
      d += 'H'
      d += num(rail)
      d += 'V'
      d += num(to)
      d += 'H'
      d += num(pad + t.w + trim)
      head = marker('arrow_point', pad + t.w, to, -1.0, 0.0, 'var(--_l)')
    }
    edges += edge(model, relation, d, head)
  }

  const headAttrs = fontSize(small) + ' font-weight="var(--_hw)"'
  const rowAttrs = fontSize(small)
  const card = (kind: string, heading: string, frame: string, raw: string): void => {
    const head = layoutLabel(cardHeading(model, heading, frame), false, small, textRoom, BOLD, undefined)
    const body = text(raw, small, 0)
    const w = fmax(fmax(cardWidth, head.width + 2.0 * BOX_PAD_X), body.width + 2.0 * BOX_PAD_X)
    const h = 2.0 * BOX_PAD_Y + head.height + body.height
    cards += `<g class="ondine-em-${kind}" data-id="${escText(frame)}"><rect x="${num(pad)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${RADIUS}" fill="var(--_bg)" stroke="var(--_b)"/>`
    cards += labelSvg(head, pad + BOX_PAD_X + head.width / 2.0, y + BOX_PAD_Y + head.height / 2.0, headAttrs, undefined)
    cards += lines(
      labelRows(body),
      pad + BOX_PAD_X,
      y + BOX_PAD_Y + head.height + body.lineHeight / 2.0 + small * 0.35,
      body.lineHeight,
      rowAttrs,
    )
    cards += '</g>'
    bottom = y + h
    y = bottom + CARD_GAP
    width = fmax(width, w)
  }
  for (const note of model.notes) card('note', 'Note', note.frame, note.text)
  for (const spec of model.specifications) {
    card(
      'specification',
      'Given / When / Then',
      spec.frame,
      specificationRows(spec.given, spec.when, spec.then).join('\n'),
    )
  }

  const totalWidth = Math.ceil(width + 2.0 * pad)
  const height = Math.ceil(bottom + pad)
  let content = labelSvg(
    title,
    totalWidth / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += edges
  content += nodes
  content += cards
  return document(model, options, totalWidth, height, size, content)
}
