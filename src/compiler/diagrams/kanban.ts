/**
 * @module Kanban boards: columns of cards written as an indented outline, with `@{ ... }`
 * metadata. Port of Pele's `src/diagrams/kanban/index.ts`. Pele's `parser.ts` only forwards to
 * the shared outline grammar, so {@link parse} calls it directly.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { parseOutline } from './common/outline.ts'
import { type KanbanDb, kanbanDbDefault, kanbanDbOutline } from './kanban/db.ts'
import { render } from './kanban/render.ts'

/** The `kanban` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  // Icons need a host resolver, which WebAssembly hosts do not pass yet.
  return render(model, input.config, options, url, undefined)
}

/** The parsed kanban model: Pele's `KanbanDb`. */
export type Model = KanbanDb

/**
 * Parses preprocessed kanban `source`, as Pele's `kanban.parse` does. `title` comes from front
 * matter.
 *
 * Throws a syntax error for input Mermaid rejects or metadata that is not YAML, and a semantic
 * error for a shape name that is not lowercase or a card before any column.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = kanbanDbDefault()
  db.title = title
  let failed = false
  let parsed: unknown
  try {
    parseOutline(source, kanbanDbOutline(db), true)
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
