/**
 * @module Draws a railroad diagram: each rule's name above a track through its definition. Port of
 * Pele's `src/diagrams/railroad/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { tighten, titleRoom } from '../common/fit_width.ts'
import { esc, escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { FONT_MONO, RADIUS } from '../../svg/theme.ts'
import { decode } from '../../text/entities.ts'
import { layoutLabel } from '../../text/label.ts'
import { BOLD, ITALIC, MONO, width as measureWidth } from '../../text/measure.ts'
import { type Buf, buf, cmpNum, fmax, fmin } from '../../util/rust.ts'
import { pushNumber, type Value } from '../../yaml.ts'
import { fold, NONE } from './common.ts'
import { type RailroadModel, railroadNodeParts } from './types.ts'

/** What a laid-out element draws. */
const Kind = {
  /** Alternatives stacked between two rails. */
  Choice: 'Choice',
  /** An element with a track over it that skips it. */
  Bypass: 'Bypass',
  /** A sequence folded into rows. */
  Folded: 'Folded',
  /** An element with a track under it that goes back. */
  Loop: 'Loop',
  /** A reference to another rule. */
  NonTerminal: 'NonTerminal',
  /** Elements one after another. */
  Sequence: 'Sequence',
  /** Text that stands for something the grammar does not spell out. */
  Special: 'Special',
  /** Literal text. */
  Terminal: 'Terminal',
} as const
type Kind = (typeof Kind)[keyof typeof Kind]

/**
 * A laid-out element. The track enters at the left edge and leaves at the right edge on one
 * baseline, with `up` above it and `down` below it.
 */
type LaidOut = {
  /** How far the element reaches below the baseline. */
  down: number
  /** The name a non-terminal refers to. */
  id: string
  /** The element's parts, as indices into the layout arena. */
  kids: number[]
  /** What the element draws. */
  kind: Kind
  /** How far a bypass rises above the baseline, or a loop drops below it. */
  reach: number
  /** A leaf's text, or a loop's count. */
  text: string
  /** How far the element reaches above the baseline. */
  up: number
  /** The width. */
  width: number
}

/** Sizes the layout shares. */
type Metrics = {
  /** Corner radius of the track's turns. */
  arc: number
  /** Space between elements in a sequence. */
  gap: number
  /** Height of a leaf. */
  height: number
  /** Space beside a leaf's text. */
  padding: number
  /** Space between stacked branches. */
  sep: number
  /** Font size of leaves. */
  size: number
}

/** Space before and after a rule's track. */
const LEAD = 12.0
/** Space between a rule's name and its track. */
const HEAD_GAP = 6.0
/** Space between rules. */
const RULE_GAP = 18.0
/** Font size of a loop's count. */
const COUNT_SIZE = 12.0
/** Length of an arrowhead. */
const ARROW = 7.0

/** The `railroad` section of `config`, when it is a mapping. */
function section(config: Value): [string, Value][] | undefined {
  if (config.kind !== 'Object') return undefined
  const found = config._0.find(([key]) => key === 'railroad')
  if (found === undefined || found[1].kind !== 'Object') return undefined
  return found[1]._0
}

/** The `railroad` option `key` when it is a number at least 0, capped at `max`, or `fallback`. */
function option(config: Value, key: string, fallback: number, max: number): number {
  const found = section(config)?.find(([own]) => own === key)
  if (found !== undefined && found[1].kind === 'Number' && found[1]._0 >= 0.0) return fmin(found[1]._0, max)
  return fallback
}

/**
 * Text is literal here: a terminal such as "<br>" or "*" is itself, not markup. Mermaid's `#35;`
 * codes still stand for characters, and escapes that would be invisible are written out.
 */
function shown(text: string): string {
  const decoded = text.includes('¶ß') ? decode(text.replaceAll('&', '&amp;')) : text
  let first = -1
  for (let i = 0; i < decoded.length; i++) {
    const c = decoded.charCodeAt(i)
    if (c === 0x0a || c === 0x0d || c === 0x09) {
      first = i
      break
    }
  }
  if (first < 0) return decoded
  let out = decoded.slice(0, first)
  for (let i = first; i < decoded.length; i++) {
    const c = decoded.charCodeAt(i)
    if (c === 0x0a) out += '\\n'
    else if (c === 0x0d) out += '\\r'
    else if (c === 0x09) out += '\\t'
    else out += decoded[i]
  }
  return out
}

