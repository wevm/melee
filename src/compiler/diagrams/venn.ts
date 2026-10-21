/**
 * @module Venn diagrams: Mermaid's `venn-beta` sets, overlaps, and texts. Port of Pele's
 * `src/diagrams/venn/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type VennDb, vennDbDefault } from './venn/db.ts'
import { parseVenn } from './venn/parser.ts'
import { render } from './venn/render.ts'

/** The `venn` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, options)
}

/** The parsed venn diagram model: Pele's `VennDb`. */
export type Model = VennDb

/**
 * Parses preprocessed venn diagram `source`, as Pele's `venn.parse` does. `title` comes from
 * front matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for a union of one set or
 * of unknown sets, and for an indented text before any set.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = vennDbDefault()
  if (title !== undefined && title !== '') db.title = title
  parseVenn(source, db)
  return db
}
