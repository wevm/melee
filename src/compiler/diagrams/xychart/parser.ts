/** @module The XY chart parser. Port of Pele's `src/diagrams/xychart/parser.ts`. */
import {
  type DataPoint,
  type XyChartDb,
  xyChartDbSetAccDescription,
  xyChartDbSetAccTitle,
  xyChartDbSetBarData,
  xyChartDbSetDiagramTitle,
  xyChartDbSetLineData,
  xyChartDbSetOrientation,
  xyChartDbSetXAxisBand,
  xyChartDbSetXAxisRangeData,
  xyChartDbSetXAxisTitle,
  xyChartDbSetYAxisRangeData,
  xyChartDbSetYAxisTitle,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { parse as parseFloat } from '../../util/float.ts'

/** Tokens that continue a text. */
function isWord(t: T): boolean {
  return (
    t === T.Amp ||
    t === T.Num ||
    t === T.Alpha ||
    t === T.Plus ||
    t === T.Equals ||
    t === T.Mult ||
    t === T.Dot ||
    t === T.Brkt ||
    t === T.Minus ||
    t === T.Underscore
  )
}

/** Tokens that end a statement. */
function isEol(t: T): boolean {
  return t === T.Newline || t === T.Semi || t === T.Eof
}

/** Tokens a text may start with. */
function isText(t: T): boolean {
  return t === T.Str || isWord(t)
}

/** Parser state over the token list. */
type Parser = {
  i: number
  src: string
  tokens: Token[]
}

function parserT(p: Parser): T {
  return p.tokens[p.i]?.t ?? T.End
}

function parserTextAt(p: Parser, at: number): string {
  const token = p.tokens[at]
  return token === undefined ? '' : p.src.slice(token.start, token.end)
}

function parserTake(p: Parser): string {
  const text = parserTextAt(p, p.i)
  p.i += 1
  return text
}

function parserFail(p: Parser, expected: string): CompileError {
  const start = p.tokens[p.i]?.start ?? p.src.length
  const t = parserT(p)
  if (t === T.Error) return errorSyntax('xychart', p.src, start, '', true)
  const detail = `Expecting ${expected}, got '${tName(t)}'`
  return errorSyntax('xychart', p.src, start, detail, false)
}

function parserExpect(p: Parser, t: T): string {
  if (parserT(p) !== t) throw parserFail(p, `'${tName(t)}'`)
  return parserTake(p)
}

function parserText(p: Parser): string {
  if (!isText(parserT(p))) throw parserFail(p, "'STR', 'ALPHA', 'NUM'")
  const quoted = parserT(p) === T.Str
  let text = parserTake(p)
  if (!quoted) {
    while (isWord(parserT(p))) text += parserTake(p)
  }
  return text
}

function parserNumber(p: Parser): number {
  return parseFloat(parserExpect(p, T.NumberWithDecimal)) ?? Number.NaN
}

function parserRange(p: Parser): [number, number] {
  const min = parserNumber(p)
  parserExpect(p, T.ArrowDelimiter)
  return [min, parserNumber(p)]
}

function parserPoints(p: Parser): DataPoint[] {
  const out: DataPoint[] = []
  parserExpect(p, T.SquareBracesStart)
  for (;;) {
    const value = parserNumber(p)
    const label = parserT(p) === T.Str ? parserTake(p) : ''
    out.push({ label, value })
    if (parserT(p) !== T.Comma) break
    p.i += 1
  }
  parserExpect(p, T.SquareBracesEnd)
  return out
}

/**
 * Parses an XY chart into `db`, following the parser Jison generates from Mermaid's grammar.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parseXychart(src: string, db: XyChartDb): void {
  const p: Parser = { i: 0, src, tokens: tokenize(src) }

  for (;;) {
    if (isEol(parserT(p))) {
      p.i += 1
    } else if (parserT(p) !== T.Xychart) {
      break
    } else {
      p.i += 1
      if (parserT(p) === T.ChartOrientation) {
        const orientation = parserTake(p)
        xyChartDbSetOrientation(db, orientation)
      }
    }
  }

  while (parserT(p) !== T.End) {
    const t = parserT(p)
    p.i += 1
    switch (t) {
      case T.Title: {
        const text = parserText(p)
        xyChartDbSetDiagramTitle(db, trim(text))
        break
      }
      case T.XAxis:
      case T.YAxis: {
        const title = isText(parserT(p)) ? parserText(p) : undefined
        if (t === T.XAxis && parserT(p) === T.SquareBracesStart) {
          const categories: string[] = []
          for (;;) {
            p.i += 1
            categories.push(parserText(p))
            if (parserT(p) !== T.Comma) break
          }
          parserExpect(p, T.SquareBracesEnd)
          xyChartDbSetXAxisBand(db, categories)
        } else if (parserT(p) === T.NumberWithDecimal || title === undefined) {
          const [min, max] = parserRange(p)
          if (t === T.XAxis) xyChartDbSetXAxisRangeData(db, min, max)
          else xyChartDbSetYAxisRangeData(db, min, max)
        }
        const text = title ?? ''
        if (t === T.XAxis) xyChartDbSetXAxisTitle(db, text)
        else xyChartDbSetYAxisTitle(db, text)
        break
      }
      case T.Line:
      case T.Bar: {
        const title = parserT(p) === T.SquareBracesStart ? '' : parserText(p)
        const data = parserPoints(p)
        if (t === T.Line) xyChartDbSetLineData(db, title, data)
        else xyChartDbSetBarData(db, title, data)
        break
      }
      case T.AccTitle: {
        const value = parserExpect(p, T.AccTitleValue)
        xyChartDbSetAccTitle(db, trim(value))
        break
      }
      case T.AccDescr: {
        const value = parserExpect(p, T.AccDescrValue)
        xyChartDbSetAccDescription(db, trim(value))
        break
      }
      case T.AccDescrMultilineValue: {
        const value = parserTextAt(p, p.i - 1)
        xyChartDbSetAccDescription(db, trim(value))
        break
      }
      default:
        p.i -= 1
        throw parserFail(
          p,
          "'title', 'X_AXIS', 'Y_AXIS', 'LINE', 'BAR', 'acc_title', 'acc_descr', 'acc_descr_multiline_value'",
        )
    }
    while (isEol(parserT(p))) p.i += 1
  }
}
