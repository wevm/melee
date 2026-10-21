/**
 * @module The user journey parser: a port of Mermaid's journey grammar. Port of Pele's
 * `src/diagrams/journey/parser.ts`.
 */
import {
  type JourneyDb,
  journeyDbAddSection,
  journeyDbAddTask,
  journeyDbSetAccDescription,
  journeyDbSetAccTitle,
  journeyDbSetDiagramTitle,
} from './db.ts'
import {
  ACC_DESCR,
  ACC_DESCR_MULTILINE_VALUE,
  ACC_TITLE,
  END,
  EOF,
  JOURNEY,
  NEWLINE,
  SECTION,
  TASK_DATA,
  TASK_NAME,
  TITLE,
  TOKEN_NAMES,
  tokenize,
} from './lexer.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'

const STATEMENT =
  "'EOF', 'SPACE', 'NEWLINE', 'title', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'section', 'taskName'"

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
 * Parses preprocessed journey source into `db`, making the calls the grammar's actions make.
 *
 * Throws the syntax error the generated parser reports.
 */
export function parseJourney(src: string, db: JourneyDb): void {
  const tokens = tokenize(src)
  const kind = (i: number): number => tokens.types[i] ?? END
  const text = (i: number): string => tokens.texts[i] ?? ''
  const fail = (i: number, expected: string): CompileError => {
    const k = kind(i)
    const got = k === END ? '1' : (TOKEN_NAMES[k] ?? '1')
    const start = tokens.starts[i] ?? src.length
    const detail = `Expecting ${expected}, got '${got}'`
    return errorSyntax('journey', src, start, detail, false)
  }

  if (kind(0) !== JOURNEY) throw fail(0, "'journey'")

  let i = 1
  for (;;) {
    switch (kind(i)) {
      case NEWLINE:
        break
      case TITLE:
        journeyDbSetDiagramTitle(db, after(text(i), 5))
        break
      case ACC_TITLE:
        i++
        journeyDbSetAccTitle(db, trim(text(i)))
        break
      case ACC_DESCR:
        i++
        journeyDbSetAccDescription(db, trim(text(i)))
        break
      case ACC_DESCR_MULTILINE_VALUE:
        journeyDbSetAccDescription(db, trim(text(i)))
        break
      case SECTION:
        journeyDbAddSection(db, after(text(i), 7))
        break
      case TASK_NAME: {
        const name = text(i)
        i++
        if (kind(i) !== TASK_DATA) throw fail(i, "'taskData'")
        journeyDbAddTask(db, name, text(i))
        break
      }
      case EOF:
        return
      default:
        throw fail(i, STATEMENT)
    }
    i++
  }
}
