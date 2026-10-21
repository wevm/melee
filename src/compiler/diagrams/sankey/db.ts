/**
 * @module The sankey model: nodes in order of first mention and the links between them. Port of
 * Pele's `src/diagrams/sankey/db.ts`.
 */

/** A node, named by the rows that mention it. */
export type SankeyNode = {
  /** The node's name. */
  id: string
  /** Its position in {@link SankeyDb.nodes}. */
  index: number
}

/** A flow from one node to another. */
export type SankeyLink = {
  /** Index of the source node. */
  source: number
  /** Index of the target node. */
  target: number
  /** The amount, as `parseFloat` read it. It may be `NaN`. */
  value: number
}

/** The parsed sankey diagram: Pele's `SankeyDb`. */
export type SankeyDb = {
  /** The accessible description. Mermaid's sankey grammar has no statement that sets it. */
  accDescr: string | undefined
  /** The accessible title. Mermaid's sankey grammar has no statement that sets it. */
  accTitle: string | undefined
  /** Links in authored order. */
  links: SankeyLink[]
  /** Node indexes by name. Only looked up, never iterated. */
  lookup: Map<string, number>
  /** Nodes in order of first mention. */
  nodes: SankeyNode[]
  /** The front matter title. */
  title: string | undefined
}

/** `SankeyDb::default()`. */
export function sankeyDbDefault(): SankeyDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    links: [],
    lookup: new Map(),
    nodes: [],
    title: undefined,
  }
}

/** The index of the node named `id`, created at the end when it is new. */
export function sankeyDbFindOrCreateNode(db: SankeyDb, id: string): number {
  const found = db.lookup.get(id)
  if (found !== undefined) return found
  const index = Math.min(db.nodes.length, 4294967295)
  db.lookup.set(id, index)
  db.nodes.push({ id, index })
  return index
}

/** Adds a link between two node indexes. */
export function sankeyDbAddLink(db: SankeyDb, source: number, target: number, value: number): void {
  db.links.push({ source, target, value })
}
