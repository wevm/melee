/**
 * @module The gantt model and its scheduler: tasks, their references to each other, and excluded
 * days. Port of Pele's `src/diagrams/gantt/db.ts`.
 *
 * Pele's database reports unknown task references through an optional `warn` callback. Its
 * renderer never sets one, so the messages are not ported.
 */
import { Unit, WEEKDAYS, add, addDays, format, index, isValid, isoDate, parseStrict } from './dates.ts'
import { type Date, dateAddDays, dateSetHours, dateTime, dateWeekday, dateYear, parse as jsDateParse, timeClip } from './js_date.ts'
import { type GanttTask, ganttTaskDefault } from './types.ts'
import { Code, type CompileError, errorNew, pushU32 } from '../../error.ts'
import { trim, trimStart } from '../../text/label.ts'
import { isDigit, isSpace, isWord } from '../../util/chars.ts'
import { safeUrl } from '../../util/url.ts'
import { parse as parseFloat } from '../../util/float.ts'
import { buf } from '../../util/rust.ts'

/**
 * Scheduling walks tasks day by day and parses dates with a format the diagram supplies. This
 * bounds the total, in rough character operations, so a hostile diagram fails instead of hanging.
 */
const WORK_LIMIT = 4e8
/** The work of checking one day of a task. */
const DAY_STEP = 400.0
/** The work of matching one day against dated tokens. */
const DATED_STEP = 200.0
/** The base work of formatting one day in the chart's format. */
const FORMAT_STEP = 400.0

/**
 * The time to schedule against: the host's `now` when it is finite. Pele reads the clock
 * otherwise, which the compiler does not, so it counts from the epoch.
 */
export function clock(now: number | undefined): number {
  return now !== undefined && Number.isFinite(now) ? now : 0.0
}

/**
 * A duration such as `3d` or `1.5h`, as Mermaid reads one. NaN and milliseconds when the text is
 * not a duration.
 */
export function parseDuration(raw: string): [number, Unit] {
  const text = trim(raw)
  let digits = 0
  while (digits < text.length && isDigit(text.charCodeAt(digits))) digits++
  const none: [number, Unit] = [Number.NaN, Unit.Millisecond]
  if (digits === 0) {
    return none
  }
  let end = digits
  if (text.charCodeAt(end) === 0x2e) {
    let fraction = 0
    while (end + 1 + fraction < text.length && isDigit(text.charCodeAt(end + 1 + fraction))) fraction++
    if (fraction > 0) {
      end += 1 + fraction
    }
  }
  let unit: Unit
  switch (text.slice(end)) {
    case 'M':
      unit = Unit.Month
      break
    case 'd':
      unit = Unit.Day
      break
    case 'h':
      unit = Unit.Hour
      break
    case 'm':
      unit = Unit.Minute
      break
    case 's':
      unit = Unit.Second
      break
    case 'w':
      unit = Unit.Week
      break
    case 'y':
      unit = Unit.Year
      break
    case 'ms':
      unit = Unit.Millisecond
      break
    default:
      return none
  }
  const value = parseFloat(text.slice(0, end)) ?? Number.NaN
  return [value, unit]
}

/** Lowercases as JavaScript's `toLowerCase` does, except for the final form of sigma. */
function lowercase(text: string): string {
  // Rust lowercases each character alone, with no final-sigma rule.
  let out = ''
  for (const c of text) out += c.toLowerCase()
  return out
}

/** {@link WEEKDAYS}, lowercased. */
const WEEKDAYS_LOWER: string[] = WEEKDAYS.map(lowercase)

/**
 * `existing` with the tokens of `text`, lowercased and split on whitespace and commas, added in
 * order without repeats.
 */
function mergeTokens(existing: string[], text: string): string[] {
  const merged: string[] = []
  for (const token of existing) {
    if (!merged.includes(token)) {
      merged.push(token)
    }
  }
  const lower = lowercase(text)
  let start = 0
  const flush = (end: number): void => {
    const token = lower.slice(start, end)
    if (token !== '' && !merged.includes(token)) {
      merged.push(token)
    }
  }
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i)
    if (c === 0x2c || isSpace(c)) {
      flush(i)
      start = i + 1
    }
  }
  flush(lower.length)
  return merged
}

/** A semantic error about the gantt chart. */
function semantic(message: string): CompileError {
  const error = errorNew(Code.Semantic, message)
  error.type = 'gantt'
  return error
}