/** `Math.ceil(value / 2) * 2`. */
function even(value: number): number {
  return Math.ceil(value / 2.0) * 2.0
}

/** The arena of laid-out elements. */
type Boxes = LaidOut[]

/** Adds `item` to `boxes`, returning its index. */
function add(boxes: Boxes, item: LaidOut): number {
  boxes.push(item)
  return boxes.length - 1
}

/** The empty element. It is never changed. */
const EMPTY: LaidOut = {
  down: 0.0,
  id: '',
  kids: [],
  kind: Kind.Sequence,
  reach: 0.0,
  text: '',
  up: 0.0,
  width: 0.0,
}

/** The element at `index`, or an empty one. */
function get(boxes: Boxes, index: number): LaidOut {
  return boxes[index] ?? EMPTY
}

/** A leaf of `kind` showing `text`. */
function leaf(boxes: Boxes, kind: Kind, text: string, id: string, style: number, m: Metrics): number {
  const half = m.height / 2.0
  const width = fmax(even(measureWidth(text, m.size, style) + 2.0 * m.padding), m.height)
  return add(boxes, { down: half, id, kids: [], kind, reach: 0.0, text, up: half, width })
}

/** The count under a loop, or empty for one or more. */
function count(min: number, max: number): string {
  if (max === Number.POSITIVE_INFINITY && min <= 1.0) return ''
  const text = (value: number): string => {
    if (Number.isFinite(value)) {
      const out = buf()
      pushNumber(out, value)
      return out.s
    }
    return '∞'
  }
  if (min === max) return `${text(min)}×`
  let out = ''
  if (max === Number.POSITIVE_INFINITY) {
    out += '≥'
    out += text(min)
  } else if (min === 0.0) {
    out += '≤'
    out += text(max)
  } else {
    out += text(min)
    out += '–'
    out += text(max)
  }
  out += '×'
  return out
}

/** Where the next branch of a choice sits below the baseline, given the one above it. */
function below(offset: number, above: LaidOut, branch: LaidOut, m: Metrics): number {
  return fmax(offset + above.down + m.sep + branch.up, 2.0 * m.arc)
}

/** A track over `kid` that skips it. */
function bypass(boxes: Boxes, kid: number, m: Metrics): number {
  const inner = get(boxes, kid)
  const reach = fmax(inner.up + m.sep, 2.0 * m.arc)
  return add(boxes, {
    down: inner.down,
    id: '',
    kids: [kid],
    kind: Kind.Bypass,
    reach,
    text: '',
    up: reach,
    width: inner.width + 4.0 * m.arc,
  })
}

/** A sequence or row of `kids` with no folding. */
function row(boxes: Boxes, kids: number[], width: number): LaidOut {
  let up = 0.0
  let down = 0.0
  for (const index of kids) {
    const kid = boxes[index]
    if (kid !== undefined) {
      up = fmax(up, kid.up)
      down = fmax(down, kid.down)
    }
  }
  return { down, id: '', kids, kind: Kind.Sequence, reach: 0.0, text: '', up, width }
}

