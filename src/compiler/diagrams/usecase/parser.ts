/**
 * @module The use case grammar. Port of Pele's `src/diagrams/usecase/parser.ts`.
 *
 * Mermaid parses use case diagrams with a Chevrotain parser, which decides each choice by looking
 * at most three tokens ahead and reports the first token that fits nowhere. This parser makes the
 * same decisions from the same lookahead, so it accepts the same text and names the same token in
 * its errors.
 */
import {
  type DraftElement,
  type DraftLabel,
  type DraftProperty,
  type Drafts,
  type Named,
  type Span,
  draftsDefault,
  resolveUsecase,
} from './db.ts'
import { jsonDocDefault, parseOrderedJson } from './json.ts'
import { type Tok, error, lineColumn, pushUsize, tokenize, utf16 } from './lexer.ts'
import { T, name } from './tokens.ts'
import { RelationshipType, Shape, type UsecaseModel, arrow, relationshipTypeAsStr } from './types.ts'
import { Code, type CompileError, pushU32 } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { isWord } from '../../util/chars.ts'
import { buf, eqIgnoreAsciiCase } from '../../util/rust.ts'

/** The arrow tokens, in Mermaid's order. */
const ARROWS: T[] = [
  T.DependencyArrow,
  T.Generalization,
  T.ForwardSolid,
  T.BackwardSolid,
  T.MarkerlessSolid,
  T.ForwardCircle,
  T.BackwardCircle,
  T.ForwardCross,
  T.BackwardCross,
]

/** The tokens that name an element. */
const NAMES: T[] = [T.Identifier, T.PlainString, T.MarkdownString]

/** The tokens that start a statement other than an element. */
const STATEMENTS: T[] = [
  T.AccTitleLine,
  T.AccDescrLine,
  T.AccDescrBlock,
  T.Direction,
  T.Actor,
  T.SystemBoundary,
  T.Note,
  T.JsonDeclarationStart,
  T.ClassDef,
  T.Class,
  T.Style,
]

/** The parts of a style value, as Mermaid lists them. */
const STYLE_PARTS =
  'WORD|PLAIN_STRING|NUMBER|HASH_COLOR|CSS_IDENTIFIER|CSS_ESCAPED_COMMA|DASH|DOT|PERCENT|CSS_PUNCTUATION|COLON|LPAREN|RPAREN|LBRACKET|RBRACKET|LBRACE|RBRACE|AT|MARKERLESS_SOLID'

/** The statements `PlantUML` users are most likely to try, which Mermaid turns away. */
const FORBIDDEN = ['allowmixing', 'newpage', 'package', 'rectangle', 'skinparam']

/** Mermaid's WORD category: every keyword and identifier. */
function isWordToken(t: T): boolean {
  return t >= T.Usecase && t <= T.Identifier
}

/** Mermaid's `LABEL_TEXT` category. */
function isLabelText(t: T): boolean {
  return t >= T.Usecase && t <= T.LabelSymbol
}

/** Whether `t` names an element. */
function isName(t: T): boolean {
  return NAMES.includes(t)
}

/** Whether `t` starts a top-level line. */
function isLine(t: T): boolean {
  return t === T.Newline || t === T.Comment || STATEMENTS.includes(t) || isName(t)
}

/** Whether `t` starts a relationship after its source. */
function isRelation(t: T): boolean {
  return t === T.Identifier || ARROWS.includes(t)
}

/** Whether `t` may be part of a style value. */
function isStylePart(t: T): boolean {
  return (
    isWordToken(t) ||
    t === T.PlainString ||
    t === T.Number ||
    t === T.HashColor ||
    t === T.CssIdentifier ||
    t === T.CssEscapedComma ||
    t === T.Dash ||
    t === T.Dot ||
    t === T.Percent ||
    t === T.CssPunctuation ||
    t === T.Colon ||
    t === T.LParen ||
    t === T.RParen ||
    t === T.LBracket ||
    t === T.RBracket ||
    t === T.LBrace ||
    t === T.RBrace ||
    t === T.At ||
    t === T.MarkerlessSolid
  )
}