/** `Invalid date:` and the text. */
function invalidDate(text: string): CompileError {
  return semantic('Invalid date:' + text)
}

/** The UTF-16 length of `text`, as a work count. */
function units(text: string): number {
  return text.length
}

/** Whether a date format uses only numeric tokens and separators: `^[YMDHhmsSZXx\-/.:, T]*$`. */
function numericFormat(template: string): boolean {
  for (let i = 0; i < template.length; i++) {
    if (!'YMDHhmsSZXx-/.:, T'.includes(template[i] as string)) return false
  }
  return true
}

/** The id list of `after` or `until` at the start of `text`: `^word\s+([\d\w- ]+)`. */
function reference(text: string, word: string): string | undefined {
  if (!text.startsWith(word)) {
    return undefined
  }
  const rest = text.slice(word.length)
  // Every `\s` character is a single UTF-16 unit.
  let spaces = 0
  while (spaces < rest.length && isSpace(rest.charCodeAt(spaces))) spaces++
  if (spaces === 0) {
    return undefined
  }
  const idChar = (c: number): boolean => isWord(c) || c === 0x2d || c === 0x20
  const run = (from: number): string => {
    let end = from
    while (end < rest.length && idChar(rest.charCodeAt(end))) end++
    return rest.slice(from, end)
  }
  const ids = run(spaces)
  if (ids !== '') {
    return ids
  }
  // `\s+` gives characters back until the group can start on a space it took.
  for (let at = spaces - 1; at >= 1; at--) {
    if (rest.charCodeAt(at) === 0x20) {
      return run(at)
    }
  }
  return undefined
}

/** `+date` for a date that may be unset, as JavaScript compares `undefined`. */
function timeOf(date: Date | undefined): number {
  return date === undefined ? Number.NaN : dateTime(date)
}

/** The gantt model: what the source sets, plus scheduling state. Pele's `GanttDb`. */
export type GanttDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** The `axisFormat`, or empty. */
  axisFormat: string
  /** The `dateFormat`, or empty. */
  dateFormat: string
  /** `compact` packs a section's tasks onto shared rows. */
  displayMode: string
  /** Lowercased `excludes` tokens, without repeats. */
  excludes: string[]
  /** Whether `inclusiveEndDates` was given. */
  inclusiveEndDates: boolean
  /** Lowercased `includes` tokens, without repeats. */
  includes: string[]
  /** Link targets by task id, in insertion order. */
  links: [string, string][]
  /** Section names in order. */
  sections: string[]
  /** Tasks in source order. */
  tasks: GanttTask[]
  /** The `tickInterval`, when given. */
  tickInterval: string | undefined
  /** The diagram title. */
  title: string | undefined
  /** The `todayMarker` style, `off`, or empty. */
  todayMarker: string
  /** Whether `topAxis` was given. */
  topAxis: boolean
  /** The day week-based ticks start on, when the chart names one. */
  weekday: string | undefined
  /** The first day of the weekend: `friday` or `saturday`. */
  weekend: string

  /** Task indexes by id. A later task replaces an earlier one with the same id. */
  byId: Map<string, number>
  /** The section new tasks join. */
  currentSection: string
  /** Whether excluded or included days must be matched by date. */
  datedTokens: boolean
  /** `excludes`, for lookups while scheduling. */
  excludeSet: Set<string>
  /** Excluded weekdays, from Sunday. */
  excludedDays: boolean[]
  /** `includes`, for lookups while scheduling. */
  includeSet: Set<string>
  /** The row the next task takes. */
  lastOrder: number
  /** The id of the last task added. */
  lastTaskId: string | undefined
  /** The time scheduling runs against. */
  now: number
  /** The number of tasks given generated ids. */
  taskCount: number
  /** The work scheduling has done. */
  work: number
}

/** An empty model. */
export function ganttDbNew(): GanttDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    axisFormat: '',
    dateFormat: '',
    displayMode: '',
    excludes: [],
    inclusiveEndDates: false,
    includes: [],
    links: [],
    sections: [],
    tasks: [],
    tickInterval: undefined,
    title: undefined,
    todayMarker: '',
    topAxis: false,
    weekday: undefined,
    weekend: 'saturday',
    byId: new Map(),
    currentSection: '',
    datedTokens: false,
    excludeSet: new Set(),
    excludedDays: [false, false, false, false, false, false, false],
    includeSet: new Set(),
    lastOrder: 0,
    lastTaskId: undefined,
    now: 0,
    taskCount: 0,
    work: 0,
  }
}

