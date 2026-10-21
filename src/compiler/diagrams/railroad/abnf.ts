/**
 * @module `railroad-abnf-beta`: ABNF as in RFC 5234, with each rule closed by a semicolon. Port of
 * Pele's `src/diagrams/railroad/abnf.ts`.
 */
import {
  DIRECTIVE,
  literal,
  type Matcher,
  type Reader,
  readerExpect,
  readerFail,
  readerKind,
  readerTake,
  SINGLE_LINE_COMMENT,
  type TokenType,
  YAML,
} from '../common/tokens.ts'
import { parse } from '../../util/float.ts'
import {
  ACC_DESCR,
  ACC_TITLE,
  add,
  type AstNode,
  attach,
  choice,
  first,
  type Grammar,
  LETTERS,
  NONE,
  opening,
  optional,
  parseGrammar,
  push,
  sequence,
  TITLE,
  toRules,
  unquote,
  whitespace,
  word,
} from './common.ts'
import type { RailroadNode, RailroadRule } from './types.ts'

/** Token kinds, as indices into {@link ABNF_TOKENS}. */
const t = {
  EQUALS: 1,
  SEMICOLON: 2,
  SLASH: 3,
  GROUP: 4,
  OPTION: 6,
  TITLE: 8,
  NAME: 11,
  STRING: 12,
  NUMBER: 13,
  REPEAT: 14,
  EXACT: 15,
  COMMENT: 20,
} as const

/** Whether `c` is an ASCII digit. */
function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

/** Whether `c` is an ASCII letter. */
function isAlpha(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
}

/** Whether `c` is an ASCII hexadecimal digit. */
function isHexDigit(c: number): boolean {
  return isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)
}

/** Where a run of units that `class` takes ends, from `at`. */
function run(src: string, at: number, cls: (c: number) => boolean): number {
  let i = at
  while (i < src.length && cls(src.charCodeAt(i))) i += 1
  return i
}

/** `[A-Za-z][A-Za-z0-9-]*`. */
function ruleName(src: string, at: number): number | undefined {
  if (at >= src.length || !isAlpha(src.charCodeAt(at))) return undefined
  return run(src, at + 1, (b) => isAlpha(b) || isDigit(b) || b === 0x2d)
}

/** `"[^"]*"`. */
function string(src: string, at: number): number | undefined {
  if (src.charCodeAt(at) !== 0x22) return undefined
  const close = src.indexOf('"', at + 1)
  if (close < 0) return undefined
  return close + 1
}

/** `%[xXdDbB][0-9A-Fa-f]+(?:-[0-9A-Fa-f]+|\.[0-9A-Fa-f]+)*`. */
function numVal(src: string, at: number): number | undefined {
  if (src.charCodeAt(at) !== 0x25) return undefined
  const base = src.charCodeAt(at + 1)
  if (!(base === 0x78 || base === 0x58 || base === 0x64 || base === 0x44 || base === 0x62 || base === 0x42)) {
    return undefined
  }
  let end = run(src, at + 2, isHexDigit)
  if (end === at + 2) return undefined
  for (;;) {
    const c = src.charCodeAt(end)
    if (!(c === 0x2d || c === 0x2e)) break
    const next = run(src, end + 1, isHexDigit)
    if (next === end + 1) break
    end = next
  }
  return end
}

/** `[0-9]*\*[0-9]*`. */
function repeat(src: string, at: number): number | undefined {
  const star = run(src, at, isDigit)
  return src.charCodeAt(star) === 0x2a ? run(src, star + 1, isDigit) : undefined
}

/** `[0-9]+`. */
function exact(src: string, at: number): number | undefined {
  const end = run(src, at, isDigit)
  return end > at ? end : undefined
}

/** `;[^\n\r]*`. */
function comment(src: string, at: number): number | undefined {
  if (src.charCodeAt(at) !== 0x3b) return undefined
  let i = at + 1
  while (i < src.length) {
    const c = src.charCodeAt(i)
    if (c === 0x0a || c === 0x0d) break
    i += 1
  }
  return i
}

