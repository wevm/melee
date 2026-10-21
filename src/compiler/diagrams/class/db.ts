/**
 * @module The class model and the operations the parser applies to it. Port of Pele's
 * `src/diagrams/class/db.ts`.
 */
import { type ClassMember, MemberType, classMemberNew } from './members.ts'
import {
  type ClassInterface,
  type ClassNode,
  type ClassNote,
  type ClassRelation,
  LOLLIPOP,
  type NamespaceNode,
  type StyleClass,
  relationEndEq,
  styleClassDefault,
} from './types.ts'
import * as entities from '../../text/entities.ts'
import { trim, trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { sanitizeUrl } from '../../util/url.ts'

/** Records in insertion order with an index by key, as Pele's `Map` keeps them. */
export type Ordered<V> = {
  /** Positions by key. Only looked up, never iterated. */
  index: Map<string, number>
  /** The records in insertion order. */
  values: V[]
}

export function orderedDefault<V>(): Ordered<V> {
  return { index: new Map(), values: [] }
}

/** The record for `key`. */
export function orderedGet<V>(self: Ordered<V>, key: string): V | undefined {
  const at = self.index.get(key)
  return at === undefined ? undefined : self.values[at]
}

/** The record for `key`, to change. */
export function orderedGetMut<V>(self: Ordered<V>, key: string): V | undefined {
  return orderedGet(self, key)
}

/** The position of the record for `key`. */
export function orderedPosition<V>(self: Ordered<V>, key: string): number | undefined {
  return self.index.get(key)
}

/** The number of records. */
export function orderedLen<V>(self: Ordered<V>): number {
  return self.values.length
}

/** Appends a record under `key` and returns its position. */
function orderedInsert<V>(self: Ordered<V>, key: string, value: V): number {
  const at = self.values.length
  self.index.set(key, at)
  self.values.push(value)
  return at
}

/** Mermaid looks up ids that start with a digit under this prefix, so they never match a class. */
const DOM_ID_PREFIX = 'classId-'

/** Splits `Name~T~` into the class name and its generic type. */
export function splitName(id: string): [string, string] {
  const at = id.indexOf('~')
  if (at > 0) {
    const rest = id.slice(at + 1)
    const end = rest.indexOf('~')
    const type = end < 0 ? rest : rest.slice(0, end)
    return [id.slice(0, at), type]
  }
  return [id, '']
}

/** The class name of `Name~T~`, as `splitName(id)[0]` gives it. */
function nameOf(id: string): string {
  const at = id.indexOf('~')
  return at > 0 ? id.slice(0, at) : id
}

/** The class name Mermaid looks an id up under. */
function lookupId(id: string): string {
  const c = id.charCodeAt(0)
  if (c >= 0x30 && c <= 0x39) return nameOf(DOM_ID_PREFIX + id)
  return nameOf(id)
}

/** The parsed class diagram: Pele's `ClassDb`. */
export type ClassDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Classes by name. */
  classes: Ordered<ClassNode>
  /** The flow direction: `TB`, `BT`, `LR`, or `RL`. */
  direction: string
  /** Lollipop interfaces in order. */
  interfaces: ClassInterface[]
  /** The namespaces open while parsing, innermost last. */
  namespaceStack: string[]
  /** Namespaces by full name. */
  namespaces: Ordered<NamespaceNode>
  /** Notes by id. */
  notes: Ordered<ClassNote>
  /** Relations in authored order. */
  relations: ClassRelation[]
  /** Class definitions by name. */
  styleClasses: Ordered<StyleClass>
  /** The front matter title. */
  title: string | undefined
  /** The classes tagged with each class name, in the order they were tagged. */
  withCssClass: Map<string, number[]>
  /** Which classes are in `withCssClass` under each class name. */
  tagged: Map<string, Set<number>>
}

