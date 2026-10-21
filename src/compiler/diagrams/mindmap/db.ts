/** @module The mindmap database. Port of Pele's `src/diagrams/mindmap/db.ts`. */
import type { Decoration, OutlineDb } from '../common/outline.ts'
import { Code, type CompileError, errorNew } from '../../error.ts'

/** A mindmap node. */
export type MindmapNode = {
  /** The indexes of the node's children, in source order. */
  children: number[]
  /** The class names from `:::`. */
  class: string | undefined
  /** The text. */
  descr: string
  /** The icon name from `::icon(...)`. */
  icon: string | undefined
  /** The node's index in {@link MindmapDb.nodes}. */
  id: number
  /** Whether the node is the root. */
  isRoot: boolean
  /** Mermaid's node type, which selects the shape. */
  kind: number
  /**
   * The indentation relative to the root's, in UTF-16 units. Negative when a node is indented
   * less than the root.
   */
  level: number
  /** The authored id. */
  nodeId: string
  /** Index of the first-level branch the node belongs to, wrapping after eleven as in Mermaid. */
  section: number | undefined
}

/** `MindmapNode::default()`. */
export function mindmapNodeDefault(): MindmapNode {
  return {
    children: [],
    class: undefined,
    descr: '',
    icon: undefined,
    id: 0,
    isRoot: false,
    kind: 0,
    level: 0,
    nodeId: '',
    section: undefined,
  }
}

/** The parsed mindmap: Pele's `MindmapDb`. */
export type MindmapDb = {
  baseLevel: number
  /** The first error an action raised. Pele throws it, and the parser stops there. */
  error: CompileError | undefined
  /** In source order, which is depth-first. The first node is the root. */
  nodes: MindmapNode[]
  /** The chain of nodes that can still take children, with strictly increasing levels. */
  open: number[]
  /** The front matter title. */
  title: string | undefined
}

/** `MindmapDb::default()`. */
export function mindmapDbDefault(): MindmapDb {
  return { baseLevel: 0, error: undefined, nodes: [], open: [], title: undefined }
}

const SECTIONS = 11

/** The error for a node that has no parent. */
function noParent(descr: string): CompileError {
  const error = errorNew(
    Code.Semantic,
    'There can be only one root. No parent could be found for ("' + descr + '")',
  )
  error.type = 'mindmap'
  return error
}

/** `OutlineDb::add_node` of `MindmapDb`. */
export function mindmapDbAddNode(
  db: MindmapDb,
  rawLevel: number,
  id: string,
  descr: string,
  kind: number,
  _shapeData: string | undefined,
): void {
  if (db.error !== undefined) return

  const isRoot = db.nodes.length === 0
  if (isRoot) {
    db.baseLevel = rawLevel
  }
  const level = rawLevel - db.baseLevel

  // Mermaid's parent is the last node with a smaller indentation, wherever it is in the tree.
  const open = db.open
  let depth = open.length
  while (depth > 0) {
    if (!(db.nodes[open[depth - 1]!]!.level >= level)) break
    depth -= 1
  }
  const parent = depth > 0 ? open[depth - 1] : undefined
  if (parent === undefined && !isRoot) {
    db.error = noParent(descr)
    return
  }

  const idAt = db.nodes.length
  const node: MindmapNode = {
    children: [],
    class: undefined,
    descr,
    icon: undefined,
    id: idAt,
    isRoot,
    kind,
    level,
    nodeId: id,
    section: undefined,
  }
  const parentNode = parent === undefined ? undefined : db.nodes[parent]
  if (parentNode !== undefined) {
    node.section = parentNode.isRoot ? parentNode.children.length % SECTIONS : parentNode.section
    parentNode.children.push(idAt)
  }
  if (depth === open.length) open.push(idAt)
  else {
    open[depth] = idAt
    if (depth + 1 < open.length) open.length = depth + 1
  }
  db.nodes.push(node)
}

/**
 * `OutlineDb::decorate_node` of `MindmapDb`.
 *
 * Mermaid throws a TypeError when a decoration comes before any node. Here it is ignored.
 */
export function mindmapDbDecorateNode(db: MindmapDb, decoration: Decoration): void {
  if (db.error !== undefined) return
  const node = db.nodes[db.nodes.length - 1]
  if (node === undefined) return
  const icon = decoration.icon
  if (icon !== undefined && icon !== '') node.icon = icon
  const cls = decoration.class
  if (cls !== undefined && cls !== '') node.class = cls
}

/** `MindmapDb` as the `OutlineDb` the shared outline grammar calls. */
export function mindmapDbOutline(db: MindmapDb): OutlineDb {
  return {
    addNode: (level, id, descr, kind, shapeData) => mindmapDbAddNode(db, level, id, descr, kind, shapeData),
    decorateNode: (decoration) => mindmapDbDecorateNode(db, decoration),
  }
}
