/**
 * @module Lays out C4 shapes and boundaries in Mermaid's grid. Port of Pele's
 * `src/diagrams/c4/layout.ts`.
 */
import { type Label, layoutLabel, trim } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { asUint, eqIgnoreAsciiCase, fmax, fmin } from '../../util/rust.ts'
import type { C4Db } from './db.ts'
import { type Box, boxDefault, Form, HEAD, LANE } from './route.ts'
import type { C4Element } from './types.ts'

const SHAPE_W = 216.0
const SHAPE_MIN_H = 64.0
const PAD_X = 14.0
const PAD_Y = 12.0
const GAP_X = 100.0
const GAP_Y = 88.0
/** Room for a relation to run along the inside of a boundary. */
export const GROUP_PAD = LANE + 8.0
const GROUP_GAP = 48.0
/** Where a boundary's heading starts, from its top-left corner. */
export const HEAD_LEFT = 16.0
/** Where a boundary's heading starts, from its top-left corner. */
export const HEAD_TOP = 10.0

/** A laid out shape. */
export type Node = {
  /** Its box, in {@link Layout.boxes}. */
  id: number
  /** Type, name, technology, description. */
  labels: [Label, Label, Label, Label]
  /** The index of its shape. */
  shape: number
  /** The height of its text. */
  textH: number
}

/** A laid out boundary. */
export type Group = {
  /** The index of its boundary. */
  boundary: number
  /** The height of its heading. */
  head: number
  /** The width of its heading. */
  headW: number
  /** Where its heading starts, from its left edge. */
  headX: number
  /** Its box, in {@link Layout.boxes}. */
  id: number
  /** The groups inside it. */
  kids: number[]
  /** Name, type, description. Empty for the top level. */
  labels: Label[]
  /** The nodes inside it. */
  nodes: Node[]
}

/** A laid out diagram. */
export type Layout = {
  /** Every box: shapes and boundaries. */
  boxes: Box[]
  /** The box of each boundary that is drawn, by boundary index. */
  boundaryBoxes: (number | undefined)[]
  /** Every group, by boundary index. */
  groups: Group[]
  /** The groups that are drawn, parents before children. The first is the unnamed top level. */
  order: number[]
  /** The box of each shape that is drawn, by shape index. */
  shapeBoxes: (number | undefined)[]
}

/** The shared shape of a keyword Mermaid accepts in `$shape`, `$sprite` or `$tags`. */
const FORMS: readonly [string, Form][] = [
  ['person', Form.Person],
  ['box', Form.Rect],
  ['rounded', Form.Rect],
  ['component', Form.Rect],
  ['cylinder', Form.Cyl],
  ['database', Form.Cyl],
  ['db', Form.Cyl],
  ['queue', Form.HCyl],
  ['pipe', Form.HCyl],
]

/** The shared shape of a keyword Mermaid accepts in `$shape`, `$sprite` or `$tags`. */
function formNamed(name: string): Form | undefined {
  // Every keyword is ASCII, and no other character lowercases to an ASCII one of theirs.
  return FORMS.find(([own]) => eqIgnoreAsciiCase(own, name))?.[1]
}

function formOf(shape: C4Element): Form {
  const explicit = formNamed(shape.shape ?? '') ?? formNamed(shape.sprite ?? '')
  if (explicit !== undefined) return explicit
  const tags = shape.tags
  if (tags !== undefined && tags !== '') {
    for (const tag of tags.split(',')) {
      const form = formNamed(trim(tag))
      if (form !== undefined) return form
    }
  }
  const kind = shape.kind
  if (kind.endsWith('person')) return Form.Person
  if (kind.endsWith('_db')) return Form.Cyl
  if (kind.endsWith('_queue')) return Form.HCyl
  return Form.Rect
}

