/**
 * @module The gantt task record. Port of Pele's `src/diagrams/gantt/types.ts`. The model itself is
 * `GanttDb` in `./db.ts`.
 */
import type { Date } from './js_date.ts'

/** A task's data as written: the whole data text and its start and end fields. */
export type Raw = {
  /** The data text, with its leading `:`. */
  data: string
  /** The end date, duration, or `until` reference. */
  end: string
  /** The start date or `after` reference, when one was given. */
  start: string | undefined
}

/** An empty `Raw`. */
export function rawDefault(): Raw {
  return { data: '', end: '', start: undefined }
}

/** A task or vertical marker. */
export type GanttTask = {
  /** Whether the task is in progress. */
  active: boolean
  /** Classes, such as `clickable`. */
  classes: string[]
  /** Whether the task is critical. */
  crit: boolean
  /** Whether the task is finished. */
  done: boolean
  /** Unset until scheduled, and still unset when what it refers to never resolves. */
  endTime: Date | undefined
  /** The task's id, given or generated. */
  id: string
  /** Whether the end was given as a date. */
  manualEndTime: boolean
  /** Whether the task is a milestone. */
  milestone: boolean
  /** Row index in source order, or -1 for vertical markers, which take no row. */
  order: number
  /** The id of the task written before this one. */
  prevTaskId: string | undefined
  /** Whether scheduling resolved the task. */
  processed: boolean
  /** The task's data as written. */
  raw: Raw
  /**
   * Where the bar ends when excluded days pushed the task's end out. `undefined` when the end was
   * given as a date.
   */
  renderEndTime: Date | undefined
  /** The section the task belongs to. */
  section: string
  /** Unset until scheduled. */
  startTime: Date | undefined
  /** The task's label, under the name Mermaid gives it. */
  task: string
  /** Whether the task is a vertical marker. */
  vert: boolean
}

/** An empty `GanttTask`. */
export function ganttTaskDefault(): GanttTask {
  return {
    active: false,
    classes: [],
    crit: false,
    done: false,
    endTime: undefined,
    id: '',
    manualEndTime: false,
    milestone: false,
    order: 0,
    prevTaskId: undefined,
    processed: false,
    raw: rawDefault(),
    renderEndTime: undefined,
    section: '',
    startTime: undefined,
    task: '',
    vert: false,
  }
}
