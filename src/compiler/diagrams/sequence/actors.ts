/** @module Participant shapes. Port of Pele's `src/diagrams/sequence/actors.ts`. */
import { labelSvg, pushNum } from '../../svg/builder.ts'
import { ROUNDED_STYLE } from '../../svg/theme.ts'
import type { Label } from '../../text/label.ts'
import { type Buf, fmax } from '../../util/rust.ts'

const PAD_X = 16.0
const PAD_Y = 10.0
const GLYPH = 34.0
const GLYPH_GAP = 4.0
const STACK = 5.0
const CAP = 6.0
const SHAPE = ' fill="var(--_s)" stroke="var(--_b)"'
const LINE = ' fill="none" stroke="var(--_b)"'
/** The end of a path drawn as a line. */
const LINE_END = `"${LINE}/>`

const KINDS: readonly string[] = [
  'participant',
  'actor',
  'boundary',
  'control',
  'entity',
  'database',
  'collections',
  'queue',
]

/** A participant's size. */
export type ActorSize = {
  /** The height. */
  h: number
  /** The width. */
  w: number
}

/** A zero size. */
export function actorSizeDefault(): ActorSize {
  return { h: 0, w: 0 }
}

/**
 * The drawn kind of a participant type: the type when Pele draws it, and `participant` otherwise.
 */
export function actorKind(type: string): string {
  return KINDS.find((kind) => kind === type) ?? 'participant'
}

/** Whether `kind` is a figure, which stands above its label. The other kinds hold the label inside. */
export function isFigure(kind: string): boolean {
  return kind === 'actor' || kind === 'boundary' || kind === 'control' || kind === 'entity' || kind === 'database'
}

/**
 * The size of a participant of `kind` with `label`, at least `minW` by `minH` for the kinds that
 * hold their label.
 */
export function actorSize(
  kind: string,
  label: Label,
  minW: number,
  minH: number,
  paddingX: number | undefined,
): ActorSize {
  if (isFigure(kind)) {
    return {
      h: GLYPH + (label.height > 0 ? GLYPH_GAP + label.height : 0),
      w: fmax(40.0, label.width + 8.0),
    }
  }
  const padX = paddingX ?? PAD_X
  const extra = kind === 'collections' ? STACK : kind === 'queue' ? 2.0 * CAP : 0.0
  return {
    h: fmax(minH, label.height + 2.0 * PAD_Y) + (kind === 'collections' ? STACK : 0.0),
    w: fmax(minW, label.width + 2.0 * padX) + extra,
  }
}

/** The end of a closed shape path and the start of the next path. */
const SHAPE_PATH = `Z"${SHAPE}/><path d="M`

/** Appends `x,y`. */
function point(out: Buf, x: number, y: number): void {
  pushNum(out, x)
  out.s += ','
  pushNum(out, y)
}

function circle(out: Buf, cx: number, cy: number, r: number): void {
  out.s += '<circle cx="'
  pushNum(out, cx)
  out.s += '" cy="'
  pushNum(out, cy)
  out.s += '" r="'
  pushNum(out, r)
  out.s += CIRCLE_END
}

const CIRCLE_END = `"${SHAPE}/>`

