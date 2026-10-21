/**
 * @module The requirement parser: a hand-written equivalent of Mermaid's Jison grammar. Port of
 * Pele's `src/diagrams/requirement/parser.ts`.
 */
import {
  type RequirementDb,
  requirementDbAddElement,
  requirementDbAddRelationship,
  requirementDbAddRequirement,
  requirementDbDefineClass,
  requirementDbSetAccDescription,
  requirementDbSetAccTitle,
  requirementDbSetClass,
  requirementDbSetCssStyle,
  requirementDbSetDirection,
  requirementDbSetNewElementDocRef,
  requirementDbSetNewElementType,
  requirementDbSetNewReqId,
  requirementDbSetNewReqRisk,
  requirementDbSetNewReqText,
  requirementDbSetNewReqVerifyMethod,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName, tThrough } from './tokens.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'

/** What the keyword tokens stand for, from {@link T.Requirement} to {@link T.Traces} in token order. */
const VALUES: string[] = [
  'Requirement',
  'Functional Requirement',
  'Interface Requirement',
  'Performance Requirement',
  'Physical Requirement',
  'Design Constraint',
  'Low',
  'Medium',
  'High',
  'Analysis',
  'Demonstration',
  'Inspection',
  'Test',
  '',
  'contains',
  'copies',
  'derives',
  'satisfies',
  'verifies',
  'refines',
  'traces',
]

function isStylePart(t: T): boolean {
  return t === T.Alpha || t === T.Colon || t === T.Brkt || t === T.Minus || t === T.Semicolon
}

/** The parser's position in the token list. */
type Parser = {
  i: number
  src: string
  tokens: Token[]
}

function kind(self: Parser): T {
  return self.tokens[self.i]?.kind ?? T.End
}

function text(self: Parser): string {
  return self.tokens[self.i]?.text ?? ''
}

/** Fails with Jison's wording, naming the token kinds `from` to `to` and `others` as expected. */
function fail(self: Parser, from: T, to: T, others: T[]): CompileError {
  const offset = self.tokens[self.i]?.start ?? self.src.length
  const t = kind(self)
  if (t === T.Error) return errorSyntax('requirement', self.src, offset, '', true)
  let detail = 'Expecting '
  const kinds = tThrough(from, to).concat(others)
  for (let k = 0; k < kinds.length; k++) {
    if (k > 0) detail += ', '
    detail += `'${tName(kinds[k] as T)}'`
  }
  detail += `, got '${tName(t)}'`
  return errorSyntax('requirement', self.src, offset, detail, false)
}

function expect(self: Parser, k: T): string {
  if (kind(self) !== k) throw fail(self, k, k, [])
  const value = text(self)
  self.i += 1
  return value
}

/** The value of the next token if it is a keyword in the given range of token kinds. */
function keyword(self: Parser, from: T, to: T): string {
  const t = kind(self)
  if (t < from || t > to) throw fail(self, from, to, [])
  self.i += 1
  return VALUES[t - T.Requirement] ?? ''
}

function string(self: Parser): string {
  const t = kind(self)
  if (t !== T.UnqString && t !== T.QString) throw fail(self, T.QString, T.UnqString, [])
  const value = text(self)
  self.i += 1
  return value
}

function directive(self: Parser, db: RequirementDb): boolean {
  switch (kind(self)) {
    case T.AccTitle:
      self.i += 1
      requirementDbSetAccTitle(db, trim(expect(self, T.AccTitleValue)))
      break
    case T.AccDescr:
      self.i += 1
      requirementDbSetAccDescription(db, trim(expect(self, T.AccDescrValue)))
      break
    case T.AccDescrMultilineValue:
      requirementDbSetAccDescription(db, trim(text(self)))
      self.i += 1
      break
    default:
      return false
  }
  return true
}

function idList(self: Parser): string[] {
  const list: string[] = []
  for (;;) {
    const t = kind(self)
    if (t !== T.Alpha && t !== T.UnqString && t !== T.QString) throw fail(self, T.QString, T.UnqString, [T.Alpha])
    list.push(text(self))
    self.i += 1
    if (kind(self) !== T.Comma) return list
    self.i += 1
  }
}

function stylesOpt(self: Parser): string[] {
  const styles: string[] = []
  for (;;) {
    if (!isStylePart(kind(self))) throw fail(self, T.Alpha, T.Semicolon, [T.Minus, T.Brkt])
    let style = text(self)
    self.i += 1
    while (isStylePart(kind(self))) {
      style += text(self)
      self.i += 1
    }
    styles.push(style)
    if (kind(self) !== T.Comma) return styles
    self.i += 1
  }
}

function classList(self: Parser): string[] | undefined {
  let classes: string[] | undefined
  switch (kind(self)) {
    case T.StyleSeparator:
      self.i += 1
      classes = idList(self)
      expect(self, T.StructStart)
      break
    case T.StructStart:
      self.i += 1
      break
    default:
      throw fail(self, T.StructStart, T.StructStart, [T.StyleSeparator])
  }
  expect(self, T.Newline)
  return classes
}

/**
 * Reads a body up to its closing brace. The grammar is right recursive, so Mermaid applies the
 * fields last to first and the first of two repeated fields wins.
 */