/** Lays out the definition `root` of `model` no wider than `room`, when it is finite. */
function measure(model: RailroadModel, root: number, m: Metrics, room: number, boxes: Boxes): number {
  const parts = (node: number): number[] => {
    const found = model.nodes[node]
    return found === undefined ? [] : railroadNodeParts(found)
  }
  const budgets: [number, number][] = []
  const pending: [number, number][] = [[root, room]]
  let i = 0
  while (room !== Number.POSITIVE_INFINITY) {
    const next = pending[i]
    if (next === undefined) break
    const [node, width] = next
    budgets.push([node, width])
    // A sequence that folds puts its rows inside rails, so its parts are sized for those
    // rows.
    const found = model.nodes[node]
    let around = 0.0
    if (found !== undefined) {
      switch (found.kind) {
        case 'Choice':
        case 'Optional':
          around = 4.0 * m.arc
          break
        case 'Repetition':
          around = (found.min === 0.0 ? 6.0 : 2.0) * m.arc
          break
        case 'Sequence':
          around = 6.0 * m.arc
          break
        default:
          around = 0.0
      }
    }
    for (const child of parts(node)) pending.push([child, fmax(40.0, width - around)])
    i += 1
  }
  // Each node of a definition appears once, so the budgets are in the order nodes were met.
  budgets.sort((a, b) => cmpNum(a[0], b[0]))

  return fold<number>(root, parts, (node, kids) => {
    const room = budgetOf(budgets, node)
    const found = model.nodes[node]
    if (found === undefined) return NONE
    switch (found.kind) {
      case 'Terminal': {
        let text = shown(found._0)
        if (text !== '' && /^ +$/.test(text)) text = '␣'.repeat(text.length)
        return leaf(boxes, Kind.Terminal, text, '', MONO, m)
      }
      case 'NonTerminal':
        return leaf(boxes, Kind.NonTerminal, shown(found._0), found._0, 0, m)
      case 'Special':
        return leaf(boxes, Kind.Special, `? ${shown(found._0)} ?`, '', ITALIC, m)
      case 'Sequence':
        return sequence(boxes, kids, room, m)
      case 'Choice': {
        let inner = 0.0
        let offset = 0.0
        for (let i = 0; i < kids.length; i++) {
          const kid = kids[i] as number
          const current = get(boxes, kid)
          inner = fmax(inner, current.width)
          if (i > 0) {
            const above = get(boxes, kids[i - 1] ?? kid)
            offset = below(offset, above, current, m)
          }
        }
        const firstKid = kids[0]
        const lastKid = kids[kids.length - 1]
        const up = firstKid === undefined ? 0.0 : get(boxes, firstKid).up
        const down = lastKid === undefined ? 0.0 : offset + get(boxes, lastKid).down
        return add(boxes, {
          down,
          id: '',
          kids,
          kind: Kind.Choice,
          reach: 0.0,
          text: '',
          up,
          width: inner + 4.0 * m.arc,
        })
      }
      case 'Optional':
        return bypass(boxes, kids[0] ?? NONE, m)
      case 'Repetition': {
        const { min, max } = found
        const kid = kids[0] ?? NONE
        if (min === 1.0 && max === 1.0) return kid
        const inner = get(boxes, kid)
        const text = count(min, max)
        const reach = fmax(inner.down + m.sep, 2.0 * m.arc)
        const label = text === '' ? 0.0 : even(measureWidth(text, COUNT_SIZE, 0))
        const down = reach + (text === '' ? ARROW / 2.0 + 1.0 : COUNT_SIZE + 6.0)
        const repeated = add(boxes, {
          down,
          id: '',
          kids: [kid],
          kind: Kind.Loop,
          reach,
          text,
          up: inner.up,
          width: fmax(inner.width, label) + 2.0 * m.arc,
        })
        return min === 0.0 ? bypass(boxes, repeated, m) : repeated
      }
    }
  })
}

/**
 * The budget of `node` in `budgets`, sorted by node, or infinity. The search is Rust's
 * `binary_search_by`, so ties resolve to the same entry.
 */
function budgetOf(budgets: [number, number][], node: number): number {
  let size = budgets.length
  if (size === 0) return Number.POSITIVE_INFINITY
  let base = 0
  while (size > 1) {
    const half = size >> 1
    const mid = base + half
    if (cmpNum(budgets[mid]![0], node) <= 0) base = mid
    size -= half
  }
  const found = budgets[base]!
  return cmpNum(found[0], node) === 0 ? found[1] : Number.POSITIVE_INFINITY
}

