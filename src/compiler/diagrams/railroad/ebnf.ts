/**
 * @module `railroad-ebnf-beta`: EBNF in the W3C and ISO 14977 styles. Port of Pele's
 * `src/diagrams/railroad/ebnf.ts`.
 */
import {
  DIRECTIVE,
  EOF,
  literal,
  type Reader,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerTake,
  SINGLE_LINE_COMMENT,
  type TokenType,
  YAML,
} from '../common/tokens.ts'
import { trim } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import {
  ACC_DESCR,
  ACC_TITLE,
  add,
  type AstNode,
  attach,
  blockComment,
  blockCommentOpener,
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
  word,
} from './common.ts'
import type { RailroadNode, RailroadRule } from './types.ts'

/** Token kinds, as indices into {@link EBNF_TOKENS}. */
const t = {
  DEFINES: 1,
  EQUALS: 2,
  SEMICOLON: 3,
  BAR: 4,
  COMMA: 5,
  GROUP: 6,
  OPTION: 8,
  REPEAT: 10,
  QUESTION: 12,
  STAR: 13,
  PLUS: 14,
  MINUS: 15,
  TITLE: 16,
  ID: 19,
  STRING: 20,
  SPECIAL: 21,
  YAML: 23,
  ISO_COMMENT: 27,
} as const

/**
 * A question mark, text with something other than blanks in it and no `?` or `;`, and a
 * question mark. Mermaid's pattern looks ahead with two nested runs, which rescans; this reads
 * the text once.
 */
function specialSequence(src: string, at: number): number | undefined {
  if (src.charCodeAt(at) !== 0x3f) return undefined
  let solid = false
  // Every character `\s` matches is in the Basic Multilingual Plane, and `?` and `;` are ASCII,
  // so stepping by units is stepping by characters.
  for (let i = at + 1; i < src.length; i++) {
    const c = src.charCodeAt(i)
    if (c === 0x3f) return solid ? i + 1 : undefined
    if (c === 0x3b) return undefined
    solid ||= !isSpace(c)
  }
  return undefined
}

/** `\(\*`. */
function isoOpener(src: string, at: number): boolean {
  return at <= src.length && src.startsWith('(*', at)
}

/** `\(\*[\s\S]*?\*\)`. */
function isoComment(src: string, at: number): number | undefined {
  if (!isoOpener(src, at)) return undefined
  const close = src.indexOf('*)', at + 2)
  if (close < 0) return undefined
  return close + 2
}

/** Pele's `EBNF_TOKENS`, in matching order. */
export const EBNF_TOKENS: TokenType[] = [
  opening('railroad-ebnf-beta', [t.ID]),
  literal('::='),
  literal('='),
  literal(';'),
  literal('|'),
  literal(','),
  word('(', [t.ISO_COMMENT]),
  literal(')'),
  literal('['),
  literal(']'),
  literal('{'),
  literal('}'),
  word('?', [t.SPECIAL]),
  literal('*'),
  literal('+'),
  word('-', [t.YAML]),
  TITLE,
  ACC_TITLE,
  ACC_DESCR,
  identifier('EBNF_ID'),
  quoted('EBNF_STRING'),
  {
    ...literal(''),
    first: '?',
    name: 'EBNF_SPECIAL_SEQUENCE',
    pattern: { kind: 'Match', _0: specialSequence },
  },
  whitespace('EBNF_WHITESPACE'),
  { ...YAML, first: '-', name: 'EBNF_YAML' },
  { ...DIRECTIVE, first: '\t %', name: 'EBNF_DIRECTIVE' },
  { ...SINGLE_LINE_COMMENT, first: '\t %', name: 'EBNF_SINGLE_LINE_COMMENT' },
  {
    ...literal(''),
    first: '/',
    hidden: true,
    name: 'EBNF_BLOCK_COMMENT',
    opener: blockCommentOpener,
    pattern: { kind: 'Match', _0: blockComment },
  },
  {
    ...literal(''),
    first: '(',
    hidden: true,
    name: 'EBNF_ISO_COMMENT',
    opener: isoOpener,
    pattern: { kind: 'Match', _0: isoComment },
  },
]

