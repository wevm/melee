/**
 * @module JavaScript `Date` semantics for the gantt port: time values, the calendar arithmetic of
 * the ECMAScript specification, and V8's `Date` string parser, which `new Date(text)` runs.
 *
 * Pele reads and writes dates in the host's local time zone. The compiler reads no environment,
 * so local time here is UTC, and Ondine matches Pele running with `TZ=UTC`.
 */
import { isSpace } from '../../util/chars.ts'
import { idiv, remEuclid } from '../../util/rust.ts'

/** Milliseconds in a day. */
export const DAY = 86_400_000.0
/** The largest time value a `Date` holds, in milliseconds either side of the epoch. */
const MAX_TIME = 8.64e15

/**
 * A `Date`: milliseconds since the epoch, or NaN for an invalid date. Rust's `Date(f64)` newtype
 * is a plain number; its `&mut self` setters return the new value.
 */
export type Date = number

/*
 * The calendar fields of the last valid time value {@link fields} read. Module scratch, so that
 * reading a field does not allocate; every reader consumes them before the next read.
 */
/** Days since the epoch. */
let fDay = 0
/** Milliseconds since midnight. */
let fTime = 0
/** Full year, set by {@link civil}. */
let fYear = 0
/** Month, from 0, set by {@link civil}. */
let fMonth = 0
/** Day of the month, from 1, set by {@link civil}. */
let fDate = 0
/** The date the fields are of, or NaN before the first read. */
let fFor = Number.NaN
/** Whether the calendar fields are of {@link fFor} too. */
let fCalendar = false

/** `div_euclid` on integers. */
function divEuclid(a: number, b: number): number {
  const q = Math.trunc(a / b)
  return a % b < 0 ? (b > 0 ? q - 1 : q + 1) : q
}

/** `TimeClip`: NaN outside the representable range, otherwise truncated toward zero. */
export function timeClip(time: number): number {
  if (!Number.isFinite(time) || Math.abs(time) > MAX_TIME) {
    return Number.NaN
  }
  return Math.trunc(time) + 0.0
}

/** Days from 1970-01-01 to the first of `month` (0 to 11) in `year`. */
function daysFromCivil(year: number, month: number): number {
  const y = month < 2 ? year - 1 : year
  const era = divEuclid(y, 400)
  const yoe = y - era * 400
  const m = month + 1
  const mp = (m + 9) % 12
  const doy = Math.trunc((153 * mp + 2) / 5)
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy
  return era * 146_097 + doe - 719_468
}

