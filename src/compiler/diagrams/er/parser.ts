/**
 * @module The ER parser: a hand-written equivalent of Mermaid's Jison grammar. Port of Pele's
 * `src/diagrams/er/parser.ts`.
 */
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'
import {
  type ErDb,
  erDbAddAttributes,
  erDbAddClass,
  erDbAddCssStyles,
  erDbAddEntity,
  erDbAddRelationship,
  erDbAddSubGraph,
  erDbSetAccDescription,
  erDbSetAccTitle,
  erDbSetClass,
  erDbSetDirection,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import { Cardinality, type DocItem, type ErAttribute, type RelSpec } from './types.ts'

/** The cardinality a token stands for. */
function cardinality(t: T): Cardinality | undefined {
  switch (t) {
    case T.ZeroOrOne:
      return Cardinality.ZeroOrOne
    case T.ZeroOrMore:
      return Cardinality.ZeroOrMore
    case T.OneOrMore:
      return Cardinality.OneOrMore
    case T.OnlyOne:
      return Cardinality.OnlyOne
    case T.MdParent:
      return Cardinality.MdParent
    default:
      return undefined
  }
}

/** Whether a token can be an entity name. */
function isName(t: T): boolean {
  return t === T.UnicodeText || t === T.EntityName || t === T.Num || t === T.DecimalNum || t === T.EntityOne
}

/** Whether a token can be part of a style declaration. */
function isStyleComponent(t: T): boolean {
  return t === T.StyleText || t === T.Num || t === T.Colon || t === T.Brkt
}

/** The kinds an entity name may be, as Jison lists them. */
const NAME = "'UNICODE_TEXT', 'NUM', 'ENTITY_NAME', 'DECIMAL_NUM', 'ENTITY_ONE'"
/** The cardinality kinds, as Jison lists them. */
const CARDS = "'ZERO_OR_ONE', 'ZERO_OR_MORE', 'ONE_OR_MORE', 'ONLY_ONE', 'MD_PARENT'"
/** The kinds a statement may start with, as Jison lists them. */
const LINE =
  "'EOF', 'NEWLINE', 'title', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'SUBGRAPH', 'direction_tb', 'direction_bt', 'direction_rl', 'direction_lr', 'CLASSDEF', 'CLASS', 'STYLE', 'UNICODE_TEXT', 'NUM', 'ENTITY_NAME', 'DECIMAL_NUM', 'ENTITY_ONE'"

/** `text` without its first and last characters, as `slice(1, -1)` leaves a quoted string. */
function unquote(text: string): string {
  if (text.length === 0) return text
  const first = (text.codePointAt(0) as number) > 0xffff ? 2 : 1
  let end = text.length
  if (end <= first) return ''
  const lastUnit = text.charCodeAt(end - 1)
  const before = end - 2 >= first ? text.charCodeAt(end - 2) : -1
  end -= lastUnit >= 0xdc00 && lastUnit <= 0xdfff && before >= 0xd800 && before <= 0xdbff ? 2 : 1
  return text.slice(first, end)
}

/**
 * A subgraph being parsed: what Mermaid's grammar hands to `addSubGraph`, the value of every
 * statement inside. Besides entity names that includes accessibility text and the keywords
 * `style`, `class`, and `classDef`.
 */
type Frame = {
  id: string
  list: DocItem[]
  title: string
}

/** The parser's position in the token list. */
type Parser = {
  i: number
  src: string
  tokens: Token[]
}

/** The current token's kind. */
function kind(self: Parser): T {
  return self.tokens[self.i]?.kind ?? T.End
}

/** The current token's text. */
function text(self: Parser): string {
  return self.tokens[self.i]?.text ?? ''
}

/** Takes the current token's text. */
function take(self: Parser): string {
  const t = text(self)
  self.i += 1
  return t
}

/** Fails with Jison's wording, naming `expected`. */
function fail(self: Parser, expected: string): CompileError {
  const offset = self.tokens[self.i]?.start ?? self.src.length
  const t = kind(self)
  if (t === T.Error) return errorSyntax('er', self.src, offset, '', true)
  const detail = `Expecting ${expected}, got '${t === T.Char ? text(self) : tName(t)}'`
  return errorSyntax('er', self.src, offset, detail, false)
}

/** Takes a token of `k`, or fails. */
function expect(self: Parser, k: T): string {
  if (kind(self) !== k) throw fail(self, `'${tName(k)}'`)
  return take(self)
}

/** The end of a statement. */
function separator(self: Parser): void {
  const t = kind(self)
  if (!(t === T.Newline || t === T.Semi || t === T.Eof)) throw fail(self, "'EOF', 'NEWLINE', 'SEMI'")
  self.i += 1
}

/** An entity name, without its quotes. */
function entityName(self: Parser): string {
  const t = kind(self)
  if (!isName(t)) throw fail(self, NAME)
  const value = take(self)
  return t === T.EntityName ? unquote(value) : value
}

/** Comma-separated names. */
function idList(self: Parser): string[] {
  const ids: string[] = []
  for (;;) {
    const t = kind(self)
    if (!(t === T.UnicodeText || t === T.StyleText)) throw fail(self, "'UNICODE_TEXT', 'STYLE_TEXT'")
    ids.push(take(self))
    if (kind(self) !== T.Comma) return ids
    self.i += 1
  }
}

/** Comma-separated style declarations. */
function stylesOpt(self: Parser): string[] {
  const styles: string[] = []
  for (;;) {
    if (!isStyleComponent(kind(self))) throw fail(self, "'STYLE_TEXT', 'COLON', 'NUM', 'BRKT'")
    let style = take(self)
    while (isStyleComponent(kind(self))) style += take(self)
    styles.push(style)
    if (kind(self) !== T.Comma) return styles
    self.i += 1
  }
}

/** The cardinalities and identification of a relationship. */
function relSpec(self: Parser): RelSpec {
  const cardB = cardinality(kind(self)) ?? Cardinality.OnlyOne
  self.i += 1
  const r = kind(self)
  if (r !== T.Identifying && r !== T.NonIdentifying) throw fail(self, "'NON_IDENTIFYING', 'IDENTIFYING'")
  self.i += 1
  const cardA = cardinality(kind(self))
  if (cardA === undefined) throw fail(self, CARDS)
  self.i += 1
  return { cardA, cardB, identifying: r === T.Identifying }
}

/** A relationship's label, without its quotes. */
function role(self: Parser): string {
  const t = kind(self)
  if (!(t === T.Word || t === T.EntityName || t === T.UnicodeText)) {
    throw fail(self, "'UNICODE_TEXT', 'ENTITY_NAME', 'WORD'")
  }
  const value = take(self)
  return t === T.UnicodeText ? value : unquote(value)
}

/** Whether the current token is the unnamed character `ch`. */
function isChar(self: Parser, ch: string): boolean {
  return kind(self) === T.Char && text(self) === ch
}

/** The attributes of a block, in authored order. */
function attributes(self: Parser): ErAttribute[] {
  const list: ErAttribute[] = []
  for (;;) {
    let type = expect(self, T.AttributeWord)
    if (isChar(self, '?')) type += take(self)
    if (kind(self) !== T.AttributeWord) {
      throw fail(self, type.endsWith('?') ? "'ATTRIBUTE_WORD'" : "'ATTRIBUTE_WORD', '?'")
    }
    const name = take(self)
    const keys: string[] = []
    if (kind(self) === T.AttributeKey) {
      keys.push(take(self))
      while (isChar(self, ',')) {
        self.i += 1
        keys.push(expect(self, T.AttributeKey))
      }
    }
    const comment = kind(self) === T.Comment ? unquote(take(self)) : ''
    list.push({ comment, keys, name, type })
    if (kind(self) === T.BlockStop) return list
  }
}

/** Parses an optional `{ ... }` block. `undefined` when there is none or it is empty. */
function block(self: Parser): ErAttribute[] | undefined {
  if (kind(self) !== T.BlockStart) return undefined
  self.i += 1
  if (kind(self) === T.BlockStop) {
    self.i += 1
    return undefined
  }
  const list = attributes(self)
  self.i += 1
  return list
}

/** A statement that starts with an entity name. Returns the names it mentions. */
function entityStatement(self: Parser, db: ErDb): string[] {
  const a = entityName(self)
  let t = kind(self)
  if (t === T.Sqs) {
    self.i += 1
    const alias = entityName(self)
    expect(self, T.Sqe)
    let classes: string[] | undefined
    if (kind(self) === T.StyleSeparator) {
      self.i += 1
      classes = idList(self)
    }
    const attrs = block(self)
    erDbAddEntity(db, a, alias)
    if (attrs !== undefined) erDbAddAttributes(db, a, attrs)
    if (classes !== undefined) erDbSetClass(db, [a], classes)
    return [a]
  }
  let classes: string[] | undefined
  if (t === T.StyleSeparator) {
    self.i += 1
    classes = idList(self)
    t = kind(self)
  }
  if (cardinality(t) !== undefined) {
    const spec = relSpec(self)
    const b = entityName(self)
    let classesB: string[] | undefined
    if (kind(self) === T.StyleSeparator) {
      self.i += 1
      classesB = idList(self)
    }
    expect(self, T.Colon)
    const label = role(self)
    erDbAddEntity(db, a, '')
    erDbAddEntity(db, b, '')
    erDbAddRelationship(db, a, label, b, spec)
    if (classes !== undefined) erDbSetClass(db, [a], classes)
    if (classesB !== undefined) erDbSetClass(db, [b], classesB)
    return [a, b]
  }
  const attrs = block(self)
  erDbAddEntity(db, a, '')
  if (attrs !== undefined) erDbAddAttributes(db, a, attrs)
  if (classes !== undefined) erDbSetClass(db, [a], classes)
  return [a]
}

/** Parses an ER diagram into `db`, as Pele's `parseEr` does. Throws a syntax error for input Mermaid rejects. */
export function parseEr(src: string, db: ErDb): void {
  const tokens = tokenize(src)
  const p: Parser = { i: 0, src, tokens }

  expect(p, T.ErDiagram)
  // Subgraphs nest on this stack rather than on the call stack. The diagram itself is the first
  // frame.
  const frames: Frame[] = [{ id: '', list: [], title: '' }]

  for (;;) {
    const nested = frames.length > 1
    const t = kind(p)
    switch (t) {
      case T.Newline:
        p.i += 1
        break
      case T.Eof:
        // The end of input is consumed first, so an open subgraph is reported at `$end`.
        p.i += 1
        if (nested) throw fail(p, `'END', ${LINE}`)
        return
      case T.EndKw: {
        if (!nested) throw fail(p, LINE)
        p.i += 1
        const frame = frames.pop()
        if (frame !== undefined) {
          const id = erDbAddSubGraph(db, frame.id, frame.list, frame.title)
          if (frames.length > 1) frames[frames.length - 1]?.list.push({ kind: 'Name', _0: id })
        }
        break
      }
      case T.Subgraph: {
        p.i += 1
        const id = entityName(p)
        let title = id
        if (kind(p) === T.Sqs) {
          p.i += 1
          title = entityName(p)
          while (isName(kind(p))) title += ` ${entityName(p)}`
          expect(p, T.Sqe)
        }
        separator(p)
        frames.push({ id, list: [], title })
        break
      }
      case T.AccTitle:
      case T.AccDescr:
      case T.AccDescrMultilineValue: {
        let value: string
        if (t === T.AccTitle) {
          p.i += 1
          value = trim(expect(p, T.AccTitleValue))
        } else if (t === T.AccDescr) {
          p.i += 1
          value = trim(expect(p, T.AccDescrValue))
        } else {
          value = trim(take(p))
        }
        if (t === T.AccTitle) erDbSetAccTitle(db, value)
        else erDbSetAccDescription(db, value)
        if (nested) frames[frames.length - 1]?.list.push({ kind: 'Name', _0: value })
        break
      }
      case T.DirectionTb:
      case T.DirectionBt:
      case T.DirectionRl:
      case T.DirectionLr: {
        p.i += 1
        const value = t === T.DirectionTb ? 'TB' : t === T.DirectionBt ? 'BT' : t === T.DirectionRl ? 'RL' : 'LR'
        if (nested) frames[frames.length - 1]?.list.push({ kind: 'Dir', _0: value })
        else erDbSetDirection(db, value)
        break
      }
      case T.Classdef:
      case T.Style: {
        const keyword = take(p)
        const ids = idList(p)
        const styles = stylesOpt(p)
        separator(p)
        if (t === T.Classdef) erDbAddClass(db, ids, styles)
        else erDbAddCssStyles(db, ids, styles)
        if (nested) frames[frames.length - 1]?.list.push({ kind: 'Name', _0: keyword })
        break
      }
      case T.Class: {
        const keyword = take(p)
        const ids = idList(p)
        const names = idList(p)
        erDbSetClass(db, ids, names)
        if (nested) frames[frames.length - 1]?.list.push({ kind: 'Name', _0: keyword })
        break
      }
      default: {
        if (!isName(t)) {
          if (nested) throw fail(p, `'END', ${LINE}`)
          throw fail(p, LINE)
        }
        const names = entityStatement(p, db)
        if (nested) {
          const frame = frames[frames.length - 1]
          if (frame !== undefined) for (const name of names) frame.list.push({ kind: 'Name', _0: name })
        }
      }
    }
  }
}
