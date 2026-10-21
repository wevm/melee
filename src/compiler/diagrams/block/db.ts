/**
 * @module The block diagram database: builds the block tree from parsed statements. Port of
 * Pele's `src/diagrams/block/db.ts`.
 */
import { Code, CompileError, errorNew, u32 } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { fmax } from '../../util/rust.ts'
import { type Block, type BlockClassDef, blockClone, blockDefault } from './types.ts'

/** The most space blocks a diagram may hold. */
const MAX_SPACES = 100_000

/** The arena index of the root block. */
export const ROOT = 0

/** The block type a shape's brackets stand for. */
export function typeStrToType(typeStr: string | undefined): string {
  switch (typeStr) {
    case '[]':
      return 'square'
    case '()':
      return 'round'
    case '(())':
      return 'circle'
    case '>]':
      return 'rect_left_inv_arrow'
    case '{}':
      return 'diamond'
    case '{{}}':
      return 'hexagon'
    case '([])':
      return 'stadium'
    case '[[]]':
      return 'subroutine'
    case '[()]':
      return 'cylinder'
    case '((()))':
      return 'doublecircle'
    case '[//]':
      return 'lean_right'
    case '[\\\\]':
      return 'lean_left'
    case '[/\\]':
      return 'trapezoid'
    case '[\\/]':
      return 'inv_trapezoid'
    case '<[]>':
      return 'block_arrow'
    default:
      return 'na'
  }
}

/** The marker at the end of a link. */
export function edgeStrToEdgeData(typeStr: string): string {
  const text = trim(typeStr)
  switch (text[text.length - 1]) {
    case 'x':
      return 'arrow_cross'
    case 'o':
      return 'arrow_circle'
    case '>':
      return 'arrow_point'
    default:
      return ''
  }
}

/** The marker at the start of a link. */
export function edgeStrToEdgeStartData(typeStr: string): string {
  switch (trim(typeStr)[0]) {
    case 'x':
      return 'arrow_cross'
    case 'o':
      return 'arrow_circle'
    case '<':
      return 'arrow_point'
    default:
      return 'arrow_open'
  }
}

/** The line weight of a link. */
export function edgeStrToThickness(typeStr: string): string {
  return typeStr.includes('==') ? 'thick' : 'normal'
}

/** The line pattern of a link. */
export function edgeStrToPattern(typeStr: string): string {
  return typeStr.includes('.-') ? 'dotted' : 'solid'
}

/** A statement list being placed under its parent. */
type Frame = {
  at: number
  children: number[]
  list: number[]
  parent: number
}

/** The parsed block diagram: Pele's `BlockDb`. */
export type BlockDb = {
  /** Every block, the root at {@link ROOT}. Statements and dropped blocks stay here unreferenced. */
  arena: Block[]
  /** Blocks by id, in insertion order. The root stays out. */
  byId: [string, number][]
  /** Positions in `byId` by id. */
  byIdIndex: Map<string, number>
  /** Class definitions, in insertion order. */
  classes: BlockClassDef[]
  colors: number
  edgeCount: Map<string, number>
  /** Edges, by arena index, in order. */
  edges: number[]
  ids: number
  /** Ids that a class or style statement named before any block had them. */
  pending: Set<string>
  spaces: number
  /** The front matter title. */
  title: string | undefined
}

function rootBlock(): Block {
  const block = blockDefault()
  block.children = []
  block.columns = -1
  block.id = 'root'
  block.type = 'composite'
  return block
}

/** `BlockDb::default()`: the root composite alone. */
export function blockDbDefault(): BlockDb {
  return {
    arena: [rootBlock()],
    byId: [],
    byIdIndex: new Map(),
    classes: [],
    colors: 0,
    edgeCount: new Map(),
    edges: [],
    ids: 0,
    pending: new Set(),
    spaces: 0,
    title: undefined,
  }
}

/** Adds a block to the arena and returns its index. */
export function blockDbAdd(self: BlockDb, block: Block): number {
  self.arena.push(block)
  return self.arena.length - 1
}

/** The block with `id`, by arena index. */
export function blockDbGet(self: BlockDb, id: string): number | undefined {
  const at = self.byIdIndex.get(id)
  if (at === undefined) return undefined
  return self.byId[at]?.[1]
}

/** The children of a block, by arena index. */
export function blockDbChildren(self: BlockDb, index: number): number[] {
  return self.arena[index]?.children ?? []
}

/** The class definition named `id`. */
export function blockDbClass(self: BlockDb, id: string): BlockClassDef | undefined {
  const classes = self.classes
  for (let i = 0; i < classes.length; i++) {
    const klass = classes[i] as BlockClassDef
    if (klass.id === id) return klass
  }
  return undefined
}

/** `Map.set`: replaces in place, or appends. */
function set(self: BlockDb, id: string, index: number): void {
  const at = self.byIdIndex.get(id)
  if (at !== undefined) {
    const entry = self.byId[at]
    if (entry !== undefined) entry[1] = index
    return
  }
  self.byIdIndex.set(id, self.byId.length)
  self.byId.push([id, index])
}

/** Mermaid's ids are random. These are counted, so the same text always gives the same output. */
export function blockDbGenerateId(self: BlockDb): string {
  self.ids += 1
  return `id-${u32(self.ids)}`
}

