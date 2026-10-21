/**
 * @module Token kinds of the class lexer and the names Mermaid's parser reports for them. Port of
 * Pele's `src/diagrams/class/tokens.ts`.
 */

/** A token kind. Variant order mirrors Pele's `T` enum and indexes {@link NAMES}, so it is observable. */
export const T = {
  /** Pele's `T.END`. */
  End: 0,
  /** Pele's `T.ERROR`. */
  Error: 1,
  /** Pele's `T.CLASS_DIAGRAM`. */
  ClassDiagram: 2,
  /** Pele's `T.NEWLINE`. */
  Newline: 3,
  /** Pele's `T.EOF`. */
  Eof: 4,
  /** Pele's `T.SQS`. */
  Sqs: 5,
  /** Pele's `T.STR`. */
  Str: 6,
  /** Pele's `T.SQE`. */
  Sqe: 7,
  /** Pele's `T.DOT`. */
  Dot: 8,
  /** Pele's `T.GENERICTYPE`. */
  Generictype: 9,
  /** Pele's `T.LABEL`. */
  Label: 10,
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
  /** Pele's `T.STRUCT_START`. */
  StructStart: 16,
  /** Pele's `T.STRUCT_STOP`. */
  StructStop: 17,
  /** Pele's `T.NAMESPACE`. */
  Namespace: 18,
  /** Pele's `T.STYLE_SEPARATOR`. */
  StyleSeparator: 19,
  /** Pele's `T.ANNOTATION_START`. */
  AnnotationStart: 20,
  /** Pele's `T.ANNOTATION_END`. */
  AnnotationEnd: 21,
  /** Pele's `T.CLASS`. */
  Class: 22,
  /** Pele's `T.MEMBER`. */
  Member: 23,
  /** Pele's `T.NOTE_FOR`. */
  NoteFor: 24,
  /** Pele's `T.NOTE`. */
  Note: 25,
  /** Pele's `T.CLASSDEF`. */
  Classdef: 26,
  /** Pele's `T.ALPHA`. */
  Alpha: 27,
  /** Pele's `T.COMMA`. */
  Comma: 28,
  /** Pele's `T.direction_tb`. */
  DirectionTb: 29,
  /** Pele's `T.direction_bt`. */
  DirectionBt: 30,
  /** Pele's `T.direction_rl`. */
  DirectionRl: 31,
  /** Pele's `T.direction_lr`. */
  DirectionLr: 32,
  /** Pele's `T.AGGREGATION`. */
  Aggregation: 33,
  /** Pele's `T.EXTENSION`. */
  Extension: 34,
  /** Pele's `T.COMPOSITION`. */
  Composition: 35,
  /** Pele's `T.DEPENDENCY`. */
  Dependency: 36,
  /** Pele's `T.LOLLIPOP`. */
  Lollipop: 37,
  /** Pele's `T.LINE`. */
  Line: 38,
  /** Pele's `T.DOTTED_LINE`. */
  DottedLine: 39,
  /** Pele's `T.CALLBACK`. */
  Callback: 40,
  /** Pele's `T.LINK`. */
  Link: 41,
  /** Pele's `T.LINK_TARGET`. */
  LinkTarget: 42,
  /** Pele's `T.CLICK`. */
  Click: 43,
  /** Pele's `T.CALLBACK_NAME`. */
  CallbackName: 44,
  /** Pele's `T.CALLBACK_ARGS`. */
  CallbackArgs: 45,
  /** Pele's `T.HREF`. */
  Href: 46,
  /** Pele's `T.STYLE`. */
  Style: 47,
  /** Pele's `T.CSSCLASS`. */
  Cssclass: 48,
  /** Pele's `T.COLON`. */
  Colon: 49,
  /** Pele's `T.BRKT`. */
  Brkt: 50,
  /** Pele's `T.PCT`. */
  Pct: 51,
  /** Pele's `T.MINUS`. */
  Minus: 52,
  /** Pele's `T.UNICODE_TEXT`. */
  UnicodeText: 53,
  /** Pele's `T.BQUOTE_STR`. */
  BquoteStr: 54,
  /** Pele's `T.EDGE_STATE`. */
  EdgeState: 55,
  /** Pele's `T.EOF_IN_STRUCT`. */
  EofInStruct: 56,
  /** Pele's `T.OPEN_IN_STRUCT`. */
  OpenInStruct: 57,
  /** Pele's `T.PLUS`. */
  Plus: 58,
  /** Pele's `T.EQUALS`. */
  Equals: 59,
  /** Pele's `T.PUNCTUATION`. */
  Punctuation: 60,
} as const

export type T = (typeof T)[keyof typeof T]

/** The names Mermaid's parser reports for each token kind, indexed by {@link T}. */
export const NAMES: readonly string[] = [
  '$end',
  'INVALID',
  'CLASS_DIAGRAM',
  'NEWLINE',
  'EOF',
  'SQS',
  'STR',
  'SQE',
  'DOT',
  'GENERICTYPE',
  'LABEL',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'STRUCT_START',
  'STRUCT_STOP',
  'NAMESPACE',
  'STYLE_SEPARATOR',
  'ANNOTATION_START',
  'ANNOTATION_END',
  'CLASS',
  'MEMBER',
  'NOTE_FOR',
  'NOTE',
  'CLASSDEF',
  'ALPHA',
  'COMMA',
  'direction_tb',
  'direction_bt',
  'direction_rl',
  'direction_lr',
  'AGGREGATION',
  'EXTENSION',
  'COMPOSITION',
  'DEPENDENCY',
  'LOLLIPOP',
  'LINE',
  'DOTTED_LINE',
  'CALLBACK',
  'LINK',
  'LINK_TARGET',
  'CLICK',
  'CALLBACK_NAME',
  'CALLBACK_ARGS',
  'HREF',
  'STYLE',
  'CSSCLASS',
  'COLON',
  'BRKT',
  'PCT',
  'MINUS',
  'UNICODE_TEXT',
  'BQUOTE_STR',
  'EDGE_STATE',
  'EOF_IN_STRUCT',
  'OPEN_IN_STRUCT',
  'PLUS',
  'EQUALS',
  'PUNCTUATION',
]

/** The name Mermaid's parser reports for this kind. */
export function tName(self: T): string {
  return NAMES[self] ?? ''
}
