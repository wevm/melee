/**
 * @module Resolves a parsed agentflow into the nodes and edges that are drawn: flow membership, collapsed
 * flows, shapes reduced to the ones agentflow has, class styles, and palette slots. Shape and
 * containment problems are recorded on the model as diagnostics. Port of Pele's
 * `src/diagrams/agentflow/graph.ts`.
 */
import { assignColorSlots } from './color_slots.ts'
import {
  type AgentflowDb,
  agentflowDbClass,
  agentflowDbEmit,
  agentflowDbIsConnector,
  agentflowDbNode,
  agentflowDbSubgraph,
  agentflowDbTooltip,
  agentflowDbVertexKind,
  jsTrim,
} from './db.ts'
import { normaliseNodeShapes, resolveShapeAlias } from './shapes.ts'
import type { AgentEdge, LabelType, Metadata } from './types.ts'
import * as yaml from '../../yaml.ts'
import { type Value, valueClone, valueTruthy } from '../../yaml.ts'

/** A node or flow to draw. */
export type GraphNode = {
  /** The palette slot of a flow. */
  colorIndex: number | undefined
  /** Space-separated class names. */
  cssClasses: string
  /** Declarations from the node's classes. */
  cssCompiledStyles: string[]
  /** Declarations written on the node itself. */
  cssStyles: string[]
  /** The direction inside a flow. */
  dir: string | undefined
  /** Node id. */
  id: string
  /** Whether the node is drawn as a flow around others. */
  isGroup: boolean
  /** What the node is, which picks its palette slot. */
  kind: string | undefined
  /** Label text. */
  label: string | undefined
  /** How the label is written. */
  labelType: LabelType
  /** Link address. */
  link: string | undefined
  /** Link target. */
  linkTarget: string | undefined
  /** The node's metadata. */
  metadata: Metadata | undefined
  /** The enclosing flow's id. */
  parentId: string | undefined
  /** Shape name. */
  shape: string
  /** Tooltip text. */
  tooltip: string | undefined
}

/** An edge to draw. */
export type GraphEdge = {
  /** `animate` from metadata. */
  animate: Value | undefined
  /** `animation` from metadata. */
  animation: Value | undefined
  /** Marker at the head. */
  arrowTypeEnd: string
  /** Declarations from the edge's classes. */
  cssCompiledStyles: string[]
  /** The curve: the edge's own, the default, or the configured one. */
  curve: Value | undefined
  /** Target node id. */
  end: string
  /** Edge id. */
  id: string
  /** Whether the id was written in the source. */
  isUserDefinedId: boolean
  /** Label text. */
  label: string
  /** How the label is written. */
  labelType: LabelType
  /** The edge's metadata. */
  metadata: Metadata | undefined
  /** The extra rank span. */
  minlen: number | undefined
  /** Source node id. */
  start: string
  /** Declarations from `linkStyle default` and the edge's own `linkStyle`. */
  style: string[]
  /** The stroke, which Pele also stores as the edge's pattern. */
  thickness: string
  /** The arrowhead kind. */
  type: string
}

/** Marker at the tail, which agentflow never draws. */
export const GRAPH_EDGE_ARROW_TYPE_START = 'none'

/** The class names Mermaid gives every agentflow edge. */
export const GRAPH_EDGE_CLASSES = 'edge-thickness-normal edge-pattern-solid flowchart-link'

/** The drawn graph. */
export type AgentGraph = {
  /** Edges in declaration order. */
  edges: GraphEdge[]
  /** Flows (last closed first), then nodes in declaration order. */
  nodes: GraphNode[]
}

/** `AgentGraph::default()`. */
export function agentGraphDefault(): AgentGraph {
  return { edges: [], nodes: [] }
}

function isCollapsed(metadata: Metadata | undefined): boolean {
  if (metadata === undefined) return false
  return metadata.some(([key, value]) => key === 'view' && value.kind === 'String' && value._0 === 'collapsed')
}

function cloneMetadata(metadata: Metadata | undefined): Metadata | undefined {
  return metadata === undefined ? undefined : metadata.map(([key, value]): [string, Value] => [key, valueClone(value)])
}

/** The declarations of the classes `names`, trimmed. */
function compiled(db: AgentflowDb, names: readonly string[]): string[] {
  const out: string[] = []
  if (db.classes.length === 0) return out
  for (const name of names) {
    const def = agentflowDbClass(db, name)
    if (def === undefined) continue
    for (const s of def.styles) out.push(jsTrim(s))
    for (const s of def.textStyles) out.push(jsTrim(s))
  }
  return out
}

/** No class names, for a diagram without classes, where every list of them compiles to none. */
const NO_NAMES: readonly string[] = []

