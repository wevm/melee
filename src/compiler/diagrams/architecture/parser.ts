/**
 * @module Tokens and parser of Mermaid's `architecture-beta` Langium grammar. Port of Pele's
 * `src/diagrams/architecture/parser.ts`.
 */
import {
  ACC_DESCR,
  ACC_TITLE,
  DIRECTIVE,
  EOF,
  NEWLINE,
  type Reader,
  SINGLE_LINE_COMMENT,
  STRING,
  TITLE,
  type TokenType,
  WHITESPACE,
  YAML,
  accDescrValue,
  accTitleValue,
  literal,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerTake,
  stringValue,
  titleValue,
  tokenize,
} from '../common/tokens.ts'
import { trim } from '../../text/label.ts'
import { isLineEnd, isWord } from '../../util/chars.ts'

/**
 * Token kinds: indices into {@link ARCHITECTURE_TOKENS}, whose order is the matching order.
 *
 * Line breaks, blanks, and the line-leading title and accessibility statements come first: none
 * of the later types can match where they do, so the first match is the same as in Mermaid's
 * order, and the common blanks need not be tried against every keyword first.
 */
const t = {
  NEWLINE: 0,
  ACC_DESCR: 1,
  ACC_TITLE: 2,
  TITLE: 3,
  WHITESPACE: 4,
  HEADER: 5,
  JUNCTION: 6,
  SERVICE: 7,
  COLUMN: 8,
  GROUP: 9,
  ALIGN: 10,
  ROW: 11,
  DASHES: 12,
  IN: 13,
  COLON: 14,
  DASH: 15,
  DIRECTION: 16,
  ARROW_GROUP: 17,
  INTO: 18,
  STRING: 19,
  ID: 20,
  YAML: 21,
  ICON: 24,
  LABEL: 25,
} as const

/** `[\w]([-\w]*\w)?`. */
const ID: TokenType = {
  ...literal(''),
  name: 'ID',
  pattern: { kind: 'Match', _0: id },
}

/** A word of the grammar, which an identifier that goes on longer takes over. */
function word(text: string): TokenType {
  return { ...literal(text), longer: [t.ID] }
}

/**
 * Mermaid's architecture tokens, in matching order.
 *
 * The direction letters come before identifiers and have no longer alternative, so Mermaid
 * reads an id that starts with L, R, T or B as a direction followed by the rest.
 */
export const ARCHITECTURE_TOKENS: TokenType[] = [
  NEWLINE,
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  WHITESPACE,
  word('architecture-beta'),
  word('junction'),
  word('service'),
  word('column'),
  word('group'),
  word('align'),
  word('row'),
  { ...literal('--'), longer: [t.YAML] },
  word('in'),
  literal(':'),
  { ...literal('-'), longer: [t.YAML] },
  { ...literal(''), first: 'LRTB', name: 'ARROW_DIRECTION', pattern: { kind: 'Match', _0: direction } },
  { ...literal('{group}'), name: 'ARROW_GROUP' },
  { ...literal(''), first: '<>', name: 'ARROW_INTO', pattern: { kind: 'Match', _0: into } },
  STRING,
  ID,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
  { ...literal(''), first: '(', name: 'ARCH_ICON', pattern: { kind: 'Match', _0: icon } },
  { ...literal(''), first: '[', name: 'ARCH_TITLE', pattern: { kind: 'Match', _0: label } },
]

/** The UTF-16 unit at `p`, or 0 past the end. */
function byte(src: string, p: number): number {
  return p < src.length ? src.charCodeAt(p) : 0
}

/** Whether the unit at `p` is a `\w` character. */
function wordAt(src: string, p: number): boolean {
  return isWord(byte(src, p))
}

/** `[\w]([-\w]*\w)?`: the greedy run backs off to its last word character. */
function id(src: string, p: number): number | undefined {
  const n = src.length
  // Past the end `charCodeAt` reads NaN, which is no word character.
  if (!isWord(src.charCodeAt(p))) return undefined
  let end = p + 1
  let q = p + 1
  while (q < n) {
    const c = src.charCodeAt(q)
    if (isWord(c)) end = q + 1
    else if (c !== 0x2d) break
    q += 1
  }
  return end
}

/** `L|R|T|B`. */
function direction(src: string, p: number): number | undefined {
  const c = byte(src, p)
  return c === 0x4c || c === 0x52 || c === 0x54 || c === 0x42 ? p + 1 : undefined
}

/** `<|>`. */
function into(src: string, p: number): number | undefined {
  const c = byte(src, p)
  return c === 0x3c || c === 0x3e ? p + 1 : undefined
}

/** `\([\w-:]+\)`. */
function icon(src: string, p: number): number | undefined {
  if (byte(src, p) !== 0x28) return undefined
  let q = p + 1
  while (wordAt(src, q) || byte(src, q) === 0x2d || byte(src, q) === 0x3a) q += 1
  return q > p + 1 && byte(src, q) === 0x29 ? q + 1 : undefined
}

