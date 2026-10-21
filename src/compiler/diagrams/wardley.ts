/**
 * @module Wardley maps: Mermaid's `wardley-beta`, components placed by visibility and evolution.
 * Port of Pele's `src/diagrams/wardley/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type WardleyModel, buildWardley } from './wardley/model.ts'
import { parseWardley } from './wardley/parser.ts'
import { render } from './wardley/render.ts'

/** The `wardley` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: 'wardley-beta',
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed map: Pele's `WardleyModel`. */
export type Model = WardleyModel

/**
 * Parses preprocessed Wardley `source`, as Pele's `wardley.parse` does. `title` comes from front
 * matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects, and a semantic error for a
 * coordinate out of range or a pipeline without its component.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildWardley(parseWardley(source), title)
}