function body(self: Parser, db: RequirementDb, requirement: boolean): void {
  const fields: [T, string][] = []
  for (;;) {
    const t = kind(self)
    if (t === T.StructStop) {
      self.i += 1
      break
    }
    if (t === T.Newline) {
      self.i += 1
      continue
    }
    const field = requirement ? t >= T.Id && t <= T.Verifymthd : t === T.Type || t === T.Docref
    if (!field) {
      if (requirement) throw fail(self, T.Id, T.Verifymthd, [T.Newline, T.StructStop])
      throw fail(self, T.Type, T.Docref, [T.Newline, T.StructStop])
    }
    self.i += 1
    expect(self, T.Colonsep)
    let value: string
    switch (t) {
      case T.Risk:
        value = keyword(self, T.LowRisk, T.HighRisk)
        break
      case T.Verifymthd:
        value = keyword(self, T.VerifyAnalysis, T.VerifyTest)
        break
      default:
        value = string(self)
    }
    fields.push([t, value])
    expect(self, T.Newline)
  }
  for (let k = fields.length - 1; k >= 0; k--) {
    const [field, value] = fields[k] as [T, string]
    switch (field) {
      case T.Id:
        requirementDbSetNewReqId(db, value)
        break
      case T.Text:
        requirementDbSetNewReqText(db, value)
        break
      case T.Risk:
        requirementDbSetNewReqRisk(db, value)
        break
      case T.Verifymthd:
        requirementDbSetNewReqVerifyMethod(db, value)
        break
      case T.Type:
        requirementDbSetNewElementType(db, value)
        break
      default:
        requirementDbSetNewElementDocRef(db, value)
    }
  }
}

/**
 * Parses requirement diagram source into `db`.
 *
 * @throws {CompileError} A syntax error, with Mermaid's message, where the source leaves the
 *   grammar, and a limit error when classes copy too many declarations.
 */
export function parseRequirement(src: string, db: RequirementDb): void {
  const tokens = tokenize(src)
  const p: Parser = { i: 0, src, tokens }

  while (directive(p, db)) {
    if (kind(p) === T.Newline) p.i += 1
  }
  if (kind(p) !== T.Rd) throw fail(p, T.Rd, T.Rd, [T.AccTitle, T.AccDescr, T.AccDescrMultilineValue])
  p.i += 1
  expect(p, T.Newline)

  for (;;) {
    const t = kind(p)
    if (t === T.Eof) return
    if (t === T.Newline) {
      p.i += 1
    } else if (directive(p, db)) {
      // Handled.
    } else if (t >= T.DirectionTb && t <= T.DirectionLr) {
      p.i += 1
      requirementDbSetDirection(
        db,
        t === T.DirectionTb ? 'TB' : t === T.DirectionBt ? 'BT' : t === T.DirectionRl ? 'RL' : 'LR',
      )
    } else if (t >= T.Requirement && t <= T.DesignConstraint) {
      const type = keyword(p, T.Requirement, T.DesignConstraint)
      const name = string(p)
      const classes = classList(p)
      body(p, db, true)
      requirementDbAddRequirement(db, name, type)
      if (classes !== undefined) requirementDbSetClass(db, [name], classes)
    } else if (t === T.Element) {
      p.i += 1
      const name = string(p)
      const classes = classList(p)
      body(p, db, false)
      requirementDbAddElement(db, name)
      if (classes !== undefined) requirementDbSetClass(db, [name], classes)
    } else if (t === T.Style) {
      p.i += 1
      const ids = idList(p)
      const styles = stylesOpt(p)
      requirementDbSetCssStyle(db, ids, styles)
    } else if (t === T.Classdef) {
      p.i += 1
      const ids = idList(p)
      const styles = stylesOpt(p)
      requirementDbDefineClass(db, ids, styles)
    } else if (t === T.Class) {
      p.i += 1
      const ids = idList(p)
      const classes = idList(p)
      requirementDbSetClass(db, ids, classes)
    } else if (t === T.UnqString || t === T.QString) {
      const id = text(p)
      p.i += 1
      const next = kind(p)
      if (next === T.StyleSeparator) {
        p.i += 1
        const classes = idList(p)
        requirementDbSetClass(db, [id], classes)
      } else if (next === T.EndArrowL || next === T.Line) {
        p.i += 1
        const relationship = keyword(p, T.Contains, T.Traces)
        expect(p, next === T.Line ? T.EndArrowR : T.Line)
        const other = string(p)
        if (next === T.Line) requirementDbAddRelationship(db, relationship, id, other)
        else requirementDbAddRelationship(db, relationship, other, id)
      } else {
        throw fail(p, T.StyleSeparator, T.StyleSeparator, [T.EndArrowL, T.Line])
      }
    } else {
      throw fail(p, T.Newline, T.Eof, [
        T.AccTitle,
        T.AccDescr,
        T.AccDescrMultilineValue,
        T.DirectionTb,
        T.DirectionBt,
        T.DirectionRl,
        T.DirectionLr,
        T.Requirement,
        T.FunctionalRequirement,
        T.InterfaceRequirement,
        T.PerformanceRequirement,
        T.PhysicalRequirement,
        T.DesignConstraint,
        T.Element,
        T.Classdef,
        T.Class,
        T.Style,
        T.UnqString,
        T.QString,
      ])
    }
  }
}
