/**
 * @module Time axis support, following d3-time and d3-time-format (English locale, local time),
 * which Mermaid uses: the `axisFormat` specifiers, tick intervals with d3's `every` rule, and its
 * choice of automatic ticks. Port of Pele's `src/diagrams/gantt/axis.ts`.
 */
import { MONTHS, WEEKDAYS, index, intString, jsMax, jsMin } from './dates.ts'
import {
  DAY,
  type Date,
  dateAddDays,
  dateDate,
  dateHours,
  dateMinutes,
  dateMonth,
  dateMs,
  dateSeconds,
  dateSetDate,
  dateSetFullYear,
  dateSetHours,
  dateSetMonth,
  dateSetTime,
  dateTime,
  dateWeekday,
  dateYear,
  timeClip,
} from './js_date.ts'

/** Milliseconds in a second. */
const SECOND = 1000.0
/** Milliseconds in a minute. */
const MINUTE = 60.0 * SECOND
/** Milliseconds in an hour. */
const HOUR = 60.0 * MINUTE
/** Milliseconds in a week. */
const WEEK = 7.0 * DAY
/** The approximate length of a month that d3 uses to choose ticks. */
const MONTH = 30.0 * DAY
/** The approximate length of a year that d3 uses to choose ticks. */
const YEAR = 365.0 * DAY

/** A calendar unit, as d3 names its intervals. */
type Unit =
  /** Days. */
  | { kind: 'Day' }
  /** Hours. */
  | { kind: 'Hour' }
  /** Milliseconds. */
  | { kind: 'Millisecond' }
  /** Minutes. */
  | { kind: 'Minute' }
  /** Months. */
  | { kind: 'Month' }
  /** Seconds. */
  | { kind: 'Second' }
  /** Weeks starting on the given weekday, 0 for Sunday. */
  | { kind: 'Week'; _0: number }
  /** Years. */
  | { kind: 'Year' }

const U_DAY: Unit = { kind: 'Day' }
const U_HOUR: Unit = { kind: 'Hour' }
const U_MILLISECOND: Unit = { kind: 'Millisecond' }
const U_MINUTE: Unit = { kind: 'Minute' }
const U_MONTH: Unit = { kind: 'Month' }
const U_SECOND: Unit = { kind: 'Second' }
const U_YEAR: Unit = { kind: 'Year' }

/** Weeks starting on `start`. */
function week(start: number): Unit {
  return { kind: 'Week', _0: start }
}

/** `d` moved back to the start of its unit. */
function unitFloor(self: Unit, d: Date): Date {
  switch (self.kind) {
    case 'Millisecond':
      return d
    case 'Second':
      return dateSetTime(d, dateTime(d) - dateMs(d))
    case 'Minute':
      return dateSetTime(d, dateTime(d) - dateMs(d) - dateSeconds(d) * SECOND)
    case 'Hour':
      return dateSetTime(d, dateTime(d) - dateMs(d) - dateSeconds(d) * SECOND - dateMinutes(d) * MINUTE)
    case 'Day':
      return dateSetHours(d, 0.0, 0.0, 0.0, 0.0)
    case 'Week': {
      const moved = dateSetDate(d, dateDate(d) - ((dateWeekday(d) + 7.0 - self._0) % 7.0))
      return dateSetHours(moved, 0.0, 0.0, 0.0, 0.0)
    }
    case 'Month':
      return dateSetHours(dateSetDate(d, 1.0), 0.0, 0.0, 0.0, 0.0)
    case 'Year':
      return dateSetHours(dateSetMonth(d, 0.0, 1.0), 0.0, 0.0, 0.0, 0.0)
  }
}

/** `d` moved forward by `step` units. */
function unitOffset(self: Unit, d: Date, step: number): Date {
  switch (self.kind) {
    case 'Millisecond':
      return dateSetTime(d, dateTime(d) + step)
    case 'Second':
      return dateSetTime(d, dateTime(d) + step * SECOND)
    case 'Minute':
      return dateSetTime(d, dateTime(d) + step * MINUTE)
    case 'Hour':
      return dateSetTime(d, dateTime(d) + step * HOUR)
    case 'Day':
      return dateAddDays(d, step)
    case 'Week':
      return dateAddDays(d, step * 7.0)
    case 'Month':
      return dateSetMonth(d, dateMonth(d) + step, undefined)
    case 'Year':
      return dateSetFullYear(d, dateYear(d) + step)
  }
}