/** A token type with a hand-written matcher. */
function matched(name: string, first: string, matcher: Matcher): TokenType {
  return {
    ...literal(''),
    first,
    name,
    pattern: { kind: 'Match', _0: matcher },
  }
}

/** Pele's `ABNF_TOKENS`, in matching order. */
export const ABNF_TOKENS: TokenType[] = [
  opening('railroad-abnf-beta', [t.NAME]),
  literal('='),
  // A semicolon closes a rule only at the end of its line; with anything after it, it starts
  // a comment.
  word(';', [t.COMMENT]),
  literal('/'),
  literal('('),
  literal(')'),
  literal('['),
  literal(']'),
  TITLE,
  ACC_TITLE,
  ACC_DESCR,
  matched('ABNF_RULENAME', LETTERS, ruleName),
  matched('ABNF_STRING', '"', string),
  matched('ABNF_NUMVAL', '%', numVal),
  matched('ABNF_REPEAT', '0123456789*', repeat),
  matched('ABNF_EXACT_REPEAT', '0123456789', exact),
  whitespace('ABNF_WHITESPACE'),
  { ...YAML, first: '-', name: 'ABNF_YAML' },
  { ...DIRECTIVE, first: '\t %', name: 'ABNF_DIRECTIVE' },
  { ...SINGLE_LINE_COMMENT, first: '\t %', name: 'ABNF_SINGLE_LINE_COMMENT' },
  { ...matched('ABNF_COMMENT', ';', comment), hidden: true },
]

/**
 * A node of the ABNF syntax tree. Its parts are an alternation's concatenations, a
 * concatenation's elements, an element's primary, or a group's alternation.
 */
export type Abnf =
  /** Alternatives. */
  | { kind: 'Alternation' }
  /** Elements one after another. */
  | { kind: 'Concatenation' }
  /** A primary with the repeat written before it. */
  | { kind: 'Element'; _0: string | undefined }
  /** `( ... )`. */
  | { kind: 'Group' }
  /** `%x41` and the like, as written. */
  | { kind: 'NumVal'; _0: string }
  /** `[ ... ]`. */
  | { kind: 'OptionalGroup' }
  /** A rule name. */
  | { kind: 'RuleName'; _0: string }
  /** A string, without its quotes. */
  | { kind: 'StringLiteral'; _0: string }

/** One open bracket, or the rule itself at the bottom of the stack. */
type Frame = {
  /** The bracket's alternation. */
  alternation: number
  /** The token that closes the bracket, or none for the rule. */
  close: number | undefined
  /** The concatenation being read. */
  concatenation: number
  /** The bracket's node. */
  node: number | undefined
  /** The repeat written before the bracket. */
  repeat: string | undefined
}

/** A frame for the alternation `alternation`, with its first concatenation. */
function frame(
  ast: AstNode<Abnf>[],
  node: number | undefined,
  alternation: number,
  close: number | undefined,
  repeat: string | undefined,
): Frame {
  const concatenation = add<Abnf>(ast, { kind: 'Concatenation' })
  attach(ast, alternation, concatenation)
  return { alternation, close, concatenation, node, repeat }
}

