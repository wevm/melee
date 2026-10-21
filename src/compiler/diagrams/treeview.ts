/**
 * @module Tree views: files and folders nested by indentation or box-drawing prefixes. Port of
 * Pele's `src/diagrams/treeview/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type TreeViewModel, buildTreeView, readTreeView } from './treeview/model.ts'
import { render } from './treeview/render.ts'

/** The `treeView` diagram type. */
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

/** The parsed tree view: Pele's `TreeViewModel`. */
export type Model = TreeViewModel

/**
 * Parses preprocessed tree view `source`, as Pele's `treeView.parse` does. `title` comes from
 * front matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects.
 */
export function parse(source: string, title: string | undefined): Model {
  return buildTreeView(readTreeView(source), title)
}