function measure(
  shape: C4Element,
  size: number,
  small: number,
  width: number,
): [Box, [Label, Label, Label, Label], number] {
  const form = formOf(shape)
  const capW = form === Form.HCyl ? 36.0 : 0.0
  const capH = form === Form.Person ? HEAD : form === Form.Cyl ? 24.0 : 0.0
  const inner = width - 2 * PAD_X - capW
  const kind = `«${shape.kind.replaceAll('_', ' ')}»`
  const techn = shape.techn !== undefined && shape.techn !== '' ? `[${shape.techn}]` : undefined
  const labels: [Label, Label, Label, Label] = [
    layoutLabel(kind, false, small - 1, inner, 0, undefined),
    layoutLabel(shape.label, false, size, inner, BOLD, undefined),
    layoutLabel(techn, false, small, inner, 0, undefined),
    layoutLabel(shape.descr, false, small, inner, 0, undefined),
  ]
  let tw = 0
  let textH = labels[3].height > 0 ? 4 : 0
  for (const label of labels) {
    tw = fmax(tw, label.width)
    textH += label.height
  }
  const shapeBox: Box = {
    form,
    h: fmax(SHAPE_MIN_H, textH + 2 * PAD_Y + capH),
    w: fmax(width, tw + 2 * PAD_X + capW),
    x: 0,
    y: 0,
  }
  return [shapeBox, labels, textH]
}

/**
 * Places boxes left to right in rows of `perRow`, from (0, 0), and returns the width and
 * height the rows take. Shapes are stretched to the height of their row. Boundaries keep their
 * own.
 */
function rows(
  boxes: Box[],
  ids: number[],
  perRow: number,
  gapX: number,
  gapY: number,
  stretch: boolean,
): [number, number] {
  // A row size too large to count in is as good as all of them.
  const chunk = Math.max(asUint(perRow), 1)
  let width = 0
  let y = 0
  for (let start = 0; start < ids.length; start += chunk) {
    const stop = Math.min(start + chunk, ids.length)
    let x = 0
    let rowH = 0
    for (let k = start; k < stop; k++) {
      const b = boxes[ids[k] as number]
      if (b !== undefined) rowH = fmax(rowH, b.h)
    }
    for (let k = start; k < stop; k++) {
      const b = boxes[ids[k] as number]
      if (b !== undefined) {
        b.x = x
        b.y = y
        if (stretch) b.h = rowH
        x += b.w + gapX
      }
    }
    width = fmax(width, x - gapX)
    y += rowH + gapY
  }
  return [width, ids.length === 0 ? 0 : y - gapY]
}

/** How many boxes go in a row: `limit`, or fewer when the diagram must fit `room`. */
function count(
  boxes: Box[],
  ids: number[],
  room: number | undefined,
  limit: number,
  gap: number,
  groupPad: number,
): number {
  if (room === undefined) return limit
  let widest = 1
  for (const id of ids) {
    const b = boxes[id]
    if (b !== undefined) widest = fmax(widest, b.w)
  }
  return fmax(1, fmin(limit, Math.floor((room + gap - 2 * groupPad) / (widest + gap))))
}

/**
 * Mermaid's grid: in each boundary, its shapes in rows of `c4ShapeInRow`, then the boundaries
 * inside it in rows of `c4BoundaryInRow`, each sized around its own content. `room`, when set,
 * is the width to fit, and `gap` the space between shapes then.
 */
