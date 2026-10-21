/**
 * @module State diagrams: Mermaid's `stateDiagram` and `stateDiagram-v2`. Port of Pele's
 * `src/diagrams/state/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import { type StateDb, stateDbDefault } from './state/db.ts'
import { parseState } from './state/parser.ts'
import { render } from './state/render.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'

/** The `state` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const db = parse(input.source, input.title)
  return render(db, input.config, options, url)
}

/** The parsed state diagram model: Pele's `StateDb`. */
export type Model = StateDb

/**
 * Parses preprocessed state diagram `source`, as Pele's `state.parse` does. `title` comes from
 * front matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for a composite state
 * with a description.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = stateDbDefault()
  if (title !== undefined && title !== '') db.title = title
  parseState(source, db)
  return db
}
