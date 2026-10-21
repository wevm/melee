/**
 * @module The parts of dayjs 1.11 that Mermaid's gantt code relies on, with the plugins it loads
 * (custom parse format, advanced format, ISO week) and the English locale: strict parsing against
 * a format, formatting, and calendar arithmetic, all in local time (UTC here). Quirks are kept,
 * because a date is accepted only when formatting the parsed result gives back the input. Port of
 * Pele's `src/diagrams/gantt/dates.ts`.
 */
import {
  DAY,
  type Date,
  dateAddDays,
  dateCalendar,
  dateDate,
  dateHours,
  dateIsValid,
  dateLocal,
  dateMinutes,
  dateMonth,
  dateMs,
  dateSeconds,
  dateSetDate,
  dateSetFullYear,
  dateSetHours,
  dateSetMonth,
  dateTime,
  dateWeekday,
  dateYear,
  timeClip,
  utc,
} from './js_date.ts'
import { isDigit, isSpace } from '../../util/chars.ts'
import { pushNumber } from '../../yaml.ts'
import { jsRound as builderJsRound } from '../../svg/builder.ts'
import { parse as parseFloat } from '../../util/float.ts'
import { type Buf, buf } from '../../util/rust.ts'

/** English month names. */
export const MONTHS: string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
/** English weekday names, from Sunday. */
export const WEEKDAYS: string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A milliseconds-per-week constant. */
const WEEK = 7.0 * DAY

/** A duration unit, as dayjs names it. */
export const Unit = {
  /** `d`. */
  Day: 'Day',
  /** `h`. */
  Hour: 'Hour',
  /** `ms`. */
  Millisecond: 'Millisecond',
  /** `m`. */
  Minute: 'Minute',
  /** `M`. */
  Month: 'Month',
  /** `s`. */
  Second: 'Second',
  /** `w`. */
  Week: 'Week',
  /** `y`. */
  Year: 'Year',
} as const
export type Unit = (typeof Unit)[keyof typeof Unit]

/** Appends a number as `String(value)` writes it. */
export function pushInt(out: Buf, value: number): void {
  pushNumber(out, value)
}

/** `String(value)`. */
export function intString(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

/** `String(value)` padded with leading zeros to `length`, as dayjs pads, sign included. */
function pad(value: number, length: number): string {
  const s = intString(value)
  const count = s.length
  if (count >= length) {
    return s
  }
  return '0'.repeat(length - count) + s
}

/** Ordinal suffixes, indexed as dayjs indexes them. */
const SUFFIX = ['th', 'st', 'nd', 'rd']

/** `n` with its English ordinal suffix, such as `1st`. */
function ordinal(n: number): string {
  const v = n % 100.0
  const pick = (index: number): string | undefined => {
    if (index >= 0.0 && index < 4.0 && index % 1 === 0) {
      return SUFFIX[index]
    }
    return undefined
  }
  const suffix = pick((v - 20.0) % 10.0) ?? pick(v) ?? 'th'
  return intString(n) + suffix
}

/** `+00:00`: the zone of every date, since local time is UTC. */
function zone(): string {
  return '+00:00'
}

/** `isValid`. */
export function isValid(date: Date): boolean {
  return dateIsValid(date)
}

/** The ISO weekday: 1 for Monday to 7 for Sunday. */
export function isoWeekday(date: Date): number {
  const day = dateWeekday(date)
  return day === 0.0 || Number.isNaN(day) ? 7.0 : day
}

/** A copy of `date` moved by `days` calendar days. */
export function addDays(date: Date, days: number): Date {
  return dateAddDays(date, days)
}

/** The number of days in the month of `date`. */
function daysInMonth(date: Date): number {
  let last = dateLocal(dateYear(date), dateMonth(date) + 1.0, 0.0, 0.0, 0.0, 0.0, 0.0)
  last = dateSetHours(last, 23.0, 59.0, 59.0, 999.0)
  return dateDate(last)
}

/** Sets the month or the year, keeping the day of the month unless the new month is shorter. */
function setCalendar(date: Date, apply: (d: Date) => Date): Date {
  let next = date
  next = dateSetDate(next, 1.0)
  next = apply(next)
  next = dateSetDate(next, jsMin(dateDate(date), daysInMonth(next)))
  return next
}

/** `date` plus `amount` of `unit`, as dayjs adds. */
export function add(date: Date, amount: number, unit: Unit): Date {
  const time = dateTime(date)
  switch (unit) {
    case Unit.Month:
      return setCalendar(date, (d) => dateSetMonth(d, dateMonth(date) + amount, undefined))
    case Unit.Year:
      return setCalendar(date, (d) => dateSetFullYear(d, dateYear(date) + amount))
    case Unit.Day:
      return addDays(date, jsRound(amount))
    case Unit.Week:
      return addDays(date, jsRound(7.0 * amount))
    case Unit.Hour:
      return timeClip(time + amount * 3_600_000.0)
    case Unit.Minute:
      return timeClip(time + amount * 60_000.0)
    case Unit.Second:
      return timeClip(time + amount * 1000.0)
    case Unit.Millisecond:
      return timeClip(time + amount)
  }
}

/** `Math.min` of two numbers: NaN when either is. */
export function jsMin(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.NaN
  }
  return a < b ? a : b
}