/** A sequence of `kids`, folded into rows when it is wider than `room`. */
function sequence(boxes: Boxes, kids: number[], room: number, m: Metrics): number {
  let width = Math.max(kids.length - 1, 0) * m.gap
  for (const kid of kids) width += get(boxes, kid).width
  if (width <= room || kids.length < 2) {
    const whole = row(boxes, kids, width)
    return add(boxes, whole)
  }

  const rows: number[] = []
  let current: number[] = []
  let currentWidth = 0.0
  const limit = fmax(40.0, room - 6.0 * m.arc)
  for (const kid of kids) {
    const kidWidth = get(boxes, kid).width
    if (current.length > 0 && currentWidth + m.gap + kidWidth > limit) {
      const full = row(boxes, current, currentWidth)
      current = []
      rows.push(add(boxes, full))
      currentWidth = 0.0
    }
    currentWidth += (current.length === 0 ? 0.0 : m.gap) + kidWidth
    current.push(kid)
  }
  const last = row(boxes, current, currentWidth)
  rows.push(add(boxes, last))
  if (rows.length < 2) {
    const whole = row(boxes, kids, width)
    return add(boxes, whole)
  }

  let foldedWidth = 0.0
  let offset = 0.0
  for (let i = 0; i < rows.length; i++) {
    const each = rows[i] as number
    const current = get(boxes, each)
    foldedWidth = fmax(foldedWidth, current.width)
    if (i > 0) {
      const above = get(boxes, rows[i - 1] ?? each)
      offset += above.down + fmax(m.sep, 2.0 * m.arc) + current.up
    }
  }
  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]
  const up = firstRow === undefined ? 0.0 : get(boxes, firstRow).up
  const down = offset + (lastRow === undefined ? 0.0 : get(boxes, lastRow).down)
  return add(boxes, {
    down,
    id: '',
    kids: rows,
    kind: Kind.Folded,
    reach: 0.0,
    text: '',
    up,
    width: foldedWidth + 6.0 * m.arc,
  })
}

/** Draws `model` with the `railroad` section of `config`. */
export function render(model: RailroadModel, config: Value, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(model, config, options, tight))
}

/** Reverses `list` from `from` to its end. */
function reverse<T>(list: T[], from: number): void {
  if (from > list.length) return
  let a = from
  let b = list.length - 1
  while (a < b) {
    const x = list[a] as T
    list[a] = list[b] as T
    list[b] = x
    a += 1
    b -= 1
  }
}

/** The paths and text drawn for one rule. */
type Drawing = {
  /** Arrowheads. */
  arrows: Buf
  /** The layout arena. */
  boxes: Boxes
  /** Leaves and counts. */
  nodes: Buf
  /** The track. */
  track: Buf
}

/** A straight piece of track, when it has length. */
function drawingLine(drawing: Drawing, x1: number, y: number, x2: number): void {
  if (x2 > x1) drawing.track.s += `M${num(x1)},${num(y)}H${num(x2)}`
}

/** The turns of the track, as relative arcs. */
type Turns = {
  /** From running east to running north. */
  eastToNorth: string
  /** From running east to running south. */
  eastToSouth: string
  /** From running east to running south, turning back west. */
  loopDown: string
  /** From running west to running north, turning back. */
  loopUp: string
  /** From running north to running east. */
  northToEast: string
  /** From running south to running east. */
  southToEast: string
}

/** The turns of radius `arc`. */
function turnsNew(arc: number): Turns {
  const a = num(arc)
  const turn = (sweep: string, dx: string, dy: string): string => `a${a},${a} 0 0 ${sweep} ${dx}${a},${dy}${a}`
  return {
    eastToNorth: turn('0', '', '-'),
    eastToSouth: turn('1', '', ''),
    loopDown: turn('0', '-', ''),
    loopUp: turn('0', '-', '-'),
    northToEast: turn('1', '', '-'),
    southToEast: turn('0', '', ''),
  }
}

/** Appends `M{x},{y}`. */
function pushMove(out: Buf, x: number, y: number): void {
  out.s += `M${num(x)},${num(y)}`
}

/** Appends a letter and a number, such as `H12`. */
function pushStep(out: Buf, letter: string, value: number): void {
  out.s += letter + num(value)
}

/** Leaf drawing settings. */
type Leaves = {
  /** Half a leaf's height. */
  boxTop: number
  /** The leaf height. */
  height: number
  /** The stroke width attribute, or empty. */
  stroke: string
  /** How far text sits below the baseline. */
  textShift: number
}

/**
 * Draws the laid-out element `root` with its track entering at (`left`, `baseline`). The walk
 * keeps its own stack, so deep definitions do not overflow.
 */
