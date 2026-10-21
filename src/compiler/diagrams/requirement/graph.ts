/**
 * @module The nodes and edges of a requirement diagram to lay out. Port of Pele's
 * `src/diagrams/requirement/graph.ts`.
 */
import { CONTAINS, type RequirementDb, orderedHas } from './db.ts'
import type { Requirement, RequirementElement } from './types.ts'

/** A node: a requirement or an element. */
export type GraphNode = {
  /** Class names joined by spaces. */
  cssClasses: string
  /** Style declarations. */
  cssStyles: string[]
  /** The element, when the node is one. */
  element: RequirementElement | undefined
  /** The node's name. */
  id: string
  /** The requirement, when the node is one. */
  requirement: Requirement | undefined
}

/** An edge: a relationship whose ends may name no node. */
export type GraphEdge = {
  /** Whether the relationship is `contains`. */
  contains: boolean
  /** The destination name, when a node has it. */
  end: string | undefined
  /** `src-dst-index`. */
  id: string
  /** The source name, when a node has it. */
  start: string | undefined
  /** The relationship. */
  type: string
}

/** The graph to lay out. */
export type RequirementGraph = {
  /** The flow direction. */
  direction: string
  /** Edges in authored order. */
  edges: GraphEdge[]
  /** Requirements first, then elements, as Mermaid orders them. */
  nodes: GraphNode[]
}

/** Builds the nodes and edges to lay out: requirements first, then elements. */
export function buildRequirementGraph(model: RequirementDb): RequirementGraph {
  const nodes: GraphNode[] = []
  for (const requirement of model.requirements.values) {
    nodes.push({
      cssClasses: requirement.classes.join(' '),
      cssStyles: requirement.cssStyles,
      element: undefined,
      id: requirement.name,
      requirement,
    })
  }
  for (const element of model.elements.values) {
    nodes.push({
      cssClasses: element.classes.join(' '),
      cssStyles: element.cssStyles,
      element,
      id: element.name,
      requirement: undefined,
    })
  }

  const has = (id: string): boolean => orderedHas(model.requirements, id) || orderedHas(model.elements, id)
  const edges = model.relations.map(
    (relation, index): GraphEdge => ({
      contains: relation.type === CONTAINS,
      end: has(relation.dst) ? relation.dst : undefined,
      id: `${relation.src}-${relation.dst}-${index}`,
      start: has(relation.src) ? relation.src : undefined,
      type: relation.type,
    }),
  )

  return { direction: model.direction, edges, nodes }
}