/** `Math.max` of two numbers: NaN when either is. */
export function jsMax(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.NaN
  }
  return a > b ? a : b
}

/** `Math.round`, with NaN kept. */
function jsRound(value: number): number {
  if (Number.isNaN(value)) {
    return value
  }
  return builderJsRound(value)
}

/** The Thursday of the ISO week of `date`. */
function weekThursday(date: Date): Date {
  return addDays(date, 4.0 - isoWeekday(date))
}

/** The ISO week number of `date`. */
function isoWeek(date: Date): number {
  const thursday = weekThursday(date)
  const jan1 = dateLocal(dateYear(thursday), 0.0, 1.0, 0.0, 0.0, 0.0, 0.0)
  const weekday = isoWeekday(jan1)
  const first = addDays(jan1, 4.0 - weekday + (weekday > 4.0 ? 7.0 : 0.0))
  const weeks = (dateTime(thursday) - dateTime(first)) / WEEK
  const whole = weeks < 0.0 ? Math.ceil(weeks) + 0.0 : Math.floor(weeks)
  return whole + 1.0
}

/** Code units of `text` from `at` that equal `word`. */
function starts(units: string, at: number, word: string): boolean {
  return units.startsWith(word, at)
}

/** A `[...]` literal at `at`, as `\[([^\]]+)]` matches it: its end, after the `]`. */
function bracket(units: string, at: number): number | undefined {
  if (units.charCodeAt(at) !== 0x5b) {
    return undefined
  }
  const close = units.indexOf(']', at + 1)
  if (close < 0) {
    return undefined
  }
  return close > at + 1 ? close + 1 : undefined
}

/** The longest of `words` at `at`, in the order given: the first that matches wins. */
function firstOf(units: string, at: number, words: readonly string[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string
    if (units.startsWith(word, at)) return word
  }
  return undefined
}

/** The advanced-format tokens, in `RE_ADVANCED` alternation order after the bracket literal. */
const ADVANCED = ['Q', 'wo', 'ww', 'w', 'WW', 'W', 'zzz', 'z', 'gggg', 'GGGG', 'Do', 'X', 'x', 'kk', 'k', 'S']

/**
 * The format tokens, in `RE_FORMAT` alternation order after the bracket literal, with each
 * `{1,n}` repetition written longest first.
 */
const FORMAT = [
  'YYYY',
  'YY',
  'MMMM',
  'MMM',
  'MM',
  'M',
  'DD',
  'D',
  'dddd',
  'ddd',
  'dd',
  'd',
  'HH',
  'H',
  'hh',
  'h',
  'a',
  'A',
  'mm',
  'm',
  'ss',
  's',
  'ZZ',
]

/**
 * `date` formatted with a dayjs `template`. `undefined` for the week-of-year and time zone name
 * tokens, which need dayjs plugins Mermaid does not load and so fail there.
 */
