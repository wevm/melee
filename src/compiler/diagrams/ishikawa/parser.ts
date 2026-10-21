/** @module The Ishikawa parser. Port of Pele's `src/diagrams/ishikawa/parser.ts`. */
import { type IshikawaDb, ishikawaDbAddNode } from './db.ts'
import { T, type Token, tName, tokenize } from './lexer.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'

/** What may end a statement. */
const STOP = "'SPACELINE', 'NL', 'EOF'"

/**
 * Follows the parser Jison builds from Mermaid's grammar: blank lines and comments may come
 * first, then the keyword and at most one line break, then statements. A statement is a line of
 * text, with or without indentation, or a blank line. Each is ended by a blank line, a line break
 * or the end of the text, and any number of line breaks after that.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parseIshikawa(src: string, db: IshikawaDb): void {
  const tokens = tokenize(src)
  const token = (at: number): Token => tokens[at] ?? { end: src.length, start: src.length, t: T.End }
  const fail = (at: number, expected: string): CompileError => {
    const tok = token(at)
    const detail = `Expecting ${expected}, got '${tName(tok.t)}'`
    return errorSyntax('ishikawa', src, tok.start, detail, false)
  }
  const ends = (t: T): boolean => t === T.Spaceline || t === T.Nl || t === T.Eof

  let i = 0
  if (token(i).t === T.Spaceline) {
    i++
    while (token(i).t === T.Spaceline || token(i).t === T.Nl) i++
    if (token(i).t !== T.Ishikawa) throw fail(i, "'SPACELINE', 'NL', 'ISHIKAWA'")
  } else if (token(i).t !== T.Ishikawa) {
    throw fail(i, "'SPACELINE', 'ISHIKAWA'")
  }
  i++
  if (token(i).t === T.Nl) i++

  for (;;) {
    const t = token(i).t
    if (t === T.Text || (t === T.Spacelist && token(i + 1).t === T.Text)) {
      const text = t === T.Text ? i : i + 1
      i = text + 1
      if (!ends(token(i).t)) throw fail(i, STOP)
      let level = 0
      if (t !== T.Text) {
        const indent = token(text - 1)
        level = indent.end - indent.start
      }
      const body = token(text)
      ishikawaDbAddNode(db, level, trim(src.slice(body.start, body.end)))
    } else if (t === T.Spaceline || t === T.Spacelist) {
      i++
      if (!ends(token(i).t)) {
        throw t === T.Spacelist ? fail(i, "'SPACELINE', 'NL', 'EOF', 'TEXT'") : fail(i, STOP)
      }
    } else {
      throw fail(i, "'SPACELINE', 'SPACELIST', 'TEXT'")
    }
    i++
    while (token(i).t === T.Nl || token(i).t === T.Eof) i++
    if (token(i).t === T.End) return
  }
}
