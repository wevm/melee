/** @module The C4 diagram database. Port of Pele's `src/diagrams/c4/db.ts`. */
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { type C4Attr, type C4Element, type C4Named, type C4Rel, c4ElementDefault, c4RelDefault } from './types.ts'

/**
 * JavaScript's `parseInt` with no radix: optional whitespace and sign, then decimal digits, or
 * hex digits after `0x`. `NaN` when there are no digits.
 */
export function parseInt(text: string): number {
  text = trimStart(text)
  let negative = false
  const first = text.charCodeAt(0)
  if (first === 0x2d) {
    negative = true
    text = text.slice(1)
  } else if (first === 0x2b) {
    text = text.slice(1)
  }
  const hex = text.length >= 2 && (text.slice(0, 2) === '0x' || text.slice(0, 2) === '0X')
  let value: number
  if (hex) {
    const body = text.slice(2)
    let end = 0
    while (end < body.length && isHexDigit(body.charCodeAt(end))) end += 1
    if (end === 0) return Number.NaN
    // ponytail: past 32 hex digits the value is summed in floating point, which may round
    // differently from V8 in the last place.
    value = 0
    for (let i = 0; i < end; i++) value = value * 16 + Number.parseInt(body.charAt(i), 16)
  } else {
    let end = 0
    while (end < text.length && isAsciiDigit(text.charCodeAt(end))) end += 1
    if (end === 0) return Number.NaN
    value = Number(text.slice(0, end))
  }
  return negative ? -value : value
}

function isAsciiDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

