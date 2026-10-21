/**
 * @module The event modeling parser: Mermaid's Langium event modeling grammar over the shared
 * tokenizer. Port of Pele's `src/diagrams/eventmodeling/parser.ts`.
 */
import { accDescr } from '../common/acc_descr.ts'
import {
  ACC_TITLE,
  DIRECTIVE,
  EOF,
  type Matcher,
  type Reader,
  SINGLE_LINE_COMMENT,
  TITLE,
  type TokenType,
  YAML,
  keyword,
  literal,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerStart,
  readerTake,
  tokenize,
} from '../common/tokens.ts'
import { isLineEnd, isSpace } from '../../util/chars.ts'

/** Token kinds, as indices into {@link EVENTMODELING_TOKENS}. */
const t = {
  KEYWORD: 0,
  RESETFRAME: 1,
  READMODEL: 2,
  PROCESSOR: 3,
  TIMEFRAME: 4,
  COMMAND: 5,
  ENTITY: 6,
  EVENT: 7,
  JSOBJ: 8,
  FIGMA: 9,
  GIVEN: 10,
  JSON: 11,
  SALT: 12,
  HTML: 13,
  TEXT: 14,
  DATA: 15,
  NOTE: 16,
  WHEN: 17,
  THEN: 18,
  RMO: 19,
  CMD: 20,
  EVT: 21,
  PCR: 22,
  URI: 23,
  ARROW: 24,
  GWT: 25,
  UI: 26,
  MD: 27,
  TF: 28,
  OPEN: 29,
  CLOSE: 30,
  RF: 31,
  TICK: 32,
  DOT: 33,
  ID: 34,
  FRAME_ID: 35,
  INLINE: 36,
  BLOCK: 37,
  ACC_DESCR: 38,
  ACC_TITLE: 39,
  TITLE: 40,
} as const

/** An ASCII letter. */
function isAsciiAlpha(b: number): boolean {
  return (b >= 65 && b <= 90) || (b >= 97 && b <= 122)
}

/** An ASCII digit. */
function isAsciiDigit(b: number): boolean {
  return b >= 48 && b <= 57
}

/** ASCII word characters (`[\w_]`): 1 for letters and `_`, 2 for digits. */
const WORD: Uint8Array = (() => {
  const table = new Uint8Array(128)
  for (let c = 0; c < 128; c++) {
    if (isAsciiAlpha(c) || c === 0x5f) table[c] = 1
    else if (isAsciiDigit(c)) table[c] = 2
  }
  return table
})()

/** `[_a-zA-Z][\w_]*`. */
function emId(src: string, at: number): number | undefined {
  const n = src.length
  if (at >= n) return undefined
  const first = src.charCodeAt(at)
  if (first >= 128 || WORD[first] !== 1) return undefined
  let i = at + 1
  while (i < n) {
    const b = src.charCodeAt(i)
    if (b >= 128 || WORD[b] === 0) break
    i += 1
  }
  return i
}

/** `\d{1,3}`. */
function emFid(src: string, at: number): number | undefined {
  let i = at
  while (i < at + 3 && i < src.length && isAsciiDigit(src.charCodeAt(i))) i += 1
  return i > at ? i : undefined
}

/** Where the line from `at` ends: at the first line terminator, which `.` does not match. */
function dotRun(src: string, at: number): number {
  for (let i = at; i < src.length; i++) if (isLineEnd(src.charCodeAt(i))) return i
  return src.length
}

/** `\{(.*)\}|"(.*)"|'(.*)'`: an opener and the last matching closer on its line. */
function emDataInline(src: string, at: number): number | undefined {
  if (at >= src.length) return undefined
  const open = src.charCodeAt(at)
  let close: string
  if (open === 0x7b) close = '}'
  else if (open === 0x22) close = '"'
  else if (open === 0x27) close = "'"
  else return undefined
  const end = dotRun(src, at + 1)
  const found = src.slice(at + 1, end).lastIndexOf(close)
  if (found < 0) return undefined
  return at + 1 + found + 1
}

