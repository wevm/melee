/**
 * @module The state model builder: Mermaid's `StateDB` in its version 2 form, which Mermaid uses
 * for both `stateDiagram` and `stateDiagram-v2`. Port of Pele's `src/diagrams/state/db.ts`.
 *
 * Pele keeps states, classes, and links in `Map`s. Here each is an array in insertion order with a
 * `Map` index for lookups.
 */
import { type StateGraph, buildStateGraph, stateGraphDefault } from './graph.ts'
import {
  type Description,
  type StateClassDef,
  type StateLink,
  type StateNote,
  type StateRelation,
  type StateStmt,
  type Stmt,
  descriptionTexts,
  descriptionTruthy,
  stateStmtDefault,
} from './types.ts'
import { trim } from '../../text/label.ts'

/** The parsed state diagram: Pele's `StateDb`. */
export type StateDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Class definitions, in insertion order. */
  classes: StateClassDef[]
  /** The nodes and edges that are drawn. */
  graph: StateGraph
  /** Links by state id, in insertion order. */
  links: [string, StateLink][]
  /** Transitions of the root document. */
  relations: StateRelation[]
  /** The parsed document. */
  rootDoc: Stmt[]
  /**
   * For each state, the root statement whose body Pele's model shares with it. Pele records the
   * body itself, which nothing reads after the graph is built.
   */
  stateDocs: (number | undefined)[]
  /** States of the root document, in insertion order. */
  states: StateStmt[]
  /** The front matter title. */
  title: string | undefined

  classIndex: Map<string, number>
  dividerCount: number
  linkIndex: Map<string, number>
  stateIndex: Map<string, number>
}

/** `StateDb::default()`. */
export function stateDbDefault(): StateDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    classes: [],
    graph: stateGraphDefault(),
    links: [],
    relations: [],
    rootDoc: [],
    stateDocs: [],
    states: [],
    title: undefined,
    classIndex: new Map(),
    dividerCount: 0,
    linkIndex: new Map(),
    stateIndex: new Map(),
  }
}

/** A frame of the document walk in {@link translate}. */
type Frame = {
  /** The body being walked. */
  doc: Stmt[]
  /** The next statement to visit. */
  at: number
  /** The id that names `[*]` states in the body. */
  parentId: string
  /** The index of the body's owner in the enclosing frame, or `undefined` for the root document. */
  slot: number | undefined
}

/** `text` with the first `from` replaced by `to`, as `String.prototype.replace` with a string does. */
function replaceFirst(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0) return text
  return text.slice(0, at) + to + text.slice(at + from.length)
}

/** Renames a `[*]` state after its document, or trims another state's id. */
function name(node: StateStmt, parentId: string, first: boolean): void {
  if (node.id === '[*]') {
    node.id = parentId + (first ? '_start' : '_end')
    node.start = first
  } else {
    node.id = trim(node.id)
  }
}

/** The direction the root document is laid out in: its last `direction` statement. */
export function stateDbDirection(self: StateDb): string {
  let dir = 'TB'
  for (const item of self.rootDoc) {
    if (item.kind === 'Dir') dir = item._0
  }
  return dir
}

/**
 * Stores the parsed document and builds the model from it.
 *
 * Throws a semantic error for a composite state with a description.
 */
export function stateDbSetRootDoc(self: StateDb, doc: Stmt[]): void {
  self.rootDoc = doc
  translate(self)
  extract(self)
  const graph = buildStateGraph(self.rootDoc, self)
  self.graph = graph
}

/** The root document's state named `id`. */
export function stateDbState(self: StateDb, id: string): StateStmt | undefined {
  const at = self.stateIndex.get(id)
  return at === undefined ? undefined : self.states[at]
}

/** The class definition named `id`. */
export function stateDbClass(self: StateDb, id: string): StateClassDef | undefined {
  const at = self.classIndex.get(id)
  return at === undefined ? undefined : self.classes[at]
}

/** The link on the state named `id`. */
export function stateDbLink(self: StateDb, id: string): StateLink | undefined {
  const at = self.linkIndex.get(id)
  return at === undefined ? undefined : self.links[at]?.[1]
}