export function format(date: Date, template: string): string | undefined {
  if (!dateIsValid(date)) {
    return 'Invalid Date'
  }
  const tpl = template === '' ? 'YYYY-MM-DDTHH:mm:ssZ' : template
  if (tpl === 'YYYY-MM-DD') {
    return isoDate(date)
  }

  let plan = PLANS.get(tpl)
  if (plan === undefined) {
    plan = plainFormat(tpl) ? formatPlan(tpl) : null
    if (tpl.length <= 256) {
      if (PLANS.size >= COMPILED_LIMIT) PLANS.clear()
      PLANS.set(tpl, plan)
    }
  }
  if (plan !== null) return formatSteps(date, plan)

  const advanced = advancedFormat(date, tpl)
  return advanced === undefined ? undefined : formatSteps(date, formatPlan(advanced))
}

/**
 * A format's second pass as steps: literal text, or a {@link FORMAT} token (or `SSS` or `Z`) to
 * replace.
 */
type FormatStep = {
  /** Whether {@link text} is literal text rather than a token. */
  literal: boolean
  /** The text or the token. */
  text: string
}

/**
 * Second-pass plans by template, for templates the first pass leaves as they are; `null` for
 * the others. Cleared when full.
 */
const PLANS = new Map<string, FormatStep[] | null>()

/** Whether the advanced-format pass leaves `units` as it is: it holds no token that pass replaces. */
function plainFormat(units: string): boolean {
  let at = 0
  while (at < units.length) {
    const end = bracket(units, at)
    if (end !== undefined) {
      at = end
      continue
    }
    const token = firstOf(units, at, ADVANCED)
    if (token === undefined) {
      at += 1
      continue
    }
    // `S` is replaced by itself.
    if (token !== 'S') return false
    at += token.length
  }
  return true
}

/** The advanced-format pass over `units` for `date`, or `undefined` for a token dayjs fails on. */
function advancedFormat(date: Date, units: string): string | undefined {
  let advanced = ''
  let at = 0
  while (at < units.length) {
    const end = bracket(units, at)
    if (end !== undefined) {
      advanced += units.slice(at, end)
      at = end
      continue
    }
    const token = firstOf(units, at, ADVANCED)
    if (token === undefined) {
      advanced += units[at]
      at += 1
      continue
    }
    at += token.length
    let replaced: string
    switch (token) {
      case 'Q':
        replaced = intString(Math.ceil((dateMonth(date) + 1.0) / 3.0))
        break
      case 'Do':
        replaced = `[${ordinal(dateDate(date))}]`
        break
      case 'GGGG':
        replaced = intString(dateYear(weekThursday(date)))
        break
      case 'W':
        replaced = intString(isoWeek(date))
        break
      case 'WW':
        replaced = pad(isoWeek(date), 2)
        break
      case 'k':
        replaced = intString(dateHours(date) === 0.0 ? 24.0 : dateHours(date))
        break
      case 'kk':
        replaced = pad(dateHours(date) === 0.0 ? 24.0 : dateHours(date), 2)
        break
      case 'X':
        replaced = intString(Math.floor(dateTime(date) / 1000.0))
        break
      case 'x':
        replaced = intString(dateTime(date))
        break
      case 'gggg':
      case 'wo':
      case 'w':
      case 'ww':
      case 'z':
      case 'zzz':
        return undefined
      default:
        replaced = token
    }
    advanced += replaced
  }
  return advanced
}

/** The second pass's steps over the text the advanced-format pass gives. */
function formatPlan(advanced: string): FormatStep[] {
  const steps: FormatStep[] = []
  let literal = ''
  let at = 0
  while (at < advanced.length) {
    const end = bracket(advanced, at)
    if (end !== undefined) {
      literal += advanced.slice(at + 1, end - 1)
      at = end
      continue
    }
    const token = starts(advanced, at, 'SSS')
      ? 'SSS'
      : (firstOf(advanced, at, FORMAT) ?? (starts(advanced, at, 'Z') ? 'Z' : undefined))
    if (token === undefined) {
      literal += advanced[at]
      at += 1
      continue
    }
    if (literal !== '') {
      steps.push({ literal: true, text: literal })
      literal = ''
    }
    at += token.length
    steps.push({ literal: false, text: token })
  }
  if (literal !== '') steps.push({ literal: true, text: literal })
  return steps
}

