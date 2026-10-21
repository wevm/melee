/**
 * @module Token kinds of the flowchart lexer and the names Mermaid's parser reports for them. Port of
 * Pele's `src/diagrams/flowchart/tokens.ts`.
 */

/** A token kind. Variant order mirrors Pele's `T` enum and indexes {@link NAMES}, so it is observable. */
export const T = {
  /** Pele's `T.END`. */
  End: 0,
  /** Pele's `T.ERROR`. */
  Error: 1,
  /** Pele's `T.acc_title`. */
  AccTitle: 2,
  /** Pele's `T.acc_title_value`. */
  AccTitleValue: 3,
  /** Pele's `T.acc_descr`. */
  AccDescr: 4,
  /** Pele's `T.acc_descr_value`. */
  AccDescrValue: 5,
  /** Pele's `T.acc_descr_multiline_value`. */
  AccDescrMultilineValue: 6,
  /** Pele's `T.SHAPE_DATA`. */
  ShapeData: 7,
  /** Pele's `T.CALLBACKNAME`. */
  CallbackName: 8,
  /** Pele's `T.CALLBACKARGS`. */
  CallbackArgs: 9,
  /** Pele's `T.MD_STR`. */
  MdStr: 10,
  /** Pele's `T.STR`. */
  Str: 11,
  /** Pele's `T.STYLE`. */
  Style: 12,
  /** Pele's `T.DEFAULT`. */
  Default: 13,
  /** Pele's `T.LINKSTYLE`. */
  LinkStyle: 14,
  /** Pele's `T.INTERPOLATE`. */
  Interpolate: 15,
  /** Pele's `T.CLASSDEF`. */
  ClassDef: 16,
  /** Pele's `T.CLASS`. */
  Class: 17,
  /** Pele's `T.HREF`. */
  Href: 18,
  /** Pele's `T.CLICK`. */
  Click: 19,
  /** Pele's `T.GRAPH`. */
  Graph: 20,
  /** Pele's `T.subgraph`. */
  Subgraph: 21,
  /** Pele's `T.end`. */
  SubgraphEnd: 22,
  /** Pele's `T.LINK_TARGET`. */
  LinkTarget: 23,
  /** Pele's `T.NODIR`. */
  NoDir: 24,
  /** Pele's `T.DIR`. */
  Dir: 25,
  /** Pele's `T.direction_tb`. */
  DirectionTb: 26,
  /** Pele's `T.direction_bt`. */
  DirectionBt: 27,
  /** Pele's `T.direction_rl`. */
  DirectionRl: 28,
  /** Pele's `T.direction_lr`. */
  DirectionLr: 29,
  /** Pele's `T.direction_td`. */
  DirectionTd: 30,
  /** Pele's `T.LINK_ID`. */
  LinkId: 31,
  /** Pele's `T.NUM`. */
  Num: 32,
  /** Pele's `T.BRKT`. */
  Brkt: 33,
  /** Pele's `T.STYLE_SEPARATOR`. */
  StyleSeparator: 34,
  /** Pele's `T.COLON`. */
  Colon: 35,
  /** Pele's `T.AMP`. */
  Amp: 36,
  /** Pele's `T.SEMI`. */
  Semi: 37,
  /** Pele's `T.COMMA`. */
  Comma: 38,
  /** Pele's `T.MULT`. */
  Mult: 39,
  /** Pele's `T.LINK`. */
  Link: 40,
  /** Pele's `T.START_LINK`. */
  StartLink: 41,
  /** Pele's `T.EDGE_TEXT`. */
  EdgeText: 42,
  /** Pele's `T.ELLIPSE_END`. */
  EllipseEnd: 43,
  /** Pele's `T.TEXT`. */
  Text: 44,
  /** Pele's `T.ELLIPSE_START`. */
  EllipseStart: 45,
  /** Pele's `T.STADIUMEND`. */
  StadiumEnd: 46,
  /** Pele's `T.STADIUMSTART`. */
  StadiumStart: 47,
  /** Pele's `T.SUBROUTINEEND`. */
  SubroutineEnd: 48,
  /** Pele's `T.SUBROUTINESTART`. */
  SubroutineStart: 49,
  /** Pele's `T.VERTEX_WITH_PROPS_START`. */
  VertexWithPropsStart: 50,
  /** Pele's `T.TAGEND`. */
  TagEnd: 51,
  /** Pele's `T.CYLINDEREND`. */
  CylinderEnd: 52,
  /** Pele's `T.CYLINDERSTART`. */
  CylinderStart: 53,
  /** Pele's `T.DOUBLECIRCLEEND`. */
  DoubleCircleEnd: 54,
  /** Pele's `T.DOUBLECIRCLESTART`. */
  DoubleCircleStart: 55,
  /** Pele's `T.TRAPEND`. */
  TrapEnd: 56,
  /** Pele's `T.INVTRAPEND`. */
  InvTrapEnd: 57,
  /** Pele's `T.TRAPSTART`. */
  TrapStart: 58,
  /** Pele's `T.INVTRAPSTART`. */
  InvTrapStart: 59,
  /** Pele's `T.TAGSTART`. */
  TagStart: 60,
  /** Pele's `T.UP`. */
  Up: 61,
  /** Pele's `T.SEP`. */
  Sep: 62,
  /** Pele's `T.DOWN`. */
  Down: 63,
  /** Pele's `T.NODE_STRING`. */
  NodeString: 64,
  /** Pele's `T.MINUS`. */
  Minus: 65,
  /** Pele's `T.UNICODE_TEXT`. */
  UnicodeText: 66,
  /** Pele's `T.PIPE`. */
  Pipe: 67,
  /** Pele's `T.PE`. */
  Pe: 68,
  /** Pele's `T.PS`. */
  Ps: 69,
  /** Pele's `T.SQE`. */
  Sqe: 70,
  /** Pele's `T.SQS`. */
  Sqs: 71,
  /** Pele's `T.DIAMOND_STOP`. */
  DiamondStop: 72,
  /** Pele's `T.DIAMOND_START`. */
  DiamondStart: 73,
  /** Pele's `T.NEWLINE`. */
  Newline: 74,
  /** Pele's `T.SPACE`. */
  Space: 75,
  /** Pele's `T.EOF`. */
  Eof: 76,
} as const

