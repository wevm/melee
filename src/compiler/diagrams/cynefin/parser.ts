/**
 * @module The Cynefin parser: Mermaid's Langium Cynefin grammar over the shared tokenizer. Port of
 * Pele's `src/diagrams/cynefin/parser.ts`.
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
  keyword,
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

/** Token kinds, as indices into {@link CYNEFIN_TOKENS}. */
const t = {
  KEYWORD_COLON: 0,
  KEYWORD: 1,
  ARROW: 2,
  COLON: 3,
  DOMAIN: 4,
  ACC_DESCR: 5,
  ACC_TITLE: 6,
  TITLE: 7,
  STRING: 8,
  NEWLINE: 9,
} as const

/** The five domain names, in the order `DOMAIN_NAME` tries them. */
export const DOMAINS: readonly string[] = ['complex', 'complicated', 'clear', 'chaotic', 'confusion']

/** `complex|complicated|clear|chaotic|confusion`. */
function domain(src: string, p: number): number | undefined {
  if (p > src.length) return undefined
  const name = DOMAINS.find((name) => src.startsWith(name, p))
  return name === undefined ? undefined : p + name.length
}

/** The domain name `text` as a static string. */
function domainName(text: string): string {
  return DOMAINS.find((name) => name === text) ?? 'confusion'
}

/** Pele's `CYNEFIN_TOKENS`, in matching order. */
export const CYNEFIN_TOKENS: TokenType[] = [
  literal('cynefin-beta:'),
  keyword('cynefin-beta'),
  literal('-->'),
  literal(':'),
  {
    ...literal(''),
    first: 'c',
    name: 'DOMAIN_NAME',
    pattern: { kind: 'Match', _0: domain },
  },
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  STRING,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
]

/** A domain block as written: Pele's `DomainBlockAst`. */
export type DomainBlockAst = {
  /** The domain. */
  domain: string
  /** The item labels. */
  items: string[]
}

/** A transition as written: Pele's `TransitionAst`. */
export type TransitionAst = {
  /** The domain it leaves. */
  from: string
  /** The label, when one is given. */
  label: string | undefined
  /** The domain it enters. */
  to: string
}

/** The parsed Cynefin diagram: Pele's `CynefinAst`. */
export type CynefinAst = {
  /** The `accDescr` value. */
  accDescr: string | undefined
  /** The `accTitle` value. */
  accTitle: string | undefined
  /** Domain blocks in authored order. */
  domains: DomainBlockAst[]
  /** The `title` value. */
  title: string | undefined
  /** Transitions in authored order. */
  transitions: TransitionAst[]
}

/** `CynefinAst::default()`. */
export function cynefinAstDefault(): CynefinAst {
  return { accDescr: undefined, accTitle: undefined, domains: [], title: undefined, transitions: [] }
}

/** Skips line breaks after a statement, which must end its line. */
function endOfLine(r: Reader): void {
  if (readerKind(r) === EOF) return
  if (readerKind(r) !== t.NEWLINE) throw readerFail(r, 'a line break or the end of input')
  while (readerAccept(r, t.NEWLINE)) {}
}

/**
 * Parses Cynefin `src` as Pele's `parseCynefin` does.
 *
 * @throws {CompileError} A syntax error where the source leaves the grammar.
 */
export function parseCynefin(src: string): CynefinAst {
  const r = readerNew(tokenize(src, CYNEFIN_TOKENS, 'cynefin'), CYNEFIN_TOKENS, 'cynefin')
  const ast = cynefinAstDefault()

  while (readerAccept(r, t.NEWLINE)) {}
  if (readerKind(r) !== t.KEYWORD && readerKind(r) !== t.KEYWORD_COLON) throw readerFail(r, "'cynefin-beta'")
  r.i += 1
  while (readerKind(r) !== EOF) {
    switch (readerKind(r)) {
      case t.NEWLINE:
        r.i += 1
        break
      case t.ACC_DESCR:
        ast.accDescr = accDescrValue(readerTake(r))
        endOfLine(r)
        break
      case t.ACC_TITLE:
        ast.accTitle = accTitleValue(readerTake(r))
        endOfLine(r)
        break
      case t.TITLE:
        ast.title = titleValue(readerTake(r))
        endOfLine(r)
        break
      case t.DOMAIN: {
        const name = domainName(readerTake(r))
        if (readerAccept(r, t.ARROW)) {
          const to = domainName(readerExpect(r, t.DOMAIN))
          const label = readerAccept(r, t.COLON) ? stringValue(readerExpect(r, t.STRING)) : undefined
          endOfLine(r)
          ast.transitions.push({ from: name, label, to })
          continue
        }
        const block: DomainBlockAst = { domain: name, items: [] }
        while (readerAccept(r, t.NEWLINE)) {}
        while (readerKind(r) === t.STRING) {
          block.items.push(stringValue(readerTake(r)))
          while (readerAccept(r, t.NEWLINE)) {}
        }
        ast.domains.push(block)
        break
      }
      default:
        throw readerFail(r, 'a domain, a transition, a title, or a line break')
    }
  }
  return ast
}
