/**
 * @module Requirement diagrams: requirements and elements with their fields, joined by
 * relationships. Port of Pele's `src/diagrams/requirement/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type RequirementDb, requirementDbDefault } from './requirement/db.ts'
import { parseRequirement } from './requirement/parser.ts'
import { render } from './requirement/render.ts'

/** The `requirement` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const db = parse(input.source, input.title)
  return render(db, options)
}

/** The parsed requirement model: Pele's `RequirementDb`. */
export type Model = RequirementDb

/**
 * Parses preprocessed requirement `source`, as Pele's `requirement.parse` does. `title` comes
 * from front matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects, and a limit error when classes
 *   copy too many style declarations.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = requirementDbDefault()
  if (title !== undefined && title !== '') db.title = title
  parseRequirement(source, db)
  return db
}
