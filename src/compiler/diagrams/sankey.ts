/**
 * @module Sankey diagrams: flows between named nodes, drawn as bands between bars. Port of Pele's
 * `src/diagrams/sankey/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type SankeyDb, sankeyDbDefault } from './sankey/db.ts'
import { parseSankey, prepareTextForParsing } from './sankey/parser.ts'
import { render } from './sankey/render.ts'

/** The `sankey` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const db = parse(input.source, input.title)
  return render(db, input.config, options)
}

/** The parsed sankey model: Pele's `SankeyDb`. */
export type Model = SankeyDb

/**
 * Parses preprocessed sankey `source`, as Pele's `sankey.parse` does. `title` comes from front
 * matter.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = sankeyDbDefault()
  if (title !== undefined && title !== '') db.title = title
  parseSankey(prepareTextForParsing(source), db)
  return db
}
