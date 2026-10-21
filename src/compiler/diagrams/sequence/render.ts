/** @module Lays out and draws a sequence diagram. Port of Pele's `src/diagrams/sequence/render.ts`. */
import type { Rendered } from '../../diagrams.ts'
import { esc, escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { ARROW, marker } from '../../svg/edges.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { ROUNDED_STYLE, classNames, resolveStyle, roundedStyle } from '../../svg/theme.ts'
import { type Label, labelDefault, layoutLabel } from '../../text/label.ts'
import { BOLD, width as measure } from '../../text/measure.ts'
import { buf, type Buf, fmax, fmin, midpoint, partitionPoint } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'
import { tighten, titleRoom } from '../common/fit_width.ts'
import { breakLabel } from '../common/literal_label.ts'
import { type ActorSize, actorKind, actorSize, drawActor, isFigure } from './actors.ts'
import type { SeqDb } from './db.ts'
import { type SeqActor, type SeqMessage, line, placement } from './types.ts'

/** The head drawn at a message's end. */
const Head = {
  None: 'None',
  Arrow: 'Arrow',
  Cross: 'Cross',
  Open: 'Open',
  HalfSolid: 'HalfSolid',
  HalfStick: 'HalfStick',
} as const
type Head = (typeof Head)[keyof typeof Head]

/** How a message line is drawn. */
type LineStyle = {
  /** Whether a head is at the sender: the reverse arrows and the bidirectional ones. */
  atStart: boolean
  /** Whether a head is at the receiver. */
  atEnd: boolean
  bottom: boolean
  dotted: boolean
  head: Head
}

/** The line styles of the message kinds below {@link STYLE_COUNT}, computed once. */
const STYLE_COUNT = 64
const STYLES: (LineStyle | undefined)[] = Array.from({ length: STYLE_COUNT }, (_, type) => computeStyle(type))

/** The line style of a message kind, or `undefined` for what is not a message line. */
function styleOf(type: number): LineStyle | undefined {
  if (type >= 0 && type < STYLE_COUNT && (type | 0) === type) return STYLES[type]
  return computeStyle(type)
}

function computeStyle(type: number): LineStyle | undefined {
  // `ends` is 1 for a head at the receiver, 0 at the sender only, and 2 at both.
  const style = (dotted: boolean, head: Head, ends: number, bottom: boolean): LineStyle => ({
    atStart: ends !== 1,
    atEnd: ends !== 0,
    bottom,
    dotted,
    head,
  })
  switch (type) {
    case line.SOLID:
      return style(false, Head.Arrow, 1, false)
    case line.DOTTED:
      return style(true, Head.Arrow, 1, false)
    case line.SOLID_CROSS:
      return style(false, Head.Cross, 1, false)
    case line.DOTTED_CROSS:
      return style(true, Head.Cross, 1, false)
    case line.SOLID_OPEN:
      return style(false, Head.None, 1, false)
    case line.DOTTED_OPEN:
      return style(true, Head.None, 1, false)
    case line.SOLID_POINT:
      return style(false, Head.Open, 1, false)
    case line.DOTTED_POINT:
      return style(true, Head.Open, 1, false)
    case line.BIDIRECTIONAL_SOLID:
      return style(false, Head.Arrow, 2, false)
    case line.BIDIRECTIONAL_DOTTED:
      return style(true, Head.Arrow, 2, false)
  }
  if ((type >= 41 && type <= 48) || (type >= 51 && type <= 58)) {
    const dotted = type > 50
    switch (type - (dotted ? 10 : 0) - line.SOLID_TOP) {
      case 0:
        return style(dotted, Head.HalfSolid, 1, false)
      case 1:
        return style(dotted, Head.HalfSolid, 1, true)
      case 2:
        return style(dotted, Head.HalfStick, 1, false)
      case 3:
        return style(dotted, Head.HalfStick, 1, true)
      case 4:
        return style(dotted, Head.HalfSolid, 0, false)
      case 5:
        return style(dotted, Head.HalfSolid, 0, true)
      case 6:
        return style(dotted, Head.HalfStick, 0, false)
      default:
        return style(dotted, Head.HalfStick, 0, true)
    }
  }
  return undefined
}

function frameKind(type: number): string | undefined {
  switch (type) {
    case line.LOOP_START:
      return 'loop'
    case line.ALT_START:
      return 'alt'
    case line.OPT_START:
      return 'opt'
    case line.PAR_START:
    case line.PAR_OVER_START:
      return 'par'
    case line.CRITICAL_START:
      return 'critical'
    case line.BREAK_START:
      return 'break'
    case line.RECT_START:
      return 'rect'
    default:
      return undefined
  }
}

const MSG_PAD = 12.0
const SELF_W = 28.0
const SELF_H = 22.0
const ACT_W = 10.0
const ACT_STEP = 4.0
const ACT_MIN = 14.0
const NOTE_GAP = 10.0
const NOTE_OVER = 16.0
const FRAME_PAD = 20.0
const FRAME_NEST = 10.0
const TAB_H = 20.0
const FRAME_TEXT = 240.0
const BADGE_H = 16.0
const CENTRAL_R = 4.0
const DASH = ' stroke-dasharray="4 4"'
/** The end of a dashed path. */
const DASH_END = `"${DASH}/>`
// Rectangles are written with their themed radius already in their style, as `ROUNDED_STYLE`
// explains.
/** The end of a block's tab, and the start of its kind. */
const TAB_END = `" fill="var(--_s)"${ROUNDED_STYLE}/><text class="ondine-frame-kind" x="`
/** The end of a note's box. */
const NOTE_END = `"${ROUNDED_STYLE}/>`
/** The paint of a box. */
const BOX_END = `" fill="var(--_a)" stroke="var(--_b)"`

/** The numbers of the message lines. */
export type Numbering = {
  /** The number each message line carries, whether or not it is shown. NaN for everything else. */
  index: number[]
  /** Whether each message's number is shown. */
  shown: boolean[]
  /** Whether numbers are on after the last statement. */
  visible: boolean
}

/** Whether a message kind is drawn as a line. */
export function isLineMessage(type: number | undefined): boolean {
  return type !== undefined && styleOf(type) !== undefined
}

/** Counts message lines the way Mermaid's renderer does while it draws. */
export function numberMessages(messages: SeqMessage[], always: boolean): Numbering {
  // Arrays are filled by pushing: `Array.prototype.fill` on a new array takes a slow path in V8.
  const index: number[] = []
  const shown: boolean[] = []
  for (let i = 0; i < messages.length; i++) {
    index.push(Number.NaN)
    shown.push(false)
  }
  let current = 1.0
  let step = 1.0
  let visible = false
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as SeqMessage
    if (m.type === line.AUTONUMBER) {
      if (m.message.kind === 'Numbering') {
        const spec = m.message._0
        // `spec.start || current`: zero and NaN keep the current value.
        if (spec.start !== undefined && spec.start !== 0 && !Number.isNaN(spec.start)) current = spec.start
        if (spec.step !== undefined && spec.step !== 0 && !Number.isNaN(spec.step)) step = spec.step
        visible = spec.visible
      }
    } else if (isLineMessage(m.type)) {
      index[i] = current
      shown[i] = visible || always
      current = jsRound((current + step) * 100.0) / 100.0
    }
  }
  return { index, shown, visible }
}

