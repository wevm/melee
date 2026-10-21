/**
 * @module The flowchart parser: a hand-written equivalent of Mermaid's Jison grammar that reports the
 * same errors at the same tokens. Port of Pele's `src/diagrams/flowchart/parser.ts`.
 */
import {
  type FlowDb,
  flowDbAddClass,
  flowDbAddLink,
  flowDbAddSubgraph,
  flowDbAddVertex,
  flowDbDestructLink,
  flowDbSetAccDescription,
  flowDbSetAccTitle,
  flowDbSetClass,
  flowDbSetClickEvent,
  flowDbSetDirection,
  flowDbSetLink,
  flowDbSetTooltip,
  flowDbUpdateLink,
  flowDbUpdateLinkInterpolate,
  jsTrim,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import { type DocItem, type FlowText, LabelType, type LinkInfo } from './types.ts'
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

/** Tokens of a subgraph id written without brackets. */
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
    case T.Subgraph:
    case T.SubgraphEnd:
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
  switch (t) {
    case T.Num:
    case T.NodeString:
    case T.Colon:
    case T.Space:
    case T.Brkt:
    case T.Style:
      return true
    default:
      return false
  }
}

/** Tokens that continue a node label. */
function isText(t: T): boolean {
  return t === T.Text || t === T.TagStart || t === T.TagEnd || t === T.UnicodeText
}

const TEXT_TOKENS = "'UNICODE_TEXT', 'TEXT', 'TAGSTART'"

const STATEMENT_START =
  "'SEMI', 'NEWLINE', 'SPACE', 'EOF', 'subgraph', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'STYLE', 'LINKSTYLE', 'CLASSDEF', 'CLASS', 'CLICK', 'NODE_STRING'"

/** An open subgraph: its header and the body of its parent. */
type Frame = {
  collect: boolean
  id: FlowText | undefined
  list: DocItem[]
  /** Whether the title is the id itself, which Pele tests by object identity. */
  same: boolean
  title: FlowText | undefined
}

type Parser = {
  db: FlowDb
  i: number
  /** The ids read so far, so that each id is one string. */
  names: Interner
  src: string
  tokens: Token[]
}

