/**
 * @module The requirement model and the operations the parser applies to it. Port of Pele's
 * `src/diagrams/requirement/db.ts`.
 */
import type { Relation, Requirement, RequirementClass, RequirementElement } from './types.ts'
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'

/** What `contains` relationships are called. */
export const CONTAINS = 'contains'

/**
 * Applying a class copies its declarations onto each node, so a short text can ask for hundreds
 * of millions of copies. Past this many the diagram is refused.
 */
const MAX_STYLE_COPIES = 1_000_000

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

/** Whether a record has `key`. */
export function orderedHas<V>(self: Ordered<V>, key: string): boolean {
  return self.index.has(key)
}

function orderedPosition<V>(self: Ordered<V>, key: string): number | undefined {
  return self.index.get(key)
}

function orderedInsert<V>(self: Ordered<V>, key: string, value: V): number {
  const at = self.values.length
  self.index.set(key, at)
  self.values.push(value)
  return at
}

/** Which node a name resolves to: requirements take precedence over elements. */
type NodeRef = { kind: 'Element'; _0: number } | { kind: 'Requirement'; _0: number }

/** The parsed requirement diagram: Pele's `RequirementDb`. */
export type RequirementDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Classes by name. */
  classes: Ordered<RequirementClass>
  /** The flow direction: `TB`, `BT`, `LR`, or `RL`. */
  direction: string
  /** Elements by name. */
  elements: Ordered<RequirementElement>
  // The grammar reports a body's fields before the requirement or element they belong to.
  newDocRef: string
  newElementType: string
  newId: string
  newRisk: string
  newText: string
  newVerifyMethod: string
  /** Relationships in authored order. */
  relations: Relation[]
  /** Requirements by name. */
  requirements: Ordered<Requirement>
  styleCopies: number
  /** The front matter title. */
  title: string | undefined
}

/** `RequirementDb::default()`. */
export function requirementDbDefault(): RequirementDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    classes: orderedDefault(),
    direction: 'TB',
    elements: orderedDefault(),
    newDocRef: '',
    newElementType: '',
    newId: '',
    newRisk: '',
    newText: '',
    newVerifyMethod: '',
    relations: [],
    requirements: orderedDefault(),
    styleCopies: 0,
    title: undefined,
  }
}

function tooManyCopies(): CompileError {
  const error = errorNew(Code.Limit, 'Requirement diagram applies too many style declarations.')
  error.type = 'requirement'
  return error
}

/** Counts `count` more copied declarations against the limit. */
function count(self: RequirementDb, more: number): void {
  self.styleCopies += more
  if (self.styleCopies > MAX_STYLE_COPIES) throw tooManyCopies()
}

/** Sets the flow direction. */
export function requirementDbSetDirection(self: RequirementDb, dir: string): void {
  self.direction = dir
}

/** Adds a requirement with the pending fields, unless one has this name. */
export function requirementDbAddRequirement(self: RequirementDb, name: string, type: string): void {
  if (!orderedHas(self.requirements, name)) {
    const requirement: Requirement = {
      name,
      type,
      requirementId: self.newId,
      text: self.newText,
      risk: self.newRisk,
      verifyMethod: self.newVerifyMethod,
      cssStyles: [],
      classes: ['default'],
    }
    orderedInsert(self.requirements, name, requirement)
  }
  self.newId = ''
  self.newText = ''
  self.newRisk = ''
  self.newVerifyMethod = ''
}

/** Sets the pending `id` field. */
export function requirementDbSetNewReqId(self: RequirementDb, id: string): void {
  self.newId = id
}

/** Sets the pending `text` field. */
export function requirementDbSetNewReqText(self: RequirementDb, text: string): void {
  self.newText = text
}

/** Sets the pending `risk` field. */
export function requirementDbSetNewReqRisk(self: RequirementDb, risk: string): void {
  self.newRisk = risk
}

/** Sets the pending `verifymethod` field. */
export function requirementDbSetNewReqVerifyMethod(self: RequirementDb, method: string): void {
  self.newVerifyMethod = method
}

/** Adds an element with the pending fields, unless one has this name. */
export function requirementDbAddElement(self: RequirementDb, name: string): void {
  if (!orderedHas(self.elements, name)) {
    const element: RequirementElement = {
      name,
      type: self.newElementType,
      docRef: self.newDocRef,
      cssStyles: [],
      classes: ['default'],
    }
    orderedInsert(self.elements, name, element)
  }
  self.newElementType = ''
  self.newDocRef = ''
}