/** Whether `t` may follow the name of an element statement. */
function followsName(t: T): boolean {
  return (
    t === T.StereotypeStart ||
    t === T.ClassSeparator ||
    t === T.Identifier ||
    t === T.Newline ||
    t === T.Eof ||
    ARROWS.includes(t)
  )
}

/** Whether `t` starts a line inside a system boundary. */
function isBoundaryLine(t: T): boolean {
  return t === T.Newline || t === T.Comment || t === T.Actor || isName(t)
}

/** Whether `t` may close a label that `--` opened. */
function closesLabel(t: T): boolean {
  return t === T.ForwardSolid || t === T.MarkerlessSolid || t === T.ForwardCircle || t === T.ForwardCross
}

/** Whether `t` may come first inside a metadata block. */
function isMetadataFirst(t: T): boolean {
  return t === T.Newline || t === T.Identifier || t === T.PlainString || t === T.RBrace
}

/** Whether `t` may be a metadata key. */
function isKey(t: T): boolean {
  return t === T.Identifier || t === T.PlainString
}

/** Pele's `label.replace(/\W/g, '_')`: every UTF-16 unit outside `\w` becomes `_`. */
function generatedId(label: string): string {
  let out = ''
  for (let i = 0; i < label.length; i++) {
    out += isWord(label.charCodeAt(i)) ? label[i] : '_'
  }
  return out
}

/** Every token sequence that may start a statement, as Chevrotain lists them. */
function statementSequences(): string[] {
  const out: string[] = STATEMENTS.map((t) => name(t))
  const pair = (a: T, b: T): string => `${name(a)}, ${name(b)}`
  const metadata: string[] = NAMES.flatMap((n) =>
    [T.Newline, T.Identifier, T.PlainString, T.RBrace].map((next) => `${name(n)}, METADATA_START, ${name(next)}`),
  )
  const follows: T[] = [T.StereotypeStart, T.ClassSeparator, T.Identifier, ...ARROWS, T.Newline, T.Eof]
  out.push(...metadata)
  NAMES.forEach((n, i) => {
    if (i === 0) {
      out.push(pair(n, T.LParen))
      out.push(pair(n, T.LBracket))
    }
    for (const next of follows) out.push(pair(n, next))
  })
  out.push(...metadata)
  return out
}

/** An element as one mention writes it. */
type Item = {
  /** Its `:::` classes. */
  classes: string[]
  /** Whether this mention says something about the element, and so declares it. */
  explicit: boolean
  /** Its inline metadata. */
  metadata: DraftProperty[] | undefined
  /** Its id and label. */
  named: Named
  /** Its shape, from parentheses or brackets. */
  shape: Shape | undefined
  /** Its stereotype. */
  stereotype: string | undefined
}

/** An arrow and the element it points at. */
type Tail = {
  /** One of the arrow types. */
  arrowType: number
  /** The id the author gave the relationship, and where. */
  explicitId: [string, Span] | undefined
  /** Its label. */
  label: DraftLabel | undefined
  /** The least number of ranks between the ends. */
  minlen: number
  /** Where the arrow and target are. */
  span: Span
  /** The target. */
  target: Item
  /** The kind of relationship. */
  type: RelationshipType
}

/** The parser's state over one source. */
type Parser = {
  /** What was read so far. */
  drafts: Drafts
  /** The current token. */
  p: number
  /** The boundary being read, by index. */
  parent: number | undefined
  /** JSON nodes and their literal tokens, read once the whole text is well formed. */
  pendingJson: [number, number][]
  /** The source. */
  src: string
  /** The tokens, ending in three `Eof`s. */
  toks: Tok[]
}

/** The type of token `k`. */
function kind(self: Parser, k: number): T {
  return self.toks[k]?.kind ?? T.Eof
}

