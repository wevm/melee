/**
 * @module The info parser: Mermaid's Langium info grammar over the shared tokenizer. Port of
 * Pele's `src/diagrams/info/parser.ts`.
 */
import {
  ACC_DESCR,
  ACC_TITLE,
  accDescrValue,
  accTitleValue,
  DIRECTIVE,
  EOF,
  keyword,
  NEWLINE,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerTake,
  SINGLE_LINE_COMMENT,
  TITLE,
  titleValue,
  type TokenType,
  tokenize,
  WHITESPACE,
  YAML,
} from '../common/tokens.ts'

/** Token kinds, as indices into {@link INFO_TOKENS}. */
const t = {
  SHOW_INFO: 0,
  INFO: 1,
  ACC_DESCR: 2,
  ACC_TITLE: 3,
  TITLE: 4,
  NEWLINE: 5,
} as const

/** Pele's `INFO_TOKENS`, in matching order. */
export const INFO_TOKENS: TokenType[] = [
  keyword('showInfo'),
  keyword('info'),
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
]

/** The parsed info diagram: Pele's `InfoAst`. */
export type InfoAst = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** The `title` value. */
  title: string | undefined
}

/**
 * Parses info `src` as Pele's `parseInfo` does.
 *
 * Throws a syntax error where the source leaves the grammar.
 */
export function parseInfo(src: string): InfoAst {
  const r = readerNew(tokenize(src, INFO_TOKENS, 'info'), INFO_TOKENS, 'info')
  const ast: InfoAst = { accDescr: undefined, accTitle: undefined, title: undefined }

  while (readerAccept(r, t.NEWLINE)) {}
  readerExpect(r, t.INFO)
  while (readerAccept(r, t.NEWLINE)) {}
  if (readerAccept(r, t.SHOW_INFO)) {
    while (readerAccept(r, t.NEWLINE)) {}
  }
  while (readerKind(r) !== EOF) {
    switch (readerKind(r)) {
      case t.ACC_DESCR:
        ast.accDescr = accDescrValue(readerTake(r))
        break
      case t.ACC_TITLE:
        ast.accTitle = accTitleValue(readerTake(r))
        break
      case t.TITLE:
        ast.title = titleValue(readerTake(r))
        break
      default:
        throw readerFail(r, 'a title or the end of input')
    }
    if (readerKind(r) === EOF) break
    if (readerKind(r) !== t.NEWLINE) throw readerFail(r, 'a line break or the end of input')
    while (readerAccept(r, t.NEWLINE)) {}
  }
  return ast
}
