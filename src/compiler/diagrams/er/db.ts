/**
 * @module The ER model and the operations the parser applies to it. Port of Pele's
 * `src/diagrams/er/db.ts`.
 */
import { trim, trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import type { DocItem, ErAttribute, ErClassDef, ErEntity, ErRelationship, ErSubgraph, RelSpec } from './types.ts'

/** Records in insertion order with an index by key, as Pele's `Map` keeps them. */
export type Ordered<V> = {
  /** Positions by key. Only looked up, never iterated. */
  index: Map<string, number>
  /** The records in insertion order. */
  values: V[]
}

/** `Ordered::default()`. */
export function orderedDefault<V>(): Ordered<V> {
  return { index: new Map(), values: [] }
}

/** The record for `key`. */
export function orderedGet<V>(self: Ordered<V>, key: string): V | undefined {
  const at = self.index.get(key)
  return at === undefined ? undefined : self.values[at]
}

/** Appends a record under `key` and returns its position. */
function orderedInsert<V>(self: Ordered<V>, key: string, value: V): number {
  const at = self.values.length
  self.index.set(key, at)
  self.values.push(value)
  return at
}

/** The parsed ER diagram: Pele's `ErDb`. */
export type ErDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Names already placed in a subgraph. */
  claimed: Set<string>
  /** Class definitions by name. */
  classes: Ordered<ErClassDef>
  /** The flow direction: `TB`, `BT`, `LR`, or `RL`. */
  direction: string
  /** Entities by name. */
  entities: Ordered<ErEntity>
  /** Relationships in authored order. */
  relationships: ErRelationship[]
  /** The latest subgraph of each id. */
  subgraphLookup: Map<string, number>
  /** Subgraphs in the order they close. */
  subgraphs: ErSubgraph[]
  /** The front matter title. */
  title: string | undefined
}

/** `ErDb::default()`. */
export function erDbDefault(): ErDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    claimed: new Set(),
    classes: orderedDefault(),
    direction: 'TB',
    entities: orderedDefault(),
    relationships: [],
    subgraphLookup: new Map(),
    subgraphs: [],
    title: undefined,
  }
}

/**
 * Adds the entity `name`, unless it exists, and gives it `alias` if it has none. Returns its
 * position.
 */
export function erDbAddEntity(self: ErDb, name: string, alias: string): number {
  const existing = self.entities.index.get(name)
  if (existing !== undefined) {
    const entity = self.entities.values[existing]
    if (entity !== undefined && entity.alias === '' && alias !== '') entity.alias = alias
    return existing
  }
  const id = `entity-${name}-${self.entities.values.length}`
  return orderedInsert(self.entities, name, {
    alias,
    attributes: [],
    cssClasses: 'default',
    cssStyles: [],
    id,
    label: name,
  })
}

/** Adds attributes to an entity, in order. */
export function erDbAddAttributes(self: ErDb, name: string, attributes: ErAttribute[]): void {
  const at = erDbAddEntity(self, name, '')
  const entity = self.entities.values[at]
  if (entity !== undefined) entity.attributes.push(...attributes)
}

/** The id of an end of a relationship: the subgraph's when the name is one, else the entity's. */
function endId(self: ErDb, name: string): string {
  if (self.subgraphLookup.has(name)) return name
  const at = erDbAddEntity(self, name, '')
  return self.entities.values[at]?.id ?? ''
}

/** Adds a relationship. */
export function erDbAddRelationship(self: ErDb, entA: string, roleA: string, entB: string, relSpec: RelSpec): void {
  const entityA = endId(self, entA)
  const entityB = endId(self, entB)
  self.relationships.push({ entityA, entityB, relSpec, roleA })
}

/** Sets the flow direction. */
export function erDbSetDirection(self: ErDb, dir: string): void {
  self.direction = dir
}

/** The subgraph the lookup holds for `id`. */
function lookupSubgraph(self: ErDb, id: string): ErSubgraph | undefined {
  const at = self.subgraphLookup.get(id)
  return at === undefined ? undefined : self.subgraphs[at]
}

/** Adds style declarations to the entities and subgraphs `ids` names. */
export function erDbAddCssStyles(self: ErDb, ids: string[], styles: string[]): void {
  for (const id of ids) {
    const entity = orderedGet(self.entities, id)
    if (entity !== undefined) entity.cssStyles.push(...styles)
    const subgraph = lookupSubgraph(self, id)
    if (subgraph !== undefined) subgraph.cssStyles.push(...styles)
  }
}

/** Defines classes. */
export function erDbAddClass(self: ErDb, ids: string[], styles: string[]): void {
  for (const id of ids) {
    let at = self.classes.index.get(id)
    if (at === undefined) at = orderedInsert(self.classes, id, { id, styles: [], textStyles: [] })
    const def = self.classes.values[at]
    if (def === undefined) continue
    for (const style of styles) {
      if (style.includes('color')) def.textStyles.push(replaceFirst(style, 'fill', 'bgFill'))
      def.styles.push(style)
    }
  }
}

/** Adds class names to the entities and subgraphs `ids` names. */
export function erDbSetClass(self: ErDb, ids: string[], classNames: string[]): void {
  for (const id of ids) {
    const entity = orderedGet(self.entities, id)
    if (entity !== undefined) {
      for (const name of classNames) entity.cssClasses += ` ${name}`
    }
    const subgraph = lookupSubgraph(self, id)
    if (subgraph !== undefined) subgraph.classes.push(...classNames)
  }
}

/**
 * Closes a subgraph holding the statements `list`, and returns its id. A name belongs to the
 * first subgraph that lists it.
 */
export function erDbAddSubGraph(self: ErDb, rawId: string, list: DocItem[], title: string): string {
  const id = trim(rawId)
  const seen = new Set<string>()
  const nodes: string[] = []
  let dir: string | undefined
  for (const item of list) {
    if (item.kind === 'Dir') {
      dir = item._0
      continue
    }
    const trimmed = trim(item._0)
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    if (!self.claimed.has(item._0)) nodes.push(item._0)
  }
  for (const node of nodes) self.claimed.add(node)
  self.subgraphLookup.set(id, self.subgraphs.length)
  self.subgraphs.push({ classes: [], cssStyles: [], dir, id, nodes, title: trim(title) })
  return id
}

/** Sets the accessible title without its leading whitespace. */
export function erDbSetAccTitle(self: ErDb, text: string): void {
  self.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its continuation lines. */
export function erDbSetAccDescription(self: ErDb, text: string): void {
  // `\s` is all in the Basic Multilingual Plane, so stepping UTF-16 units tests the same.
  let out = ''
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    out += text[i]
    i++
    if (c === 0x0a) {
      while (i < n && isSpace(text.charCodeAt(i))) i++
    }
  }
  self.accDescr = out
}

/** `text.replace(from, to)` with a string pattern: the first occurrence only. */
function replaceFirst(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0) return text
  return text.slice(0, at) + to + text.slice(at + from.length)
}