/** Where token `k` starts. */
function start(self: Parser, k: number): number {
  return self.toks[k]?.start ?? self.src.length
}

/** Where token `k` ends. */
function end(self: Parser, k: number): number {
  return self.toks[k]?.end ?? self.src.length
}

/** The source text of `span`. */
function slice(self: Parser, span: Span): string {
  return span[0] <= span[1] ? self.src.slice(span[0], span[1]) : ''
}

/** The text of token `k`. */
function image(self: Parser, k: number): string {
  return slice(self, spanOf(self, k))
}

/** Where token `k` is. */
function spanOf(self: Parser, k: number): Span {
  return [start(self, k), end(self, k)]
}

/** A syntax error at the current token. */
function fail(self: Parser, detail: string): CompileError {
  const at = start(self, self.p)
  const [line, column] = lineColumn(self.src, at)
  const message = buf('Error parsing usecase diagram: ')
  message.s += detail
  message.s += ' at line '
  pushU32(message, line)
  message.s += ', column '
  pushU32(message, column)
  message.s += ' ['
  pushUsize(message, utf16(self.src, at))
  message.s += ','
  pushUsize(message, utf16(self.src, end(self, self.p)))
  message.s += ')'
  return error(self.src, Code.Syntax, message.s, at)
}

function mismatch(self: Parser, expected: string): CompileError {
  return fail(self, `Expecting token of type --> ${expected} <-- but found --> '${image(self, self.p)}' <--`)
}

/** Consumes a token of type `t` and returns its index. */
function expect(self: Parser, t: T): number {
  if (kind(self, self.p) !== t) throw mismatch(self, name(t))
  self.p += 1
  return self.p - 1
}

/** Chevrotain lists every token sequence that would have been accepted. */
function noAlternative(self: Parser, expected: string[]): CompileError {
  let detail = 'Expecting: one of these possible Token sequences:\n'
  expected.forEach((sequence, i) => {
    if (i > 0) detail += '\n'
    detail += `  ${i + 1}. [${sequence}]`
  })
  detail += `\nbut found: '${image(self, self.p)}'`
  return fail(self, detail)
}

function noToken(self: Parser, expected: T[]): CompileError {
  return noAlternative(
    self,
    expected.map((t) => name(t)),
  )
}

/** Consumes the end of a line. */
function lineEnd(self: Parser): void {
  switch (kind(self, self.p)) {
    case T.Newline:
      self.p += 1
      return
    case T.Eof:
      return
    default:
      throw noToken(self, [T.Newline, T.Eof])
  }
}

/** The text of a name or string token, without its quotes. */
function content(self: Parser, k: number): Span {
  const t = kind(self, k)
  const trim = t === T.MarkdownString ? 2 : t === T.PlainString ? 1 : 0
  return [start(self, k) + trim, end(self, k) - trim]
}

/** The label a name or string token gives. */
function tokenLabel(self: Parser, k: number): DraftLabel {
  const span = content(self, k)
  return {
    markdown: kind(self, k) === T.MarkdownString,
    span,
    text: slice(self, span),
  }
}

/** An unquoted label runs to the next delimiter and is taken from the source as written. */
function label(self: Parser): DraftLabel {
  const t = kind(self, self.p)
  if (t === T.PlainString || t === T.MarkdownString) {
    self.p += 1
    return tokenLabel(self, self.p - 1)
  }
  if (!isLabelText(t)) throw noAlternative(self, ['PLAIN_STRING', 'MARKDOWN_STRING', 'LABEL_TEXT'])
  const first = self.p
  while (isLabelText(kind(self, self.p))) self.p += 1
  const span: Span = [start(self, first), end(self, self.p - 1)]
  return { markdown: false, span, text: slice(self, span) }
}