/**
 * Only the root document's statements become states, relations, and classes here. The
 * statements inside composites are read when the graph is built.
 */
function extract(self: StateDb): void {
  self.states = []
  self.stateIndex.clear()
  self.relations = []
  self.classes = []
  self.classIndex.clear()

  self.stateDocs = []

  const doc = self.rootDoc
  self.rootDoc = []
  for (let at = 0; at < doc.length; at++) {
    const item = doc[at] as Stmt
    switch (item.kind) {
      case 'State': {
        const state = item._0
        addState(
          self,
          state.id,
          state.type,
          state.doc === undefined ? undefined : at,
          state.description,
          state.note,
          undefined,
        )
        break
      }
      case 'Relation': {
        const relation = item._0
        addRelation(self, relation.state1, relation.state2, relation.description ?? '')
        break
      }
      case 'ClassDef':
        addStyleClass(self, trim(item.id), item.classes)
        break
      case 'Style': {
        const styles = item.styleClass.split(',').map((s) => trim(s.replaceAll(';', '')))
        for (const at of named(self, trim(item.id))) {
          const state = self.states[at]
          if (state !== undefined) state.styles = styles.slice()
        }
        break
      }
      case 'ApplyClass':
        setCssClass(self, trim(item.id), item.styleClass)
        break
      case 'Click':
        addLink(self, item.id.id, item.url, item.tooltip)
        break
      case 'Dir':
      case 'Text':
        break
    }
  }
  self.rootDoc = doc
}

/**
 * Mermaid's `docTranslator`: gives each `[*]` an id scoped to its parent, and turns a body
 * split by `--` into one region per part. Walks the tree with an explicit stack, in Pele's
 * order, so deep nesting cannot overflow the call stack.
 */
function translate(self: StateDb): void {
  // Pele also regroups the root document, but into a copy it then drops. Dividers only lex
  // inside a body, so the root document never has one.
  const stack: Frame[] = [{ at: 0, doc: self.rootDoc, parentId: 'root', slot: undefined }]
  self.rootDoc = []
  for (;;) {
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined
    if (top === undefined) break
    const at = top.at
    if (at >= top.doc.length) {
      const frame = stack.pop() as Frame
      const parent = stack.length > 0 ? stack[stack.length - 1] : undefined
      if (frame.slot !== undefined && parent !== undefined) {
        const owner = parent.doc[frame.slot]
        if (owner?.kind === 'State') owner._0.doc = frame.doc
      } else {
        self.rootDoc = frame.doc
      }
      continue
    }
    top.at += 1

    const parentId = top.parentId
    const item = top.doc[at]
    let body: [string, Stmt[]] | undefined
    if (item?.kind === 'Relation') {
      name(item._0.state1, parentId, true)
      name(item._0.state2, parentId, false)
    } else if (item?.kind === 'State') {
      const state = item._0
      name(state, parentId, true)
      const doc = state.doc
      state.doc = undefined
      if (doc !== undefined) body = [state.id, doc]
    }
    if (body !== undefined) {
      const doc = regions(self, body[1])
      stack.push({ at: 0, doc, parentId: body[0], slot: at })
    }
  }
}

/** A body split into one region per part between dividers, or the body as it is when it has none. */
function regions(self: StateDb, doc: Stmt[]): Stmt[] {
  const regions: Stmt[] = []
  let current: Stmt[] = []
  for (const item of doc) {
    if (item.kind === 'State' && item._0.type === 'divider' && item._0.doc === undefined) {
      item._0.doc = current
      current = []
      regions.push(item)
    } else {
      current.push(item)
    }
  }
  if (regions.length === 0) return current
  // Mermaid names the region after the last divider with a random id. Here it continues the
  // divider numbering. Mermaid also leaves a body that ends with a divider ungrouped and then
  // fails to draw it. Here the regions before that divider are kept.
  if (current.length > 0) {
    regions.push({
      kind: 'State',
      _0: { ...stateStmtDefault(), doc: current, id: stateDbDividerId(self), type: 'divider' },
    })
  }
  return regions
}

