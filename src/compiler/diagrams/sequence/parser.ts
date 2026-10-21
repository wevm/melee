/**
 * @module The sequence parser: a port of Mermaid's sequence grammar. Port of Pele's
 * `src/diagrams/sequence/parser.ts`.
 *
 * Pele builds Mermaid's nested statement lists and walks them once the document has parsed. The
 * walk visits statements in document order, and the texts Pele reads at the end of a block are
 * pure functions of the source, so this port lists the statements flat as it reads them.
 */
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { parse } from '../../util/float.ts'
import {
  Declare,
  Menu,
  type SeqDb,
  type Statement,
  extractWrap,
  seqDbApply,
  seqDbParseBoxData,
  seqDbSetAccDescription,
  seqDbSetAccTitle,
  seqDbSetDiagramTitle,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import { type NoteActor, type SeqNumbering, type SeqText, line, placement } from './types.ts'

const SIGNAL_TOKENS =
  "'SOLID_OPEN_ARROW', 'DOTTED_OPEN_ARROW', 'SOLID_ARROW', 'DOTTED_ARROW', 'SOLID_CROSS', 'DOTTED_CROSS', 'SOLID_POINT', 'DOTTED_POINT'"

/** The message kind of an arrow token. */
function signalOf(kind: T): number | undefined {
  switch (kind) {
    case T.SolidOpenArrow:
      return line.SOLID_OPEN
    case T.DottedOpenArrow:
      return line.DOTTED_OPEN
    case T.SolidArrow:
      return line.SOLID
    case T.DottedArrow:
      return line.DOTTED
    case T.BidirectionalSolidArrow:
      return line.BIDIRECTIONAL_SOLID
    case T.BidirectionalDottedArrow:
      return line.BIDIRECTIONAL_DOTTED
    case T.SolidCross:
      return line.SOLID_CROSS
    case T.DottedCross:
      return line.DOTTED_CROSS
    case T.SolidPoint:
      return line.SOLID_POINT
    case T.DottedPoint:
      return line.DOTTED_POINT
    case T.SolidArrowTop:
      return line.SOLID_TOP
    case T.SolidArrowBottom:
      return line.SOLID_BOTTOM
    case T.StickArrowTop:
      return line.STICK_TOP
    case T.StickArrowBottom:
      return line.STICK_BOTTOM
    case T.SolidArrowTopDotted:
      return line.SOLID_TOP_DOTTED
    case T.SolidArrowBottomDotted:
      return line.SOLID_BOTTOM_DOTTED
    case T.StickArrowTopDotted:
      return line.STICK_TOP_DOTTED
    case T.StickArrowBottomDotted:
      return line.STICK_BOTTOM_DOTTED
    case T.SolidArrowTopReverse:
      return line.SOLID_ARROW_TOP_REVERSE
    case T.SolidArrowBottomReverse:
      return line.SOLID_ARROW_BOTTOM_REVERSE
    case T.StickArrowTopReverse:
      return line.STICK_ARROW_TOP_REVERSE
    case T.StickArrowBottomReverse:
      return line.STICK_ARROW_BOTTOM_REVERSE
    case T.SolidArrowTopReverseDotted:
      return line.SOLID_ARROW_TOP_REVERSE_DOTTED
    case T.SolidArrowBottomReverseDotted:
      return line.SOLID_ARROW_BOTTOM_REVERSE_DOTTED
    case T.StickArrowTopReverseDotted:
      return line.STICK_ARROW_TOP_REVERSE_DOTTED
    case T.StickArrowBottomReverseDotted:
      return line.STICK_ARROW_BOTTOM_REVERSE_DOTTED
    default:
      return undefined
  }
}

/** The kind of an open block. */
const K = {
  Box: 0,
  Loop: 1,
  Rect: 2,
  Opt: 3,
  Break: 4,
  Alt: 5,
  Par: 6,
  Critical: 7,
} as const
type K = (typeof K)[keyof typeof K]

/** Parser state: the tokens, the position, and the statements read so far. */
type Parser = {
  i: number
  out: Statement[]
  src: string
  tokens: Token[]
}

function parserToken(self: Parser, i: number): Token {
  return self.tokens[i] ?? self.tokens[self.tokens.length - 1] ?? { kind: T.Eof, start: self.src.length, text: '' }
}

function parserKind(self: Parser): T {
  return parserToken(self, self.i).kind
}

function parserFail(self: Parser, expected: string): CompileError {
  const token = parserToken(self, self.i)
  if (token.kind === T.Error) return errorSyntax('sequence', self.src, token.start, '', true)
  const detail = `Expecting ${expected}, got '${tName(token.kind)}'`
  return errorSyntax('sequence', self.src, token.start, detail, false)
}

function parserExpect(self: Parser, wanted: T): string {
  if (parserKind(self) !== wanted) throw parserFail(self, `'${tName(wanted)}'`)
  const text = parserToken(self, self.i).text
  self.i += 1
  return text
}

function parserActor(self: Parser): string {
  const kind = parserKind(self)
  if (kind !== T.Actor && kind !== T.Link) throw parserFail(self, "'ACTOR'")
  const text = parserToken(self, self.i).text
  self.i += 1
  return text
}

/** Adds the statement that mentions a participant. */
function parserMention(self: Parser, actor: string): void {
  self.out.push({
    kind: 'Participant',
    actor,
    config: undefined,
    description: undefined,
    draw: undefined,
    how: Declare.Add,
  })
}

function parserText2(self: Parser): SeqText {
  const text = trim(parserExpect(self, T.Txt))
  return extractWrap(text.slice(1))
}

function parserParticipant(self: Parser, how: Declare): void {
  const t = parserKind(self)
  self.i += 1
  if (t === T.Destroy) {
    const actor = parserActor(self)
    parserExpect(self, T.Newline)
    self.out.push({
      kind: 'Participant',
      actor,
      config: undefined,
      description: undefined,
      draw: undefined,
      how: how === Declare.Create ? Declare.Create : Declare.Destroy,
    })
    return
  }
  const actor = parserActor(self)
  let config: string | undefined
  if (parserKind(self) === T.ConfigStart && parserToken(self, self.i - 1).kind === T.Actor) {
    self.i += 1
    const content = parserExpect(self, T.ConfigContent)
    parserExpect(self, T.ConfigEnd)
    config = trim(content)
  }
  const draw = t === T.Participant ? 'participant' : 'actor'
  let description: SeqText | undefined
  if (parserKind(self) === T.As) {
    self.i += 1
    const alias = parserExpect(self, T.RestOfLine)
    parserExpect(self, T.Newline)
    description = extractWrap(alias)
  } else if (parserKind(self) === T.Newline) {
    self.i += 1
  } else {
    throw parserFail(self, "'AS', 'NEWLINE'")
  }
  self.out.push({ kind: 'Participant', actor, config, description, draw, how })
}

function parserSignal(self: Parser, from: string): void {
  let centralFrom = false
  if (parserKind(self) === T.Central) {
    centralFrom = true
    self.i += 1
  }
  const signalType = signalOf(parserKind(self))
  if (signalType === undefined) throw parserFail(self, SIGNAL_TOKENS)
  self.i += 1
  const mark = parserKind(self)
  if (mark === T.Central || (!centralFrom && (mark === T.Plus || mark === T.Minus))) self.i += 1
  const to = parserActor(self)
  const msg = parserText2(self)
  parserMention(self, from)
  parserMention(self, to)
  const marker = (actor: string, signalType: number): Statement => ({ kind: 'Marker', actor, signalType })
  let activate = false
  let centralConnection: number | undefined
  const extra: Statement[] = []
  if (centralFrom) {
    const dual = mark === T.Central
    activate = dual
    centralConnection = dual ? line.CENTRAL_CONNECTION_DUAL : line.CENTRAL_CONNECTION_REVERSE
    if (dual) extra.push(marker(to, line.CENTRAL_CONNECTION))
    extra.push(marker(from, line.CENTRAL_CONNECTION_REVERSE))
  } else if (mark === T.Plus) {
    activate = true
    extra.push(marker(to, line.ACTIVE_START))
  } else if (mark === T.Minus) {
    extra.push(marker(from, line.ACTIVE_END))
  } else if (mark === T.Central) {
    activate = true
    centralConnection = line.CENTRAL_CONNECTION
    extra.push(marker(to, line.CENTRAL_CONNECTION))
  }
  self.out.push({ kind: 'Message', activate, centralConnection, from, msg, signalType, to })
  for (const statement of extra) self.out.push(statement)
}

function parserMenu(self: Parser, kind: Menu): void {
  self.i += 1
  const actor = parserActor(self)
  parserMention(self, actor)
  const text = parserText2(self)
  self.out.push({ kind: 'Menu', actor, menuKind: kind, text })
}

function parserNote(self: Parser): void {
  self.i += 1
  const t = parserKind(self)
  if (t === T.Over) {
    self.i += 1
    const first = parserActor(self)
    parserMention(self, first)
    let second = first
    if (parserKind(self) === T.Comma) {
      self.i += 1
      second = parserActor(self)
      parserMention(self, second)
    }
    const text = parserText2(self)
    const actor: NoteActor = { kind: 'Over', _0: first, _1: second }
    self.out.push({ kind: 'Note', actor, placement: placement.OVER, text })
    return
  }
  if (t !== T.LeftOf && t !== T.RightOf) throw parserFail(self, "'over', 'left_of', 'right_of'")
  self.i += 1
  const who = parserActor(self)
  parserMention(self, who)
  const text = parserText2(self)
  self.out.push({
    kind: 'Note',
    actor: { kind: 'Single', _0: who },
    placement: t === T.LeftOf ? placement.LEFT_OF : placement.RIGHT_OF,
    text,
  })
}

function parserAutonumber(self: Parser): void {
  self.i += 1
  const numbering: SeqNumbering = { start: undefined, step: undefined, visible: true }
  if (parserKind(self) === T.Num) {
    numbering.start = jsNumber(parserToken(self, self.i).text)
    self.i += 1
    if (parserKind(self) === T.Num) {
      const step = jsNumber(parserToken(self, self.i).text)
      self.i += 1
      numbering.step = step
    } else {
      numbering.step = 1
    }
  } else if (parserKind(self) === T.Off) {
    self.i += 1
    numbering.visible = false
  }
  if (parserKind(self) !== T.Newline) throw parserFail(self, "'NEWLINE', 'NUM', 'off'")
  self.i += 1
  self.out.push({ kind: 'SequenceIndex', _0: numbering })
}

function parserBlock(self: Parser, signalType: number, text: string): void {
  self.out.push({ kind: 'Block', signalType, text: extractWrap(text) })
}

/** Adds the statement that opens a block of `kind`. */
function parserOpen(self: Parser, kind: K, t: T, text: string): void {
  switch (kind) {
    case K.Box:
      self.out.push({ kind: 'BoxStart', _0: seqDbParseBoxData(text) })
      break
    case K.Loop:
      parserBlock(self, line.LOOP_START, text)
      break
    case K.Rect:
      parserBlock(self, line.RECT_START, text)
      break
    case K.Opt:
      parserBlock(self, line.OPT_START, text)
      break
    case K.Break:
      parserBlock(self, line.BREAK_START, text)
      break
    case K.Alt:
      parserBlock(self, line.ALT_START, text)
      break
    case K.Par:
      parserBlock(self, t === T.ParOver ? line.PAR_OVER_START : line.PAR_START, text)
      break
    case K.Critical:
      parserBlock(self, line.CRITICAL_START, text)
      break
  }
}

/** Adds the statement that closes a block of `kind`. */
function parserClose(self: Parser, kind: K): void {
  let signalType: number
  switch (kind) {
    case K.Box:
      self.out.push({ kind: 'BoxEnd' })
      return
    case K.Loop:
      signalType = line.LOOP_END
      break
    case K.Rect:
      signalType = line.RECT_END
      break
    case K.Opt:
      signalType = line.OPT_END
      break
    case K.Break:
      signalType = line.BREAK_END
      break
    case K.Alt:
      signalType = line.ALT_END
      break
    case K.Par:
      signalType = line.PAR_END
      break
    case K.Critical:
      signalType = line.CRITICAL_END
      break
  }
  self.out.push({ kind: 'Block', signalType, text: undefined })
}

/** JavaScript's `Number` of a numeric token. */
function jsNumber(text: string): number {
  return parse(text) ?? Number.NaN
}

/**
 * `text` as one flat string. The source arrives joined from pieces, and V8 reads the characters
 * of a joined string through an indirection on every access, even once it is flattened. Joining
 * two non-empty parts in an array copies them into a new sequential string.
 */
function sequential(text: string): string {
  if (text.length < 2) return text
  return [text.slice(0, -1), text.slice(-1)].join('')
}

/**
 * Parses preprocessed sequence diagram `src` into `db`. Throws a syntax error for input Mermaid
 * rejects, and the errors of `seqDbApply`.
 */
export function parseSequence(source: string, db: SeqDb): void {
  const src = sequential(source)
  const p: Parser = { i: 0, out: [], src, tokens: tokenize(src) }

  while (parserKind(p) === T.Newline) p.i += 1
  parserExpect(p, T.Sd)

  const stack: K[] = []
  for (;;) {
    const t = parserKind(p)
    const frame = stack.length === 0 ? undefined : stack[stack.length - 1]
    if (frame === K.Box) {
      switch (t) {
        case T.Participant:
        case T.ParticipantActor:
        case T.Destroy:
          parserParticipant(p, Declare.Add)
          break
        case T.Newline:
          p.i += 1
          break
        case T.End:
          p.i += 1
          stack.pop()
          parserClose(p, K.Box)
          break
        default:
          throw parserFail(p, "'end', 'NEWLINE', 'participant', 'participant_actor', 'destroy'")
      }
      continue
    }
    switch (t) {
      case T.Newline:
      case T.Invalid:
        p.i += 1
        break
      case T.Participant:
      case T.ParticipantActor:
      case T.Destroy:
        parserParticipant(p, Declare.Add)
        break
      case T.Create: {
        p.i += 1
        const next = parserKind(p)
        if (next !== T.Participant && next !== T.ParticipantActor && next !== T.Destroy) {
          throw parserFail(p, "'participant', 'participant_actor', 'destroy'")
        }
        parserParticipant(p, Declare.Create)
        break
      }
      case T.Actor: {
        const from = parserActor(p)
        parserSignal(p, from)
        parserExpect(p, T.Newline)
        break
      }
      case T.Link: {
        const next = parserToken(p, p.i + 1).kind
        if (next === T.Actor || next === T.Link) {
          parserMenu(p, Menu.ALink)
        } else {
          const from = parserActor(p)
          parserSignal(p, from)
        }
        parserExpect(p, T.Newline)
        break
      }
      case T.Links:
      case T.Properties:
      case T.Details:
        parserMenu(p, t === T.Links ? Menu.Links : t === T.Properties ? Menu.Properties : Menu.Details)
        parserExpect(p, T.Newline)
        break
      case T.Note:
        parserNote(p)
        parserExpect(p, T.Newline)
        break
      case T.Autonumber:
        parserAutonumber(p)
        break
      case T.Activate:
      case T.Deactivate: {
        p.i += 1
        const who = parserActor(p)
        parserExpect(p, T.Newline)
        p.out.push({
          kind: 'Marker',
          actor: who,
          signalType: t === T.Activate ? line.ACTIVE_START : line.ACTIVE_END,
        })
        break
      }
      case T.Title:
      case T.LegacyTitle: {
        const text = parserToken(p, p.i).text
        p.i += 1
        // The token starts with `title` or `title:` and one whitespace character.
        const head = t === T.Title ? 5 : 6
        const rest = text.slice(head)
        const first = rest.codePointAt(0)
        const skip = first === undefined ? 0 : first > 0xffff ? 2 : 1
        seqDbSetDiagramTitle(db, rest.slice(skip))
        break
      }
      case T.AccTitle: {
        p.i += 1
        const value = trim(parserExpect(p, T.AccTitleValue))
        seqDbSetAccTitle(db, value)
        break
      }
      case T.AccDescr: {
        p.i += 1
        const value = trim(parserExpect(p, T.AccDescrValue))
        seqDbSetAccDescription(db, value)
        break
      }
      case T.AccDescrMultilineValue: {
        const value = trim(parserToken(p, p.i).text)
        p.i += 1
        seqDbSetAccDescription(db, value)
        break
      }
      case T.Loop:
      case T.Rect:
      case T.Opt:
      case T.Break:
      case T.Alt:
      case T.Par:
      case T.ParOver:
      case T.Critical:
      case T.Box: {
        p.i += 1
        const text = parserExpect(p, T.RestOfLine)
        let kind: K
        switch (t) {
          case T.Loop:
            kind = K.Loop
            break
          case T.Rect:
            kind = K.Rect
            break
          case T.Opt:
            kind = K.Opt
            break
          case T.Break:
            kind = K.Break
            break
          case T.Alt:
            kind = K.Alt
            break
          case T.Par:
          case T.ParOver:
            kind = K.Par
            break
          case T.Critical:
            kind = K.Critical
            break
          default:
            kind = K.Box
        }
        parserOpen(p, kind, t, text)
        stack.push(kind)
        break
      }
      case T.Else:
      case T.And:
      case T.Option: {
        const [wanted, signalType] =
          t === T.Else
            ? [K.Alt, line.ALT_ELSE]
            : t === T.And
              ? [K.Par, line.PAR_AND]
              : [K.Critical, line.CRITICAL_OPTION]
        if (frame !== wanted) throw parserFail(p, "'end'")
        p.i += 1
        const text = parserExpect(p, T.RestOfLine)
        parserBlock(p, signalType, text)
        break
      }
      case T.End: {
        if (frame === undefined) throw parserFail(p, "'NEWLINE', 'EOF'")
        p.i += 1
        stack.pop()
        parserClose(p, frame)
        break
      }
      case T.Eof:
        if (frame !== undefined) throw parserFail(p, "'end'")
        seqDbApply(db, p.out)
        return
      default:
        throw parserFail(p, "'NEWLINE', 'ACTOR', 'participant', 'note', 'end'")
    }
  }
}
