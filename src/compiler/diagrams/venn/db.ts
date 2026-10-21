/** @module The venn diagram database. Port of Pele's `src/diagrams/venn/db.ts`. */
import type { VennStyle, VennSubset, VennText } from './types.ts'
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trim } from '../../text/label.ts'

/** Mermaid takes one pair of quotes off an id, label or style value. */
export function normalizeText(text: string): string {
  const trimmed = trim(text)
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, trimmed.length - 1)
  }
  return trimmed
}

/** Compares strings as JavaScript's default sort does: by UTF-16 code units. */
export function utf16Cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function normalizeIds(ids: readonly string[]): string[] {
  const sets = ids.map((id) => normalizeText(id))
  sets.sort(utf16Cmp)
  return sets
}

/** A semantic error of a venn diagram. */
export function semantic(message: string): CompileError {
  const error = errorNew(Code.Semantic, message)
  error.type = 'venn'
  return error
}

/** The parsed venn diagram: Pele's `VennDb`. */
export type VennDb = {
  current: string[] | undefined
  /** Whether an indented `text` line belongs to the set or union before it. The lexer reads this. */
  indent: boolean
  known: Set<string>
  /** Styles, in order. */
  styles: VennStyle[]
  /** Sets and overlaps, in order. */
  subsets: VennSubset[]
  /** Texts, in order. */
  textNodes: VennText[]
  /** The title. */
  title: string | undefined
}

/** `VennDb::default()`. */
export function vennDbDefault(): VennDb {
  return {
    current: undefined,
    indent: false,
    known: new Set(),
    styles: [],
    subsets: [],
    textNodes: [],
    title: undefined,
  }
}

/** Sets the title from a `title` statement. */
export function vennDbSetDiagramTitle(db: VennDb, title: string): void {
  db.title = title
}

/** Adds a set or overlap. A set without a size gets 10, and an overlap of n sets 10 / n². */
export function vennDbAddSubsetData(
  db: VennDb,
  ids: readonly string[],
  label: string | undefined,
  size: number | undefined,
): void {
  const sets = normalizeIds(ids)
  db.current = sets.slice()
  if (sets.length === 1) db.known.add(sets[0] as string)
  const count = ids.length
  db.subsets.push({
    label: label !== undefined && label !== '' ? normalizeText(label) : undefined,
    sets,
    size: size ?? 10.0 / (count * count),
  })
}

/** Adds a text inside the region of `ids`. */
export function vennDbAddTextData(db: VennDb, ids: readonly string[], id: string, label: string | undefined): void {
  db.textNodes.push({
    id: normalizeText(id),
    label: label !== undefined && label !== '' ? normalizeText(label) : undefined,
    sets: normalizeIds(ids),
  })
}

/** Adds a style for `ids`. A later declaration of a property replaces an earlier one in place. */
export function vennDbAddStyleData(db: VennDb, ids: readonly string[], data: readonly [string, string][]): void {
  const styles: [string, string][] = []
  for (const [key, raw] of data) {
    const value = raw === '' ? '' : normalizeText(raw)
    const entry = styles.find(([own]) => own === key)
    if (entry !== undefined) entry[1] = value
    else styles.push([key, value])
  }
  db.styles.push({ styles, targets: normalizeIds(ids) })
}

/**
 * Checks that every id of a union names a set.
 *
 * Throws a semantic error naming the unknown ids.
 */
export function vennDbValidateUnionIdentifiers(db: VennDb, ids: readonly string[]): void {
  const unknown = ids.map((id) => normalizeText(id)).filter((id) => !db.known.has(id))
  if (unknown.length === 0) return
  throw semantic(`unknown set identifier: ${unknown.join(', ')}`)
}

/** The sets of the last set or union. */
export function vennDbCurrentSets(db: VennDb): string[] | undefined {
  return db.current
}

/** Whether an indented `text` line belongs to the set or union before it. */
export function vennDbIndentMode(db: VennDb): boolean {
  return db.indent
}

/** Sets whether an indented `text` line belongs to the set or union before it. */
export function vennDbSetIndentMode(db: VennDb, enabled: boolean): void {
  db.indent = enabled
}