/** The value d3 tests against a step: a tick falls where it is a multiple of the step. */
function unitField(self: Unit, d: Date): number {
  switch (self.kind) {
    case 'Second':
      return dateSeconds(d)
    case 'Minute':
      return dateMinutes(d)
    case 'Hour':
      return dateHours(d)
    case 'Day':
      return dateDate(d) - 1.0
    case 'Month':
      return dateMonth(d)
    default:
      return Number.NaN
  }
}

/** How many values `field` cycles through, which bounds how far apart filtered ticks are. */
function unitCycle(self: Unit): number {
  switch (self.kind) {
    case 'Second':
    case 'Minute':
      return 60.0
    case 'Hour':
      return 24.0
    case 'Day':
      return 31.0
    case 'Month':
      return 12.0
    default:
      return Number.POSITIVE_INFINITY
  }
}

/** The approximate length of the unit in milliseconds. */
function unitMs(self: Unit): number {
  switch (self.kind) {
    case 'Millisecond':
      return 1.0
    case 'Second':
      return SECOND
    case 'Minute':
      return MINUTE
    case 'Hour':
      return HOUR
    case 'Day':
      return DAY
    case 'Week':
      return WEEK
    case 'Month':
      return MONTH
    case 'Year':
      return YEAR
  }
}

/** The interval d3's `unit.every(step)` gives. */
type Calendar =
  /** The unit itself. */
  | { kind: 'Base'; _0: Unit }
  /** Values of the unit's field that are multiples of the step. */
  | { kind: 'Filtered'; _0: Unit; _1: number }
  /** Multiples of the step since the epoch. */
  | { kind: 'Millis'; _0: number }
  /** Every `step` weeks, counted from the week of the epoch. */
  | { kind: 'Weeks'; _0: Unit; _1: number; _2: Date }
  /** Years that are multiples of the step. */
  | { kind: 'Years'; _0: number }

/** The unit the interval counts in. */
function calendarUnit(self: Calendar): Unit {
  switch (self.kind) {
    case 'Base':
    case 'Filtered':
    case 'Weeks':
      return self._0
    case 'Millis':
      return U_MILLISECOND
    case 'Years':
      return U_YEAR
  }
}

/** `d` moved back to the latest tick at or before it. */
function calendarFloor(self: Calendar, d: Date): Date {
  switch (self.kind) {
    case 'Base':
      return unitFloor(self._0, d)
    case 'Millis':
      return dateSetTime(d, Math.floor(dateTime(d) / self._0) * self._0)
    case 'Years': {
      const moved = dateSetFullYear(d, Math.floor(dateYear(d) / self._0) * self._0)
      return unitFloor(U_YEAR, moved)
    }
    case 'Weeks': {
      const floored = unitFloor(self._0, d)
      return unitOffset(self._0, floored, -modulo(span(self._2, floored, WEEK), self._1))
    }
    case 'Filtered': {
      // Date overflow makes the field NaN, which can never match the interval.
      const unit = self._0
      const step = self._1
      let out = unitFloor(unit, d)
      while (Number.isFinite(dateTime(out)) && unitField(unit, out) % step !== 0.0) {
        out = dateSetTime(out, dateTime(out) - 1.0)
        out = unitFloor(unit, out)
      }
      return out
    }
  }
}