/** The second pass for a valid `date`: its fields in place of the tokens of `steps`. */
function formatSteps(date: Date, steps: FormatStep[]): string {
  dateCalendar(date, calendar)
  const year = calendar[0] as number
  const month = calendar[1] as number
  const day = calendar[2] as number
  const weekday = dateWeekday(date)
  const hours = dateHours(date)
  let out = ''
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as FormatStep
    const token = step.text
    if (step.literal) {
      out += token
      continue
    }
    let text: string
    switch (token) {
      case 'YY': {
        const y = intString(year)
        text = y.slice(Math.max(0, y.length - 2))
        break
      }
      case 'YYYY':
        text = pad(year, 4)
        break
      case 'M':
        text = intString(month + 1.0)
        break
      case 'MM':
        text = pad(month + 1.0, 2)
        break
      case 'MMM':
        text = monthNameOf(month).slice(0, 3)
        break
      case 'MMMM':
        text = monthNameOf(month)
        break
      case 'D':
        text = intString(day)
        break
      case 'DD':
        text = pad(day, 2)
        break
      case 'd':
        text = intString(weekday)
        break
      case 'dd':
        text = weekdayNameOf(weekday).slice(0, 2)
        break
      case 'ddd':
        text = weekdayNameOf(weekday).slice(0, 3)
        break
      case 'dddd':
        text = weekdayNameOf(weekday)
        break
      case 'H':
        text = intString(hours)
        break
      case 'HH':
        text = pad(hours, 2)
        break
      case 'h':
        text = intString(twelve(hours))
        break
      case 'hh':
        text = pad(twelve(hours), 2)
        break
      case 'a':
        text = hours < 12.0 ? 'am' : 'pm'
        break
      case 'A':
        text = hours < 12.0 ? 'AM' : 'PM'
        break
      case 'm':
        text = intString(dateMinutes(date))
        break
      case 'mm':
        text = pad(dateMinutes(date), 2)
        break
      case 's':
        text = intString(dateSeconds(date))
        break
      case 'ss':
        text = pad(dateSeconds(date), 2)
        break
      case 'SSS':
        text = pad(dateMs(date), 3)
        break
      case 'Z':
        text = zone()
        break
      default:
        text = '+0000'
    }
    out += text
  }
  return out
}

/** The hour on a twelve-hour clock. */
function twelve(hours: number): number {
  const h = hours % 12.0
  return h === 0.0 ? 12.0 : h
}

/** The English name of month `month`, from 0. */
function monthNameOf(month: number): string {
  const m = index(month)
  return (m === undefined ? undefined : MONTHS[m]) ?? ''
}

/** The English name of weekday `weekday`, from 0 for Sunday. */
function weekdayNameOf(weekday: number): string {
  const d = index(weekday)
  return (d === undefined ? undefined : WEEKDAYS[d]) ?? ''
}

/** A small non-negative whole number as an index. */
export function index(value: number): number | undefined {
  if (value >= 0.0 && value < 1e6 && value % 1 === 0) {
    return value
  }
  return undefined
}

/** Scratch for {@link dateCalendar}: year, month, and day of the month. */
const calendar: number[] = [0, 0, 0]

/** `date` as `YYYY-MM-DD`, as dayjs writes that format. */
export function isoDate(date: Date): string {
  let year = Number.NaN
  let month = Number.NaN
  let day = Number.NaN
  if (dateCalendar(date, calendar)) {
    year = calendar[0] as number
    month = (calendar[1] as number) + 1.0
    day = calendar[2] as number
  }
  const out = buf(year >= 1000.0 && year <= 9999.0 ? intString(year) : pad(year, 4))
  out.s += month < 10.0 ? '-0' : '-'
  pushInt(out, month)
  out.s += day < 10.0 ? '-0' : '-'
  pushInt(out, day)
  return out.s
}

/** The fields a format reads. */
type Fields = {
  /** Whether `A` or `a` read `PM`. */
  afternoon: boolean | undefined
  /** The day of the month. */
  day: number | undefined
  /** Whether `Do` gave a day, even 0. */
  dayGiven: boolean
  /** Hours. */
  hours: number | undefined
  /** Milliseconds. */
  milliseconds: number | undefined
  /** Minutes. */
  minutes: number | undefined
  /** The month, from 1. */
  month: number | undefined
  /** The UTC offset in minutes, negated. */
  offset: number | undefined
  /** Seconds. */
  seconds: number | undefined
  /** A week number, which dayjs cannot apply. */
  week: number | undefined
  /** The year. */
  year: number | undefined
}

