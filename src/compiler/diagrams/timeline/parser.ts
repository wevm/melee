/**
 * @module The timeline parser: a port of Mermaid's timeline grammar. Port of Pele's
 * `src/diagrams/timeline/parser.ts`.
 */
import {
  type TimelineDb,
  timelineDbAddEvent,
  timelineDbAddSection,
  timelineDbAddTask,
  timelineDbSetAccDescription,
  timelineDbSetAccTitle,
  timelineDbSetDiagramTitle,
  timelineDbSetDirection,
} from './db.ts'
import {
  ACC_DESCR,
  ACC_DESCR_MULTILINE_VALUE,
  ACC_TITLE,
  END,
  EOF,
  EVENT,
  NEWLINE,
  PERIOD,
  SECTION,
  TIMELINE,
  TIMELINE_LR,
  TIMELINE_TD,
  TITLE,
  TOKEN_NAMES,
  tokenize,
} from './lexer.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'

const STATEMENT =
  "'EOF', 'SPACE', 'NEWLINE', 'title', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'section', 'period', 'event'"

/**
 * `text` without the ASCII `keyword` units at its start and the one whitespace character after
 * them, as Pele's `substring` leaves it.
 */
function after(text: string, keyword: number): string {
  if (keyword >= text.length) return ''
  const c = text.codePointAt(keyword) as number
  return text.slice(keyword + (c > 0xffff ? 2 : 1))
}

/**
 * Parses preprocessed timeline source into `db`, making the calls the grammar's actions make.
 *
 * Throws the syntax error the generated parser reports, and a semantic error for an event
 * before any period.
 */
export function parseTimeline(src: string, db: TimelineDb): void {
  const tokens = tokenize(src)
  const kind = (i: number): number => tokens.types[i] ?? END
  const text = (i: number): string => tokens.texts[i] ?? ''
  const fail = (i: number, expected: string): CompileError => {
    const k = kind(i)
    const got = k === END ? '1' : (TOKEN_NAMES[k] ?? '1')
    const start = tokens.starts[i] ?? src.length
    const detail = `Expecting ${expected}, got '${got}'`
    return errorSyntax('timeline', src, start, detail, false)
  }

  const head = kind(0)
  if (head !== TIMELINE && head !== TIMELINE_LR && head !== TIMELINE_TD) {
    throw fail(0, "'timeline', 'timeline_lr', 'timeline_td'")
  }
  if (head !== TIMELINE) timelineDbSetDirection(db, head === TIMELINE_LR ? 'LR' : 'TD')

  let i = 1
  for (;;) {
    switch (kind(i)) {
      case NEWLINE:
        break
      case TITLE:
        timelineDbSetDiagramTitle(db, after(text(i), 5))
        break
      case ACC_TITLE:
        i++
        timelineDbSetAccTitle(db, trim(text(i)))
        break
      case ACC_DESCR:
        i++
        timelineDbSetAccDescription(db, trim(text(i)))
        break
      case ACC_DESCR_MULTILINE_VALUE:
        timelineDbSetAccDescription(db, trim(text(i)))
        break
      case SECTION:
        timelineDbAddSection(db, after(text(i), 7))
        break
      case PERIOD:
        timelineDbAddTask(db, text(i), '')
        break
      case EVENT:
        timelineDbAddEvent(db, after(text(i), 1))
        break
      case EOF:
        return
      default:
        throw fail(i, STATEMENT)
    }
    i++
  }
}
