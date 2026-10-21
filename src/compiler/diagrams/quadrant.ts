/**
 * @module Quadrant charts: points placed on two axes split into four labelled quadrants. Port of
 * Pele's `src/diagrams/quadrant/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type QuadrantDb, quadrantDbDefault } from './quadrant/db.ts'
import { parseQuadrant } from './quadrant/parser.ts'
import { render } from './quadrant/render.ts'

/** The `quadrantChart` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed quadrant chart model: Pele's `QuadrantDb`. */
export type Model = QuadrantDb

/**
 * Parses preprocessed quadrant chart `source`, as Pele's `quadrantChart.parse` does. `title`
 * comes from front matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for an invalid point
 * style.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = quadrantDbDefault()
  db.title = title
  parseQuadrant(source, db)
  return db
}
