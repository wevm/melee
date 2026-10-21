/**
 * @module Entity relationship diagrams: entities with attributes, relationships, and subgraphs.
 * Port of Pele's `src/diagrams/er/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type ErDb, erDbDefault } from './er/db.ts'
import { parseEr } from './er/parser.ts'
import { render } from './er/render.ts'

/** The `er` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

/** Parses and draws an ER diagram. */
function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const db = parse(input.source, input.title)
  return render(db, input.config, options, url)
}

/** The parsed ER model: Pele's `ErDb`. */
export type Model = ErDb

/**
 * Parses preprocessed ER diagram `source`, as Pele's `er.parse` does. `title` comes from front
 * matter. Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = erDbDefault()
  if (title !== undefined && title !== '') db.title = title
  parseEr(source, db)
  return db
}
