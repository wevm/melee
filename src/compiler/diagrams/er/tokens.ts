/**
 * @module Token kinds of the er lexer and the names Mermaid's parser reports for them. Port of
 * Pele's `src/diagrams/er/tokens.ts`.
 */

/** A token kind. Variant order mirrors Pele's `T` enum and indexes {@link NAMES}, so it is observable. */
export const T = {
  /** Pele's `T.END`. */
  End: 0,
  /** Pele's `T.ERROR`. */
  Error: 1,
  /** Pele's `T.ER_DIAGRAM`. */
  ErDiagram: 2,
  /** Pele's `T.EOF`. */
  Eof: 3,
  /** Pele's `T.NEWLINE`. */
  Newline: 4,
  /** Pele's `T.COLON`. */
  Colon: 5,
  /** Pele's `T.STYLE_SEPARATOR`. */
  StyleSeparator: 6,
  /** Pele's `T.BLOCK_START`. */
  BlockStart: 7,
  /** Pele's `T.BLOCK_STOP`. */
  BlockStop: 8,
  /** Pele's `T.SQS`. */
  Sqs: 9,
  /** Pele's `T.SQE`. */
  Sqe: 10,
  /** Pele's `T.acc_title`. */
  AccTitle: 11,
  /** Pele's `T.acc_title_value`. */
  AccTitleValue: 12,
  /** Pele's `T.acc_descr`. */
  AccDescr: 13,
  /** Pele's `T.acc_descr_value`. */
  AccDescrValue: 14,
  /** Pele's `T.acc_descr_multiline_value`. */
  AccDescrMultilineValue: 15,
  /** Pele's `T.END_KW`. */
  EndKw: 16,
  /** Pele's `T.SUBGRAPH`. */
  Subgraph: 17,
  /** Pele's `T.direction_tb`. */
  DirectionTb: 18,
  /** Pele's `T.direction_bt`. */
  DirectionBt: 19,
  /** Pele's `T.direction_rl`. */
  DirectionRl: 20,
  /** Pele's `T.direction_lr`. */
  DirectionLr: 21,
  /** Pele's `T.CLASSDEF`. */
  Classdef: 22,
  /** Pele's `T.UNICODE_TEXT`. */
  UnicodeText: 23,
  /** Pele's `T.STYLE_TEXT`. */
  StyleText: 24,
  /** Pele's `T.COMMA`. */
  Comma: 25,
  /** Pele's `T.CLASS`. */
  Class: 26,
  /** Pele's `T.STYLE`. */
  Style: 27,
  /** Pele's `T.SEMI`. */
  Semi: 28,
  /** Pele's `T.NUM`. */
  Num: 29,
  /** Pele's `T.BRKT`. */
  Brkt: 30,
  /** Pele's `T.ENTITY_NAME`. */
  EntityName: 31,
  /** Pele's `T.DECIMAL_NUM`. */
  DecimalNum: 32,
  /** Pele's `T.ENTITY_ONE`. */
  EntityOne: 33,
  /** Pele's `T.ATTRIBUTE_WORD`. */
  AttributeWord: 34,
  /** Pele's `T.ATTRIBUTE_KEY`. */
  AttributeKey: 35,
  /** Pele's `T.COMMENT`. */
  Comment: 36,
  /** Pele's `T.ZERO_OR_ONE`. */
  ZeroOrOne: 37,
  /** Pele's `T.ZERO_OR_MORE`. */
  ZeroOrMore: 38,
  /** Pele's `T.ONE_OR_MORE`. */
  OneOrMore: 39,
  /** Pele's `T.ONLY_ONE`. */
  OnlyOne: 40,
  /** Pele's `T.MD_PARENT`. */
  MdParent: 41,
  /** Pele's `T.NON_IDENTIFYING`. */
  NonIdentifying: 42,
  /** Pele's `T.IDENTIFYING`. */
  Identifying: 43,
  /** Pele's `T.WORD`. */
  Word: 44,
  /** Pele's `T.CHAR`. */
  Char: 45,
} as const

/** A token kind. */
export type T = (typeof T)[keyof typeof T]

/** The names Mermaid's parser reports for each token kind, indexed by {@link T}. */
export const NAMES: readonly string[] = [
  '$end',
  'INVALID',
  'ER_DIAGRAM',
  'EOF',
  'NEWLINE',
  'COLON',
  'STYLE_SEPARATOR',
  'BLOCK_START',
  'BLOCK_STOP',
  'SQS',
  'SQE',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'END',
  'SUBGRAPH',
  'direction_tb',
  'direction_bt',
  'direction_rl',
  'direction_lr',
  'CLASSDEF',
  'UNICODE_TEXT',
  'STYLE_TEXT',
  'COMMA',
  'CLASS',
  'STYLE',
  'SEMI',
  'NUM',
  'BRKT',
  'ENTITY_NAME',
  'DECIMAL_NUM',
  'ENTITY_ONE',
  'ATTRIBUTE_WORD',
  'ATTRIBUTE_KEY',
  'COMMENT',
  'ZERO_OR_ONE',
  'ZERO_OR_MORE',
  'ONE_OR_MORE',
  'ONLY_ONE',
  'MD_PARENT',
  'NON_IDENTIFYING',
  'IDENTIFYING',
  'WORD',
  'CHAR',
]

/** The name Mermaid's parser reports for this kind. */
export function tName(self: T): string {
  return NAMES[self] ?? ''
}