function place(
  drawing: Drawing,
  root: number,
  left: number,
  baseline: number,
  m: Metrics,
  turns: Turns,
  leaves: Leaves,
): void {
  const arc = m.arc
  const stack: number[] = [root]
  const at: number[] = [left, baseline]
  for (;;) {
    const index = stack.pop()
    if (index === undefined) break
    const y = at.pop()
    const x = at.pop()
    if (y === undefined || x === undefined) break
    const item = get(drawing.boxes, index)
    const kids = item.kids
    const right = x + item.width
    switch (item.kind) {
      case Kind.Sequence: {
        let kx = right
        for (let i = kids.length - 1; i >= 0; i--) {
          const kid = kids[i] as number
          kx -= get(drawing.boxes, kid).width
          stack.push(kid)
          at.push(kx)
          at.push(y)
          if (i > 0) drawingLine(drawing, kx - m.gap, y, kx)
          kx -= m.gap
        }
        break
      }
      case Kind.Folded: {
        const start = x + 2.0 * arc
        const from = stack.length
        let offset = 0.0
        drawingLine(drawing, x, y, start)
        const step = fmax(m.sep, 2.0 * arc)
        for (let i = 0; i < kids.length; i++) {
          const kid = kids[i] as number
          const current = get(drawing.boxes, kid)
          const ky = y + offset
          stack.push(kid)
          at.push(ky)
          at.push(start)
          const nextIndex = kids[i + 1]
          if (nextIndex !== undefined) {
            const next = get(drawing.boxes, nextIndex)
            const nextOffset = offset + current.down + step + next.up
            const mid = y + offset + current.down + step / 2.0
            drawing.track.s += `M${num(start + current.width)},${num(ky)}H${num(right - 2.0 * arc)}V${num(mid)}H${num(x + arc)}V${num(y + nextOffset)}H${num(start)}`
            drawing.arrows.s += `M${num(start - ARROW)},${num(y + nextOffset - ARROW / 2.0)}l7,3.5l-7,3.5z`
            offset = nextOffset
          } else {
            drawing.track.s += `M${num(start + current.width)},${num(ky)}H${num(right - arc)}V${num(y)}H${num(right)}`
          }
        }
        reverse(stack, from)
        reverse(at, 2 * from)
        break
      }
      case Kind.Choice: {
        const inner = item.width - 4.0 * arc
        const railIn = x + arc
        const railOut = right - arc
        const from = stack.length
        let offset = 0.0
        for (let i = 0; i < kids.length; i++) {
          const kid = kids[i] as number
          const current = get(drawing.boxes, kid)
          if (i > 0) {
            const above = get(drawing.boxes, kids[i - 1] ?? kid)
            offset = below(offset, above, current, m)
          }
          const ky = y + offset
          const kx = x + 2.0 * arc + (inner - current.width) / 2.0
          const last = i + 1 === kids.length
          if (i === 0) {
            drawingLine(drawing, x, y, kx)
            drawingLine(drawing, kx + current.width, y, right)
          } else {
            const t = drawing.track
            const enter = last ? `M${num(x)},${num(y)}${turns.eastToSouth}V${num(ky - arc)}` : `M${num(railIn)},${num(ky - arc)}`
            const wide = kx > railIn + arc
            const into = wide ? `H${num(kx)}` : ''
            const out = wide ? `H${num(railOut - arc)}` : ''
            const leave = last ? `V${num(y + arc)}${turns.northToEast}` : ''
            t.s += `${enter}${turns.southToEast}${into}M${num(kx + current.width)},${num(ky)}${out}${turns.eastToNorth}${leave}`
          }
          stack.push(kid)
          at.push(ky)
          at.push(kx)
        }
        // Reversed, so that the branches come off the stack top to bottom.
        reverse(stack, from)
        reverse(at, 2 * from)
        break
      }
      case Kind.Bypass: {
        const kid = kids[0] ?? NONE
        const inner = get(drawing.boxes, kid)
        const kx = x + 2.0 * arc
        drawingLine(drawing, x, y, kx)
        drawingLine(drawing, kx + inner.width, y, right)
        drawing.track.s += `M${num(x)},${num(y)}${turns.eastToNorth}V${num(y - item.reach + arc)}${turns.northToEast}H${num(right - 2.0 * arc)}${turns.eastToSouth}V${num(y - arc)}${turns.southToEast}`
        stack.push(kid)
        at.push(kx)
        at.push(y)
        break
      }
      case Kind.Loop: {
        const kid = kids[0] ?? NONE
        const inner = get(drawing.boxes, kid)
        const kx = x + (item.width - inner.width) / 2.0
        const loopY = y + item.reach
        const middle = x + item.width / 2.0
        drawingLine(drawing, x, y, kx)
        drawingLine(drawing, kx + inner.width, y, right)
        drawing.track.s += `M${num(x + arc)},${num(y)}${turns.loopDown}V${num(loopY - arc)}${turns.southToEast}H${num(right - arc)}${turns.eastToNorth}V${num(y + arc)}${turns.loopUp}`
        drawing.arrows.s += `M${num(middle - ARROW / 2.0)},${num(loopY)}l7,-3.5v7z`
        if (item.text !== '') {
          drawing.nodes.s += `<text class="ondine-edge-label ondine-count" x="${num(middle)}" y="${num(loopY + COUNT_SIZE + 3.0)}" font-size="12" fill="var(--_m)">${esc(item.text)}</text>`
        }
        stack.push(kid)
        at.push(kx)
        at.push(y)
        break
      }
      case Kind.Terminal:
      case Kind.NonTerminal:
      case Kind.Special:
        pushLeaf(drawing.nodes, item, x, y, leaves)
        break
    }
  }
}

