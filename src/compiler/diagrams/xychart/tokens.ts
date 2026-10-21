/** @module XY chart token kinds. Port of Pele's `src/diagrams/xychart/tokens.ts`. */

/** A token kind. The order mirrors Pele's `T` enum. */
export const T = {
  /** After the end of input. */
  End: 'End',
  /** Unrecognized text. */
  Error: 'Error',
  /** Line breaks. */
  Newline: 'Newline',
  /** `title`. */
  Title: 'Title',
  /** `accTitle:`. */
  AccTitle: 'AccTitle',
  /** The text of an accessible title. */
  AccTitleValue: 'AccTitleValue',
  /** `accDescr:`. */
  AccDescr: 'AccDescr',
  /** The text of an accessible description. */
  AccDescrValue: 'AccDescrValue',
  /** The text of a braced accessible description. */
  AccDescrMultilineValue: 'AccDescrMultilineValue',
  /** `xychart` or `xychart-beta`. */
  Xychart: 'Xychart',
  /** `vertical` or `horizontal`. */
  ChartOrientation: 'ChartOrientation',
  /** `x-axis`. */
  XAxis: 'XAxis',
  /** `y-axis`. */
  YAxis: 'YAxis',
  /** `-->` in an axis range. */
  ArrowDelimiter: 'ArrowDelimiter',
  /** `line`. */
  Line: 'Line',
  /** `bar`. */
  Bar: 'Bar',
  /** A number in a range or a series. */
  NumberWithDecimal: 'NumberWithDecimal',
  /** `[`. */
  SquareBracesStart: 'SquareBracesStart',
  /** `]`. */
  SquareBracesEnd: 'SquareBracesEnd',
  /** The text of a string. */
  Str: 'Str',
  /** Letters. */
  Alpha: 'Alpha',
  /** `:`. */
  Colon: 'Colon',
  /** `+`. */
  Plus: 'Plus',
  /** `,`. */
  Comma: 'Comma',
  /** `=`. */
  Equals: 'Equals',
  /** `*`. */
  Mult: 'Mult',
  /** `#`. */
  Brkt: 'Brkt',
  /** `_`. */
  Underscore: 'Underscore',
  /** `.`. */
  Dot: 'Dot',
  /** `&`. */
  Amp: 'Amp',
  /** `-`. */
  Minus: 'Minus',
  /** Digits. */
  Num: 'Num',
  /** `;`. */
  Semi: 'Semi',
  /** The end of input. */
  Eof: 'Eof',
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
    case T.Xychart:
      return 'XYCHART'
    case T.ChartOrientation:
      return 'CHART_ORIENTATION'
    case T.XAxis:
      return 'X_AXIS'
    case T.YAxis:
      return 'Y_AXIS'
    case T.ArrowDelimiter:
      return 'ARROW_DELIMITER'
    case T.Line:
      return 'LINE'
    case T.Bar:
      return 'BAR'
    case T.NumberWithDecimal:
      return 'NUMBER_WITH_DECIMAL'
    case T.SquareBracesStart:
      return 'SQUARE_BRACES_START'
    case T.SquareBracesEnd:
      return 'SQUARE_BRACES_END'
    case T.Str:
      return 'STR'
    case T.Alpha:
      return 'ALPHA'
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
    case T.Semi:
      return 'SEMI'
    case T.Eof:
      return 'EOF'
  }
}
