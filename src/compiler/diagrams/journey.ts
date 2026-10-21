/**
 * @module User journeys: scored tasks with their actors, grouped in sections. Port of Pele's
 * `src/diagrams/journey/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type JourneyDb, journeyDbDefault } from './journey/db.ts'
import { parseJourney } from './journey/parser.ts'
import { render } from './journey/render.ts'

/** The `journey` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, options)
}

/** The parsed user journey model: Pele's `JourneyDb`. */
export type Model = JourneyDb

/**
 * Parses preprocessed journey `source`, as Pele's `journey.parse` does. `title` comes from front
 * matter.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = journeyDbDefault()
  db.title = title
  parseJourney(source, db)
  return db
}
