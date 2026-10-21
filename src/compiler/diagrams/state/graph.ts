/**
 * @module Resolves a state document into the nodes and edges that are drawn: Mermaid's
 * `dataFetcher`. Port of Pele's `src/diagrams/state/graph.ts`.
 */
import { type StateDb, stateDbClass, stateDbState } from './db.ts'
import { type Description, type StateStmt, type Stmt, descriptionTexts, descriptionTruthy } from './types.ts'
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trim } from '../../text/label.ts'

/** Pele's `StateNode`. */
export type StateNode = {
  /** The palette slot of a container. */
  colorIndex: number | undefined
  /** Class names, space-separated. */
  cssClasses: string
  /** Styles from the node's classes. */
  cssCompiledStyles: string[]
  /** Styles from `style` statements. */
  cssStyles: string[]
  /** The lines below the label. */
  description: string[]
  /** The direction inside a composite: its last `direction` statement, or TB. */
  dir: string | undefined
  /** The node id. */
  id: string
  /** Whether the node is a container. */
  isGroup: boolean
  /** The label. */
  label: string | undefined
  /** The state a note belongs to. */
  noteFor: string | undefined
  /** The id of the enclosing container. */
  parentId: string | undefined
  /** A note's `left of` or `right of`. */
  position: string | undefined
  /**
   * `rect`, `rectWithTitle`, `stateStart`, `stateEnd`, `choice`, `fork`, `join`, `divider`,
   * `roundedWithTitle`, `note`, or `noteGroup`.
   */
  shape: string | undefined
  /** `group` or `node`. */
  type: string | undefined
}

/** `StateNode::default()`. */
export function stateNodeDefault(): StateNode {
  return {
    colorIndex: undefined,
    cssClasses: '',
    cssCompiledStyles: [],
    cssStyles: [],
    description: [],
    dir: undefined,
    id: '',
    isGroup: false,
    label: undefined,
    noteFor: undefined,
    parentId: undefined,
    position: undefined,
    shape: undefined,
    type: undefined,
  }
}

/** Pele's `StateEdge`. Labels are markdown throughout, as in Mermaid. */
export type StateEdge = {
  /** Class names, space-separated. */
  classes: string
  /** The node the edge reaches. */
  end: string
  /** The edge id. */
  id: string
  /** The label. */
  label: string
  /** Whether the edge is dashed: a note's connector. */
  pattern: string | undefined
  /** The node the edge leaves. */
  start: string
}

/** Pele's `StateGraph`. */
export type StateGraph = {
  /** The edges, in document order. */
  edges: StateEdge[]
  /** The nodes, in document order. */
  nodes: StateNode[]
}

/** `StateGraph::default()`. */
export function stateGraphDefault(): StateGraph {
  return { edges: [], nodes: [] }
}

/** A node's settings, decided when its state is first met and refined by later mentions. */
type Draft = {
  colorIndex: number | undefined
  cssClasses: string
  cssStyles: string[]
  description: Description
  dir: string | undefined
  group: boolean
  shape: string | undefined
}

/** A body being walked. */
type Frame = {
  alt: boolean
  at: number
  doc: Stmt[]
  item: StateStmt | undefined
}

/** The direction of a body: its last `direction` statement, or TB. */
function direction(doc: Stmt[]): string {
  let dir = 'TB'
  for (const item of doc) {
    if (item.kind === 'Dir') dir = item._0
  }
  return dir
}

/** The length of a description as JavaScript reads it: UTF-16 units of a string, or items. */
function descriptionLength(description: Description): number {
  return description._0.length
}

/**
 * The styles of the classes a node names, in order, as Pele's `insert` compiles them. Pele
 * compiles on every insert, and the last insert decides, so compiling the final classes once
 * gives the same result.
 */
function compiledStyles(db: StateDb, cssClasses: string): string[] {
  if (cssClasses === '' || db.classes.length === 0) return []
  const compiled: string[] = []
  for (const name of cssClasses.split(' ')) {
    const def = stateDbClass(db, name)
    if (def !== undefined) compiled.push(...def.styles)
  }
  return compiled
}

/** The builder's state. Pele keeps these as closure variables of `buildStateGraph`. */
type Builder = {
  byId: Map<string, number>
  counter: number
  db: StateDb
  /** For each node, whether a state's visit wrote it last, so it copies its draft at the end. */
  deferred: boolean[]
  drafts: Map<string, Draft>
  edges: StateEdge[]
  nextSlot: number
  nodes: StateNode[]
  slots: Map<string, number | undefined>
}

