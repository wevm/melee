/**
 * @module Treemaps: nested sections and valued leaves drawn as nested rectangles. Port of Pele's
 * `src/diagrams/treemap/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type TreemapModel, buildTreemap } from './treemap/model.ts'
import { parseTreemap } from './treemap/parser.ts'
import { render } from './treemap/render.ts'

/** The `treemap` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed treemap: Pele's `TreemapModel`. */
export type Model = TreemapModel

/**
 * Parses preprocessed treemap `source`, as Pele's `treemap.parse` does. `title` comes from
 * front matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildTreemap(parseTreemap(source), title)
}