/** A participant's column. */
type Column = {
  activations: number[]
  actor: SeqActor
  createAt: number | undefined
  destroyAt: number | undefined
  id: string
  kind: string
  label: Label
  lifeEnd: number | undefined
  lifeStart: number
  size: ActorSize
  top: number
  x: number
}

const V = {
  Line: 'Line',
  SelfLoop: 'SelfLoop',
  Note: 'Note',
} as const
type V = (typeof V)[keyof typeof V]

/** A message or note with the columns it joins. */
type View = {
  a: number
  b: number
  kind: V
  label: Label
  w: number
  x: number
}

/** A block's frame. */
type Frame = {
  dividerLabels: Label[]
  dividerY: number[]
  dividers: number[]
  fill: string
  kind: string
  tabW: number
  title: Label
  top: number
  x0: number
  x1: number
}

/** Consecutive columns of one box. */
type BoxRun = {
  box: number
  first: number
  grow: number
  last: number
  title: Label
}

/** The horizontal extent of everything drawn. */
type Bounds = {
  maxX: number
  minX: number
}

function boundsExtend(self: Bounds, x0: number, x1: number): void {
  if (x0 < self.minX) self.minX = x0
  if (x1 > self.maxX) self.maxX = x1
}

/** The value under `key` of a YAML mapping. */
function get(value: Value | undefined, key: string): Value | undefined {
  if (value === undefined || value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

function option(conf: Value | undefined, key: string, fallback: number): number {
  const value = get(conf, key)
  if (value !== undefined && value.kind === 'Number' && value._0 >= 0.0 && value._0 <= 2000.0) return value._0
  return fallback
}

/** Whether `value` is the boolean `expected`. */
function isBool(value: Value | undefined, expected: boolean): boolean {
  return value !== undefined && value.kind === 'Bool' && value._0 === expected
}

function half(out: Buf, x: number, y: number, dir: number, up: number, stick: boolean): void {
  const bx = x - dir * ARROW
  out.s += '<path class="ondine-marker" d="M'
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
  out.s += 'L'
  pushNum(out, bx)
  out.s += ','
  if (stick) {
    pushNum(out, y + up * 5.0)
    out.s += '"/>'
    return
  }
  pushNum(out, y + up * 4.5)
  out.s += 'V'
  pushNum(out, y)
  out.s += 'Z" fill="var(--_l)" stroke="none"/>'
}

/**
 * Draws the head whose tip is at (`x`, `y`) and points along `dir`. `up` is the side a half head
 * sits on.
 */
function head(out: Buf, type: Head, x: number, y: number, dir: number, up: number): void {
  switch (type) {
    case Head.Arrow:
      out.s += marker('arrow_point', x, y, dir, 0.0, 'var(--_l)')
      break
    case Head.Cross:
      out.s += marker('arrow_cross', x, y, dir, 0.0, 'var(--_l)')
      break
    case Head.Open:
      out.s += '<path class="ondine-marker" d="M'
      pushNum(out, x - dir * ARROW)
      out.s += ','
      pushNum(out, y - 4.5)
      out.s += 'L'
      pushNum(out, x)
      out.s += ','
      pushNum(out, y)
      out.s += 'L'
      pushNum(out, x - dir * ARROW)
      out.s += ','
      pushNum(out, y + 4.5)
      out.s += '" stroke-linejoin="round"/>'
      break
    case Head.HalfSolid:
      half(out, x, y, dir, up, false)
      break
    case Head.HalfStick:
      half(out, x, y, dir, up, true)
      break
    case Head.None:
      break
  }
}

/** Draws the circle of a `()` connection. */
function circle(out: Buf, cx: number, cy: number): void {
  out.s += '<circle class="ondine-central" cx="'
  pushNum(out, cx)
  out.s += '" cy="'
  pushNum(out, cy)
  out.s += '" r="'
  pushNum(out, CENTRAL_R)
  out.s += '" fill="var(--_l)" stroke="none"/>'
}

/** A message's text, unless it is a numbering entry. */
function messageText(m: SeqMessage): string | undefined {
  return m.message.kind === 'Text' ? m.message._0 : undefined
}

function trimOf(type: Head): number {
  switch (type) {
    case Head.Arrow:
      return ARROW - 1.0
    case Head.Cross:
      return 4.0
    default:
      return 0.0
  }
}

/** Draws a sequence diagram, tightening its spacing when it does not fit the host's width. */
export function render(db: SeqDb, config: Value, options: RenderOptions): Rendered {
  return tighten(options, (tight: boolean) => draw(db, config, options, tight))
}

function draw(db: SeqDb, config: Value, options: RenderOptions, tight: boolean): Rendered {
  const conf = get(config, 'sequence')
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const tiny = jsRound(size * 0.75)
  const pad = options.padding ?? 8.0
  const mirror = !isBool(get(conf, 'mirrorActors'), false)
  const rightAngles = isBool(get(conf, 'rightAngles'), true)
  const loose = (value: number, tightValue: number): number => (tight ? fmin(value, tightValue) : value)
  const actorMargin = loose(option(conf, 'actorMargin', 40.0), 8.0)
  const minW = loose(option(conf, 'width', 64.0), 48.0)
  const minH = option(conf, 'height', jsRound(size * 1.5) + 20.0)
  const actorCount = db.actors.length
  const wrapW = loose(
    option(conf, 'width', 160.0),
    fmax(32.0, ((options.maxWidth ?? 320.0) - 2.0 * pad) / fmax(actorCount, 1.0) - actorMargin - 24.0),
  )
  // Mermaid's default of 35 corresponds to Pele's default gap. Other values move it by the
  // difference.
  const msgGap = fmax(4.0, 14.0 + option(conf, 'messageMargin', 35.0) - 35.0)
  const notePad = loose(option(conf, 'noteMargin', 10.0), 6.0)
  const boxPad = loose(option(conf, 'boxMargin', 10.0), 6.0)
  const alignValue = get(conf, 'messageAlign')
  let align = 0
  if (alignValue !== undefined && alignValue.kind === 'String') {
    if (alignValue._0 === 'left') align = -1
    else if (alignValue._0 === 'right') align = 1
  }

  const msgPad = tight ? 6.0 : MSG_PAD
  const noteOver = tight ? 8.0 : NOTE_OVER
  const framePad = tight ? 12.0 : FRAME_PAD
  const frameNest = tight ? 6.0 : FRAME_NEST
  const messages = db.messages
  const count = messages.length
  const numbering = numberMessages(messages, isBool(get(conf, 'showSequenceNumbers'), true))
  const text = (raw: string | undefined, fontSize: number, wrap: boolean, width: number, base: number): Label => {
    const label = layoutLabel(raw, false, fontSize, tight || wrap ? width : Number.POSITIVE_INFINITY, base, undefined)
    return tight ? breakLabel(label, fmax(width, 120.0)) : label
  }

  let used: Set<string> | undefined
  if (isBool(get(conf, 'hideUnusedParticipants'), true)) {
    used = new Set()
    for (const m of messages) {
      if (m.from !== undefined) used.add(m.from)
      if (m.to !== undefined) used.add(m.to)
    }
  }

  const nextLine: (number | undefined)[] = []
  for (let i = 0; i <= count; i++) nextLine.push(undefined)
  for (let i = count - 1; i >= 0; i--) {
    const next = nextLine[i + 1]
    const m = messages[i]
    nextLine[i] = m !== undefined && isLineMessage(m.type) ? i : next
  }
  const lineAfter = (at: number): number | undefined => nextLine[Math.min(at, count)]

  const cols: Column[] = []
  const colOf = new Map<string, number>()
  for (const actor of db.actors) {
    const id = actor.name
    if (used !== undefined && !used.has(id)) continue
    const kind = actorKind(actor.type)
    const label = text(actor.description, size, actor.wrap, wrapW, 0)
    const created = db.createdActors.find(([own]) => own === id)?.[1]
    const destroyed = db.destroyedActors.find(([own]) => own === id)?.[1]
    let createAt = created === undefined ? undefined : lineAfter(created)
    if (createAt !== undefined && messages[createAt]?.to !== id) createAt = undefined
    let destroyAt = destroyed === undefined ? undefined : lineAfter(destroyed)
    if (destroyAt !== undefined) {
      const m = messages[destroyAt]
      if (!(m !== undefined && (m.to === id || m.from === id))) destroyAt = undefined
    }
    colOf.set(id, cols.length)
    const actorSz = actorSize(kind, label, minW, minH, tight ? 8.0 : undefined)
    cols.push({
      activations: [],
      actor,
      createAt,
      destroyAt,
      id,
      kind,
      label,
      lifeEnd: undefined,
      lifeStart: 0.0,
      size: actorSz,
      top: 0.0,
      x: 0.0,
    })
  }
  const n = cols.length

  // Widths between lifelines. Every message and note says how far apart the lifelines it touches
  // must be.
  // Keyed by `lo * n + hi`, which is one-to-one as `hi < n`.
  const needs = new Map<number, [number, number, number]>()
  const need = (lo: number | undefined, hi: number, width: number): void => {
    if (lo === undefined) return
    if (hi >= n) return
    const key = lo * n + hi
    const slot = needs.get(key)
    const entry = slot ?? ([lo, hi, 0.0] as [number, number, number])
    if (slot === undefined) needs.set(key, entry)
    if (entry[2] < width) entry[2] = width
  }
  const badgeWidth = (i: number): number => {
    if (numbering.shown[i] ?? false) {
      const label = buf()
      pushNumber(label, numbering.index[i] ?? Number.NaN)
      return fmax(BADGE_H, measure(label.s, tiny, 0) + 8.0)
    }
    return 0.0
  }

  const views: (View | undefined)[] = []
  for (let i = 0; i < count; i++) {
    const m = messages[i] as SeqMessage
    const a = m.from === undefined ? undefined : colOf.get(m.from)
    const b = m.to === undefined ? undefined : colOf.get(m.to)
    const raw = messageText(m)
    if (a === undefined || b === undefined || raw === undefined) {
      views.push(undefined)
      continue
    }
    if (m.type === line.NOTE) {
      const label = text(raw, small, m.wrap, wrapW, 0)
      const w = label.width + 2.0 * notePad
      if (m.placement === placement.LEFT_OF) {
        need(a >= 1 ? a - 1 : undefined, a, w + 2.0 * NOTE_GAP + ACT_W)
      } else if (m.placement === placement.RIGHT_OF) {
        need(a, a + 1, w + 2.0 * NOTE_GAP + ACT_W)
      } else if (a === b) {
        need(a >= 1 ? a - 1 : undefined, a, w / 2.0 + NOTE_GAP)
        need(a, a + 1, w / 2.0 + NOTE_GAP)
      } else {
        need(Math.min(a, b), Math.max(a, b), w - 2.0 * noteOver)
      }
      views.push({ a, b, kind: V.Note, label, w, x: 0.0 })
    } else if (isLineMessage(m.type)) {
      const label = text(raw, small, m.wrap, wrapW, 0)
      const badge = badgeWidth(i)
      if (a === b) {
        need(a, a + 1, SELF_W + 8.0 + label.width + 16.0 + ACT_W + badge)
        views.push({ a, b, kind: V.SelfLoop, label, w: 0.0, x: 0.0 })
      } else {
        const col = cols[b]
        const created = col !== undefined && col.createAt === i ? col.size.w / 2.0 : 0.0
        const central = m.centralConnection !== undefined && m.centralConnection !== 0 ? 4.0 * CENTRAL_R : 0.0
        const width = tight ? fmin(label.width, fmax(16.0, wrapW - 16.0)) : label.width
        need(Math.min(a, b), Math.max(a, b), width + 2.0 * msgPad + ACT_W + badge + created + central)
        views.push({ a, b, kind: V.Line, label, w: 0.0, x: 0.0 })
      }
    } else {
      views.push(undefined)
    }
  }

  const runs: BoxRun[] = []
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i] as Column
    const at = col.actor.box
    if (at === undefined) continue
    const run = runs.length === 0 ? undefined : runs[runs.length - 1]
    if (run !== undefined && run.box === at && run.last + 1 === i) {
      run.last = i
      continue
    }
    const box = db.boxes[at]
    runs.push({
      box: at,
      first: i,
      grow: 0.0,
      last: i,
      title: text(box?.name, small, box !== undefined && box.wrap, wrapW, 0),
    })
  }

  const gaps: number[] = []
  for (let i = 1; i < n; i++) {
    const left = cols[i - 1] as Column
    const right = cols[i] as Column
    const lb = left.actor.box
    const rb = right.actor.box
    const boxed = lb === rb ? 0.0 : (lb !== undefined ? boxPad : 0.0) + (rb !== undefined ? boxPad : 0.0)
    gaps.push(
      fmax(left.size.w / 2.0 + right.size.w / 2.0 + actorMargin + boxed, needs.get((i - 1) * n + i)?.[2] ?? 0.0),
    )
  }
  // A message across several lifelines widens each gap it crosses by an equal share of what is
  // missing.
  // Rust sorts by the columns first, then stably by span and first column. That key is unique,
  // so the second sort alone gives the same order. Nothing changes the entries from here on.
  const spans: [number, number, number][] = []
  for (const entry of needs.values()) {
    if (entry[1] - entry[0] > 1) spans.push(entry)
  }
  spans.sort((p, q) => p[1] - p[0] - (q[1] - q[0]) || p[0] - q[0])
  for (const [lo, hi, width] of spans) {
    const inRange = lo <= hi && hi <= gaps.length
    let total = 0.0
    if (inRange) {
      for (let k = lo; k < hi; k++) total += gaps[k] as number
    }
    if (total >= width) continue
    const share = (width - total) / (hi - lo)
    if (inRange) {
      for (let k = lo; k < hi; k++) gaps[k] = (gaps[k] as number) + share
    }
  }
  const place = (cols: Column[], gaps: number[]): void => {
    for (let i = 1; i < cols.length; i++) {
      const x = (cols[i - 1]?.x ?? 0.0) + (gaps[i - 1] ?? 0.0)
      const col = cols[i]
      if (col !== undefined) col.x = x
    }
  }
  place(cols, gaps)
  const colX = (cols: Column[], i: number): number => cols[i]?.x ?? 0.0
  const colW = (cols: Column[], i: number): number => cols[i]?.size.w ?? 0.0
  for (const run of runs) {
    const inner =
      colX(cols, run.last) + colW(cols, run.last) / 2.0 - (colX(cols, run.first) - colW(cols, run.first) / 2.0)
    run.grow = fmax(0.0, (run.title.width - inner) / 2.0)
    if (run.grow === 0.0) continue
    if (run.first > 0 && run.first - 1 < gaps.length) gaps[run.first - 1] = (gaps[run.first - 1] as number) + run.grow
    if (run.last + 1 < n && run.last < gaps.length) gaps[run.last] = (gaps[run.last] as number) + run.grow
  }
  place(cols, gaps)

  const bounds: Bounds = { maxX: Number.NEGATIVE_INFINITY, minX: Number.POSITIVE_INFINITY }
  for (const col of cols) boundsExtend(bounds, col.x - col.size.w / 2.0, col.x + col.size.w / 2.0)
  for (const run of runs) {
    boundsExtend(
      bounds,
      colX(cols, run.first) - colW(cols, run.first) / 2.0 - boxPad - run.grow,
      colX(cols, run.last) + colW(cols, run.last) / 2.0 + boxPad + run.grow,
    )
  }

  // Horizontal extents of every block, from what it holds.
  const frames: Frame[] = []
  const frameAt: (number | undefined)[] = []
  for (let i = 0; i < count; i++) frameAt.push(undefined)
  const open: number[] = []
  const spanAll = (cols: Column[]): [number, number] =>
    n === 0 ? [0.0, 120.0] : [colX(cols, 0) - framePad, colX(cols, n - 1) + framePad]
  for (let i = 0; i < count; i++) {
    const m = messages[i] as SeqMessage
    const type = m.type
    const kind = type === undefined ? undefined : frameKind(type)
    if (kind !== undefined) {
      const fill = m.message.kind === 'Text' && kind === 'rect' ? m.message._0 : ''
      frameAt[i] = frames.length
      open.push(frames.length)
      frames.push({
        dividerLabels: [],
        dividerY: [],
        dividers: [i],
        fill,
        kind,
        tabW: 0.0,
        title: labelDefault(),
        top: 0.0,
        x0: Number.POSITIVE_INFINITY,
        x1: Number.NEGATIVE_INFINITY,
      })
    } else if (type === line.ALT_ELSE || type === line.PAR_AND || type === line.CRITICAL_OPTION) {
      const at = open.length === 0 ? undefined : open[open.length - 1]
      const frame = at === undefined ? undefined : frames[at]
      if (frame !== undefined) frame.dividers.push(i)
    } else if (
      type === line.LOOP_END ||
      type === line.ALT_END ||
      type === line.OPT_END ||
      type === line.PAR_END ||
      type === line.CRITICAL_END ||
      type === line.BREAK_END ||
      type === line.RECT_END
    ) {
      const at = open.pop()
      if (at === undefined) continue
      frameAt[i] = at
      const frame = frames[at]
      if (frame === undefined) continue
      if (frame.x0 > frame.x1) [frame.x0, frame.x1] = spanAll(cols)
      if (frame.kind !== 'rect') {
        frame.tabW = measure(frame.kind, tiny, BOLD) + 14.0
        // A block grows to the right to give its texts up to FRAME_TEXT of width before they
        // wrap.
        for (let k = 0; k < frame.dividers.length; k++) {
          const d = frame.dividers[k]
          const dm = d === undefined ? undefined : messages[d]
          const raw = (dm === undefined ? undefined : messageText(dm)) ?? ''
          const tab = k === 0 ? frame.tabW + 8.0 : 0.0
          const room = frame.x1 - frame.x0 - 16.0 - tab
          let label: Label
          if (raw === '') {
            label = labelDefault()
          } else {
            const least = tight ? fmin(FRAME_TEXT, wrapW) : FRAME_TEXT
            label = text(`[${raw}]`, small, true, fmax(room, least), 0)
          }
          if (label.width > room) frame.x1 += label.width - room
          if (k === 0) frame.title = label
          else frame.dividerLabels.push(label)
        }
      }
      const x0 = frame.x0
      const x1 = frame.x1
      boundsExtend(bounds, x0, x1)
      const parentAt = open.length === 0 ? undefined : open[open.length - 1]
      const parent = parentAt === undefined ? undefined : frames[parentAt]
      if (parent !== undefined) {
        parent.x0 = fmin(parent.x0, x0 - frameNest)
        parent.x1 = fmax(parent.x1, x1 + frameNest)
      }
    } else {
      const view = views[i]
      if (view === undefined) continue
      const a = cols[view.a]
      const b = cols[view.b]
      if (a === undefined || b === undefined) continue
      let x0: number
      let x1: number
      switch (view.kind) {
        case V.Note: {
          if (m.placement === placement.LEFT_OF) {
            view.x = a.x - NOTE_GAP - view.w
          } else if (m.placement === placement.RIGHT_OF) {
            view.x = a.x + NOTE_GAP
          } else if (view.a === view.b) {
            view.x = a.x - view.w / 2.0
          } else {
            const lo = fmin(a.x, b.x) - noteOver
            const hi = fmax(a.x, b.x) + noteOver
            if (tight || m.wrap) {
              view.label = text(messageText(m), small, true, fmax(wrapW, hi - lo - 2.0 * notePad), 0)
            }
            view.w = fmax(hi - lo, view.label.width + 2.0 * notePad)
            view.x = (lo + hi - view.w) / 2.0
          }
          x0 = view.x
          x1 = view.x + view.w
          break
        }
        case V.SelfLoop:
          x0 = a.x
          x1 = a.x + ACT_W + SELF_W + 8.0 + view.label.width + badgeWidth(i)
          break
        case V.Line: {
          x0 = fmin(a.x, b.x)
          x1 = fmax(a.x, b.x)
          if (tight || m.wrap) {
            view.label = text(messageText(m), small, true, fmax(wrapW, x1 - x0 - 2.0 * msgPad - ACT_W), 0)
          }
          if (b.createAt === i) {
            if (b.x > a.x) x1 += b.size.w / 2.0
            else x0 -= b.size.w / 2.0
          }
          break
        }
      }
      boundsExtend(bounds, x0, x1)
      const frameIdx = open.length === 0 ? undefined : open[open.length - 1]
      const frame = frameIdx === undefined ? undefined : frames[frameIdx]
      if (frame !== undefined) {
        frame.x0 = fmin(frame.x0, x0 - framePad)
        frame.x1 = fmax(frame.x1, x1 + framePad)
      }
    }
  }

  // Vertical placement, top to bottom, drawing as it goes.
  let boxTitleH = 0.0
  for (const run of runs) boxTitleH = fmax(boxTitleH, run.title.height)
  const boxTop = runs.length === 0 ? 0.0 : boxPad + (boxTitleH > 0.0 ? boxTitleH + 4.0 : 0.0)
  let rowH = 0.0
  for (const col of cols) {
    if (col.createAt === undefined) rowH = fmax(rowH, col.size.h)
  }
  const headBottom = boxTop + rowH
  for (const col of cols) {
    col.top = headBottom - col.size.h
    col.lifeStart = headBottom
  }

  const xs: number[] = []
  for (const col of cols) xs.push(col.x)
  // Whether a lifeline runs between two x positions, where text would be struck through.
  const crosses = (x0: number, x1: number): boolean => {
    const at = partitionPoint(xs, (x) => x <= x0)
    const x = xs[at]
    return x !== undefined && x < x1
  }
  const backed = (label: Label, cx: number, cy: number, attrs: string): string => {
    if (label.width === 0.0) return ''
    const l = cx - label.width / 2.0
    const out = buf()
    if (crosses(l, l + label.width)) {
      out.s += '<rect x="'
      pushNum(out, l - 3.0)
      out.s += '" y="'
      pushNum(out, cy - label.height / 2.0 + 2.0)
      out.s += '" width="'
      pushNum(out, label.width + 6.0)
      out.s += '" height="'
      pushNum(out, label.height - 4.0)
      out.s += '" rx="3" fill="var(--_bg)" stroke="none"/>'
    }
    out.s += labelSvg(label, cx, cy, attrs, undefined)
    return out.s
  }
  const leftEdge = (col: Column, extra: number): number =>
    col.activations.length + extra > 0 ? col.x - ACT_W / 2.0 : col.x
  const rightEdge = (col: Column, extra: number): number => {
    const depth = col.activations.length + extra
    if (depth > 0) {
      const steps = depth - 1
      return col.x + ACT_W / 2.0 + steps * ACT_STEP
    }
    return col.x
  }

  // Shaded blocks and activations close from the inside out. They are written in reverse, so that
  // the inner ones end up on top.
  const rectsOut: string[] = []
  const activationsOut: string[] = []
  let framesOut = ''
  const edgesOut = buf()
  const labelsOut = buf()
  const notesOut = buf()
  let actorsOut = ''
  const crossesOut = buf()
  const endActivation = (col: Column, end: number): number => {
    const start = col.activations.pop()
    if (start === undefined) return end
    const bottom = fmax(end, start + ACT_MIN)
    const depth = col.activations.length
    const x = col.x - ACT_W / 2.0 + depth * ACT_STEP
    boundsExtend(bounds, x, x + ACT_W)
    const out = buf('<rect class="ondine-activation" data-id="')
    out.s += escText(col.id)
    out.s += '" x="'
    pushNum(out, x)
    out.s += '" y="'
    pushNum(out, start)
    out.s += '" width="'
    pushNum(out, ACT_W)
    out.s += '" height="'
    pushNum(out, bottom - start)
    out.s += '" rx="2"/>'
    activationsOut.push(out.s)
    return bottom
  }
  // The lifeline of a destroyed participant ends in a cross a little below the message that ends
  // it.
  const destroy = (col: Column, lineY: number): number => {
    const cx = col.x
    const cy = lineY + 16.0
    col.lifeEnd = cy
    crossesOut.s += '<path class="ondine-destroy" data-id="'
    crossesOut.s += escText(col.id)
    crossesOut.s += '" d="M'
    const points: [number, number][] = [
      [cx - 6.0, cy - 6.0],
      [cx + 6.0, cy + 6.0],
      [cx + 6.0, cy - 6.0],
      [cx - 6.0, cy + 6.0],
    ]
    for (let k = 0; k < points.length; k++) {
      const [x, y] = points[k] as [number, number]
      if (k > 0) crossesOut.s += k === 2 ? 'M' : 'L'
      pushNum(crossesOut, x)
      crossesOut.s += ','
      pushNum(crossesOut, y)
    }
    crossesOut.s += '"/>'
    return cy + 6.0
  }
  const actorSvg = (col: Column, top: number, footer: boolean): string => {
    const out = buf('<g class="ondine-node ondine-actor ondine-actor-')
    out.s += col.kind
    if (footer) out.s += ' ondine-actor-footer'
    const cls = col.actor.properties.find(([key]) => key === 'class')?.[1]
    if (cls !== undefined && cls.kind === 'String') out.s += classNames(cls._0)
    out.s += '" data-id="'
    out.s += escText(col.id)
    out.s += '">'
    drawActor(out, col.kind, col.x, top, col.size, col.label)
    out.s += '</g>'
    return out.s
  }
  const badge = (i: number, cx: number, cy: number, w: number): string => {
    const out = buf('<g class="ondine-sequence-number"><rect x="')
    pushNum(out, cx - w / 2.0)
    out.s += '" y="'
    pushNum(out, cy - BADGE_H / 2.0)
    out.s += '" width="'
    pushNum(out, w)
    out.s += '" height="'
    pushNum(out, BADGE_H)
    out.s += '" rx="'
    pushNum(out, BADGE_H / 2.0)
    out.s += '" fill="var(--_l)" stroke="none"/><text x="'
    pushNum(out, cx)
    out.s += '" y="'
    pushNum(out, cy + tiny * 0.35)
    out.s += '" text-anchor="middle" font-size="'
    pushNumber(out, tiny)
    out.s += '" fill="var(--_bg)" stroke="none">'
    const number = buf()
    pushNumber(number, numbering.index[i] ?? Number.NaN)
    out.s += esc(number.s)
    out.s += '</text></g>'
    return out.s
  }
  const frameLabelAttrs = ' class="ondine-frame-label" fill="var(--_m)" stroke="none"'

  let y = headBottom + 6.0
  const stack: number[] = []
  for (let i = 0; i < count; i++) {
    const m = messages[i] as SeqMessage
    const type = m.type
    const frame = frameAt[i]

    if (type === line.ACTIVE_START) {
      const c = m.from === undefined ? undefined : colOf.get(m.from)
      const col = c === undefined ? undefined : cols[c]
      if (col !== undefined) col.activations.push(y)
    } else if (type === line.ACTIVE_END) {
      const c = m.from === undefined ? undefined : colOf.get(m.from)
      const col = c === undefined ? undefined : cols[c]
      if (col !== undefined && col.activations.length !== 0) y = fmax(y, endActivation(col, y))
    } else if (frame !== undefined && frames[frame] !== undefined && (frames[frame] as Frame).dividers[0] === i) {
      stack.push(frame)
      const f = frames[frame] as Frame
      if (f.kind === 'rect') {
        f.top = y + 8.0
        y = f.top
      } else {
        f.top = y + 12.0
        y = f.top + fmax(TAB_H, f.title.height + 2.0)
      }
    } else if (frame !== undefined) {
      stack.pop()
      const f = frames[frame]
      if (f === undefined) continue
      const bottom = y + 12.0
      const x = num(f.x0)
      const w = num(f.x1 - f.x0)
      const h = num(bottom - f.top)
      const top = num(f.top)
      if (f.kind === 'rect') {
        const fill = f.fill === '' ? '' : resolveStyle([`fill:${f.fill}`]).shape
        rectsOut.push(
          `<rect class="ondine-rect" x="${x}" y="${top}" width="${w}" height="${h}"${fill === '' ? ' fill-opacity="0.5"' : ''}${roundedStyle(fill)}/>`,
        )
      } else {
        const inner = buf(`<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="none"${ROUNDED_STYLE}/>`)
        for (let k = 0; k < f.dividerY.length; k++) {
          const dy = f.dividerY[k] as number
          const label = f.dividerLabels[k] ?? labelDefault()
          inner.s += '<path d="M'
          inner.s += x
          inner.s += ','
          pushNum(inner, dy)
          inner.s += 'H'
          pushNum(inner, f.x1)
          inner.s += DASH_END
          inner.s += backed(label, f.x0 + 8.0 + label.width / 2.0, dy + 2.0 + label.height / 2.0, frameLabelAttrs)
        }
        inner.s += '<rect x="'
        inner.s += x
        inner.s += '" y="'
        inner.s += top
        inner.s += '" width="'
        pushNum(inner, f.tabW)
        inner.s += '" height="'
        pushNum(inner, TAB_H)
        inner.s += TAB_END
        pushNum(inner, f.x0 + f.tabW / 2.0)
        inner.s += '" y="'
        pushNum(inner, f.top + TAB_H / 2.0 + tiny * 0.35)
        inner.s += '" text-anchor="middle" font-size="'
        pushNumber(inner, tiny)
        inner.s += '" font-weight="var(--_hw)" fill="var(--_m)" stroke="none">'
        inner.s += f.kind
        inner.s += '</text>'
        inner.s += backed(
          f.title,
          f.x0 + f.tabW + 8.0 + f.title.width / 2.0,
          f.top + fmax(TAB_H, f.title.height) / 2.0,
          frameLabelAttrs,
        )
        framesOut += '<g class="ondine-frame ondine-frame-'
        framesOut += f.kind
        framesOut += '">'
        framesOut += inner.s
        framesOut += '</g>'
      }
      y = bottom
    } else if (type === line.ALT_ELSE || type === line.PAR_AND || type === line.CRITICAL_OPTION) {
      const at = stack.length === 0 ? undefined : stack[stack.length - 1]
      const current = at === undefined ? undefined : frames[at]
      if (current !== undefined) {
        const height = current.dividerLabels[current.dividerY.length]?.height ?? 0.0
        current.dividerY.push(y + 12.0)
        y += 12.0 + (height > 0.0 ? height : 0.0)
      }
    } else {
      const view = views[i]
      if (view === undefined) continue
      if (view.kind === V.Note) {
        const a = cols[view.a]
        if (a === undefined) continue
        const h = view.label.height + 2.0 * fmax(4.0, notePad - 4.0)
        const top = y + 10.0
        let x = view.x
        if (m.placement === placement.RIGHT_OF) x += rightEdge(a, 0) - a.x
        else if (m.placement === placement.LEFT_OF) x += leftEdge(a, 0) - a.x
        boundsExtend(bounds, x, x + view.w)
        notesOut.s += '<g class="ondine-note" data-id="i'
        notesOut.s += escText(m.id)
        notesOut.s += '"><rect x="'
        pushNum(notesOut, x)
        notesOut.s += '" y="'
        pushNum(notesOut, top)
        notesOut.s += '" width="'
        pushNum(notesOut, view.w)
        notesOut.s += '" height="'
        pushNum(notesOut, h)
        notesOut.s += NOTE_END
        notesOut.s += labelSvg(
          view.label,
          x + view.w / 2.0,
          top + h / 2.0,
          ' class="ondine-label" stroke="none" fill="var(--_fg)"',
          undefined,
        )
        notesOut.s += '</g>'
        y = top + h
        continue
      }

      const st = type === undefined ? undefined : styleOf(type)
      if (st === undefined) continue
      const label = view.label
      const bw = badgeWidth(i)
      // The activation a `+` starts belongs to this message, so the arrow stops at its edge.
      let starting = 0
      for (let k = i + 1; k < count; k++) {
        const next = messages[k] as SeqMessage
        const t = next.type
        if (t === line.ACTIVE_START) {
          if (next.from === m.to) starting += 1
        } else if (
          !(t === line.ACTIVE_END || t === line.CENTRAL_CONNECTION || t === line.CENTRAL_CONNECTION_REVERSE)
        ) {
          break
        }
      }
      const up = st.bottom ? 1.0 : -1.0
      const attrs = st.dotted ? DASH : ''
      const cc = m.centralConnection
      const circleTo = cc === line.CENTRAL_CONNECTION || cc === line.CENTRAL_CONNECTION_DUAL
      const circleFrom = cc === line.CENTRAL_CONNECTION_REVERSE || cc === line.CENTRAL_CONNECTION_DUAL
      const tailAtEnd = st.atStart && !st.atEnd
      const headTrim = trimOf(st.head)
      const extra = buf()
      let lineY: number
      const path = buf()
      const heads = buf()
      const aAt = view.a
      const bAt = view.b

      if (view.kind === V.SelfLoop) {
        const a = cols[aAt]
        if (a === undefined) continue
        const top = y + msgGap + fmax(0.0, (label.height - SELF_H) / 2.0)
        const bottom = top + SELF_H
        let x0 = circleFrom ? a.x + CENTRAL_R : rightEdge(a, 0)
        let x1 = circleTo ? a.x + CENTRAL_R : rightEdge(a, starting)
        const out = fmax(x0, x1) + SELF_W + bw / 2.0
        if (circleFrom) circle(extra, a.x, top)
        if (circleTo) circle(extra, a.x, bottom)
        if (bw > 0.0) {
          extra.s += badge(i, tailAtEnd ? x1 : x0, tailAtEnd ? bottom : top, bw)
          if (tailAtEnd) x1 += bw / 2.0
          else x0 += bw / 2.0
        }
        // The loop leaves to the right and comes back heading left, which turns a half head over.
        if (st.atStart) head(heads, st.head, x0, top, -1.0, up)
        if (st.atEnd) head(heads, st.head, x1, bottom, -1.0, -up)
        const from = x0 + (st.atStart ? headTrim : 0.0)
        const to = x1 + (st.atEnd ? headTrim : 0.0)
        path.s += 'M'
        pushNum(path, from)
        path.s += ','
        pushNum(path, top)
        path.s += 'H'
        if (rightAngles) {
          pushNum(path, out)
          path.s += 'V'
          pushNum(path, bottom)
        } else {
          pushNum(path, out - 6.0)
          path.s += 'A6,6 0 0 1 '
          pushNum(path, out)
          path.s += ','
          pushNum(path, top + 6.0)
          path.s += 'V'
          pushNum(path, bottom - 6.0)
          path.s += 'A6,6 0 0 1 '
          pushNum(path, out - 6.0)
          path.s += ','
          pushNum(path, bottom)
        }
        path.s += 'H'
        pushNum(path, to)
        boundsExtend(bounds, a.x, out + 8.0 + label.width)
        if (label.width > 0.0) {
          labelsOut.s += '<g class="ondine-edge-label" data-id="i'
          labelsOut.s += escText(m.id)
          labelsOut.s += '">'
          labelsOut.s += labelSvg(label, out + 8.0 + label.width / 2.0, midpoint(top, bottom), '', undefined)
          labelsOut.s += '</g>'
        }
        lineY = bottom
      } else {
        const a = cols[aAt]
        const b = cols[bAt]
        if (a === undefined || b === undefined) continue
        const dir = b.x > a.x ? 1.0 : -1.0
        const creating = b.createAt === i
        lineY =
          y +
          msgGap +
          fmax(label.height > 0.0 ? label.height + 2.0 : 6.0, creating ? b.size.h / 2.0 - msgGap + 6.0 : 0.0)
        let x0 = dir > 0.0 ? rightEdge(a, 0) : leftEdge(a, 0)
        let x1 = dir > 0.0 ? leftEdge(b, starting) : rightEdge(b, starting)
        const bX = b.x
        const bSize = b.size
        const bKind = b.kind
        const aX = a.x
        if (creating) {
          b.top = lineY - bSize.h / 2.0
          b.lifeStart = b.top + bSize.h
          x1 = bX - dir * (isFigure(bKind) ? 18.0 : bSize.w / 2.0 + 1.0)
        }
        if (circleFrom) {
          circle(extra, aX, lineY)
          x0 = aX + dir * CENTRAL_R
        }
        if (circleTo) {
          circle(extra, bX, lineY)
          x1 = bX - dir * CENTRAL_R
        }
        if (bw > 0.0) {
          // The number sits on the lifeline at the tail of the arrow, past a connection circle if
          // there is one.
          if (tailAtEnd) {
            const cx = circleTo ? x1 - dir * (bw / 2.0 + 2.0) : x1
            extra.s += badge(i, cx, lineY, bw)
            x1 = cx - (dir * bw) / 2.0
          } else {
            const cx = circleFrom ? x0 + dir * (bw / 2.0 + 2.0) : x0
            extra.s += badge(i, cx, lineY, bw)
            x0 = cx + (dir * bw) / 2.0
          }
        }
        if (st.atStart) head(heads, st.head, x0, lineY, -dir, up * dir)
        if (st.atEnd) head(heads, st.head, x1, lineY, dir, up * dir)
        const from = x0 + (st.atStart ? dir * headTrim : 0.0)
        const to = x1 - (st.atEnd ? dir * headTrim : 0.0)
        path.s += 'M'
        pushNum(path, from)
        path.s += ','
        pushNum(path, lineY)
        path.s += 'H'
        pushNum(path, to)
        if (label.width > 0.0) {
          const l = fmin(x0, x1)
          const r = fmax(x0, x1)
          const cx =
            align === -1
              ? l + msgPad + label.width / 2.0
              : align === 1
                ? r - msgPad - label.width / 2.0
                : midpoint(l, r)
          boundsExtend(bounds, cx - label.width / 2.0, cx + label.width / 2.0)
          labelsOut.s += '<g class="ondine-edge-label" data-id="i'
          labelsOut.s += escText(m.id)
          labelsOut.s += '">'
          labelsOut.s += backed(label, cx, lineY - 4.0 - label.height / 2.0, '')
          labelsOut.s += '</g>'
        }
        if (creating) y = lineY + bSize.h / 2.0 - 6.0
      }
      edgesOut.s += '<g class="ondine-edge ondine-message" data-id="i'
      edgesOut.s += escText(m.id)
      edgesOut.s += '"><path d="'
      edgesOut.s += path.s
      edgesOut.s += attrs === '' ? '"/>' : DASH_END
      edgesOut.s += heads.s
      edgesOut.s += extra.s
      edgesOut.s += '</g>'
      y = fmax(y, lineY)
      const a = cols[aAt]
      if (a !== undefined && a.destroyAt === i) y = fmax(y, destroy(a, lineY))
      const b = cols[bAt]
      if (bAt !== aAt && b !== undefined && b.destroyAt === i) y = fmax(y, destroy(b, lineY))
    }
  }

  y += 20.0
  for (const col of cols) {
    while (col.activations.length !== 0) endActivation(col, y)
  }
  let bottom = y
  if (mirror) {
    let footH = 0.0
    for (const col of cols) {
      if (col.lifeEnd !== undefined) continue
      footH = fmax(footH, col.size.h)
      actorsOut += actorSvg(col, y, true)
    }
    bottom = y + footH
  }
  const lifelines = buf()
  for (const col of cols) {
    actorsOut += actorSvg(col, col.top, false)
    const end = col.lifeEnd ?? y
    if (end > col.lifeStart) {
      lifelines.s += '<path class="ondine-lifeline" data-id="'
      lifelines.s += escText(col.id)
      lifelines.s += '" d="M'
      pushNum(lifelines, col.x)
      lifelines.s += ','
      pushNum(lifelines, col.lifeStart)
      lifelines.s += 'V'
      pushNum(lifelines, end)
      lifelines.s += '"/>'
    }
  }

  const boxesOut = buf()
  for (const run of runs) {
    const x0 = colX(cols, run.first) - colW(cols, run.first) / 2.0 - boxPad - run.grow
    const x1 = colX(cols, run.last) + colW(cols, run.last) / 2.0 + boxPad + run.grow
    const box = db.boxes[run.box]
    const fill = box !== undefined && box.fill !== 'transparent' ? resolveStyle([`fill:${box.fill}`]).shape : ''
    boxesOut.s += '<g class="ondine-cluster ondine-box"'
    const name = box?.name
    if (name !== undefined && name !== '') {
      boxesOut.s += ' data-id="'
      boxesOut.s += escText(name)
      boxesOut.s += '"'
    }
    boxesOut.s += '><rect x="'
    pushNum(boxesOut, x0)
    boxesOut.s += '" y="0" width="'
    pushNum(boxesOut, x1 - x0)
    boxesOut.s += '" height="'
    pushNum(boxesOut, bottom + boxPad)
    boxesOut.s += BOX_END
    if (fill === '') boxesOut.s += ' fill-opacity="0.5"'
    boxesOut.s += roundedStyle(fill)
    boxesOut.s += '/>'
    boxesOut.s += labelSvg(
      run.title,
      midpoint(x0, x1),
      boxPad / 2.0 + 2.0 + run.title.height / 2.0,
      ' class="ondine-cluster-label" fill="var(--_m)"',
      undefined,
    )
    boxesOut.s += '</g>'
  }
  if (runs.length !== 0) bottom += boxPad

  let minY = 0.0
  let titleOut = ''
  const title = text(db.title, size, false, tight ? titleRoom(options) : wrapW, BOLD)
  if (bounds.minX > bounds.maxX) boundsExtend(bounds, 0.0, fmax(title.width, 40.0))
  if (title.width > 0.0) {
    const cx = midpoint(bounds.minX, bounds.maxX)
    boundsExtend(bounds, cx - title.width / 2.0, cx + title.width / 2.0)
    minY = -title.height - 12.0
    titleOut = labelSvg(
      title,
      cx,
      minY + title.height / 2.0,
      ' class="ondine-title" font-weight="var(--_tw)"',
      undefined,
    )
  }

  const width = Math.ceil(bounds.maxX - bounds.minX + 2.0 * pad)
  const height = Math.ceil(bottom - minY + 2.0 * pad)
  const content = buf('<g transform="translate(')
  pushNum(content, pad - bounds.minX)
  content.s += ','
  pushNum(content, pad - minY)
  content.s += ')">'
  content.s += titleOut
  const group = (content: Buf, open: string, inner: string): void => {
    if (inner !== '') {
      content.s += open
      content.s += inner
      content.s += '</g>'
    }
  }
  const smallAttr = buf()
  pushNumber(smallAttr, small)
  group(content, `<g class="ondine-boxes" font-size="${smallAttr.s}">`, boxesOut.s)
  rectsOut.reverse()
  group(content, '<g class="ondine-rects" fill="var(--_a)">', rectsOut.join(''))
  group(content, '<g class="ondine-lifelines" fill="none" stroke="var(--_b)">', lifelines.s)
  activationsOut.reverse()
  group(
    content,
    '<g class="ondine-activations" fill="var(--_s)" stroke="var(--_b)">',
    activationsOut.join(''),
  )
  group(content, `<g class="ondine-frames" font-size="${smallAttr.s}" stroke="var(--_b)">`, framesOut)
  group(
    content,
    '<g class="ondine-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">',
    edgesOut.s,
  )
  group(
    content,
    '<g class="ondine-destroys" fill="none" stroke="var(--_l)" stroke-width="1.5" stroke-linecap="round">',
    crossesOut.s,
  )
  group(content, `<g class="ondine-edge-labels" font-size="${smallAttr.s}">`, labelsOut.s)
  group(
    content,
    `<g class="ondine-notes" font-size="${smallAttr.s}" fill="var(--_a)" stroke="var(--_b)">`,
    notesOut.s,
  )
  group(content, '<g class="ondine-nodes">', actorsOut)
  content.s += '</g>'

  const accessible: Accessible = { accDescr: db.accDescr, accTitle: db.accTitle }
  const svg = svgDocument('sequence', width, height, size, options, accessible, content.s)
  return { height, links: [], svg, width }
}
