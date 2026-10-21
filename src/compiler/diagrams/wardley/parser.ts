/**
 * @module Tokens and a hand-written parser for Mermaid's Langium Wardley grammar. Port of Pele's
 * `src/diagrams/wardley/parser.ts`.
 */
import { trim } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { parse } from '../../util/float.ts'
import { accDescr } from '../common/acc_descr.ts'
import {
  ACC_TITLE,
  DIRECTIVE,
  EOF,
  type Matcher,
  type Memo,
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
  skipBlanks,
  stringValue,
  titleValue,
  tokenize,
} from '../common/tokens.ts'

// Token kinds: indices into `WARDLEY_TOKENS`, in Pele's `T` order.
const LBRACKET = 0
const COMMA = 1
const RBRACKET = 2
const AT = 3
const SLASH = 4
const LPAREN = 5
const RPAREN = 6
const MINUS = 7
const LBRACE = 8
const RBRACE = 9
const NUMBER = 10
const ARROW = 11
const LINK_PORT = 12
const LINK_ARROW = 13
const LINK_LABEL = 14
const STRATEGY = 15
const WARDLEY = 16
const SIZE = 17
const EVOLUTION = 18
const ANCHOR = 19
const COMPONENT = 20
const LABEL = 21
const INERTIA = 22
const EVOLVE = 23
const PIPELINE = 24
const NOTE = 25
const ANNOTATIONS = 26
const ANNOTATION = 27
const ACCELERATOR = 28
const DEACCELERATOR = 29
const NAME = 30
const ACC_DESCR_KIND = 32
const ACC_TITLE_KIND = 33
const TITLE_KIND = 34
const INT = 35
const STRING_KIND = 36
const ID = 37
const NEWLINE_KIND = 38

/** The index of `YAML` in {@link WARDLEY_TOKENS}. */
const YAML_KIND = 40

/** Whether the UTF-16 unit at `at` of `src` is an ASCII digit. */
function isDigitAt(src: string, at: number): boolean {
  const c = src.charCodeAt(at)
  return c >= 48 && c <= 57
}

