/**
 * @module Gantt charts: tasks on a time axis, with sections, dependencies, excluded days, and
 * milestones. Port of Pele's `src/diagrams/gantt/index.ts`.
 *
 * Pele reads and writes dates in the host's local time zone. Ondine works in UTC, so it matches
 * Pele running with `TZ=UTC`. Pele schedules against the current time when the host gives no
 * `now`. The compiler reads no clock, so it schedules against the epoch instead.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import type { Value } from '../yaml.ts'
import { type GanttDb, ganttDbNew } from './gantt/db.ts'
import { parseGantt } from './gantt/parser.ts'
import { render } from './gantt/render.ts'

/** The `gantt` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

/** Parses and draws a gantt chart. */
function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const db = parse(input.source, input.config, input.title)
  return render(db, input.config, options, url)
}

/** The parsed gantt model: Pele's `GanttDb`. */
export type Model = GanttDb

/**
 * Parses preprocessed gantt `source`, as Pele's `gantt.parse` does. `config` is the diagram
 * configuration, of which `gantt.displayMode` is read. `title` comes from front matter.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for a task with no end or
 * too many fields.
 */
export function parse(source: string, config: Value, title: string | undefined): Model {
  const db = ganttDbNew()
  if (title !== undefined && title !== '') {
    db.title = title
  }
  const gantt = property(config, 'gantt')
  const mode = gantt === undefined ? undefined : property(gantt, 'displayMode')
  if (mode !== undefined && mode.kind === 'String') {
    db.displayMode = mode._0
  }
  parseGantt(source, db)
  return db
}

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') {
    return undefined
  }
  return value._0.find(([own]) => own === key)?.[1]
}