function nextCounter(self: Builder): number {
  const value = self.counter
  self.counter += 1
  return value
}

/**
 * Adds a node, or merges it into the one already added under its id, as `Object.assign` does. A
 * note's node has no `colorIndex`, and a state's node has no `position` or `noteFor`, so those
 * are kept from the earlier node.
 *
 * A state's node arrives without its label, description, and classes. They are copied from its
 * draft once the walk ends: the draft only changes while its state is visited, and every visit
 * ends by inserting the node again, so the last copy Pele makes is of the final draft. Copying
 * once keeps a state mentioned many times linear.
 */
function insert(self: Builder, node: StateNode, aside: boolean): void {
  // The two literal ids are what DOMPurify leaves of `<<fork>>` and `<<choice>>` in Mermaid,
  // kept for parity.
  if (node.id === '' || node.id === '</join></fork>' || node.id === '</choice>') return

  const at = self.byId.get(node.id)
  if (at === undefined) {
    self.byId.set(node.id, self.nodes.length)
    self.nodes.push(node)
    self.deferred.push(!aside)
    return
  }
  const existing = self.nodes[at]
  if (existing === undefined || at >= self.deferred.length) return
  self.deferred[at] = !aside
  const parentId = node.parentId ?? existing.parentId
  const colorIndex = existing.colorIndex
  const noteFor = existing.noteFor
  const position = existing.position
  const asideNoteFor = node.noteFor
  node.parentId = parentId
  if (aside) {
    node.colorIndex = colorIndex
    node.noteFor = asideNoteFor ?? noteFor
  } else {
    node.noteFor = noteFor
    node.position = position
  }
  self.nodes[at] = node
}

/** The class names of a recorded state, space-separated. */
function classStr(known: StateStmt | undefined): string {
  return known?.classes?.join(' ') ?? ''
}

function visit(self: Builder, parent: StateStmt | undefined, item: StateStmt, alt: boolean): void {
  const id = item.id
  if (id === 'root') return
  const known = stateDbState(self.db, id)
  const styles = known?.styles ?? []

  if (!self.drafts.has(id)) {
    let shape: string | undefined = 'rect'
    if (item.start === true) shape = 'stateStart'
    else if (item.start === false) shape = 'stateEnd'
    if (item.type !== 'default') shape = item.type
    const cssClasses = `${classStr(known)} statediagram-state`
    self.drafts.set(id, {
      colorIndex: undefined,
      cssClasses,
      cssStyles: styles.slice(),
      description: { kind: 'One', _0: id },
      dir: undefined,
      group: false,
      shape,
    })
  }
  const draft = self.drafts.get(id)
  if (draft === undefined) return

  const description = item.description
  if (description !== undefined && descriptionTruthy(description)) {
    const own = draft.description
    if (own.kind === 'Many') {
      draft.shape = 'rectWithTitle'
      own._0.push(...descriptionTexts(description))
    } else if (own._0 !== '') {
      draft.shape = 'rectWithTitle'
      const texts = own._0 === id ? [] : [own._0]
      texts.push(...descriptionTexts(description))
      draft.description = { kind: 'Many', _0: texts }
    } else {
      draft.shape = 'rect'
      draft.description =
        description.kind === 'Many'
          ? { kind: 'Many', _0: description._0.slice() }
          : { kind: 'One', _0: description._0 }
    }
  }
  if (draft.shape === 'rectWithTitle' && descriptionLength(draft.description) === 1) {
    draft.shape = draft.group ? 'roundedWithTitle' : 'rect'
  }

  if (!draft.group && item.doc !== undefined) {
    draft.group = true
    draft.dir = direction(item.doc)
    draft.shape = item.type === 'divider' ? 'divider' : 'roundedWithTitle'
    // A container takes the next palette slot unless it is a region, which shares its
    // composite's.
    if (parent !== undefined && draft.shape === 'divider' && self.slots.has(parent.id)) {
      draft.colorIndex = self.slots.get(parent.id)
    } else {
      const slot = self.nextSlot
      self.nextSlot += 1
      draft.colorIndex = trim(classStr(known)) === '' && styles.length === 0 ? slot : undefined
    }
    self.slots.set(id, draft.colorIndex)
    draft.cssClasses += ' statediagram-cluster '
    if (alt) draft.cssClasses += 'statediagram-cluster-alt'
  }

  const node: StateNode = {
    colorIndex: draft.colorIndex,
    cssClasses: '',
    cssCompiledStyles: [],
    cssStyles: [],
    description: [],
    dir: draft.dir,
    id,
    isGroup: draft.group,
    label: undefined,
    noteFor: undefined,
    parentId: undefined,
    position: undefined,
    shape: draft.shape,
    type: draft.group ? 'group' : undefined,
  }
  const groupClasses = item.note !== undefined ? draft.cssClasses : ''
  if (parent !== undefined && parent.id !== 'root') node.parentId = parent.id

  const note = item.note
  if (note === undefined) {
    insert(self, node, false)
    return
  }
  // Mermaid puts each note in a group of its own, named after the state. Pele keeps that group in
  // the model and lays the note out beside its state instead.
  const aside = (asideId: string, shape: string, cssClasses: string, group: boolean): StateNode => ({
    colorIndex: undefined,
    cssClasses,
    cssCompiledStyles: [],
    cssStyles: [],
    description: [],
    dir: undefined,
    id: asideId,
    isGroup: group,
    label: note.text,
    noteFor: undefined,
    parentId: undefined,
    position: note.position,
    shape,
    type: group ? 'group' : 'node',
  })
  const noteId = `${id}----note-${nextCounter(self)}`
  const groupId = `${id}----parent`
  const noteNode = aside(noteId, 'note', 'statediagram-note', false)
  noteNode.parentId = groupId
  noteNode.noteFor = id
  insert(self, aside(groupId, 'noteGroup', groupClasses, true), true)
  const noteNodeId = noteNode.id
  insert(self, noteNode, true)
  insert(self, node, false)

  const left = note.position === 'left of'
  const [from, to] = left ? [noteNodeId, id] : [id, noteNodeId]
  self.edges.push({
    classes: 'transition note-edge',
    end: to,
    id: `${from}-${to}`,
    label: '',
    pattern: 'dashed',
    start: from,
  })
}