/** `\r?\n` at `at`. */
function newline(src: string, at: number): number | undefined {
  const p = src.charCodeAt(at) === 0x0d ? at + 1 : at
  return src.charCodeAt(p) === 0x0a ? p + 1 : undefined
}

/** `\}(?:\r?\n|(?!\S))` at `at`. */
function blockClose(src: string, at: number): number | undefined {
  if (src.charCodeAt(at) !== 0x7d) return undefined
  const end = newline(src, at + 1)
  if (end !== undefined) return end
  if (at + 1 >= src.length) return at + 1
  return isSpace(src.charCodeAt(at + 1)) ? at + 1 : undefined
}

/** `\{[\t ]*\r?\n(?:[\S\s]*?\r?\n)?\}(?:\r?\n|(?!\S))`. */
function emDataBlock(src: string, at: number): number | undefined {
  if (src.charCodeAt(at) !== 0x7b) return undefined
  let head = at + 1
  while (head < src.length && (src.charCodeAt(head) === 0x20 || src.charCodeAt(head) === 0x09)) head += 1
  const afterHead = newline(src, head)
  if (afterHead === undefined) return undefined

  // The optional group comes first, and its lazy body ends at the earliest line break that a
  // closing brace follows.
  let from = afterHead
  for (;;) {
    const found = src.indexOf('\n', from)
    if (found < 0) break
    const after = found + 1
    const end = blockClose(src, after)
    if (end !== undefined) return end
    from = after
  }
  return blockClose(src, afterHead)
}

/** `\s+`. */
function emWs(src: string, at: number): number | undefined {
  let i = at
  while (i < src.length && isSpace(src.charCodeAt(i))) i++
  return i > at ? i : undefined
}

/** `\/\*[\s\S]*?\*\/`. */
function emMlComment(src: string, at: number): number | undefined {
  if (!src.startsWith('/*', at)) return undefined
  const close = src.indexOf('*/', at + 2)
  if (close < 0) return undefined
  return close + 2
}

/** `\/\/[^\n\r]*`. */
function emSlComment(src: string, at: number): number | undefined {
  if (!src.startsWith('//', at)) return undefined
  for (let i = at + 2; i < src.length; i++) {
    const c = src.charCodeAt(i)
    if (c === 0x0a || c === 0x0d) return i
  }
  return src.length
}

/** The ASCII characters an identifier starts with. */
const ID_FIRST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'

/** A token type with a hand-written matcher. */
function matched(name: string, first: string, matcher: Matcher): TokenType {
  return {
    ...literal(''),
    first,
    name,
    pattern: { kind: 'Match', _0: matcher },
  }
}

/** A keyword that is also an identifier. Langium gives each the identifier as a longer alternative. */
function word(text: string): TokenType {
  return {
    ...literal(text),
    longer: [t.ID],
  }
}

/** Pele's `EVENTMODELING_TOKENS`, in matching order. */
export const EVENTMODELING_TOKENS: TokenType[] = [
  {
    ...keyword('eventmodeling'),
    longer: [t.ID],
  },
  word('resetframe'),
  word('readmodel'),
  word('processor'),
  word('timeframe'),
  word('command'),
  word('entity'),
  word('event'),
  word('jsobj'),
  word('figma'),
  word('given'),
  word('json'),
  word('salt'),
  word('html'),
  word('text'),
  word('data'),
  word('note'),
  word('when'),
  word('then'),
  word('rmo'),
  word('cmd'),
  word('evt'),
  word('pcr'),
  word('uri'),
  literal('->>'),
  word('gwt'),
  word('ui'),
  word('md'),
  word('tf'),
  literal('[['),
  literal(']]'),
  word('rf'),
  literal('`'),
  literal('.'),
  matched('EM_ID', ID_FIRST, emId),
  matched('EM_FID', '0123456789', emFid),
  matched('EM_DATA_INLINE', '{"\'', emDataInline),
  matched('EM_DATA_BLOCK', '{', emDataBlock),
  accDescr('EM_ACC_DESCR'),
  {
    ...ACC_TITLE,
    name: 'EM_ACC_TITLE',
  },
  {
    ...TITLE,
    name: 'EM_TITLE',
  },
  {
    ...matched('EM_WS', '\t\n\u000b\u000c\r ', emWs),
    hidden: true,
  },
  {
    ...YAML,
    name: 'EM_YAML',
  },
  {
    ...DIRECTIVE,
    name: 'EM_DIRECTIVE',
  },
  {
    ...SINGLE_LINE_COMMENT,
    name: 'EM_SINGLE_LINE_COMMENT',
  },
  {
    ...matched('EM_ML_COMMENT', '/', emMlComment),
    hidden: true,
  },
  {
    ...matched('EM_SL_COMMENT', '/', emSlComment),
    hidden: true,
  },
]

