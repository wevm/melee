/** @module The kanban database. Port of Pele's `src/diagrams/kanban/db.ts`. */
import type { Decoration, OutlineDb } from '../common/outline.ts'
import { Code, CompileError, errorNew } from '../../error.ts'
import * as yaml from '../../yaml.ts'
import { type Value, valuePushJsString, valueTruthy } from '../../yaml.ts'
import { buf } from '../../util/rust.ts'

/** A card, or the head of a column. */
export type KanbanNode = {
  /** The assignee from metadata. */
  assigned: string | undefined
  /** The class names from `:::`. */
  cssClasses: string | undefined
  /** The icon name from metadata or `::icon(...)`. */
  icon: string | undefined
  /** The authored id. */
  id: string
  /** The text, or the metadata's label. */
  label: string
  /** The indentation, in UTF-16 units. */
  level: number
  /** The priority from metadata. */
  priority: string | undefined
  /** The ticket from metadata. */
  ticket: string | undefined
}

/** `KanbanNode::default()`. */
export function kanbanNodeDefault(): KanbanNode {
  return {
    assigned: undefined,
    cssClasses: undefined,
    icon: undefined,
    id: '',
    label: '',
    level: 0,
    priority: undefined,
    ticket: undefined,
  }
}

/** A column: its head and its cards. */
export type KanbanSection = {
  /** The cards, in source order. */
  items: KanbanNode[]
  /** The column's own fields. */
  node: KanbanNode
}

/** `KanbanSection::default()`. */
export function kanbanSectionDefault(): KanbanSection {
  return { items: [], node: kanbanNodeDefault() }
}

/** Which node the last statement added, for decorations. */
const Last = {
  /** The head of the last column. */
  Section: 'Section',
  /** The last card of the last column. */
  Item: 'Item',
} as const
type Last = (typeof Last)[keyof typeof Last]

/** The parsed kanban board: Pele's `KanbanDb`. */
export type KanbanDb = {
  /** The first error an action raised. Pele throws it, and the parser stops there. */
  error: CompileError | undefined
  last: Last | undefined
  /** Whether a card was indented less than the first column. */
  misplaced: string | undefined
  sectionLevel: number
  /** The columns, in source order. */
  sections: KanbanSection[]
  /** The front matter title. */
  title: string | undefined
}

/** `KanbanDb::default()`. */
export function kanbanDbDefault(): KanbanDb {
  return {
    error: undefined,
    last: undefined,
    misplaced: undefined,
    sectionLevel: 0,
    sections: [],
    title: undefined,
  }
}

/** An error of a kanban board. */
function failure(code: Code, message: string): CompileError {
  const error = errorNew(code, message)
  error.type = 'kanban'
  return error
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

/** `String(value)` of a truthy property, as `if (doc.key) node.key = String(doc.key)` sets it. */
function truthyString(doc: Value, key: string): string | undefined {
  const value = property(doc, key)
  if (value === undefined || !valueTruthy(value)) return undefined
  const out = buf()
  valuePushJsString(value, out)
  return out.s
}

/** Whether JavaScript's `toLowerCase` would change `text`. */
function hasUpper(text: string): boolean {
  for (const c of text) {
    if (c.toLowerCase() !== c) return true
  }
  return false
}

function kanbanDbAdd(
  db: KanbanDb,
  level: number,
  id: string,
  descr: string,
  shapeData: string | undefined,
): void {
  const node: KanbanNode = {
    assigned: undefined,
    cssClasses: undefined,
    icon: undefined,
    id,
    label: descr,
    level,
    priority: undefined,
    ticket: undefined,
  }

  if (shapeData !== undefined) {
    const data = shapeData
    const source = data.includes('\n') ? data + '\n' : '{\n' + data + '\n}'
    const parsed = yaml.parse(source)
    if (!parsed.ok) {
      throw failure(Code.Syntax, 'Metadata of "' + node.id + '" is not valid YAML. ' + parsed.error)
    }
    const doc = parsed.value
    // Mermaid throws a TypeError on metadata that is empty or not a mapping. Here it is
    // ignored.
    if (doc.kind === 'Object') {
      const shape = truthyString(doc, 'shape') ?? ''
      if (hasUpper(shape) || shape.includes('_')) {
        throw failure(Code.Semantic, 'No such shape: ' + shape + '. Shape names should be lowercase.')
      }
      const label = truthyString(doc, 'label')
      if (label !== undefined) node.label = label
      const icon = truthyString(doc, 'icon')
      if (icon !== undefined) node.icon = icon
      const assigned = truthyString(doc, 'assigned')
      if (assigned !== undefined) node.assigned = assigned
      const ticket = truthyString(doc, 'ticket')
      if (ticket !== undefined) node.ticket = ticket
      const priority = truthyString(doc, 'priority')
      if (priority !== undefined) node.priority = priority
    }
  }

  // A node indented less than the first column becomes a card, and Mermaid rejects whatever
  // follows it.
  if (db.misplaced !== undefined) {
    throw failure(Code.Semantic, 'Items without section detected, found section ("' + db.misplaced + '")')
  }
  if (db.sections.length === 0) {
    db.sectionLevel = level
  }
  if (level === db.sectionLevel) {
    db.last = Last.Section
    db.sections.push({ items: [], node })
  } else {
    const section = db.sections[db.sections.length - 1]
    if (section !== undefined) {
      db.last = Last.Item
      if (level < db.sectionLevel) {
        db.misplaced = node.label
      }
      section.items.push(node)
    }
  }
}

/** `OutlineDb::add_node` of `KanbanDb`. */
export function kanbanDbAddNode(
  db: KanbanDb,
  level: number,
  id: string,
  descr: string,
  _kind: number,
  shapeData: string | undefined,
): void {
  if (db.error !== undefined) return
  try {
    kanbanDbAdd(db, level, id, descr, shapeData)
  } catch (error) {
    if (!(error instanceof CompileError)) throw error
    db.error = error
  }
}

/**
 * `OutlineDb::decorate_node` of `KanbanDb`.
 *
 * Mermaid throws a TypeError when a decoration comes before any node. Here it is ignored.
 */
export function kanbanDbDecorateNode(db: KanbanDb, decoration: Decoration): void {
  if (db.error !== undefined) return
  const section = db.sections[db.sections.length - 1]
  if (db.last === undefined || section === undefined) return
  let node: KanbanNode
  if (db.last === Last.Section) {
    node = section.node
  } else {
    const item = section.items[section.items.length - 1]
    if (item === undefined) return
    node = item
  }
  const icon = decoration.icon
  if (icon !== undefined && icon !== '') node.icon = icon
  const cls = decoration.class
  if (cls !== undefined && cls !== '') node.cssClasses = cls
}

/** `KanbanDb` as the `OutlineDb` the shared outline grammar calls. */
export function kanbanDbOutline(db: KanbanDb): OutlineDb {
  return {
    addNode: (level, id, descr, kind, shapeData) => kanbanDbAddNode(db, level, id, descr, kind, shapeData),
    decorateNode: (decoration) => kanbanDbDecorateNode(db, decoration),
  }
}
