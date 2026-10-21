/**
 * @module Mindmaps: an indented outline of nodes around one root, drawn as branches to both sides
 * or as an outline running down. Port of Pele's `src/diagrams/mindmap/index.ts`. Pele's
 * `parser.ts` only forwards to the shared outline grammar, so {@link parse} calls it directly.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { parseOutline } from './common/outline.ts'
import { type MindmapDb, mindmapDbDefault, mindmapDbOutline } from './mindmap/db.ts'
import { render } from './mindmap/render.ts'

/** The `mindmap` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  // Icons need a host resolver, which WebAssembly hosts do not pass yet.
  return render(model, input.config, options, undefined)
}

/** The parsed mindmap model: Pele's `MindmapDb`. */
export type Model = MindmapDb

/**
 * Parses preprocessed mindmap `source`, as Pele's `mindmap.parse` does. `title` comes from front
 * matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for a second root.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = mindmapDbDefault()
  db.title = title
  let failed = false
  let parsed: unknown
  try {
    parseOutline(source, mindmapDbOutline(db), false)
  } catch (error) {
    failed = true
    parsed = error
  }
  // An action's error came first: Pele throws it before the parser reads further.
  const error = db.error
  if (error !== undefined) {
    db.error = undefined
    throw error
  }
  if (failed) throw parsed
  return db
}
