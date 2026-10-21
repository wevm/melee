/**
 * @module Event models: frames in swimlanes along a timeline, with notes and given/when/then
 * specifications. Port of Pele's `src/diagrams/eventmodeling/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type EventModelingModel, buildEventModel } from './eventmodeling/model.ts'
import { parseEventModel } from './eventmodeling/parser.ts'
import { render } from './eventmodeling/render.ts'

/** The `eventmodeling` diagram type. It parses source with its `%%` comment lines kept. */
export const DIAGRAM: Diagram = {
  keepComments: true,
  render: renderInput,
  section: undefined,
}

/** Parses and draws the diagram. */
function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, options)
}

/** The parsed event model: Pele's `EventModelingModel`. */
export type Model = EventModelingModel

/**
 * Parses preprocessed event modeling `source`, as Pele's `eventmodeling.parse` does. `title`
 * comes from front matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects, and a semantic error for a
 * repeated frame ID.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildEventModel(parseEventModel(source), source, title)
}
