/** @module The user journey database. Port of Pele's `src/diagrams/journey/db.ts`. */
import { trim, trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { parse } from '../../util/float.ts'

/** A task: its score and the people taking part. */
export type JourneyTask = {
  /** The actors, as written. */
  people: string[]
  /** As written: any number, or NaN when the score is not one. */
  score: number
  /** Name of the section in force when the task was declared, empty before the first one. */
  section: string
  /** The task's name. */
  task: string
}

/** `JourneyTask::default()`. */
export function journeyTaskDefault(): JourneyTask {
  return { people: [], score: 0, section: '', task: '' }
}

/** The parsed user journey: Pele's `JourneyDb`. */
export type JourneyDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  currentSection: string
  /** The section names, in source order. */
  sections: string[]
  /** The tasks, in source order. */
  tasks: JourneyTask[]
  /** The title. */
  title: string | undefined
}

/** `JourneyDb::default()`. */
export function journeyDbDefault(): JourneyDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    currentSection: '',
    sections: [],
    tasks: [],
    title: undefined,
  }
}

/** Everyone named on a task, once each, in UTF-16 code unit order. */
export function journeyActors(tasks: JourneyTask[]): string[] {
  const names: string[] = []
  for (const task of tasks) {
    for (const name of task.people) {
      if (!names.includes(name)) names.push(name)
    }
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return names
}

/** The value of `c` as a digit in `radix`, as `char::to_digit` reads it. */
function toDigit(c: number, radix: number): number | undefined {
  let digit: number
  if (c >= 0x30 && c <= 0x39) digit = c - 0x30
  else if (c >= 0x61 && c <= 0x7a) digit = c - 0x61 + 10
  else if (c >= 0x41 && c <= 0x5a) digit = c - 0x41 + 10
  else return undefined
  return digit < radix ? digit : undefined
}

/** Whether `c` is an ASCII digit. */
function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

/** JavaScript's `StringToNumber`. */
function stringToNumber(raw: string): number {
  const text = trim(raw)
  if (text === '') return 0

  if (text.charCodeAt(0) === 0x30 && text.length > 1) {
    const prefix = text.charCodeAt(1)
    const radix = prefix === 0x78 || prefix === 0x58 ? 16 : prefix === 0x6f || prefix === 0x4f ? 8 : prefix === 0x62 || prefix === 0x42 ? 2 : 0
    if (radix !== 0) {
      const digits = text.slice(2)
      if (digits === '') return Number.NaN
      let value = 0
      for (const c of digits) {
        const digit = toDigit(c.codePointAt(0) as number, radix)
        if (digit === undefined) return Number.NaN
        value = value * radix + digit
      }
      return value
    }
  }

  const unsigned = text.startsWith('+') || text.startsWith('-') ? text.slice(1) : text
  if (unsigned === 'Infinity') {
    return text.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  }

  // StrDecimalLiteral: digits with an optional fraction, then an optional exponent.
  const b = unsigned
  let i = 0
  let digits = 0
  while (i < b.length && isAsciiDigit(b.charCodeAt(i))) {
    i++
    digits++
  }
  if (b.charCodeAt(i) === 0x2e) {
    i++
    while (i < b.length && isAsciiDigit(b.charCodeAt(i))) {
      i++
      digits++
    }
  }
  if (digits === 0) return Number.NaN
  if (b.charCodeAt(i) === 0x65 || b.charCodeAt(i) === 0x45) {
    i++
    if (b.charCodeAt(i) === 0x2b || b.charCodeAt(i) === 0x2d) i++
    const start = i
    while (i < b.length && isAsciiDigit(b.charCodeAt(i))) i++
    if (i === start) return Number.NaN
  }
  if (i !== b.length) return Number.NaN
  return parse(text) ?? Number.NaN
}

/**
 * `text.replace(/\n\s+/g, '\n')`: each line break followed by whitespace, line breaks included,
 * becomes one line break.
 */
function collapseBreaks(text: string): string {
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
export function journeyDbSetDiagramTitle(db: JourneyDb, text: string): void {
  db.title = text
}

/** Sets the accessible title, without leading whitespace. */
export function journeyDbSetAccTitle(db: JourneyDb, text: string): void {
  db.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its lines. */
export function journeyDbSetAccDescription(db: JourneyDb, text: string): void {
  db.accDescr = collapseBreaks(text)
}

/** Starts a section. */
export function journeyDbAddSection(db: JourneyDb, text: string): void {
  db.currentSection = text
  db.sections.push(text)
}

/**
 * Adds a task. `data` is the rest of the line from its first colon: `:score` or
 * `:score:actor, actor`.
 */
export function journeyDbAddTask(db: JourneyDb, task: string, data: string): void {
  // `data.slice(1).split(':')`: the score is the first piece and the actors the second.
  const first = data.indexOf(':', 1)
  const score = stringToNumber(first < 0 ? data.slice(1) : data.slice(1, first))
  const people: string[] = []
  if (first >= 0) {
    const second = data.indexOf(':', first + 1)
    const end = second < 0 ? data.length : second
    let from = first + 1
    for (;;) {
      const comma = data.indexOf(',', from)
      if (comma < 0 || comma >= end) {
        people.push(trim(data.slice(from, end)))
        break
      }
      people.push(trim(data.slice(from, comma)))
      from = comma + 1
    }
  }
  db.tasks.push({ people, score, section: db.currentSection, task })
}