/**
 * Builds the drawn graph with a palette of `paletteLength` colors. `defaultCurve` comes from
 * the `flowchart.curve` config.
 */
export function buildAgentGraph(
  db: AgentflowDb,
  paletteLength: number,
  defaultCurve: string | undefined,
): AgentGraph {
  // Everything inside a collapsed flow is hidden, and stands for its outermost collapsed flow.
  // Mermaid walks the whole inside of each collapsed flow, in the order the flows closed, and
  // the last walk to reach a thing wins. A thing has one container, so a later walk can only
  // enter an earlier one through its root: it stops there, and the root's owner is followed
  // afterwards.
  const hidden: string[] = []
  const hiddenSet = new Set<string>()
  const owner = new Map<string, string>()
  const walked = new Set<string>()
  for (const sg of db.subgraphs) {
    if (!isCollapsed(sg.metadata) || hiddenSet.has(sg.id)) continue
    const pending = [sg.id]
    for (;;) {
      const id = pending.pop()
      if (id === undefined) break
      const member = agentflowDbSubgraph(db, id)
      if (member === undefined) continue
      for (const child of member.nodes) {
        if (child === sg.id || hiddenSet.has(child)) continue
        hiddenSet.add(child)
        hidden.push(child)
        owner.set(child, sg.id)
        if (!walked.has(child)) pending.push(child)
      }
    }
    walked.add(sg.id)
  }

  // Owners are always shown when they take a member, so each chain ends; the hop count only
  // guards that invariant.
  const collapsedInto = new Map<string, string>()
  for (const id of hidden) {
    const path = [id]
    const root = owner.get(id)
    if (root === undefined) continue
    let top: string = root
    for (let hop = 0; hop <= hidden.length; hop++) {
      const known: string | undefined = collapsedInto.get(top)
      const up: string | undefined = known ?? owner.get(top)
      if (up === undefined) break
      if (known === undefined) path.push(top)
      top = up
      if (known !== undefined) break
    }
    for (const p of path) collapsedInto.set(p, top)
  }

  const count = db.subgraphs.length
  const position = new Map<string, number>()
  db.subgraphs.forEach((sg, i) => position.set(sg.id, i))

  // Two flows can each name the other. The nesting that would close the loop is dropped.
  const parentOf = new Map<string, string>()
  const loops: [string, string][] = []
  for (let i = count - 1; i >= 0; i--) {
    const sg = db.subgraphs[i]
    if (sg === undefined) continue
    if (hiddenSet.has(sg.id)) continue
    for (const id of sg.nodes) {
      // Only a flow handled earlier in this pass can already be above the parent.
      const at = position.get(id)
      let closes = false
      if (at !== undefined && at >= i) {
        let current: string | undefined = sg.id
        for (let hop = 0; hop <= count; hop++) {
          if (current === undefined) break
          if (current === id) {
            closes = true
            break
          }
          current = parentOf.get(current)
        }
      }
      if (closes) {
        loops.push([sg.id, id])
        continue
      }
      parentOf.set(id, sg.id)
    }
  }
  for (const [container, id] of loops) {
    const message = `Container "${container}" cannot contain "${id}" because "${id}" already contains it. The nesting that would close the loop is dropped.`
    agentflowDbEmit(db, 'CONTAINMENT_VIOLATION', 'warning', message, id)
  }

  const nodes: GraphNode[] = []
  const byId = new Map<string, number>()
  for (let s = db.subgraphs.length - 1; s >= 0; s--) {
    const sg = db.subgraphs[s]
    if (sg === undefined) continue
    if (hiddenSet.has(sg.id)) continue
    const collapsed = isCollapsed(sg.metadata)
    let metadata: Metadata | undefined
    if (collapsed) {
      metadata = cloneMetadata(sg.metadata) ?? []
      yaml.set(metadata, 'containerType', { kind: 'String', _0: 'flow' })
    } else {
      metadata = cloneMetadata(sg.metadata)
    }
    byId.set(sg.id, nodes.length)
    nodes.push({
      colorIndex: undefined,
      cssClasses: sg.classes.join(' '),
      cssCompiledStyles: compiled(db, sg.classes),
      cssStyles: [],
      dir: sg.dir,
      id: sg.id,
      isGroup: !collapsed,
      kind: undefined,
      label: sg.title,
      labelType: sg.labelType,
      link: undefined,
      linkTarget: undefined,
      metadata,
      parentId: parentOf.get(sg.id),
      shape: collapsed ? 'collapsedGroup' : 'flowGroup',
      tooltip: undefined,
    })
  }

  for (const vertex of db.nodes) {
    if (hiddenSet.has(vertex.id)) continue
    const at = byId.get(vertex.id)
    const existing = at === undefined ? undefined : nodes[at]
    if (existing !== undefined) {
      existing.cssStyles = vertex.styles.slice()
      existing.cssCompiledStyles = compiled(db, vertex.classes)
      existing.cssClasses = vertex.classes.join(' ')
      continue
    }

    const cssClasses = 'default ' + vertex.classes.join(' ')
    const names = db.classes.length === 0 ? NO_NAMES : ['default', 'node', ...vertex.classes]
    const resolved = vertex.type === undefined ? undefined : resolveShapeAlias(vertex.type)
    const shape = resolved === undefined || resolved === 'square' ? 'squareRect' : resolved
    byId.set(vertex.id, nodes.length)
    nodes.push({
      colorIndex: undefined,
      cssClasses,
      cssCompiledStyles: compiled(db, names),
      cssStyles: vertex.styles.slice(),
      dir: vertex.dir,
      id: vertex.id,
      isGroup: false,
      kind: undefined,
      label: vertex.text,
      labelType: vertex.labelType,
      link: vertex.link,
      linkTarget: vertex.linkTarget,
      metadata: cloneMetadata(vertex.metadata),
      parentId: parentOf.get(vertex.id),
      shape,
      tooltip: agentflowDbTooltip(db, vertex.id),
    })
  }

  const edges: GraphEdge[] = []
  const collapsing = collapsedInto.size > 0
  for (let index = 0; index < db.edges.length; index++) {
    const raw = db.edges[index] as AgentEdge
    const start = collapsing ? (collapsedInto.get(raw.start) ?? raw.start) : raw.start
    const end = collapsing ? (collapsedInto.get(raw.end) ?? raw.end) : raw.end
    // An edge between two things inside one collapsed flow has nothing left to connect.
    if (start === end && raw.start !== raw.end) continue

    const style = db.defaultEdgeStyle === undefined ? [] : db.defaultEdgeStyle.slice()
    if (raw.style !== undefined) style.push(...raw.style)
    const arrow = raw.type === 'arrow_open' ? 'none' : raw.type === 'arrow_cross' ? 'arrow_cross' : 'arrow_point'
    const id = raw.id === '' ? `L_${start}_${end}_${index}` : raw.id
    // `raw.interpolate || db.defaultInterpolate || defaultCurve`, as JavaScript reads it.
    let curve: Value | undefined
    if (raw.interpolate !== undefined && valueTruthy(raw.interpolate)) {
      curve = valueClone(raw.interpolate)
    } else {
      const text =
        db.defaultInterpolate !== undefined && db.defaultInterpolate !== '' ? db.defaultInterpolate : defaultCurve
      curve = text === undefined ? undefined : { kind: 'String', _0: text }
    }

    edges.push({
      animate: raw.animate === undefined ? undefined : valueClone(raw.animate),
      animation: raw.animation === undefined ? undefined : valueClone(raw.animation),
      arrowTypeEnd: arrow,
      cssCompiledStyles: compiled(db, raw.classes),
      curve,
      end,
      id,
      isUserDefinedId: raw.isUserDefinedId,
      label: raw.text,
      labelType: raw.labelType,
      metadata: cloneMetadata(raw.metadata),
      minlen: raw.length,
      start,
      style,
      thickness: raw.stroke,
      type: raw.type,
    })
  }

  normaliseNodeShapes(nodes, db)

  // Containers are numbered in the order they were written: a walk of the nesting, parents
  // first. `subgraphs` itself is in the order the blocks closed, with a nested flow before its
  // parent.
  const children = new Map<string, string[]>()
  for (const sg of db.subgraphs) {
    const parent = parentOf.get(sg.id)
    if (parent === undefined) continue
    let kids = children.get(parent)
    if (kids === undefined) {
      kids = []
      children.set(parent, kids)
    }
    kids.push(sg.id)
  }
  const order = new Map<string, number>()
  for (const sg of db.subgraphs) {
    if (parentOf.has(sg.id)) continue
    const pending = [sg.id]
    for (;;) {
      const id = pending.pop()
      if (id === undefined) break
      if (order.has(id)) continue
      order.set(id, order.size)
      const kids = children.get(id)
      if (kids !== undefined) for (let k = kids.length - 1; k >= 0; k--) pending.push(kids[k] as string)
    }
  }

  assignColorSlots(
    nodes,
    (id) => {
      if (agentflowDbIsConnector(db, id)) return 'connector'
      const node = agentflowDbNode(db, id)
      return node === undefined ? undefined : agentflowDbVertexKind(node)
    },
    order,
    paletteLength,
  )

  return { edges, nodes }
}