/** `d` moved forward by `n` ticks. */
function calendarOffset(self: Calendar, d: Date, n: number): Date {
  switch (self.kind) {
    case 'Base':
      return unitOffset(self._0, d, n)
    case 'Millis':
      return dateSetTime(d, dateTime(d) + n * self._0)
    case 'Years':
      return dateSetFullYear(d, dateYear(d) + n * self._0)
    case 'Weeks':
      return unitOffset(self._0, d, n * self._1)
    case 'Filtered': {
      const unit = self._0
      const step = self._1
      let out = d
      let i = 0.0
      while (i < n && Number.isFinite(dateTime(out))) {
        for (;;) {
          out = unitOffset(unit, out, 1.0)
          if (!(Number.isFinite(dateTime(out)) && unitField(unit, out) % step !== 0.0)) {
            break
          }
        }
        i += 1.0
      }
      return out
    }
  }
}

/** Whole units between two floored dates. The UTC offset never changes in UTC. */
function span(start: Date, end: Date, unit: number): number {
  return Math.floor((dateTime(end) - dateTime(start)) / unit)
}

/** The remainder of `a` by `b`, with the sign of `b`. */
function modulo(a: number, b: number): number {
  return ((a % b) + b) % b
}

/** The interval d3's `unit.every(step)` gives. */
function every(unit: Unit, step: number): Calendar {
  if (step <= 1.0) {
    return { kind: 'Base', _0: unit }
  }
  switch (unit.kind) {
    case 'Millisecond':
      return { kind: 'Millis', _0: step }
    case 'Year':
      return { kind: 'Years', _0: step }
    case 'Week': {
      const epoch = unitFloor(unit, 0.0)
      return { kind: 'Weeks', _0: unit, _1: step, _2: epoch }
    }
    default:
      return { kind: 'Filtered', _0: unit, _1: step }
  }
}

/** Ticks from `start` to `stop` inclusive, or `undefined` when there would be more than `limit`. */
function range(calendar: Calendar, start: number, stop: number, limit: number): number[] | undefined {
  let d = timeClip(start - 1.0)
  d = calendarFloor(calendar, d)
  d = calendarOffset(calendar, d, 1.0)
  d = calendarFloor(calendar, d)
  const out: number[] = []
  let previous = Number.NEGATIVE_INFINITY
  while (dateTime(d) <= stop && dateTime(d) > previous) {
    if (out.length >= limit) {
      return undefined
    }
    previous = dateTime(d)
    out.push(previous)
    d = calendarOffset(calendar, d, 1.0)
    d = calendarFloor(calendar, d)
  }
  return out
}

/** d3's `tickStep`: a round step that splits the range into about `count` parts. */
function tickStep(start: number, stop: number, count: number): number {
  const step = (stop - start) / jsMax(0.0, count)
  const power = Math.floor(Math.log10(step))
  const error = step / Math.pow(10, power)
  const factor = error >= Math.sqrt(50) ? 10.0 : error >= Math.sqrt(10) ? 5.0 : error >= Math.SQRT2 ? 2.0 : 1.0
  return Math.pow(10, power) * factor
}

/** d3's automatic intervals: unit, step, and approximate length. */
const AUTO: [Unit, number, number][] = [
  [U_SECOND, 1.0, SECOND],
  [U_SECOND, 5.0, 5.0 * SECOND],
  [U_SECOND, 15.0, 15.0 * SECOND],
  [U_SECOND, 30.0, 30.0 * SECOND],
  [U_MINUTE, 1.0, MINUTE],
  [U_MINUTE, 5.0, 5.0 * MINUTE],
  [U_MINUTE, 15.0, 15.0 * MINUTE],
  [U_MINUTE, 30.0, 30.0 * MINUTE],
  [U_HOUR, 1.0, HOUR],
  [U_HOUR, 3.0, 3.0 * HOUR],
  [U_HOUR, 6.0, 6.0 * HOUR],
  [U_HOUR, 12.0, 12.0 * HOUR],
  [U_DAY, 1.0, DAY],
  [U_DAY, 2.0, 2.0 * DAY],
  [week(0.0), 1.0, WEEK],
  [U_MONTH, 1.0, MONTH],
  [U_MONTH, 3.0, 3.0 * MONTH],
  [U_YEAR, 1.0, YEAR],
]