/** Sets the pending `type` field. */
export function requirementDbSetNewElementType(self: RequirementDb, type: string): void {
  self.newElementType = type
}

/** Sets the pending `docref` field. */
export function requirementDbSetNewElementDocRef(self: RequirementDb, docRef: string): void {
  self.newDocRef = docRef
}

/** Adds a relationship. */
export function requirementDbAddRelationship(self: RequirementDb, type: string, src: string, dst: string): void {
  self.relations.push({ type, src, dst })
}

function node(self: RequirementDb, id: string): NodeRef | undefined {
  const requirement = orderedPosition(self.requirements, id)
  if (requirement !== undefined) return { kind: 'Requirement', _0: requirement }
  const element = orderedPosition(self.elements, id)
  if (element !== undefined) return { kind: 'Element', _0: element }
  return undefined
}

function nodeMut(self: RequirementDb, node: NodeRef): [string[], string[]] | undefined {
  if (node.kind === 'Requirement') {
    const r = self.requirements.values[node._0]
    return r === undefined ? undefined : [r.cssStyles, r.classes]
  }
  const e = self.elements.values[node._0]
  return e === undefined ? undefined : [e.cssStyles, e.classes]
}

/**
 * Adds style declarations to the named nodes.
 *
 * @throws {CompileError} A limit error past the most copied declarations.
 */
export function requirementDbSetCssStyle(self: RequirementDb, ids: string[], styles: string[]): void {
  for (const id of ids) {
    // Mermaid stops at the first unknown id, leaving the rest of the list unstyled.
    const found = node(self, id)
    if (found === undefined) return
    for (const style of styles) {
      const parts = style.split(',')
      count(self, parts.length)
      const target = nodeMut(self, found)
      if (target !== undefined) for (const part of parts) target[0].push(part)
    }
  }
}

/**
 * Adds classes to the named nodes, with the declarations they define so far.
 *
 * @throws {CompileError} A limit error past the most copied declarations.
 */
export function requirementDbSetClass(self: RequirementDb, ids: string[], classNames: string[]): void {
  for (const id of ids) {
    const found = node(self, id)
    if (found === undefined) continue
    for (const name of classNames) {
      const styles = orderedGet(self.classes, name)?.styles.slice() ?? []
      const target = nodeMut(self, found)
      if (target !== undefined) target[1].push(name)
      count(self, styles.length)
      if (target !== undefined) for (const style of styles) target[0].push(style)
    }
  }
}

/**
 * Defines classes, and adds their declarations to the nodes that already have them.
 *
 * @throws {CompileError} A limit error past the most copied declarations.
 */
export function requirementDbDefineClass(self: RequirementDb, ids: string[], style: string[]): void {
  const split: string[] = []
  for (const s of style) for (const part of s.split(',')) split.push(part)
  for (const id of ids) {
    let at = orderedPosition(self.classes, id)
    if (at === undefined) at = orderedInsert(self.classes, id, { id, styles: [], textStyles: [] })
    const klass = self.classes.values[at]
    if (klass !== undefined) {
      for (const s of style) {
        if (s.includes('color')) klass.textStyles.push(replaceFirst(s, 'fill', 'bgFill'))
        klass.styles.push(s)
      }
    }

    const targets: NodeRef[] = []
    self.requirements.values.forEach((requirement, at) => {
      if (requirement.classes.some((c) => c === id)) targets.push({ kind: 'Requirement', _0: at })
    })
    self.elements.values.forEach((element, at) => {
      if (element.classes.some((c) => c === id)) targets.push({ kind: 'Element', _0: at })
    })
    for (const target of targets) {
      count(self, split.length)
      const lists = nodeMut(self, target)
      if (lists !== undefined) for (const part of split) lists[0].push(part)
    }
  }
}

/** Sets the accessible title without its leading whitespace. */
export function requirementDbSetAccTitle(self: RequirementDb, text: string): void {
  self.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its continuation lines. */
export function requirementDbSetAccDescription(self: RequirementDb, text: string): void {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 0x0a) {
      while (i < n && isSpace(text.charCodeAt(i))) i += 1
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
