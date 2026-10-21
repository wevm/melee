/**
 * @module Radar charts: series of values drawn as closed curves over radial axes. Port of Pele's
 * `src/diagrams/radar/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type RadarModel, buildRadar } from './radar/model.ts'
import { parseRadar } from './radar/parser.ts'
import { render } from './radar/render.ts'

/** The `radar` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed radar chart: Pele's `RadarModel`. */
export type Model = RadarModel

/**
 * Parses preprocessed radar `source`, as Pele's `radar.parse` does. `title` comes from front
 * matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects, and a semantic error for a
 * curve whose axis references cannot be resolved.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildRadar(parseRadar(source), title)
}
