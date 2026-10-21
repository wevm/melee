/** @module The sequence diagram token kinds. Port of Pele's `src/diagrams/sequence/tokens.ts`. */

/** A token kind, in the order of Pele's `T` enum, numbered in that order. */
export const T = {
  /** `$end` in Mermaid's grammar. */
  Eof: 0,
  /** `INVALID` in Mermaid's grammar. */
  Error: 1,
  /** `INVALID` in Mermaid's grammar. */
  Invalid: 2,
  /** `NEWLINE` in Mermaid's grammar. */
  Newline: 3,
  /** `SD` in Mermaid's grammar. */
  Sd: 4,
  /** `create` in Mermaid's grammar. */
  Create: 5,
  /** `box` in Mermaid's grammar. */
  Box: 6,
  /** `restOfLine` in Mermaid's grammar. */
  RestOfLine: 7,
  /** `end` in Mermaid's grammar. */
  End: 8,
  /** `autonumber` in Mermaid's grammar. */
  Autonumber: 9,
  /** `NUM` in Mermaid's grammar. */
  Num: 10,
  /** `off` in Mermaid's grammar. */
  Off: 11,
  /** `activate` in Mermaid's grammar. */
  Activate: 12,
  /** `deactivate` in Mermaid's grammar. */
  Deactivate: 13,
  /** `title` in Mermaid's grammar. */
  Title: 14,
  /** `legacy_title` in Mermaid's grammar. */
  LegacyTitle: 15,
  /** `acc_title` in Mermaid's grammar. */
  AccTitle: 16,
  /** `acc_title_value` in Mermaid's grammar. */
  AccTitleValue: 17,
  /** `acc_descr` in Mermaid's grammar. */
  AccDescr: 18,
  /** `acc_descr_value` in Mermaid's grammar. */
  AccDescrValue: 19,
  /** `acc_descr_multiline_value` in Mermaid's grammar. */
  AccDescrMultilineValue: 20,
  /** `loop` in Mermaid's grammar. */
  Loop: 21,
  /** `rect` in Mermaid's grammar. */
  Rect: 22,
  /** `opt` in Mermaid's grammar. */
  Opt: 23,
  /** `alt` in Mermaid's grammar. */
  Alt: 24,
  /** `par` in Mermaid's grammar. */
  Par: 25,
  /** `par_over` in Mermaid's grammar. */
  ParOver: 26,
  /** `critical` in Mermaid's grammar. */
  Critical: 27,
  /** `break` in Mermaid's grammar. */
  Break: 28,
  /** `option` in Mermaid's grammar. */
  Option: 29,
  /** `and` in Mermaid's grammar. */
  And: 30,
  /** `else` in Mermaid's grammar. */
  Else: 31,
  /** `participant` in Mermaid's grammar. */
  Participant: 32,
  /** `AS` in Mermaid's grammar. */
  As: 33,
  /** `participant_actor` in Mermaid's grammar. */
  ParticipantActor: 34,
  /** `destroy` in Mermaid's grammar. */
  Destroy: 35,
  /** `note` in Mermaid's grammar. */
  Note: 36,
  /** `over` in Mermaid's grammar. */
  Over: 37,
  /** `links` in Mermaid's grammar. */
  Links: 38,
  /** `link` in Mermaid's grammar. */
  Link: 39,
  /** `properties` in Mermaid's grammar. */
  Properties: 40,
  /** `details` in Mermaid's grammar. */
  Details: 41,
  /** `,` in Mermaid's grammar. */
  Comma: 42,
  /** `left_of` in Mermaid's grammar. */
  LeftOf: 43,
  /** `right_of` in Mermaid's grammar. */
  RightOf: 44,
  /** `+` in Mermaid's grammar. */
  Plus: 45,
  /** `-` in Mermaid's grammar. */
  Minus: 46,
  /** `()` in Mermaid's grammar. */
  Central: 47,
  /** `ACTOR` in Mermaid's grammar. */
  Actor: 48,
  /** `CONFIG_START` in Mermaid's grammar. */
  ConfigStart: 49,
  /** `CONFIG_CONTENT` in Mermaid's grammar. */
  ConfigContent: 50,
  /** `CONFIG_END` in Mermaid's grammar. */
  ConfigEnd: 51,
  /** `TXT` in Mermaid's grammar. */
  Txt: 52,
  /** `SOLID_OPEN_ARROW` in Mermaid's grammar. */
  SolidOpenArrow: 53,
  /** `DOTTED_OPEN_ARROW` in Mermaid's grammar. */
  DottedOpenArrow: 54,
  /** `SOLID_ARROW` in Mermaid's grammar. */
  SolidArrow: 55,
  /** `BIDIRECTIONAL_SOLID_ARROW` in Mermaid's grammar. */
  BidirectionalSolidArrow: 56,
  /** `DOTTED_ARROW` in Mermaid's grammar. */
  DottedArrow: 57,
  /** `BIDIRECTIONAL_DOTTED_ARROW` in Mermaid's grammar. */
  BidirectionalDottedArrow: 58,
  /** `SOLID_CROSS` in Mermaid's grammar. */
  SolidCross: 59,
  /** `DOTTED_CROSS` in Mermaid's grammar. */
  DottedCross: 60,
  /** `SOLID_POINT` in Mermaid's grammar. */
  SolidPoint: 61,
  /** `DOTTED_POINT` in Mermaid's grammar. */
  DottedPoint: 62,
  /** `SOLID_ARROW_TOP` in Mermaid's grammar. */
  SolidArrowTop: 63,
  /** `SOLID_ARROW_BOTTOM` in Mermaid's grammar. */
  SolidArrowBottom: 64,
  /** `STICK_ARROW_TOP` in Mermaid's grammar. */
  StickArrowTop: 65,
  /** `STICK_ARROW_BOTTOM` in Mermaid's grammar. */
  StickArrowBottom: 66,
  /** `SOLID_ARROW_TOP_DOTTED` in Mermaid's grammar. */
  SolidArrowTopDotted: 67,
  /** `SOLID_ARROW_BOTTOM_DOTTED` in Mermaid's grammar. */
  SolidArrowBottomDotted: 68,
  /** `STICK_ARROW_TOP_DOTTED` in Mermaid's grammar. */
  StickArrowTopDotted: 69,
  /** `STICK_ARROW_BOTTOM_DOTTED` in Mermaid's grammar. */
  StickArrowBottomDotted: 70,
  /** `SOLID_ARROW_TOP_REVERSE` in Mermaid's grammar. */
  SolidArrowTopReverse: 71,
  /** `SOLID_ARROW_BOTTOM_REVERSE` in Mermaid's grammar. */
  SolidArrowBottomReverse: 72,
  /** `STICK_ARROW_TOP_REVERSE` in Mermaid's grammar. */
  StickArrowTopReverse: 73,
  /** `STICK_ARROW_BOTTOM_REVERSE` in Mermaid's grammar. */
  StickArrowBottomReverse: 74,
  /** `SOLID_ARROW_TOP_REVERSE_DOTTED` in Mermaid's grammar. */
  SolidArrowTopReverseDotted: 75,
  /** `SOLID_ARROW_BOTTOM_REVERSE_DOTTED` in Mermaid's grammar. */
  SolidArrowBottomReverseDotted: 76,
  /** `STICK_ARROW_TOP_REVERSE_DOTTED` in Mermaid's grammar. */
  StickArrowTopReverseDotted: 77,
  /** `STICK_ARROW_BOTTOM_REVERSE_DOTTED` in Mermaid's grammar. */
  StickArrowBottomReverseDotted: 78,
} as const

