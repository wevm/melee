/**
 * @module The architecture model and Mermaid's checks as it is built. Port of Pele's
 * `src/diagrams/architecture/db.ts`.
 */
import { Code, type CompileError, errorNew, pushU32 } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import type { Buf } from '../../util/rust.ts'
import { type ArchitectureAst, type Direction, type Side, directionAsStr } from './parser.ts'

/** What a node is. */
export const NodeKind = {
  /** A point where edges meet. */
  Junction: 'Junction',
  /** A service with an icon and a title. */
  Service: 'Service',
} as const
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind]

/** A service or junction. */
export type ArchNode = {
  /** The icon name, for a service. */
  icon: string | undefined
  /** Text drawn in place of an icon, for a service. */
  iconText: string | undefined
  /** The id. */
  id: string
  /** The parent group's id. */
  in: string | undefined
  /** Service or junction. */
  kind: NodeKind
  /** The title, for a service. */
  title: string | undefined
}

/** A group of nodes and groups. */
export type ArchGroup = {
  /** The icon name. */
  icon: string | undefined
  /** The id. */
  id: string
  /** The parent group's id. */
  in: string | undefined
  /** The title. */
  title: string | undefined
}

/** An edge between two sides of two nodes. */
export type ArchEdge = {
  /** Side of the left-hand node. */
  lhsDir: Side
  /** Whether the left-hand end crosses its group's border. */
  lhsGroup: boolean
  /** Left-hand node id. */
  lhsId: string
  /** Whether the left-hand end has an arrowhead. */
  lhsInto: boolean
  /** Side of the right-hand node. */
  rhsDir: Side
  /** Whether the right-hand end crosses its group's border. */
  rhsGroup: boolean
  /** Right-hand node id. */
  rhsId: string
  /** Whether the right-hand end has an arrowhead. */
  rhsInto: boolean
  /** The label. */
  title: string | undefined
}

/** An `align` directive. */
export type ArchLayoutHint = {
  /** Row or column. */
  direction: Direction
  /** Ids of the aligned nodes, in order. */
  members: string[]
}

/** What an id is registered as. */
const Registered = { Group: 'Group', Node: 'Node' } as const
type Registered = (typeof Registered)[keyof typeof Registered]

function registeredAsStr(self: Registered): string {
  return self === Registered.Group ? 'group' : 'node'
}

/** The architecture model: Pele's `ArchitectureDb`. Nodes and groups keep insertion order. */
export type ArchitectureDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Edges in source order. */
  edges: ArchEdge[]
  /** Groups in insertion order. */
  groups: ArchGroup[]
  /** Alignments in source order. */
  layoutHints: ArchLayoutHint[]
  /** Index of each node by id. */
  nodeIndex: Map<string, number>
  /** Services and junctions in insertion order. */
  nodes: ArchNode[]
  /** What each id is. */
  registered: Map<string, Registered>
  /** The title. */
  title: string | undefined
}

/** `ArchitectureDb::default()`. */
export function architectureDbDefault(): ArchitectureDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    edges: [],
    groups: [],
    layoutHints: [],
    nodeIndex: new Map(),
    nodes: [],
    registered: new Map(),
    title: undefined,
  }
}

/** A semantic error whose message is `parts` joined. */
function fail(parts: string[]): CompileError {
  const error = errorNew(Code.Semantic, parts.join(''))
  error.type = 'architecture'
  return error
}

/** The node with `id`. */
export function architectureDbNode(self: ArchitectureDb, id: string): ArchNode | undefined {
  const i = architectureDbPosition(self, id)
  return i === undefined ? undefined : self.nodes[i]
}

/** The index in `nodes` of the node with `id`. */
export function architectureDbPosition(self: ArchitectureDb, id: string): number | undefined {
  return self.nodeIndex.get(id)
}

function register(self: ArchitectureDb, kind: string, id: string, parent: string | undefined): void {
  const other = self.registered.get(id)
  if (other !== undefined) {
    throw fail(['The ', kind, ' id [', id, '] is already in use by another ', registeredAsStr(other)])
  }
  if (parent !== undefined) {
    if (id === parent) throw fail(['The ', kind, ' [', id, '] cannot be placed within itself'])
    const registered = self.registered.get(parent)
    if (registered === undefined) {
      throw fail([
        'The ',
        kind,
        ' [',
        id,
        "]'s parent does not exist. Please make sure the parent is created before this ",
        kind,
      ])
    }
    if (registered === Registered.Node) throw fail(['The ', kind, ' [', id, "]'s parent is not a group"])
  }
  self.registered.set(id, kind === 'group' ? Registered.Group : Registered.Node)
}

function addNode(self: ArchitectureDb, node: ArchNode): void {
  self.nodeIndex.set(node.id, self.nodes.length)
  self.nodes.push(node)
}

/** Adds a service. */
export function architectureDbAddService(
  self: ArchitectureDb,
  id: string,
  icon: string | undefined,
  iconText: string | undefined,
  title: string | undefined,
  parent: string | undefined,
): void {
  register(self, 'service', id, parent)
  addNode(self, { icon, iconText, id, in: parent, kind: NodeKind.Service, title })
}