function fieldsDefault(): Fields {
  return {
    afternoon: undefined,
    day: undefined,
    dayGiven: false,
    hours: undefined,
    milliseconds: undefined,
    minutes: undefined,
    month: undefined,
    offset: undefined,
    seconds: undefined,
    week: undefined,
    year: undefined,
  }
}

/** What text a reader takes, as dayjs's `match*` expressions find it. */
type Pattern =
  /** `\d`. */
  | { kind: 'One' }
  /** `\d\d?`. */
  | { kind: 'OneToTwo' }
  /** `[+-]\d\d:?(\d\d)?|Z`. */
  | { kind: 'Offset' }
  /** `[+-]?\d+`. */
  | { kind: 'Signed' }
  /** `\d\d`, `\d{3}`, or `\d{4}`. */
  | { kind: 'Exact'; _0: number }
  /** `\d*[^-_:/,()\s\d]+`. */
  | { kind: 'Word' }

/** A step of a compiled format: literal text to skip, or a token to read. */
type Step =
  /** Literal text of the given length in code units. */
  | { kind: 'Literal'; _0: number }
  /** A token and what its reader matches. */
  | { kind: 'Read'; _0: string; _1: Pattern }

const ONE: Pattern = { kind: 'One' }
const ONE_TO_TWO: Pattern = { kind: 'OneToTwo' }
const OFFSET: Pattern = { kind: 'Offset' }
const SIGNED: Pattern = { kind: 'Signed' }
const WORD: Pattern = { kind: 'Word' }
const EXACT2: Pattern = { kind: 'Exact', _0: 2 }
const EXACT3: Pattern = { kind: 'Exact', _0: 3 }
const EXACT4: Pattern = { kind: 'Exact', _0: 4 }

/** The reader for a format token, as dayjs's parse table has it. */
const READERS: Map<string, Pattern> = new Map<string, Pattern>([
  ['A', WORD],
  ['a', WORD],
  ['Q', ONE],
  ['S', ONE],
  ['SS', EXACT2],
  ['SSS', EXACT3],
  ['s', ONE_TO_TWO],
  ['ss', ONE_TO_TWO],
  ['m', ONE_TO_TWO],
  ['mm', ONE_TO_TWO],
  ['H', ONE_TO_TWO],
  ['h', ONE_TO_TWO],
  ['HH', ONE_TO_TWO],
  ['hh', ONE_TO_TWO],
  ['D', ONE_TO_TWO],
  ['DD', EXACT2],
  ['Do', WORD],
  ['w', ONE_TO_TWO],
  ['ww', EXACT2],
  ['M', ONE_TO_TWO],
  ['MM', EXACT2],
  ['MMM', WORD],
  ['MMMM', WORD],
  ['Y', SIGNED],
  ['YY', EXACT2],
  ['YYYY', EXACT4],
  ['Z', OFFSET],
  ['ZZ', OFFSET],
])

/** The reader for a format token, as dayjs's parse table has it. */
function reader(token: string): [string, Pattern] | undefined {
  const pattern = READERS.get(token)
  return pattern === undefined ? undefined : [token, pattern]
}

/** Whether the code unit at `at` exists and passes `f`. */
function unitIs(units: string, at: number, f: (c: number) => boolean): boolean {
  return at < units.length && f(units.charCodeAt(at))
}

/** A separator of `RE_TOKENS`: `[-_:/.,()\s]`. */
function isSeparator(c: number): boolean {
  return c === 45 || c === 95 || c === 58 || c === 47 || c === 46 || c === 44 || c === 40 || c === 41 || isSpace(c)
}

/** The format tokens of `RE_TOKENS`, in alternation order. */
const WORDS = [
  'A',
  'a',
  'Q',
  'YYYY',
  'YY',
  'Y',
  'ww',
  'w',
  'MMMM',
  'MMM',
  'MM',
  'M',
  'Do',
  'DD',
  'D',
  'hh',
  'h',
  'HH',
  'H',
  'mm',
  'm',
  'ss',
  's',
  'SSS',
  'SS',
  'S',
]

