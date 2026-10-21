/**
 * @module The state parser: a hand-written equivalent of Mermaid's Jison grammar that reports the
 * same errors at the same tokens. Port of Pele's `src/diagrams/state/parser.ts`.
 */
import { type StateDb, stateDbDividerId, stateDbSetRootDoc } from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import type { Description, Doc, StateNote, StateStmt, Stmt } from './types.ts'
import { Code, CompileError, errorNew, errorSyntax, locate } from '../../error.ts'
import { trim, trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'

/** The statement tokens the grammar expects, as its errors list them. */
const STATEMENT =
  "'NL', 'ID', 'HIDE_EMPTY', 'scale', 'COMPOSIT_STATE', 'STATE_DESCR', " +
  "'FORK', 'JOIN', 'CHOICE', 'CONCURRENT', 'note', 'acc_title', 'acc_descr', " +
  "'acc_descr_multiline_value', 'CLICK', 'classDef', 'style', 'class', 'direction_tb', " +
  "'direction_bt', 'direction_rl', 'direction_lr', 'EDGE_STATE'"

/** Parser state over the token list. */
type Parser = {
  error: string | undefined
  i: number
  src: string
  tokens: Token[]
}

function kindAt(self: Parser, at: number): T {
  return self.tokens[at]?.kind ?? T.End
}

function kind(self: Parser): T {
  return kindAt(self, self.i)
}

/** The current token's text, then moves past it. */
function take(self: Parser): string {
  const text = self.tokens[self.i]?.text ?? ''
  self.i += 1
  return text
}

function fail(self: Parser, expected: string): CompileError {
  const t = kind(self)
  const start = self.tokens[self.i]?.start ?? self.src.length
  if (t === T.Error) {
    if (self.error !== undefined) {
      const location = locate(self.src, start)
      const error = errorNew(Code.Syntax, self.error)
      error.column = location.column
      error.line = location.line
      error.snippet = location.snippet
      error.type = 'state'
      return error
    }
    return errorSyntax('state', self.src, start, '', true)
  }

  const detail = `Expecting ${expected}, got '${tName(t)}'`
  return errorSyntax('state', self.src, start, detail, false)
}

function expect(self: Parser, k: T): string {
  if (kind(self) !== k) throw fail(self, `'${tName(k)}'`)
  return take(self)
}

function idStatement(self: Parser): StateStmt {
  const k = kind(self)
  if (k !== T.Id && k !== T.EdgeState) throw fail(self, "'ID', 'EDGE_STATE'")
  const id = trim(take(self))
  let classes: string[] | undefined
  if (kind(self) === T.StyleSeparator) {
    self.i += 1
    classes = [trim(expect(self, T.Id))]
  }
  return stateStmt(id, 'default', { kind: 'One', _0: '' }, classes, undefined, undefined)
}

/** A `StateStmt` with the given fields and the rest left at their defaults. */
function stateStmt(
  id: string,
  type: string | undefined,
  description: Description | undefined,
  classes: string[] | undefined,
  doc: Doc | undefined,
  note: StateNote | undefined,
): StateStmt {
  return {
    classes,
    description,
    descriptions: undefined,
    doc,
    id,
    note,
    start: undefined,
    styles: undefined,
    textStyles: undefined,
    type,
  }
}

/** A composite state that opens a body. */
function composite(id: string, description: string): Stmt {
  return {
    kind: 'State',
    _0: stateStmt(id, 'default', { kind: 'One', _0: description }, undefined, [], undefined),
  }
}

/** A state of `type` named by a stereotype. */
function typed(id: string, type: string): Stmt {
  return { kind: 'State', _0: stateStmt(id, type, undefined, undefined, undefined, undefined) }
}

/** Parses preprocessed state diagram source into `db`, as Pele's `parseState` does. */
export function parseState(src: string, db: StateDb): void {
  const lexed = tokenize(src)
  const p: Parser = { error: lexed.error, i: 0, src, tokens: lexed.tokens }

  while (kind(p) === T.Nl) p.i += 1
  if (kind(p) !== T.Sd) throw fail(p, "'NL', 'SD'")
  p.i += 1

  // The open documents, innermost last. Each composite's body is built here and moved into its
  // state when the body closes.
  const docs: Stmt[][] = [[]]
  // The grammar drops a statement whose value is the string it uses for a blank line.
  const add = (value: Stmt): void => {
    if (value.kind === 'Text' && value._0 === 'nl') return
    docs[docs.length - 1]?.push(value)
  }
  const open = (stmt: Stmt): void => {
    p.i += 1
    docs[docs.length - 1]?.push(stmt)
    docs.push([])
  }

  for (;;) {
    const t = kind(p)
    switch (t) {
      case T.Nl:
        p.i += 1
        break
      case T.Id:
      case T.EdgeState: {
        const first = idStatement(p)
        if (kind(p) === T.Descr) {
          first.description = { kind: 'One', _0: trimColon(take(p)) }
          add({ kind: 'State', _0: first })
        } else if (kind(p) === T.Arrow) {
          p.i += 1
          const second = idStatement(p)
          const description = kind(p) === T.Descr ? trimColon(take(p)) : undefined
          add({ kind: 'Relation', _0: { description, state1: first, state2: second } })
        } else {
          add({ kind: 'State', _0: first })
        }
        break
      }
      case T.HideEmpty: {
        const text = take(p)
        add({ kind: 'Text', _0: text })
        break
      }
      case T.Scale: {
        const text = take(p)
        expect(p, T.Width)
        add({ kind: 'Text', _0: text })
        break
      }
      case T.CompositState: {
        if (kindAt(p, p.i + 1) === T.StructStart) {
          const id = take(p)
          const stmt = composite(id, '')
          open(stmt)
        } else {
          const text = take(p)
          add({ kind: 'Text', _0: text })
        }
        break
      }
      case T.StateDescr: {
        const description = take(p)
        expect(p, T.As)
        const id = expect(p, T.Id)
        const colon = id.indexOf(':')
        if (kind(p) === T.StructStart) {
          const stmt = composite(id, description)
          open(stmt)
        } else if (colon >= 0) {
          const head = id.slice(0, colon)
          const rest = id.slice(colon + 1)
          const second = rest.split(':')[0] ?? ''
          add({
            kind: 'State',
            _0: stateStmt(
              head,
              'default',
              { kind: 'Many', _0: [trim(description), second] },
              undefined,
              undefined,
              undefined,
            ),
          })
        } else {
          add({
            kind: 'State',
            _0: stateStmt(id, 'default', { kind: 'One', _0: trim(description) }, undefined, undefined, undefined),
          })
        }
        break
      }
      case T.Fork: {
        const id = take(p)
        add(typed(id, 'fork'))
        break
      }
      case T.Join: {
        const id = take(p)
        add(typed(id, 'join'))
        break
      }
      case T.Choice: {
        const id = take(p)
        add(typed(id, 'choice'))
        break
      }
      case T.Concurrent: {
        p.i += 1
        const id = stateDbDividerId(db)
        add({ kind: 'State', _0: stateStmt(id, 'divider', undefined, undefined, undefined, undefined) })
        break
      }
      case T.Note: {
        const keyword = take(p)
        const k = kind(p)
        if (k === T.LeftOf || k === T.RightOf) {
          const position = trim(take(p))
          const id = trim(expect(p, T.Id))
          const text = trim(expect(p, T.NoteText))
          add({
            kind: 'State',
            _0: stateStmt(id, undefined, undefined, undefined, undefined, { position, text }),
          })
        } else {
          if (k !== T.NoteText) throw fail(p, "'NOTE_TEXT', 'left_of', 'right_of'")
          p.i += 1
          expect(p, T.As)
          expect(p, T.Id)
          add({ kind: 'Text', _0: keyword })
        }
        break
      }
      case T.DirectionTb:
      case T.DirectionBt:
      case T.DirectionRl:
      case T.DirectionLr: {
        const value =
          t === T.DirectionBt ? 'BT' : t === T.DirectionRl ? 'RL' : t === T.DirectionLr ? 'LR' : 'TB'
        p.i += 1
        // Pele's `db.setDirection` writes into the root document the grammar replaces when it
        // finishes, so it has no effect and is left out.
        add({ kind: 'Dir', _0: value })
        break
      }
      case T.AccTitle: {
        p.i += 1
        const value = trim(expect(p, T.AccTitleValue))
        db.accTitle = trimStart(value)
        add({ kind: 'Text', _0: value })
        break
      }
      case T.AccDescr: {
        p.i += 1
        const value = trim(expect(p, T.AccDescrValue))
        db.accDescr = accDescription(value)
        add({ kind: 'Text', _0: value })
        break
      }
      case T.AccDescrMultilineValue: {
        const value = trim(take(p))
        db.accDescr = accDescription(value)
        add({ kind: 'Text', _0: value })
        break
      }
      case T.Click: {
        p.i += 1
        const id = idStatement(p)
        let url: string
        let tooltip: string
        if (kind(p) === T.Href) {
          p.i += 1
          url = expect(p, T.String)
          tooltip = ''
        } else {
          if (kind(p) !== T.String) throw fail(p, "'STRING', 'HREF'")
          url = take(p)
          tooltip = expect(p, T.String)
        }
        expect(p, T.Nl)
        add({ kind: 'Click', id, tooltip, url })
        break
      }
      case T.ClassDef: {
        p.i += 1
        const id = trim(expect(p, T.ClassDefId))
        const classes = trim(expect(p, T.ClassDefStyleOpts))
        add({ kind: 'ClassDef', classes, id })
        break
      }
      case T.Style: {
        p.i += 1
        const id = trim(expect(p, T.StyleIds))
        const styleClass = trim(expect(p, T.StyleDefStyleOpts))
        add({ kind: 'Style', id, styleClass })
        break
      }
      case T.Class: {
        p.i += 1
        const id = trim(expect(p, T.ClassEntityIds))
        const styleClass = trim(expect(p, T.StyleClass))
        add({ kind: 'ApplyClass', id, styleClass })
        break
      }
      case T.StructStop: {
        if (docs.length <= 1) throw fail(p, expected("'$end'"))
        p.i += 1
        close(docs)
        break
      }
      case T.End: {
        if (docs.length > 1) throw fail(p, expected("'STRUCT_STOP'"))
        const doc = docs.pop() ?? []
        stateDbSetRootDoc(db, doc)
        return
      }
      default: {
        const first = docs.length > 1 ? "'STRUCT_STOP'" : "'$end'"
        throw fail(p, expected(first))
      }
    }
  }
}

/** `first` followed by every statement token. */
function expected(first: string): string {
  return `${first}, ${STATEMENT}`
}

/** Closes the innermost body: moves it into the composite state that opened it. */
function close(docs: Stmt[][]): void {
  const body: Doc | undefined = docs.pop()
  if (body === undefined) return
  const doc = docs[docs.length - 1]
  const last = doc !== undefined && doc.length > 0 ? doc[doc.length - 1] : undefined
  if (last?.kind === 'State') last._0.doc = body
}

/** Pele's `trimColon`. */
function trimColon(text: string): string {
  return text.startsWith(':') ? trim(text.slice(1)) : trim(text)
}

/** Pele's `setAccDescription`: each line break and the whitespace after it become one line break. */
function accDescription(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text.charCodeAt(i)
    out += text[i]
    i++
    if (c === 10) {
      // Whitespace is all in the BMP, so testing UTF-16 units matches testing characters.
      while (i < n && isSpace(text.charCodeAt(i))) i++
    }
  }
  return out
}