export function classDbDefault(): ClassDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    classes: orderedDefault(),
    direction: 'TB',
    interfaces: [],
    namespaceStack: [],
    namespaces: orderedDefault(),
    notes: orderedDefault(),
    relations: [],
    styleClasses: orderedDefault(),
    title: undefined,
    withCssClass: new Map(),
    tagged: new Map(),
  }
}

/** Adds the class `id` names, unless it exists. */
export function classDbAddClass(self: ClassDb, id: string): void {
  addClass(self, id)
}

/** Adds the class `id` names, unless it exists, and returns its position. */
function addClass(self: ClassDb, id: string): number {
  const className = nameOf(id)
  const existing = orderedPosition(self.classes, className)
  if (existing !== undefined) return existing
  const type = splitName(id)[1]
  const at = orderedInsert(self.classes, className, {
    annotations: [],
    cssClasses: 'default',
    haveCallback: false,
    id: className,
    label: className,
    link: undefined,
    linkTarget: undefined,
    members: [],
    methods: [],
    parent: undefined,
    styles: [],
    tooltip: undefined,
    type,
  })
  tag(self, at, 'default')
  return at
}

/** Records that a class carries `cssClass`, once. */
function tag(self: ClassDb, node: number, cssClass: string): void {
  let set = self.tagged.get(cssClass)
  if (set === undefined) {
    set = new Set()
    self.tagged.set(cssClass, set)
    self.withCssClass.set(cssClass, [node])
    set.add(node)
    return
  }
  if (set.has(node)) return
  set.add(node)
  ;(self.withCssClass.get(cssClass) as number[]).push(node)
}

/**
 * The class for a name that may carry a generic type, created if needed. Mermaid throws a
 * `TypeError` where this creates, as for an annotation on a class not yet declared.
 */
function ensure(self: ClassDb, id: string): number {
  return addClass(self, id)
}

/** Sets the shown name of a class. */
export function classDbSetClassLabel(self: ClassDb, id: string, label: string): void {
  const at = ensure(self, id)
  const node = self.classes.values[at]
  if (node !== undefined) node.label = label
}

/** Adds a relation, creating its classes, and an interface for a lone lollipop end. */
export function classDbAddRelation(self: ClassDb, relation: ClassRelation): void {
  if (relationEndEq(relation.type1, LOLLIPOP) && relation.type2.kind === 'None') {
    classDbAddClass(self, relation.id2)
    relation.id1 = addInterface(self, relation.id1, relation.id2)
  } else if (relationEndEq(relation.type2, LOLLIPOP) && relation.type1.kind === 'None') {
    classDbAddClass(self, relation.id1)
    relation.id2 = addInterface(self, relation.id2, relation.id1)
  } else {
    classDbAddClass(self, relation.id1)
    classDbAddClass(self, relation.id2)
  }
  relation.id1 = nameOf(relation.id1)
  relation.id2 = nameOf(relation.id2)
  relation.relationTitle1 = trim(relation.relationTitle1)
  relation.relationTitle2 = trim(relation.relationTitle2)
  self.relations.push(relation)
}

/** Adds the interface a lone lollipop end stands for and returns its id. */
function addInterface(self: ClassDb, label: string, classId: string): string {
  const id = `interface${self.interfaces.length}`
  self.interfaces.push({ classId, id, label })
  return id
}

/** Adds an annotation to a class. */
export function classDbAddAnnotation(self: ClassDb, className: string, annotation: string): void {
  const at = ensure(self, className)
  const node = self.classes.values[at]
  if (node !== undefined) node.annotations.push(annotation)
}

/** Adds a member line to a class: an annotation, a method, or an attribute. */
export function classDbAddMember(self: ClassDb, className: string, member: string): void {
  const at = ensure(self, className)
  const node = self.classes.values[at]
  if (node === undefined) return
  const text = trim(member)
  const close = text.indexOf(')')
  if (text.startsWith('<<') && text.endsWith('>>')) {
    node.annotations.push(text.slice(2, text.length - 2))
  } else if (close > 0) {
    const parsed: ClassMember = classMemberNew(text, MemberType.Method)
    if (parsed.memberType === MemberType.Method) {
      node.methods.push(parsed)
    } else {
      node.members.push(parsed)
    }
  } else if (text !== '') {
    node.members.push(classMemberNew(text, MemberType.Attribute))
  }
}

