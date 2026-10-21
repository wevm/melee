/** @module The timeline database. Port of Pele's `src/diagrams/timeline/db.ts`. */
import { type CompileError, Code, errorNew } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'

/** A time period and its events. */
export type TimelinePeriod = {
  /** The events, in source order. */
  events: string[]
  /** Name of the section in force when the period was declared, empty before the first one. */
  section: string
  /** Index into `sections` of that section, -1 before the first one. */
  sectionIndex: number
  /** The period's text. */
  text: string
}

/** `TimelinePeriod::default()`. */
export function timelinePeriodDefault(): TimelinePeriod {
  return { events: [], section: '', sectionIndex: 0, text: '' }
}

/** The parsed timeline: Pele's `TimelineDb`. */
export type TimelineDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  currentSection: string
  /** `LR` or `TD`. */
  direction: string
  /** The periods, in source order. */
  periods: TimelinePeriod[]
  /** The section names, in source order. */
  sections: string[]
  /** The title. */
  title: string | undefined
}

/** `TimelineDb::default()`. */
export function timelineDbDefault(): TimelineDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    currentSection: '',
    direction: 'LR',
    periods: [],
    sections: [],
    title: undefined,
  }
}

/**
 * `text.replace(/\n\s+/g, '\n')`: each line break followed by whitespace, line breaks included,
 * becomes one line break.
 */
export function collapseBreaks(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i] as string
    i++
    if (c === 0x0a) {
      while (i < text.length && isSpace(text.charCodeAt(i))) i++
    }
  }
  return out
}

/** Sets the title from a `title` statement. */
export function timelineDbSetDiagramTitle(db: TimelineDb, text: string): void {
  db.title = text
}

/** Sets the accessible title, without leading whitespace. */
export function timelineDbSetAccTitle(db: TimelineDb, text: string): void {
  db.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its lines. */
export function timelineDbSetAccDescription(db: TimelineDb, text: string): void {
  db.accDescr = collapseBreaks(text)
}

/** Sets the direction: `LR` or `TD`. */
export function timelineDbSetDirection(db: TimelineDb, direction: string): void {
  db.direction = direction
}

/** Starts a section. */
export function timelineDbAddSection(db: TimelineDb, text: string): void {
  db.currentSection = text
  db.sections.push(text)
}

/** Adds a time period, with `event` as its first event when it is not empty. */
export function timelineDbAddTask(db: TimelineDb, period: string, event: string): void {
  const sectionIndex = db.sections.length - 1
  db.periods.push({
    events: event === '' ? [] : [event],
    section: db.currentSection,
    sectionIndex,
    text: period,
  })
}

/**
 * Adds an event to the last period.
 *
 * Throws a semantic error when no period came before. Mermaid fails here too, with a
 * `TypeError`.
 */
export function timelineDbAddEvent(db: TimelineDb, event: string): void {
  const period = db.periods[db.periods.length - 1]
  if (period === undefined) {
    const error: CompileError = errorNew(Code.Semantic, 'An event needs a time period before it.')
    error.type = 'timeline'
    throw error
  }
  period.events.push(event)
}