/**
 * Walks the documents and resolves them into the nodes and edges that are drawn, reading the root
 * document's states and classes from `db`.
 *
 * Throws a semantic error for a composite state with a description.
 */
export function buildStateGraph(rootDoc: Stmt[], db: StateDb): StateGraph {
  const builder: Builder = {
    byId: new Map(),
    counter: 0,
    db,
    deferred: [],
    drafts: new Map(),
    edges: [],
    nextSlot: 0,
    nodes: [],
    slots: new Map(),
  }

  const stack: Frame[] = [{ alt: true, at: 0, doc: rootDoc, item: undefined }]
  for (;;) {
    const frame = stack.length > 0 ? stack[stack.length - 1] : undefined
    if (frame === undefined) break
    const item = frame.doc[frame.at]
    if (item === undefined) {
      stack.pop()
      continue
    }
    frame.at += 1
    const parent = frame.item
    const alt = frame.alt
    if (item.kind === 'State') {
      const state = item._0
      visit(builder, parent, state, alt)
      if (state.doc !== undefined) {
        stack.push({ alt: !alt, at: 0, doc: state.doc, item: state })
      }
    } else if (item.kind === 'Relation') {
      const relation = item._0
      visit(builder, parent, relation.state1, alt)
      visit(builder, parent, relation.state2, alt)
      const id = `edge${nextCounter(builder)}`
      builder.edges.push({
        classes: 'transition',
        end: relation.state2.id,
        id,
        label: relation.description ?? '',
        pattern: undefined,
        start: relation.state1.id,
      })
    }
  }

  for (let i = 0; i < builder.nodes.length && i < builder.deferred.length; i++) {
    const node = builder.nodes[i] as StateNode
    const draft = builder.deferred[i] ? builder.drafts.get(node.id) : undefined
    if (draft !== undefined) {
      if (draft.description.kind === 'Many') {
        const texts = draft.description._0
        node.label = texts[0]
        node.description = texts.slice(1)
      } else {
        node.label = draft.description._0
        node.description = []
      }
      if (node.shape === 'divider') node.label = ''
      node.cssClasses = draft.cssClasses
      node.cssStyles = draft.cssStyles.slice()
    }
    node.cssCompiledStyles = compiledStyles(db, node.cssClasses)
  }

  const node = builder.nodes.find((node) => node.isGroup && node.description.length > 0)
  if (node !== undefined) {
    const error: CompileError = errorNew(
      Code.Semantic,
      `Group nodes can only have label. Remove the additional description for node [${node.id}]`,
    )
    error.type = 'state'
    throw error
  }
  return { edges: builder.edges, nodes: builder.nodes }
}