/**
 * Mermaid trims whitespace between a closing brace and the end of its line before parsing:
 * `source.replace(/}\s*\n/g, '}\n')`.
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
    while (run < source.length && isSpace(source.charCodeAt(run))) run++
    const newline = run > tail ? source.lastIndexOf('\n', run - 1) : -1
    if (newline >= tail) {
      out += '\n'
      rest = newline + 1
    } else {
      rest = tail
    }
  }
  out += source.slice(rest)
  return out
}

/** Parses flowchart `source` into `db`. */
export function parseFlowchart(source: string, db: FlowDb): void {
  const src = trimBraceLines(source)
  const parser: Parser = {
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
  return ps.tokens[i]?.kind ?? T.End
}

function parserTextAt(ps: Parser, i: number): string {
  return ps.tokens[i]?.text ?? ''
}

/** Takes the current token's text. */
function parserTake(ps: Parser): string {
  const text = parserTextAt(ps, ps.i)
  ps.i += 1
  return text
}

function parserFail(ps: Parser, expected: string): CompileError {
  const t = parserKind(ps)
  const start = ps.tokens[ps.i]?.start ?? ps.src.length
  if (t === T.Error) return errorSyntax('flowchart', ps.src, start, '', true)

  let detail = 'Expecting '
  detail += expected
  detail += ", got '"
  detail += tName(t)
  detail += "'"
  return errorSyntax('flowchart', ps.src, start, detail, false)
}

function parserExpect(ps: Parser, kind: T, also: string): string {
  if (parserKind(ps) !== kind) {
    let expected = "'"
    expected += tName(kind)
    expected += "'"
    if (also !== '') {
      expected += ', '
      expected += also
    }
    throw parserFail(ps, expected)
  }
  return parserTake(ps)
}

function parserSeparator(ps: Parser): void {
  const t = parserKind(ps)
  if (t !== T.Newline && t !== T.Semi && t !== T.Eof) throw parserFail(ps, "'SEMI', 'NEWLINE', 'EOF'")
  ps.i += 1
}

/** Concatenates a run of tokens of one class, failing with `expected` when there is none. */
function parserRunOf(ps: Parser, klass: (t: T) => boolean, expected: string): string {
  if (!klass(parserKind(ps))) throw parserFail(ps, expected)
  let s = parserTake(ps)
  while (klass(parserKind(ps))) {
    s += parserTextAt(ps, ps.i)
    ps.i += 1
  }
  return s
}

function parserIdString(ps: Parser): string {
  return intern(ps.names, parserRunOf(ps, isId, "'NODE_STRING'"))
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
  else {
    let expected = TEXT_TOKENS
    expected += ", 'TAGEND', 'STR', 'MD_STR'"
    throw parserFail(ps, expected)
  }
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
  for (let k = parserKind(ps); k === T.EdgeText || k === T.UnicodeText; k = parserKind(ps)) {
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

function parserShapeData(ps: Parser): string {
  let s = parserTake(ps)
  while (parserKind(ps) === T.ShapeData) {
    s += parserTextAt(ps, ps.i)
    ps.i += 1
  }
  return s
}

/** A label between `open`, already consumed, and `close`, added with `shape`. */
function parserShaped(ps: Parser, id: string, close: T, shape: string): void {
  const label = parserText(ps)
  parserClosed(ps, close)
  flowDbAddVertex(ps.db, id, label, shape, undefined, undefined, undefined)
}

function parserVertex(ps: Parser): string {
  const id = parserIdString(ps)
  const open = parserKind(ps)
  switch (open) {
    case T.Sqs:
      ps.i += 1
      parserShaped(ps, id, T.Sqe, 'square')
      break
    case T.DoubleCircleStart:
      ps.i += 1
      parserShaped(ps, id, T.DoubleCircleEnd, 'doublecircle')
      break
    case T.Ps:
      ps.i += 1
      if (parserKind(ps) === T.Ps) {
        ps.i += 1
        const label = parserText(ps)
        parserClosed(ps, T.Pe)
        parserExpect(ps, T.Pe, '')
        flowDbAddVertex(ps.db, id, label, 'circle', undefined, undefined, undefined)
      } else {
        parserShaped(ps, id, T.Pe, 'round')
      }
      break
    case T.EllipseStart:
      ps.i += 1
      parserShaped(ps, id, T.EllipseEnd, 'ellipse')
      break
    case T.StadiumStart:
      ps.i += 1
      parserShaped(ps, id, T.StadiumEnd, 'stadium')
      break
    case T.SubroutineStart:
      ps.i += 1
      parserShaped(ps, id, T.SubroutineEnd, 'subroutine')
      break
    case T.VertexWithPropsStart: {
      ps.i += 1
      const field = parserExpect(ps, T.NodeString, '')
      parserExpect(ps, T.Colon, '')
      const value = parserExpect(ps, T.NodeString, '')
      parserExpect(ps, T.Pipe, '')
      const label = parserText(ps)
      parserClosed(ps, T.Sqe)
      flowDbAddVertex(ps.db, id, label, 'rect', undefined, [field, value], undefined)
      break
    }
    case T.CylinderStart:
      ps.i += 1
      parserShaped(ps, id, T.CylinderEnd, 'cylinder')
      break
    case T.DiamondStart:
      ps.i += 1
      if (parserKind(ps) === T.DiamondStart) {
        ps.i += 1
        const label = parserText(ps)
        parserClosed(ps, T.DiamondStop)
        parserExpect(ps, T.DiamondStop, '')
        flowDbAddVertex(ps.db, id, label, 'hexagon', undefined, undefined, undefined)
      } else {
        parserShaped(ps, id, T.DiamondStop, 'diamond')
      }
      break
    case T.TagEnd:
      ps.i += 1
      parserShaped(ps, id, T.Sqe, 'odd')
      break
    case T.TrapStart: {
      ps.i += 1
      const label = parserText(ps)
      let shape: string
      if (parserKind(ps) === T.InvTrapEnd) {
        ps.i += 1
        shape = 'lean_right'
      } else {
        parserClosed(ps, T.TrapEnd)
        shape = 'trapezoid'
      }
      flowDbAddVertex(ps.db, id, label, shape, undefined, undefined, undefined)
      break
    }
    case T.InvTrapStart: {
      ps.i += 1
      const label = parserText(ps)
      let shape: string
      if (parserKind(ps) === T.TrapEnd) {
        ps.i += 1
        shape = 'lean_left'
      } else {
        parserClosed(ps, T.InvTrapEnd)
        shape = 'inv_trapezoid'
      }
      flowDbAddVertex(ps.db, id, label, shape, undefined, undefined, undefined)
      break
    }
    default:
      flowDbAddVertex(ps.db, id, undefined, undefined, undefined, undefined, undefined)
  }
  return id
}

function parserStyledVertex(ps: Parser): string {
  const id = parserVertex(ps)
  if (parserKind(ps) === T.StyleSeparator) {
    ps.i += 1
    const klass = parserIdString(ps)
    flowDbSetClass(ps.db, id, klass)
  }
  return id
}

/**
 * A node group joined by `&`, and the shape data that trails its last node. Pele keeps the
 * trailing data in `pendingData`.
 */
function parserNode(ps: Parser): [string[], string | undefined] {
  const ids = [parserStyledVertex(ps)]
  for (;;) {
    const data = parserKind(ps) === T.ShapeData ? parserShapeData(ps) : undefined
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
    if (data !== undefined && last !== undefined) {
      flowDbAddVertex(ps.db, last, undefined, undefined, undefined, undefined, data)
    }
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
    const info = flowDbDestructLink(text, undefined)
    info.id = id
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
    const info = flowDbDestructLink(end, start)
    info.text = label
    info.id = id
    return info
  }

  throw parserFail(ps, "'LINK', 'START_LINK'")
}

function parserVertexStatement(ps: Parser): string[] {
  const [first, data] = parserNode(ps)
  let stmt = first
  const last = stmt[stmt.length - 1]
  if (data !== undefined && last !== undefined) {
    flowDbAddVertex(ps.db, last, undefined, undefined, undefined, undefined, data)
  }

  let nodes = stmt.slice()
  for (;;) {
    const t = parserKind(ps)
    if (t !== T.Link && t !== T.StartLink && t !== T.LinkId) return nodes
    const info = parserLink(ps)
    const [next, nextData] = parserNode(ps)
    const nextLast = next[next.length - 1]
    if (nextData !== undefined && nextLast !== undefined) {
      flowDbAddVertex(ps.db, nextLast, undefined, undefined, undefined, undefined, nextData)
    }
    flowDbAddLink(ps.db, stmt, next, info)

    nodes = [...next, ...nodes]
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
    flowDbUpdateLink(ps.db, positions, styles)
    return
  }

  ps.i += 1
  parserExpect(ps, T.Space, '')
  const interpolate = parserAlphaNum(ps)
  if (parserKind(ps) === T.Space) {
    ps.i += 1
    const styles = parserStylesOpt(ps)
    flowDbUpdateLinkInterpolate(ps.db, positions, interpolate)
    flowDbUpdateLink(ps.db, positions, styles)
  } else {
    flowDbUpdateLinkInterpolate(ps.db, positions, interpolate)
  }
}

function parserLinkTail(ps: Parser, id: string, url: string): void {
  if (parserKind(ps) !== T.Space) {
    flowDbSetLink(ps.db, id, url, undefined)
    return
  }

  ps.i += 1
  if (parserKind(ps) === T.LinkTarget) {
    const target = parserTake(ps)
    flowDbSetLink(ps.db, id, url, target)
    return
  }

  const tooltip = parserExpect(ps, T.Str, "'LINK_TARGET'")
  if (parserKind(ps) === T.Space) {
    ps.i += 1
    const target = parserExpect(ps, T.LinkTarget, '')
    flowDbSetLink(ps.db, id, url, target)
  } else {
    flowDbSetLink(ps.db, id, url, undefined)
  }
  flowDbSetTooltip(ps.db, id, tooltip)
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
      flowDbSetClickEvent(ps.db, id)
      if (tooltip !== undefined) flowDbSetTooltip(ps.db, id, tooltip)
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
        flowDbSetClickEvent(ps.db, id)
        flowDbSetTooltip(ps.db, id, tooltip)
      } else {
        flowDbSetClickEvent(ps.db, id)
      }
  }
}

function parserSubgraphHeader(ps: Parser): Frame {
  ps.i += 1
  let t = parserKind(ps)
  if (t === T.Newline || t === T.Semi || t === T.Eof) {
    ps.i += 1
    return { collect: false, id: undefined, list: [], same: false, title: undefined }
  }

  parserExpect(ps, T.Space, "'SEMI', 'NEWLINE', 'EOF'")
  const id = parserTextNoTags(ps)
  let title: FlowText | undefined
  if (parserKind(ps) === T.Sqs) {
    ps.i += 1
    title = parserText(ps)
    parserClosed(ps, T.Sqe)
  }
  t = parserKind(ps)
  if (t !== T.Newline && t !== T.Semi && t !== T.Eof) {
    throw parserFail(ps, "'SEMI', 'NEWLINE', 'EOF', 'SQS'")
  }
  ps.i += 1

  const same = title === undefined
  return { collect: false, id, list: [], same, title: title ?? { ...id } }
}

/** One statement, or `undefined` for statements that add nothing to a subgraph body. */
function parserStatement(ps: Parser): DocItem | undefined {
  const t = parserKind(ps)
  switch (t) {
    case T.Style: {
      ps.i += 1
      parserExpect(ps, T.Space, '')
      const id = parserIdString(ps)
      parserExpect(ps, T.Space, '')
      const styles = parserStylesOpt(ps)
      flowDbAddVertex(ps.db, id, undefined, undefined, styles, undefined, undefined)
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
      flowDbAddClass(ps.db, id, styles)
      parserSeparator(ps)
      return undefined
    }
    case T.Class: {
      ps.i += 1
      parserExpect(ps, T.Space, '')
      const ids = parserIdString(ps)
      parserExpect(ps, T.Space, '')
      const klass = parserIdString(ps)
      flowDbSetClass(ps.db, ids, klass)
      parserSeparator(ps)
      return undefined
    }
    case T.Click:
      parserClickStatement(ps)
      parserSeparator(ps)
      return undefined
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
      flowDbSetAccTitle(ps.db, value)
      return { kind: 'Str', _0: value }
    }
    case T.AccDescr: {
      ps.i += 1
      const value = jsTrim(parserExpect(ps, T.AccDescrValue, ''))
      flowDbSetAccDescription(ps.db, value)
      return { kind: 'Str', _0: value }
    }
    case T.AccDescrMultilineValue: {
      const value = jsTrim(parserTake(ps))
      flowDbSetAccDescription(ps.db, value)
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
 * Subgraphs nest without recursion: each open one keeps the list and collect flag of its
 * parent.
 */
function parserDocument(ps: Parser): void {
  const open: Frame[] = []
  let list: DocItem[] = []
  let collect = false
  for (;;) {
    const t = parserKind(ps)
    if (t === T.End) break

    if (t === T.SubgraphEnd) {
      const frame = open.pop()
      if (frame === undefined) break
      ps.i += 1
      const id = flowDbAddSubgraph(ps.db, frame.id, list, frame.title, frame.same)
      list = frame.list
      collect = frame.collect
      if (collect) list.push({ kind: 'Str', _0: id })
    } else if (t === T.Semi || t === T.Newline || t === T.Space || t === T.Eof) {
      if (collect) list.push({ kind: 'Str', _0: parserTextAt(ps, ps.i) })
      ps.i += 1
    } else if (t === T.Subgraph) {
      const frame = parserSubgraphHeader(ps)
      frame.list = list
      list = []
      frame.collect = collect
      open.push(frame)
      collect = true
    } else {
      const item = parserStatement(ps)
      if (item !== undefined && collect) list.push(item)
    }
  }

  if (open.length > 0) throw parserFail(ps, "'end'")
}

function parserRun(ps: Parser): void {
  while (parserKind(ps) === T.Space || parserKind(ps) === T.Newline) ps.i += 1
  parserExpect(ps, T.Graph, "'SPACE', 'NEWLINE'")

  if (parserKind(ps) === T.NoDir) {
    ps.i += 1
    flowDbSetDirection(ps.db, 'TB')
  } else {
    const dir = parserExpect(ps, T.Dir, "'NODIR'")
    const t = parserKind(ps)
    if (t === T.Space) {
      while (parserKind(ps) === T.Space) ps.i += 1
      if (parserKind(ps) !== T.Newline) throw parserFail(ps, "'NEWLINE', 'SPACE'")
    } else if (t !== T.Semi && t !== T.Newline) {
      throw parserFail(ps, "'SEMI', 'NEWLINE', 'SPACE'")
    }
    ps.i += 1
    flowDbSetDirection(ps.db, dir)
  }

  parserDocument(ps)
  if (parserKind(ps) !== T.End) throw parserFail(ps, STATEMENT_START)
}
