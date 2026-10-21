/**
 * @module The Ishikawa diagram model. Port of Pele's `src/diagrams/ishikawa/types.ts`.
 *
 * Pele nests nodes as objects. This port keeps them in one arena addressed by index, so a
 * deeply indented outline needs no recursion to build, walk, or drop.
 */

/** A line of the outline: the effect, a category, or a cause. */
export type IshikawaNode = {
  /** The indexes of the nodes under it, in authored order. */
  children: number[]
  /** The text, trimmed. */
  text: string
}

/** `IshikawaNode::default()`. */
export function ishikawaNodeDefault(): IshikawaNode {
  return { children: [], text: '' }
}