/** Sets the `dateFormat`. */
export function ganttDbSetDateFormat(db: GanttDb, text: string): void {
  db.dateFormat = text
}

/** Adds `includes` tokens. */
export function ganttDbSetIncludes(db: GanttDb, text: string): void {
  db.includes = mergeTokens(db.includes, text)
}

/** Adds `excludes` tokens. */
export function ganttDbSetExcludes(db: GanttDb, text: string): void {
  db.excludes = mergeTokens(db.excludes, text)
}

/** Sets the accessible title, without leading whitespace. */
export function ganttDbSetAccTitle(db: GanttDb, text: string): void {
  db.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its lines. */
export function ganttDbSetAccDescription(db: GanttDb, text: string): void {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i++
    if (c === 0x0a) {
      // Every `\s` character is a single UTF-16 unit.
      while (i < text.length && isSpace(text.charCodeAt(i))) i++
    }
  }
  db.accDescr = out
}

/** Starts a section. */
export function ganttDbAddSection(db: GanttDb, text: string): void {
  db.currentSection = text
  db.sections.push(text)
}

/**
 * Adds a task from its label and data.
 *
 * Throws a semantic error when the data has no end or more than three fields, where Mermaid fails
 * with a `TypeError`.
 */
export function ganttDbAddTask(db: GanttDb, descr: string, dataText: string): void {
  const stripped = dataText.startsWith(':') ? dataText.slice(1) : dataText
  let data: string[] = stripped.split(',')
  const task: GanttTask = ganttTaskDefault()
  task.order = -1
  task.prevTaskId = db.lastTaskId
  task.raw.data = dataText
  task.section = db.currentSection
  task.task = descr

  while (data.length > 0) {
    const first = trim(data[0] as string)
    if (first === 'active') task.active = true
    else if (first === 'done') task.done = true
    else if (first === 'crit') task.crit = true
    else if (first === 'milestone') task.milestone = true
    else if (first === 'vert') task.vert = true
    else break
    data.shift()
  }
  if (data.length === 0) {
    throw semantic('Task "' + trim(descr) + '" needs a duration or an end date.')
  }
  if (data.length > 3) {
    throw semantic('Task "' + trim(descr) + '" has too many fields. A task takes an id, a start, and an end or duration.')
  }
  data = data.map(trim)

  if (data.length === 3) {
    task.id = data[0] as string
  } else {
    db.taskCount += 1
    const id = buf('task')
    pushU32(id, db.taskCount)
    task.id = id.s
  }
  if (data.length > 1) {
    task.raw.start = data[data.length - 2]
  }
  const last = data[data.length - 1]
  if (last !== undefined) {
    task.raw.end = last
  }

  if (!task.vert) {
    task.order = db.lastOrder
    db.lastOrder += 1
  }
  db.lastTaskId = task.id
  db.byId.set(task.id, db.tasks.length)
  db.tasks.push(task)
}

/** Links the listed tasks to `link` and marks them clickable. */
export function ganttDbSetLink(db: GanttDb, ids: string, link: string): void {
  const href = safeUrl(link)
  for (const id of ids.split(',')) {
    if (!db.byId.has(id)) {
      continue
    }
    const entry = db.links.find(([own]) => own === id)
    if (entry !== undefined) {
      entry[1] = href
    } else {
      db.links.push([id, href])
    }
  }
  ganttDbSetClass(db, ids, 'clickable')
}

/** Adds `class` to each listed task. */
export function ganttDbSetClass(db: GanttDb, ids: string, cls: string): void {
  for (const id of ids.split(',')) {
    const i = db.byId.get(id)
    const task = i === undefined ? undefined : db.tasks[i]
    if (task !== undefined) {
      task.classes.push(cls)
    }
  }
}

/** The task with `id`, the last one defined when several share it. */
function ganttDbFind(db: GanttDb, id: string): GanttTask | undefined {
  const i = db.byId.get(id)
  return i === undefined ? undefined : db.tasks[i]
}

/**
 * Resolves every task's start and end against `now`, from scratch on each call. A task may refer
 * to tasks defined after it, so, like Mermaid, this makes up to eleven passes, each of which
 * schedules every task again.
 *
 * Throws a semantic error for a start that is not a date, and a limit error when scheduling takes
 * too much work.
 */
