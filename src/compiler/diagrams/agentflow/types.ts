/**
 * @module Records of the agentflow model. Port of Pele's `src/diagrams/agentflow/types.ts`.
 *
 * Labels, class definitions, and subgraph body items have the flowchart's shape, so those types
 * come from the flowchart module.
 */
import type { Value } from '../../yaml.ts'
import type { DocItem, FlowClassDef, FlowText } from '../flowchart/types.ts'
import { LabelType } from '../flowchart/types.ts'

export type { DocItem, FlowClassDef, FlowText }
export { LabelType }

/** Metadata from `@{ ... }` blocks, merged in JavaScript property order. */
export type Metadata = [string, Value][]

/** A source span as Jison reports it: lines start at 1, columns at 0, in UTF-16 units. */
export type Loc = {
  /** The column the span starts at. */
  firstColumn: number
  /** The line the span starts on. */
  firstLine: number
  /** The column the span ends at. */
  lastColumn: number
  /** The line the span ends on. */
  lastLine: number
}

/** `Loc::default()`. */
export function locDefault(): Loc {
  return { firstColumn: 0, firstLine: 0, lastColumn: 0, lastLine: 0 }
}

/** A node, or a connector, which is a node too. */
export type AgentNode = {
  /** Class names, in application order. */
  classes: string[]
  /** A direction. The parser never sets it, but the model keeps its slot. */
  dir: string | undefined
  /** The node id. */
  id: string
  /** Whether a `connector` statement made the node. */
  isConnector: boolean
  /** How the label is written. */
  labelType: LabelType
  /** The sanitized click target. */
  link: string | undefined
  /** The click target window. */
  linkTarget: string | undefined
  /** Metadata merged across statements. */
  metadata: Metadata | undefined
  /** `[|field:value|...]` properties, in insertion order. Set by the first `addVertex`. */
  props: [string, string][] | undefined
  /** Inline styles, in application order. */
  styles: string[]
  /** The label. */
  text: string | undefined
  /** The shape: a bracket syntax name or a metadata shape name. */
  type: string | undefined
}

/** An edge. */
export type AgentEdge = {
  /** `animate` from metadata, as YAML read it. */
  animate: Value | undefined
  /** `animation` from metadata, as YAML read it. */
  animation: Value | undefined
  /** Class names, in application order. */
  classes: string[]
  /** `sequence`, `reference`, or `failure`, for the arrows that mean one. */
  edgeSemantic: string | undefined
  /** The target node id. */
  end: string
  /** The user-defined or generated id. */
  id: string
  /** The curve: from `linkStyle ... interpolate`, or any YAML value from metadata `curve`. */
  interpolate: Value | undefined
  /** Whether `id` was written in the source. */
  isUserDefinedId: boolean
  /** How the label is written. */
  labelType: LabelType
  /** The extra rank span, capped at 10. */
  length: number | undefined
  /** Metadata merged across statements. */
  metadata: Metadata | undefined
  /** The source node id. */
  start: string
  /** `normal`, `dotted`, or `INVALID`. */
  stroke: string
  /** Styles from `linkStyle`. */
  style: string[] | undefined
  /** The label. */
  text: string
  /** The arrowhead kind, such as `arrow_point`. */
  type: string
}

/** A `flow` block. */
export type AgentSubgraph = {
  /** Class names, in application order. */
  classes: string[]
  /** The layout direction. */
  dir: string | undefined
  /** The flow id. */
  id: string
  /** How the title is written. */
  labelType: LabelType
  /** Metadata merged across statements. */
  metadata: Metadata | undefined
  /** Member node and flow ids. */
  nodes: string[]
  /** The title. */
  title: string
}

/** An arrow as `destructLink` reads it. */
export type LinkInfo = {
  /** What the arrow means, when it means something. */
  edgeSemantic: string | undefined
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
 * Where a statement sits in the source. Lines include the front matter offset. Mermaid builds
 * its parser without ranges, so the start and end indexes are always zero and are left out.
 */
export type ElementPosition = {
  /** The column the statement ends at. */
  endColumn: number
  /** The line the statement ends on. */
  endLine: number
  /** The column the statement starts at. */
  startColumn: number
  /** The line the statement starts on. */
  startLine: number
}

/** `ElementPosition::default()`. */
export function elementPositionDefault(): ElementPosition {
  return { endColumn: 0, endLine: 0, startColumn: 0, startLine: 0 }
}

/** A statement's id, kind, and position. */
export type ElementMapping = {
  /** The element's id. */
  id: string
  /** Where the statement sits. */
  position: ElementPosition
  /** `vertex`, `edge`, `subgraph`, `connector`, or `attachment`. */
  type: string
}

/** A finding about the diagram's meaning, recorded on the model. */
export type Diagnostic = {
  /** The finding's id, such as `SHAPE_REMOVED`. */
  id: string
  /** The finding, in words. */
  message: string
  /** The node the finding is about. Pele's `edgeId` is never set by a parser, so it is left out. */
  nodeId: string | undefined
  /** Where the element it is about was first written. */
  position: ElementPosition | undefined
  /** `warning` or `error`. */
  severity: string
}
