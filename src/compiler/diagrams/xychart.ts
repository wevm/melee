/**
 * @module XY charts: lines and bars over a category or numeric x axis. Port of Pele's
 * `src/diagrams/xychart/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type XyChartDb, xyChartDbDefault } from './xychart/db.ts'
import { parseXychart } from './xychart/parser.ts'
import { render } from './xychart/render.ts'

/** The `xychart` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: 'xyChart',
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed XY chart model: Pele's `XyChartDb`. */
export type Model = XyChartDb

/**
 * Parses preprocessed XY chart `source`, as Pele's `xychart.parse` does. `title` comes from
 * front matter.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = xyChartDbDefault()
  db.title = title
  parseXychart(source, db)
  return db
}