/** Sets {@link fYear}, {@link fMonth} (0 to 11), and {@link fDate} from a day count since the epoch. */
function civil(days: number): void {
  const z = days + 719_468
  const era = divEuclid(z, 146_097)
  const doe = z - era * 146_097
  const yoe = Math.trunc((doe - Math.trunc(doe / 1460) + Math.trunc(doe / 36_524) - Math.trunc(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.trunc(yoe / 4) - Math.trunc(yoe / 100))
  const mp = Math.trunc((5 * doy + 2) / 153)
  const date = doy - Math.trunc((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 2 : mp - 10
  fYear = yoe + era * 400 + (month < 2 ? 1 : 0)
  fMonth = month
  fDate = date
}

/** `MakeDay`, with V8's bounds on the year and month. */
export function makeDay(year: number, month: number, date: number): number {
  if (!(Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(date))) {
    return Number.NaN
  }
  let y = Math.trunc(year)
  let m = Math.trunc(month)
  if (!(y >= -1e6 && y <= 1e6) || !(m >= -1e7 && m <= 1e7)) {
    return Number.NaN
  }
  y = y + divEuclid(m, 12)
  m = remEuclid(m, 12)
  const first = daysFromCivil(y, m)
  return first + Math.trunc(date) - 1.0
}

/** `MakeTime`. */
export function makeTime(hours: number, minutes: number, seconds: number, ms: number): number {
  if (!(Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds) && Number.isFinite(ms))) {
    return Number.NaN
  }
  return Math.trunc(hours) * 3_600_000.0 + Math.trunc(minutes) * 60_000.0 + Math.trunc(seconds) * 1000.0 + Math.trunc(ms)
}

/** `MakeDate`. */
export function makeDate(day: number, time: number): number {
  const date = day * DAY + time
  return Number.isFinite(date) ? date : Number.NaN
}

/** The year `new Date(year, ...)` and `Date.UTC` use: 0 to 99 mean 1900 to 1999. */
function fullYear(year: number): number {
  if (Number.isFinite(year)) {
    const t = Math.trunc(year)
    if (t >= 0 && t < 100) return 1900.0 + t
  }
  return year
}

/** `new Date(year, month, date, hours, minutes, seconds, ms)` in local time, which is UTC. */
export function dateLocal(
  year: number,
  month: number,
  date: number,
  hours: number,
  minutes: number,
  seconds: number,
  ms: number,
): Date {
  const day = makeDay(fullYear(year), month, date)
  return timeClip(makeDate(day, makeTime(hours, minutes, seconds, ms)))
}

/** The time value, as `+date` reads it. */
export function dateTime(date: Date): number {
  return date
}

/** Whether the time value is a number. */
export function dateIsValid(date: Date): boolean {
  return !Number.isNaN(date)
}

/**
 * Sets {@link fDay} and {@link fTime} from a valid date, and with `calendar` also the calendar
 * fields. `false` for an invalid date.
 */
function fields(date: Date, calendar: boolean): boolean {
  if (Number.isNaN(date)) {
    return false
  }
  // Charts read several fields of one date in a row. Zero is left out, since `-0` and `0`
  // compare equal but give fields that differ in sign.
  if (date !== fFor || date === 0) {
    const t = Math.trunc(date)
    fDay = divEuclid(t, 86_400_000)
    fTime = remEuclid(t, 86_400_000)
    fFor = date
    fCalendar = false
  }
  if (calendar && !fCalendar) {
    civil(fDay)
    fCalendar = true
  }
  return true
}

/** `getFullYear`. */
export function dateYear(date: Date): number {
  return fields(date, true) ? fYear : Number.NaN
}

/** `getMonth`, from 0. */
export function dateMonth(date: Date): number {
  return fields(date, true) ? fMonth : Number.NaN
}

/** `getDate`, from 1. */
export function dateDate(date: Date): number {
  return fields(date, true) ? fDate : Number.NaN
}

/** `getDay`: 0 for Sunday. */
export function dateWeekday(date: Date): number {
  return fields(date, false) ? remEuclid(fDay + 4, 7) : Number.NaN
}

/** `getHours`. */
export function dateHours(date: Date): number {
  return fields(date, false) ? Math.trunc(fTime / 3_600_000) : Number.NaN
}

/** `getMinutes`. */
export function dateMinutes(date: Date): number {
  return fields(date, false) ? Math.trunc(fTime / 60_000) % 60 : Number.NaN
}

/** `getSeconds`. */
export function dateSeconds(date: Date): number {
  return fields(date, false) ? Math.trunc(fTime / 1000) % 60 : Number.NaN
}

/** `getMilliseconds`. */
export function dateMs(date: Date): number {
  return fields(date, false) ? fTime % 1000 : Number.NaN
}

/**
 * The year, month (from 0), and day of the month of a valid date, written to `out` in that order
 * as one read. `false`, with `out` untouched, for an invalid date.
 */
export function dateCalendar(date: Date, out: number[]): boolean {
  if (!fields(date, true)) return false
  out[0] = fYear
  out[1] = fMonth
  out[2] = fDate
  return true
}

/** `setTime`: the new value. */
export function dateSetTime(_date: Date, time: number): Date {
  return timeClip(time)
}

/** `setDate`: the new value. An invalid date stays invalid. */
export function dateSetDate(date: Date, d: number): Date {
  if (!fields(date, true)) {
    return date
  }
  const time = fTime
  return timeClip(makeDate(makeDay(fYear, fMonth, d), time))
}

/** `setDate(getDate() + days)`: the date moved by `days` calendar days. An invalid date stays invalid. */
export function dateAddDays(date: Date, days: number): Date {
  if (Number.isInteger(days) && Math.abs(days) <= 1e8) {
    // `MakeDay` of the date's own year, month, and day plus whole `days` is its day count plus
    // `days`, exactly, so the calendar fields are not needed.
    if (!fields(date, false)) {
      return date
    }
    return timeClip(makeDate(fDay + days, fTime))
  }
  if (!fields(date, true)) {
    return date
  }
  const time = fTime
  return timeClip(makeDate(makeDay(fYear, fMonth, fDate + days), time))
}

/** `setMonth(month)`, or `setMonth(month, date)` when `date` is given: the new value. */
export function dateSetMonth(date: Date, month: number, d: number | undefined): Date {
  if (!fields(date, true)) {
    return date
  }
  const time = fTime
  return timeClip(makeDate(makeDay(fYear, month, d ?? fDate), time))
}

/** `setFullYear(year)`: the new value. An invalid date counts as the epoch, as the specification says. */
export function dateSetFullYear(date: Date, year: number): Date {
  const base = Number.isNaN(date) ? 0.0 : date
  if (!fields(base, true)) {
    return base
  }
  const time = fTime
  return timeClip(makeDate(makeDay(year, fMonth, fDate), time))
}

/** `setHours(hours, minutes, seconds, ms)`: the new value. */
export function dateSetHours(date: Date, hours: number, minutes: number, seconds: number, ms: number): Date {
  if (!fields(date, false)) {
    return date
  }
  const day = fDay
  return timeClip(makeDate(day, makeTime(hours, minutes, seconds, ms)))
}

/** `Date.UTC(year, month, date, hours, minutes, seconds, ms)`. */
export function utc(
  year: number,
  month: number,
  date: number,
  hours: number,
  minutes: number,
  seconds: number,
  ms: number,
): number {
  return dateLocal(year, month, date, hours, minutes, seconds, ms)
}

/**
 * `new Date(text)`: V8's `DateParser`, which reads ES5 ISO strings and falls back to legacy forms
 * such as `Jan 5 2014 10:00 PM`. Returns NaN for what it does not accept. Port of
 * `src/date/dateparser-inl.h` and `dateparser.cc` in V8.
 */
export function parse(text: string): Date {
  const scanner = scannerNew(text)
  const day = dayComposerDefault()
  const time = timeComposerDefault()
  const tz = zoneComposerDefault()

  const fields = parseTokens(scanner, day, time, tz)
  if (fields === undefined) {
    return Number.NaN
  }

  const [year, month, date, hours, minutes, seconds, ms, offset] = fields
  const value = makeDate(makeDay(year, month, date), makeTime(hours, minutes, seconds, ms))
  if (Number.isNaN(offset)) {
    if (!(value >= -(MAX_TIME + 864e6) && value <= MAX_TIME + 864e6)) {
      return Number.NaN
    }
    return timeClip(value)
  }
  const shifted = value - offset * 1000.0
  if (!(shifted >= -MAX_TIME && shifted <= MAX_TIME)) {
    return Number.NaN
  }
  return timeClip(shifted)
}

/** No value: V8's `kNone`. */
const NONE = 2147483647

/** What a keyword names. V8's `KeywordType`. */
const Keyword = {
  /** `am` or `pm`. */
  AmPm: 'AmPm',
  /** A word that is not a keyword. */
  Invalid: 'Invalid',
  /** A month name. */
  MonthName: 'MonthName',
  /** `T`. */
  TimeSeparator: 'TimeSeparator',
  /** A time zone such as `UTC` or `PST`. */
  TimeZoneName: 'TimeZoneName',
} as const
type Keyword = (typeof Keyword)[keyof typeof Keyword]

/** A token of a date string. V8's `DateToken`. */
type Token =
  | { kind: 'End' }
  | { kind: 'Invalid' }
  | { kind: 'Keyword'; keyword: Keyword; length: number; value: number }
  | { kind: 'Number'; length: number; value: number }
  | { kind: 'Symbol'; _0: number }
  | { kind: 'Unknown' }
  | { kind: 'WhiteSpace' }

const END: Token = { kind: 'End' }
const INVALID: Token = { kind: 'Invalid' }
const UNKNOWN: Token = { kind: 'Unknown' }
const WHITE_SPACE: Token = { kind: 'WhiteSpace' }

/** Whether the token is a number. */
function tokenIsNumber(token: Token): boolean {
  return token.kind === 'Number'
}

/** Whether the token is a number of exactly `n` digits. */
function tokenIsFixed(token: Token, n: number): boolean {
  return token.kind === 'Number' && token.length === n
}

/** The value of a number token, or 0. */
function tokenNumber(token: Token): number {
  return token.kind === 'Number' ? token.value : 0
}

/** Whether the token is the symbol `c` (a code unit). */
function tokenIsSymbol(token: Token, c: number): boolean {
  return token.kind === 'Symbol' && token._0 === c
}

/** Whether the token is `+` or `-`. */
function tokenIsSign(token: Token): boolean {
  return tokenIsSymbol(token, 0x2b) || tokenIsSymbol(token, 0x2d)
}

/** The sign a `+` or `-` token gives. */
function tokenSign(token: Token): number {
  return tokenIsSymbol(token, 0x2d) ? -1 : 1
}

/** Whether the token is a keyword of `kind`. */
function tokenIsKeyword(token: Token, kind: Keyword): boolean {
  return token.kind === 'Keyword' && token.keyword === kind
}

/** Whether the token is the time zone `Z`. */
function tokenIsZ(token: Token): boolean {
  return token.kind === 'Keyword' && token.keyword === Keyword.TimeZoneName && token.length === 1 && token.value === 0
}

/** Whether the token is `End`. */
function tokenIsEnd(token: Token): boolean {
  return token.kind === 'End'
}

/** The keywords V8 knows by their first three letters, in its table order. */
const KEYWORDS: [string, Keyword, number][] = [
  ['jan', Keyword.MonthName, 1],
  ['feb', Keyword.MonthName, 2],
  ['mar', Keyword.MonthName, 3],
  ['apr', Keyword.MonthName, 4],
  ['may', Keyword.MonthName, 5],
  ['jun', Keyword.MonthName, 6],
  ['jul', Keyword.MonthName, 7],
  ['aug', Keyword.MonthName, 8],
  ['sep', Keyword.MonthName, 9],
  ['oct', Keyword.MonthName, 10],
  ['nov', Keyword.MonthName, 11],
  ['dec', Keyword.MonthName, 12],
  ['am\0', Keyword.AmPm, 0],
  ['pm\0', Keyword.AmPm, 12],
  ['ut\0', Keyword.TimeZoneName, 0],
  ['utc', Keyword.TimeZoneName, 0],
  ['z\0\0', Keyword.TimeZoneName, 0],
  ['gmt', Keyword.TimeZoneName, 0],
  ['cdt', Keyword.TimeZoneName, -5],
  ['cst', Keyword.TimeZoneName, -6],
  ['edt', Keyword.TimeZoneName, -4],
  ['est', Keyword.TimeZoneName, -5],
  ['mdt', Keyword.TimeZoneName, -6],
  ['mst', Keyword.TimeZoneName, -7],
  ['pdt', Keyword.TimeZoneName, -7],
  ['pst', Keyword.TimeZoneName, -8],
  ['t\0\0', Keyword.TimeSeparator, 0],
]

/** Reads tokens one ahead, as V8's `DateStringTokenizer` over its `InputReader`. */
type Scanner = {
  /** The current character, or 0 past the end. */
  ch: number
  /** The index of the next code unit. */
  index: number
  /** The token ahead. */
  next: Token
  /** The string, read as UTF-16. */
  units: string
}

/** A scanner at the start of `units`, with the first token read. */
function scannerNew(units: string): Scanner {
  const scanner: Scanner = { ch: 0, index: 0, next: END, units }
  scannerAdvance(scanner)
  scanner.next = scannerScan(scanner)
  return scanner
}

/** Reads the next code unit. */
function scannerAdvance(s: Scanner): void {
  s.ch = s.index < s.units.length ? s.units.charCodeAt(s.index) : 0
  s.index += 1
}

/** Reads past `c` when it is the current character. */
function scannerSkip(s: Scanner, c: number): boolean {
  if (s.ch === c) {
    scannerAdvance(s)
    return true
  }
  return false
}

/** Whether the current character is an ASCII digit. */
function scannerIsDigit(s: Scanner): boolean {
  return s.ch >= 48 && s.ch <= 57
}

/** Whether the current character can be part of a word: at or above `A` and not a space. */
function scannerIsWord(s: Scanner): boolean {
  return s.ch >= 65 && !isSpace(s.ch)
}

const SYMBOLS = [0x3a, 0x2d, 0x2b, 0x2e, 0x29]

/** Reads one token. V8's `DateStringTokenizer::Scan`. */
function scannerScan(s: Scanner): Token {
  const start = s.index
  if (s.ch === 0) {
    return END
  }
  if (scannerIsDigit(s)) {
    let value = 0
    let digits = 0
    while (scannerIsDigit(s)) {
      if (digits < 9) {
        value = value * 10 + (s.ch - 48)
      }
      digits += 1
      scannerAdvance(s)
    }
    return { kind: 'Number', length: s.index - start, value }
  }
  for (const symbol of SYMBOLS) {
    if (scannerSkip(s, symbol)) {
      return { kind: 'Symbol', _0: symbol }
    }
  }
  if (scannerIsWord(s)) {
    const prefix = [0, 0, 0]
    let length = 0
    while (scannerIsWord(s)) {
      if (length < 3) {
        prefix[length] = s.ch | 0x20
      }
      length += 1
      scannerAdvance(s)
    }
    const found = KEYWORDS.find(
      ([word, kind]) =>
        word.charCodeAt(0) === prefix[0] &&
        word.charCodeAt(1) === prefix[1] &&
        word.charCodeAt(2) === prefix[2] &&
        (length <= 3 || kind === Keyword.MonthName),
    )
    const [kind, value] = found === undefined ? [Keyword.Invalid, 0] : [found[1], found[2]]
    return { kind: 'Keyword', keyword: kind, length, value }
  }
  if (isSpace(s.ch)) {
    scannerAdvance(s)
    return WHITE_SPACE
  }
  if (s.ch === 40) {
    // `scannerAdvance` moves `s.ch`, which TypeScript's narrowing does not see.
    const ch = (): number => s.ch
    let balance = 0
    for (;;) {
      if (ch() === 41) {
        balance -= 1
      } else if (ch() === 40) {
        balance += 1
      }
      scannerAdvance(s)
      if (balance <= 0 || ch() === 0) {
        break
      }
    }
    return UNKNOWN
  }
  scannerAdvance(s)
  return UNKNOWN
}

/** Returns the token ahead and reads the one after it. */
function scannerNext(s: Scanner): Token {
  const token = s.next
  s.next = scannerScan(s)
  return token
}

/** The token ahead. */
function scannerPeek(s: Scanner): Token {
  return s.next
}

/** Reads past the token ahead when it is the symbol `c`. */
function scannerSkipSymbol(s: Scanner, c: number): boolean {
  if (tokenIsSymbol(s.next, c)) {
    s.next = scannerScan(s)
    return true
  }
  return false
}

/** Whether `x` is from `low` to `high`, inclusive. */
function between(x: number, low: number, high: number): boolean {
  return x >= low && x <= high
}

/** The year, month, and day read so far. V8's `DayComposer`. */
type DayComposer = {
  /** The numbers read, in order. */
  comp: [number, number, number]
  /** How many numbers were read. */
  index: number
  /** Whether the date was an ES5 ISO date, which fixes its field order. */
  iso: boolean
  /** A month given by name. */
  namedMonth: number | undefined
}

function dayComposerDefault(): DayComposer {
  return { comp: [0, 0, 0], index: 0, iso: false, namedMonth: undefined }
}

/** Adds a component. `false` when all are taken. */
function dayComposerAdd(d: DayComposer, n: number): boolean {
  if (d.index >= 3) {
    return false
  }
  d.comp[d.index] = n
  d.index += 1
  return true
}

/** The year, month from 0, and day, or `undefined` when they are not a date. */
function dayComposerWrite(d: DayComposer): [number, number, number] | undefined {
  if (d.index < 1) {
    return undefined
  }
  // Day and month default to 1.
  for (let i = d.index; i < 3; i++) {
    d.comp[i] = 1
  }
  const [a, b, c] = d.comp
  const isDay = (x: number): boolean => between(x, 1, 31)
  let year: number
  let month: number
  let day: number
  if (d.namedMonth === undefined) {
    if (d.iso || !isDay(a)) {
      ;[year, month, day] = [a, b, c]
    } else {
      ;[year, month, day] = [c, a, b]
    }
  } else if (!isDay(a)) {
    ;[year, month, day] = [a, d.namedMonth, b]
  } else {
    ;[year, month, day] = [b, d.namedMonth, a]
  }
  if (!d.iso) {
    if (between(year, 0, 49)) {
      year += 2000
    } else if (between(year, 50, 99)) {
      year += 1900
    }
  }
  if (!between(month, 1, 12) || !isDay(day)) {
    return undefined
  }
  return [year, month - 1, day]
}

/** The time of day read so far. V8's `TimeComposer`. */
type TimeComposer = {
  /** Hours, minutes, seconds, and milliseconds read, in order. */
  comp: [number, number, number, number]
  /** The hours `AM` or `PM` adds, or `NONE`. */
  hourOffset: number
  /** How many components were read. */
  index: number
}

function timeComposerDefault(): TimeComposer {
  return { comp: [0, 0, 0, 0], hourOffset: NONE, index: 0 }
}

/** Whether no time component was read. */
function timeComposerIsEmpty(t: TimeComposer): boolean {
  return t.index === 0
}

/** Whether `n` can be the next minute, second, or millisecond. */
function timeComposerIsExpecting(t: TimeComposer, n: number): boolean {
  return (t.index === 1 && between(n, 0, 59)) || (t.index === 2 && between(n, 0, 59)) || (t.index === 3 && between(n, 0, 999))
}

/** Adds a component. `false` when all are taken. */
function timeComposerAdd(t: TimeComposer, n: number): boolean {
  if (t.index >= 4) {
    return false
  }
  t.comp[t.index] = n
  t.index += 1
  return true
}

/** Adds the last component the time has. */
function timeComposerAddFinal(t: TimeComposer, n: number): boolean {
  if (!timeComposerAdd(t, n)) {
    return false
  }
  t.index = 4
  return true
}

/** Hours, minutes, seconds, and milliseconds, or `undefined` when they are not a time. */
function timeComposerWrite(t: TimeComposer): [number, number, number, number] | undefined {
  for (let i = t.index; i < 4; i++) {
    t.comp[i] = 0
  }
  let [hour, minute, second, ms] = t.comp
  if (t.hourOffset !== NONE) {
    if (!between(hour, 0, 12)) {
      return undefined
    }
    hour = (hour % 12) + t.hourOffset
  }
  const valid = between(hour, 0, 23) && between(minute, 0, 59) && between(second, 0, 59) && between(ms, 0, 999)
  if (!valid && (hour !== 24 || minute !== 0 || second !== 0 || ms !== 0)) {
    return undefined
  }
  return [hour, minute, second, ms]
}

/** The UTC offset read so far. V8's `TimeZoneComposer`. */
type ZoneComposer = {
  /** Hours, or `NONE`. */
  hour: number
  /** Minutes, or `NONE`. */
  minute: number
  /** 1 or -1, or `NONE` for local time. */
  sign: number
}

function zoneComposerDefault(): ZoneComposer {
  return { hour: NONE, minute: NONE, sign: NONE }
}

/** Sets a whole-hour offset. */
function zoneComposerSet(z: ZoneComposer, hours: number): void {
  z.sign = hours < 0 ? -1 : 1
  z.hour = Math.abs(hours)
  z.minute = 0
}

/** Whether `n` can be the offset's minutes. */
function zoneComposerIsExpecting(z: ZoneComposer, n: number): boolean {
  return z.hour !== NONE && z.minute === NONE && between(n, 0, 59)
}

/** Whether the offset is zero. */
function zoneComposerIsUtc(z: ZoneComposer): boolean {
  return z.hour === 0 && z.minute === 0
}

/** The offset in seconds, NaN when none was given. */
function zoneComposerWrite(z: ZoneComposer): number | undefined {
  if (z.sign === NONE) {
    return Number.NaN
  }
  const hour = z.hour === NONE ? 0 : z.hour
  const minute = z.minute === NONE ? 0 : z.minute
  const total = hour * 3600 + minute * 60
  if (!(total >= 0 && total <= 1_073_741_823)) {
    return undefined
  }
  return z.sign < 0 ? -total : total
}

/** The first three significant digits of a fraction of a second. */
function readMs(token: Token): number {
  if (token.kind !== 'Number') {
    return 0
  }
  const { length, value } = token
  switch (length) {
    case 1:
      return value * 100
    case 2:
      return value * 10
    case 3:
      return value
    default: {
      let len = Math.min(length, 9)
      let factor = 1
      while (len > 3) {
        factor *= 10
        len -= 1
      }
      return idiv(value, factor)
    }
  }
}

/**
 * Reads an ES5 date-time string and returns the first token it leaves, `End` when it read the
 * whole string, or `Invalid` when the string cannot be a date. V8's `ParseES5DateTime`.
 */
function parseEs5(scanner: Scanner, day: DayComposer, time: TimeComposer, tz: ZoneComposer): Token {
  if (tokenIsSign(scannerPeek(scanner))) {
    const signToken = scannerNext(scanner)
    if (!tokenIsFixed(scannerPeek(scanner), 6)) {
      return signToken
    }
    const year = tokenNumber(scannerNext(scanner))
    if (tokenSign(signToken) < 0 && year === 0) {
      return signToken
    }
    dayComposerAdd(day, tokenSign(signToken) * year)
  } else if (tokenIsFixed(scannerPeek(scanner), 4)) {
    dayComposerAdd(day, tokenNumber(scannerNext(scanner)))
  } else {
    return scannerNext(scanner)
  }

  if (scannerSkipSymbol(scanner, 0x2d)) {
    if (!tokenIsFixed(scannerPeek(scanner), 2) || !between(tokenNumber(scannerPeek(scanner)), 1, 12)) {
      return scannerNext(scanner)
    }
    dayComposerAdd(day, tokenNumber(scannerNext(scanner)))
    if (scannerSkipSymbol(scanner, 0x2d)) {
      if (!tokenIsFixed(scannerPeek(scanner), 2) || !between(tokenNumber(scannerPeek(scanner)), 1, 31)) {
        return scannerNext(scanner)
      }
      dayComposerAdd(day, tokenNumber(scannerNext(scanner)))
    }
  }

  if (tokenIsKeyword(scannerPeek(scanner), Keyword.TimeSeparator)) {
    scannerNext(scanner)
    if (!tokenIsFixed(scannerPeek(scanner), 2) || !between(tokenNumber(scannerPeek(scanner)), 0, 24)) {
      return INVALID
    }
    // 24:00, 24:00:00, and 24:00:00.000 are allowed, and no other time in hour 24.
    const hourIs24 = tokenNumber(scannerPeek(scanner)) === 24
    timeComposerAdd(time, tokenNumber(scannerNext(scanner)))
    if (!scannerSkipSymbol(scanner, 0x3a)) {
      return INVALID
    }
    if (
      !tokenIsFixed(scannerPeek(scanner), 2) ||
      !between(tokenNumber(scannerPeek(scanner)), 0, 59) ||
      (hourIs24 && tokenNumber(scannerPeek(scanner)) > 0)
    ) {
      return INVALID
    }
    timeComposerAdd(time, tokenNumber(scannerNext(scanner)))
    if (scannerSkipSymbol(scanner, 0x3a)) {
      if (
        !tokenIsFixed(scannerPeek(scanner), 2) ||
        !between(tokenNumber(scannerPeek(scanner)), 0, 59) ||
        (hourIs24 && tokenNumber(scannerPeek(scanner)) > 0)
      ) {
        return INVALID
      }
      timeComposerAdd(time, tokenNumber(scannerNext(scanner)))
      if (scannerSkipSymbol(scanner, 0x2e)) {
        if (!tokenIsNumber(scannerPeek(scanner)) || (hourIs24 && tokenNumber(scannerPeek(scanner)) > 0)) {
          return INVALID
        }
        timeComposerAdd(time, readMs(scannerNext(scanner)))
      }
    }

    if (tokenIsZ(scannerPeek(scanner))) {
      scannerNext(scanner)
      zoneComposerSet(tz, 0)
    } else if (tokenIsSign(scannerPeek(scanner))) {
      tz.sign = tokenSign(scannerNext(scanner))
      if (tokenIsFixed(scannerPeek(scanner), 4)) {
        const hourMinute = tokenNumber(scannerNext(scanner))
        const hour = idiv(hourMinute, 100)
        const minute = hourMinute % 100
        if (!between(hour, 0, 23) || !between(minute, 0, 59)) {
          return INVALID
        }
        tz.hour = hour
        tz.minute = minute
      } else {
        if (!tokenIsFixed(scannerPeek(scanner), 2) || !between(tokenNumber(scannerPeek(scanner)), 0, 23)) {
          return INVALID
        }
        tz.hour = tokenNumber(scannerNext(scanner))
        if (!scannerSkipSymbol(scanner, 0x3a)) {
          return INVALID
        }
        if (!tokenIsFixed(scannerPeek(scanner), 2) || !between(tokenNumber(scannerPeek(scanner)), 0, 59)) {
          return INVALID
        }
        tz.minute = tokenNumber(scannerNext(scanner))
      }
    }
    if (!tokenIsEnd(scannerPeek(scanner))) {
      return INVALID
    }
  } else if (!tokenIsEnd(scannerPeek(scanner))) {
    return scannerNext(scanner)
  }

  // Date-only forms without an offset are UTC. Date-time forms are local time.
  if (tz.hour === NONE && timeComposerIsEmpty(time)) {
    zoneComposerSet(tz, 0)
  }
  day.iso = true
  return END
}

/**
 * Reads every token into the composers, then writes year, month, date, hours, minutes, seconds,
 * milliseconds, and the UTC offset in seconds (NaN for local time).
 */
function parseTokens(
  scanner: Scanner,
  day: DayComposer,
  time: TimeComposer,
  tz: ZoneComposer,
): [number, number, number, number, number, number, number, number] | undefined {
  let token = parseEs5(scanner, day, time, tz)
  if (token.kind === 'Invalid') {
    return undefined
  }
  let hasReadNumber = day.index > 0

  while (token.kind !== 'End') {
    if (token.kind === 'Number') {
      const n = token.value
      hasReadNumber = true
      if (scannerSkipSymbol(scanner, 0x3a)) {
        if (scannerSkipSymbol(scanner, 0x3a)) {
          if (!timeComposerIsEmpty(time)) {
            return undefined
          }
          timeComposerAdd(time, n)
          timeComposerAdd(time, 0)
        } else {
          if (!timeComposerAdd(time, n)) {
            return undefined
          }
          if (tokenIsSymbol(scannerPeek(scanner), 0x2e)) {
            scannerNext(scanner)
          }
        }
      } else if (scannerSkipSymbol(scanner, 0x2e) && timeComposerIsExpecting(time, n)) {
        timeComposerAdd(time, n)
        if (!tokenIsNumber(scannerPeek(scanner))) {
          return undefined
        }
        const ms = readMs(scannerNext(scanner))
        if (ms < 0) {
          return undefined
        }
        timeComposerAddFinal(time, ms)
      } else if (zoneComposerIsExpecting(tz, n)) {
        tz.minute = n
      } else if (timeComposerIsExpecting(time, n)) {
        timeComposerAddFinal(time, n)
        // A finished time must be followed by the end, a space, `Z`, or a sign.
        const peek = scannerPeek(scanner)
        if (peek.kind !== 'End' && peek.kind !== 'WhiteSpace' && !tokenIsZ(peek) && !tokenIsSign(peek)) {
          return undefined
        }
      } else {
        if (!dayComposerAdd(day, n)) {
          return undefined
        }
        scannerSkipSymbol(scanner, 0x2d)
      }
    } else if (token.kind === 'Keyword') {
      const { keyword: kind, value } = token
      if (kind === Keyword.AmPm && !timeComposerIsEmpty(time)) {
        time.hourOffset = value
      } else if (kind === Keyword.MonthName) {
        day.namedMonth = value
        scannerSkipSymbol(scanner, 0x2d)
      } else if (kind === Keyword.TimeZoneName && hasReadNumber) {
        zoneComposerSet(tz, value)
      } else {
        // A word after a number is garbage, and so is a number right after a word.
        if (hasReadNumber || tokenIsNumber(scannerPeek(scanner))) {
          return undefined
        }
      }
    } else if (tokenIsSign(token) && (zoneComposerIsUtc(tz) || !timeComposerIsEmpty(time))) {
      tz.sign = tokenSign(token)
      let n = 0
      let length = 0
      const peek = scannerPeek(scanner)
      if (peek.kind === 'Number') {
        scannerNext(scanner)
        n = peek.value
        length = peek.length
      }
      hasReadNumber = true

      if (tokenIsSymbol(scannerPeek(scanner), 0x3a)) {
        tz.hour = n
        tz.minute = NONE
      } else if (length === 1 || length === 2) {
        tz.hour = n
        tz.minute = 0
      } else if (length === 3 || length === 4) {
        tz.hour = idiv(n, 100)
        tz.minute = n % 100
      } else {
        return undefined
      }
    } else if ((tokenIsSign(token) || tokenIsSymbol(token, 0x29)) && hasReadNumber) {
      return undefined
    }
    token = scannerNext(scanner)
  }

  const d = dayComposerWrite(day)
  if (d === undefined) return undefined
  const t = timeComposerWrite(time)
  if (t === undefined) return undefined
  const offset = zoneComposerWrite(tz)
  if (offset === undefined) return undefined
  return [d[0], d[1], d[2], t[0], t[1], t[2], t[3], offset]
}
