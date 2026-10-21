/**
 * @module `railroad-beta`: Mermaid's own notation, one constructor call per node. Port of Pele's
 * `src/diagrams/railroad/ir.ts`.
 */
import {
  DIRECTIVE,
  literal,
  type Reader,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  SINGLE_LINE_COMMENT,
  type TokenType,
  YAML,
} from '../common/tokens.ts'
import {
  ACC_DESCR,
  ACC_TITLE,
  blockComment,
  blockCommentOpener,
  choice,
  type Grammar,
  identifier,
  opening,
  optional,
  parseGrammar,
  push,
  quoted,
  repetition,
  sequence,
  TITLE,
  unescape,
  whitespace,
  word,
} from './common.ts'
import type { RailroadNode, RailroadRule } from './types.ts'

/** Token kinds, as indices into {@link IR_TOKENS}. */
const t = {
  NONTERMINAL: 1,
  ZERO_OR_MORE: 2,
  ONE_OR_MORE: 3,
  SEQUENCE: 4,
  OPTIONAL: 5,
  TERMINAL: 6,
  SPECIAL: 7,
  CHOICE: 8,
  EQUALS: 9,
  SEMICOLON: 10,
  OPEN: 11,
  COMMA: 12,
  CLOSE: 13,
  TITLE: 14,
  ID: 17,
  STRING: 18,
} as const

/** The identifier, as every keyword's longer alternative. */
const ID: number[] = [t.ID]

/** Pele's `IR_TOKENS`, in matching order. */
export const IR_TOKENS: TokenType[] = [
  opening('railroad-beta', ID),
  word('nonterminal', ID),
  word('zeroOrMore', ID),
  word('oneOrMore', ID),
  word('sequence', ID),
  word('optional', ID),
  word('terminal', ID),
  word('special', ID),
  word('choice', ID),
  literal('='),
  literal(';'),
  literal('('),
  literal(','),
  literal(')'),
  TITLE,
  ACC_TITLE,
  ACC_DESCR,
  identifier('RR_ID'),
  quoted('RR_STRING'),
  whitespace('RR_WHITESPACE'),
  { ...YAML, first: '-', name: 'RR_YAML' },
  { ...DIRECTIVE, first: '\t %', name: 'RR_DIRECTIVE' },
  { ...SINGLE_LINE_COMMENT, first: '\t %', name: 'RR_SINGLE_LINE_COMMENT' },
  {
    ...literal(''),
    first: '/',
    hidden: true,
    name: 'RR_BLOCK_COMMENT',
    opener: blockCommentOpener,
    pattern: { kind: 'Match', _0: blockComment },
  },
]

/** A constructor whose parts are still being read. */
type Open =
  /** `choice(...)`, with the alternatives read so far. */
  | { kind: 'Choice'; _0: number[] }
  /** `oneOrMore(...)`. */
  | { kind: 'OneOrMore' }
  /** `optional(...)`. */
  | { kind: 'Optional' }
  /** `sequence(...)`, with the elements read so far. */
  | { kind: 'Sequence'; _0: number[] }
  /** `zeroOrMore(...)`. */
  | { kind: 'ZeroOrMore' }

/** The string argument of a leaf constructor. */
function argument(r: Reader): string {
  r.i += 1
  readerExpect(r, t.OPEN)
  const value = unescape(readerExpect(r, t.STRING))
  readerExpect(r, t.CLOSE)
  return value
}

/**
 * Reads one expression into `nodes`. Constructors nest on an explicit stack, so depth is bounded
 * by memory, not by the call stack.
 */
function expression(r: Reader, nodes: RailroadNode[]): number {
  const open: Open[] = []
  for (;;) {
    let value: number
    const kind = readerKind(r)
    switch (kind) {
      case t.TERMINAL:
        value = push(nodes, { kind: 'Terminal', _0: argument(r) })
        break
      case t.NONTERMINAL:
        value = push(nodes, { kind: 'NonTerminal', _0: argument(r) })
        break
      case t.SPECIAL:
        value = push(nodes, { kind: 'Special', _0: argument(r) })
        break
      case t.SEQUENCE:
      case t.CHOICE:
      case t.OPTIONAL:
      case t.ONE_OR_MORE:
      case t.ZERO_OR_MORE:
        r.i += 1
        readerExpect(r, t.OPEN)
        open.push(
          kind === t.SEQUENCE
            ? { kind: 'Sequence', _0: [] }
            : kind === t.CHOICE
              ? { kind: 'Choice', _0: [] }
              : kind === t.OPTIONAL
                ? { kind: 'Optional' }
                : kind === t.ONE_OR_MORE
                  ? { kind: 'OneOrMore' }
                  : { kind: 'ZeroOrMore' },
        )
        continue
      default:
        throw readerFail(r, 'an expression')
    }
    for (;;) {
      const parent = open[open.length - 1]
      if (parent === undefined) return value
      if (parent.kind === 'Sequence' || parent.kind === 'Choice') {
        parent._0.push(value)
        if (readerAccept(r, t.COMMA)) break
      }
      readerExpect(r, t.CLOSE)
      const closed = open.pop()
      if (closed === undefined) return value
      switch (closed.kind) {
        case 'Sequence':
          value = sequence(nodes, closed._0)
          break
        case 'Choice':
          value = choice(nodes, closed._0)
          break
        case 'Optional':
          value = optional(nodes, value)
          break
        case 'OneOrMore':
          value = repetition(nodes, value, 1.0)
          break
        case 'ZeroOrMore':
          value = repetition(nodes, value, 0.0)
          break
      }
    }
  }
}

/**
 * Parses `railroad-beta` `src` as Pele's `parseIr` does, with each rule's definition built into
 * `nodes`.
 *
 * Throws a syntax error where the source leaves the grammar.
 */
export function parseIr(src: string, nodes: RailroadNode[]): Grammar<RailroadRule> {
  return parseGrammar(src, IR_TOKENS, t.TITLE, unescape, (r) => {
    const name = readerExpect(r, t.ID)
    readerExpect(r, t.EQUALS)
    const definition = expression(r, nodes)
    readerExpect(r, t.SEMICOLON)
    return { definition, name }
  })
}