/** Adds a junction. */
export function architectureDbAddJunction(self: ArchitectureDb, id: string, parent: string | undefined): void {
  register(self, 'junction', id, parent)
  addNode(self, {
    icon: undefined,
    iconText: undefined,
    id,
    in: parent,
    kind: NodeKind.Junction,
    title: undefined,
  })
}

/** Adds a group. */
export function architectureDbAddGroup(self: ArchitectureDb, group: ArchGroup): void {
  register(self, 'group', group.id, group.in)
  self.groups.push(group)
}

/** Adds an edge. */
export function architectureDbAddEdge(self: ArchitectureDb, edge: ArchEdge): void {
  if (!self.registered.has(edge.lhsId)) throw missingEnd('left', edge.lhsId)
  if (!self.registered.has(edge.rhsId)) throw missingEnd('right', edge.rhsId)
  // Mermaid lets a group id through the check above and then fails with a TypeError.
  const lhs = architectureDbNode(self, edge.lhsId)
  if (lhs === undefined) throw groupEnd('left', edge.lhsId)
  const rhs = architectureDbNode(self, edge.rhsId)
  if (rhs === undefined) throw groupEnd('right', edge.rhsId)
  const parent = lhs.in
  if (parent !== undefined && parent === rhs.in) {
    if (edge.lhsGroup) throw needlessCrossing('left', edge.lhsId)
    if (edge.rhsGroup) throw needlessCrossing('right', edge.rhsId)
  }
  self.edges.push(edge)
}

function missingEnd(side: string, id: string): CompileError {
  return fail([
    'The ',
    side,
    '-hand id [',
    id,
    '] does not yet exist. Please create the service/group before declaring an edge to it.',
  ])
}

function groupEnd(side: string, id: string): CompileError {
  return fail(['The ', side, '-hand id [', id, '] is a group. Add {group} to a service inside it instead.'])
}

function needlessCrossing(side: string, id: string): CompileError {
  return fail([
    'The ',
    side,
    '-hand id [',
    id,
    '] is modified to traverse the group boundary, but the edge does not pass through two groups.',
  ])
}

/** Adds an alignment. */
export function architectureDbAddLayoutHint(self: ArchitectureDb, hint: ArchLayoutHint): void {
  if (hint.members.length < 2) {
    const message: Buf = { s: 'An align directive requires at least two members; got ' }
    pushU32(message, hint.members.length)
    throw fail([message.s])
  }
  const seen = new Set<string>()
  for (const id of hint.members) {
    if (self.registered.get(id) !== Registered.Node) {
      throw fail([
        'align ',
        directionAsStr(hint.direction),
        ' references [',
        id,
        '], which is not a service or junction',
      ])
    }
    if (seen.has(id)) {
      throw fail(['align ', directionAsStr(hint.direction), ' lists [', id, '] more than once'])
    }
    seen.add(id)
  }
  self.layoutHints.push(hint)
}

/** `text.replace(/\n\s+/g, '\n')`. */
function squeezeIndents(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text.codePointAt(i) as number
    const step = c > 0xffff ? 2 : 1
    out += text.slice(i, i + step)
    i += step
    if (c === 0x0a) {
      while (i < n) {
        const next = text.codePointAt(i) as number
        if (!isSpace(next)) break
        i += next > 0xffff ? 2 : 1
      }
    }
  }
  return out
}

/**
 * Mermaid's `populateDb`: every group, then services, junctions, edges, and alignments.
 *
 * @throws {CompileError} A semantic error for an id used twice, a missing or invalid parent, an
 * edge to an unknown id or a group, a group crossing that crosses nothing, or an invalid
 * alignment.
 */
export function populate(ast: ArchitectureAst, db: ArchitectureDb): void {
  if (ast.accDescr !== undefined && ast.accDescr !== '') db.accDescr = squeezeIndents(ast.accDescr)
  if (ast.accTitle !== undefined && ast.accTitle !== '') db.accTitle = trimStart(ast.accTitle)
  if (ast.title !== undefined && ast.title !== '') db.title = ast.title
  for (const group of ast.groups) {
    architectureDbAddGroup(db, { icon: group.icon, id: group.id, in: group.in, title: group.title })
  }
  for (const service of ast.services) {
    architectureDbAddService(db, service.id, service.icon, service.iconText, service.title, service.in)
  }
  for (const junction of ast.junctions) architectureDbAddJunction(db, junction.id, junction.in)
  for (const edge of ast.edges) {
    architectureDbAddEdge(db, {
      lhsDir: edge.lhsDir,
      lhsGroup: edge.lhsGroup,
      lhsId: edge.lhsId,
      lhsInto: edge.lhsInto,
      rhsDir: edge.rhsDir,
      rhsGroup: edge.rhsGroup,
      rhsId: edge.rhsId,
      rhsInto: edge.rhsInto,
      title: edge.title,
    })
  }
  for (const alignment of ast.alignments) {
    architectureDbAddLayoutHint(db, { direction: alignment.direction, members: alignment.members })
  }
}