export function ganttDbGetTasks(db: GanttDb, now: number): GanttTask[] {
  db.now = now
  db.work = 0.0
  db.includeSet = new Set(db.includes)
  db.excludeSet = new Set(db.excludes)
  const weekendStart = db.weekend === 'friday' ? 5 : db.weekend === 'saturday' ? 6 : -10
  const weekends = db.excludeSet.has('weekends')
  for (let day = 0; day < WEEKDAYS.length; day++) {
    const iso = day === 0 ? 7 : day
    db.excludedDays[day] =
      (weekends && (iso === weekendStart || iso === weekendStart + 1)) || db.excludeSet.has(WEEKDAYS_LOWER[day] as string)
  }
  // A date written with only these tokens and separators can never read as a weekday name, so
  // when nothing else is excluded or included there is no need to format each day.
  db.datedTokens = db.includes.length > 0 || !numericFormat(trim(db.dateFormat))
  for (const token of db.excludes) {
    if (token !== 'weekends' && !WEEKDAYS_LOWER.includes(token)) {
      db.datedTokens = true
    }
  }

  for (const task of db.tasks) {
    task.startTime = undefined
    task.endTime = undefined
    task.renderEndTime = undefined
    task.processed = false
    task.manualEndTime = false
  }

  let allProcessed = compileTasks(db)
  let pass = 0
  while (!allProcessed && pass < 10) {
    allProcessed = compileTasks(db)
    pass += 1
  }
  return db.tasks
}

/**
 * Whether a day is excluded. A day matches a token by its weekday name, by its date as
 * `YYYY-MM-DD`, or by its date written in the chart's own format.
 *
 * Throws a limit error when scheduling takes too much work.
 */
export function ganttDbIsInvalidDate(db: GanttDb, date: Date): boolean {
  const day = index(dateWeekday(date))
  const weekday = (day === undefined ? undefined : db.excludedDays[day]) ?? false
  if (!db.datedTokens) {
    return weekday
  }
  const template = trim(db.dateFormat)
  const dateOnly = isoDate(date)
  let formatted: string | undefined = dateOnly
  spend(db, DATED_STEP)
  if (template !== 'YYYY-MM-DD') {
    spend(db, FORMAT_STEP + units(template) * 8.0)
    formatted = format(date, template)
  }
  const listed = (set: Set<string>): boolean => set.has(dateOnly) || (formatted !== undefined && set.has(formatted))
  if (listed(db.includeSet)) {
    return false
  }
  return weekday || listed(db.excludeSet)
}

/** Counts `work`, and fails once the total passes the limit. */
function spend(db: GanttDb, work: number): void {
  db.work += work
  if (db.work > WORK_LIMIT) {
    const error = errorNew(Code.Limit, 'The gantt chart takes too much work to schedule.')
    error.type = 'gantt'
    throw error
  }
}

/** Parses `text` strictly with `template`, counting the work. */
function dbParse(db: GanttDb, text: string, template: string): Date | undefined {
  spend(db, (units(template) + 1.0) * (units(text) + 1.0))
  return parseStrict(text, template, db.now)
}

/** The start of the day of `now`. */
function today(db: GanttDb): Date {
  return dateSetHours(timeClip(db.now), 0.0, 0.0, 0.0, 0.0)
}

/** Schedules every task once. Whether all of them resolved. */
function compileTasks(db: GanttDb): boolean {
  let allProcessed = true
  for (let i = 0; i < db.tasks.length; i++) {
    compileTask(db, i)
    allProcessed = allProcessed && db.tasks[i]?.processed === true
  }
  return allProcessed
}

/** Schedules the task at `i` from its data and the tasks it refers to. */
function compileTask(db: GanttDb, i: number): void {
  const task = db.tasks[i]
  if (task === undefined) {
    return
  }
  const raw = { ...task.raw }
  const prev = task.prevTaskId

  // Rust's `Option<Option<Date>>`: whether to set the start, and to what.
  let setStart: boolean
  let startTime: Date | undefined
  if (raw.start === undefined) {
    // Mermaid fails with a TypeError when the first task has no start. It starts today here.
    const previous = prev === undefined ? undefined : ganttDbFind(db, prev)
    setStart = true
    startTime = previous !== undefined ? previous.endTime : today(db)
  } else {
    startTime = getStartDate(db, raw.start)
    setStart = startTime !== undefined
  }
  if (setStart) {
    task.startTime = startTime
  }
  const start = task.startTime
  if (start === undefined) {
    return
  }

  const endTime = getEndDate(db, start, raw.end)
  task.endTime = endTime
  if (endTime === undefined) {
    return
  }
  task.processed = true
  const manual = dbParse(db, raw.end, 'YYYY-MM-DD') !== undefined
  task.manualEndTime = manual
  checkTaskDates(db, i)
}

