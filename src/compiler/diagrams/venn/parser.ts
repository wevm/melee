/**
 * @module The venn parser: a port of Mermaid's venn grammar. Port of Pele's
 * `src/diagrams/venn/parser.ts`.
 *
 * A token is read only when the grammar has to look at one to decide, because the lexer asks the
 * model whether an indented `text` continues a set, and the statements are what tell the model so.
 */
import {
  type VennDb,
  semantic,
  vennDbAddStyleData,
  vennDbAddSubsetData,
  vennDbAddTextData,
  vennDbCurrentSets,
  vennDbSetDiagramTitle,
  vennDbSetIndentMode,
  vennDbValidateUnionIdentifiers,
} from './db.ts'
import { T, type VennLexer, tName, vennLexerNew, vennLexerNext } from './lexer.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { parse } from '../../util/float.ts'

const STATEMENT = "'EOF', 'NEWLINE', 'TITLE', 'SET', 'UNION', 'TEXT', 'INDENT_TEXT', 'STYLE'"
const VALUE = "'NUMERIC', 'IDENTIFIER', 'STRING', 'HEXCOLOR', 'RGBCOLOR', 'RGBACOLOR'"

/** Parser state: the lexer, the token read ahead, and the model it builds. */
type Parser = {
  db: VennDb
  kind: T | undefined
  lexer: VennLexer
  src: string
}

function peek(p: Parser): T {
  if (p.kind !== undefined) return p.kind
  const kind = vennLexerNext(p.lexer, p.db)
  p.kind = kind
  return kind
}

function fail(p: Parser, expected: string): CompileError {
  const kind = peek(p)
  if (kind === T.Error) return errorSyntax('venn', p.src, p.lexer.start, '', true)
  const detail = `Expecting ${expected}, got '${tName(kind)}'`
  return errorSyntax('venn', p.src, p.lexer.start, detail, false)
}

function take(p: Parser): string {
  p.kind = undefined
  return p.lexer.text
}

function expect(p: Parser, wanted: T): string {
  if (peek(p) !== wanted) throw fail(p, `'${tName(wanted)}'`)
  return take(p)
}

function identifier(p: Parser): string {
  const kind = peek(p)
  if (kind !== T.Identifier && kind !== T.String) throw fail(p, "'IDENTIFIER', 'STRING'")
  return take(p)
}

function identifiers(p: Parser): string[] {
  const list = [identifier(p)]
  while (peek(p) === T.Comma) {
    take(p)
    list.push(identifier(p))
  }
  return list
}

function subset(p: Parser, ids: string[], union: boolean): void {
  const label = peek(p) === T.BracketLabel ? take(p) : undefined
  let size: number | undefined
  if (peek(p) === T.Colon) {
    take(p)
    size = parseFloat(expect(p, T.Numeric))
  }
  if (union) {
    if (ids.length < 2) throw semantic('union requires multiple identifiers')
    vennDbValidateUnionIdentifiers(p.db, ids)
  }
  vennDbAddSubsetData(p.db, ids, label, size)
  vennDbSetIndentMode(p.db, true)
}

/**
 * The id of a text, and the label in brackets that an id which is not a number may carry. `ids`
 * are the sets of the region, or `undefined` for those of the last set or union.
 */
function text(p: Parser, ids: string[] | undefined): void {
  const kind = peek(p)
  if (kind !== T.Identifier && kind !== T.String && kind !== T.Numeric) {
    throw fail(p, "'NUMERIC', 'IDENTIFIER', 'STRING'")
  }
  const id = take(p)
  const label = kind !== T.Numeric && peek(p) === T.BracketLabel ? take(p) : undefined
  if (ids !== undefined) {
    vennDbAddTextData(p.db, ids, id, label)
    return
  }
  const current = vennDbCurrentSets(p.db)
  if (current === undefined) throw semantic('text requires set')
  vennDbAddTextData(p.db, current.slice(), id, label)
}

function style(p: Parser): void {
  const ids = identifiers(p)
  const styles: [string, string][] = []
  for (;;) {
    const key = expect(p, T.Identifier)
    expect(p, T.Colon)
    let value: string
    if (peek(p) === T.String) value = take(p)
    else {
      const parts: string[] = []
      for (;;) {
        const kind = peek(p)
        if (
          kind !== T.Identifier &&
          kind !== T.Numeric &&
          kind !== T.HexColor &&
          kind !== T.RgbColor &&
          kind !== T.RgbaColor
        ) {
          break
        }
        parts.push(take(p))
      }
      if (parts.length === 0) throw fail(p, VALUE)
      value = parts.join(' ')
    }
    styles.push([key, value])
    if (peek(p) !== T.Comma) break
    take(p)
  }
  vennDbAddStyleData(p.db, ids, styles)
}

/** JavaScript's `parseFloat` of a numeric token: an optional sign, digits, and a fraction. */
function parseFloat(text: string): number {
  return parse(text) ?? Number.NaN
}

/**
 * Parses preprocessed venn diagram `src` into `db`.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for a union of one set or
 * of unknown sets, and for an indented text before any set.
 */
export function parseVenn(src: string, db: VennDb): void {
  const p: Parser = { db, kind: undefined, lexer: vennLexerNew(src), src }

  while (peek(p) === T.Newline) take(p)
  expect(p, T.Venn)
  for (;;) {
    const statement = peek(p)
    if (statement === T.Eof) return
    if (statement < T.Newline || statement > T.Style || statement === T.Venn) throw fail(p, STATEMENT)
    const text_ = take(p)
    switch (statement) {
      case T.Title: {
        // The token starts with `title` and one whitespace character.
        const rest = text_.slice(5)
        const first = rest.codePointAt(0)
        const skip = first === undefined ? 0 : first > 0xffff ? 2 : 1
        vennDbSetDiagramTitle(p.db, rest.slice(skip))
        break
      }
      case T.Set: {
        const id = identifier(p)
        subset(p, [id], false)
        break
      }
      case T.Union: {
        const ids = identifiers(p)
        subset(p, ids, true)
        break
      }
      case T.Text: {
        const ids = identifiers(p)
        text(p, ids)
        break
      }
      case T.IndentText:
        text(p, undefined)
        break
      case T.Style:
        style(p)
        break
      default:
        break
    }
  }
}