/** Adds member lines to a class, in order. */
export function classDbAddMembers(self: ClassDb, className: string, members: string[]): void {
  for (const member of members) classDbAddMember(self, className, member)
}

/** Adds a note, for a class when `className` is given, and returns its id. */
export function classDbAddNote(self: ClassDb, text: string, className: string | undefined): string {
  const index = orderedLen(self.notes)
  const id = `note${index}`
  orderedInsert(self.notes, id, {
    class: className,
    id,
    index,
    parent: undefined,
    text,
  })
  return id
}

/** A label without a leading colon or surrounding whitespace. */
export function classDbCleanupLabel(label: string): string {
  return trim(label.startsWith(':') ? label.slice(1) : label)
}

/** Adds `className` to the classes `ids` names, separated by commas. */
export function classDbSetCssClass(self: ClassDb, ids: string, className: string): void {
  for (const id of ids.split(',')) {
    const at = orderedPosition(self.classes, lookupId(id))
    if (at === undefined) continue
    const node = self.classes.values[at]
    if (node !== undefined) node.cssClasses += ` ${className}`
    for (const word of className.split(' ')) tag(self, at, word)
  }
}

/** Defines classes, and copies their declarations to the classes already tagged with them. */
export function classDbDefineClass(self: ClassDb, ids: string[], style: string[]): void {
  for (const id of ids) {
    let at = orderedPosition(self.styleClasses, id)
    if (at === undefined) {
      at = orderedInsert(self.styleClasses, id, { ...styleClassDefault(), id })
    }
    const def = self.styleClasses.values[at]
    if (def !== undefined) {
      for (const s of style) {
        if (s.includes('color')) def.textStyles.push(replaceFirst(s, 'fill', 'bgFill'))
        def.styles.push(s)
      }
    }
    // Mermaid tests `cssClasses.includes(id)`, which also matches part of a longer name
    // (a classDef named `def` styles every class, through `default`). Whole names are
    // compared here.
    const tagged = self.withCssClass.get(id)
    if (tagged === undefined) continue
    for (const index of tagged) {
      const node = self.classes.values[index]
      if (node === undefined) continue
      for (const s of style) {
        for (const part of s.split(',')) node.styles.push(part)
      }
    }
  }
}

/** Sets the tooltip of the classes `ids` names. */
export function classDbSetTooltip(self: ClassDb, ids: string, tooltip: string | undefined): void {
  if (tooltip === undefined) return
  for (const id of ids.split(',')) {
    const node = orderedGetMut(self.classes, nameOf(id))
    if (node !== undefined) node.tooltip = tooltip
  }
}

/** Links the classes `ids` names, and marks them clickable. */
export function classDbSetLink(self: ClassDb, ids: string, link: string, target: string | undefined): void {
  // Entity codes are resolved first, so that what is checked is what a browser would follow.
  const decoded = entities.decode(link)
  const url = trim(decoded)
  for (const id of ids.split(',')) {
    const node = orderedGetMut(self.classes, lookupId(id))
    if (node !== undefined) {
      node.link = url !== '' ? sanitizeUrl(url) : undefined
      node.linkTarget = target ?? '_blank'
    }
  }
  classDbSetCssClass(self, ids, 'clickable')
}

/**
 * Marks the classes `ids` names as having a callback, and clickable. Callbacks are never
 * executed, as in Mermaid's strict mode.
 */
export function classDbSetClickEvent(self: ClassDb, ids: string): void {
  for (const id of ids.split(',')) {
    const node = orderedGetMut(self.classes, nameOf(id))
    if (node !== undefined) node.haveCallback = true
  }
  classDbSetCssClass(self, ids, 'clickable')
}