/** Reads one `key: value` metadata property. */
function property(self: Parser): DraftProperty {
  const key = self.p
  if (!isKey(kind(self, key))) throw noToken(self, [T.Identifier, T.PlainString])
  self.p += 1
  expect(self, T.Colon)
  const value = self.p
  const t = kind(self, value)
  if (!isKey(t) && t !== T.True && t !== T.False) {
    throw noToken(self, [T.Identifier, T.PlainString, T.True, T.False])
  }
  self.p += 1
  const keySpan = content(self, key)
  return {
    key: slice(self, keySpan),
    keySpan,
    value:
      t === T.True
        ? { kind: 'Bool', _0: true }
        : t === T.False
          ? { kind: 'Bool', _0: false }
          : { kind: 'Str', _0: slice(self, content(self, value)) },
  }
}

/**
 * Whether another property follows. A comma or line breaks before the closing brace do not
 * count, but Chevrotain looks only three tokens ahead, so a comma and two line breaks, or three
 * line breaks, are taken for a separator and the brace after them is then an error.
 */
function separatorAhead(self: Parser): boolean {
  const a = kind(self, self.p)
  const b = kind(self, self.p + 1)
  const c = kind(self, self.p + 2)
  if (a === T.Comma) return isKey(b) || (b === T.Newline && (c === T.Newline || isKey(c)))
  if (a !== T.Newline) return false
  return b === T.Comma || isKey(b) || (b === T.Newline && (c === T.Newline || c === T.Comma || isKey(c)))
}

/** Skips line breaks. */
function skipNewlines(self: Parser): void {
  while (kind(self, self.p) === T.Newline) self.p += 1
}

/** Reads a metadata block from `@{` to `}`. */
function metadata(self: Parser): DraftProperty[] {
  expect(self, T.MetadataStart)
  const properties: DraftProperty[] = []
  skipNewlines(self)
  if (isKey(kind(self, self.p))) {
    properties.push(property(self))
    while (separatorAhead(self)) {
      if (kind(self, self.p) === T.Comma) {
        self.p += 1
      } else {
        skipNewlines(self)
        if (kind(self, self.p) === T.Comma) self.p += 1
      }
      skipNewlines(self)
      properties.push(property(self))
    }
    if (kind(self, self.p) === T.Comma) self.p += 1
    skipNewlines(self)
  }
  expect(self, T.RBrace)
  return properties
}

/** Reads a `:::` suffix and its class names into `classes`. */
function classSuffix(self: Parser, classes: string[]): void {
  for (;;) {
    self.p += 1
    const id = expect(self, T.Identifier)
    classes.push(image(self, id))
    if (kind(self, self.p) !== T.Comma) return
  }
}

/** An id with an optional label in parentheses or brackets, or a string that stands for both. */
function nameOf(self: Parser, brackets: boolean): [Named, Shape | undefined] {
  const k = self.p
  const t = kind(self, k)
  const span = content(self, k)
  if (t === T.Identifier) {
    self.p += 1
    const id = image(self, k)
    const open = kind(self, self.p)
    if (open === T.LParen || (brackets && open === T.LBracket)) {
      self.p += 1
      const text = label(self)
      const ellipse = open === T.LParen
      expect(self, ellipse ? T.RParen : T.RBracket)
      return [{ generated: false, id, label: text, span }, ellipse ? Shape.Ellipse : Shape.Rect]
    }
    return [{ generated: false, id, label: tokenLabel(self, k), span }, undefined]
  }
  if (t === T.PlainString || t === T.MarkdownString) {
    self.p += 1
    const text = tokenLabel(self, k)
    return [{ generated: true, id: generatedId(text.text), label: text, span }, undefined]
  }
  throw noToken(self, NAMES)
}

/** Reads an actor or use case with its metadata, stereotype, and classes. */
function element(self: Parser, actor: boolean): Item {
  const [named, found] = nameOf(self, !actor)
  const shape = actor ? undefined : found
  const meta = kind(self, self.p) === T.MetadataStart ? metadata(self) : undefined
  let stereotype: string | undefined
  if (kind(self, self.p) === T.StereotypeStart) {
    self.p += 1
    const text = expect(self, T.StereotypeText)
    expect(self, T.StereotypeEnd)
    stereotype = trim(image(self, text))
  }
  const classes: string[] = []
  if (kind(self, self.p) === T.ClassSeparator) classSuffix(self, classes)
  return {
    classes,
    explicit: shape !== undefined || meta !== undefined || (stereotype !== undefined && stereotype !== ''),
    metadata: meta,
    named,
    shape,
    stereotype,
  }
}

