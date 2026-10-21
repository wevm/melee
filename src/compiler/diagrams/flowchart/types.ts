/** @module Records of the flowchart model. Port of Pele's `src/diagrams/flowchart/types.ts`. */
import type { Value } from '../../yaml.ts'

/** How a label is written: plain text, a quoted string, or Markdown. */
export const LabelType = {
  /** Pele's `'markdown'`. */
  Markdown: 'Markdown',
  /** Pele's `'string'`. */
  String: 'String',
  /** Pele's `'text'`. */
  Text: 'Text',
} as const

/** How a label is written. */
export type LabelType = (typeof LabelType)[keyof typeof LabelType]

/** The name Pele stores. */
export function labelTypeAsStr(value: LabelType): string {
  switch (value) {
    case LabelType.Markdown:
      return 'markdown'
    case LabelType.String:
      return 'string'
    case LabelType.Text:
      return 'text'
  }
}

/** A label as the parser reads it. */
export type FlowText = {
  /** The label text. */
  text: string
  /** How the label is written. */
  type: LabelType
}

/** A node. Fields Pele leaves `undefined` are `undefined`. */
export type FlowNode = {
  /** `h` from shape data, as `Number()` reads it. */
  assetHeight: number | undefined
  /** `w` from shape data, as `Number()` reads it. */
  assetWidth: number | undefined
  /** Class names, in application order. */
  classes: string[]
  /** `constraint` from shape data. */
  constraint: string | undefined
  /** A direction. Mermaid's parser never sets it, but the model keeps its slot. */
  dir: string | undefined
  /** `form` from shape data. */
  form: string | undefined
  /** `icon` from shape data. */
  icon: string | undefined
  /** The node id. */
  id: string
  /** `img` from shape data. */
  img: string | undefined
  /** How the label is written. */
  labelType: LabelType
  /** The sanitized click target. */
  link: string | undefined
  /** The click target window. */
  linkTarget: string | undefined
  /** `pos` from shape data. */
  pos: string | undefined
  /** `[|field:value|...]` properties, in insertion order. Set by the first `addVertex`. */
  props: [string, string][] | undefined
  /** Inline styles, in application order. */
  styles: string[]
  /** The label. */
  text: string | undefined
  /** The shape: a bracket syntax name or a shape data name. */
  type: string | undefined
}

/** An edge. */
export type FlowEdge = {
  /** `animate` from shape data, as YAML read it. */
  animate: Value | undefined
  /** `animation` from shape data, as YAML read it. */
  animation: Value | undefined
  /** Class names, in application order. */
  classes: string[]
  /** The target node id. */
  end: string
  /** The user-defined or generated id. */
  id: string | undefined
  /** The curve: from `linkStyle ... interpolate`, or any YAML value from shape data `curve`. */
  interpolate: Value | undefined
  /** Whether `id` was written in the source. */
  isUserDefinedId: boolean
  /** How the label is written. */
  labelType: LabelType
  /** The extra rank span, capped at 10. */
  length: number | undefined
  /** The source node id. */
  start: string
  /** `normal`, `thick`, `dotted`, `invisible`, or `INVALID`. */
  stroke: string | undefined
  /** Styles from `linkStyle`. */
  style: string[] | undefined
  /** The label. */
  text: string
  /** The arrowhead kind, such as `arrow_point`. */
  type: string | undefined
}

/** A `classDef`. */
export type FlowClassDef = {
  /** The class name. */
  id: string
  /** Declarations. */
  styles: string[]
  /** Declarations that mention `color`, with `fill` renamed `bgFill`. */
  textStyles: string[]
}

/** A subgraph. */
export type FlowSubgraph = {
  /** Class names, in application order. */
  classes: string[]
  /** The layout direction. */
  dir: string | undefined
  /** The subgraph id. */
  id: string
  /** How the title is written. */
  labelType: LabelType
  /** Shape data merged across statements, in insertion order. */
  metadata: [string, Value][] | undefined
  /** Member node and subgraph ids. */
  nodes: string[]
  /** The title. */
  title: string
}

/** An arrow as `destructLink` reads it. */
export type LinkInfo = {
  /** The user-defined id, with its `@`. */
  id: string | undefined
  /** The extra rank span. */
  length: number | undefined
  /** The stroke. */
  stroke: string
  /** The label. */
  text: FlowText | undefined
  /** The arrowhead kind. */
  type: string
}

/**
 * An item a subgraph body collects: separator text, the node ids of a statement, or a
 * `direction` statement.
 */
export type DocItem =
  /** A `direction` statement. */
  | { kind: 'Dir'; _0: string }
  /** Node ids, most recent first. */
  | { kind: 'Ids'; _0: string[] }
  /** Separator or accessibility text. */
  | { kind: 'Str'; _0: string }