/** A postfix operator of a term. */
export const Postfix = {
  /** `- x`, whose right side is the term's next part. */
  Exception: 'Exception',
  /** `+`. */
  OneOrMore: 'OneOrMore',
  /** `?`. */
  Optional: 'Optional',
  /** `*`. */
  ZeroOrMore: 'ZeroOrMore',
} as const
export type Postfix = (typeof Postfix)[keyof typeof Postfix]

/**
 * A node of the EBNF syntax tree. Its parts are a choice's sequences, a sequence's terms, a
 * term's base and the right side of each exception, or a bracket's choice.
 */
export type Ebnf =
  /** Alternatives. */
  | { kind: 'Choice' }
  /** `( ... )`. */
  | { kind: 'Group' }
  /** A name. */
  | { kind: 'NonTerminal'; _0: string }
  /** `[ ... ]`. */
  | { kind: 'Optional' }
  /** `{ ... }`. */
  | { kind: 'Repetition' }
  /** Terms one after another. */
  | { kind: 'Sequence' }
  /** `? ... ?`. */
  | { kind: 'Special'; _0: string }
  /** A base and its postfix operators. */
  | { kind: 'Term'; _0: Postfix[] }
  /** A string. */
  | { kind: 'Terminal'; _0: string }

/** One open bracket, or the rule itself at the bottom of the stack. */
type Frame = {
  /** The bracket's choice. */
  choice: number
  /** The token that closes the bracket, or none for the rule. */
  close: number | undefined
  /** Whether the bracket is the right side of an exception. */
  except: boolean
  /** The bracket's node. */
  node: number | undefined
  /** The sequence being read. */
  sequence: number
  /** The term being read. */
  term: number | undefined
}

/** A frame for the choice `choice`, with its first sequence. */
function frame(
  ast: AstNode<Ebnf>[],
  node: number | undefined,
  choice: number,
  close: number | undefined,
  except: boolean,
): Frame {
  const sequence = add<Ebnf>(ast, { kind: 'Sequence' })
  attach(ast, choice, sequence)
  return { choice, close, except, node, sequence, term: undefined }
}

/** Adds `postfix` to the term `term` of `ast`. */
function pushPostfix(ast: AstNode<Ebnf>[], term: number, postfix: Postfix): void {
  const node = ast[term]
  if (node !== undefined && node.kind.kind === 'Term') node.kind._0.push(postfix)
}

/** Reads a rule's definition into `ast`, returning its choice. */
function definition(r: Reader, ast: AstNode<Ebnf>[]): number {
  const stack: Frame[] = []
  const root = add<Ebnf>(ast, { kind: 'Choice' })
  let top = frame(ast, undefined, root, undefined, false)
  let except = false
  for (;;) {
    const kind = readerKind(r)
    let primary: number
    switch (kind) {
      case t.STRING:
        primary = add<Ebnf>(ast, { kind: 'Terminal', _0: unescape(readerTake(r)) })
        break
      case t.ID:
        primary = add<Ebnf>(ast, { kind: 'NonTerminal', _0: readerTake(r) })
        break
      case t.SPECIAL: {
        const text = readerTake(r)
        const inner = text.slice(1, Math.max(text.length - 1, 1))
        primary = add<Ebnf>(ast, { kind: 'Special', _0: trim(inner) })
        break
      }
      case t.GROUP:
      case t.OPTION:
      case t.REPEAT: {
        r.i += 1
        const element = add<Ebnf>(ast, { kind: 'Choice' })
        const bracket = add<Ebnf>(
          ast,
          kind === t.GROUP ? { kind: 'Group' } : kind === t.OPTION ? { kind: 'Optional' } : { kind: 'Repetition' },
        )
        attach(ast, bracket, element)
        const next = frame(ast, bracket, element, kind + 1, except)
        stack.push(top)
        top = next
        except = false
        continue
      }
      default:
        throw readerFail(r, 'a terminal, a name, or an opening bracket')
    }
    for (;;) {
      let term: number
      if (top.term !== undefined && except) {
        term = top.term
        pushPostfix(ast, term, Postfix.Exception)
        attach(ast, term, primary)
        except = false
      } else {
        term = add<Ebnf>(ast, { kind: 'Term', _0: [] })
        attach(ast, term, primary)
        attach(ast, top.sequence, term)
        top.term = term
      }
      for (;;) {
        const k = readerKind(r)
        let postfix: Postfix
        if (k === t.QUESTION) postfix = Postfix.Optional
        else if (k === t.STAR) postfix = Postfix.ZeroOrMore
        else if (k === t.PLUS) postfix = Postfix.OneOrMore
        else break
        r.i += 1
        pushPostfix(ast, term, postfix)
      }
      const k = readerKind(r)
      if (top.close === k && k !== EOF) {
        r.i += 1
        primary = top.node ?? NONE
        except = top.except
        const outer = stack.pop()
        if (outer === undefined) throw readerFail(r, 'an expression')
        top = outer
        continue
      }
      switch (k) {
        case t.MINUS:
          r.i += 1
          except = true
          break
        case t.COMMA:
          r.i += 1
          break
        case t.BAR: {
          r.i += 1
          const sequence = add<Ebnf>(ast, { kind: 'Sequence' })
          attach(ast, top.choice, sequence)
          top.sequence = sequence
          break
        }
        case t.STRING:
        case t.ID:
        case t.SPECIAL:
        case t.GROUP:
        case t.OPTION:
        case t.REPEAT:
          break
        default: {
          const close = stack.length > 0 ? top.close : undefined
          if (close === undefined) return top.choice
          const name = EBNF_TOKENS[close]?.name ?? ''
          throw readerFail(r, `token of type '${name}'`)
        }
      }
      break
    }
  }
}

