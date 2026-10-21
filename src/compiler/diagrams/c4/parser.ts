/** @module The C4 parser. Port of Pele's `src/diagrams/c4/parser.ts`. */
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'
import {
  type C4Db,
  c4DbAddContainer,
  c4DbAddContainerBoundary,
  c4DbAddDeploymentNode,
  c4DbAddPersonOrSystem,
  c4DbAddPersonOrSystemBoundary,
  c4DbAddRel,
  c4DbPopBoundaryParseStack,
  c4DbSetAccDescription,
  c4DbSetC4Type,
  c4DbSetTitle,
  c4DbUpdateElStyle,
  c4DbUpdateLayoutConfig,
  c4DbUpdateRelStyle,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import type { C4Attr } from './types.ts'

/** Mermaid's typeC4Shape for each shape keyword, in token order from `Person`. */
const KINDS: readonly string[] = [
  'person',
  'external_person',
  'system',
  'system_db',
  'system_queue',
  'external_system',
  'external_system_db',
  'external_system_queue',
  'container',
  'container_db',
  'container_queue',
  'external_container',
  'external_container_db',
  'external_container_queue',
  'component',
  'component_db',
  'component_queue',
  'external_component',
  'external_component_db',
  'external_component_queue',
]

const HEADERS =
  "'direction_tb', 'direction_bt', 'direction_rl', 'direction_lr', 'C4_CONTEXT', 'C4_CONTAINER', 'C4_COMPONENT', 'C4_DYNAMIC', 'C4_DEPLOYMENT'"
const ATTRIBUTES = "'STR', 'STR_KEY', 'ATTRIBUTE', 'ATTRIBUTE_EMPTY'"

/** What may come next. */
const P = {
  /** A statement is required. */
  Item: 0,
  /**
   * Only a diagram statement may come next: the first one in a boundary, or one written
   * straight after a title.
   */
  Diagram: 1,
  ItemOrEnd: 2,
  AfterOther: 3,
  AfterDiagram: 4,
} as const
type P = (typeof P)[keyof typeof P]

function isOther(t: T): boolean {
  return (
    t === T.Title || t === T.AccDescription || t === T.AccTitle || t === T.AccDescr || t === T.AccDescrMultilineValue
  )
}

function isDiagram(t: T): boolean {
  return t >= T.Person && t <= T.UpdateLayoutConfig
}

/** The kind of a shape keyword. */
function kind(t: T): string {
  const at = t >= T.Person && t <= T.ComponentExtDb ? t - T.Person : 19
  return KINDS[at] ?? ''
}

/** Parser state over the token list. */
type Parser = {
  i: number
  src: string
  tokens: Token[]
}

function parserT(self: Parser): T {
  return self.tokens[self.i]?.t ?? T.End
}

function parserText(self: Parser, at: number): string {
  const token = self.tokens[at]
  return token === undefined ? '' : self.src.slice(token.start, token.end)
}

function parserFail(self: Parser, expected: string): CompileError {
  const start = self.tokens[self.i]?.start ?? self.src.length
  const t = parserT(self)
  if (t === T.Error) return errorSyntax('c4', self.src, start, '', true)
  const detail = `Expecting ${expected}, got '${tName(t)}'`
  return errorSyntax('c4', self.src, start, detail, false)
}

function parserExpect(self: Parser, t: T): void {
  if (parserT(self) !== t) throw parserFail(self, `'${tName(t)}'`)
  self.i += 1
}

function parserAttributes(self: Parser): C4Attr[] {
  const attrs: C4Attr[] = []
  for (;;) {
    const t = parserT(self)
    if (t === T.Str) {
      attrs.push({ kind: 'Text', _0: trim(parserText(self, self.i)) })
      self.i += 1
    } else if (t === T.AttributeEmpty) {
      attrs.push({ kind: 'Text', _0: '' })
      self.i += 1
    } else if (t === T.StrKey) {
      self.i += 1
      if (parserT(self) !== T.StrValue) throw parserFail(self, "'STR_VALUE'")
      attrs.push({
        kind: 'Named',
        _0: { key: trim(parserText(self, self.i - 1)), value: trim(parserText(self, self.i)) },
      })
      self.i += 1
    } else {
      break
    }
  }
  if (attrs.length === 0) throw parserFail(self, ATTRIBUTES)
  return attrs
}

function parserOther(self: Parser, t: T, db: C4Db): void {
  if (t === T.Title) {
    c4DbSetTitle(db, after(parserText(self, self.i), 5))
    self.i += 1
  } else if (t === T.AccDescription) {
    c4DbSetAccDescription(db, after(parserText(self, self.i), 14))
    self.i += 1
  } else if (t === T.AccDescrMultilineValue) {
    c4DbSetAccDescription(db, trim(parserText(self, self.i)))
    self.i += 1
  } else {
    self.i += 1
    if (t === T.AccTitle) {
      if (parserT(self) !== T.AccTitleValue) throw parserFail(self, "'acc_title_value'")
      // The grammar hands `accTitle:` to setTitle, so it becomes the visible title.
      c4DbSetTitle(db, trim(parserText(self, self.i)))
    } else {
      if (parserT(self) !== T.AccDescrValue) throw parserFail(self, "'acc_descr_value'")
      c4DbSetAccDescription(db, trim(parserText(self, self.i)))
    }
    self.i += 1
  }
}

/** Reads a diagram statement. Returns true when it opens a boundary. */
function parserDiagram(self: Parser, t: T, db: C4Db): boolean {
  self.i += 1
  const attrs = parserAttributes(self)
  if (t <= T.SystemExtQueue) {
    c4DbAddPersonOrSystem(db, kind(t), attrs)
  } else if (t <= T.ComponentExtQueue) {
    c4DbAddContainer(db, kind(t), attrs)
  } else if (t <= T.NodeR) {
    const inserted =
      t === T.EnterpriseBoundary
        ? 'ENTERPRISE'
        : t === T.SystemBoundary
          ? 'SYSTEM'
          : t === T.ContainerBoundary
            ? 'CONTAINER'
            : undefined
    if (inserted !== undefined) {
      // `splice(2, 0, ...)` inserts at the end of a shorter list.
      attrs.splice(Math.min(attrs.length, 2), 0, { kind: 'Text', _0: inserted })
    }
    if (t === T.Node) c4DbAddDeploymentNode(db, 'node', attrs)
    else if (t === T.NodeL) c4DbAddDeploymentNode(db, 'nodeL', attrs)
    else if (t === T.NodeR) c4DbAddDeploymentNode(db, 'nodeR', attrs)
    else if (t === T.ContainerBoundary) c4DbAddContainerBoundary(db, attrs)
    else c4DbAddPersonOrSystemBoundary(db, attrs, 'system')
    if (parserT(self) === T.Lbrace) {
      self.i += 1
      parserExpect(self, T.Newline)
    } else if (parserT(self) === T.Newline) {
      self.i += 1
      parserExpect(self, T.Lbrace)
      if (parserT(self) === T.Newline) self.i += 1
    } else {
      throw parserFail(self, "'NEWLINE', 'LBRACE'")
    }
    return true
  } else if (t <= T.RelIndex) {
    // RelIndex takes a sequence number first, which Mermaid ignores.
    if (t === T.RelIndex && attrs.length > 0) attrs.splice(0, 1)
    const type =
      t === T.Birel
        ? 'birel'
        : t === T.RelU
          ? 'rel_u'
          : t === T.RelD
            ? 'rel_d'
            : t === T.RelL
              ? 'rel_l'
              : t === T.RelR
                ? 'rel_r'
                : t === T.RelB
                  ? 'rel_b'
                  : 'rel'
    c4DbAddRel(db, type, attrs)
  } else if (t === T.UpdateElStyle) {
    c4DbUpdateElStyle(db, attrs)
  } else if (t === T.UpdateRelStyle) {
    c4DbUpdateRelStyle(db, attrs)
  } else {
    c4DbUpdateLayoutConfig(db, attrs)
  }
  return false
}

/**
 * `text.substring(skip + 1)`: the text after an ASCII keyword of `skip` units and the one
 * whitespace character after it.
 */
function after(text: string, skip: number): string {
  if (skip >= text.length) return ''
  const space = (text.codePointAt(skip) as number) > 0xffff ? 2 : 1
  return text.slice(skip + space)
}

/**
 * Accepts what the parser Jison generates from `c4Diagram.jison` accepts, and calls the model
 * builder in the order its semantic actions do. Boundaries nest through a counter, not
 * recursion.
 *
 * Throws a syntax error for input Mermaid rejects.
 */
export function parseC4(src: string, db: C4Db): void {
  const p: Parser = { i: 0, src, tokens: tokenize(src) }

  const header = parserT(p)
  if (header < T.C4Context || header > T.C4Deployment) throw parserFail(p, HEADERS)
  p.i += 1
  parserExpect(p, T.Newline)

  let depth = 0
  let state: P = P.Item
  for (;;) {
    const t = parserT(p)
    if (state === P.AfterOther || state === P.AfterDiagram) {
      if (t === T.Newline) {
        p.i += 1
        state = P.ItemOrEnd
        continue
      }
      if (state === P.AfterOther && isDiagram(t)) {
        state = P.Diagram
        continue
      }
    } else if (isDiagram(t)) {
      if (parserDiagram(p, t, db)) {
        depth += 1
        state = P.Diagram
      } else {
        state = P.AfterDiagram
      }
      continue
    } else if (isOther(t) && state !== P.Diagram) {
      parserOther(p, t, db)
      state = P.AfterOther
      continue
    } else if (state !== P.ItemOrEnd) {
      throw parserFail(
        p,
        "'title', 'accDescription', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'PERSON', 'REL'",
      )
    }

    if (depth > 0) {
      if (t !== T.Rbrace) throw parserFail(p, "'NEWLINE', 'RBRACE'")
      p.i += 1
      c4DbPopBoundaryParseStack(db)
      depth -= 1
      state = P.AfterDiagram
    } else {
      if (t !== T.Eof) throw parserFail(p, "'NEWLINE', 'EOF'")
      p.i += 1
      parserExpect(p, T.End)
      c4DbSetC4Type(db, parserText(p, 0))
      return
    }
  }
}
