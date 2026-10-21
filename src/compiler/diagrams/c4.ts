/**
 * @module C4 diagrams: people, systems, containers and components in nested boundaries, joined by
 * relations. Port of Pele's `src/diagrams/c4/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type C4Db, c4DbDefault } from './c4/db.ts'
import { parseC4 } from './c4/parser.ts'
import { render } from './c4/render.ts'

/** The `c4` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, options, url)
}

/** The parsed C4 model: Pele's `C4Db`. */
export type Model = C4Db

/**
 * Parses preprocessed C4 `source`, as Pele's `c4.parse` does. `title` comes from front matter
 * and is kept when it is not empty.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = c4DbDefault()
  if (title !== undefined && title !== '') db.title = title
  parseC4(source, db)
  return db
}
