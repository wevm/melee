/**
 * @module Use case diagrams: actors, use cases, notes, JSON tables, and system boundaries, joined
 * by relationships. Port of Pele's `src/diagrams/usecase/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { parseUsecase } from './usecase/parser.ts'
import { render } from './usecase/render.ts'
import type { UsecaseModel } from './usecase/types.ts'

/** The `usecase` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

/** Parses and draws the diagram. */
function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed use case model: Pele's `UsecaseModel`. */
export type Model = UsecaseModel

/**
 * Parses preprocessed use case `source`, as Pele's `usecase.parse` does. `title` comes from front
 * matter.
 *
 * Throws Mermaid's lexing, parsing, and JSON errors as syntax errors, and its model errors as
 * semantic errors.
 */
export function parse(source: string, title: string | undefined): Model {
  return parseUsecase(source, title)
}