/** A token kind. */
export type T = (typeof T)[keyof typeof T]

/** The name Mermaid's parser reports for this kind in `Expecting ...` messages. */
export function tName(value: T): string {
  return NAMES[value] ?? ''
}

/** Token names, indexed by {@link T}. */
const NAMES: readonly string[] = [
  '$end',
  'INVALID',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'SHAPE_DATA',
  'CALLBACKNAME',
  'CALLBACKARGS',
  'MD_STR',
  'STR',
  'STYLE',
  'DEFAULT',
  'LINKSTYLE',
  'INTERPOLATE',
  'CLASSDEF',
  'CLASS',
  'HREF',
  'CLICK',
  'GRAPH',
  'subgraph',
  'end',
  'LINK_TARGET',
  'NODIR',
  'DIR',
  'direction_tb',
  'direction_bt',
  'direction_rl',
  'direction_lr',
  'direction_td',
  'LINK_ID',
  'NUM',
  'BRKT',
  'STYLE_SEPARATOR',
  'COLON',
  'AMP',
  'SEMI',
  'COMMA',
  'MULT',
  'LINK',
  'START_LINK',
  'EDGE_TEXT',
  '-)',
  'TEXT',
  '(-',
  'STADIUMEND',
  'STADIUMSTART',
  'SUBROUTINEEND',
  'SUBROUTINESTART',
  'VERTEX_WITH_PROPS_START',
  'TAGEND',
  'CYLINDEREND',
  'CYLINDERSTART',
  'DOUBLECIRCLEEND',
  'DOUBLECIRCLESTART',
  'TRAPEND',
  'INVTRAPEND',
  'TRAPSTART',
  'INVTRAPSTART',
  'TAGSTART',
  'UP',
  'SEP',
  'DOWN',
  'NODE_STRING',
  'MINUS',
  'UNICODE_TEXT',
  'PIPE',
  'PE',
  'PS',
  'SQE',
  'SQS',
  'DIAMOND_STOP',
  'DIAMOND_START',
  'NEWLINE',
  'SPACE',
  'EOF',
]
