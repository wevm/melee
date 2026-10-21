/**
 * @module Info diagrams: the library's name and version, with an optional title. Port of Pele's
 * `src/diagrams/info/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { buildInfo, type InfoModel } from './info/model.ts'
import { parseInfo } from './info/parser.ts'
import { render } from './info/render.ts'

/** The `info` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, options)
}

/** The parsed info diagram: Pele's `InfoModel`. */
export type Model = InfoModel

/**
 * Parses preprocessed info `source`, as Pele's `info.parse` does. `title` comes from front
 * matter.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildInfo(parseInfo(source), title)
}