function isHexDigit(c: number): boolean {
  return isAsciiDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

/**
 * `text.replace(/\n\s+/g, '\n')`: whitespace after each line break removed, line breaks within
 * it included.
 */
function accDescription(text: string): string {
  let out = ''
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    out += text.charAt(i)
    i += 1
    if (c === 0x0a) {
      while (i < n && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/** Sets the named entry of `extra`, keeping the place of one already there. */
function setExtra(owner: { extra: [string, string][] | undefined }, key: string, value: string): void {
  if (owner.extra === undefined) owner.extra = []
  const entry = owner.extra.find(([own]) => own === key)
  if (entry !== undefined) {
    entry[1] = value
  } else {
    owner.extra.push([key, value])
  }
}

/** A field of a shape or boundary that a statement fills by position, as its property name. */
const ElementField = {
  BgColor: 'bgColor',
  BorderColor: 'borderColor',
  Descr: 'descr',
  FontColor: 'fontColor',
  LegendSprite: 'legendSprite',
  LegendText: 'legendText',
  Link: 'link',
  Shadowing: 'shadowing',
  Shape: 'shape',
  Sprite: 'sprite',
  Tags: 'tags',
  Techn: 'techn',
  Type: 'type',
} as const
type ElementField = (typeof ElementField)[keyof typeof ElementField]

/** The field each known named argument of a shape or boundary sets. */
const ELEMENT_NAMED: ReadonlyMap<string, ElementField> = new Map<string, ElementField>([
  ['type', ElementField.Type],
  ['descr', ElementField.Descr],
  ['techn', ElementField.Techn],
  ['sprite', ElementField.Sprite],
  ['tags', ElementField.Tags],
  ['link', ElementField.Link],
  ['bgColor', ElementField.BgColor],
  ['fontColor', ElementField.FontColor],
  ['borderColor', ElementField.BorderColor],
  ['shadowing', ElementField.Shadowing],
  ['shape', ElementField.Shape],
  ['legendText', ElementField.LegendText],
  ['legendSprite', ElementField.LegendSprite],
])

/**
 * Mermaid assigns a named argument to whatever property it names, structural ones included.
 * Here it reaches only the known fields. Any other name is kept aside in `extra`.
 */
function c4ElementNamed(self: C4Element, attr: C4Named): void {
  if (attr.key === 'label') {
    self.label = attr.value
    return
  }
  const field = ELEMENT_NAMED.get(attr.key)
  if (field === undefined) {
    setExtra(self, attr.key, attr.value)
    return
  }
  self[field] = attr.value
}

/**
 * A positional argument fills the field of its slot. A named one fills the field it names,
 * whichever slot it is in.
 */
function c4ElementPut(self: C4Element, field: ElementField, attr: C4Attr | undefined): void {
  if (attr === undefined) return
  if (attr.kind === 'Text') {
    self[field] = attr._0
  } else {
    c4ElementNamed(self, attr._0)
  }
}

function c4ElementText(self: C4Element, field: ElementField, attr: C4Attr | undefined): void {
  if (attr === undefined) {
    if (self[field] === undefined) self[field] = ''
  } else {
    c4ElementPut(self, field, attr)
  }
}

function c4ElementSetLabel(self: C4Element, attr: C4Attr | undefined): void {
  self.labelAttr = undefined
  if (attr === undefined) {
    self.label = ''
  } else if (attr.kind === 'Named') {
    self.label = ''
    self.labelAttr = { ...attr._0 }
    c4ElementNamed(self, attr._0)
  } else {
    self.label = attr._0
  }
}

/** A field of a relation that a statement fills by position, as its property name. */
const RelField = {
  Descr: 'descr',
  LineColor: 'lineColor',
  Link: 'link',
  Sprite: 'sprite',
  Tags: 'tags',
  Techn: 'techn',
  TextColor: 'textColor',
} as const
type RelField = (typeof RelField)[keyof typeof RelField]

/** The field each known named argument of a relation sets. */
const REL_NAMED: ReadonlyMap<string, RelField> = new Map<string, RelField>([
  ['descr', RelField.Descr],
  ['techn', RelField.Techn],
  ['sprite', RelField.Sprite],
  ['tags', RelField.Tags],
  ['link', RelField.Link],
  ['textColor', RelField.TextColor],
  ['lineColor', RelField.LineColor],
])

/** As {@link c4ElementNamed}, with the offsets read as numbers. */
function c4RelNamed(self: C4Rel, attr: C4Named): void {
  switch (attr.key) {
    case 'offsetX':
      self.offsetX = parseInt(attr.value)
      return
    case 'offsetY':
      self.offsetY = parseInt(attr.value)
      return
    case 'label':
      self.label = attr.value
      return
  }
  const field = REL_NAMED.get(attr.key)
  if (field === undefined) {
    setExtra(self, attr.key, attr.value)
    return
  }
  self[field] = attr.value
}

function c4RelPut(self: C4Rel, field: RelField, attr: C4Attr | undefined): void {
  if (attr === undefined) return
  if (attr.kind === 'Text') {
    self[field] = attr._0
  } else {
    c4RelNamed(self, attr._0)
  }
}

function c4RelText(self: C4Rel, field: RelField, attr: C4Attr | undefined): void {
  if (attr === undefined) {
    if (self[field] === undefined) self[field] = ''
  } else {
    c4RelPut(self, field, attr)
  }
}

function c4RelSetLabel(self: C4Rel, attr: C4Attr | undefined): void {
  self.labelAttr = undefined
  if (attr === undefined) {
    self.label = ''
  } else if (attr.kind === 'Named') {
    self.label = ''
    self.labelAttr = { ...attr._0 }
    c4RelNamed(self, attr._0)
  } else {
    self.label = attr._0
  }
}

/** A shape or a boundary, by its index in its list. */
export type ElementRef =
  /** A boundary. */
  | { kind: 'Boundary'; _0: number }
  /** A shape. */
  | { kind: 'Shape'; _0: number }

/** The parsed C4 diagram: Pele's `C4Db`. */
export type C4Db = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. Mermaid's grammar never sets it. */
  accTitle: string | undefined
  /** Boundaries. The first is the unnamed one that holds everything at the top level. */
  boundaries: C4Element[]
  /**
   * The top-level boundary is not listed, so a boundary a diagram names `global` is its own
   * box. In Mermaid it replaces the top level and nothing is drawn.
   */
  boundaryIndex: Map<string, number>
  /** Boundaries per row. */
  boundaryInRow: number
  /**
   * The header keyword: `C4Context`, `C4Container`, `C4Component`, `C4Dynamic` or
   * `C4Deployment`.
   */
  c4Type: string | undefined
  current: number
  /** Relations by `from`, then by `to`. */
  relIndex: Map<string, Map<string, number>>
  /** Relations, in order. */
  rels: C4Rel[]
  shapeIndex: Map<string, number>
  /** Shapes per row. */
  shapeInRow: number
  /** Shapes, in order. */
  shapes: C4Element[]
  stack: number[]
  /** The title. */
  title: string | undefined
}

/** The relation from `from` to `to` in `relIndex`. */
function relAt(index: Map<string, Map<string, number>>, from: string, to: string): number | undefined {
  return index.get(from)?.get(to)
}

/** `C4Db::default()`. */
export function c4DbDefault(): C4Db {
  const global = c4ElementDefault()
  global.alias = 'global'
  global.label = 'global'
  global.type = 'global'
  return {
    accDescr: undefined,
    accTitle: undefined,
    boundaries: [global],
    boundaryIndex: new Map(),
    boundaryInRow: 2,
    c4Type: undefined,
    current: 0,
    relIndex: new Map(),
    rels: [],
    shapeIndex: new Map(),
    shapeInRow: 4,
    shapes: [],
    stack: [],
    title: undefined,
  }
}

/** Finds or adds the element `alias` names, and sets its label from `title`. */
function element(
  list: C4Element[],
  index: Map<string, number>,
  alias: C4Attr | undefined,
  title: C4Attr | undefined,
): number {
  let at = alias !== undefined && alias.kind === 'Text' ? index.get(alias._0) : undefined
  if (at === undefined) {
    at = list.length
    const el = c4ElementDefault()
    if (alias !== undefined) {
      if (alias.kind === 'Text') {
        el.alias = alias._0
        index.set(alias._0, at)
      } else {
        el.aliasAttr = { ...alias._0 }
        c4ElementNamed(el, alias._0)
      }
    }
    list.push(el)
  }
  const el = list[at]
  if (el !== undefined) c4ElementSetLabel(el, title)
  return at
}

/** Sets the header keyword. */
export function c4DbSetC4Type(self: C4Db, type: string): void {
  self.c4Type = type
}

/** Sets the title. */
export function c4DbSetTitle(self: C4Db, title: string): void {
  self.title = title
}

/** Sets the accessible description, without the indentation of its lines. */
export function c4DbSetAccDescription(self: C4Db, descr: string): void {
  self.accDescr = accDescription(descr)
}

/** Adds a person or a system: alias, label, ?descr, ?sprite, ?tags, $link. */
export function c4DbAddPersonOrSystem(self: C4Db, kind: string, attrs: C4Attr[]): void {
  const at = element(self.shapes, self.shapeIndex, attrs[0], attrs[1])
  const current = self.current
  const shape = self.shapes[at]
  if (shape !== undefined) {
    c4ElementText(shape, ElementField.Descr, attrs[2])
    finishShape(shape, kind, attrs, 3, current)
  }
}

/** Adds a container or a component: alias, label, ?techn, ?descr, ?sprite, ?tags, $link. */
export function c4DbAddContainer(self: C4Db, kind: string, attrs: C4Attr[]): void {
  const at = element(self.shapes, self.shapeIndex, attrs[0], attrs[1])
  const current = self.current
  const shape = self.shapes[at]
  if (shape !== undefined) {
    c4ElementText(shape, ElementField.Techn, attrs[2])
    c4ElementText(shape, ElementField.Descr, attrs[3])
    finishShape(shape, kind, attrs, 4, current)
  }
}

function c4DbBoundary(self: C4Db, attrs: C4Attr[], fallback: string): number {
  const at = element(self.boundaries, self.boundaryIndex, attrs[0], attrs[1])
  const boundary = self.boundaries[at]
  if (boundary !== undefined) {
    const attr = attrs[2]
    if (attr === undefined) {
      boundary.type = fallback
    } else {
      c4ElementPut(boundary, ElementField.Type, attr)
    }
  }
  return at
}

function c4DbOpen(self: C4Db, boundary: number): void {
  const el = self.boundaries[boundary]
  if (el !== undefined) el.parent = self.current
  self.stack.push(self.current)
  self.current = boundary
}

/** Opens a person or system boundary: alias, label, ?type, ?tags, $link. */
export function c4DbAddPersonOrSystemBoundary(self: C4Db, attrs: C4Attr[], fallback: string): void {
  const at = c4DbBoundary(self, attrs, fallback)
  const boundary = self.boundaries[at]
  if (boundary !== undefined) {
    c4ElementPut(boundary, ElementField.Tags, attrs[3])
    c4ElementPut(boundary, ElementField.Link, attrs[4])
  }
  c4DbOpen(self, at)
}

/** Opens a container boundary. */
export function c4DbAddContainerBoundary(self: C4Db, attrs: C4Attr[]): void {
  c4DbAddPersonOrSystemBoundary(self, attrs, 'container')
}

/** Opens a deployment node: alias, label, ?type, ?descr, ?sprite, ?tags, $link. */
export function c4DbAddDeploymentNode(self: C4Db, nodeType: string, attrs: C4Attr[]): void {
  const at = c4DbBoundary(self, attrs, 'node')
  const boundary = self.boundaries[at]
  if (boundary !== undefined) {
    c4ElementText(boundary, ElementField.Descr, attrs[3])
    // Mermaid drops whatever is in the sprite slot, a named argument included.
    c4ElementPut(boundary, ElementField.Sprite, attrs[4])
    c4ElementPut(boundary, ElementField.Tags, attrs[5])
    c4ElementPut(boundary, ElementField.Link, attrs[6])
    boundary.nodeType = nodeType
  }
  c4DbOpen(self, at)
}

/** Closes the innermost open boundary. */
export function c4DbPopBoundaryParseStack(self: C4Db): void {
  self.current = self.stack.pop() ?? 0
}

/** Adds or updates a relation: from, to, label, ?techn, ?descr, ?sprite, ?tags, $link. */
export function c4DbAddRel(self: C4Db, type: string, attrs: C4Attr[]): void {
  const from = attrs[0]
  const to = attrs[1]
  if (from === undefined || to === undefined || attrs[2] === undefined) return
  const keyed = from.kind === 'Text' && to.kind === 'Text'
  let at = keyed ? relAt(self.relIndex, from._0 as string, to._0 as string) : undefined
  if (at === undefined) {
    at = self.rels.length
    const rel = c4RelDefault()
    rel.type = type
    if (from.kind === 'Text') {
      rel.from = from._0
    } else {
      rel.fromAttr = { ...from._0 }
    }
    if (to.kind === 'Text') {
      rel.to = to._0
    } else {
      rel.toAttr = { ...to._0 }
    }
    self.rels.push(rel)
    if (keyed) {
      const fromKey = from._0 as string
      let byTo = self.relIndex.get(fromKey)
      if (byTo === undefined) {
        byTo = new Map()
        self.relIndex.set(fromKey, byTo)
      }
      byTo.set(to._0 as string, at)
    }
  }
  const rel = self.rels[at]
  if (rel !== undefined) {
    rel.type = type
    c4RelSetLabel(rel, attrs[2])
    c4RelText(rel, RelField.Techn, attrs[3])
    c4RelText(rel, RelField.Descr, attrs[4])
    c4RelPut(rel, RelField.Sprite, attrs[5])
    c4RelPut(rel, RelField.Tags, attrs[6])
    c4RelPut(rel, RelField.Link, attrs[7])
  }
}

/** The shape or boundary named `alias`, shapes first. */
export function c4DbGetC4Shape(self: C4Db, alias: string): ElementRef | undefined {
  const shape = self.shapeIndex.get(alias)
  if (shape !== undefined) return { kind: 'Shape', _0: shape }
  const boundary = self.boundaryIndex.get(alias)
  if (boundary !== undefined) return { kind: 'Boundary', _0: boundary }
  return undefined
}

function c4DbElementMut(self: C4Db, at: ElementRef): C4Element | undefined {
  return at.kind === 'Shape' ? self.shapes[at._0] : self.boundaries[at._0]
}

/**
 * Restyles a shape or boundary: elementName, ?bgColor, ?fontColor, ?borderColor, ?shadowing,
 * ?shape, ?sprite, ?techn, ?legendText, ?legendSprite.
 */
export function c4DbUpdateElStyle(self: C4Db, attrs: C4Attr[]): void {
  const alias = attrs[0]
  if (alias === undefined || alias.kind !== 'Text') return
  const at = c4DbGetC4Shape(self, alias._0)
  if (at === undefined) return
  const el = c4DbElementMut(self, at)
  if (el === undefined) return
  const slots: [ElementField, number][] = [
    [ElementField.BgColor, 1],
    [ElementField.FontColor, 2],
    [ElementField.BorderColor, 3],
    [ElementField.Shadowing, 4],
    [ElementField.Shape, 5],
    [ElementField.Sprite, 6],
    [ElementField.Techn, 7],
    [ElementField.LegendText, 8],
    [ElementField.LegendSprite, 9],
  ]
  for (const [field, slot] of slots) c4ElementPut(el, field, attrs[slot])
}

/** Restyles a relation: from, to, ?textColor, ?lineColor, ?offsetX, ?offsetY. */
export function c4DbUpdateRelStyle(self: C4Db, attrs: C4Attr[]): void {
  const from = attrs[0]
  const to = attrs[1]
  if (from === undefined || from.kind !== 'Text' || to === undefined || to.kind !== 'Text') return
  const at = relAt(self.relIndex, from._0, to._0)
  if (at === undefined) return
  const rel = self.rels[at]
  if (rel === undefined) return
  c4RelPut(rel, RelField.TextColor, attrs[2])
  c4RelPut(rel, RelField.LineColor, attrs[3])
  const x = attrs[4]
  if (x !== undefined) {
    if (x.kind === 'Text') rel.offsetX = parseInt(x._0)
    else c4RelNamed(rel, x._0)
  }
  const y = attrs[5]
  if (y !== undefined) {
    if (y.kind === 'Text') rel.offsetY = parseInt(y._0)
    else c4RelNamed(rel, y._0)
  }
}

/**
 * Sets how many shapes and boundaries go in a row: ?c4ShapeInRow, ?c4BoundaryInRow. As in
 * Mermaid, the slot decides which one a value sets, not its name.
 */
export function c4DbUpdateLayoutConfig(self: C4Db, attrs: C4Attr[]): void {
  const count = (attr: C4Attr | undefined): number => {
    if (attr === undefined) return Number.NaN
    return attr.kind === 'Text' ? parseInt(attr._0) : parseInt(attr._0.value)
  }
  const shapes = count(attrs[0])
  const boundaries = count(attrs[1])
  if (shapes >= 1) self.shapeInRow = shapes
  if (boundaries >= 1) self.boundaryInRow = boundaries
}

function finishShape(shape: C4Element, kind: string, attrs: C4Attr[], at: number, current: number): void {
  c4ElementPut(shape, ElementField.Sprite, attrs[at])
  c4ElementPut(shape, ElementField.Tags, attrs[at + 1])
  c4ElementPut(shape, ElementField.Link, attrs[at + 2])
  shape.kind = kind
  shape.parent = current
}