/** `tf` or `timeframe`. */
function isTimeFrame(kind: number): boolean {
  return kind === t.TF || kind === t.TIMEFRAME
}

/** `rf` or `resetframe`. */
function isResetFrame(kind: number): boolean {
  return kind === t.RF || kind === t.RESETFRAME
}

/** A model entity type keyword. */
function isEntityType(kind: number): boolean {
  switch (kind) {
    case t.RMO:
    case t.READMODEL:
    case t.UI:
    case t.CMD:
    case t.COMMAND:
    case t.EVT:
    case t.EVENT:
    case t.PCR:
    case t.PROCESSOR:
      return true
    default:
      return false
  }
}

/** A data type keyword. */
function isDataType(kind: number): boolean {
  switch (kind) {
    case t.JSON:
    case t.JSOBJ:
    case t.FIGMA:
    case t.SALT:
    case t.URI:
    case t.MD:
    case t.HTML:
    case t.TEXT:
      return true
    default:
      return false
  }
}

/** A time frame or a reset frame: Pele's `EmFrame`. */
export type EmFrame = {
  /** The data block the frame refers to. */
  dataReference: string | undefined
  /** The data type of the inline data. */
  dataType: string | undefined
  /** The inline data token, as written. */
  dataInlineValue: string | undefined
  /** The entity's qualified name. */
  entityIdentifier: string
  /** The entity type keyword. */
  modelEntityType: string
  /** The frame number as written. */
  name: string
  /** The UTF-16 offset of the frame in the source, for error messages. */
  offset: number
  /** Whether the frame is a reset frame. */
  reset: boolean
  /** The frames that feed this one. */
  sourceFrames: string[]
}

/** A data block: Pele's `EmDataEntity`. */
export type EmDataEntity = {
  /** The block token, as written. */
  dataBlockValue: string
  /** The block's name. */
  name: string
}

/** A note: Pele's `EmNoteEntity`. */
export type EmNoteEntity = {
  /** The block token, as written. */
  dataBlockValue: string
  /** The data type. */
  dataType: string | undefined
  /** The frame the note belongs to. */
  sourceFrame: string
}

/** A given/when/then specification: Pele's `EmGwt`. */
export type EmGwt = {
  /** The `given` entities. */
  given: string[]
  /** The frame the specification belongs to. */
  sourceFrame: string
  /** The `then` entities. */
  then: string[]
  /** The `when` entities. */
  when: string[]
}

/** The parsed event model: Pele's `EventModelAst`. */
export type EventModelAst = {
  /** The `accDescr` token, as written. */
  accDescr: string | undefined
  /** The `accTitle` token, as written. */
  accTitle: string | undefined
  /** Data blocks in authored order. */
  dataEntities: EmDataEntity[]
  /** Frames in authored order. */
  frames: EmFrame[]
  /** Specifications in authored order. */
  gwtEntities: EmGwt[]
  /** Model entity names in authored order. */
  modelEntities: string[]
  /** Notes in authored order. */
  noteEntities: EmNoteEntity[]
  /** The `title` token, as written. The grammar's own terminals get no value conversion. */
  title: string | undefined
}

/** `EventModelAst::default()`. */
export function eventModelAstDefault(): EventModelAst {
  return {
    accDescr: undefined,
    accTitle: undefined,
    dataEntities: [],
    frames: [],
    gwtEntities: [],
    modelEntities: [],
    noteEntities: [],
    title: undefined,
  }
}

