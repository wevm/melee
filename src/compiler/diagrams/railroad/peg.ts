/**
 * @module `railroad-peg-beta`: parsing expression grammars. Port of Pele's
 * `src/diagrams/railroad/peg.ts`.
 */
import {
  DIRECTIVE,
  literal,
  type Reader,
  readerExpect,
  readerFail,
  readerKind,
  readerTake,
  SINGLE_LINE_COMMENT,
  type TokenType,
  YAML,
} from '../common/tokens.ts'
import {
  ACC_DESCR,
  ACC_TITLE,
  add,
  type AstNode,
  attach,
  choice,
  first,
  type Grammar,
  identifier,
  NONE,
  opening,
  optional,
  parseGrammar,
  push,
  quoted,
  repetition,
  sequence,
  TITLE,
  toRules,
  unescape,
  whitespace,
} from './common.ts'
import type { RailroadNode, RailroadRule } from './types.ts'

/** Token kinds, as indices into {@link PEG_TOKENS}. */
const t = {
  ARROW: 1,
  SEMICOLON: 2,
  SLASH: 3,
  AND: 4,
  NOT: 5,
  QUESTION: 6,
  STAR: 7,
  PLUS: 8,
  GROUP: 9,
  GROUP_END: 10,
  DOT: 11,
  TITLE: 12,
  ID: 15,
  STRING: 16,
} as const

/** `#[^\n\r]*`. */
function lineComment(src: string, at: number): number | undefined {
  if (src.charCodeAt(at) !== 0x23) return undefined
  let i = at + 1
  while (i < src.length) {
    const c = src.charCodeAt(i)
    if (c === 0x0a || c === 0x0d) break
    i += 1
  }
  return i
}

/** Pele's `PEG_TOKENS`, in matching order. */
export const PEG_TOKENS: TokenType[] = [
  opening('railroad-peg-beta', [t.ID]),
  literal('<-'),
  literal(';'),
  literal('/'),
  literal('&'),
  literal('!'),
  literal('?'),
  literal('*'),
  literal('+'),
  literal('('),
  literal(')'),
  literal('.'),
  TITLE,
  ACC_TITLE,
  ACC_DESCR,
  identifier('PEG_ID'),
  quoted('PEG_STRING'),
  whitespace('PEG_WHITESPACE'),
  { ...YAML, first: '-', name: 'PEG_YAML' },
  { ...DIRECTIVE, first: '\t %', name: 'PEG_DIRECTIVE' },
  { ...SINGLE_LINE_COMMENT, first: '\t %', name: 'PEG_SINGLE_LINE_COMMENT' },
  {
    ...literal(''),
    first: '#',
    hidden: true,
    name: 'PEG_LINE_COMMENT',
    pattern: { kind: 'Match', _0: lineComment },
  },
]

/**
 * A node of the PEG syntax tree. Its parts are a choice's sequences, a sequence's prefixes, a
 * prefix's suffix, a suffix's primary, or a group's choice.
 */
export type Peg =
  /** `.`, as written. */
  | { kind: 'Any'; _0: string }
  /** `( ... )`. */
  | { kind: 'Group' }
  /** A name. */
  | { kind: 'Identifier'; _0: string }
  /** A string. */
  | { kind: 'Literal'; _0: string }
  /** Ordered alternatives. */
  | { kind: 'OrderedChoice' }
  /** A suffix with the predicate written before it. */
  | { kind: 'Prefix'; _0: string | undefined }
  /** Prefixes one after another. */
  | { kind: 'Sequence' }
  /** A primary with the operator written after it. */
  | { kind: 'Suffix'; _0: string | undefined }

/** One open group, or the rule itself at the bottom of the stack. */
type Frame = {
  /** The group's choice. */
  choice: number
  /** The group's node. */
  node: number | undefined
  /** The predicate written before the group. */
  operator: string | undefined
  /** The sequence being read. */
  sequence: number
}

/** A frame for the choice `choice`, with its first sequence. */
function frame(ast: AstNode<Peg>[], node: number | undefined, choice: number, operator: string | undefined): Frame {
  const sequence = add<Peg>(ast, { kind: 'Sequence' })
  attach(ast, choice, sequence)
  return { choice, node, operator, sequence }
}

