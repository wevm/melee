/** @module Git graphs: Mermaid's `gitGraph`. Port of Pele's `src/diagrams/git/index.ts`. */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import type { Value } from '../yaml.ts'
import { type GitModel, buildGit } from './git/db.ts'
import { parseGit } from './git/parser.ts'
import { render } from './git/render.ts'

/** The `gitGraph` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.config, input.title)
  return render(model, input.config, options)
}

/** The built git graph: Pele's `GitModel`. */
export type Model = GitModel

/**
 * Parses preprocessed git graph `source` with `config`, as Pele's `gitGraph.parse` does. `title`
 * comes from front matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects, and a semantic error for an
 * operation Mermaid's database rejects.
 */
export function parse(source: string, config: Value, title: string | undefined): Model {
  return buildGit(parseGit(source), config, title)
}