/** Draws a leaf whose track enters at (`x`, `y`). */
function pushLeaf(out: Buf, item: LaidOut, x: number, y: number, leaves: Leaves): void {
  const text = item.text
  const space =
    text.startsWith(' ') || text.endsWith(' ') || text.includes('  ') ? ' xml:space="preserve"' : ''
  const shape = `<rect x="${num(x)}" y="${num(y - leaves.boxTop)}" width="${num(item.width)}" height="${num(leaves.height)}"`
  const label = `<text x="${num(x + item.width / 2.0)}" y="${num(y + leaves.textShift)}"${space}`

  switch (item.kind) {
    case Kind.Terminal:
      out.s += `<g class="ondine-node ondine-terminal">${shape} rx="${num(leaves.boxTop)}" fill="var(--_s)" stroke="var(--_b)"${leaves.stroke}/>${label} font-family="${FONT_MONO}">${esc(text)}</text></g>`
      break
    case Kind.NonTerminal:
      out.s += `<g class="ondine-node ondine-nonterminal" data-id="${escText(item.id)}">${shape} rx="${RADIUS}" fill="var(--_bg)" stroke="var(--_b)"${leaves.stroke}/>${label}>${esc(text)}</text></g>`
      break
    default: {
      // The shown text is `? {text} ?`, with ASCII marks at both ends.
      const inner = text.slice(2, Math.max(text.length - 2, 2))
      out.s += `<g class="ondine-node ondine-special">${shape} rx="${RADIUS}" fill="var(--_bg)" stroke="var(--_b)" stroke-dasharray="4 3"${leaves.stroke}/>${label} font-style="italic"><tspan fill="var(--_m)">? </tspan>${esc(inner)}<tspan fill="var(--_m)"> ?</tspan></text></g>`
    }
  }
}

