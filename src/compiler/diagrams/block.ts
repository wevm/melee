/**
 * @module Block diagrams: Mermaid's `block-beta` grid of blocks, composites, and links. Port of
 * Pele's `src/diagrams/block/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import { type BlockDb, blockDbDefault } from './block/db.ts'
import { parseBlock } from './block/parser.ts'
import { render } from './block/render.ts'

/** The `block` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.title)
  return render(model, input.config, options)
}

/** The parsed block diagram model: Pele's `BlockDb`. */
export type Model = BlockDb

/**
 * Parses preprocessed block diagram `source`, as Pele's `block.parse` does. `title` comes from
 * front matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a limit error past 100,000 space blocks.
 */
export function parse(source: string, title: string | undefined): Model {
  const db = blockDbDefault()
  db.title = title
  parseBlock(source, db)
  return db
}