/** Reads a rule's definition into `ast`, returning its alternation. */
function alternation(r: Reader, ast: AstNode<Abnf>[]): number {
  const stack: Frame[] = []
  const root = add<Abnf>(ast, { kind: 'Alternation' })
  let top = frame(ast, undefined, root, undefined, undefined)
  for (;;) {
    let repeat =
      readerKind(r) === t.REPEAT || readerKind(r) === t.EXACT ? readerTake(r) : undefined
    const kind = readerKind(r)
    let primary: number
    switch (kind) {
      case t.STRING:
        primary = add<Abnf>(ast, { kind: 'StringLiteral', _0: unquote(readerTake(r)) })
        break
      case t.NUMBER:
        primary = add<Abnf>(ast, { kind: 'NumVal', _0: readerTake(r) })
        break
      case t.NAME:
        primary = add<Abnf>(ast, { kind: 'RuleName', _0: readerTake(r) })
        break
      case t.GROUP:
      case t.OPTION: {
        r.i += 1
        const element = add<Abnf>(ast, { kind: 'Alternation' })
        const bracket = add<Abnf>(ast, kind === t.GROUP ? { kind: 'Group' } : { kind: 'OptionalGroup' })
        attach(ast, bracket, element)
        const next = frame(ast, bracket, element, kind + 1, repeat)
        stack.push(top)
        top = next
        continue
      }
      default:
        throw readerFail(r, 'a string, a number, a name, or an opening bracket')
    }
    for (;;) {
      const element = add<Abnf>(ast, { kind: 'Element', _0: repeat })
      repeat = undefined
      attach(ast, element, primary)
      attach(ast, top.concatenation, element)
      const k = readerKind(r)
      if (top.close === k) {
        r.i += 1
        primary = top.node ?? NONE
        repeat = top.repeat
        top.repeat = undefined
        const outer = stack.pop()
        if (outer === undefined) throw readerFail(r, 'an expression')
        top = outer
        continue
      }
      switch (k) {
        case t.SLASH: {
          r.i += 1
          const concatenation = add<Abnf>(ast, { kind: 'Concatenation' })
          attach(ast, top.alternation, concatenation)
          top.concatenation = concatenation
          break
        }
        case t.STRING:
        case t.NUMBER:
        case t.NAME:
        case t.GROUP:
        case t.OPTION:
        case t.REPEAT:
        case t.EXACT:
          break
        default: {
          const close = stack.length > 0 ? top.close : undefined
          if (close === undefined) return top.alternation
          const name = ABNF_TOKENS[close]?.name ?? ''
          throw readerFail(r, `token of type '${name}'`)
        }
      }
      break
    }
  }
}

/**
 * Parses `railroad-abnf-beta` `src` as Pele's `parseAbnf` does, returning the statements and
 * each rule's name and definition in `ast`.
 *
 * Throws a syntax error where the source leaves the grammar.
 */
export function parseAbnf(src: string, ast: AstNode<Abnf>[]): Grammar<[string, number]> {
  return parseGrammar(src, ABNF_TOKENS, t.TITLE, unquote, (r): [string, number] => {
    const name = readerExpect(r, t.NAME)
    readerExpect(r, t.EQUALS)
    const definition = alternation(r, ast)
    readerExpect(r, t.SEMICOLON)
    return [name, definition]
  })
}

/** `parseInt(text, 10)` of text that starts with a digit. */
function parseInt(text: string): number {
  let end = 0
  while (end < text.length && isDigit(text.charCodeAt(end))) end += 1
  return parse(text.slice(0, end)) ?? Number.NaN
}

/** The node a part of the syntax tree builds from its parts' nodes. */
function node(part: Abnf, kids: number[], nodes: RailroadNode[]): number {
  switch (part.kind) {
    case 'Alternation':
      return choice(nodes, kids)
    case 'Concatenation':
      return sequence(nodes, kids)
    case 'Element': {
      const kid = first(kids)
      const repeat = part._0
      if (repeat === undefined || repeat === '') return kid
      const star = repeat.indexOf('*')
      const min = star === 0 ? 0.0 : parseInt(repeat)
      const max =
        star < 0 ? min : star < repeat.length - 1 ? parseInt(repeat.slice(star + 1)) : Number.POSITIVE_INFINITY
      if (min === 0.0 && max === 1.0) return optional(nodes, kid)
      return push(nodes, { kind: 'Repetition', element: kid, max, min })
    }
    case 'StringLiteral':
    case 'NumVal':
      return push(nodes, { kind: 'Terminal', _0: part._0 })
    case 'RuleName':
      return push(nodes, { kind: 'NonTerminal', _0: part._0 })
    case 'Group':
      return first(kids)
    case 'OptionalGroup':
      return optional(nodes, first(kids))
  }
}

/** The rules of an ABNF grammar: Pele's `abnfRules`. */
export function abnfRules(ast: AstNode<Abnf>[], rules: [string, number][], nodes: RailroadNode[]): RailroadRule[] {
  return toRules(ast, rules, nodes, node)
}
