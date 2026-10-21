/**
 * @module Token kinds of the state lexer and the names Mermaid's parser reports for them. Port of
 * Pele's `src/diagrams/state/tokens.ts`.
 */

/** A token kind. Each variant is the Pele `T` member it documents. */
export const T = {
  /** Pele's `T.acc_descr`. */
  AccDescr: 'AccDescr',
  /** Pele's `T.acc_descr_multiline_value`. */
  AccDescrMultilineValue: 'AccDescrMultilineValue',
  /** Pele's `T.acc_descr_value`. */
  AccDescrValue: 'AccDescrValue',
  /** Pele's `T.acc_title`. */
  AccTitle: 'AccTitle',
  /** Pele's `T.acc_title_value`. */
  AccTitleValue: 'AccTitleValue',
  /** Pele's `T.ARROW`. */
  Arrow: 'Arrow',
  /** Pele's `T.AS`. */
  As: 'As',
  /** Pele's `T.CHOICE`. */
  Choice: 'Choice',
  /** Pele's `T.class`. */
  Class: 'Class',
  /** Pele's `T.classDef`. */
  ClassDef: 'ClassDef',
  /** Pele's `T.CLASSDEF_ID`. */
  ClassDefId: 'ClassDefId',
  /** Pele's `T.CLASSDEF_STYLEOPTS`. */
  ClassDefStyleOpts: 'ClassDefStyleOpts',
  /** Pele's `T.CLASSENTITY_IDS`. */
  ClassEntityIds: 'ClassEntityIds',
  /** Pele's `T.CLICK`. */
  Click: 'Click',
  /** Pele's `T.COMPOSIT_STATE`. */
  CompositState: 'CompositState',
  /** Pele's `T.CONCURRENT`. */
  Concurrent: 'Concurrent',
  /** Pele's `T.DEFAULT`. */
  Default: 'Default',
  /** Pele's `T.DEFAULT_CLASSDEF_ID`. */
  DefaultClassDefId: 'DefaultClassDefId',
  /** Pele's `T.DESCR`. */
  Descr: 'Descr',
  /** Pele's `T.direction_bt`. */
  DirectionBt: 'DirectionBt',
  /** Pele's `T.direction_lr`. */
  DirectionLr: 'DirectionLr',
  /** Pele's `T.direction_rl`. */
  DirectionRl: 'DirectionRl',
  /** Pele's `T.direction_tb`. */
  DirectionTb: 'DirectionTb',
  /** Pele's `T.EDGE_STATE`. */
  EdgeState: 'EdgeState',
  /** Pele's `T.END`. */
  End: 'End',
  /** Pele's `T.ERROR`. */
  Error: 'Error',
  /** Pele's `T.FORK`. */
  Fork: 'Fork',
  /** Pele's `T.HIDE_EMPTY`. */
  HideEmpty: 'HideEmpty',
  /** Pele's `T.HREF`. */
  Href: 'Href',
  /** Pele's `T.ID`. */
  Id: 'Id',
  /** Pele's `T.INVALID`. */
  Invalid: 'Invalid',
  /** Pele's `T.JOIN`. */
  Join: 'Join',
  /** Pele's `T.left_of`. */
  LeftOf: 'LeftOf',
  /** Pele's `T.NL`. */
  Nl: 'Nl',
  /** Pele's `T.note`. */
  Note: 'Note',
  /** Pele's `T.NOTE_TEXT`. */
  NoteText: 'NoteText',
  /** Pele's `T.right_of`. */
  RightOf: 'RightOf',
  /** Pele's `T.scale`. */
  Scale: 'Scale',
  /** Pele's `T.SD`. */
  Sd: 'Sd',
  /** Pele's `T.STATE_DESCR`. */
  StateDescr: 'StateDescr',
  /** Pele's `T.STRING`. */
  String: 'String',
  /** Pele's `T.STRUCT_START`. */
  StructStart: 'StructStart',
  /** Pele's `T.STRUCT_STOP`. */
  StructStop: 'StructStop',
  /** Pele's `T.style`. */
  Style: 'Style',
  /** Pele's `T.STYLE_IDS`. */
  StyleIds: 'StyleIds',
  /** Pele's `T.STYLE_SEPARATOR`. */
  StyleSeparator: 'StyleSeparator',
  /** Pele's `T.STYLECLASS`. */
  StyleClass: 'StyleClass',
  /** Pele's `T.STYLEDEF_STYLEOPTS`. */
  StyleDefStyleOpts: 'StyleDefStyleOpts',
  /** Pele's `T.WIDTH`. */
  Width: 'Width',
} as const
/** A token kind. */
export type T = (typeof T)[keyof typeof T]

/** The name Mermaid's parser reports for the token, as Pele's `TOKEN_NAMES` lists it. */
export function tName(self: T): string {
  switch (self) {
    case T.AccDescr:
      return 'acc_descr'
    case T.AccDescrMultilineValue:
      return 'acc_descr_multiline_value'
    case T.AccDescrValue:
      return 'acc_descr_value'
    case T.AccTitle:
      return 'acc_title'
    case T.AccTitleValue:
      return 'acc_title_value'
    case T.Arrow:
      return '-->'
    case T.As:
      return 'AS'
    case T.Choice:
      return 'CHOICE'
    case T.Class:
      return 'class'
    case T.ClassDef:
      return 'classDef'
    case T.ClassDefId:
      return 'CLASSDEF_ID'
    case T.ClassDefStyleOpts:
      return 'CLASSDEF_STYLEOPTS'
    case T.ClassEntityIds:
      return 'CLASSENTITY_IDS'
    case T.Click:
      return 'CLICK'
    case T.CompositState:
      return 'COMPOSIT_STATE'
    case T.Concurrent:
      return 'CONCURRENT'
    case T.Default:
      return 'DEFAULT'
    case T.DefaultClassDefId:
      return 'DEFAULT_CLASSDEF_ID'
    case T.Descr:
      return 'DESCR'
    case T.DirectionBt:
      return 'direction_bt'
    case T.DirectionLr:
      return 'direction_lr'
    case T.DirectionRl:
      return 'direction_rl'
    case T.DirectionTb:
      return 'direction_tb'
    case T.EdgeState:
      return 'EDGE_STATE'
    case T.End:
      return '$end'
    case T.Fork:
      return 'FORK'
    case T.HideEmpty:
      return 'HIDE_EMPTY'
    case T.Href:
      return 'HREF'
    case T.Id:
      return 'ID'
    case T.Join:
      return 'JOIN'
    case T.LeftOf:
      return 'left_of'
    case T.Nl:
      return 'NL'
    case T.Note:
      return 'note'
    case T.NoteText:
      return 'NOTE_TEXT'
    case T.RightOf:
      return 'right_of'
    case T.Scale:
      return 'scale'
    case T.Sd:
      return 'SD'
    case T.StateDescr:
      return 'STATE_DESCR'
    case T.String:
      return 'STRING'
    case T.StructStart:
      return 'STRUCT_START'
    case T.StructStop:
      return 'STRUCT_STOP'
    case T.Style:
      return 'style'
    case T.StyleIds:
      return 'STYLE_IDS'
    case T.StyleSeparator:
      return 'STYLE_SEPARATOR'
    case T.StyleClass:
      return 'STYLECLASS'
    case T.StyleDefStyleOpts:
      return 'STYLEDEF_STYLEOPTS'
    case T.Width:
      return 'WIDTH'
    case T.Error:
    case T.Invalid:
      return 'INVALID'
  }
}
