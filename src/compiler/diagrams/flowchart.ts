/**
 * @module Flowcharts: Mermaid's `graph` and `flowchart` diagrams, which swimlane diagrams share.
 * Port of Pele's `src/diagrams/flowchart/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import { type FlowDb, flowDbNew } from './flowchart/db.ts'
import { parseFlowchart } from './flowchart/parser.ts'
import { render } from './flowchart/render.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import type { Value } from '../yaml.ts'

/** The `flowchart` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const db = parse(input.source, input.config, input.title, input.maxEdges)
  return render(db, input.config, options, url, undefined)
}

/** The parsed flowchart model: Pele's `FlowDb`. */
export type Model = FlowDb

/**
 * Parses preprocessed flowchart `source`, as Pele's `flowchart.parse` does. `config` is the
 * diagram configuration, of which `flowchart.inheritDir` is read. `title` comes from front
 * matter. `maxEdges` bounds the edge count.
 *
 * Throws a syntax error for input Mermaid rejects, a semantic error for unknown shapes and
 * out-of-range `linkStyle` indexes, and a limit error past `maxEdges` edges.
 */
export function parse(
  source: string,
  config: Value,
  title: string | undefined,
  maxEdges: number | undefined,
): Model {
  const flow = property(config, 'flowchart')
  const inherit = flow === undefined ? undefined : property(flow, 'inheritDir')
  const inheritDir = inherit?.kind === 'Bool' && inherit._0
  const db = flowDbNew({ inheritDir, maxEdges })
  if (title !== undefined && title !== '') db.title = title
  parseFlowchart(source, db)
  return db
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}