/** The current token when its kind is in `set`, moving past it. */
function one(r: Reader, set: (kind: number) => boolean, expected: string): string {
  if (set(readerKind(r))) return readerTake(r)
  throw readerFail(r, expected)
}

/** A dotted name. */
function qualifiedName(r: Reader): string {
  let name = readerExpect(r, t.ID)
  while (readerAccept(r, t.DOT)) {
    name += '.'
    name += readerExpect(r, t.ID)
  }
  return name
}

/** A data type between backticks, when one is written. */
function dataType(r: Reader): string | undefined {
  if (!readerAccept(r, t.TICK)) return undefined
  const kind = one(r, isDataType, 'a data type')
  readerExpect(r, t.TICK)
  return kind
}

/** One or more statements of an entity type and a name. */
function statements(r: Reader): string[] {
  const out: string[] = []
  for (;;) {
    one(r, isEntityType, 'an entity type')
    out.push(readerExpect(r, t.ID))
    if (!isEntityType(readerKind(r))) return out
  }
}

/**
 * Parses event modeling `src` as Pele's `parseEventModel` does.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function parseEventModel(src: string): EventModelAst {
  const r = readerNew(
    tokenize(src, EVENTMODELING_TOKENS, 'eventmodeling'),
    EVENTMODELING_TOKENS,
    'eventmodeling',
  )
  const ast = eventModelAstDefault()

  readerExpect(r, t.KEYWORD)
  while (readerKind(r) !== EOF) {
    const kind = readerKind(r)
    if (kind === t.ACC_DESCR) {
      ast.accDescr = readerTake(r)
    } else if (kind === t.ACC_TITLE) {
      ast.accTitle = readerTake(r)
    } else if (kind === t.TITLE) {
      ast.title = readerTake(r)
    } else if (kind === t.ENTITY) {
      r.i += 1
      ast.modelEntities.push(qualifiedName(r))
    } else if (isTimeFrame(kind) || isResetFrame(kind)) {
      const offset = readerStart(r)
      r.i += 1
      const name = readerExpect(r, t.FRAME_ID)
      const modelEntityType = one(r, isEntityType, 'an entity type')
      const entityIdentifier = qualifiedName(r)
      const sourceFrames: string[] = []
      while (readerAccept(r, t.ARROW)) sourceFrames.push(readerExpect(r, t.FRAME_ID))
      let dataReference: string | undefined
      if (readerAccept(r, t.OPEN)) {
        dataReference = readerExpect(r, t.ID)
        readerExpect(r, t.CLOSE)
      }
      let frameDataType: string | undefined
      let dataInlineValue: string | undefined
      if (readerKind(r) === t.TICK || readerKind(r) === t.INLINE) {
        frameDataType = dataType(r)
        dataInlineValue = readerExpect(r, t.INLINE)
      }
      ast.frames.push({
        dataReference,
        dataType: frameDataType,
        dataInlineValue,
        entityIdentifier,
        modelEntityType,
        name,
        offset,
        reset: isResetFrame(kind),
        sourceFrames,
      })
    } else if (kind === t.DATA) {
      r.i += 1
      const name = readerExpect(r, t.ID)
      dataType(r)
      const dataBlockValue = readerExpect(r, t.BLOCK)
      ast.dataEntities.push({ dataBlockValue, name })
    } else if (kind === t.NOTE) {
      r.i += 1
      const sourceFrame = readerExpect(r, t.FRAME_ID)
      const noteDataType = dataType(r)
      const dataBlockValue = readerExpect(r, t.BLOCK)
      ast.noteEntities.push({ dataBlockValue, dataType: noteDataType, sourceFrame })
    } else if (kind === t.GWT) {
      r.i += 1
      const sourceFrame = readerExpect(r, t.FRAME_ID)
      readerExpect(r, t.GIVEN)
      const given = statements(r)
      const when = readerAccept(r, t.WHEN) ? statements(r) : []
      readerExpect(r, t.THEN)
      const then = statements(r)
      ast.gwtEntities.push({ given, sourceFrame, then, when })
    } else {
      throw readerFail(r, 'a frame, an entity, a data block, a note, or a specification')
    }
  }
  return ast
}
