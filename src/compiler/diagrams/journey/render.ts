/**
 * @module Draws a user journey: task cards over a chart of their scores, with an actor legend, or a
 * column of steps when that is narrower. Port of Pele's `src/diagrams/journey/render.ts`.
 */
import { type JourneyDb, journeyActors } from './db.ts'
import type { Rendered } from '../../diagrams.ts'
import { fitLabel, plainLabel } from '../common/fit.ts'
import { turnToFit } from '../common/fit_width.ts'
import { escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { ROUNDED, seriesColor } from '../../svg/theme.ts'
import { type Label, trim } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { type Buf, buf, clamp, fmax, fmin } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'

const PAD_X = 10.0
const PAD_Y = 8.0
const MIN_TEXT = 124.0
const MAX_TEXT = 200.0
const GAP = 12.0
const BAND_PAD = 6.0
const GUTTER = 24.0
const LEVEL = 26.0
const FACE = 11.0
const DOT = 5.0
const DOT_STEP = 13.0
const LEGEND_GAP = 20.0

const EYES = '<circle cx="-3.6" cy="-2.8" r="1.3"/><circle cx="3.6" cy="-2.8" r="1.3"/>'

/** The opening of a face, up to its mood's name. */
const FACE_OPEN = '<g class="ondine-face ondine-face-'
/** A face after its position, for each mood. */
const FACE_HAPPY = faceTail('M-5,2A6,6 0 0 0 5,2')
const FACE_SAD = faceTail('M-5,6.5A6,6 0 0 1 5,6.5')
const FACE_NEUTRAL = faceTail('M-4.5,4.5H4.5')

/** A face after its position: its circle, eyes, and `mouth`. */
function faceTail(mouth: string): string {
  const out = buf(')"><circle r="')
  pushNumber(out, FACE)
  out.s += '" fill="var(--_bg)" stroke="var(--_l)"/><g fill="var(--_l)">'
  out.s += EYES
  out.s += '</g><path d="'
  out.s += mouth
  out.s += '" fill="none" stroke="var(--_l)" stroke-linecap="round"/></g>'
  return out.s
}

/**
 * A face at (`x`, `y`) in the mood a score shows: above 3 is happy, below is sad, and the rest
 * (NaN too) neutral.
 */
function face(x: number, y: number, score: number): string {
  const position = `${num(x)},${num(y)}`
  if (score > 3.0) return `${FACE_OPEN}happy" transform="translate(${position}${FACE_HAPPY}`
  if (score < 3.0) return `${FACE_OPEN}sad" transform="translate(${position}${FACE_SAD}`
  return `${FACE_OPEN}neutral" transform="translate(${position}${FACE_NEUTRAL}`
}

function pushFace(out: Buf, x: number, y: number, score: number): void {
  out.s += face(x, y, score)
}

/** The series color of an actor's index. */
function series(index: number): string {
  return seriesColor(index)
}

/** The index of actor `name` in `names`, or 0. */
function actor(names: readonly string[], name: string): number {
  const at = names.indexOf(name)
  return at < 0 ? 0 : at
}

/** {@link pushNumber} of `value`, as a string. */
function numberText(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

/** The ` font-size` attribute for `size`. */
function fontSize(size: number): string {
  const out = buf(' font-size="')
  pushNumber(out, size)
  out.s += '"'
  return out.s
}

/** Draws `model`, running down when across does not fit. */
export function render(model: JourneyDb, options: RenderOptions): Rendered {
  return turnToFit(options, (down) => (down ? vertical(model, options) : draw(model, options)))
}

/** A legend entry. */
type Entry = {
  h: number
  label: Label
  name: string
  x: number
  y: number
}

/** A run of tasks that share a section. */
type Run = {
  count: number
  label: Label | undefined
  start: number
}

function draw(model: JourneyDb, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const tiny = jsRound(size * 0.75)
  const pad = options.padding ?? 8.0
  const tasks = model.tasks
  const n = tasks.length

  // `Task: 5:` names an actor with no name; Mermaid gives it a dot and an empty legend row.
  const names = journeyActors(tasks).filter((name) => name !== '')

  // Cards widen, up to a point, for a word that would not fit; past that the word is cut.
  let textW = MIN_TEXT
  let labels: Label[] = []
  let widest = 0.0
  for (let k = 0; k < n; k++) {
    const label = plainLabel(tasks[k]!.task, small, textW, 0)
    labels.push(label)
    widest = fmax(widest, label.width)
  }
  if (widest > textW) {
    textW = fmin(Math.ceil(widest), MAX_TEXT)
    labels = []
    for (let k = 0; k < n; k++) labels.push(fitLabel(tasks[k]!.task, small, textW, 0))
  }

  const cardW = textW + 2.0 * PAD_X
  const pitch = cardW + GAP
  const plotW = n > 0 ? n * pitch - GAP : 0.0

  const lineH = jsRound(small * 1.5)
  const limit = fmax(plotW, 240.0)
  const legend: Entry[] = []
  let legendW = 0.0
  let legendH = 0.0
  let lx = 0.0
  for (const name of names) {
    const label = fitLabel(name, small, limit - 2.0 * DOT - 6.0, 0)
    const w = 2.0 * DOT + 6.0 + label.width
    if (lx > 0.0 && lx + w > limit) {
      lx = 0.0
      legendH += 4.0
    }
    const y = lx > 0.0 ? (legend[legend.length - 1]?.y ?? 0.0) : legendH
    const h = fmax(label.height, lineH)
    legend.push({ h, label, name, x: lx, y })
    lx += w
    legendW = fmax(legendW, lx)
    legendH = fmax(legendH, y + h)
    lx += LEGEND_GAP
  }

  const bodyW = n > 0 ? GUTTER + plotW : 0.0
  const title = fitLabel(model.title, size, fmax(bodyW, 320.0), BOLD)
  const titleH = title.height > 0.0 ? title.height + 16.0 : 0.0
  const width = fmax(fmax(bodyW, title.width), n > 0 ? GUTTER + legendW : 0.0)
  const left = pad + (width - bodyW) / 2.0 + GUTTER
  const top = pad + titleH

  // A band covers a run of tasks that share a section, as in Mermaid; a section with no tasks
  // draws nothing.
  const runs: Run[] = []
  let bandH = 0.0
  let i = 0
  while (i < tasks.length) {
    const first = tasks[i] as (typeof tasks)[number]
    let end = i + 1
    while (end < tasks.length && (tasks[end] as (typeof tasks)[number]).section === first.section) end++
    let label: Label | undefined
    if (first.section !== '') {
      const own = fitLabel(first.section, small, (end - i) * pitch - GAP - 2.0 * PAD_X, BOLD)
      bandH = fmax(bandH, fmax(own.height, lineH) + 2.0 * BAND_PAD)
      label = own
    }
    runs.push({ count: end - i, label, start: i })
    i = end
  }

  let textH = lineH
  for (let k = 0; k < labels.length; k++) textH = fmax(textH, labels[k]!.height)
  const dotsH = names.length === 0 ? 0.0 : 2.0 * DOT + 6.0
  const cardH = textH + dotsH + 2.0 * PAD_Y
  const cardsY = top + (bandH > 0.0 ? bandH + BAND_PAD : 0.0)
  const chartTop = cardsY + cardH + FACE + 16.0
  const chartBottom = chartTop + 4.0 * LEVEL
  const right = left + plotW
  const smallSize = fontSize(small)

  let body = ''
  let bottom = top
  if (n > 0) {
    let grid = ''
    let scale = ''
    const gridLeft = num(left - 6.0)
    const gridRight = num(right)
    const scaleX = num(left - 12.0)
    for (let score = 5; score >= 1; score--) {
      const y = chartTop + (5 - score) * LEVEL
      grid += `M${gridLeft},${num(y)}H${gridRight}`
      scale += `<text x="${scaleX}" y="${num(y + tiny * 0.35)}">${score}</text>`
    }
    body += `<path class="ondine-grid" d="${grid}" fill="none" stroke="var(--_a)"/><g class="ondine-scale"${fontSize(tiny)} text-anchor="end" fill="var(--_m)">${scale}</g>`

    let line = ''
    let stems = ''
    let faces = ''
    const cards: string[] = []
    const stemTop = num(cardsY + cardH)
    const cardTop = num(cardsY)
    const cardRest = `" y="${cardTop}" width="${num(cardW)}" height="${num(cardH)}"${ROUNDED} fill="var(--_s)" stroke="var(--_b)"/>`
    const dotY = `" cy="${num(cardsY + cardH - PAD_Y - DOT)}" r="${numberText(DOT)}" fill="`
    for (let i = 0; i < n; i++) {
      const task = tasks[i]!
      const x = left + i * pitch
      const cx = x + cardW / 2.0
      const score = task.score
      const level = Number.isNaN(score) ? 3.0 : clamp(score, 1.0, 5.0)
      const y = chartTop + (5.0 - level) * LEVEL
      const cxText = num(cx)
      line += `${i === 0 ? 'M' : 'L'}${cxText},${num(y)}`
      stems += `M${cxText},${stemTop}V${num(y - FACE)}`
      faces += face(cx, y, score)

      let card = `<g class="ondine-node ondine-task" data-id="${escText(trim(task.task))}"><rect x="${num(x)}${cardRest}`
      const label = labels[i]
      if (label !== undefined) {
        card += labelSvg(label, cx, cardsY + PAD_Y + textH / 2.0, smallSize, undefined)
      }
      const all = task.people
      let count = 0
      for (let k = 0; k < all.length; k++) if (all[k] !== '') count++
      const spread = count - 1.0
      const step = fmin(DOT_STEP, (cardW - 2.0 * PAD_X - 2.0 * DOT) / fmax(spread, 1.0))
      let k = 0
      for (let j = 0; j < all.length; j++) {
        const name = all[j]!
        if (name === '') continue
        card += `<circle class="ondine-actor" cx="${num(cx + (k - spread / 2.0) * step)}${dotY}${series(actor(names, name))}" stroke="var(--_s)"><title>${escText(name)}</title></circle>`
        k++
      }
      card += '</g>'
      cards.push(card)
    }
    body += `<path class="ondine-stems" d="${stems}" fill="none" stroke="var(--_b)" stroke-dasharray="2 3"/>`
    if (n > 1) {
      body += `<path class="ondine-edge" d="${line}" fill="none" stroke="var(--_l)" stroke-linejoin="round"/>`
    }
    body += faces

    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!
      let members = ''
      const stop = Math.min(run.start + run.count, cards.length)
      for (let k = run.start; k < stop; k++) members += cards[k]!
      const label = run.label
      if (label === undefined) {
        body += members
        continue
      }
      const x = left + run.start * pitch
      const w = run.count * pitch - GAP
      body += `<g class="ondine-cluster ondine-section" data-id="${escText(trim(tasks[run.start]?.section ?? ''))}"><rect x="${num(x)}" y="${num(top)}" width="${num(w)}" height="${num(bandH)}"${ROUNDED} fill="var(--_a)"/>${labelSvg(label, x + w / 2.0, top + bandH / 2.0, smallSize + ' font-weight="var(--_hw)"', undefined)}${members}</g>`
    }
    bottom = chartBottom + FACE

    if (legend.length > 0) {
      const x0 = left + (plotW - legendW) / 2.0
      const y0 = bottom + 16.0
      const dotR = numberText(DOT)
      let items = ''
      for (let k = 0; k < legend.length; k++) {
        const item = legend[k]!
        const cy = y0 + item.y + item.h / 2.0
        items += `<g class="ondine-legend-item" data-id="${escText(item.name)}"><circle cx="${num(x0 + item.x + DOT)}" cy="${num(cy)}" r="${dotR}" fill="${series(actor(names, item.name))}"/>${labelSvg(item.label, x0 + item.x + 2.0 * DOT + 6.0 + item.label.width / 2.0, cy, '', undefined)}</g>`
      }
      body += `<g class="ondine-legend"${smallSize}>${items}</g>`
      bottom = y0 + legendH
    }
  }

  const totalWidth = Math.ceil(width + 2.0 * pad)
  const totalHeight = Math.ceil(fmax(bottom, pad) + pad)
  const content =
    labelSvg(title, pad + width / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined) +
    body
  return document(model, options, size, totalWidth, totalHeight, content)
}

/** Wraps `content` in the root document. */
function document(
  model: JourneyDb,
  options: RenderOptions,
  size: number,
  width: number,
  height: number,
  content: string,
): Rendered {
  return {
    height,
    links: [],
    svg: svgDocument(
      'journey',
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

/** Draws the journey as a column of steps. */
function vertical(model: JourneyDb, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8.0
  const room = fmax(140.0, (options.maxWidth ?? 320.0) - 2.0 * pad)
  const title = fitLabel(model.title, size, room, BOLD)
  const names = journeyActors(model.tasks).filter((name) => name !== '')
  let y = pad + (title.height === 0.0 ? 0.0 : title.height + 16.0)
  let section: string | undefined
  const body = buf()
  let width = title.width
  const smallSize = fontSize(small)
  const count = model.tasks.length
  for (let index = 0; index < count; index++) {
    const task = model.tasks[index] as (typeof model.tasks)[number]
    if (section !== task.section) {
      section = task.section
      const head = fitLabel(task.section, size, room - 16.0, BOLD)
      if (head.height !== 0.0) {
        body.s += labelSvg(
          head,
          pad + 8.0 + head.width / 2.0,
          y + head.height / 2.0,
          ' class="ondine-cluster-label" font-weight="var(--_hw)"',
          undefined,
        )
        width = fmax(width, head.width + 16.0)
        y += head.height + 8.0
      }
    }
    const label = fitLabel(task.task, small, room - 72.0, 0)
    const people: [string, Label][] = task.people
      .filter((name) => name !== '')
      .map((name) => [name, fitLabel(name, small, room - 44.0, 0)])
    const textH = fmax(label.height, 42.0)
    let h = 2.0 * PAD_Y + textH
    for (const [, person] of people) {
      h += fmax(person.height, 16.0) + 4.0
    }
    const w = fmax(room, label.width + 72.0)
    body.s += '<g class="ondine-node ondine-journey-step" data-id="'
    pushNumber(body, index)
    body.s += '"><rect x="'
    pushNum(body, pad)
    body.s += '" y="'
    pushNum(body, y)
    body.s += '" width="'
    pushNum(body, w)
    body.s += '" height="'
    pushNum(body, h)
    body.s += '"'
    body.s += ROUNDED
    body.s += ' fill="var(--_s)" stroke="var(--_b)"/>'
    body.s += labelSvg(
      label,
      pad + PAD_X + label.width / 2.0,
      y + PAD_Y + label.height / 2.0,
      ' class="ondine-label"',
      undefined,
    )
    const cx = pad + w - 28.0
    pushFace(body, cx, y + PAD_Y + FACE, task.score)
    if (!Number.isNaN(task.score)) {
      body.s += '<text class="ondine-journey-score" x="'
      pushNum(body, cx)
      body.s += '" y="'
      pushNum(body, y + PAD_Y + 2.0 * FACE + small)
      body.s += '"'
      body.s += smallSize
      body.s += ' text-anchor="middle">'
      pushNum(body, clamp(task.score, 1.0, 5.0))
      body.s += '</text>'
    }
    let py = y + PAD_Y + textH + 4.0
    for (const [name, person] of people) {
      const ph = fmax(person.height, 16.0)
      body.s += '<circle class="ondine-actor" cx="'
      pushNum(body, pad + 16.0)
      body.s += '" cy="'
      pushNum(body, py + ph / 2.0)
      body.s += '" r="'
      pushNumber(body, DOT)
      body.s += '" fill="'
      const at = names.indexOf(name)
      body.s += series(at < 0 ? 0 : at)
      body.s += '"/>'
      body.s += labelSvg(
        person,
        pad + 28.0 + person.width / 2.0,
        py + ph / 2.0,
        ' class="ondine-journey-actor"' + smallSize,
        undefined,
      )
      py += ph + 4.0
    }
    body.s += '</g>'
    y += h
    if (index + 1 < count) {
      body.s += '<path class="ondine-edge" d="M'
      pushNum(body, pad + w / 2.0)
      body.s += ','
      pushNum(body, y)
      body.s += 'v16" fill="none" stroke="var(--_l)"/>'
    }
    y += 16.0
    width = fmax(width, w)
  }
  const totalWidth = Math.ceil(width + 2.0 * pad)
  const tail = count > 0 ? 16.0 : 0.0
  const height = Math.ceil(fmax(pad + title.height, y - tail) + pad)
  let content = labelSvg(
    title,
    totalWidth / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += body.s
  return document(model, options, size, totalWidth, height, content)
}