/** A token kind, in the order of Pele's `T` enum, numbered in that order. */
export type T = (typeof T)[keyof typeof T]

/** The name Mermaid's grammar gives the token, for error messages. */
export function tName(self: T): string {
  switch (self) {
    case T.Eof:
      return '$end'
    case T.Error:
    case T.Invalid:
      return 'INVALID'
    case T.Newline:
      return 'NEWLINE'
    case T.Sd:
      return 'SD'
    case T.Create:
      return 'create'
    case T.Box:
      return 'box'
    case T.RestOfLine:
      return 'restOfLine'
    case T.End:
      return 'end'
    case T.Autonumber:
      return 'autonumber'
    case T.Num:
      return 'NUM'
    case T.Off:
      return 'off'
    case T.Activate:
      return 'activate'
    case T.Deactivate:
      return 'deactivate'
    case T.Title:
      return 'title'
    case T.LegacyTitle:
      return 'legacy_title'
    case T.AccTitle:
      return 'acc_title'
    case T.AccTitleValue:
      return 'acc_title_value'
    case T.AccDescr:
      return 'acc_descr'
    case T.AccDescrValue:
      return 'acc_descr_value'
    case T.AccDescrMultilineValue:
      return 'acc_descr_multiline_value'
    case T.Loop:
      return 'loop'
    case T.Rect:
      return 'rect'
    case T.Opt:
      return 'opt'
    case T.Alt:
      return 'alt'
    case T.Par:
      return 'par'
    case T.ParOver:
      return 'par_over'
    case T.Critical:
      return 'critical'
    case T.Break:
      return 'break'
    case T.Option:
      return 'option'
    case T.And:
      return 'and'
    case T.Else:
      return 'else'
    case T.Participant:
      return 'participant'
    case T.As:
      return 'AS'
    case T.ParticipantActor:
      return 'participant_actor'
    case T.Destroy:
      return 'destroy'
    case T.Note:
      return 'note'
    case T.Over:
      return 'over'
    case T.Links:
      return 'links'
    case T.Link:
      return 'link'
    case T.Properties:
      return 'properties'
    case T.Details:
      return 'details'
    case T.Comma:
      return ','
    case T.LeftOf:
      return 'left_of'
    case T.RightOf:
      return 'right_of'
    case T.Plus:
      return '+'
    case T.Minus:
      return '-'
    case T.Central:
      return '()'
    case T.Actor:
      return 'ACTOR'
    case T.ConfigStart:
      return 'CONFIG_START'
    case T.ConfigContent:
      return 'CONFIG_CONTENT'
    case T.ConfigEnd:
      return 'CONFIG_END'
    case T.Txt:
      return 'TXT'
    case T.SolidOpenArrow:
      return 'SOLID_OPEN_ARROW'
    case T.DottedOpenArrow:
      return 'DOTTED_OPEN_ARROW'
    case T.SolidArrow:
      return 'SOLID_ARROW'
    case T.BidirectionalSolidArrow:
      return 'BIDIRECTIONAL_SOLID_ARROW'
    case T.DottedArrow:
      return 'DOTTED_ARROW'
    case T.BidirectionalDottedArrow:
      return 'BIDIRECTIONAL_DOTTED_ARROW'
    case T.SolidCross:
      return 'SOLID_CROSS'
    case T.DottedCross:
      return 'DOTTED_CROSS'
    case T.SolidPoint:
      return 'SOLID_POINT'
    case T.DottedPoint:
      return 'DOTTED_POINT'
    case T.SolidArrowTop:
      return 'SOLID_ARROW_TOP'
    case T.SolidArrowBottom:
      return 'SOLID_ARROW_BOTTOM'
    case T.StickArrowTop:
      return 'STICK_ARROW_TOP'
    case T.StickArrowBottom:
      return 'STICK_ARROW_BOTTOM'
    case T.SolidArrowTopDotted:
      return 'SOLID_ARROW_TOP_DOTTED'
    case T.SolidArrowBottomDotted:
      return 'SOLID_ARROW_BOTTOM_DOTTED'
    case T.StickArrowTopDotted:
      return 'STICK_ARROW_TOP_DOTTED'
    case T.StickArrowBottomDotted:
      return 'STICK_ARROW_BOTTOM_DOTTED'
    case T.SolidArrowTopReverse:
      return 'SOLID_ARROW_TOP_REVERSE'
    case T.SolidArrowBottomReverse:
      return 'SOLID_ARROW_BOTTOM_REVERSE'
    case T.StickArrowTopReverse:
      return 'STICK_ARROW_TOP_REVERSE'
    case T.StickArrowBottomReverse:
      return 'STICK_ARROW_BOTTOM_REVERSE'
    case T.SolidArrowTopReverseDotted:
      return 'SOLID_ARROW_TOP_REVERSE_DOTTED'
    case T.SolidArrowBottomReverseDotted:
      return 'SOLID_ARROW_BOTTOM_REVERSE_DOTTED'
    case T.StickArrowTopReverseDotted:
      return 'STICK_ARROW_TOP_REVERSE_DOTTED'
    case T.StickArrowBottomReverseDotted:
      return 'STICK_ARROW_BOTTOM_REVERSE_DOTTED'
  }
}