/** The tokens of a format, as `template.match(RE_TOKENS)` lists them. */
function tokens(units: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < units.length) {
    // `\[[^[]*\]`: up to the last `]` before the next `[`.
    if (units.charCodeAt(at) === 0x5b) {
      const nextOpen = units.indexOf('[', at + 1)
      const spanEnd = nextOpen < 0 ? units.length : nextOpen
      const close = units.lastIndexOf(']', spanEnd - 1)
      if (close >= at + 1) {
        const end = close + 1
        out.push(units.slice(at, end))
        at = end
        continue
      }
    }
    if (unitIs(units, at, isSeparator)) {
      let end = at + 1
      while (unitIs(units, end, isSeparator)) {
        end += 1
      }
      out.push(units.slice(at, end))
      at = end
      continue
    }
    let word = firstOf(units, at, WORDS)
    if (word === undefined) {
      if (starts(units, at, 'z')) {
        word = 'z'
      } else if (starts(units, at, 'ZZ')) {
        word = 'ZZ'
      } else if (starts(units, at, 'Z')) {
        word = 'Z'
      }
    }
    if (word !== undefined) {
      out.push(units.slice(at, at + word.length))
      at += word.length
    } else {
      at += 1
    }
  }
  return out
}

/** The most formats {@link compiled} keeps. A chart uses one or two. */
const COMPILED_LIMIT = 32

/** Compiled formats by template, cleared when full. */
const COMPILED = new Map<string, Step[] | undefined>()

/** {@link compile}, remembered for the few templates a chart uses. Steps are never mutated. */
function compiled(template: string): Step[] | undefined {
  if (template === lastTemplate) return lastSteps
  const steps = cachedCompile(template)
  lastTemplate = template
  lastSteps = steps
  return steps
}

/** The template {@link compiled} last saw, which charts ask for again and again. */
let lastTemplate: string | undefined
/** The steps of {@link lastTemplate}. */
let lastSteps: Step[] | undefined

/** {@link compile} through {@link COMPILED}. */
function cachedCompile(template: string): Step[] | undefined {
  const steps = COMPILED.get(template)
  if (steps !== undefined || COMPILED.has(template)) return steps
  const fresh = compile(template)
  if (template.length <= 256) {
    if (COMPILED.size >= COMPILED_LIMIT) COMPILED.clear()
    COMPILED.set(template, fresh)
  }
  return fresh
}

/** Compiles a format into steps, or `undefined` when dayjs cannot parse with it. */
function compile(template: string): Step[] | undefined {
  const units = template

  // dayjs expands localized tokens through a locale table the English locale does not have.
  let at = 0
  while (at < units.length) {
    const end = bracket(units, at)
    if (end !== undefined) {
      at = end
      continue
    }
    if (unitIs(units, at, (c) => c === 76 || c === 108)) {
      return undefined
    }
    at += 1
  }

  const list = tokens(units)
  if (list.length === 0) {
    return undefined
  }
  return list.map((token): Step => {
    const found = reader(token)
    if (found !== undefined) {
      return { kind: 'Read', _0: found[0], _1: found[1] }
    }
    // `token.replace(/^\[|\]$/g, '')`.
    let length = token.length
    const opens = token.charCodeAt(0) === 0x5b
    if (opens) {
      length -= 1
    }
    if (token.length > (opens ? 1 : 0) && token.charCodeAt(token.length - 1) === 0x5d) {
      length -= 1
    }
    return { kind: 'Literal', _0: length }
  })
}

/** Whether the code unit at `at` of `text` is an ASCII digit. */
function digitAt(text: string, at: number): boolean {
  return at < text.length && isDigit(text.charCodeAt(at))
}

/** Where a run of ASCII digits from `from` ends. */
function digitsFrom(text: string, from: number): number {
  let at = from
  while (digitAt(text, at)) {
    at += 1
  }
  return at
}

/** Whether the code unit at `at` of `text` is `+` or `-`. */
function signAt(text: string, at: number): boolean {
  if (at >= text.length) return false
  const c = text.charCodeAt(at)
  return c === 43 || c === 45
}

/** Whether the code unit at `at` of `text` can be part of a `Word` match. */
function wordAt(text: string, at: number): boolean {
  if (at >= text.length) return false
  const c = text.charCodeAt(at)
  return (!isSeparator(c) || c === 46) && !isDigit(c)
}