/** A copy of `named`, as `Named::clone` makes one. */
function cloneNamed(named: Named): Named {
  return {
    generated: named.generated,
    id: named.id,
    label: { markdown: named.label.markdown, span: [named.label.span[0], named.label.span[1]], text: named.label.text },
    span: [named.span[0], named.span[1]],
  }
}

/** The declaration a mention makes. */
function draft(self: Parser, item: Item, actor: boolean): DraftElement {
  return {
    actor,
    classes: item.classes.slice(),
    metadata: item.metadata?.map((p) => ({ key: p.key, keySpan: p.keySpan, value: p.value })),
    named: cloneNamed(item.named),
    parent: self.parent,
    shape: item.shape,
    stereotype: item.stereotype,
  }
}

/** Whether a label and then one of the operators that can close it come next. */
function labeledRight(self: Parser, closers: boolean): boolean {
  const inLabel = (t: T): boolean => t >= T.Usecase && t <= T.MarkdownString
  if (!inLabel(kind(self, self.p))) return false
  let k = self.p + 1
  for (;;) {
    const t = kind(self, k)
    if (t === T.MarkerlessSolid || (closers && closesLabel(t))) return true
    if (!inLabel(t)) return false
    k += 1
  }
}

/** Each dash beyond the second asks for one more rank between the two ends. */
function minimumLength(self: Parser, k: number): number {
  const length = end(self, k) - start(self, k)
  const dashes = kind(self, k) === T.MarkerlessSolid ? length : Math.max(length - 1, 0)
  return Math.min(Math.max(Math.max(dashes - 1, 0), 1), 4294967295)
}

/** Reads an arrow, its optional id and label, and its target. */
function relationTail(self: Parser): Tail {
  const first = self.p
  let type: RelationshipType = RelationshipType.Association
  let arrowType: number = arrow.SOLID_ARROW
  let minlen = 1
  let text: DraftLabel | undefined
  let explicitId: [string, Span] | undefined
  if (kind(self, self.p) === T.Identifier && kind(self, self.p + 1) === T.At) {
    explicitId = [image(self, self.p), spanOf(self, self.p)]
    self.p += 2
  }
  const k = self.p
  const t = kind(self, k)
  self.p += 1
  switch (t) {
    case T.DependencyArrow: {
      expect(self, T.Colon)
      const found = kind(self, self.p)
      if (found !== T.Include && found !== T.Extend) throw noToken(self, [T.Include, T.Extend])
      type = found === T.Include ? RelationshipType.Include : RelationshipType.Extend
      text = { markdown: false, span: spanOf(self, self.p), text: relationshipTypeAsStr(type) }
      self.p += 1
      break
    }
    case T.Generalization:
      type = RelationshipType.Generalization
      break
    case T.ForwardSolid:
      minlen = minimumLength(self, k)
      break
    case T.BackwardSolid:
      arrowType = arrow.BACK_ARROW
      // Only the shortest operator can open a label: `A <-- label -- B`.
      if (end(self, k) - start(self, k) === 3 && labeledRight(self, false)) {
        text = label(self)
        const close = expect(self, T.MarkerlessSolid)
        minlen = minimumLength(self, close)
      } else {
        minlen = minimumLength(self, k)
      }
      break
    case T.MarkerlessSolid:
      arrowType = arrow.LINE_SOLID
      if (end(self, k) - start(self, k) === 2 && labeledRight(self, true)) {
        text = label(self)
        switch (kind(self, self.p)) {
          case T.ForwardSolid:
            arrowType = arrow.SOLID_ARROW
            break
          case T.ForwardCircle:
            arrowType = arrow.CIRCLE_ARROW
            break
          case T.ForwardCross:
            arrowType = arrow.CROSS_ARROW
            break
          case T.MarkerlessSolid:
            break
          default:
            throw noToken(self, [T.ForwardSolid, T.MarkerlessSolid, T.ForwardCircle, T.ForwardCross])
        }
        if (arrowType === arrow.SOLID_ARROW || arrowType === arrow.LINE_SOLID) {
          minlen = minimumLength(self, self.p)
        }
        self.p += 1
      } else {
        minlen = minimumLength(self, k)
      }
      break
    case T.ForwardCircle:
      arrowType = arrow.CIRCLE_ARROW
      break
    case T.ForwardCross:
      arrowType = arrow.CROSS_ARROW
      break
    case T.BackwardCircle:
    case T.BackwardCross:
      arrowType = t === T.BackwardCircle ? arrow.CIRCLE_ARROW_REVERSED : arrow.CROSS_ARROW_REVERSED
      if (labeledRight(self, false)) {
        text = label(self)
        expect(self, T.MarkerlessSolid)
      }
      break
    default:
      self.p -= 1
      throw noToken(self, ARROWS)
  }
  const target = element(self, false)
  return {
    arrowType,
    explicitId,
    label: text,
    minlen,
    span: [start(self, first), end(self, self.p - 1)],
    target,
    type,
  }
}

