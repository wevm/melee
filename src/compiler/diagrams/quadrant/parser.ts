/** @module The quadrant chart parser. Port of Pele's `src/diagrams/quadrant/parser.ts`. */
import {
  type QuadrantDb,
  type QuadrantText,
  quadrantDbAddClass,
  quadrantDbAddPoint,
  quadrantDbSetAccDescription,
  quadrantDbSetAccTitle,
  quadrantDbSetDiagramTitle,
  quadrantDbSetQuadrantText,
  quadrantDbSetXAxisLeftText,
  quadrantDbSetXAxisRightText,
  quadrantDbSetYAxisBottomText,
  quadrantDbSetYAxisTopText,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'

/** Tokens that continue a label. */
function isWord(t: T): boolean {
  return (
    t === T.Punctuation ||
    t === T.Amp ||
    t === T.Num ||
    t === T.Alpha ||
    t === T.Comma ||
    t === T.Plus ||
    t === T.Equals ||
    t === T.Mult ||
    t === T.Dot ||
    t === T.Brkt ||
    t === T.Underscore ||
    t === T.UnicodeText
  )
}

/** Tokens of a class name. */
function isId(t: T): boolean {
  return (
    t === T.Alpha ||
    t === T.Num ||
    t === T.Minus ||
    t === T.Comma ||
    t === T.Colon ||
    t === T.Amp ||
    t === T.Brkt ||
    t === T.Mult ||
    t === T.UnicodeText
  )
}

/** Tokens of a style. */
function isStyle(t: T): boolean {
  return t === T.Alpha || t === T.Num || t === T.Colon || t === T.Space || t === T.Brkt || t === T.Minus
}

/** Tokens that end a statement. */
function isEol(t: T): boolean {
  return t === T.Newline || t === T.Semi || t === T.Eof
}

/** Tokens a label may start with. */
function isText(t: T): boolean {
  return t === T.Str || t === T.MdStr || isWord(t)
}

const TEXT_TOKENS = "'STR', 'MD_STR', 'ALPHA', 'NUM', 'UNICODE_TEXT', 'PUNCTUATION'"

/** Parser state over the token list. */
type Parser = {
  i: number
  src: string
  tokens: Token[]
}

function parserT(p: Parser): T {
  return p.tokens[p.i]?.t ?? T.End
}

function parserText(p: Parser): string {
  const token = p.tokens[p.i]
  return token === undefined ? '' : p.src.slice(token.start, token.end)
}

function parserTake(p: Parser): string {
  const text = parserText(p)
  p.i += 1
  return text
}

function parserFail(p: Parser, expected: string): CompileError {
  const start = p.tokens[p.i]?.start ?? p.src.length
  const t = parserT(p)
  if (t === T.Error) return errorSyntax('quadrantChart', p.src, start, '', true)
  const detail = `Expecting ${expected}, got '${tName(t)}'`
  return errorSyntax('quadrantChart', p.src, start, detail, false)
}

function parserExpect(p: Parser, t: T): string {
  if (parserT(p) !== t) throw parserFail(p, `'${tName(t)}'`)
  return parserTake(p)
}

function parserLabel(p: Parser): QuadrantText {
  const first = parserT(p)
  if (!isText(first)) throw parserFail(p, TEXT_TOKENS)
  let text = parserTake(p)
  while (isWord(parserT(p)) || parserT(p) === T.Space || parserT(p) === T.Minus) text += parserTake(p)
  return { markdown: first === T.MdStr, text }
}

function parserStyles(p: Parser): string[] {
  const out: string[] = []
  for (;;) {
    if (!isStyle(parserT(p))) throw parserFail(p, "'ALPHA', 'NUM', 'COLON', 'SPACE', 'BRKT', 'MINUS'")
    let style = parserTake(p)
    while (isStyle(parserT(p))) style += parserTake(p)
    out.push(trim(style))
    if (parserT(p) !== T.Comma) return out
    p.i += 1
  }
}

/**
 * Parses a quadrant chart into `db`, following the parser Jison generates from Mermaid's grammar.
 *
 * Throws a syntax error for input Mermaid rejects, and a semantic error for an invalid point
 * style.
 */
export function parseQuadrant(src: string, db: QuadrantDb): void {
  const p: Parser = { i: 0, src, tokens: tokenize(src) }

  while (isEol(parserT(p)) || parserT(p) === T.Space) p.i += 1
  parserExpect(p, T.Quadrant)

  while (parserT(p) !== T.End) {
    while (parserT(p) === T.Space) p.i += 1
    const t = parserT(p)
    switch (t) {
      case T.Classdef: {
        p.i += 1
        parserExpect(p, T.Space)
        if (!isId(parserT(p))) throw parserFail(p, "'ALPHA', 'NUM', 'UNICODE_TEXT'")
        let id = parserTake(p)
        while (isId(parserT(p))) id += parserTake(p)
        parserExpect(p, T.Space)
        const styles = parserStyles(p)
        quadrantDbAddClass(db, id, styles)
        break
      }
      case T.XAxis:
      case T.YAxis: {
        p.i += 1
        const from = parserLabel(p)
        let to: QuadrantText | undefined
        if (parserT(p) === T.Delimiter) {
          p.i += 1
          if (isText(parserT(p))) to = parserLabel(p)
          else from.text += ' ⟶ '
        }
        if (t === T.XAxis) {
          quadrantDbSetXAxisLeftText(db, from)
          if (to !== undefined) quadrantDbSetXAxisRightText(db, to)
        } else {
          quadrantDbSetYAxisBottomText(db, from)
          if (to !== undefined) quadrantDbSetYAxisTopText(db, to)
        }
        break
      }
      case T.Quadrant1:
      case T.Quadrant2:
      case T.Quadrant3:
      case T.Quadrant4: {
        p.i += 1
        const label = parserLabel(p)
        const index = t === T.Quadrant1 ? 0 : t === T.Quadrant2 ? 1 : t === T.Quadrant3 ? 2 : 3
        quadrantDbSetQuadrantText(db, index, label)
        break
      }
      case T.Title: {
        p.i += 1
        const value = parserExpect(p, T.TitleValue)
        quadrantDbSetDiagramTitle(db, trim(value))
        break
      }
      case T.AccTitle: {
        p.i += 1
        const value = parserExpect(p, T.AccTitleValue)
        quadrantDbSetAccTitle(db, trim(value))
        break
      }
      case T.AccDescr: {
        p.i += 1
        const value = parserExpect(p, T.AccDescrValue)
        quadrantDbSetAccDescription(db, trim(value))
        break
      }
      case T.AccDescrMultilineValue: {
        const value = parserTake(p)
        quadrantDbSetAccDescription(db, trim(value))
        break
      }
      default:
        if (isText(t)) {
          const label = parserLabel(p)
          const className = parserT(p) === T.ClassName ? parserTake(p) : ''
          parserExpect(p, T.PointStart)
          const x = parserExpect(p, T.PointX)
          const y = parserExpect(p, T.PointY)
          const styles = isStyle(parserT(p)) ? parserStyles(p) : []
          quadrantDbAddPoint(db, label, className, x, y, styles)
        }
    }
    if (!isEol(parserT(p))) throw parserFail(p, "'NEWLINE', 'SEMI', 'EOF'")
    p.i += 1
  }
}