/**
 * `\[(?:"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\[\]\r\n]+)\]`. Each alternative is tried in turn and
 * must be followed by the closing bracket.
 */
function label(src: string, p: number): number | undefined {
  if (byte(src, p) !== 0x5b) return undefined
  const q = p + 1
  for (const quote of ['"', "'"]) {
    const end = quoted(src, q, quote)
    if (end !== undefined && byte(src, end) === 0x5d) return end + 1
  }
  if (q > src.length) return undefined
  let run = 0
  while (q + run < src.length) {
    const c = src.charCodeAt(q + run)
    if (c === 0x5b || c === 0x5d || c === 0x0d || c === 0x0a) break
    run += 1
  }
  return run > 0 && byte(src, q + run) === 0x5d ? q + run + 1 : undefined
}

/** `Q([^Q\\]|\\.)*Q` from `p` for quote `Q`, where `.` is any character but a line terminator. */
function quoted(src: string, p: number, quote: string): number | undefined {
  if (p >= src.length || src[p] !== quote) return undefined
  let at = p + 1
  while (at < src.length) {
    const c = src[at] as string
    at += 1
    if (c === quote) return at
    if (c === '\\') {
      if (at >= src.length) return undefined
      const next = src.codePointAt(at) as number
      at += next > 0xffff ? 2 : 1
      if (isLineEnd(next)) return undefined
    }
  }
  return undefined
}

/** A side of a node an edge attaches to. */
export const Side = {
  /** Bottom. */
  B: 'B',
  /** Left. */
  L: 'L',
  /** Right. */
  R: 'R',
  /** Top. */
  T: 'T',
} as const
export type Side = (typeof Side)[keyof typeof Side]

/** The side named by a direction token. */
function sideOf(text: string): Side {
  switch (text) {
    case 'L':
      return Side.L
    case 'R':
      return Side.R
    case 'T':
      return Side.T
    default:
      return Side.B
  }
}

/** The side's letter. */
export function sideAsStr(self: Side): string {
  return self
}

/** The direction of an alignment. */
export const Direction = {
  /** `align column`. */
  Column: 'Column',
  /** `align row`. */
  Row: 'Row',
} as const
export type Direction = (typeof Direction)[keyof typeof Direction]

/** The direction's keyword. */
export function directionAsStr(self: Direction): string {
  return self === Direction.Column ? 'column' : 'row'
}

/** A `group` statement. */
export type GroupAst = {
  /** The icon name. */
  icon: string | undefined
  /** The id. */
  id: string
  /** The parent group's id. */
  in: string | undefined
  /** The title. */
  title: string | undefined
}

/** A `service` statement. */
export type ServiceAst = {
  /** The icon name. */
  icon: string | undefined
  /** Text drawn in place of an icon. */
  iconText: string | undefined
  /** The id. */
  id: string
  /** The parent group's id. */
  in: string | undefined
  /** The title. */
  title: string | undefined
}

/** A `junction` statement. */
export type JunctionAst = {
  /** The id. */
  id: string
  /** The parent group's id. */
  in: string | undefined
}

/** An edge statement. */
export type EdgeAst = {
  /** Side of the left-hand node. */
  lhsDir: Side
  /** Whether the left-hand end crosses its group's border. */
  lhsGroup: boolean
  /** Left-hand node id. */
  lhsId: string
  /** Whether the left-hand end has an arrowhead. */
  lhsInto: boolean
  /** Side of the right-hand node. */
  rhsDir: Side
  /** Whether the right-hand end crosses its group's border. */
  rhsGroup: boolean
  /** Right-hand node id. */
  rhsId: string
  /** Whether the right-hand end has an arrowhead. */
  rhsInto: boolean
  /** The label. */
  title: string | undefined
}

/** An `align` statement. */
export type AlignmentAst = {
  /** Row or column. */
  direction: Direction
  /** Ids of the aligned nodes. */
  members: string[]
}

/** A parsed architecture document. */
export type ArchitectureAst = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Alignments in source order. */
  alignments: AlignmentAst[]
  /** Edges in source order. */
  edges: EdgeAst[]
  /** Groups in source order. */
  groups: GroupAst[]
  /** Junctions in source order. */
  junctions: JunctionAst[]
  /** Services in source order. */
  services: ServiceAst[]
  /** The title. */
  title: string | undefined
}

/** `ArchitectureAst::default()`. */
export function architectureAstDefault(): ArchitectureAst {
  return {
    accDescr: undefined,
    accTitle: undefined,
    alignments: [],
    edges: [],
    groups: [],
    junctions: [],
    services: [],
    title: undefined,
  }
}

/** Mermaid's `ArchitectureValueConverter` for `ARCH_TITLE`. */
function labelValue(text: string): string {
  const inner = text.length >= 1 ? text.slice(1, Math.max(text.length - 1, 1)) : ''
  const result = trim(inner)
  const quoted =
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'")))
  // `"` alone starts and ends with a quote too, and JavaScript's `slice(1, -1)` makes it empty.
  const single = result.length === 1 && (result === '"' || result === "'")
  if (single) return ''
  if (!quoted) return result
  let body = result.slice(1, result.length - 1)
  body = unescape(unescape(body, '"'), "'")
  return trim(body)
}