/** Reads a rule's definition into `ast`, returning its choice. */
function definition(r: Reader, ast: AstNode<Peg>[]): number {
  const stack: Frame[] = []
  const root = add<Peg>(ast, { kind: 'OrderedChoice' })
  let top = frame(ast, undefined, root, undefined)
  for (;;) {
    let operator = readerKind(r) === t.AND || readerKind(r) === t.NOT ? readerTake(r) : undefined
    let primary: number
    switch (readerKind(r)) {
      case t.STRING:
        primary = add<Peg>(ast, { kind: 'Literal', _0: unescape(readerTake(r)) })
        break
      case t.ID:
        primary = add<Peg>(ast, { kind: 'Identifier', _0: readerTake(r) })
        break
      case t.DOT:
        primary = add<Peg>(ast, { kind: 'Any', _0: readerTake(r) })
        break
      case t.GROUP: {
        r.i += 1
        const element = add<Peg>(ast, { kind: 'OrderedChoice' })
        const group = add<Peg>(ast, { kind: 'Group' })
        attach(ast, group, element)
        const next = frame(ast, group, element, operator)
        stack.push(top)
        top = next
        continue
      }
      default:
        throw readerFail(r, 'a literal, a name, a dot, or an opening parenthesis')
    }
    for (;;) {
      const k0 = readerKind(r)
      const suffixOperator = k0 === t.QUESTION || k0 === t.STAR || k0 === t.PLUS ? readerTake(r) : undefined
      const suffix = add<Peg>(ast, { kind: 'Suffix', _0: suffixOperator })
      attach(ast, suffix, primary)
      const prefix = add<Peg>(ast, { kind: 'Prefix', _0: operator })
      operator = undefined
      attach(ast, prefix, suffix)
      attach(ast, top.sequence, prefix)
      const k = readerKind(r)
      if (k === t.GROUP_END && stack.length > 0) {
        r.i += 1
        primary = top.node ?? NONE
        operator = top.operator
        top.operator = undefined
        const outer = stack.pop()
        if (outer === undefined) throw readerFail(r, 'an expression')
        top = outer
        continue
      }
      switch (k) {
        case t.SLASH: {
          r.i += 1
          const sequence = add<Peg>(ast, { kind: 'Sequence' })
          attach(ast, top.choice, sequence)
          top.sequence = sequence
          break
        }
        case t.AND:
        case t.NOT:
        case t.STRING:
        case t.ID:
        case t.DOT:
        case t.GROUP:
          break
        default:
          if (stack.length === 0) return top.choice
          throw readerFail(r, "token of type ')'")
      }
      break
    }
  }
}

/**
 * Parses `railroad-peg-beta` `src` as Pele's `parsePeg` does, returning the statements and each
 * rule's name and definition in `ast`.
 *
 * Throws a syntax error where the source leaves the grammar.
 */
export function parsePeg(src: string, ast: AstNode<Peg>[]): Grammar<[string, number]> {
  return parseGrammar(src, PEG_TOKENS, t.TITLE, unescape, (r): [string, number] => {
    const name = readerExpect(r, t.ID)
    readerExpect(r, t.ARROW)
    const body = definition(r, ast)
    readerExpect(r, t.SEMICOLON)
    return [name, body]
  })
}

/** What a predicate shows of the expression it looks ahead for. */
function label(node: RailroadNode | undefined): string {
  if (node === undefined) return '(...)'
  switch (node.kind) {
    case 'Terminal':
      return `"${node._0}"`
    case 'NonTerminal':
    case 'Special':
      return node._0
    default:
      return '(...)'
  }
}

/** The node a part of the syntax tree builds from its parts' nodes. */
function node(part: Peg, kids: number[], nodes: RailroadNode[]): number {
  const kid = first(kids)
  switch (part.kind) {
    case 'OrderedChoice':
      return choice(nodes, kids)
    case 'Sequence':
      return sequence(nodes, kids)
    case 'Prefix': {
      const operator = part._0
      if (operator === undefined || operator === '') return kid
      return push(nodes, { kind: 'Special', _0: operator + label(nodes[kid]) })
    }
    case 'Suffix': {
      const operator = part._0
      if (operator === undefined || operator === '') return kid
      if (operator === '?') return optional(nodes, kid)
      return repetition(nodes, kid, operator === '+' ? 1.0 : 0.0)
    }
    case 'Literal':
      return push(nodes, { kind: 'Terminal', _0: part._0 })
    case 'Identifier':
      return push(nodes, { kind: 'NonTerminal', _0: part._0 })
    case 'Any':
      return push(nodes, { kind: 'Special', _0: part._0 })
    case 'Group':
      return kid
  }
}

/** The rules of a PEG grammar: Pele's `pegRules`. */
export function pegRules(ast: AstNode<Peg>[], rules: [string, number][], nodes: RailroadNode[]): RailroadRule[] {
  return toRules(ast, rules, nodes, node)
}
