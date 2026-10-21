/**
 * @module Diagram types and the contract each one implements: all 33 types of Ondine's compiler.
 */
import { DIAGRAM as agentflow } from './diagrams/agentflow.ts'
import { DIAGRAM as architecture } from './diagrams/architecture.ts'
import { DIAGRAM as block } from './diagrams/block.ts'
import { DIAGRAM as c4 } from './diagrams/c4.ts'
import { DIAGRAM as classDiagram } from './diagrams/class.ts'
import { DIAGRAM as cynefin } from './diagrams/cynefin.ts'
import { DIAGRAM as er } from './diagrams/er.ts'
import { DIAGRAM as eventmodeling } from './diagrams/eventmodeling.ts'
import { DIAGRAM as flowchart } from './diagrams/flowchart.ts'
import { DIAGRAM as gantt } from './diagrams/gantt.ts'
import { DIAGRAM as git } from './diagrams/git.ts'
import { DIAGRAM as info } from './diagrams/info.ts'
import { DIAGRAM as ishikawa } from './diagrams/ishikawa.ts'
import { DIAGRAM as journey } from './diagrams/journey.ts'
import { DIAGRAM as kanban } from './diagrams/kanban.ts'
import { DIAGRAM as mindmap } from './diagrams/mindmap.ts'
import { DIAGRAM as packet } from './diagrams/packet.ts'
import { DIAGRAM as pie } from './diagrams/pie.ts'
import { DIAGRAM as quadrant } from './diagrams/quadrant.ts'
import { DIAGRAM as radar } from './diagrams/radar.ts'
import { DIAGRAM as railroad } from './diagrams/railroad.ts'
import { DIAGRAM as requirement } from './diagrams/requirement.ts'
import { DIAGRAM as sankey } from './diagrams/sankey.ts'
import { DIAGRAM as sequence } from './diagrams/sequence.ts'
import { DIAGRAM as state } from './diagrams/state.ts'
import { DIAGRAM as swimlane } from './diagrams/swimlane.ts'
import { DIAGRAM as timeline } from './diagrams/timeline.ts'
import { DIAGRAM as treemap } from './diagrams/treemap.ts'
import { DIAGRAM as treeView } from './diagrams/treeview.ts'
import { DIAGRAM as usecase } from './diagrams/usecase.ts'
import { DIAGRAM as venn } from './diagrams/venn.ts'
import { DIAGRAM as wardley } from './diagrams/wardley.ts'
import { DIAGRAM as xychart } from './diagrams/xychart.ts'
import type { RenderOptions } from './svg/root.ts'
import type { LinkInfo, UrlOptions } from './util/url.ts'
import type { Value } from './yaml.ts'

/** What a diagram type receives, as Pele's `Diagram.parse` does. */
export type Input = {
  /** The diagram configuration from front matter and directives, as a YAML mapping. */
  config: Value
  /** Front matter lines removed before `source`, for types that report source positions. */
  lineOffset: number
  /** The most edges a flowchart-like diagram may have. */
  maxEdges: number
  /**
   * Preprocessed, entity-encoded source ending in a newline. It keeps `%%` comment lines when the
   * type sets `keepComments`.
   */
  source: string
  /** The front matter title. */
  title: string | undefined
}

/** A drawn diagram. */
export type Rendered = {
  /** Height in pixels. */
  height: number
  /** Links in drawing order. */
  links: LinkInfo[]
  /** The SVG document. */
  svg: string
  /** Width in pixels. */
  width: number
}

/** A diagram type, as Pele's `Diagram` describes one. */
export type Diagram = {
  /** Whether the type parses source with its `%%` comment lines kept. */
  keepComments: boolean
  /** Parses and draws the diagram. Throws a `CompileError`. */
  render: (input: Input, options: RenderOptions, url: UrlOptions) => Rendered
  /** The type's section in Mermaid's config, when it is not the type's own name. */
  section: string | undefined
}

/** The diagram type named `type` (Pele's names), when this build includes it. */
export function find(type: string): Diagram | undefined {
  switch (type) {
    case 'agentflow':
      return agentflow
    case 'architecture':
      return architecture
    case 'block':
      return block
    case 'c4':
      return c4
    case 'class':
      return classDiagram
    case 'cynefin':
      return cynefin
    case 'er':
      return er
    case 'eventmodeling':
      return eventmodeling
    case 'flowchart':
      return flowchart
    case 'gantt':
      return gantt
    case 'gitGraph':
      return git
    case 'info':
      return info
    case 'ishikawa':
      return ishikawa
    case 'journey':
      return journey
    case 'kanban':
      return kanban
    case 'mindmap':
      return mindmap
    case 'packet':
      return packet
    case 'pie':
      return pie
    case 'quadrantChart':
      return quadrant
    case 'radar':
      return radar
    case 'railroad':
      return railroad
    case 'requirement':
      return requirement
    case 'sankey':
      return sankey
    case 'sequence':
      return sequence
    case 'state':
      return state
    case 'swimlane':
      return swimlane
    case 'timeline':
      return timeline
    case 'treemap':
      return treemap
    case 'treeView':
      return treeView
    case 'usecase':
      return usecase
    case 'venn':
      return venn
    case 'wardley':
      return wardley
    case 'xychart':
      return xychart
    default:
      return undefined
  }
}