function addStyleClass(self: BlockDb, id: string, styleAttributes: string): void {
  let at = self.classes.findIndex((klass) => klass.id === id)
  if (at === -1) {
    self.classes.push({ id, styles: [], textStyles: [] })
    at = self.classes.length - 1
  }
  const found = self.classes[at]
  if (found === undefined) return
  for (const attribute of styleAttributes.split(',')) {
    const semi = attribute.indexOf(';')
    const fixed =
      semi === -1 ? trim(attribute) : trim(attribute.slice(0, semi) + attribute.slice(semi + 1))
    if (attribute.includes('color')) {
      found.textStyles.push(fixed.replace('fill', 'bgFill').replace('color', 'fill'))
    }
    found.styles.push(fixed)
  }
}

/** `text.split(',')`. */
function splitComma(text: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(',', from)
    if (at === -1) {
      out.push(text.slice(from))
      return out
    }
    out.push(text.slice(from, at))
    from = at + 1
  }
}

function addStyleToNode(self: BlockDb, id: string, styles: string): void {
  const index = named(self, id)
  const block = self.arena[index]
  if (block !== undefined) block.styles = splitComma(styles)
}

/**
 * Mermaid looks each id up before trimming it, so `class a, b hot` misses b. Here it is trimmed
 * first.
 */
function setCssClass(self: BlockDb, itemIds: string, cssClassName: string): void {
  for (const id of itemIds.split(',')) {
    const index = named(self, trim(id))
    const block = self.arena[index]
    if (block !== undefined) {
      block.classes ??= []
      block.classes.push(cssClassName)
    }
  }
}

/**
 * Mermaid throws on a style for an unknown id, and a class for one makes the block of that id
 * disappear when it is declared later. Here both wait for the block.
 */
function named(self: BlockDb, id: string): number {
  const found = blockDbGet(self, id)
  if (found !== undefined) return found
  const block = blockDefault()
  block.children = []
  block.id = id
  block.type = 'na'
  const index = blockDbAdd(self, block)
  set(self, id, index)
  self.pending.add(id)
  return index
}

/**
 * Places parsed statements, by arena index, under the root.
 *
 * Throws a limit error past {@link MAX_SPACES} space blocks.
 */
export function blockDbSetHierarchy(self: BlockDb, statements: number[]): void {
  const stack: Frame[] = [{ at: 0, children: [], list: statements, parent: ROOT }]
  for (;;) {
    const f = stack[stack.length - 1]
    if (f === undefined) break
    const b = f.list[f.at]
    if (b === undefined) {
      const children = f.children
      f.children = []
      const parentBlock = self.arena[f.parent]
      if (parentBlock !== undefined) parentBlock.children = children
      stack.pop()
      continue
    }
    f.at += 1
    const parent = f.parent
    const stored = self.arena[b]
    if (stored === undefined) continue

    // Statements read the stored block before anything changes it, so only blocks are copied.
    switch (stored.type) {
      case 'classDef': {
        const id = stored.id ?? ''
        addStyleClass(self, id, stored.css ?? '')
        continue
      }
      case 'applyClass': {
        const id = stored.id ?? ''
        setCssClass(self, id, stored.styleClass ?? '')
        continue
      }
      case 'applyStyles': {
        const styles = stored.stylesStr
        if (styles !== undefined && styles !== '') {
          const id = stored.id ?? ''
          addStyleToNode(self, id, styles)
        }
        continue
      }
      case 'column-setting': {
        const parentBlock = self.arena[parent]
        if (parentBlock !== undefined) parentBlock.columns = stored.columns ?? -1
        continue
      }
      case 'edge': {
        const id = stored.id ?? ''
        const count = (self.edgeCount.get(id) ?? 0) + 1
        self.edgeCount.set(id, count)
        const edge = self.arena[b]
        if (edge !== undefined) edge.id = `${u32(count)}-${id}`
        self.edges.push(b)
        continue
      }
      default:
        break
    }
    const block = blockClone(stored)

    // A composite whose header was a link statement has no id of its own.
    const id = block.id ?? blockDbGenerateId(self)
    block.id = undefined
    if (block.label === undefined || block.label === '') {
      block.label = block.type === 'composite' ? '' : id
    }
    block.id = id
    const known = blockDbGet(self, id)
    const fresh = known === undefined || self.pending.delete(id)
    if (!fresh && known !== undefined) {
      const knownBlock = self.arena[known]
      if (knownBlock !== undefined) {
        if (block.type !== 'na') knownBlock.type = block.type
        if (block.label !== id) knownBlock.label = block.label
      }
    } else {
      const knownBlock = known === undefined ? undefined : self.arena[known]
      if (knownBlock !== undefined) {
        block.classes = knownBlock.classes?.slice()
        block.styles = knownBlock.styles?.slice()
      }
      if (block.type === 'composite') {
        block.colorIndex = self.colors
        self.colors += 1
      }
      set(self, id, b)
    }

    const inner = block.children ?? []
    block.children = []
    const isSpace = block.type === 'space'
    const width = block.width ?? 1
    if (self.arena[b] !== undefined) self.arena[b] = block

    // The placed blocks go to the list being read, which is still on top of the stack.
    const placed = f.children
    if (isSpace) {
      if (!(width <= MAX_SPACES - self.spaces)) {
        const error: CompileError = errorNew(
          Code.Limit,
          'A block diagram can hold at most 100000 space blocks.',
        )
        error.type = 'block'
        throw error
      }
      self.spaces += fmax(width, 0)
      let j = 0
      while (j < width) {
        const source = self.arena[b]
        const copy = source === undefined ? blockDefault() : blockClone(source)
        const copyId = `${id}-${u32(j)}`
        copy.id = copyId
        copy.children = []
        const index = blockDbAdd(self, copy)
        set(self, copyId, index)
        placed.push(index)
        j += 1
      }
    } else if (fresh) {
      placed.push(b)
    }
    if (inner.length > 0) stack.push({ at: 0, children: [], list: inner, parent: b })
  }
}