/** About `count` ticks at round times, chosen the way d3's time scale chooses them. */
export function autoTicks(start: number, stop: number, count: number): number[] {
  const target = (stop - start) / count
  let i = AUTO.findIndex(([, , ms]) => ms > target || Number.isNaN(target))
  if (i < 0) i = AUTO.length
  const before = i >= 1 ? AUTO[i - 1] : undefined
  const after = AUTO[i]
  let calendar: Calendar
  if (after === undefined) {
    calendar = every(U_YEAR, jsMax(1.0, tickStep(start / YEAR, stop / YEAR, count)))
  } else if (before === undefined) {
    calendar = every(U_MILLISECOND, jsMax(tickStep(start, stop, count), 1.0))
  } else {
    const [unit, step] = target / before[2] < after[2] / target ? before : after
    calendar = every(unit, step)
  }
  return range(calendar, start, stop, 4.0 * count + 8.0) ?? []
}

/** The interval units `tickInterval` accepts. */
const INTERVALS: [string, Unit][] = [
  ['millisecond', U_MILLISECOND],
  ['second', U_SECOND],
  ['minute', U_MINUTE],
  ['hour', U_HOUR],
  ['day', U_DAY],
  ['week', week(0.0)],
  ['month', U_MONTH],
]

/** The days a week can start on, from Sunday. */
const WEEK_STARTS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Ticks for a `tickInterval` such as `1week`, or `undefined` when it is not one or asks for more
 * than `limit`.
 */
export function intervalTicks(
  interval: string,
  weekday: string,
  start: number,
  stop: number,
  limit: number,
): number[] | undefined {
  // `^([1-9]\d*)(millisecond|second|...|month)$`.
  let digits = 0
  while (digits < interval.length) {
    const c = interval.charCodeAt(digits)
    if (c < 48 || c > 57) break
    digits++
  }
  if (digits === 0 || interval.startsWith('0')) {
    return undefined
  }
  const name = interval.slice(digits)
  const found = INTERVALS.find(([own]) => own === name)
  if (found === undefined) {
    return undefined
  }
  const step = Number(interval.slice(0, digits))
  let unit = found[1]
  if (unit.kind === 'Week') {
    const start = WEEK_STARTS.indexOf(weekday)
    unit = week(start < 0 ? 0 : start)
  }
  const calendar = every(unit, step)
  const base = calendarUnit(calendar)
  if ((stop - start) / (jsMin(step, unitCycle(base)) * unitMs(base)) > limit) {
    return undefined
  }
  return range(calendar, start, stop, limit)
}

/** `String(value)` with a sign, padded to `width` with `fill`, as d3-time-format pads. */
function pad(value: number, fill: string, width: number): string {
  const negative = value < 0.0
  const digits = intString(negative ? -value : value)
  let out = negative ? '-' : ''
  const length = digits.length
  if (length < width) {
    out += fill.repeat(width - length)
  }
  return out + digits
}

/** A copy of `date` at the start of its `unit`. */
function floored(date: Date, unit: Unit): Date {
  return unitFloor(unit, date)
}

/** Weeks since the last `weekStart` day before the year began: d3's `%U` and `%W`. */
function weekOfYear(date: Date, weekStart: number): number {
  const w = week(weekStart)
  const yearStart = floored(date, U_YEAR)
  return span(floored(timeClip(dateTime(yearStart) - 1.0), w), floored(date, w), WEEK)
}

/** The Thursday that decides which ISO week and ISO year a date belongs to. */
function isoThursday(date: Date): Date {
  const thursday = week(4.0)
  const day = dateWeekday(date)
  const late = day >= 4.0 || day === 0.0
  let d = floored(late ? date : timeClip(dateTime(date) - 1.0), thursday)
  if (!late) {
    d = unitOffset(thursday, d, 1.0)
    d = unitFloor(thursday, d)
  }
  return d
}