/** Whether `c` is an ASCII letter. */
function isAsciiAlphabetic(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

/** Whether `c` is an ASCII letter or digit. */
function isAsciiAlphanumeric(c: number): boolean {
  return isAsciiAlphabetic(c) || (c >= 48 && c <= 57)
}

/** Where a run of ASCII digits from `from` ends. */
function digits(src: string, from: number): number {
  let at = from
  while (isDigitAt(src, at)) at += 1
  return at
}

/**
 * `[0-9]+\.[0-9]+`. The pattern reads a whole run of digits before it finds there is no
 * fraction, and would do so again from every digit of a long run, so `memo` keeps the run:
 * `memo[0]` is where it starts and `memo[1]` where it ends.
 */
function number(src: string, p: number, memo: Memo): number | undefined {
  if (p < (memo[0] as number) || p >= (memo[1] as number)) {
    memo[0] = p
    memo[1] = digits(src, p)
  }
  const end = memo[1] as number
  if (end === p || src.charCodeAt(end) !== 0x2e) return undefined
  const stop = digits(src, end + 1)
  return stop > end + 1 ? stop : undefined
}

/** `-->|-\.->|>|\+'[^']*'<>|\+'[^']*'<|\+'[^']*'>`. */
function linkArrow(src: string, p: number): number | undefined {
  if (p > src.length) return undefined
  if (src.startsWith('-->', p)) return p + 3
  if (src.startsWith('-.->', p)) return p + 4
  if (src.startsWith('>', p)) return p + 1
  if (!src.startsWith("+'", p)) return undefined
  const found = src.indexOf("'", p + 2)
  if (found < 0) return undefined
  const close = found
  if (src.startsWith('<>', close + 1)) return close + 3
  return src.startsWith('<', close + 1) || src.startsWith('>', close + 1) ? close + 2 : undefined
}

/** `\+<>|\+>|\+<`. */
function linkPort(src: string, p: number): number | undefined {
  if (p > src.length) return undefined
  if (src.startsWith('+<>', p)) return p + 3
  return src.startsWith('+>', p) || src.startsWith('+<', p) ? p + 2 : undefined
}

/** `;[^\n\r]+`. */
function linkLabel(src: string, p: number): number | undefined {
  if (p > src.length || src.charCodeAt(p) !== 0x3b) return undefined
  let end = p + 1
  while (end < src.length) {
    const c = src.charCodeAt(end)
    if (c === 0x0a || c === 0x0d) break
    end += 1
  }
  return end > p + 1 ? end : undefined
}

/** `build|buy|outsource|market`. */
function strategy(src: string, p: number): number | undefined {
  if (p > src.length) return undefined
  const word = ['build', 'buy', 'outsource', 'market'].find((word) => src.startsWith(word, p))
  return word === undefined ? undefined : p + word.length
}

/** `(?:[A-Za-z0-9_()&]|-(?!>))*` from `at`. */
function nameChars(src: string, at: number): number {
  while (at < src.length) {
    const c = src.charCodeAt(at)
    const ok =
      isAsciiAlphanumeric(c) ||
      c === 0x5f ||
      c === 0x28 ||
      c === 0x29 ||
      c === 0x26 ||
      (c === 0x2d && src.charCodeAt(at + 1) !== 0x3e)
    if (!ok) break
    at += 1
  }
  return at
}

/**
 * `(?!title\s|accTitle|accDescr)[A-Za-z](?:[A-Za-z0-9_()&]|-(?!>))*(?:[ \t]+[A-Za-z(](?:[A-Za-z0-9_()&]|-(?!>))*)*`.
 */
function nameWithSpaces(src: string, p: number): number | undefined {
  if (p > src.length) return undefined
  if (src.startsWith('accTitle', p) || src.startsWith('accDescr', p)) return undefined
  if (src.startsWith('title', p)) {
    const after = src.codePointAt(p + 5)
    if (after !== undefined && isSpace(after)) return undefined
  }

  if (p >= src.length || !isAsciiAlphabetic(src.charCodeAt(p))) return undefined
  let end = nameChars(src, p + 1)
  for (;;) {
    const q = skipBlanks(src, end)
    const c = src.charCodeAt(q)
    if (q < src.length && q > end && (isAsciiAlphabetic(c) || c === 0x28)) {
      end = nameChars(src, q + 1)
    } else {
      return end
    }
  }
}

/** `[ \t]+`. */
function ws(src: string, p: number): number | undefined {
  const end = skipBlanks(src, p)
  return end > p ? end : undefined
}

/** `0|[1-9][0-9]*(?!\.)`. The digits give back their last one when a `.` follows them. */
function int(src: string, p: number): number | undefined {
  if (p >= src.length) return undefined
  const c = src.charCodeAt(p)
  if (c === 0x30) return p + 1
  if (c >= 0x31 && c <= 0x39) {
    const end = digits(src, p + 1)
    if (src.charCodeAt(end) === 0x2e) return end >= p + 2 ? end - 1 : undefined
    return end
  }
  return undefined
}

/** `[\w]([-\w]*\w)?`. */
function id(src: string, p: number): number | undefined {
  const word = (c: number): boolean => isAsciiAlphanumeric(c) || c === 0x5f
  if (p >= src.length || !word(src.charCodeAt(p))) return undefined
  let end = p + 1
  while (end < src.length) {
    const c = src.charCodeAt(end)
    if (!(word(c) || c === 0x2d)) break
    end += 1
  }
  while (end > p + 1 && src.charCodeAt(end - 1) === 0x2d) end -= 1
  return end
}

/**
 * A token type that matches `text`, named `name`. Pele writes these as sticky expressions of
 * the text, which match it as a prefix of a longer word too.
 */
function word(name: string, text: string): TokenType {
  return { ...literal(text), name }
}

/** A token type with a hand-written matcher. */
function matcher(name: string, first: string, pattern: Matcher): TokenType {
  return {
    ...literal(''),
    first,
    name,
    pattern: { kind: 'Match', _0: pattern },
  }
}

/** The token types, in matching order. */
export const WARDLEY_TOKENS: TokenType[] = [
  literal('['),
  literal(','),
  literal(']'),
  literal('@'),
  literal('/'),
  literal('('),
  literal(')'),
  { ...literal('-'), longer: [ARROW, LINK_ARROW, YAML_KIND] },
  literal('{'),
  literal('}'),
  {
    ...literal(''),
    first: '0123456789',
    name: 'WARDLEY_NUMBER',
    pattern: { kind: 'Scan', _0: number },
  },
  word('ARROW', '->'),
  matcher('LINK_PORT', '+', linkPort),
  matcher('LINK_ARROW', '->+', linkArrow),
  matcher('LINK_LABEL', ';', linkLabel),
  matcher('STRATEGY', 'bom', strategy),
  word('KW_WARDLEY', 'wardley-beta'),
  word('KW_SIZE', 'size'),
  word('KW_EVOLUTION', 'evolution'),
  word('KW_ANCHOR', 'anchor'),
  word('KW_COMPONENT', 'component'),
  word('KW_LABEL', 'label'),
  word('KW_INERTIA', 'inertia'),
  word('KW_EVOLVE', 'evolve'),
  word('KW_PIPELINE', 'pipeline'),
  word('KW_NOTE', 'note'),
  word('KW_ANNOTATIONS', 'annotations'),
  word('KW_ANNOTATION', 'annotation'),
  word('KW_ACCELERATOR', 'accelerator'),
  word('KW_DEACCELERATOR', 'deaccelerator'),
  matcher('NAME_WITH_SPACES', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', nameWithSpaces),
  { ...matcher('WS', '\t ', ws), hidden: true },
  accDescr('ACC_DESCR'),
  ACC_TITLE,
  TITLE,
  matcher('INT', '0123456789', int),
  STRING,
  matcher('ID', '_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', id),
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
]

/** A label offset: `label [x, y]`. */
export type LabelAst = {
  /** Whether `x` is negated. */
  negX: boolean
  /** Whether `y` is negated. */
  negY: boolean
  /** The horizontal offset. */
  offsetX: number
  /** The vertical offset. */
  offsetY: number
}

/** A stage of `evolution`. */
export type StageAst = {
  /** The right edge after `@`. */
  boundary: number | undefined
  /** The name. */
  name: string
  /** The name after `/`. */
  secondName: string | undefined
}

/** A `component` statement. */
export type ComponentAst = {
  /** The source strategy in parentheses. */
  decorator: string | undefined
  /** The evolution coordinate. */
  evolution: number
  /** Whether `inertia` follows. */
  inertia: boolean
  /** The label offset. */
  label: LabelAst | undefined
  /** The name. */
  name: string
  /** The visibility coordinate. */
  visibility: number
}

/** A `component` inside a pipeline. */
export type PipelineComponentAst = {
  /** The evolution coordinate. */
  evolution: number
  /** The label offset. */
  label: LabelAst | undefined
  /** The name. */
  name: string
}

/** A link between two names. */
export type LinkAst = {
  /** The arrow text. */
  arrow: string | undefined
  /** The source name. */
  from: string
  /** The port after the source. */
  fromPort: string | undefined
  /** The `;` label, trimmed. */
  linkLabel: string | undefined
  /** The target name. */
  to: string
  /** The port after the target. */
  toPort: string | undefined
}

/** A named force with a position: an accelerator or deaccelerator. */
export type PlacedAst = {
  /** The name. */
  name: string
  /** The first coordinate. */
  x: number
  /** The second coordinate. */
  y: number
}

/** A numbered annotation. */
export type AnnotationAst = {
  /** The number. */
  number: number
  /** The text. */
  text: string
  /** The first coordinate. */
  x: number
  /** The second coordinate. */
  y: number
}

/** An anchor. */
export type AnchorAst = {
  /** The evolution coordinate. */
  evolution: number
  /** The name. */
  name: string
  /** The visibility coordinate. */
  visibility: number
}

/** A note. */
export type NoteAst = {
  /** The evolution coordinate. */
  evolution: number
  /** The text. */
  text: string
  /** The visibility coordinate. */
  visibility: number
}

/** A pipeline. */
export type PipelineAst = {
  /** The components. */
  components: PipelineComponentAst[]
  /** The parent component's name. */
  parent: string
}

/** An `evolve` statement. */
export type EvolveAst = {
  /** The component's name. */
  component: string
  /** The target evolution. */
  target: number
}

/** The syntax tree: Pele's `WardleyAst`. */
export type WardleyAst = {
  /** The `accDescr` text. */
  accDescr: string | undefined
  /** The `accTitle` text. */
  accTitle: string | undefined
  /** Accelerators. */
  accelerators: PlacedAst[]
  /** Anchors. */
  anchors: AnchorAst[]
  /** Numbered annotations. */
  annotation: AnnotationAst[]
  /** Annotation box positions, as `(x, y)`. */
  annotations: [number, number][]
  /** Components. */
  components: ComponentAst[]
  /** Deaccelerators. */
  deaccelerators: PlacedAst[]
  /** The evolution stages. */
  evolution: StageAst[] | undefined
  /** Evolve statements. */
  evolves: EvolveAst[]
  /** Links. */
  links: LinkAst[]
  /** Notes. */
  notes: NoteAst[]
  /** Pipelines. */
  pipelines: PipelineAst[]
  /** The size, as `(width, height)`. */
  size: [number, number] | undefined
  /** The `title` text. */
  title: string | undefined
}

/** `WardleyAst::default()`. */
export function wardleyAstDefault(): WardleyAst {
  return {
    accDescr: undefined,
    accTitle: undefined,
    accelerators: [],
    anchors: [],
    annotation: [],
    annotations: [],
    components: [],
    deaccelerators: [],
    evolution: undefined,
    evolves: [],
    links: [],
    notes: [],
    pipelines: [],
    size: undefined,
    title: undefined,
  }
}

/**
 * JavaScript's `Number` of a `WARDLEY_NUMBER` or `parseInt` of an `INT` token: both are plain
 * decimal digits.
 */
function decimal(text: string): number {
  return parse(text) ?? Number.NaN
}

/** Reads tokens of the grammar. */
type Parser = {
  r: Reader
}

function parserAt(p: Parser, kind: number): boolean {
  return readerKind(p.r) === kind
}

function parserName(p: Parser): string {
  if (parserAt(p, STRING_KIND)) return stringValue(readerTake(p.r))
  if (parserAt(p, ID) || parserAt(p, NAME)) return readerTake(p.r)
  throw readerFail(p.r, 'a name')
}

function parserNumber(p: Parser): number {
  return decimal(readerExpect(p.r, NUMBER))
}

function parserInt(p: Parser): number {
  return decimal(readerExpect(p.r, INT))
}

function parserCoordinate(p: Parser): number {
  if (parserAt(p, NUMBER)) return decimal(readerTake(p.r))
  return parserInt(p)
}

function parserEndOfLine(p: Parser): void {
  if (parserAt(p, EOF)) return
  if (!parserAt(p, NEWLINE_KIND)) throw readerFail(p.r, 'a line break or the end of input')
  while (parserAt(p, NEWLINE_KIND)) p.r.i += 1
}

function parserPair(p: Parser, read: (p: Parser) => number): [number, number] {
  readerExpect(p.r, LBRACKET)
  const first = read(p)
  readerExpect(p.r, COMMA)
  const second = read(p)
  readerExpect(p.r, RBRACKET)
  return [first, second]
}

function parserLabel(p: Parser): LabelAst {
  readerExpect(p.r, LABEL)
  readerExpect(p.r, LBRACKET)
  const negX = readerAccept(p.r, MINUS)
  const offsetX = parserInt(p)
  readerExpect(p.r, COMMA)
  const negY = readerAccept(p.r, MINUS)
  const offsetY = parserInt(p)
  readerExpect(p.r, RBRACKET)
  return { negX, negY, offsetX, offsetY }
}

function parserStage(p: Parser): StageAst {
  const name = parserName(p)
  const boundary = readerAccept(p.r, AT) ? parserNumber(p) : undefined
  const secondName = readerAccept(p.r, SLASH) ? parserName(p) : undefined
  return { boundary, name, secondName }
}

function parserLabelIfAny(p: Parser): LabelAst | undefined {
  if (parserAt(p, LABEL)) return parserLabel(p)
  return undefined
}

function parserComponent(p: Parser): ComponentAst {
  p.r.i += 1
  const name = parserName(p)
  const [visibility, evolution] = parserPair(p, parserNumber)
  const label = parserLabelIfAny(p)
  const next = p.r.tokens.tokens[p.r.i + 1]?.kind
  let decorator: string | undefined
  if (parserAt(p, LPAREN) && next === STRATEGY) {
    p.r.i += 1
    const taken = readerTake(p.r)
    readerExpect(p.r, RPAREN)
    decorator = taken
  }
  let inertia: boolean
  if (readerAccept(p.r, INERTIA)) {
    inertia = true
  } else if (readerAccept(p.r, LPAREN)) {
    readerExpect(p.r, INERTIA)
    readerExpect(p.r, RPAREN)
    inertia = true
  } else {
    inertia = false
  }
  parserEndOfLine(p)
  return { decorator, evolution, inertia, label, name, visibility }
}

function parserPipeline(p: Parser): PipelineAst {
  p.r.i += 1
  const parent = parserName(p)
  readerExpect(p.r, LBRACE)
  readerExpect(p.r, NEWLINE_KIND)
  while (parserAt(p, NEWLINE_KIND)) p.r.i += 1
  const components: PipelineComponentAst[] = []
  for (;;) {
    readerExpect(p.r, COMPONENT)
    const name = parserName(p)
    readerExpect(p.r, LBRACKET)
    const evolution = parserNumber(p)
    readerExpect(p.r, RBRACKET)
    const label = parserLabelIfAny(p)
    parserEndOfLine(p)
    components.push({ evolution, label, name })
    if (!parserAt(p, COMPONENT)) break
  }
  readerExpect(p.r, RBRACE)
  parserEndOfLine(p)
  return { components, parent }
}

function parserLink(p: Parser): LinkAst {
  if (!(parserAt(p, STRING_KIND) || parserAt(p, ID) || parserAt(p, NAME))) {
    throw readerFail(p.r, 'a statement')
  }
  const from = parserName(p)
  const fromPort = parserAt(p, LINK_PORT) ? readerTake(p.r) : undefined
  const arrow = parserAt(p, LINK_ARROW) || parserAt(p, ARROW) ? readerTake(p.r) : undefined
  const to = parserName(p)
  const toPort = parserAt(p, LINK_PORT) ? readerTake(p.r) : undefined
  const linkLabel = parserAt(p, LINK_LABEL) ? trim(readerTake(p.r).slice(1)) : undefined
  parserEndOfLine(p)
  return { arrow, from, fromPort, linkLabel, to, toPort }
}

function parserStatement(p: Parser, ast: WardleyAst): void {
  const kind = readerKind(p.r)
  switch (kind) {
    case NEWLINE_KIND:
      p.r.i += 1
      break
    case ACC_DESCR_KIND:
      ast.accDescr = accDescrValue(readerTake(p.r))
      parserEndOfLine(p)
      break
    case ACC_TITLE_KIND:
      ast.accTitle = accTitleValue(readerTake(p.r))
      parserEndOfLine(p)
      break
    case TITLE_KIND:
      ast.title = titleValue(readerTake(p.r))
      parserEndOfLine(p)
      break
    case SIZE: {
      p.r.i += 1
      const size = parserPair(p, parserInt)
      parserEndOfLine(p)
      ast.size = size
      break
    }
    case EVOLUTION: {
      p.r.i += 1
      const stages = [parserStage(p)]
      readerExpect(p.r, ARROW)
      stages.push(parserStage(p))
      while (readerAccept(p.r, ARROW)) stages.push(parserStage(p))
      parserEndOfLine(p)
      ast.evolution = stages
      break
    }
    case ANCHOR: {
      p.r.i += 1
      const name = parserName(p)
      const [visibility, evolution] = parserPair(p, parserNumber)
      parserEndOfLine(p)
      ast.anchors.push({ evolution, name, visibility })
      break
    }
    case COMPONENT:
      ast.components.push(parserComponent(p))
      break
    case EVOLVE: {
      p.r.i += 1
      const component = parserName(p)
      const target = parserNumber(p)
      parserEndOfLine(p)
      ast.evolves.push({ component, target })
      break
    }
    case PIPELINE:
      ast.pipelines.push(parserPipeline(p))
      break
    case NOTE: {
      p.r.i += 1
      const text = stringValue(readerExpect(p.r, STRING_KIND))
      const [visibility, evolution] = parserPair(p, parserNumber)
      parserEndOfLine(p)
      ast.notes.push({ evolution, text, visibility })
      break
    }
    case ANNOTATIONS: {
      p.r.i += 1
      const at = parserPair(p, parserCoordinate)
      parserEndOfLine(p)
      ast.annotations.push(at)
      break
    }
    case ANNOTATION: {
      p.r.i += 1
      const num = parserInt(p)
      readerExpect(p.r, COMMA)
      const [x, y] = parserPair(p, parserCoordinate)
      const text = stringValue(readerExpect(p.r, STRING_KIND))
      parserEndOfLine(p)
      ast.annotation.push({ number: num, text, x, y })
      break
    }
    case ACCELERATOR:
    case DEACCELERATOR: {
      p.r.i += 1
      const name = parserName(p)
      const [x, y] = parserPair(p, parserNumber)
      parserEndOfLine(p)
      const force: PlacedAst = { name, x, y }
      if (kind === DEACCELERATOR) ast.deaccelerators.push(force)
      else ast.accelerators.push(force)
      break
    }
    default:
      ast.links.push(parserLink(p))
  }
}

/**
 * Parses Wardley `src` into its syntax tree, as Pele's `parseWardley` does.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function parseWardley(src: string): WardleyAst {
  const tokens = tokenize(src, WARDLEY_TOKENS, 'wardley')
  const p: Parser = { r: readerNew(tokens, WARDLEY_TOKENS, 'wardley') }
  const ast = wardleyAstDefault()

  while (parserAt(p, NEWLINE_KIND)) p.r.i += 1
  readerExpect(p.r, WARDLEY)
  while (!parserAt(p, EOF)) parserStatement(p, ast)
  return ast
}
