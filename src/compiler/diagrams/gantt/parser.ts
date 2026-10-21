/**
 * @module Parses gantt tokens into a `GanttDb`, with Mermaid's error messages. Port of Pele's
 * `src/diagrams/gantt/parser.ts`.
 */
import {
  type GanttDb,
  ganttDbAddSection,
  ganttDbAddTask,
  ganttDbSetAccDescription,
  ganttDbSetAccTitle,
  ganttDbSetClass,
  ganttDbSetDateFormat,
  ganttDbSetExcludes,
  ganttDbSetIncludes,
  ganttDbSetLink,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, WEEKDAYS, tName } from './tokens.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'

/** The weekday names, from Monday. */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** The tokens a line can start with, as parse errors list them. */
const LINE =
  "'EOF', 'SPACE', 'NL', 'weekday_monday', 'weekday_tuesday', 'weekday_wednesday', " +
  "'weekday_thursday', 'weekday_friday', 'weekday_saturday', 'weekday_sunday', 'weekend_friday', " +
  "'weekend_saturday', 'dateFormat', 'inclusiveEndDates', 'topAxis', 'axisFormat', 'tickInterval', " +
  "'excludes', 'includes', 'todayMarker', 'title', 'acc_title', 'acc_descr', " +
  "'acc_descr_multiline_value', 'section', 'taskTxt', 'click'"

/** Tokens that can start a line, which are also the only ones that can follow a statement. */
function startsLine(t: T): boolean {
  if (WEEKDAYS.includes(t)) return true
  switch (t) {
    case T.WeekendFriday:
    case T.WeekendSaturday:
    case T.Eof:
    case T.Nl:
    case T.DateFormat:
    case T.InclusiveEndDates:
    case T.TopAxis:
    case T.AxisFormat:
    case T.TickInterval:
    case T.Excludes:
    case T.Includes:
    case T.TodayMarker:
    case T.Title:
    case T.AccTitle:
    case T.AccDescr:
    case T.AccDescrMultilineValue:
    case T.Section:
    case T.TaskTxt:
    case T.Click:
      return true
    default:
      return false
  }
}

/**
 * `text` from its `units`-th UTF-16 unit, as `text.slice(units)` reads it. An offset inside a
 * surrogate pair moves past the pair, as Rust's character walk does.
 */
function sliceUnits(text: string, units: number): string {
  if (units >= text.length) return ''
  let at = units
  if (at > 0) {
    const c = text.charCodeAt(at)
    const before = text.charCodeAt(at - 1)
    if (c >= 0xdc00 && c <= 0xdfff && before >= 0xd800 && before <= 0xdbff) at += 1
  }
  return text.slice(at)
}

/** The token list and the reading position. */
type Parser = {
  /** The current token. */
  i: number
  /** The source. */
  src: string
  /** The tokens. */
  tokens: Token[]
}

/** The kind of the current token. */
function kind(p: Parser): T {
  return p.tokens[p.i]?.type ?? T.End
}

/** The text of the current token. */
function text(p: Parser): string {
  return p.tokens[p.i]?.text ?? ''
}

/** A parse error at the current token, listing what was `expected`. */
function fail(p: Parser, expected: string): CompileError {
  const token = p.tokens[p.i]
  const got = token === undefined || token.type === T.End ? '1' : tName(token.type)
  const detail = 'Expecting ' + expected + ", got '" + got + "'"
  const offset = token === undefined ? p.src.length : token.start
  return errorSyntax('gantt', p.src, offset, detail, false)
}

/**
 * Mermaid's parser runs a statement's action only after seeing that the next token can follow
 * it.
 */
function end(p: Parser, also: string): void {
  if (startsLine(kind(p))) {
    return
  }
  throw fail(p, LINE + also)
}

/**
 * Parses gantt `src` into `db`.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for a task with no end or
 * too many fields.
 */