/** Records a relationship from `source` and the target it declares. */
function relationship(self: Parser, source: Item, declares: boolean, tail: Tail): void {
  const target = tail.target
  if (target.explicit) self.drafts.elements.push(draft(self, target, false))
  self.drafts.relationships.push({
    arrowType: tail.arrowType,
    id: tail.explicitId,
    label: tail.label,
    minlen: tail.minlen,
    source: {
      classed: source.classes.length > 0,
      declares,
      named: cloneNamed(source.named),
    },
    span: tail.span,
    target: {
      classed: target.classes.length > 0,
      declares: target.explicit,
      named: target.named,
    },
    type: tail.type,
  })
}

/**
 * `actor A, B` declares several actors; at the top level `actor A --> B` declares one and relates
 * it.
 */
function actors(self: Parser, top: boolean): void {
  self.p += 1
  const items = [element(self, true)]
  let tail: Tail | undefined
  if (kind(self, self.p) === T.Comma) {
    while (kind(self, self.p) === T.Comma) {
      self.p += 1
      items.push(element(self, true))
    }
  } else if (top && isRelation(kind(self, self.p))) {
    tail = relationTail(self)
  }
  lineEnd(self)
  for (const item of items) self.drafts.elements.push(draft(self, item, true))
  const first = items[0]
  if (tail !== undefined && first !== undefined) relationship(self, first, true, tail)
}

/** Reads a use case statement, with a relationship at the top level. */
function entity(self: Parser, top: boolean): void {
  const source = element(self, false)
  const tail = top && isRelation(kind(self, self.p)) ? relationTail(self) : undefined
  lineEnd(self)
  if (tail === undefined) {
    source.explicit = true
    source.shape = source.shape ?? Shape.Ellipse
  }
  if (source.explicit) self.drafts.elements.push(draft(self, source, false))
  if (tail !== undefined) {
    const declares = source.explicit
    relationship(self, source, declares, tail)
  }
}

/** Reads a system boundary through its `end`. */
function boundary(self: Parser): void {
  self.p += 1
  const [named] = nameOf(self, true)
  const inline = kind(self, self.p) === T.MetadataStart ? metadata(self) : undefined
  const classes: string[] = []
  if (kind(self, self.p) === T.ClassSeparator) classSuffix(self, classes)
  lineEnd(self)
  const id = named.id
  const span = named.span
  self.drafts.boundaries.push({ classes, named })
  self.parent = self.drafts.boundaries.length - 1
  while (isBoundaryLine(kind(self, self.p))) line(self, false)
  self.parent = undefined
  expect(self, T.End)
  lineEnd(self)
  if (inline !== undefined) {
    self.drafts.metadata.push({ properties: inline, span, target: id })
  }
}