/** The tasks `list` names, skipping ids that do not exist. */
function references(db: GanttDb, list: string): number[] {
  const out: number[] = []
  for (const id of list.split(' ')) {
    if (id === '') continue
    const i = db.byId.get(id)
    if (i !== undefined) out.push(i)
  }
  return out
}

/** The start a task's start field gives, or `undefined` while what it refers to is unresolved. */
function getStartDate(db: GanttDb, raw: string): Date | undefined {
  const text = trim(raw)
  const template = trim(db.dateFormat)

  if ((template === 'x' || template === 'X') && text !== '' && allDigits(text)) {
    const date = timeClip(parseFloat(text) ?? Number.NaN)
    if (!isValid(date)) {
      throw invalidDate(text)
    }
    return date
  }

  const after = reference(text, 'after')
  if (after !== undefined) {
    let latest: GanttTask | undefined
    for (const i of references(db, after)) {
      const task = db.tasks[i]
      if (task === undefined) {
        continue
      }
      if (latest === undefined || timeOf(task.endTime) > timeOf(latest.endTime)) {
        latest = task
      }
    }
    return latest !== undefined ? latest.endTime : today(db)
  }

  const parsed = dbParse(db, text, template)
  if (parsed !== undefined) {
    return parsed
  }

  // What does not fit the format gets a second chance with the JavaScript date parser, as in
  // Mermaid.
  const date = jsDateParse(text)
  if (!isValid(date) || dateYear(date) < -10000.0 || dateYear(date) > 10000.0) {
    throw invalidDate(text)
  }
  return date
}

/** Whether every code unit of `text` is an ASCII digit. */
function allDigits(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!isDigit(text.charCodeAt(i))) return false
  }
  return true
}

/** The end a task's end field gives from `startTime`. */
function getEndDate(db: GanttDb, startTime: Date, raw: string): Date | undefined {
  const text = trim(raw)

  const until = reference(text, 'until')
  if (until !== undefined) {
    let earliest: GanttTask | undefined
    for (const i of references(db, until)) {
      const task = db.tasks[i]
      if (task === undefined) {
        continue
      }
      if (earliest === undefined || timeOf(task.startTime) < timeOf(earliest.startTime)) {
        earliest = task
      }
    }
    return earliest !== undefined ? earliest.startTime : today(db)
  }

  const template = trim(db.dateFormat)
  const parsed = dbParse(db, text, template)
  if (parsed !== undefined) {
    return db.inclusiveEndDates ? addDays(parsed, 1.0) : parsed
  }

  const [value, unit] = parseDuration(text)
  if (Number.isNaN(value)) {
    return startTime
  }
  const end = add(startTime, value, unit)
  return isValid(end) ? end : startTime
}

/** Pushes the end of a task out by one day for every excluded day it covers. */
function checkTaskDates(db: GanttDb, i: number): void {
  const task = db.tasks[i]
  if (task === undefined) {
    return
  }
  if (db.excludes.length === 0 || task.manualEndTime) {
    return
  }
  const start = task.startTime
  const end = task.endTime
  if (start === undefined || end === undefined) {
    return
  }

  let cursor = addDays(start, 1.0)
  let endTime = end
  const maxEndTime = dateTime(addDays(endTime, 10000.0))
  let invalid = false
  let renderEndTime: number | undefined
  while (dateTime(cursor) <= dateTime(endTime)) {
    spend(db, DAY_STEP)
    if (!invalid) {
      renderEndTime = dateTime(endTime)
    }
    invalid = ganttDbIsInvalidDate(db, cursor)
    if (invalid) {
      endTime = dateAddDays(endTime, 1.0)
      if (dateTime(endTime) > maxEndTime) {
        throw semantic('Failed to find a valid date that was not excluded by `excludes` after 10,000 iterations.')
      }
    }
    cursor = dateAddDays(cursor, 1.0)
  }

  task.endTime = endTime
  task.renderEndTime = renderEndTime
}
