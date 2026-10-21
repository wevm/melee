/**
 * @module Railroad diagrams: grammar rules drawn as tracks, written in Mermaid's own notation,
 * EBNF, ABNF, or PEG. Port of Pele's `src/diagrams/railroad/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { parseRailroad } from './railroad/db.ts'
import { render } from './railroad/render.ts'
import type { RailroadModel } from './railroad/types.ts'

/** The `railroad` diagram type. */
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

/** The parsed railroad diagram: Pele's `RailroadDb`. */
export type Model = RailroadModel

/**
 * Parses preprocessed railroad `source`, as Pele's `railroad.parse` does. `title` comes from
 * front matter.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  return parseRailroad(source, title)
}