export function parseGantt(src: string, db: GanttDb): void {
  const tokens = tokenize(src)
  const p: Parser = { i: 0, src, tokens }

  if (kind(p) !== T.Gantt) {
    throw fail(p, "'gantt'")
  }
  p.i += 1

  for (;;) {
    const t = kind(p)
    const txt = text(p)
    if (!startsLine(t)) {
      throw fail(p, LINE)
    }
    p.i += 1
    switch (t) {
      case T.Eof:
        if (kind(p) === T.End) {
          return
        }
        end(p, '')
        break
      case T.Nl:
        break
      case T.DateFormat:
        end(p, '')
        ganttDbSetDateFormat(db, sliceUnits(txt, 11))
        break
      case T.InclusiveEndDates:
        end(p, '')
        db.inclusiveEndDates = true
        break
      case T.TopAxis:
        end(p, '')
        db.topAxis = true
        break
      case T.AxisFormat:
        end(p, '')
        db.axisFormat = sliceUnits(txt, 11)
        break
      case T.TickInterval:
        end(p, '')
        db.tickInterval = sliceUnits(txt, 13)
        break
      case T.Excludes:
        end(p, '')
        ganttDbSetExcludes(db, sliceUnits(txt, 9))
        break
      case T.Includes:
        end(p, '')
        ganttDbSetIncludes(db, sliceUnits(txt, 9))
        break
      case T.TodayMarker:
        end(p, '')
        db.todayMarker = sliceUnits(txt, 12)
        break
      case T.WeekendFriday:
        end(p, '')
        db.weekend = 'friday'
        break
      case T.WeekendSaturday:
        end(p, '')
        db.weekend = 'saturday'
        break
      case T.Title:
        end(p, '')
        db.title = sliceUnits(txt, 6)
        break
      case T.AccTitle: {
        if (kind(p) !== T.AccTitleValue) {
          throw fail(p, "'acc_title_value'")
        }
        const value = text(p)
        p.i += 1
        end(p, '')
        ganttDbSetAccTitle(db, trim(value))
        break
      }
      case T.AccDescr: {
        if (kind(p) !== T.AccDescrValue) {
          throw fail(p, "'acc_descr_value'")
        }
        const value = text(p)
        p.i += 1
        end(p, '')
        ganttDbSetAccDescription(db, trim(value))
        break
      }
      case T.AccDescrMultilineValue:
        end(p, '')
        ganttDbSetAccDescription(db, trim(txt))
        break
      case T.Section:
        end(p, '')
        ganttDbAddSection(db, sliceUnits(txt, 8))
        break
      case T.TaskTxt: {
        if (kind(p) !== T.TaskData) {
          throw fail(p, "'taskData'")
        }
        const data = text(p)
        p.i += 1
        end(p, '')
        ganttDbAddTask(db, txt, data)
        break
      }
      case T.Click:
        click(p, db, txt)
        break
      default: {
        end(p, '')
        const index = WEEKDAYS.indexOf(t)
        db.weekday = DAYS[index < 0 ? 0 : index]
        break
      }
    }
  }
}

/** Reads the rest of a `click` statement: a callback, a link, or both in either order. */
function click(p: Parser, db: GanttDb, ids: string): void {
  let name: string | undefined
  let href: string | undefined
  if (kind(p) === T.Callbackname) {
    name = text(p)
    p.i += 1
    let args = false
    if (kind(p) === T.Callbackargs) {
      args = true
      p.i += 1
    }
    if (kind(p) === T.Href) {
      href = text(p)
      p.i += 1
      end(p, '')
    } else {
      end(p, args ? ", 'href'" : ", 'callbackargs', 'href'")
    }
  } else if (kind(p) === T.Href) {
    href = text(p)
    p.i += 1
    if (kind(p) === T.Callbackname) {
      name = text(p)
      p.i += 1
      if (kind(p) === T.Callbackargs) {
        p.i += 1
        end(p, '')
      } else {
        end(p, ", 'callbackargs'")
      }
    } else {
      end(p, ", 'callbackname'")
    }
  } else {
    throw fail(p, "'callbackname', 'href'")
  }

  // Callbacks are recognized and never run. The task is only marked clickable, as in Mermaid.
  if (name !== undefined) {
    ganttDbSetClass(db, ids, 'clickable')
  }
  if (href !== undefined) {
    ganttDbSetLink(db, ids, href)
  }
}