/**
 * Parses `railroad-ebnf-beta` `src` as Pele's `parseEbnf` does, returning the statements and
 * each rule's name and definition in `ast`.
 *
 * Throws a syntax error where the source leaves the grammar.
 */
export function parseEbnf(src: string, ast: AstNode<Ebnf>[]): Grammar<[string, number]> {
  return parseGrammar(src, EBNF_TOKENS, t.TITLE, unescape, (r): [string, number] => {
    const name = readerExpect(r, t.ID)
    if (!readerAccept(r, t.EQUALS)) readerExpect(r, t.DEFINES)
    const body = definition(r, ast)
    readerExpect(r, t.SEMICOLON)
    return [name, body]
  })
}

/** The node a part of the syntax tree builds from its parts' nodes. */
function node(part: Ebnf, kids: number[], nodes: RailroadNode[]): number {
  switch (part.kind) {
    case 'Choice':
      return choice(nodes, kids)
    case 'Sequence':
      return sequence(nodes, kids)
    case 'Term': {
      // Each postfix operator applies to everything before it in the term.
      let result = first(kids)
      let next = 1
      for (const postfix of part._0) {
        switch (postfix) {
          case Postfix.Optional:
            result = optional(nodes, result)
            break
          case Postfix.Exception: {
            const minus = push(nodes, { kind: 'Terminal', _0: '-' })
            const except = kids[next] ?? NONE
            next += 1
            result = push(nodes, { kind: 'Sequence', _0: [result, minus, except] })
            break
          }
          case Postfix.OneOrMore:
            result = repetition(nodes, result, 1.0)
            break
          case Postfix.ZeroOrMore:
            result = repetition(nodes, result, 0.0)
            break
        }
      }
      return result
    }
    case 'Terminal':
      return push(nodes, { kind: 'Terminal', _0: part._0 })
    case 'NonTerminal':
      return push(nodes, { kind: 'NonTerminal', _0: part._0 })
    case 'Special':
      return push(nodes, { kind: 'Special', _0: part._0 })
    case 'Group':
      return first(kids)
    case 'Optional':
      return optional(nodes, first(kids))
    case 'Repetition':
      return repetition(nodes, first(kids), 0.0)
  }
}

/** The rules of an EBNF grammar: Pele's `ebnfRules`. */
export function ebnfRules(ast: AstNode<Ebnf>[], rules: [string, number][], nodes: RailroadNode[]): RailroadRule[] {
  return toRules(ast, rules, nodes, node)
}