export function layoutC4(db: C4Db, size: number, small: number, room: number | undefined, gap: number): Layout {
  const groupPad = room === undefined ? GROUP_PAD : 12.0
  const boxes: Box[] = []
  const groups: Group[] = []
  for (let index = 0; index < db.boundaries.length; index++) {
    const boundary = db.boundaries[index] as C4Element
    const labelRoom = room === undefined ? 4000 : fmax(80, room - 2 * HEAD_LEFT - 2 * GROUP_PAD * 2)
    let labels: Label[] = []
    if (boundary.parent !== undefined) {
      const type = boundary.type !== undefined && boundary.type !== '' ? `[${boundary.type}]` : undefined
      labels = [
        layoutLabel(boundary.label, false, size, labelRoom, BOLD, undefined),
        layoutLabel(type, false, small, labelRoom, 0, undefined),
        layoutLabel(boundary.descr, false, small, labelRoom, 0, undefined),
      ]
    }
    let head = 0
    let headW = 0
    for (const label of labels) {
      head += label.height
      headW = fmax(headW, label.width)
    }
    const id = boxes.length
    boxes.push(boxDefault())
    groups.push({
      boundary: index,
      head: head > 0 ? head + HEAD_TOP + 6 + LANE : groupPad,
      headW,
      headX: HEAD_LEFT,
      id,
      kids: [],
      labels,
      nodes: [],
    })
  }
  for (let index = 0; index < groups.length; index++) {
    const parent = db.boundaries[index]?.parent
    if (parent !== undefined) groups[parent]?.kids.push(index)
  }
  // A boundary that ends up inside itself is not reachable from the top, as in Mermaid.
  const order: number[] = [0]
  const depths: (number | undefined)[] = []
  for (let i = 0; i < groups.length; i++) depths.push(undefined)
  if (depths.length > 0) depths[0] = 0
  for (let i = 0; i < order.length; i++) {
    const at = order[i] as number
    const depth = depths[at] ?? 0
    for (const kid of groups[at]?.kids ?? []) {
      if (kid < depths.length) depths[kid] = depth + 1
      order.push(kid)
    }
  }
  for (let index = 0; index < db.shapes.length; index++) {
    const shape = db.shapes[index] as C4Element
    const parent = shape.parent
    if (parent === undefined) continue
    const depth = depths[parent] ?? 0
    const nodeWidth = room === undefined ? SHAPE_W : fmax(100, fmin(SHAPE_W, room - 2 * depth * groupPad - 32))
    const group = groups[parent]
    if (group === undefined) continue
    const [shapeBox, labels, textH] = measure(shape, size, small, nodeWidth)
    const id = boxes.length
    boxes.push(shapeBox)
    group.nodes.push({ id, labels, shape: index, textH })
  }

  const perRow = fmax(db.shapeInRow, 1)
  const groupsPerRow = fmax(db.boundaryInRow, 1)
  const kidsTop: number[] = []
  for (let i = 0; i < groups.length; i++) kidsTop.push(0)
  for (let k = order.length - 1; k >= 0; k--) {
    const at = order[k] as number
    const group = groups[at]
    if (group === undefined) continue
    const gapX = room === undefined ? GAP_X : gap
    const nodeIds: number[] = []
    for (const node of group.nodes) nodeIds.push(node.id)
    const kidIds: number[] = []
    for (const kid of group.kids) {
      const g = groups[kid]
      if (g !== undefined) kidIds.push(g.id)
    }
    const nodeCount = count(boxes, nodeIds, room, perRow, gapX, groupPad)
    const [gridW, gridH] = rows(boxes, nodeIds, nodeCount, gapX, GAP_Y, true)
    const kidCount = count(boxes, kidIds, room, groupsPerRow, GROUP_GAP, groupPad)
    const [kidsW, kidsH] = rows(boxes, kidIds, kidCount, GROUP_GAP, GROUP_GAP, false)
    const between = gridH > 0 && kidsH > 0 ? GROUP_GAP : 0
    const frame = at === 0 ? 0 : groupPad
    if (at < kidsTop.length) kidsTop[at] = gridH + between
    const b = boxes[group.id]
    if (b !== undefined) {
      b.w = fmax(fmax(gridW, kidsW), group.headW + 2 * HEAD_LEFT - 2 * frame) + 2 * frame
      const head = frame === 0 ? 0 : group.head
      b.h = head + gridH + between + kidsH + frame
    }
  }

  const shapeBoxes: (number | undefined)[] = []
  for (let i = 0; i < db.shapes.length; i++) shapeBoxes.push(undefined)
  const boundaryBoxes: (number | undefined)[] = []
  for (let i = 0; i < db.boundaries.length; i++) boundaryBoxes.push(undefined)
  for (const at of order) {
    const group = groups[at]
    if (group === undefined) continue
    const found = boxes[group.id]
    if (found === undefined) continue
    const own = { ...found }
    const left = own.x + (at === 0 ? 0 : groupPad)
    const top = own.y + (at === 0 ? 0 : group.head)
    for (const node of group.nodes) {
      const b = boxes[node.id]
      if (b !== undefined) {
        b.x += left
        b.y += top
      }
      if (node.shape < shapeBoxes.length) shapeBoxes[node.shape] = node.id
    }
    const kidsTopAt = kidsTop[at] ?? 0
    for (const kid of group.kids) {
      const g = groups[kid]
      const b = g === undefined ? undefined : boxes[g.id]
      if (b !== undefined) {
        b.x += left
        b.y += top + kidsTopAt
      }
    }
    if (at !== 0 && at < boundaryBoxes.length) boundaryBoxes[at] = group.id
  }
  return { boxes, boundaryBoxes, groups, order, shapeBoxes }
}
