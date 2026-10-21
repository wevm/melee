/** @module Quadrant chart token kinds. Port of Pele's `src/diagrams/quadrant/tokens.ts`. */

/** A token kind. The order mirrors Pele's `T` enum. */
export const T = {
  /** After the end of input. */
  End: 0,
  /** Unrecognized text. */
  Error: 1,
  /** Line breaks. */
  Newline: 2,
  /** `title`. */
  Title: 3,
  /** The text of a title. */
  TitleValue: 4,
  /** `accTitle:`. */
  AccTitle: 5,
  /** The text of an accessible title. */
  AccTitleValue: 6,
  /** `accDescr:`. */
  AccDescr: 7,
  /** The text of an accessible description. */
  AccDescrValue: 8,
  /** The text of a braced accessible description. */
  AccDescrMultilineValue: 9,
  /** `x-axis`. */
  XAxis: 10,
  /** `y-axis`. */
  YAxis: 11,
  /** `-->` between axis texts. */
  Delimiter: 12,
  /** `quadrant-1`. */
  Quadrant1: 13,
  /** `quadrant-2`. */
  Quadrant2: 14,
  /** `quadrant-3`. */
  Quadrant3: 15,
  /** `quadrant-4`. */
  Quadrant4: 16,
  /** `classDef`. */
  Classdef: 17,
  /** The text of a markdown string. */
  MdStr: 18,
  /** The text of a string. */
  Str: 19,
  /** A class name after `:::`. */
  ClassName: 20,
  /** `: [` before a point. */
  PointStart: 21,
  /** A point's x. */
  PointX: 22,
  /** A point's y. */
  PointY: 23,
  /** `quadrantChart`. */
  Quadrant: 24,
  /** Letters. */
  Alpha: 25,
  /** Non-ASCII text. */
  UnicodeText: 26,
  /** `:`. */
  Colon: 27,
  /** `+`. */
  Plus: 28,
  /** `,`. */
  Comma: 29,
  /** `=`. */
  Equals: 30,
  /** `*`. */
  Mult: 31,
  /** `#`. */
  Brkt: 32,
  /** `_`. */
  Underscore: 33,
  /** `.`. */
  Dot: 34,
  /** `&`. */
  Amp: 35,
  /** `-`. */
  Minus: 36,
  /** Digits. */
  Num: 37,
  /** A space or tab. */
  Space: 38,
  /** `;`. */
  Semi: 39,
  /** Other punctuation. */
  Punctuation: 40,
  /** The end of input. */
  Eof: 41,
} as const

/** A token kind. */
export type T = (typeof T)[keyof typeof T]

/** The name Mermaid's parser reports, from Pele's `TOKEN_NAMES`. */
export function tName(t: T): string {
  switch (t) {
    case T.End:
      return '$end'
    case T.Error:
      return 'INVALID'
    case T.Newline:
      return 'NEWLINE'
    case T.Title:
      return 'title'
    case T.TitleValue:
      return 'title_value'
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
    case T.XAxis:
      return 'X-AXIS'
    case T.YAxis:
      return 'Y-AXIS'
    case T.Delimiter:
      return 'AXIS-TEXT-DELIMITER'
    case T.Quadrant1:
      return 'QUADRANT_1'
    case T.Quadrant2:
      return 'QUADRANT_2'
    case T.Quadrant3:
      return 'QUADRANT_3'
    case T.Quadrant4:
      return 'QUADRANT_4'
    case T.Classdef:
      return 'CLASSDEF'
    case T.MdStr:
      return 'MD_STR'
    case T.Str:
      return 'STR'
    case T.ClassName:
      return 'class_name'
    case T.PointStart:
      return 'point_start'
    case T.PointX:
      return 'point_x'
    case T.PointY:
      return 'point_y'
    case T.Quadrant:
      return 'QUADRANT'
    case T.Alpha:
      return 'ALPHA'
    case T.UnicodeText:
      return 'UNICODE_TEXT'
    case T.Colon:
      return 'COLON'
    case T.Plus:
      return 'PLUS'
    case T.Comma:
      return 'COMMA'
    case T.Equals:
      return 'EQUALS'
    case T.Mult:
      return 'MULT'
    case T.Brkt:
      return 'BRKT'
    case T.Underscore:
      return 'UNDERSCORE'
    case T.Dot:
      return 'DOT'
    case T.Amp:
      return 'AMP'
    case T.Minus:
      return 'MINUS'
    case T.Num:
      return 'NUM'
    case T.Space:
      return 'SPACE'
    case T.Semi:
      return 'SEMI'
    case T.Punctuation:
      return 'PUNCTUATION'
    case T.Eof:
      return 'EOF'
  }
}
