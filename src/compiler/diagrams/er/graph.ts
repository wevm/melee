/**
 * @module Resolves a parsed ER diagram into what is drawn: subgraphs as groups, entities as nodes
 * with their class styles, and relationships as edges with a marker type at each end. Port of
 * Pele's `src/diagrams/er/graph.ts`.
 */
import { trim } from '../../text/label.ts'
import { type ErDb, orderedGet } from './db.ts'
import { type ErAttribute, cardinalityMarker } from './types.ts'

/** A drawn node. */
export type ErGraphNode = {
  /** The shown name in brackets, or empty. */
  alias: string
  /** Attributes in authored order. */
  attributes: readonly ErAttribute[]
  /** Class names, separated by spaces. */
  cssClasses: string
  /** The declarations of its classes. */
  cssCompiledStyles: string[]
  /** Its own style declarations. */
  cssStyles: readonly string[]
  /** The direction inside a subgraph, when set. */
  dir: string | undefined
  /** The id. */
  id: string
  /** Whether the node is a subgraph. */
  isGroup: boolean
  /** The name or title. */
  label: string
  /** The subgraph it is drawn in. */
  parentId: string | undefined
}

/** A drawn edge. */
export type ErGraphEdge = {
  /** The marker at the end. */
  arrowTypeEnd: string
  /** The marker at the start. */
  arrowTypeStart: string
  /** Whether the line is dashed: the relationship is not identifying. */
  dashed: boolean
  /** The end node's id. */
  end: string
  /** The id. */
  id: string
  /** The label. */
  label: string
  /** The start node's id. */
  start: string
}

/** The drawn nodes and edges. */
export type ErGraph = {
  /** Edges in authored order. */
  edges: ErGraphEdge[]
  /** Subgraphs, last first, then entities. */
  nodes: ErGraphNode[]
}

/** The declarations of the classes `classNames` names, in order. */
function compiled(model: ErDb, classNames: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < classNames.length; i++) {
    const def = orderedGet(model.classes, classNames[i] as string)
    if (def === undefined) continue
    for (const style of def.styles) out.push(trim(style))
    for (const style of def.textStyles) out.push(trim(style))
  }
  return out
}

/** Builds the drawn graph. */
export function build(model: ErDb): ErGraph {
  const nodes: ErGraphNode[] = []
  const edges: ErGraphEdge[] = []
  const subgraphs = model.subgraphs


  const parentOf = new Map<string, string>()
  const subgraphIds = new Set<string>()
  for (let i = subgraphs.length - 1; i >= 0; i--) {
    const subgraph = subgraphs[i] as (typeof subgraphs)[number]
    subgraphIds.add(subgraph.id)
    for (const id of subgraph.nodes) parentOf.set(id, subgraph.id)
  }

  for (let i = subgraphs.length - 1; i >= 0; i--) {
    const subgraph = subgraphs[i] as (typeof subgraphs)[number]
    nodes.push({
      alias: '',
      attributes: [],
      cssClasses: subgraph.classes.join(' '),
      cssCompiledStyles: compiled(model, subgraph.classes),
      cssStyles: subgraph.cssStyles,
      dir: subgraph.dir,
      id: subgraph.id,
      isGroup: true,
      label: subgraph.title,
      parentId: parentOf.get(subgraph.id),
    })
  }

  // A name that is also a subgraph id stands for the subgraph. Mermaid drops such an entity and
  // leaves relationships written before the subgraph pointing at nothing. Here they follow it.
  const moved = new Map<string, string>()
  for (const entity of model.entities.values) {
    const name = entity.label
    if (subgraphIds.has(name)) {
      moved.set(entity.id, name)
      continue
    }
    nodes.push({
      alias: entity.alias,
      attributes: entity.attributes,
      cssClasses: entity.cssClasses,
      cssCompiledStyles:
        model.classes.values.length === 0 ? [] : compiled(model, entity.cssClasses.split(' ')),
      cssStyles: entity.cssStyles,
      dir: undefined,
      id: entity.id,
      isGroup: false,
      label: name,
      parentId: parentOf.get(name),
    })
  }

  for (let index = 0; index < model.relationships.length; index++) {
    const relationship = model.relationships[index] as (typeof model.relationships)[number]
    const id = `id_${relationship.entityA}_${relationship.entityB}_${index}`
    const a = relationship.entityA
    const b = relationship.entityB
    edges.push({
      arrowTypeEnd: cardinalityMarker(relationship.relSpec.cardA),
      arrowTypeStart: cardinalityMarker(relationship.relSpec.cardB),
      dashed: !relationship.relSpec.identifying,
      end: moved.get(b) ?? b,
      id,
      label: relationship.roleA,
      start: moved.get(a) ?? a,
    })
  }

  return { edges, nodes }
}
