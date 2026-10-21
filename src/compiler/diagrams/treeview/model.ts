/**
 * @module The tree view model: entries nested by indentation under a root folder. Port of Pele's
 * `src/diagrams/treeview/model.ts`.
 */
import { CompileError } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { preprocessBoxDrawing, preprocessedOriginal, remapErrorLines } from './box_drawing.ts'
import { type TreeViewAst, parseTreeView } from './parser.ts'

/** Whether an entry is a file or a folder. */
export const NodeType = {
  /** A folder: a name written with a trailing `/`. */
  Directory: 'Directory',
  /** A file. */
  File: 'File',
} as const
export type NodeType = (typeof NodeType)[keyof typeof NodeType]

/** The type as Pele names it. */
export function nodeTypeAsStr(value: NodeType): string {
  return value === NodeType.Directory ? 'directory' : 'file'
}

/** An entry: Pele's `TreeNode`, with its children as indices into {@link TreeViewModel.nodes}. */
export type TreeNode = {
  /** Child entries, in authored order. */
  children: number[]
  /** The `:::` classes. */
  cssClass: string | undefined
  /** The `##` description. */
  description: string | undefined
  /** An icon name as written (`pack:name`, `file`, `folder`), or `none` to hide the icon. */
  icon: string | undefined
  /** The order in which the entry was added, the root being 0. */
  id: number
  /** The indentation the entry was written at, or -1 for the root. */
  level: number
  /** The name, without a folder's trailing `/`. */
  name: string
  /** Whether the entry is a file or a folder. */
  nodeType: NodeType
}

/** The parsed tree view: Pele's `TreeViewModel`. */
export type TreeViewModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** The number of entries, the root included. */
  count: number
  /** Every entry. The first is a folder named `/` at level -1 that holds the top-level entries. */
  nodes: TreeNode[]
  /** The title. */
  title: string | undefined
}

/** The entry at `index`, when there is one. */
export function treeViewModelNode(model: TreeViewModel, index: number): TreeNode | undefined {
  return model.nodes[index]
}

/** The top-level entries. */
export function treeViewModelRoots(model: TreeViewModel): number[] {
  return model.nodes[0]?.children ?? []
}

/** Mermaid's tree view database, filled from nodes in source order with their indentation. */
type TreeViewDb = {
  /** Every entry, the root first. */
  nodes: TreeNode[]
  /** The open folders, from the root down. */
  stack: number[]
}

/** A database holding only the root. */
function treeViewDbNew(): TreeViewDb {
  return {
    nodes: [
      {
        children: [],
        cssClass: undefined,
        description: undefined,
        icon: undefined,
        id: 0,
        level: -1,
        name: '/',
        nodeType: NodeType.Directory,
      },
    ],
    stack: [0],
  }
}

/** Adds `node` under the nearest open entry indented less than it. */
function treeViewDbAddNode(db: TreeViewDb, node: TreeNode): void {
  for (;;) {
    const top = db.stack[db.stack.length - 1]
    if (top === undefined) break
    const open = db.nodes[top]
    if (!(open !== undefined && node.level <= open.level)) break
    db.stack.pop()
  }
  const index = db.nodes.length
  node.id = Math.min(index, 4294967295)
  const top = db.stack[db.stack.length - 1]
  const parent = top === undefined ? undefined : db.nodes[top]
  if (parent !== undefined) parent.children.push(index)
  db.nodes.push(node)
  db.stack.push(index)
}

/**
 * Reads the source to a syntax tree, accepting box-drawing input, as Pele's `readTreeView`
 * does. Errors name lines of the original text.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function readTreeView(source: string): TreeViewAst {
  const pre = preprocessBoxDrawing(source)
  try {
    return parseTreeView(pre.text)
  } catch (error) {
    if (!(error instanceof CompileError) || pre.lineMap.length === 0) throw error
    const head = error.message.indexOf('\n')
    error.message =
      head < 0
        ? remapErrorLines(error.message, pre)
        : remapErrorLines(error.message.slice(0, head), pre) + error.message.slice(head)
    error.line = preprocessedOriginal(pre, error.line) ?? error.line
    throw error
  }
}

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  const chars = Array.from(text)
  let i = 0
  while (i < chars.length) {
    const c = chars[i] as string
    i += 1
    out += c
    if (c === '\n') {
      while (i < chars.length && isSpace((chars[i] as string).codePointAt(0) as number)) i += 1
    }
  }
  return out
}

/** Builds the model from `ast`, as Pele's `buildTreeView` does. `title` comes from front matter. */
export function buildTreeView(ast: TreeViewAst, title: string | undefined): TreeViewModel {
  const db = treeViewDbNew()
  for (const node of ast.nodes) {
    let name = node.name
    const directory = name.endsWith('/')
    if (directory) name = name.slice(0, -1)
    const icon = node.iconAnnotation
    treeViewDbAddNode(db, {
      children: [],
      cssClass: node.classAnnotation !== undefined && node.classAnnotation !== '' ? node.classAnnotation : undefined,
      description: node.descAnnotation !== undefined && node.descAnnotation !== '' ? node.descAnnotation : undefined,
      icon: icon === undefined ? undefined : icon === '' ? 'none' : icon,
      id: 0,
      level: node.indent ?? 0,
      name,
      nodeType: directory ? NodeType.Directory : NodeType.File,
    })
  }

  const count = Math.min(db.nodes.length, 4294967295)
  return {
    accDescr: ast.accDescr !== undefined && ast.accDescr !== '' ? dedentLines(ast.accDescr) : undefined,
    accTitle: ast.accTitle !== undefined && ast.accTitle !== '' ? trimStart(ast.accTitle) : undefined,
    count,
    nodes: db.nodes,
    title: ast.title !== undefined && ast.title !== '' ? ast.title : title,
  }
}
