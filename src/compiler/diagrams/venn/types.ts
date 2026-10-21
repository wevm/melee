/** @module The venn diagram model. Port of Pele's `src/diagrams/venn/types.ts`. */

/** A set (one id) or an overlap of sets (two or more ids, sorted), with its relative area. */
export type VennSubset = {
  /** The label. */
  label: string | undefined
  /** The ids of the sets. */
  sets: string[]
  /** The relative area. */
  size: number
}

/** `VennSubset::default()`. */
export function vennSubsetDefault(): VennSubset {
  return { label: undefined, sets: [], size: 0 }
}

/** A line of text shown inside the region of the given sets. */
export type VennText = {
  /** The id. */
  id: string
  /** The label, shown in place of the id. */
  label: string | undefined
  /** The ids of the sets of the region. */
  sets: string[]
}

/** `VennText::default()`. */
export function vennTextDefault(): VennText {
  return { id: '', label: undefined, sets: [] }
}

/**
 * Declarations for a set, an overlap, or a text. Targets are the sorted ids of a set or overlap,
 * or the id of a text.
 */
export type VennStyle = {
  /** Property and value pairs, in insertion order. */
  styles: [string, string][]
  /** The ids the declarations apply to. */
  targets: string[]
}

/** `VennStyle::default()`. */
export function vennStyleDefault(): VennStyle {
  return { styles: [], targets: [] }
}
