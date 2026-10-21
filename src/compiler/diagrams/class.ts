/**
 * @module Class diagrams: classes with members, namespaces, notes, and relations. Port of Pele's
 * `src/diagrams/class/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import { type ClassDb, classDbDefault } from './class/db.ts'
import { parseClassDiagram } from './class/parser.ts'
import { render } from './class/render.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'

/** The `class` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

/** Parses and draws a class diagram. */
function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const db = parse(input.source, input.title)
  return render(db, input.config, options, url)
}

/** The parsed class model: Pele's `ClassDb`. */
export type Model = ClassDb

/**
 * Parses preprocessed class diagram `source`, as Pele's `classDiagram.parse` does. `title`
 * comes from front matter.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = classDbDefault()
  if (title !== undefined && title !== '') db.title = title
  parseClassDiagram(source, db)
  return db
}
