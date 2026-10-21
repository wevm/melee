/**
 * @module Ishikawa diagrams: an effect and its causes, drawn as a fishbone. Port of Pele's
 * `src/diagrams/ishikawa/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type IshikawaDb, ishikawaDbDefault } from './ishikawa/db.ts'
import { parseIshikawa } from './ishikawa/parser.ts'
import { render } from './ishikawa/render.ts'

/** The `ishikawa` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, options)
}

/** The parsed Ishikawa model: Pele's `IshikawaDb`. */
export type Model = IshikawaDb

/**
 * Parses preprocessed Ishikawa `source`, as Pele's `ishikawa.parse` does. `title` comes from
 * front matter.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = ishikawaDbDefault()
  db.title = title
  parseIshikawa(source, db)
  return db
}
