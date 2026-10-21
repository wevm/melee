/**
 * @module Architecture diagrams: Mermaid's `architecture-beta` services, junctions, groups, and
 * edges between their sides. Port of Pele's `src/diagrams/architecture/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type ArchitectureDb, architectureDbDefault, populate } from './architecture/db.ts'
import { parseArchitecture } from './architecture/parser.ts'
import { renderArchitecture } from './architecture/render.ts'

/** The `architecture` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return renderArchitecture(model, input.config, options)
}

/** The parsed architecture model: Pele's `ArchitectureDb`. */
export type Model = ArchitectureDb

/**
 * Parses preprocessed architecture `source`, as Pele's `architecture.parse` does. `title` comes
 * from front matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects, and a semantic error for a
 * model Mermaid's database refuses.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = architectureDbDefault()
  if (title !== undefined && title !== '') db.title = title
  populate(parseArchitecture(source), db)
  return db
}
