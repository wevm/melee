/**
 * @module Agentflows: flowcharts of agent steps, tools, decisions, and references, grouped in flows,
 * with source positions for each statement and diagnostics about shapes and nesting. Port of
 * Pele's `src/diagrams/agentflow/index.ts`.
 *
 * Pele's `diagnostics.ts` only names the diagnostic vocabulary for tests, so it is not ported.
 * The Rust `to_json` model writer is behind the `model` feature, so it is not ported either.
 */
import { type AgentflowDb, agentflowDbNew } from './agentflow/db.ts'
import { type AgentGraph, buildAgentGraph } from './agentflow/graph.ts'
import { parseAgentflow } from './agentflow/parser.ts'
import { PALETTE, render } from './agentflow/render.ts'
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import type { Value } from '../yaml.ts'

/** The `agentflow` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: true,
  render: renderInput,
  section: undefined,
}

/**
 * The parsed agentflow: Pele's `AgentflowDb`, with the graph Pele's `agentGraph` builds once per
 * model while parsing.
 */
export type Model = {
  /** The model. */
  db: AgentflowDb
  /** The nodes and edges to draw. */
  graph: AgentGraph
}

function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const model = parse(input.source, input.config, input.title, input.lineOffset, input.maxEdges)
  return render(model.db, model.graph, input.config, options, url)
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/**
 * Parses preprocessed agentflow `source`, which keeps its `%%` comment lines, as Pele's
 * `agentflow.parse` does, and builds the graph to draw. `config` is the diagram configuration,
 * of which `direction`, `flowchart.inheritDir`, and `flowchart.curve` are read. `title` comes
 * from front matter, and `lineOffset` counts the front matter lines. `maxEdges` bounds the
 * edge count.
 *
 * Throws a syntax error for input Mermaid rejects and for metadata that is not YAML, a
 * semantic error for unknown shapes and out-of-range `linkStyle` indexes, and a limit error past
 * `maxEdges` edges.
 */
export function parse(
  source: string,
  config: Value,
  title: string | undefined,
  lineOffset: number,
  maxEdges: number | undefined,
): Model {
  // Mermaid reads these settings from the flowchart section for agentflow too.
  const flow = property(config, 'flowchart')
  const inherit = flow === undefined ? undefined : property(flow, 'inheritDir')
  const inheritDir = inherit !== undefined && inherit.kind === 'Bool' && inherit._0
  const dir = property(config, 'direction')
  const direction = dir !== undefined && dir.kind === 'String' ? dir._0 : undefined
  const db = agentflowDbNew({ direction, inheritDir, lineOffset, maxEdges })
  if (title !== undefined && title !== '') db.title = title
  parseAgentflow(source, db)

  const curveValue = flow === undefined ? undefined : property(flow, 'curve')
  const curve = curveValue !== undefined && curveValue.kind === 'String' ? curveValue._0 : undefined
  const graph = buildAgentGraph(db, PALETTE, curve)
  return { db, graph }
}