/** Formats a date with a d3 time format specifier such as `%Y-%m-%d`. */
export function timeFormat(specifier: string, date: Date): string {
  const out = { s: '' }
  const chars = Array.from(specifier)
  let i = 0
  while (i < chars.length) {
    const c = chars[i++] as string
    if (c !== '%') {
      out.s += c
      continue
    }
    let next = chars[i++]
    let fill: string | undefined
    if (next === '-') fill = ''
    else if (next === '_') fill = ' '
    else if (next === '0') fill = '0'
    if (fill !== undefined) {
      next = chars[i++]
    } else if (next === 'e') {
      fill = ' '
    } else {
      fill = '0'
    }
    if (next !== undefined) {
      directive(out, next, date, fill)
    }
  }
  return out.s
}

/** The name at `value` in `names`, or an empty string. */
function name(names: string[], value: number): string {
  const i = index(value)
  return (i === undefined ? undefined : names[i]) ?? ''
}

/** Appends the d3 directive `c` for `d`, padded with `p`. */
function directive(out: { s: string }, c: string, d: Date, p: string): void {
  let text: string
  switch (c) {
    case 'a':
      text = name(WEEKDAYS, dateWeekday(d)).slice(0, 3)
      break
    case 'A':
      text = name(WEEKDAYS, dateWeekday(d))
      break
    case 'b':
      text = name(MONTHS, dateMonth(d)).slice(0, 3)
      break
    case 'B':
      text = name(MONTHS, dateMonth(d))
      break
    case 'c':
      text = timeFormat('%x, %X', d)
      break
    case 'd':
    case 'e':
      text = pad(dateDate(d), p, 2)
      break
    case 'f':
      text = pad(dateMs(d), p, 3) + '000'
      break
    case 'g':
      text = pad(dateYear(isoThursday(d)) % 100.0, p, 2)
      break
    case 'G':
      text = pad(dateYear(isoThursday(d)) % 10000.0, p, 4)
      break
    case 'H':
      text = pad(dateHours(d), p, 2)
      break
    case 'I':
      text = pad(twelve(dateHours(d)), p, 2)
      break
    case 'j':
      text = pad(1.0 + span(floored(d, U_YEAR), floored(d, U_DAY), DAY), p, 3)
      break
    case 'L':
      text = pad(dateMs(d), p, 3)
      break
    case 'm':
      text = pad(dateMonth(d) + 1.0, p, 2)
      break
    case 'M':
      text = pad(dateMinutes(d), p, 2)
      break
    case 'p':
      text = dateHours(d) >= 12.0 ? 'PM' : 'AM'
      break
    case 'q':
      text = intString(1.0 + Math.floor(dateMonth(d) / 3.0))
      break
    case 'Q':
      text = intString(dateTime(d))
      break
    case 's':
      text = intString(Math.floor(dateTime(d) / 1000.0))
      break
    case 'S':
      text = pad(dateSeconds(d), p, 2)
      break
    case 'u':
      text = intString(dateWeekday(d) === 0.0 ? 7.0 : dateWeekday(d))
      break
    case 'U':
      text = pad(weekOfYear(d, 0.0), p, 2)
      break
    case 'V': {
      const thursday = isoThursday(d)
      const yearStart = floored(thursday, U_YEAR)
      const first = floored(yearStart, week(4.0))
      const extra = index(dateWeekday(yearStart)) === 4 ? 1.0 : 0.0
      text = pad(span(first, thursday, WEEK) + extra, p, 2)
      break
    }
    case 'w':
      text = intString(dateWeekday(d))
      break
    case 'W':
      text = pad(weekOfYear(d, 1.0), p, 2)
      break
    case 'x':
      text = timeFormat('%-m/%-d/%Y', d)
      break
    case 'X':
      text = timeFormat('%-I:%M:%S %p', d)
      break
    case 'y':
      text = pad(dateYear(d) % 100.0, p, 2)
      break
    case 'Y':
      text = pad(dateYear(d) % 10000.0, p, 4)
      break
    // The UTC offset is always zero.
    case 'Z':
      text = '+0000'
      break
    case '%':
      text = '%'
      break
    default:
      out.s += c
      return
  }
  out.s += text
}

/** The hour on a twelve-hour clock. */
function twelve(hours: number): number {
  const h = hours % 12.0
  return h === 0.0 || Number.isNaN(h) ? 12.0 : h
}