/** Sets the flow direction. */
export function classDbSetDirection(self: ClassDb, dir: string): void {
  self.direction = dir
}

/** Sets the accessible title without its leading whitespace. */
export function classDbSetAccTitle(self: ClassDb, text: string): void {
  self.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its continuation lines. */
export function classDbSetAccDescription(self: ClassDb, text: string): void {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 0x0a) {
      while (i < text.length && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  self.accDescr = out
}

/**
 * Opens a namespace inside the open one and returns its full name. A dotted name creates
 * its ancestors.
 */
export function classDbAddNamespace(self: ClassDb, id: string, label: string | undefined): string {
  const prefix = self.namespaceStack[self.namespaceStack.length - 1] ?? ''
  const qualified = prefix === '' ? id : `${prefix}.${id}`
  self.namespaceStack.push(qualified)
  const shown = label !== undefined && label !== '' ? label : undefined

  const existing = orderedGetMut(self.namespaces, qualified)
  if (existing !== undefined) {
    existing.explicit = true
    if (shown !== undefined) existing.label = shown
    return qualified
  }

  // The enclosing namespace and its ancestors exist already, so only the parts of `id` are
  // walked.
  let parentId: string | undefined = prefix !== '' ? prefix : undefined
  let from = prefix === '' ? 0 : prefix.length + 1
  for (;;) {
    const found = from <= qualified.length ? qualified.indexOf('.', from) : -1
    const dot = found < 0 ? undefined : found
    const leaf = dot === undefined
    const end = dot ?? qualified.length
    const current = qualified.slice(0, end)
    const node = orderedGetMut(self.namespaces, current)
    if (node === undefined) {
      const part = qualified.slice(from, end)
      const nodeLabel = shown !== undefined && leaf ? shown : part
      orderedInsert(self.namespaces, current, {
        children: [],
        classes: [],
        explicit: leaf,
        id: current,
        label: nodeLabel,
        notes: [],
        parent: parentId,
      })
    } else if (leaf) {
      node.explicit = true
    }
    if (parentId !== undefined) {
      const parent = orderedGetMut(self.namespaces, parentId)
      if (parent !== undefined) {
        if (!parent.children.includes(current)) parent.children.push(current)
        const child = orderedGetMut(self.namespaces, current)
        if (child !== undefined && child.parent === undefined) child.parent = parentId
      }
    }
    if (leaf) return qualified
    parentId = current
    from = end + 1
  }
}

/** Closes the innermost open namespace. */
export function classDbPopNamespace(self: ClassDb): void {
  self.namespaceStack.pop()
}

/** Puts classes and notes in the namespace `id`. */
export function classDbAddClassesToNamespace(
  self: ClassDb,
  id: string,
  classNames: string[],
  noteNames: string[],
): void {
  const at = orderedPosition(self.namespaces, id)
  if (at === undefined) return
  for (const name of classNames) {
    const className = nameOf(name)
    const node = orderedGetMut(self.classes, className)
    if (node === undefined) continue
    node.parent = id
    const namespace = self.namespaces.values[at]
    if (namespace !== undefined && !namespace.classes.includes(className)) {
      namespace.classes.push(className)
    }
  }
  for (const name of noteNames) {
    const note = orderedGetMut(self.notes, name)
    if (note === undefined) continue
    note.parent = id
    const namespace = self.namespaces.values[at]
    if (namespace !== undefined && !namespace.notes.includes(name)) {
      namespace.notes.push(name)
    }
  }
}

/** Adds style declarations to the class `id` names exactly. */
export function classDbSetCssStyle(self: ClassDb, id: string, styles: string[]): void {
  const node = orderedGetMut(self.classes, id)
  if (node === undefined) return
  for (const s of styles) {
    for (const part of s.split(',')) node.styles.push(part)
  }
}

/** `text.replace(from, to)` with a string pattern: the first occurrence only. */
export function replaceFirst(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0) return text
  return text.slice(0, at) + to + text.slice(at + from.length)
}