/** Reads one style declaration, as written. */
function style(self: Parser): string {
  const first = self.p
  const t = kind(self, self.p)
  if (isWordToken(t) || t === T.CssIdentifier) {
    self.p += 1
  } else if (t === T.MarkerlessSolid) {
    self.p += 1
    if (!isWordToken(kind(self, self.p))) throw mismatch(self, 'WORD')
    self.p += 1
  } else {
    throw noAlternative(self, ['WORD', 'CSS_IDENTIFIER', 'MARKERLESS_SOLID'])
  }
  expect(self, T.Colon)
  if (!isStylePart(kind(self, self.p))) {
    let detail =
      'Expecting: expecting at least one iteration which starts with one of these possible Token sequences::\n  <['
    STYLE_PARTS.split('|').forEach((part, i) => {
      if (i > 0) detail += '] ,['
      detail += part
    })
    detail += `]>\nbut found: '${image(self, self.p)}'`
    throw fail(self, detail)
  }
  while (isStylePart(kind(self, self.p))) self.p += 1
  // The value is taken from the source, so the spaces inside `1px solid red` survive.
  const raw = slice(self, [start(self, first), end(self, self.p - 1)])
  return raw.split('\\,').join(',')
}

/** Reads comma-separated style declarations. */
function styles(self: Parser): string[] {
  const out = [style(self)]
  while (kind(self, self.p) === T.Comma) {
    self.p += 1
    out.push(style(self))
  }
  return out
}

/** Reads comma-separated identifiers. */
function identifiers(self: Parser): number[] {
  const out = [expect(self, T.Identifier)]
  while (kind(self, self.p) === T.Comma) {
    self.p += 1
    out.push(expect(self, T.Identifier))
  }
  return out
}

/** Reads a statement at the top level. */
function topStatement(self: Parser): void {
  const k = self.p
  const t = kind(self, k)
  switch (t) {
    case T.AccTitleLine:
    case T.AccDescrLine:
    case T.AccDescrBlock: {
      self.p += 1
      const text = image(self, k)
      let value: string
      if (t === T.AccDescrBlock) {
        const brace = text.indexOf('{')
        const open = brace < 0 ? 0 : brace + 1
        const last = text.lastIndexOf('}')
        const close = last < 0 ? text.length : last
        value = trim(open <= close ? text.slice(open, close) : '')
      } else {
        const found = text.indexOf(':')
        const colon = found < 0 ? 0 : found + 1
        value = trim(text.slice(colon))
      }
      if (t === T.AccTitleLine) self.drafts.accTitle = value
      else self.drafts.accDescription = value
      break
    }
    case T.Direction: {
      self.p += 1
      const value = kind(self, self.p)
      switch (value) {
        case T.Td:
        case T.Tb:
          self.drafts.direction = 'TB'
          break
        case T.Bt:
          self.drafts.direction = 'BT'
          break
        case T.Lr:
          self.drafts.direction = 'LR'
          break
        case T.Rl:
          self.drafts.direction = 'RL'
          break
        default:
          throw noToken(self, [T.Td, T.Tb, T.Bt, T.Lr, T.Rl])
      }
      self.p += 1
      break
    }
    case T.Actor:
      return actors(self, true)
    case T.SystemBoundary:
      return boundary(self)
    case T.Note: {
      self.p += 1
      expect(self, T.For)
      const target = expect(self, T.Identifier)
      const text = label(self)
      self.drafts.notes.push({ label: text, span: spanOf(self, target), target: image(self, target) })
      break
    }
    case T.JsonDeclarationStart: {
      self.p += 1
      const literal = expect(self, T.JsonObjectLiteral)
      const classes: string[] = []
      if (kind(self, self.p) === T.ClassSeparator) classSuffix(self, classes)
      const b = self.src
      let from = start(self, k) + 4
      while (from < b.length && (b.charCodeAt(from) === 32 || b.charCodeAt(from) === 9)) from += 1
      let to = from
      while (to < b.length && isWord(b.charCodeAt(to))) to += 1
      self.drafts.jsons.push({ classes, id: slice(self, [from, to]), span: [from, to], value: jsonDocDefault() })
      self.pendingJson.push([self.drafts.jsons.length - 1, literal])
      break
    }
    case T.ClassDef: {
      self.p += 1
      const ids = identifiers(self)
      const declarations = styles(self)
      self.drafts.classDefs.push({ ids: ids.map((id) => image(self, id)), styles: declarations })
      break
    }
    case T.Class: {
      self.p += 1
      const targets = identifiers(self)
      const classes = identifiers(self)
      self.drafts.classes.push({
        classes: classes.map((id) => image(self, id)),
        targets: targets.map((id) => [image(self, id), spanOf(self, id)]),
      })
      break
    }
    case T.Style: {
      self.p += 1
      const target = expect(self, T.Identifier)
      const declarations = styles(self)
      self.drafts.styles.push({ span: spanOf(self, target), styles: declarations, target: image(self, target) })
      break
    }
    default: {
      const next = kind(self, self.p + 1)
      if (next === T.MetadataStart) {
        if (!isMetadataFirst(kind(self, self.p + 2))) throw noAlternative(self, statementSequences())
        self.p += 1
        const span = content(self, k)
        const target = t === T.Identifier ? image(self, k) : generatedId(slice(self, span))
        const properties = metadata(self)
        self.drafts.metadata.push({ properties, span, target })
      } else {
        const follows = followsName(next) || (t === T.Identifier && (next === T.LParen || next === T.LBracket))
        // Mermaid turns away the PlantUML statements people are most likely to try.
        const forbidden = t === T.Identifier && isForbidden(image(self, k))
        if (!follows || forbidden) throw noAlternative(self, statementSequences())
        return entity(self, true)
      }
    }
  }
  lineEnd(self)
}