/** Where `pattern` matching at `start` of `text` ends, or `undefined`. */
function matchAt(text: string, start: number, pattern: Pattern): number | undefined {
  switch (pattern.kind) {
    case 'One':
      return digitAt(text, start) ? start + 1 : undefined
    case 'OneToTwo':
      return digitAt(text, start) ? (digitAt(text, start + 1) ? start + 2 : start + 1) : undefined
    case 'Exact': {
      for (let i = 0; i < pattern._0; i++) {
        if (!digitAt(text, start + i)) return undefined
      }
      return start + pattern._0
    }
    case 'Signed': {
      if (signAt(text, start) && digitAt(text, start + 1)) return digitsFrom(text, start + 1)
      return digitAt(text, start) ? digitsFrom(text, start) : undefined
    }
    case 'Offset': {
      if (signAt(text, start) && digitAt(text, start + 1) && digitAt(text, start + 2)) {
        let e = start + 3
        if (text.charCodeAt(e) === 0x3a) {
          e += 1
        }
        if (digitAt(text, e) && digitAt(text, e + 1)) {
          e += 2
        }
        return e
      }
      return text.charCodeAt(start) === 0x5a ? start + 1 : undefined
    }
    case 'Word': {
      const after = digitsFrom(text, start)
      if (!wordAt(text, after)) return undefined
      let e = after
      while (wordAt(text, e)) {
        e += 1
      }
      return e
    }
  }
}

/** Where `pattern` first matches in `text`, as an unanchored regular expression search. */
function find(text: string, pattern: Pattern): [number, number] | undefined {
  for (let start = 0; start < text.length; start++) {
    const end = matchAt(text, start, pattern)
    if (end !== undefined) {
      return [start, end]
    }
  }
  return undefined
}

/** `+text` for the digit strings the readers see. */
function toNumber(text: string): number {
  return parseFloat(text) ?? Number.NaN
}

/** Reads one matched token into `fields`. `false` when dayjs's reader rejects it. */
function read(fields: Fields, name: string, input: string): boolean {
  const number = (): number => toNumber(input)
  switch (name) {
    case 'A':
      fields.afternoon = input === 'PM'
      break
    case 'a':
      fields.afternoon = input === 'pm'
      break
    case 'Q':
      fields.month = (number() - 1.0) * 3.0 + 1.0
      break
    case 'S':
      fields.milliseconds = number() * 100.0
      break
    case 'SS':
      fields.milliseconds = number() * 10.0
      break
    case 'SSS':
      fields.milliseconds = number()
      break
    case 's':
    case 'ss':
      fields.seconds = number()
      break
    case 'm':
    case 'mm':
      fields.minutes = number()
      break
    case 'H':
    case 'h':
    case 'HH':
    case 'hh':
      fields.hours = number()
      break
    case 'D':
    case 'DD':
      fields.day = number()
      break
    case 'Do': {
      let start = -1
      for (let i = 0; i < input.length; i++) {
        if (isDigit(input.charCodeAt(i))) {
          start = i
          break
        }
      }
      if (start < 0) {
        return false
      }
      let end = start
      while (end < input.length && isDigit(input.charCodeAt(end))) {
        end += 1
      }
      // dayjs keeps the digits as a string here, so even "0" counts as a day being given.
      fields.day = toNumber(input.slice(start, end))
      fields.dayGiven = true
      for (let i = 1; i <= 31; i++) {
        if (ordinal(i) === input) {
          fields.day = i
        }
      }
      break
    }
    case 'w':
    case 'ww':
      fields.week = number()
      break
    case 'M':
    case 'MM':
      fields.month = number()
      break
    case 'MMM':
    case 'MMMM': {
      const found = MONTHS.findIndex((month) => (name === 'MMM' ? month.slice(0, 3) === input : month === input))
      if (found < 0) {
        return false
      }
      fields.month = found + 1
      break
    }
    case 'Y':
    case 'YYYY':
      fields.year = number()
      break
    case 'YY': {
      const n = number()
      fields.year = n + (n > 68.0 ? 1900.0 : 2000.0)
      break
    }
    case 'Z':
    case 'ZZ': {
      if (input === 'Z') {
        fields.offset = 0.0
        return true
      }
      // `input.match(/([+-]|\d\d)/g)`: the sign, then pairs of digits.
      const pairs: number[] = []
      let at = 1
      while (at + 1 < input.length + 1) {
        if (unitIs(input, at, isDigit) && unitIs(input, at + 1, isDigit)) {
          pairs.push(toNumber(input.slice(at, at + 2)))
          at += 2
        } else {
          at += 1
        }
      }
      const hours = pairs[0] ?? Number.NaN
      const minutes = pairs[1] ?? 0.0
      const total = hours * 60.0 + minutes
      fields.offset = total === 0.0 ? 0.0 : input.charCodeAt(0) === 0x2b ? -total : total
      break
    }
    default:
      break
  }
  return true
}

