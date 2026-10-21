/**
 * @module Resolves a parsed class diagram into the nodes and edges that are drawn. Port of Pele's
 * `src/diagrams/class/graph.ts`.
 */
import { type ClassDb, orderedGet } from './db.ts'
import { type ClassNode, LOLLIPOP, type RelationEnd, relationEndEq } from './types.ts'

/** What a node is drawn as. */
export const NodeShape = {
  /** A class. */
  ClassBox: 'ClassBox',
  /** A lollipop interface. */
  Interface: 'Interface',
  /** A note. */
  Note: 'Note',
  /** A namespace. */
  Rect: 'Rect',
} as const

export type NodeShape = (typeof NodeShape)[keyof typeof NodeShape]

/** A drawn node. */
export type GraphNode = {
  /** The class it draws. */
  classNode: ClassNode | undefined
  /** The id. */
  id: string
  /** Whether the node is a namespace. */
  isGroup: boolean
  /** The shown text. */
  label: string
  /** Index of the namespace node this one is drawn in, or -1. */
  parent: number
  /** The id of the namespace this one is drawn in. */
  parentId: string | undefined
  /** What it is drawn as. */
  shape: NodeShape
}

/** A drawn edge. */
export type GraphEdge = {
  /** The marker at the start. */
  arrowTypeStart: RelationEnd
  /** The marker at the end. */
  arrowTypeEnd: RelationEnd
  /** Whether the edge joins a note to its class. */
  dotted: boolean
  /** Whether the line is dashed. */
  dashed: boolean
  /** The text beside the end. */
  endLabelLeft: string
  /** The id. */
  id: string
  /** The label. */
  label: string | undefined
  /** The index of the start node, or `undefined` when it names none. */
  source: number | undefined
  /** The text beside the start. */
  startLabelRight: string
  /** The index of the end node, or `undefined` when it names none. */
  target: number | undefined
}

/** The drawn nodes and edges. */
export type ClassGraph = {
  /** Edges in drawing order. */
  edges: GraphEdge[]
  /** Namespaces, then classes, then notes, then interfaces. */
  nodes: GraphNode[]
}

/**
 * Builds the drawn graph. With `hierarchical` off, only namespaces the source declares are kept
 * and each is labeled with its full name.
 */
export function build(model: ClassDb, hierarchical: boolean): ClassGraph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const namespaceAt = new Map<string, number>()
  const classAt = new Map<string, number>()
  const interfaceAt = new Map<string, number>()

  const declared = new Map<string, string | undefined>()
  const declaredAncestor = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined
    if (hierarchical) return id
    const chain: string[] = []
    let current: string | undefined = id
    let found: string | undefined
    while (current !== undefined && current !== '') {
      const at: string = current
      current = undefined
      if (declared.has(at)) {
        found = declared.get(at)
        break
      }
      const ns = orderedGet(model.namespaces, at)
      if (ns === undefined) break
      if (ns.explicit) {
        found = at
        break
      }
      current = ns.parent
      chain.push(at)
    }
    for (const visited of chain) declared.set(visited, found)
    return found
  }

  for (const ns of model.namespaces.values) {
    if (!hierarchical && !ns.explicit) continue
    namespaceAt.set(ns.id, nodes.length)
    nodes.push({
      classNode: undefined,
      id: ns.id,
      isGroup: true,
      label: hierarchical ? ns.label : ns.id,
      parent: -1,
      parentId: hierarchical ? ns.parent : undefined,
      shape: NodeShape.Rect,
    })
  }
  const group = (id: string | undefined): number => {
    if (id === undefined) return -1
    return namespaceAt.get(id) ?? -1
  }
  for (const node of nodes) node.parent = group(node.parentId)

  for (const classNode of model.classes.values) {
    const parentId = declaredAncestor(classNode.parent)
    classAt.set(classNode.id, nodes.length)
    nodes.push({
      classNode,
      id: classNode.id,
      isGroup: false,
      label: classNode.label,
      parent: group(parentId),
      parentId,
      shape: NodeShape.ClassBox,
    })
  }

  for (const note of model.notes.values) {
    const parentId = declaredAncestor(note.parent)
    const target = note.class === undefined ? undefined : classAt.get(note.class)
    if (target !== undefined) {
      edges.push({
        arrowTypeEnd: { kind: 'None' },
        arrowTypeStart: { kind: 'None' },
        dashed: false,
        dotted: true,
        endLabelLeft: '',
        id: `edgeNote${note.index}`,
        label: undefined,
        source: nodes.length,
        startLabelRight: '',
        target,
      })
    }
    nodes.push({
      classNode: undefined,
      id: note.id,
      isGroup: false,
      label: note.text,
      parent: group(parentId),
      parentId,
      shape: NodeShape.Note,
    })
  }

  // Mermaid leaves every lollipop interface outside the namespaces. Here it stays beside its
  // class.
  for (const item of model.interfaces) {
    const owner = classAt.get(item.classId)
    const parent = owner === undefined ? -1 : (nodes[owner]?.parent ?? -1)
    interfaceAt.set(item.id, nodes.length)
    nodes.push({
      classNode: undefined,
      id: item.id,
      isGroup: false,
      label: item.label,
      parent,
      parentId: undefined,
      shape: NodeShape.Interface,
    })
  }

  model.relations.forEach((relation, count) => {
    const type1 = relation.type1
    const type2 = relation.type2
    // `addRelation` swaps in an interface for the lollipop end of a relation with no other
    // marker.
    const startInterface = relationEndEq(type1, LOLLIPOP) && type2.kind === 'None'
    const endInterface = !startInterface && relationEndEq(type2, LOLLIPOP) && type1.kind === 'None'
    const startAt = startInterface ? interfaceAt : classAt
    const endAt = endInterface ? interfaceAt : classAt
    edges.push({
      arrowTypeEnd: type2,
      arrowTypeStart: type1,
      dashed: relation.lineType === 1,
      dotted: false,
      endLabelLeft: relation.relationTitle2 === 'none' ? '' : relation.relationTitle2,
      id: `id_${relation.id1}_${relation.id2}_${count + 1}`,
      label: relation.title,
      source: startAt.get(relation.id1),
      startLabelRight: relation.relationTitle1 === 'none' ? '' : relation.relationTitle1,
      target: endAt.get(relation.id2),
    })
  })

  return { edges, nodes }
}