/** Whether `text` is one of the PlantUML words Mermaid turns away, ignoring ASCII case. */
function isForbidden(text: string): boolean {
  for (let i = 0; i < FORBIDDEN.length; i++) {
    if (eqIgnoreAsciiCase(FORBIDDEN[i] as string, text)) return true
  }
  return false
}

/** Reads one line, at the top level or inside a boundary. */
function line(self: Parser, top: boolean): void {
  const t = kind(self, self.p)
  if (t === T.Newline) {
    self.p += 1
  } else if (t === T.Comment) {
    self.p += 1
    lineEnd(self)
  } else if (t === T.Actor && !top) {
    actors(self, false)
  } else if (top) {
    topStatement(self)
  } else {
    entity(self, false)
  }
}

/**
 * Parses preprocessed use case `source` into its model. `title` comes from front matter.
 *
 * Throws Mermaid's lexing, parsing, JSON, and semantic errors.
 */
export function parseUsecase(source: string, title: string | undefined): UsecaseModel {
  const parser: Parser = {
    drafts: draftsDefault(),
    p: 0,
    parent: undefined,
    pendingJson: [],
    src: source,
    toks: tokenize(source),
  }
  expect(parser, T.Usecase)
  lineEnd(parser)
  while (isLine(kind(parser, parser.p))) line(parser, true)
  if (kind(parser, parser.p) !== T.Eof) {
    throw fail(parser, `Redundant input, expecting EOF but found: ${image(parser, parser.p)}`)
  }
  // The whole text has to be well formed before the JSON in it is looked at, as in Mermaid.
  const pending = parser.pendingJson
  parser.pendingJson = []
  for (const [json, literal] of pending) {
    const origin = lineColumn(source, start(parser, literal))
    const value = parseOrderedJson(image(parser, literal), origin)
    const target = parser.drafts.jsons[json]
    if (target !== undefined) target.value = value
  }
  return resolveUsecase(source, parser.drafts, title)
}
