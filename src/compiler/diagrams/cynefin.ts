/**
 * @module Cynefin diagrams: items sorted into the five Cynefin domains, with transitions between
 * them. Port of Pele's `src/diagrams/cynefin/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type CynefinModel, buildCynefin } from './cynefin/model.ts'
import { parseCynefin } from './cynefin/parser.ts'
import { render } from './cynefin/render.ts'

/** The `cynefin` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed Cynefin diagram: Pele's `CynefinModel`. */
export type Model = CynefinModel

/**
 * Parses preprocessed Cynefin `source`, as Pele's `cynefin.parse` does. `title` comes from front
 * matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildCynefin(parseCynefin(source), title)
}
