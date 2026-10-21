/**
 * @module The railroad model: rules whose definitions are trees of terminals, names, and the ways
 * to combine them. Port of Pele's `src/diagrams/railroad/types.ts`.
 */

/**
 * A node of a rule's definition: Pele's `RailroadNode`. Parts are indices into
 * {@link RailroadModel.nodes}, so deep definitions need no recursion to build or drop.
 */
export type RailroadNode =
  /** One of several alternatives. */
  | { kind: 'Choice'; _0: number[] }
  /** A reference to another rule. */
  | { kind: 'NonTerminal'; _0: string }
  /** An element that may be skipped. */
  | { kind: 'Optional'; _0: number }
  /**
   * An element repeated from `min` to `max` times. `max` is infinite when the count has no upper
   * bound.
   */
  | {
      kind: 'Repetition'
      /** The repeated element. */
      element: number
      /** The most repetitions. */
      max: number
      /** The fewest repetitions. */
      min: number
    }
  /** Elements one after another. */
  | { kind: 'Sequence'; _0: number[] }
  /** Text that stands for something the grammar does not spell out. */
  | { kind: 'Special'; _0: string }
  /** Literal text. */
  | { kind: 'Terminal'; _0: string }

/** The node's parts, in order: Pele's `parts`. */
export function railroadNodeParts(node: RailroadNode): number[] {
  switch (node.kind) {
    case 'Choice':
    case 'Sequence':
      return node._0
    case 'Optional':
      return [node._0]
    case 'Repetition':
      return [node.element]
    case 'NonTerminal':
    case 'Special':
    case 'Terminal':
      return []
  }
}

/** A rule: Pele's `RailroadRule`. */
export type RailroadRule = {
  /** The definition, as an index into {@link RailroadModel.nodes}. */
  definition: number
  /** The rule's name. */
  name: string
}

/** Which of Mermaid's four grammars the text was written in. */
export const Notation = {
  /** `railroad-abnf-beta`. */
  Abnf: 'Abnf',
  /** `railroad-ebnf-beta`. */
  Ebnf: 'Ebnf',
  /** `railroad-peg-beta`. */
  Peg: 'Peg',
  /** `railroad-beta`. */
  Railroad: 'Railroad',
} as const
export type Notation = (typeof Notation)[keyof typeof Notation]

/** The notation as Pele names it. */
export function notationAsStr(notation: Notation): string {
  switch (notation) {
    case Notation.Abnf:
      return 'abnf'
    case Notation.Ebnf:
      return 'ebnf'
    case Notation.Peg:
      return 'peg'
    case Notation.Railroad:
      return 'railroad'
  }
}

/** The parsed railroad diagram: Pele's `RailroadModel`. */
export type RailroadModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Every node of every rule's definition. */
  nodes: RailroadNode[]
  /** The grammar the text was written in. */
  notation: Notation
  /** Every rule in source order. A name defined twice appears twice. */
  rules: RailroadRule[]
  /** The title. */
  title: string | undefined
}
