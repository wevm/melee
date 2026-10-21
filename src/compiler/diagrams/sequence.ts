/**
 * @module Sequence diagrams: participants on lifelines, the messages between them, notes, and
 * blocks. Port of Pele's `src/diagrams/sequence/index.ts`.
 */
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import type { Value } from '../yaml.ts'
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import { type SeqDb, seqDbNew, seqDbSetDiagramTitle } from './sequence/db.ts'
import { parseSequence } from './sequence/parser.ts'
import { render } from './sequence/render.ts'

/** The `sequence` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const db = parse(input.source, input.config, input.title)
  return render(db, input.config, options)
}

/** The parsed sequence diagram model: Pele's `SeqDb`. */
export type Model = SeqDb

/**
 * Parses preprocessed sequence diagram `source`, as Pele's `sequence.parse` does. `config` is the
 * diagram configuration, of which `wrap` and `sequence.wrap` are read. `title` comes from front
 * matter.
 *
 * Throws a syntax error for input Mermaid rejects or a participant config that is not valid YAML,
 * and a semantic error for a participant in two boxes, a misplaced `create` or `destroy`, and a
 * deactivation of an inactive participant.
 */
export function parse(source: string, config: Value, title: string | undefined): Model {
  const wrapValue = member(config, 'wrap')
  const wrap = wrapValue !== undefined && wrapValue.kind === 'Bool' ? wrapValue._0 : undefined
  const section = member(config, 'sequence')
  const sectionWrap = section === undefined ? undefined : member(section, 'wrap')
  const sequenceWrap = sectionWrap !== undefined && sectionWrap.kind === 'Bool' && sectionWrap._0 === true
  const db = seqDbNew(wrap, sequenceWrap)
  if (title !== undefined && title !== '') seqDbSetDiagramTitle(db, title)
  parseSequence(source, db)
  return db
}

/** The value under `key` of a YAML mapping. */
function member(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}