/** `text.replace(/\\Q/g, 'Q')` for quote `Q`. */
function unescape(text: string, quote: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (c === '\\' && text[i + 1] === quote) continue
    out += c
  }
  return out
}

/**
 * Parses an architecture document.
 *
 * @throws {CompileError} A syntax error for text Mermaid's grammar rejects.
 */
export function parseArchitecture(src: string): ArchitectureAst {
  const r = readerNew(tokenize(src, ARCHITECTURE_TOKENS, 'architecture'), ARCHITECTURE_TOKENS, 'architecture')
  const ast = architectureAstDefault()

  while (readerKind(r) === t.NEWLINE) r.i += 1
  readerExpect(r, t.HEADER)
  while (readerKind(r) !== EOF) {
    switch (readerKind(r)) {
      case t.NEWLINE:
        r.i += 1
        continue
      case t.ACC_DESCR:
        ast.accDescr = accDescrValue(readerTake(r))
        break
      case t.ACC_TITLE:
        ast.accTitle = accTitleValue(readerTake(r))
        break
      case t.TITLE:
        ast.title = titleValue(readerTake(r))
        break
      case t.GROUP: {
        r.i += 1
        const group: GroupAst = { icon: undefined, id: readerExpect(r, t.ID), in: undefined, title: undefined }
        if (readerKind(r) === t.ICON) group.icon = inner(readerTake(r))
        if (readerKind(r) === t.LABEL) group.title = labelValue(readerTake(r))
        if (readerAccept(r, t.IN)) group.in = readerExpect(r, t.ID)
        ast.groups.push(group)
        break
      }
      case t.SERVICE: {
        r.i += 1
        const service: ServiceAst = {
          icon: undefined,
          iconText: undefined,
          id: readerExpect(r, t.ID),
          in: undefined,
          title: undefined,
        }
        if (readerKind(r) === t.STRING) service.iconText = stringValue(readerTake(r))
        else if (readerKind(r) === t.ICON) service.icon = inner(readerTake(r))
        if (readerKind(r) === t.LABEL) service.title = labelValue(readerTake(r))
        if (readerAccept(r, t.IN)) service.in = readerExpect(r, t.ID)
        ast.services.push(service)
        break
      }
      case t.JUNCTION: {
        r.i += 1
        const junction: JunctionAst = { id: readerExpect(r, t.ID), in: undefined }
        if (readerAccept(r, t.IN)) junction.in = readerExpect(r, t.ID)
        ast.junctions.push(junction)
        break
      }
      case t.ID:
        ast.edges.push(edge(r))
        break
      case t.ALIGN: {
        r.i += 1
        if (readerKind(r) !== t.ROW && readerKind(r) !== t.COLUMN) throw readerFail(r, "'row' or 'column'")
        const direction = readerTake(r) === 'row' ? Direction.Row : Direction.Column
        const members = [readerExpect(r, t.ID), readerExpect(r, t.ID)]
        while (readerKind(r) === t.ID) members.push(readerTake(r))
        ast.alignments.push({ direction, members })
        break
      }
      default:
        throw readerFail(r, 'a group, a service, a junction, an edge, an alignment, a title, or a line break')
    }
    endOfLine(r)
  }
  return ast
}

/** The text between the first and last characters of a token whose ends are ASCII. */
function inner(text: string): string {
  if (text.length < 1) return ''
  return text.slice(1, Math.max(text.length - 1, 1))
}

/** An edge, from its left-hand id. */
function edge(r: Reader): EdgeAst {
  const lhsId = readerTake(r)
  const lhsGroup = readerAccept(r, t.ARROW_GROUP)
  readerExpect(r, t.COLON)
  const lhsDir = sideOf(readerExpect(r, t.DIRECTION))
  const lhsInto = readerAccept(r, t.INTO)
  let title: string | undefined
  if (!readerAccept(r, t.DASHES)) {
    if (readerKind(r) !== t.DASH) throw readerFail(r, "'--' or '-'")
    r.i += 1
    title = labelValue(readerExpect(r, t.LABEL))
    readerExpect(r, t.DASH)
  }
  const rhsInto = readerAccept(r, t.INTO)
  const rhsDir = sideOf(readerExpect(r, t.DIRECTION))
  readerExpect(r, t.COLON)
  const rhsId = readerExpect(r, t.ID)
  const rhsGroup = readerAccept(r, t.ARROW_GROUP)
  return { lhsDir, lhsGroup, lhsId, lhsInto, rhsDir, rhsGroup, rhsId, rhsInto, title }
}

/** A line break or the end of input, then any further line breaks. */
function endOfLine(r: Reader): void {
  if (readerKind(r) === EOF) return
  if (readerKind(r) !== t.NEWLINE) throw readerFail(r, 'a line break or the end of input')
  while (readerKind(r) === t.NEWLINE) r.i += 1
}