/** Records a state, or merges into the one already recorded under the trimmed id. */
function addState(
  self: StateDb,
  id: string,
  type: string | undefined,
  doc: number | undefined,
  descr: Description | undefined,
  note: StateNote | undefined,
  classes: string[] | undefined,
): void {
  const ty = type ?? 'default'
  const trimmed = trim(id)
  let at = self.stateIndex.get(trimmed)
  if (at !== undefined) {
    if (at < self.stateDocs.length && self.stateDocs[at] === undefined) self.stateDocs[at] = doc
    const state = self.states[at]
    if (state !== undefined && (state.type === undefined || state.type === '')) state.type = ty
  } else {
    self.stateIndex.set(trimmed, self.states.length)
    self.stateDocs.push(doc)
    self.states.push({
      classes: [],
      description: undefined,
      descriptions: [],
      doc: undefined,
      id: trimmed,
      note: note === undefined ? undefined : { position: note.position, text: note.text },
      start: undefined,
      styles: [],
      textStyles: [],
      type: ty,
    })
    at = self.states.length - 1
  }

  if (descr !== undefined && descriptionTruthy(descr)) {
    for (const text of descriptionTexts(descr)) addDescription(self, at, trim(text))
  }
  const state = self.states[at]
  if (note !== undefined && state !== undefined) state.note = { position: note.position, text: note.text }
  if (classes !== undefined) {
    for (const name of classes) setCssClass(self, trimmed, trim(name))
  }
}

function addLink(self: StateDb, stateId: string, url: string, tooltip: string): void {
  const link: StateLink = { tooltip, url }
  const at = self.linkIndex.get(stateId)
  if (at !== undefined) {
    const entry = self.links[at]
    if (entry !== undefined) {
      entry[1] = link
      return
    }
  }
  self.linkIndex.set(stateId, self.links.length)
  self.links.push([stateId, link])
}

function addRelation(self: StateDb, item1: StateStmt, item2: StateStmt, title: string): void {
  // A transition's states have no body.
  addState(self, item1.id, item1.type, undefined, item1.description, item1.note, item1.classes)
  addState(self, item2.id, item2.type, undefined, item2.description, item2.note, item2.classes)
  self.relations.push({ id1: trim(item1.id), id2: trim(item2.id), relationTitle: title })
}

function addDescription(self: StateDb, at: number, descr: string): void {
  const text = descr.startsWith(':') ? trim(descr.slice(1)) : descr
  self.states[at]?.descriptions?.push(text)
}

/** The next divider id, as Pele's `getDividerId` numbers them. */
export function stateDbDividerId(self: StateDb): string {
  self.dividerCount += 1
  return `divider-id-${self.dividerCount}`
}

function addStyleClass(self: StateDb, id: string, styleAttributes: string): void {
  let at = self.classIndex.get(id)
  if (at === undefined) {
    self.classIndex.set(id, self.classes.length)
    self.classes.push({ id, styles: [], textStyles: [] })
    at = self.classes.length - 1
  }
  if (styleAttributes === '') return
  const found = self.classes[at]
  if (found === undefined) return
  for (const attrib of styleAttributes.split(',')) {
    const fixed = trim(replaceFirst(attrib, ';', ''))
    if (attrib.includes('color')) {
      found.textStyles.push(replaceFirst(replaceFirst(fixed, 'fill', 'bgFill'), 'color', 'fill'))
    }
    found.styles.push(fixed)
  }
}

function setCssClass(self: StateDb, itemIds: string, cssClassName: string): void {
  for (const at of named(self, itemIds)) {
    self.states[at]?.classes?.push(cssClassName)
  }
}

/**
 * The states a comma-separated list of ids names, created where they do not exist yet. As in
 * Mermaid, an id is looked up as written and trimmed only when it has to be created.
 */
function named(self: StateDb, ids: string): number[] {
  const out: number[] = []
  for (const id of ids.split(',')) {
    const found = self.stateIndex.get(id)
    if (found !== undefined) {
      out.push(found)
      continue
    }
    addState(self, id, undefined, undefined, undefined, undefined, undefined)
    const at = self.stateIndex.get(trim(id))
    if (at !== undefined) out.push(at)
  }
  return out
}
