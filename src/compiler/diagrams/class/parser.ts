/**
 * @module The class parser: a hand-written equivalent of Mermaid's Jison grammar. Port of Pele's
 * `src/diagrams/class/parser.ts`.
 */
import {
  type ClassDb,
  classDbAddAnnotation,
  classDbAddClass,
  classDbAddClassesToNamespace,
  classDbAddMember,
  classDbAddMembers,
  classDbAddNamespace,
  classDbAddNote,
  classDbAddRelation,
  classDbCleanupLabel,
  classDbDefineClass,
  classDbPopNamespace,
  classDbSetAccDescription,
  classDbSetAccTitle,
  classDbSetClassLabel,
  classDbSetClickEvent,
  classDbSetCssClass,
  classDbSetCssStyle,
  classDbSetDirection,
  classDbSetLink,
  classDbSetTooltip,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import type { RelationEnd } from './types.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'

/** The kinds that a name is made of. */
function isAlphaNum(t: T): boolean {
  return t === T.UnicodeText || t === T.Alpha || t === T.Minus
}

/** The kinds that make up a style declaration. */
function isStylePart(t: T): boolean {
  return t === T.Alpha || t === T.Colon || t === T.Brkt || t === T.Style || t === T.Pct || t === T.Label
}

/** Mermaid's relation type of an end marker token. */
function endType(t: T): number | undefined {
  switch (t) {
    case T.Aggregation:
      return 0
    case T.Extension:
      return 1
    case T.Composition:
      return 2
    case T.Dependency:
      return 3
    case T.Lollipop:
      return 4
    default:
      return undefined
  }
}

/** The kinds a name may start with, as Jison lists them. */
const NAME_TOKENS = "'UNICODE_TEXT', 'NUM', 'ALPHA', 'MINUS', 'BQUOTE_STR'"

/** A namespace being parsed, with what it holds. */
type Frame = {
  classes: string[]
  id: string
  notes: string[]
}

/** The parser's position in the token list. */
type Parser = {
  i: number
  src: string
  tokens: Token[]
}

/** The current token's kind. */
function kind(self: Parser): T {
  return kindAt(self, self.i)
}

/** The kind of token `i`. */
function kindAt(self: Parser, i: number): T {
  return self.tokens[i]?.kind ?? T.End
}

/** The current token's text. */
function text(self: Parser): string {
  return self.tokens[self.i]?.text ?? ''
}

/** Takes the current token's text. */
function take(self: Parser): string {
  const value = text(self)
  self.i += 1
  return value
}

/** Fails with Jison's wording, naming `expected`. */
function fail(self: Parser, expected: string): CompileError {
  const offset = self.tokens[self.i]?.start ?? self.src.length
  const t = kind(self)
  if (t === T.Error) return errorSyntax('class', self.src, offset, '', true)
  const detail = `Expecting ${expected}, got '${tName(t)}'`
  return errorSyntax('class', self.src, offset, detail, false)
}

/** Takes a token of `kind`, or fails. */
function expect(self: Parser, want: T): string {
  if (kind(self) !== want) throw fail(self, `'${tName(want)}'`)
  return take(self)
}

/** Takes one part of a name. */
function alphaNum(self: Parser): string {
  if (!isAlphaNum(kind(self))) throw fail(self, "'UNICODE_TEXT', 'NUM', 'ALPHA', 'MINUS'")
  return take(self)
}

/** A class name, dotted or in backticks, with its generic type when `generic`. */
function name(self: Parser, generic: boolean): string {
  let out = ''
  for (;;) {
    if (kind(self) === T.BquoteStr) {
      out += take(self)
      break
    }
    if (!isAlphaNum(kind(self))) throw fail(self, NAME_TOKENS)
    out += take(self)
    const t = kind(self)
    if (t === T.Dot) {
      out += '.'
      self.i += 1
    } else if (!isAlphaNum(t) && t !== T.BquoteStr) {
      break
    }
  }
  if (generic && kind(self) === T.Generictype) {
    out += `~${take(self)}~`
  }
  return out
}

/** A `["label"]` after a name. */
function classLabel(self: Parser): string {
  self.i += 1
  const label = expect(self, T.Str)
  expect(self, T.Sqe)
  return label
}

/** The member lines of a class body, through its closing brace. */
function members(self: Parser): string[] {
  if (kind(self) !== T.Member) throw fail(self, "'STRUCT_STOP', 'MEMBER'")
  const list: string[] = []
  while (kind(self) === T.Member) list.push(take(self))
  expect(self, T.StructStop)
  // The grammar collects members last to first and `addMembers` turns them back, so they
  // keep their order.
  return list
}

/** A `class` statement. Returns the class name as written. */
function classStatement(self: Parser, db: ClassDb): string {
  self.i += 1
  const id = name(self, true)
  classDbAddClass(db, id)
  if (kind(self) === T.Sqs) {
    const label = classLabel(self)
    classDbSetClassLabel(db, id, label)
  }
  switch (kind(self)) {
    case T.StyleSeparator: {
      self.i += 1
      const css = alphaNum(self)
      classDbSetCssClass(db, id, css)
      if (kind(self) === T.StructStart) {
        self.i += 1
        const list = members(self)
        classDbAddMembers(db, id, list)
      }
      break
    }
    case T.StructStart:
      self.i += 1
      if (kind(self) === T.StructStop) {
        self.i += 1
      } else {
        const list = members(self)
        classDbAddMembers(db, id, list)
      }
      break
    case T.AnnotationStart: {
      self.i += 1
      const annotation = alphaNum(self)
      expect(self, T.AnnotationEnd)
      classDbAddAnnotation(db, id, annotation)
      if (kind(self) === T.StructStart) {
        self.i += 1
        if (kind(self) === T.StructStop) {
          self.i += 1
        } else {
          const list = members(self)
          classDbAddMembers(db, id, list)
        }
      }
      break
    }
    default:
      break
  }
  return id
}

/** A `note` or `note for` statement. Returns the note's id. */
function noteStatement(self: Parser, db: ClassDb): string {
  const k = kind(self)
  self.i += 1
  if (k === T.Note) {
    const value = expect(self, T.Str)
    return classDbAddNote(db, value, undefined)
  }
  const id = name(self, true)
  const value = expect(self, T.Str)
  return classDbAddNote(db, value, id)
}

/** Namespaces nest, so they are parsed with a stack of open ones. */
function namespaceStatement(self: Parser, db: ClassDb): void {
  const open: Frame[] = []
  for (;;) {
    self.i += 1
    const ns = name(self, false)
    const id =
      kind(self) === T.Sqs ? classDbAddNamespace(db, ns, classLabel(self)) : classDbAddNamespace(db, ns, undefined)
    expect(self, T.StructStart)
    if (kind(self) === T.Newline) self.i += 1
    open.push({ classes: [], id, notes: [] })

    let item = true
    while (item) {
      const t = kind(self)
      if (t === T.Namespace) break
      if (t === T.Class) {
        const cls = classStatement(self, db)
        open[open.length - 1]?.classes.push(cls)
      } else if (t === T.Note || t === T.NoteFor) {
        const note = noteStatement(self, db)
        open[open.length - 1]?.notes.push(note)
      } else {
        throw fail(self, "'NAMESPACE', 'CLASS', 'NOTE_FOR', 'NOTE'")
      }

      for (;;) {
        if (kind(self) === T.Newline) {
          const next = kindAt(self, self.i + 1)
          if (next === T.Namespace || next === T.Class || next === T.Note || next === T.NoteFor) {
            self.i += 1
            break
          }
          self.i += 1
        }
        expect(self, T.StructStop)
        const done = open.pop()
        if (done !== undefined) classDbAddClassesToNamespace(db, done.id, done.classes, done.notes)
        classDbPopNamespace(db)
        if (open.length === 0) {
          item = false
          break
        }
      }
    }
    if (open.length === 0) return
  }
}

/** An optional end marker. */
function relationEnd(self: Parser): RelationEnd {
  const type = endType(kind(self))
  if (type === undefined) return { kind: 'None' }
  self.i += 1
  return { kind: 'Type', _0: type }
}

/** A statement that starts with a name: a member line, a relation, or a bare class. */
function classOrRelation(self: Parser, db: ClassDb): void {
  const id1 = name(self, true)
  let t = kind(self)
  if (t === T.Label) {
    const label = take(self)
    classDbAddMember(db, id1, classDbCleanupLabel(label))
    return
  }
  let title1 = 'none'
  if (t === T.Str) {
    title1 = take(self)
  } else if (endType(t) === undefined && t !== T.Line && t !== T.DottedLine) {
    return
  }
  const type1 = relationEnd(self)
  t = kind(self)
  if (t !== T.Line && t !== T.DottedLine) {
    throw fail(
      self,
      "'AGGREGATION', 'EXTENSION', 'COMPOSITION', 'DEPENDENCY', 'LOLLIPOP', 'LINE', 'DOTTED_LINE'",
    )
  }
  self.i += 1
  const type2 = relationEnd(self)
  const title2 = kind(self) === T.Str ? take(self) : 'none'
  const id2 = name(self, true)
  const title = kind(self) === T.Label ? classDbCleanupLabel(take(self)) : undefined
  classDbAddRelation(db, {
    id1,
    id2,
    lineType: t !== T.Line ? 1 : 0,
    relationTitle1: title1,
    relationTitle2: title2,
    title,
    type1,
    type2,
  })
}

/** Comma-separated style declarations. */
function styles(self: Parser): string[] {
  const out: string[] = []
  for (;;) {
    if (!isStylePart(kind(self))) {
      throw fail(self, "'ALPHA', 'NUM', 'COLON', 'UNIT', 'SPACE', 'BRKT', 'STYLE', 'PCT', 'LABEL'")
    }
    let s = take(self)
    while (isStylePart(kind(self))) s += take(self)
    out.push(s)
    if (kind(self) !== T.Comma) return out
    self.i += 1
  }
}

/** An optional tooltip string. */
function tooltip(self: Parser, db: ClassDb, id: string): void {
  if (kind(self) === T.Str) {
    const tip = take(self)
    classDbSetTooltip(db, id, tip)
  }
}

/** The address, tooltip, and target of a link. */
function linkStatement(self: Parser, db: ClassDb, id: string): void {
  const href = expect(self, T.Str)
  const tip = kind(self) === T.Str ? take(self) : undefined
  if (kind(self) === T.LinkTarget) {
    const target = take(self)
    classDbSetLink(db, id, href, target)
  } else {
    classDbSetLink(db, id, href, undefined)
  }
  classDbSetTooltip(db, id, tip)
}

/** One statement. */
function statement(self: Parser, db: ClassDb): void {
  const t = kind(self)
  switch (t) {
    case T.UnicodeText:
    case T.Alpha:
    case T.Minus:
    case T.BquoteStr:
      classOrRelation(self, db)
      return
    case T.Namespace:
      namespaceStatement(self, db)
      return
    case T.Class:
      classStatement(self, db)
      return
    case T.Member:
      self.i += 1
      return
    case T.AnnotationStart: {
      self.i += 1
      const annotation = alphaNum(self)
      expect(self, T.AnnotationEnd)
      const id = name(self, true)
      classDbAddAnnotation(db, id, annotation)
      return
    }
    case T.Callback: {
      self.i += 1
      const id = name(self, true)
      expect(self, T.Str)
      classDbSetClickEvent(db, id)
      tooltip(self, db, id)
      return
    }
    case T.Link: {
      self.i += 1
      const id = name(self, true)
      linkStatement(self, db, id)
      return
    }
    case T.Click: {
      self.i += 1
      const id = name(self, true)
      if (kind(self) === T.Href) {
        self.i += 1
        linkStatement(self, db, id)
        return
      }
      expect(self, T.CallbackName)
      if (kind(self) === T.CallbackArgs) self.i += 1
      classDbSetClickEvent(db, id)
      tooltip(self, db, id)
      return
    }
    case T.Style: {
      self.i += 1
      const id = expect(self, T.Alpha)
      const list = styles(self)
      classDbSetCssStyle(db, id, list)
      return
    }
    case T.Cssclass: {
      self.i += 1
      const ids = expect(self, T.Str)
      const className = expect(self, T.Alpha)
      classDbSetCssClass(db, ids, className)
      return
    }
    case T.Note:
    case T.NoteFor:
      noteStatement(self, db)
      return
    case T.Classdef: {
      self.i += 1
      const ids = [expect(self, T.Alpha)]
      while (kind(self) === T.Comma) {
        self.i += 1
        ids.push(expect(self, T.Alpha))
      }
      const list = styles(self)
      classDbDefineClass(db, ids, list)
      return
    }
    case T.DirectionTb:
    case T.DirectionBt:
    case T.DirectionRl:
    case T.DirectionLr:
      self.i += 1
      classDbSetDirection(
        db,
        t === T.DirectionTb ? 'TB' : t === T.DirectionBt ? 'BT' : t === T.DirectionRl ? 'RL' : 'LR',
      )
      return
    case T.AccTitle: {
      self.i += 1
      const value = expect(self, T.AccTitleValue)
      classDbSetAccTitle(db, trim(value))
      return
    }
    case T.AccDescr: {
      self.i += 1
      const value = expect(self, T.AccDescrValue)
      classDbSetAccDescription(db, trim(value))
      return
    }
    case T.AccDescrMultilineValue: {
      const value = take(self)
      classDbSetAccDescription(db, trim(value))
      return
    }
    default:
      throw fail(
        self,
        "'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'NAMESPACE', 'ANNOTATION_START', 'CLASS', 'MEMBER', 'NOTE_FOR', 'NOTE', 'CLASSDEF', 'direction_tb', 'CALLBACK', 'LINK', 'CLICK', 'STYLE', 'CSSCLASS', 'ALPHA', 'MINUS', 'BQUOTE_STR'",
      )
  }
}

/**
 * Parses a class diagram into `db`, as Pele's `parseClassDiagram` does.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parseClassDiagram(src: string, db: ClassDb): void {
  const tokens = tokenize(src)
  const p: Parser = { i: 0, src, tokens }

  // Mermaid's grammar also accepts statements with no `classDiagram` line before them.
  const header = kind(p) === T.ClassDiagram
  if (header) {
    p.i += 1
    expect(p, T.Newline)
  }
  for (;;) {
    statement(p, db)
    if (kind(p) !== T.Newline) break
    p.i += 1
    const k = kind(p)
    if (k === T.Eof || k === T.End) break
  }
  if (header) expect(p, T.Eof)
  expect(p, T.End)
}
