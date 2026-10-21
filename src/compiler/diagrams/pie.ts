/**
 * @module Pie charts: labeled values drawn as slices of a circle. Port of Pele's
 * `src/diagrams/pie/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { buildPie, type PieModel } from './pie/model.ts'
import { parsePie } from './pie/parser.ts'
import { render } from './pie/render.ts'

/** The `pie` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed pie chart: Pele's `PieModel`. */
export type Model = PieModel

/**
 * Parses preprocessed pie `source`, as Pele's `pie.parse` does. `title` comes from front matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for a negative slice.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildPie(parsePie(source), title)
}