/** Draws `model` with room to spare, or `tight`ly within the host's width. */
function draw(model: RailroadModel, config: Value, options: RenderOptions, tight: boolean): Rendered {
  const base = options.fontSize ?? 16.0
  const fontSize = option(config, 'fontSize', 0.0, 200.0)
  const size = fontSize === 0.0 ? jsRound(base * 0.875) : fontSize
  const headSize = fontSize === 0.0 ? base : fontSize
  const padding = option(config, 'padding', -1.0, 200.0)
  const lineHeight = jsRound(size * 1.5)
  const m: Metrics = {
    arc: fmin(option(config, 'arcRadius', 10.0, 200.0), tight ? 6.0 : Number.POSITIVE_INFINITY),
    gap: fmin(option(config, 'horizontalSeparation', 16.0, 500.0), tight ? 12.0 : Number.POSITIVE_INFINITY),
    height: even(lineHeight + (padding < 0.0 ? 9.0 : 2.0 * padding)),
    padding: padding < 0.0 ? 12.0 : padding,
    sep: option(config, 'verticalSeparation', 10.0, 500.0),
    size,
  }
  const hidden =
    section(config)?.some(([key, value]) => key === 'showMarkers' && value.kind === 'Bool' && !value._0) ?? false
  const radius = hidden ? 0.0 : option(config, 'markerRadius', 4.0, 50.0)
  const strokeWidth = option(config, 'strokeWidth', 0.0, 20.0)
  let stroke = ''
  if (strokeWidth > 0.0) {
    const out = buf(' stroke-width="')
    pushNum(out, strokeWidth)
    out.s += '"'
    stroke = out.s
  }
  const pad = options.padding ?? 8.0
  const turns = turnsNew(m.arc)

  const title = layoutLabel(model.title, false, base, tight ? titleRoom(options) : 4000.0, BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 16.0 : 0.0
  const headHeight = jsRound(headSize * 1.5)
  const leaves: Leaves = {
    boxTop: m.height / 2.0,
    height: m.height,
    stroke,
    textShift: size * 0.35,
  }

  const rules = buf()
  let width = title.width
  let top = pad + titleHeight
  let bottom = pad + title.height
  for (const rule of model.rules) {
    const room = tight
      ? fmax(80.0, (options.maxWidth ?? 320.0) - 2.0 * pad - 4.0 * radius - 2.0 * LEAD - 1.0)
      : Number.POSITIVE_INFINITY
    const boxes: Boxes = []
    const root = measure(model, rule.definition, m, room, boxes)
    const laid = get(boxes, root)
    const name = shown(rule.name)
    const baseline = top + headHeight + HEAD_GAP + laid.up
    const start = pad + 2.0 * radius
    const left = start + LEAD
    const end = left + laid.width + LEAD
    const drawing: Drawing = { arrows: buf(), boxes, nodes: buf(), track: buf() }
    drawingLine(drawing, start, baseline, left)
    drawingLine(drawing, left + laid.width, baseline, end)
    place(drawing, root, left, baseline, m, turns, leaves)

    rules.s += `<g class="ondine-rule" data-id="${escText(rule.name)}"><text class="ondine-rule-name" x="${num(pad)}" y="${num(top + headHeight / 2.0 + headSize * 0.35)}" font-size="${num(headSize)}" font-weight="var(--_hw)" text-anchor="start">${esc(name)}</text><path class="ondine-edge ondine-track" d="${drawing.track.s}" fill="none" stroke="var(--_l)"${stroke}/>`
    if (drawing.arrows.s !== '') rules.s += `<path class="ondine-marker" d="${drawing.arrows.s}" fill="var(--_l)"/>`
    if (radius > 0.0) {
      const r = num(radius)
      const cy = num(baseline)
      rules.s += `<circle class="ondine-marker ondine-start" cx="${num(pad + radius)}" cy="${cy}" r="${r}" fill="var(--_l)"/><circle class="ondine-marker ondine-end" cx="${num(end + radius)}" cy="${cy}" r="${r}" fill="var(--_l)"/>`
    }
    rules.s += `${drawing.nodes.s}</g>`
    width = fmax(fmax(width, end + 2.0 * radius - pad), measureWidth(name, headSize, BOLD))
    bottom = baseline + laid.down
    top = bottom + m.sep + RULE_GAP
  }

  const totalWidth = Math.ceil(width + 2.0 * pad)
  const totalHeight = Math.ceil(bottom + pad)
  const content = buf(
    labelSvg(
      title,
      totalWidth / 2.0,
      pad + title.height / 2.0,
      ' class="ondine-title" font-weight="var(--_tw)"',
      undefined,
    ),
  )
  if (rules.s !== '') {
    content.s += '<g class="ondine-rules" transform="translate(0.5,0.5)" font-size="'
    pushNum(content, size)
    content.s += '" text-anchor="middle">'
    content.s += rules.s
    content.s += '</g>'
  }

  return {
    height: totalHeight,
    links: [],
    svg: svgDocument(
      'railroad',
      totalWidth,
      totalHeight,
      base,
      options,
      { accDescr: model.accDescr, accTitle: model.accTitle },
      content.s,
    ),
    width: totalWidth,
  }
}
