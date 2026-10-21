/**
 * @module Picks the notation from the keyword and loads the parsed rules into the model. Port of
 * Pele's `src/diagrams/railroad/db.ts`.
 */
import { Code, errorNew } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { startsWithIgnoreAsciiCase } from '../../util/rust.ts'
import { type Abnf, abnfRules, parseAbnf } from './abnf.ts'
import type { AstNode, Grammar } from './common.ts'
import { type Ebnf, ebnfRules, parseEbnf } from './ebnf.ts'
import { parseIr } from './ir.ts'
import { type Peg, parsePeg, pegRules } from './peg.ts'
import { Notation, type RailroadModel, type RailroadRule } from './types.ts'

/**
 * The notation the source's keyword names: `^\s*railroad-(ebnf-|abnf-|peg-)?beta`, without
 * regard to case. Mermaid has a detector per keyword.
 */
export function notationOf(source: string): Notation | undefined {
  const rest = trimStart(source)
  if (!startsWithIgnoreAsciiCase(rest, 'railroad-')) return undefined
  const tail = rest.slice(9)
  const infixes: [string, Notation][] = [
    ['ebnf-', Notation.Ebnf],
    ['abnf-', Notation.Abnf],
    ['peg-', Notation.Peg],
  ]
  for (const [infix, notation] of infixes) {
    if (startsWithIgnoreAsciiCase(tail, infix) && startsWithIgnoreAsciiCase(tail, 'beta', infix.length)) {
      return notation
    }
  }
  return startsWithIgnoreAsciiCase(tail, 'beta') ? Notation.Railroad : undefined
}

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 0x0a) {
      while (i < n && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/** Parses `source` in `notation`, returning its statements and rules with their nodes. */
function grammar(source: string, notation: Notation, model: RailroadModel): [Grammar<undefined>, RailroadRule[]] {
  const nodes = model.nodes
  switch (notation) {
    case Notation.Ebnf: {
      const ast: AstNode<Ebnf>[] = []
      const parsed = parseEbnf(source, ast)
      const rules = ebnfRules(ast, parsed.rules, nodes)
      return [strip(parsed), rules]
    }
    case Notation.Abnf: {
      const ast: AstNode<Abnf>[] = []
      const parsed = parseAbnf(source, ast)
      const rules = abnfRules(ast, parsed.rules, nodes)
      return [strip(parsed), rules]
    }
    case Notation.Peg: {
      const ast: AstNode<Peg>[] = []
      const parsed = parsePeg(source, ast)
      const rules = pegRules(ast, parsed.rules, nodes)
      return [strip(parsed), rules]
    }
    case Notation.Railroad: {
      const parsed = parseIr(source, nodes)
      const rules = parsed.rules
      parsed.rules = []
      return [strip(parsed), rules]
    }
  }
}

/** The statements of `grammar`, without its rules. */
function strip<R>(grammar: Grammar<R>): Grammar<undefined> {
  return { accDescr: grammar.accDescr, accTitle: grammar.accTitle, rules: [], title: grammar.title }
}

/**
 * Parses `source`, as Pele's `parseRailroad` does. `title` comes from front matter.
 *
 * Throws a syntax error when the source has no railroad keyword or leaves its grammar.
 */
export function parseRailroad(source: string, title: string | undefined): RailroadModel {
  const notation = notationOf(source)
  if (notation === undefined) {
    const error = errorNew(Code.Syntax, 'No railroad diagram keyword found.')
    error.type = 'railroad'
    throw error
  }
  const model: RailroadModel = {
    accDescr: undefined,
    accTitle: undefined,
    nodes: [],
    notation: Notation.Railroad,
    rules: [],
    title: title !== undefined && title !== '' ? title : undefined,
  }

  // Parses the text in one notation and loads the result into the model, as Mermaid's four
  // parsers do.
  const [ast, rules] = grammar(source, notation, model)
  model.notation = notation
  if (ast.accDescr !== undefined && ast.accDescr !== '') model.accDescr = dedentLines(ast.accDescr)
  if (ast.accTitle !== undefined && ast.accTitle !== '') model.accTitle = trimStart(ast.accTitle)
  if (ast.title !== undefined && ast.title !== '') model.title = ast.title
  model.rules = rules
  return model
}
