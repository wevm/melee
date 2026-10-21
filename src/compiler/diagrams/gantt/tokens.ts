/** @module Gantt token kinds and their grammar names. Port of Pele's `src/diagrams/gantt/tokens.ts`. */

/** A token kind. Variants keep the grammar's order, which `NAMES` and the weekday ranges rely on. */
export const T = {
  /** The end of the token list. */
  End: 0,
  /** Text no rule matches. */
  Error: 1,
  /** `%%{`, which opens a directive the grammar never reads. */
  OpenDirective: 2,
  /** `accTitle:`. */
  AccTitle: 3,
  /** The text after `accTitle:`. */
  AccTitleValue: 4,
  /** `accDescr:`. */
  AccDescr: 5,
  /** The text after `accDescr:`. */
  AccDescrValue: 6,
  /** The text inside `accDescr { ... }`. */
  AccDescrMultilineValue: 7,
  /** One or more newlines. */
  Nl: 8,
  /** The target of `href "..."`. */
  Href: 9,
  /** The function name after `call`. */
  Callbackname: 10,
  /** The arguments inside `call name(...)`. */
  Callbackargs: 11,
  /** The task ids after `click`. */
  Click: 12,
  /** `gantt`. */
  Gantt: 13,
  /** `dateFormat ...`. */
  DateFormat: 14,
  /** `inclusiveEndDates`. */
  InclusiveEndDates: 15,
  /** `topAxis`. */
  TopAxis: 16,
  /** `axisFormat ...`. */
  AxisFormat: 17,
  /** `tickInterval ...`. */
  TickInterval: 18,
  /** `includes ...`. */
  Includes: 19,
  /** `excludes ...`. */
  Excludes: 20,
  /** `todayMarker ...`. */
  TodayMarker: 21,
  /** `weekday monday`. */
  WeekdayMonday: 22,
  /** `weekday tuesday`. */
  WeekdayTuesday: 23,
  /** `weekday wednesday`. */
  WeekdayWednesday: 24,
  /** `weekday thursday`. */
  WeekdayThursday: 25,
  /** `weekday friday`. */
  WeekdayFriday: 26,
  /** `weekday saturday`. */
  WeekdaySaturday: 27,
  /** `weekday sunday`. */
  WeekdaySunday: 28,
  /** `weekend friday`. */
  WeekendFriday: 29,
  /** `weekend saturday`. */
  WeekendSaturday: 30,
  /** A `YYYY-MM-DD` date. */
  Date: 31,
  /** `title ...`. */
  Title: 32,
  /** `accDescription ...`. */
  AccDescription: 33,
  /** `section ...`. */
  Section: 34,
  /** A task's label. */
  TaskTxt: 35,
  /** A task's `:` and data. */
  TaskData: 36,
  /** A lone `:`. */
  Colon: 37,
  /** The end of the source. */
  Eof: 38,
} as const
export type T = (typeof T)[keyof typeof T]

/** Each kind's name in the grammar, as parse errors print it. */
const NAMES: string[] = [
  '$end',
  'INVALID',
  'open_directive',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'NL',
  'href',
  'callbackname',
  'callbackargs',
  'click',
  'gantt',
  'dateFormat',
  'inclusiveEndDates',
  'topAxis',
  'axisFormat',
  'tickInterval',
  'includes',
  'excludes',
  'todayMarker',
  'weekday_monday',
  'weekday_tuesday',
  'weekday_wednesday',
  'weekday_thursday',
  'weekday_friday',
  'weekday_saturday',
  'weekday_sunday',
  'weekend_friday',
  'weekend_saturday',
  'date',
  'title',
  'accDescription',
  'section',
  'taskTxt',
  'taskData',
  ':',
  'EOF',
]

/** The weekday kinds, from Monday. */
export const WEEKDAYS: T[] = [
  T.WeekdayMonday,
  T.WeekdayTuesday,
  T.WeekdayWednesday,
  T.WeekdayThursday,
  T.WeekdayFriday,
  T.WeekdaySaturday,
  T.WeekdaySunday,
]

/** The kind's grammar name. */
export function tName(self: T): string {
  return NAMES[self] ?? ''
}
