/**
 * @module The treemap model: rows nested into sections by indentation, with class styles. Port of
 * Pele's `src/diagrams/treemap/model.ts`.
 */
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import type { RowAst, TreemapAst } from './parser.ts'

/** A section or a leaf: Pele's `TreemapNode`. */
export type TreemapNode = {
  /** Sections have a list, which may be empty. Leaves have none. */
  children: TreemapNode[] | undefined
  /** The class after `:::`. */
  classSelector: string | undefined
  /** The declarations of that class, when it has any. */
  cssCompiledStyles: string[] | undefined
  /** The name. */
  name: string
  /** A leaf's value. */
  value: number | undefined
}

/** A row ready to nest: Pele's `TreemapItem`. */
type TreemapItem = {
  classSelector: string | undefined
  cssCompiledStyles: string[] | undefined
  leaf: boolean
  level: number
  name: string
  value: number | undefined
}

/** A treemap ready to draw: Pele's `TreemapModel`. */
export type TreemapModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Declarations by class name, in first-seen order. */
  classes: [string, string[]][]
  /** The top-level nodes. */
  roots: TreemapNode[]
  /** The title. */
  title: string | undefined
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

/** `text` with each `from` replaced by `to`. */
function replaceAll(text: string, from: string, to: string): string {
  let out = ''
  let rest = text
  for (;;) {
    const at = rest.indexOf(from)
    if (at < 0) break
    out += rest.slice(0, at)
    out += to
    rest = rest.slice(at + from.length)
  }
  out += rest
  return out
}

/** Nests `items`: a row belongs to the nearest section above it that is indented less. */
function buildHierarchy(items: TreemapItem[]): TreemapNode[] {
  // Open sections, innermost last, each with its level. A section moves into its parent once
  // a row at its level or above closes it.
  const roots: TreemapNode[] = []
  const stack: [TreemapNode, number][] = []
  const close = (): void => {
    const popped = stack.pop()
    if (popped === undefined) return
    const node = popped[0]
    const last = stack[stack.length - 1]
    if (last !== undefined) {
      const parent = last[0]
      if (parent.children === undefined) parent.children = []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  for (const item of items) {
    const node: TreemapNode = {
      children: !item.leaf ? [] : undefined,
      classSelector: item.classSelector,
      cssCompiledStyles: item.cssCompiledStyles,
      name: item.name,
      value: item.leaf ? item.value : undefined,
    }
    for (;;) {
      const last = stack[stack.length - 1]
      if (!(last !== undefined && last[1] >= item.level)) break
      close()
    }
    if (item.leaf) {
      const last = stack[stack.length - 1]
      if (last !== undefined) {
        const parent = last[0]
        if (parent.children === undefined) parent.children = []
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    } else {
      stack.push([node, item.level])
    }
  }
  while (stack.length > 0) close()
  return roots
}

/** Builds the model from `ast`, as Pele's `buildTreemap` does. `title` comes from front matter. */
export function buildTreemap(ast: TreemapAst, title: string | undefined): TreemapModel {
  const classes: [string, string[]][] = []
  for (const row of ast.rows) {
    if (row.kind !== 'ClassDef') continue
    const className = row.className
    let at = classes.findIndex(([name]) => name === className)
    if (at < 0) {
      classes.push([className, []])
      at = classes.length - 1
    }
    // An escaped comma stays in the value; the others separate declarations.
    let text = replaceAll(row.styleText ?? '', '\\,', '§§§')
    text = replaceAll(text, ',', ';')
    text = replaceAll(text, '§§§', ',')
    const entry = classes[at]
    if (entry !== undefined) entry[1].push(...text.split(';'))
  }

  const items: TreemapItem[] = []
  for (const row of ast.rows as RowAst[]) {
    if (row.kind !== 'Item') continue
    const item = row.item
    const selector = item.classSelector
    const styles = selector === undefined ? undefined : classes.find(([name]) => name === selector)?.[1]
    items.push({
      classSelector: item.classSelector,
      cssCompiledStyles: styles !== undefined && styles.length > 0 ? styles.slice() : undefined,
      leaf: item.value !== undefined,
      level: row.indent ?? 0,
      name: item.name,
      value: item.value,
    })
  }

  return {
    accDescr: ast.accDescr !== undefined && ast.accDescr !== '' ? dedentLines(ast.accDescr) : undefined,
    accTitle: ast.accTitle !== undefined && ast.accTitle !== '' ? trimStart(ast.accTitle) : undefined,
    classes,
    roots: buildHierarchy(items),
    title: ast.title !== undefined && ast.title !== '' ? ast.title : title,
  }
}
