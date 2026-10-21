/**
 * @module Timelines: time periods with their events, grouped in sections. Port of Pele's
 * `src/diagrams/timeline/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type TimelineDb, timelineDbDefault } from './timeline/db.ts'
import { parseTimeline } from './timeline/parser.ts'
import { render } from './timeline/render.ts'

/** The `timeline` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed timeline model: Pele's `TimelineDb`. */
export type Model = TimelineDb

/**
 * Parses preprocessed timeline `source`, as Pele's `timeline.parse` does. `title` comes from
 * front matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for an event before any
 * period.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = timelineDbDefault()
  db.title = title
  parseTimeline(source, db)
  return db
}