/** A number that is set and not zero or NaN, as JavaScript's truthiness reads it. */
function truthy(value: number | undefined): number | undefined {
  return value !== undefined && value !== 0.0 && !Number.isNaN(value) ? value : undefined
}

/**
 * Parses `input` with `template` without checking that it formats back, as dayjs's custom parse
 * format does.
 */
function loose(input: string, template: string, now: Date): Date | undefined {
  if (template === 'x' || template === 'X') {
    // `Number(input)`. Only a plain integer can format back to the input, so any other text
    // gives an invalid date here.
    const digits = input.startsWith('-') ? input.slice(1) : input
    let plain = digits !== ''
    for (let i = 0; i < digits.length && plain; i++) {
      if (!isDigit(digits.charCodeAt(i))) plain = false
    }
    const n = plain ? (parseFloat(input) ?? Number.NaN) : Number.NaN
    const scale = template === 'X' ? 1000.0 : 1.0
    return timeClip(scale * n)
  }

  const steps = compiled(template)
  if (steps === undefined) {
    return undefined
  }
  const fields = fieldsDefault()
  let rest = input
  let start = 0
  for (const step of steps) {
    if (step.kind === 'Literal') {
      start += step._0
      continue
    }
    const name = step._0
    const pattern = step._1
    const slice = rest.slice(start)
    const found = find(slice, pattern)
    if (found === undefined) {
      return undefined
    }
    const matched = slice.slice(found[0], found[1])
    if (!read(fields, name, matched)) {
      return undefined
    }
    // dayjs drops the first occurrence of the matched text, wherever it is, and does not move
    // `start`.
    if (matched !== '') {
      const at = rest.indexOf(matched)
      if (at >= 0) {
        rest = rest.slice(0, at) + rest.slice(at + matched.length)
      }
    }
  }

  if (fields.afternoon !== undefined && fields.hours !== undefined) {
    const hours = fields.hours
    if (fields.afternoon) {
      if (hours < 12.0) {
        fields.hours = hours + 12.0
      }
    } else if (index(hours) === 12) {
      fields.hours = 0.0
    }
  }

  let day: number
  if (fields.dayGiven || truthy(fields.day) !== undefined) {
    day = fields.day ?? Number.NaN
  } else if (truthy(fields.year) === undefined && truthy(fields.month) === undefined) {
    day = dateDate(now)
  } else {
    day = 1.0
  }
  const year = truthy(fields.year) ?? dateYear(now)
  let month = 0.0
  if (!(truthy(fields.year) !== undefined && truthy(fields.month) === undefined)) {
    month = fields.month !== undefined && fields.month > 0.0 ? fields.month - 1.0 : dateMonth(now)
  }
  const hours = truthy(fields.hours) ?? 0.0
  const minutes = truthy(fields.minutes) ?? 0.0
  const seconds = truthy(fields.seconds) ?? 0.0
  const ms = truthy(fields.milliseconds) ?? 0.0
  if (fields.offset !== undefined) {
    return timeClip(utc(year, month, day, hours, minutes, seconds, ms + fields.offset * 60_000.0))
  }
  // Applying a week number needs a dayjs plugin Mermaid does not load.
  if (truthy(fields.week) !== undefined) {
    return undefined
  }
  return dateLocal(year, month, day, hours, minutes, seconds, ms)
}

/**
 * Parses the way `dayjs(input, format, true)` does. `now` supplies the fields the format leaves
 * out.
 */
export function parseStrict(input: string, template: string, now: Date): Date | undefined {
  const date = loose(input, template, now)
  if (date === undefined) {
    return undefined
  }
  return dateIsValid(date) && format(date, template) === input ? date : undefined
}
