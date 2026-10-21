/** @module The Ishikawa diagram database. Port of Pele's `src/diagrams/ishikawa/db.ts`. */
import type { IshikawaNode } from './types.ts'

/**
 * The parsed Ishikawa diagram: Pele's `IshikawaDb`. The root is the effect, its children are the
 * categories of causes, theirs the causes, and so on.
 */
export type IshikawaDb = {
  baseLevel: number | undefined
  /** Every node. The first one, when there is one, is the root. */
  nodes: IshikawaNode[]
  /** The line of ancestors of the last node, each with its level. */
  stack: [number, number][]
  /** The title from front matter. */
  title: string | undefined
}

/** `IshikawaDb::default()`. */
export function ishikawaDbDefault(): IshikawaDb {
  return { baseLevel: undefined, nodes: [], stack: [], title: undefined }
}

/** The root, the effect, when there is one. */
export function ishikawaDbRoot(db: IshikawaDb): IshikawaNode | undefined {
  return db.nodes[0]
}

/**
 * Adds a line. The first line is the effect. Every later line is a cause, nested by its
 * indentation relative to the first cause, so the effect itself may be indented more than
 * the causes.
 */
export function ishikawaDbAddNode(db: IshikawaDb, rawLevel: number, text: string): void {
  const index = db.nodes.length
  db.nodes.push({ children: [], text })
  if (index === 0) {
    db.stack = [[0, 0]]
    return
  }

  if (db.baseLevel === undefined) db.baseLevel = rawLevel
  const base = db.baseLevel
  // Pele's `Math.max(rawLevel - baseLevel + 1, 1)`, in unsigned arithmetic.
  const level = Math.max(Math.max(rawLevel + 1 - base, 0), 1)
  while (db.stack.length > 1 && (db.stack[db.stack.length - 1] as [number, number])[0] >= level) {
    db.stack.pop()
  }
  const last = db.stack[db.stack.length - 1]
  if (last !== undefined) {
    const parent = db.nodes[last[1]]
    if (parent !== undefined) parent.children.push(index)
  }
  db.stack.push([level, index])
}
