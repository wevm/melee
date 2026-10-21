/**
 * @module The agentflow parser: a hand-written equivalent of Mermaid's Jison grammar that reports the
 * same errors at the same tokens and records where each statement sits. Port of Pele's
 * `src/diagrams/agentflow/parser.ts`.
 */
import {
  type AgentflowDb,
  agentflowDbAddClass,
  agentflowDbAddConnector,
  agentflowDbAddConnectorMapping,
  agentflowDbAddEdgeMapping,
  agentflowDbAddGlobal,
  agentflowDbAddLink,
  agentflowDbAddSubgraph,
  agentflowDbAddSubgraphMapping,
  agentflowDbAddVertex,
  agentflowDbAddVertexMapping,
  agentflowDbDestructLink,
  agentflowDbExtendVertexMapping,
  agentflowDbSetAccDescription,
  agentflowDbSetAccTitle,
  agentflowDbSetClass,
  agentflowDbSetClickEvent,
  agentflowDbSetDirection,
  agentflowDbSetLink,
  agentflowDbSetTooltip,
  agentflowDbUpdateLink,
  agentflowDbUpdateLinkInterpolate,
  jsTrim,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import { type DocItem, type FlowText, LabelType, type LinkInfo, type Loc, locDefault } from './types.ts'
import { type CompileError, errorSyntax } from '../../error.ts'
import { isSpace } from '../../util/chars.ts'
import { type Interner, intern, internerNew } from '../../util/intern.ts'

/** Tokens that continue an id. */
function isId(t: T): boolean {
  switch (t) {
    case T.Num:
    case T.NodeString:
    case T.Down:
    case T.Minus:
    case T.Default:
    case T.Comma:
    case T.Colon:
    case T.Amp:
    case T.Brkt:
    case T.Mult:
    case T.UnicodeText:
      return true
    default:
      return false
  }
}

/** Tokens of an alphanumeric name, such as a callback or curve. */
function isAlphaNum(t: T): boolean {
  switch (t) {
    case T.Num:
    case T.UnicodeText:
    case T.NodeString:
    case T.Dir:
    case T.Down:
    case T.Minus:
    case T.Comma:
    case T.Colon:
    case T.Amp:
    case T.Brkt:
    case T.Mult:
      return true
    default:
      return false
  }
}

/** Tokens of a block id written without brackets. */
function isNoTags(t: T): boolean {
  switch (t) {
    case T.Num:
    case T.NodeString:
    case T.Space:
    case T.Minus:
    case T.Amp:
    case T.UnicodeText:
    case T.Colon:
    case T.Mult:
    case T.Brkt:
    case T.Style:
    case T.LinkStyle:
    case T.ClassDef:
    case T.Class:
    case T.Click:
    case T.Graph:
    case T.Dir:
    case T.Flow:
    case T.Connector:
    case T.Global:
    case T.BlockEnd:
    case T.Down:
    case T.Up:
    case T.StartLink:
      return true
    default:
      return false
  }
}

/** Tokens of one style declaration. */
function isStylePart(t: T): boolean {
  return t === T.Num || t === T.NodeString || t === T.Colon || t === T.Space || t === T.Brkt || t === T.Style
}

/** Tokens that end a statement. */
function isSeparator(t: T): boolean {
  return t === T.Newline || t === T.Semi || t === T.Eof || t === T.Comment
}

/** Tokens that continue a node label. */
function isText(t: T): boolean {
  return t === T.Text || t === T.TagStart || t === T.TagEnd || t === T.UnicodeText
}

const TEXT_TOKENS = "'UNICODE_TEXT', 'TEXT', 'TAGSTART'"

const SEPARATORS = "'COMMENT', 'SEMI', 'NEWLINE', 'EOF'"

const STATEMENT_START =
  "'COMMENT', 'SEMI', 'NEWLINE', 'SPACE', 'EOF', 'flow', 'global', 'connector', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'STYLE', 'LINKSTYLE', 'CLASSDEF', 'CLASS', 'CLICK', 'NODE_STRING'"

/**
 * An open `flow` or `global` block, or a `connector` header: its header and the body of its
 * parent.
 */
type Frame = {
  /** Token index of the keyword. */
  at: number
  collect: boolean
  data: string | undefined
  dataFrom: number
  dataTo: number
  global: boolean
  id: FlowText | undefined
  list: DocItem[]
  title: FlowText | undefined
}

type Parser = {
  dataFrom: number
  dataTo: number
  db: AgentflowDb
  i: number
  /** Node ids, shared so that every map keyed by one hashes it once. */
  names: Interner
  src: string
  tokens: Token[]
}

/**
 * Mermaid trims spaces and tabs between a closing brace and the end of its line before
 * parsing: `source.replace(/}[^\S\n]*\n/g, '}\n')`.
 */
function trimBraceLines(source: string): string {
  if (!source.includes('}')) return source

  let out = ''
  let rest = 0
  for (;;) {
    const at = source.indexOf('}', rest)
    if (at < 0) break
    out += source.slice(rest, at + 1)
    const tail = at + 1
    let run = tail
    while (run < source.length) {
      const c = source.codePointAt(run) as number
      if (c === 10 || !isSpace(c)) break
      run += c > 0xffff ? 2 : 1
    }
    if (run < source.length && source.charCodeAt(run) === 10) {
      out += '\n'
      rest = run + 1
    } else {
      rest = tail
    }
  }
  out += source.slice(rest)
  return out
}

/** Parses agentflow `source` into `db`. */
export function parseAgentflow(source: string, db: AgentflowDb): void {
  const src = trimBraceLines(source)
  const parser: Parser = {
    dataFrom: 0,
    dataTo: 0,
    db,
    i: 0,
    names: internerNew(),
    src,
    tokens: tokenize(src),
  }
  parserRun(parser)
}

function parserKind(ps: Parser): T {
  return parserKindAt(ps, ps.i)
}

function parserKindAt(ps: Parser, i: number): T {
  const token = ps.tokens[i]
  return token === undefined ? T.End : token.kind
}

function parserTextAt(ps: Parser, i: number): string {
  const token = ps.tokens[i]
  return token === undefined ? '' : token.text
}

/** Takes the current token's text. */
function parserTake(ps: Parser): string {
  const text = parserTextAt(ps, ps.i)
  ps.i += 1
  return text
}

/** `Loc::default()`, which is only read. */
const LOC_DEFAULT: Loc = locDefault()

/** The span from the start of token `a` to the end of token `b`. */
function parserSpan(ps: Parser, a: number, b: number): Loc {
  const first: Loc = ps.tokens[a] ?? LOC_DEFAULT
  const last: Loc = ps.tokens[b] ?? LOC_DEFAULT
  return {
    firstColumn: first.firstColumn,
    firstLine: first.firstLine,
    lastColumn: last.lastColumn,
    lastLine: last.lastLine,
  }
}

function parserFail(ps: Parser, expected: string): CompileError {
  const t = parserKind(ps)
  const token = ps.tokens[ps.i]
  const start = token === undefined ? ps.src.length : token.start
  if (t === T.Error) return errorSyntax('agentflow', ps.src, start, '', true)

  const detail = `Expecting ${expected}, got '${tName(t)}'`
  return errorSyntax('agentflow', ps.src, start, detail, false)
}

function parserExpect(ps: Parser, kind: T, also: string): string {
  if (parserKind(ps) !== kind) {
    let expected = `'${tName(kind)}'`
    if (also !== '') {
      expected += ', '
      expected += also
    }
    throw parserFail(ps, expected)
  }
  return parserTake(ps)
}

function parserSeparator(ps: Parser): void {
  if (!isSeparator(parserKind(ps))) throw parserFail(ps, SEPARATORS)
  ps.i += 1
}

/** Concatenates a run of tokens of one class, failing with `expected` when there is none. */
function parserRunOf(ps: Parser, cls: (t: T) => boolean, expected: string): string {
  if (!cls(parserKind(ps))) throw parserFail(ps, expected)
  let s = parserTake(ps)
  while (cls(parserKind(ps))) {
    s += parserTextAt(ps, ps.i)
    ps.i += 1
  }
  return s
}

function parserIdString(ps: Parser): string {
  return parserRunOf(ps, isId, "'NODE_STRING'")
}

function parserAlphaNum(ps: Parser): string {
  return parserRunOf(ps, isAlphaNum, "'NODE_STRING'")
}

function parserText(ps: Parser): FlowText {
  const t = parserKind(ps)
  let type: LabelType
  if (t === T.Str) type = LabelType.String
  else if (t === T.MdStr) type = LabelType.Markdown
  else if (isText(t)) type = LabelType.Text
  else throw parserFail(ps, TEXT_TOKENS + ", 'TAGEND', 'STR', 'MD_STR'")
  let text = parserTake(ps)
  while (isText(parserKind(ps))) {
    text += parserTextAt(ps, ps.i)
    ps.i += 1
  }
  return { text, type }
}

function parserClosed(ps: Parser, kind: T): void {
  parserExpect(ps, kind, TEXT_TOKENS)
}

function parserEdgeText(ps: Parser): FlowText {
  const t = parserKind(ps)
  let type: LabelType
  if (t === T.Str) type = LabelType.String
  else if (t === T.MdStr) type = LabelType.Markdown
  else if (t === T.EdgeText || t === T.UnicodeText) type = LabelType.Text
  else throw parserFail(ps, "'EDGE_TEXT', 'STR', 'MD_STR'")
  let text = parserTake(ps)
  for (;;) {
    const k = parserKind(ps)
    if (k !== T.EdgeText && k !== T.UnicodeText) break
    text += parserTextAt(ps, ps.i)
    ps.i += 1
  }
  return { text, type }
}

function parserTextNoTags(ps: Parser): FlowText {
  const t = parserKind(ps)
  let type: LabelType
  if (t === T.Str) type = LabelType.Text
  else if (t === T.MdStr) type = LabelType.Markdown
  else if (isNoTags(t)) type = LabelType.Text
  else throw parserFail(ps, "'NODE_STRING', 'STR', 'MD_STR'")
  let text = parserTake(ps)
  while (isNoTags(parserKind(ps))) {
    text += parserTextAt(ps, ps.i)
    ps.i += 1
  }
  return { text, type }
}

/** Reads a metadata block, recording the tokens it spans. */
function parserShapeData(ps: Parser): string {
  ps.dataFrom = ps.i
  let s = parserTake(ps)
  while (parserKind(ps) === T.ShapeData) {
    s += parserTextAt(ps, ps.i)
    ps.i += 1
  }
  ps.dataTo = ps.i - 1
  return s
}

/** Adds metadata to `id` and widens its span over the block. */
function parserAttach(ps: Parser, id: string, data: string, from: number, to: number): void {
  const loc = parserSpan(ps, from, to)
  agentflowDbAddVertex(ps.db, id, undefined, undefined, undefined, undefined, [data, loc])
  agentflowDbExtendVertexMapping(ps.db, id, loc)
}

/** Adds a block header's metadata to `id`. */
function parserAttachData(ps: Parser, id: string, frame: Frame): void {
  const data = frame.data
  if (data === undefined) return
  const loc = parserSpan(ps, frame.dataFrom, frame.dataTo)
  agentflowDbAddVertex(ps.db, id, undefined, undefined, undefined, undefined, [data, loc])
}

function parserVertex(ps: Parser): string {
  const from = ps.i
  const id = intern(ps.names, parserIdString(ps))
  let label: FlowText | undefined
  let shape: string | undefined
  let props: [string, string] | undefined
  switch (parserKind(ps)) {
    case T.Sqs:
      ps.i += 1
      label = parserText(ps)
      parserClosed(ps, T.Sqe)
      shape = 'square'
      break
    case T.DoubleCircleStart:
      ps.i += 1
      label = parserText(ps)
      parserClosed(ps, T.DoubleCircleEnd)
      shape = 'doublecircle'
      break
    case T.Ps:
      ps.i += 1
      if (parserKind(ps) === T.Ps) {
        ps.i += 1
        label = parserText(ps)
        parserClosed(ps, T.Pe)
        parserExpect(ps, T.Pe, '')
        shape = 'circle'
      } else {
        label = parserText(ps)
        parserClosed(ps, T.Pe)
        shape = 'round'
      }
      break
    case T.EllipseStart:
      ps.i += 1
      label = parserText(ps)
      parserClosed(ps, T.EllipseEnd)
      shape = 'ellipse'
      break
    case T.StadiumStart:
      ps.i += 1
      label = parserText(ps)
      parserClosed(ps, T.StadiumEnd)
      shape = 'stadium'
      break
    case T.SubroutineStart:
      ps.i += 1
      label = parserText(ps)
      parserClosed(ps, T.SubroutineEnd)
      shape = 'subroutine'
      break
    case T.VertexWithPropsStart: {
      ps.i += 1
      const field = parserExpect(ps, T.NodeString, '')
      parserExpect(ps, T.Colon, '')
      const value = parserExpect(ps, T.NodeString, '')
      parserExpect(ps, T.Pipe, '')
      label = parserText(ps)
      parserClosed(ps, T.Sqe)
      shape = 'rect'
      props = [field, value]
      break
    }
    case T.CylinderStart:
      ps.i += 1
      label = parserText(ps)
      parserClosed(ps, T.CylinderEnd)
      shape = 'cylinder'
      break
    case T.DiamondStart:
      ps.i += 1
      if (parserKind(ps) === T.DiamondStart) {
        ps.i += 1
        label = parserText(ps)
        parserClosed(ps, T.DiamondStop)
        parserExpect(ps, T.DiamondStop, '')
        shape = 'hexagon'
      } else {
        label = parserText(ps)
        parserClosed(ps, T.DiamondStop)
        shape = 'diamond'
      }
      break
    case T.TagEnd:
      ps.i += 1
      label = parserText(ps)
      parserClosed(ps, T.Sqe)
      shape = 'odd'
      break
    case T.TrapStart:
      ps.i += 1
      label = parserText(ps)
      if (parserKind(ps) === T.InvTrapEnd) {
        ps.i += 1
        shape = 'lean_right'
      } else {
        parserClosed(ps, T.TrapEnd)
        shape = 'trapezoid'
      }
      break
    case T.InvTrapStart:
      ps.i += 1
      label = parserText(ps)
      if (parserKind(ps) === T.TrapEnd) {
        ps.i += 1
        shape = 'lean_left'
      } else {
        parserClosed(ps, T.InvTrapEnd)
        shape = 'inv_trapezoid'
      }
      break
    default:
      break
  }
  agentflowDbAddVertex(ps.db, id, label, shape, undefined, props, undefined)
  const loc = parserSpan(ps, from, ps.i - 1)
  agentflowDbAddVertexMapping(ps.db, id, shape !== undefined, loc)
  return id
}

function parserStyledVertex(ps: Parser): string {
  const id = parserVertex(ps)
  if (parserKind(ps) === T.StyleSeparator) {
    ps.i += 1
    const cls = parserIdString(ps)
    agentflowDbSetClass(ps.db, id, cls)
  }
  return id
}

/**
 * A node group joined by `&`, and the metadata that trails its last node. Pele keeps the
 * trailing data in `pendingData`.
 */
function parserNode(ps: Parser): [string[], string | undefined] {
  const ids = [parserStyledVertex(ps)]
  for (;;) {
    const data = parserKind(ps) === T.ShapeData ? parserShapeData(ps) : undefined
    const from = ps.dataFrom
    const to = ps.dataTo
    if (parserKind(ps) !== T.Space) return [ids, data]

    parserSkipSpaces(ps)
    if (parserKind(ps) !== T.Amp) {
      if (data !== undefined) throw parserFail(ps, "'AMP'")
      return [ids, undefined]
    }

    ps.i += 1
    if (parserKind(ps) !== T.Space) throw parserFail(ps, "'SPACE'")
    parserSkipSpaces(ps)
    const next = parserStyledVertex(ps)
    const last = ids[ids.length - 1]
    if (data !== undefined && last !== undefined) parserAttach(ps, last, data, from, to)
    ids.push(next)
  }
}

/** Steps past the current token and any spaces after it. */
function parserSkipSpaces(ps: Parser): void {
  ps.i += 1
  while (parserKind(ps) === T.Space) ps.i += 1
}

function parserLink(ps: Parser): LinkInfo {
  const id = parserKind(ps) === T.LinkId ? parserTake(ps) : undefined

  if (parserKind(ps) === T.Link) {
    const text = parserTake(ps)
    const info = agentflowDbDestructLink(text, undefined)
    if (id !== undefined) info.id = id
    if (parserKind(ps) === T.Pipe) {
      ps.i += 1
      info.text = parserText(ps)
      parserClosed(ps, T.Pipe)
      if (parserKind(ps) === T.Space) ps.i += 1
    }
    return info
  }

  if (parserKind(ps) === T.StartLink) {
    const start = parserTake(ps)
    const label = parserEdgeText(ps)
    const end = parserExpect(ps, T.Link, "'EDGE_TEXT'")
    const info = agentflowDbDestructLink(end, start)
    info.text = label
    if (id !== undefined) info.id = id
    return info
  }

  throw parserFail(ps, "'LINK', 'START_LINK'")
}

/** A pending metadata block trails the last node of a group. */
function parserAttachPending(ps: Parser, ids: string[], data: string | undefined): void {
  const last = ids[ids.length - 1]
  if (data !== undefined && last !== undefined) parserAttach(ps, last, data, ps.dataFrom, ps.dataTo)
}

function parserVertexStatement(ps: Parser): string[] {
  const from = ps.i
  const [first, data] = parserNode(ps)
  let stmt = first
  parserAttachPending(ps, stmt, data)

  let nodes = stmt.slice()
  for (;;) {
    const k = parserKind(ps)
    if (k !== T.Link && k !== T.StartLink && k !== T.LinkId) return nodes
    const info = parserLink(ps)
    const [next, nextData] = parserNode(ps)
    parserAttachPending(ps, next, nextData)
    agentflowDbAddLink(ps.db, stmt, next, info)
    const loc = parserSpan(ps, from, ps.i - 1)
    agentflowDbAddEdgeMapping(ps.db, next, loc)

    nodes = next.concat(nodes)
    stmt = next
  }
}

function parserStyle(ps: Parser): string {
  return parserRunOf(ps, isStylePart, "'NODE_STRING', 'NUM', 'COLON', 'BRKT'")
}

function parserStylesOpt(ps: Parser): string[] {
  const out = [parserStyle(ps)]
  while (parserKind(ps) === T.Comma) {
    ps.i += 1
    out.push(parserStyle(ps))
  }
  return out
}

function parserLinkStyleStatement(ps: Parser): void {
  ps.i += 1
  parserExpect(ps, T.Space, '')
  const positions: string[] = []
  if (parserKind(ps) === T.Default) {
    positions.push(parserTake(ps))
  } else {
    positions.push(parserExpect(ps, T.Num, "'DEFAULT'"))
    while (parserKind(ps) === T.Comma) {
      ps.i += 1
      positions.push(parserExpect(ps, T.Num, ''))
    }
  }
  parserExpect(ps, T.Space, '')

  if (parserKind(ps) !== T.Interpolate) {
    const styles = parserStylesOpt(ps)
    agentflowDbUpdateLink(ps.db, positions, styles)
    return
  }

  ps.i += 1
  parserExpect(ps, T.Space, '')
  const interpolate = parserAlphaNum(ps)
  if (parserKind(ps) === T.Space) {
    ps.i += 1
    const styles = parserStylesOpt(ps)
    agentflowDbUpdateLinkInterpolate(ps.db, positions, interpolate)
    agentflowDbUpdateLink(ps.db, positions, styles)
  } else {
    agentflowDbUpdateLinkInterpolate(ps.db, positions, interpolate)
  }
}

function parserLinkTail(ps: Parser, id: string, url: string): void {
  if (parserKind(ps) !== T.Space) {
    agentflowDbSetLink(ps.db, id, url, undefined)
    return
  }

  ps.i += 1
  if (parserKind(ps) === T.LinkTarget) {
    const target = parserTake(ps)
    agentflowDbSetLink(ps.db, id, url, target)
    return
  }

  const tooltip = parserExpect(ps, T.Str, "'LINK_TARGET'")
  if (parserKind(ps) === T.Space) {
    ps.i += 1
    const target = parserExpect(ps, T.LinkTarget, '')
    agentflowDbSetLink(ps.db, id, url, target)
  } else {
    agentflowDbSetLink(ps.db, id, url, undefined)
  }
  agentflowDbSetTooltip(ps.db, id, tooltip)
}

function parserClickStatement(ps: Parser): void {
  const id = parserTake(ps)
  switch (parserKind(ps)) {
    case T.CallbackName: {
      ps.i += 1
      if (parserKind(ps) === T.CallbackArgs) ps.i += 1
      let tooltip: string | undefined
      if (parserKind(ps) === T.Space) {
        ps.i += 1
        tooltip = parserExpect(ps, T.Str, '')
      }
      agentflowDbSetClickEvent(ps.db, id)
      if (tooltip !== undefined) agentflowDbSetTooltip(ps.db, id, tooltip)
      return
    }
    case T.Href: {
      ps.i += 1
      const url = parserExpect(ps, T.Str, '')
      parserLinkTail(ps, id, url)
      return
    }
    case T.Str: {
      const url = parserTake(ps)
      parserLinkTail(ps, id, url)
      return
    }
    default:
      parserAlphaNum(ps)
      if (parserKind(ps) === T.Space) {
        ps.i += 1
        const tooltip = parserExpect(ps, T.Str, '')
        agentflowDbSetClickEvent(ps.db, id)
        agentflowDbSetTooltip(ps.db, id, tooltip)
      } else {
        agentflowDbSetClickEvent(ps.db, id)
      }
  }
}

/**
 * Reads a `flow` or `connector` header up to its separator: an id, an optional bracketed
 * title, and optional metadata. `at` is the keyword's token index.
 */
function parserHeader(ps: Parser, at: number): Frame {
  parserExpect(ps, T.Space, SEPARATORS)
  const id = parserTextNoTags(ps)
  let title: FlowText = { text: '', type: LabelType.Text }
  if (parserKind(ps) === T.Sqs) {
    ps.i += 1
    title = parserText(ps)
    parserClosed(ps, T.Sqe)
  }
  const data = parserKind(ps) === T.ShapeData ? parserShapeData(ps) : undefined
  if (!isSeparator(parserKind(ps))) throw parserFail(ps, SEPARATORS + ", 'SHAPE_DATA'")
  return {
    at,
    collect: false,
    data,
    dataFrom: ps.dataFrom,
    dataTo: ps.dataTo,
    global: false,
    id,
    list: [],
    title,
  }
}

/** One statement, or `undefined` for statements that add nothing to a block body. */
function parserStatement(ps: Parser): DocItem | undefined {
  const t = parserKind(ps)
  switch (t) {
    case T.Style: {
      ps.i += 1
      parserExpect(ps, T.Space, '')
      const id = parserIdString(ps)
      parserExpect(ps, T.Space, '')
      const styles = parserStylesOpt(ps)
      agentflowDbAddVertex(ps.db, id, undefined, undefined, styles, undefined, undefined)
      parserSeparator(ps)
      return undefined
    }
    case T.LinkStyle:
      parserLinkStyleStatement(ps)
      parserSeparator(ps)
      return undefined
    case T.ClassDef: {
      ps.i += 1
      parserExpect(ps, T.Space, '')
      const id = parserIdString(ps)
      parserExpect(ps, T.Space, '')
      const styles = parserStylesOpt(ps)
      agentflowDbAddClass(ps.db, id, styles)
      parserSeparator(ps)
      return undefined
    }
    case T.Class: {
      ps.i += 1
      parserExpect(ps, T.Space, '')
      const ids = parserIdString(ps)
      parserExpect(ps, T.Space, '')
      const cls = parserIdString(ps)
      agentflowDbSetClass(ps.db, ids, cls)
      parserSeparator(ps)
      return undefined
    }
    case T.Click:
      parserClickStatement(ps)
      parserSeparator(ps)
      return undefined
    case T.Connector: {
      const at = ps.i
      ps.i += 1
      const frame = parserHeader(ps, at)
      const sep = ps.i
      ps.i += 1
      const id = agentflowDbAddConnector(ps.db, frame.id, frame.title)
      parserAttachData(ps, id, frame)
      const start = parserSpan(ps, frame.at, frame.at)
      const end = parserSpan(ps, sep, sep)
      agentflowDbAddConnectorMapping(ps.db, frame.id, start, end)
      return { kind: 'Str', _0: id }
    }
    case T.DirectionTb:
    case T.DirectionBt:
    case T.DirectionRl:
    case T.DirectionLr:
    case T.DirectionTd: {
      ps.i += 1
      let value: string
      switch (t) {
        case T.DirectionTb:
          value = 'TB'
          break
        case T.DirectionBt:
          value = 'BT'
          break
        case T.DirectionRl:
          value = 'RL'
          break
        case T.DirectionLr:
          value = 'LR'
          break
        default:
          value = 'TD'
      }
      return { kind: 'Dir', _0: value }
    }
    case T.AccTitle: {
      ps.i += 1
      const value = jsTrim(parserExpect(ps, T.AccTitleValue, ''))
      agentflowDbSetAccTitle(ps.db, value)
      return { kind: 'Str', _0: value }
    }
    case T.AccDescr: {
      ps.i += 1
      const value = jsTrim(parserExpect(ps, T.AccDescrValue, ''))
      agentflowDbSetAccDescription(ps.db, value)
      return { kind: 'Str', _0: value }
    }
    case T.AccDescrMultilineValue: {
      const value = jsTrim(parserTake(ps))
      agentflowDbSetAccDescription(ps.db, value)
      return { kind: 'Str', _0: value }
    }
    default: {
      if (!isId(t)) throw parserFail(ps, STATEMENT_START)
      const nodes = parserVertexStatement(ps)
      parserSeparator(ps)
      return { kind: 'Ids', _0: nodes }
    }
  }
}

/**
 * Blocks nest without recursion: each open one keeps the list and collect flag of its
 * parent.
 */
function parserDocument(ps: Parser): void {
  const open: Frame[] = []
  let list: DocItem[] = []
  let collect = false
  for (;;) {
    const t = parserKind(ps)
    if (t === T.End) break

    if (t === T.BlockEnd) {
      const frame = open.pop()
      if (frame === undefined) break
      const at = ps.i
      ps.i += 1
      if (frame.global) {
        agentflowDbAddGlobal(ps.db, list)
        list = frame.list
        collect = frame.collect
        continue
      }
      const id = agentflowDbAddSubgraph(ps.db, frame.id, list, frame.title)
      parserAttachData(ps, id, frame)
      const start = parserSpan(ps, frame.at, frame.at)
      const end = parserSpan(ps, at, at)
      agentflowDbAddSubgraphMapping(ps.db, frame.id, start, end)
      list = frame.list
      collect = frame.collect
      if (collect) list.push({ kind: 'Str', _0: id })
    } else if (t === T.Semi || t === T.Newline || t === T.Space || t === T.Eof) {
      if (collect) list.push({ kind: 'Str', _0: parserTextAt(ps, ps.i) })
      ps.i += 1
    } else if (t === T.Comment) {
      ps.i += 1
    } else if (t === T.Flow || t === T.Global) {
      const at = ps.i
      ps.i += 1
      let frame: Frame
      if (t === T.Global || isSeparator(parserKind(ps))) {
        frame = {
          at,
          collect,
          data: undefined,
          dataFrom: 0,
          dataTo: 0,
          global: t === T.Global,
          id: undefined,
          list: [],
          title: undefined,
        }
        parserSeparator(ps)
      } else {
        frame = parserHeader(ps, at)
        frame.collect = collect
        ps.i += 1
      }
      frame.list = list
      list = []
      open.push(frame)
      collect = true
    } else {
      const item = parserStatement(ps)
      if (item !== undefined && collect && !(item.kind === 'Ids' && item._0.length === 0)) list.push(item)
    }
  }

  if (open.length > 0) throw parserFail(ps, "'end'")
}

function parserRun(ps: Parser): void {
  for (;;) {
    const k = parserKind(ps)
    if (k !== T.Space && k !== T.Newline && k !== T.Comment) break
    ps.i += 1
  }
  parserExpect(ps, T.Graph, "'SPACE', 'NEWLINE', 'COMMENT'")

  if (parserKind(ps) === T.NoDir) {
    ps.i += 1
    agentflowDbSetDirection(ps.db, 'TB')
  } else {
    const dir = parserExpect(ps, T.Dir, "'NODIR'")
    const t = parserKind(ps)
    if (t === T.Space) {
      while (parserKind(ps) === T.Space) ps.i += 1
      if (parserKind(ps) !== T.Newline) throw parserFail(ps, "'NEWLINE', 'SPACE'")
    } else if (t !== T.Semi && t !== T.Newline && t !== T.Comment) {
      throw parserFail(ps, "'COMMENT', 'SEMI', 'NEWLINE', 'SPACE'")
    }
    ps.i += 1
    agentflowDbSetDirection(ps.db, dir)
  }

  parserDocument(ps)
  if (parserKind(ps) !== T.End) throw parserFail(ps, STATEMENT_START)
}