function figure(out: Buf, kind: string, cx: number, top: number): void {
  switch (kind) {
    case 'actor':
      circle(out, cx, top + 7.0, 6.0)
      out.s += '<path d="M'
      point(out, cx, top + 13.0)
      out.s += 'V'
      pushNum(out, top + 24.0)
      out.s += 'M'
      point(out, cx - 10.0, top + 17.0)
      out.s += 'H'
      pushNum(out, cx + 10.0)
      out.s += 'M'
      point(out, cx - 8.0, top + 34.0)
      out.s += 'L'
      point(out, cx, top + 24.0)
      out.s += 'L'
      point(out, cx + 8.0, top + 34.0)
      out.s += LINE_END
      break
    case 'boundary':
      out.s += '<path d="M'
      point(out, cx - 19.0, top + 6.0)
      out.s += 'V'
      pushNum(out, top + 28.0)
      out.s += 'M'
      point(out, cx - 19.0, top + 17.0)
      out.s += 'H'
      pushNum(out, cx - 8.0)
      out.s += LINE_END
      circle(out, cx + 3.0, top + 17.0, 11.0)
      break
    case 'control':
      circle(out, cx, top + 21.0, 11.0)
      out.s += '<path d="M'
      point(out, cx + 5.0, top + 5.0)
      out.s += 'L'
      point(out, cx - 1.0, top + 10.0)
      out.s += 'L'
      point(out, cx + 5.0, top + 15.0)
      out.s += LINE_END
      break
    case 'entity':
      circle(out, cx, top + 15.0, 11.0)
      out.s += '<path d="M'
      point(out, cx - 11.0, top + 30.0)
      out.s += 'H'
      pushNum(out, cx + 11.0)
      out.s += LINE_END
      break
    default: {
      const l = cx - 14.0
      const r = cx + 14.0
      out.s += '<path d="M'
      point(out, l, top + 7.0)
      out.s += 'V'
      pushNum(out, top + 27.0)
      out.s += 'A14,5 0 0 0 '
      point(out, r, top + 27.0)
      out.s += 'V'
      pushNum(out, top + 7.0)
      out.s += 'A14,5 0 0 0 '
      point(out, l, top + 7.0)
      out.s += SHAPE_PATH
      point(out, l, top + 7.0)
      out.s += 'A14,5 0 0 0 '
      point(out, r, top + 7.0)
      out.s += LINE_END
    }
  }
}

function rect(out: Buf, x: number, y: number, w: number, h: number): void {
  out.s += '<rect x="'
  pushNum(out, x)
  out.s += '" y="'
  pushNum(out, y)
  out.s += '" width="'
  pushNum(out, w)
  out.s += '" height="'
  pushNum(out, h)
  out.s += RECT_END
}

/** The end of a rectangle, with its themed radius already in its style, as `ROUNDED_STYLE` explains. */
const RECT_END = `"${SHAPE}${ROUNDED_STYLE}/>`

/** Draws a participant whose bounding box has its top center at (`cx`, `top`). */
export function drawActor(out: Buf, kind: string, cx: number, top: number, size: ActorSize, label: Label): void {
  const { h, w } = size
  const text = ' class="ondine-label"'
  if (isFigure(kind)) {
    figure(out, kind, cx, top)
    out.s += labelSvg(label, cx, top + GLYPH + GLYPH_GAP + label.height / 2.0, text, undefined)
    return
  }
  const left = cx - w / 2.0
  if (kind === 'collections') {
    const bw = w - STACK
    const bh = h - STACK
    rect(out, left + STACK, top, bw, bh)
    rect(out, left, top + STACK, bw, bh)
    out.s += labelSvg(label, left + bw / 2.0, top + STACK + bh / 2.0, text, undefined)
    return
  }
  if (kind === 'queue') {
    const l = left + CAP
    const r = left + w - CAP
    const b = top + h
    const ry = h / 2.0
    const arc = (out: Buf, sweep: string, x: number, y: number): void => {
      out.s += 'A'
      pushNum(out, CAP)
      out.s += ','
      pushNum(out, ry)
      out.s += ' 0 0 '
      out.s += sweep
      out.s += ' '
      point(out, x, y)
    }
    out.s += '<path d="M'
    point(out, l, top)
    out.s += 'H'
    pushNum(out, r)
    arc(out, '1', r, b)
    out.s += 'H'
    pushNum(out, l)
    arc(out, '1', l, top)
    out.s += SHAPE_PATH
    point(out, r, top)
    arc(out, '0', r, b)
    out.s += LINE_END
    out.s += labelSvg(label, cx - CAP / 2.0, top + h / 2.0, text, undefined)
    return
  }
  rect(out, left, top, w, h)
  out.s += labelSvg(label, cx, top + h / 2.0, text, undefined)
}
