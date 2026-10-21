/** @module Token types of Mermaid's use case lexer. Port of Pele's `src/diagrams/usecase/tokens.ts`. */

/**
 * Mermaid's token types. The order is observable: it makes the token categories ranges, so WORD
 * is `Usecase` to `Identifier`, and `LABEL_TEXT` is `Usecase` to `LabelSymbol`.
 */
export const T = {
  /** End of input. */
  Eof: 0,
  /** `usecase-beta`. */
  Usecase: 1,
  /** `actor`. */
  Actor: 2,
  /** `systemBoundary`. */
  SystemBoundary: 3,
  /** `end`. */
  End: 4,
  /** `direction`. */
  Direction: 5,
  /** `TD`. */
  Td: 6,
  /** `TB`. */
  Tb: 7,
  /** `BT`. */
  Bt: 8,
  /** `LR`. */
  Lr: 9,
  /** `RL`. */
  Rl: 10,
  /** `note`. */
  Note: 11,
  /** `for`. */
  For: 12,
  /** `json`. */
  Json: 13,
  /** `classDef`. */
  ClassDef: 14,
  /** `class`. */
  Class: 15,
  /** `style`. */
  Style: 16,
  /** `include`, in any case. */
  Include: 17,
  /** `extend`, in any case. */
  Extend: 18,
  /** `true`. */
  True: 19,
  /** `false`. */
  False: 20,
  /** A word. */
  Identifier: 21,
  /** A decimal number with a fraction and an optional unit. */
  Number: 22,
  /** `@`. */
  At: 23,
  /** `,`. */
  Comma: 24,
  /** `:`. */
  Colon: 25,
  /** `#` and hexadecimal digits. */
  HashColor: 26,
  /** A hyphenated word. */
  CssIdentifier: 27,
  /** `\,`. */
  CssEscapedComma: 28,
  /** `-`. */
  Dash: 29,
  /** `.`. */
  Dot: 30,
  /** `%`. */
  Percent: 31,
  /** Punctuation of a style value. */
  CssPunctuation: 32,
  /** Other punctuation. */
  LabelPunctuation: 33,
  /** A run of other characters. */
  LabelSymbol: 34,
  /** A quoted string. */
  PlainString: 35,
  /** A markdown string. */
  MarkdownString: 36,
  /** A markdown string that is never closed. */
  UnclosedMarkdownString: 37,
  /** A `%%` comment. */
  Comment: 38,
  /** A line break. */
  Newline: 39,
  /** `accDescr { ... }`. */
  AccDescrBlock: 40,
  /** `accTitle: ...`. */
  AccTitleLine: 41,
  /** `accDescr: ...`. */
  AccDescrLine: 42,
  /** `json id@`. */
  JsonDeclarationStart: 43,
  /** A JSON object. */
  JsonObjectLiteral: 44,
  /** A JSON object that is never closed. */
  UnclosedJsonObjectLiteral: 45,
  /** `--|>`. */
  Generalization: 46,
  /** `..>`. */
  DependencyArrow: 47,
  /** `<<`. */
  StereotypeStart: 48,
  /** `>>`. */
  StereotypeEnd: 49,
  /** The text of a stereotype. */
  StereotypeText: 50,
  /** The text of a stereotype that is never closed. */
  UnclosedStereotypeText: 51,
  /** `:::`. */
  ClassSeparator: 52,
  /** `-->`. */
  ForwardSolid: 53,
  /** `<--`. */
  BackwardSolid: 54,
  /** `--o`. */
  ForwardCircle: 55,
  /** `o--`. */
  BackwardCircle: 56,
  /** `--x`. */
  ForwardCross: 57,
  /** `x--`. */
  BackwardCross: 58,
  /** `--`. */
  MarkerlessSolid: 59,
  /** `@{`. */
  MetadataStart: 60,
  /** `{`. */
  LBrace: 61,
  /** `}`. */
  RBrace: 62,
  /** `[`. */
  LBracket: 63,
  /** `]`. */
  RBracket: 64,
  /** `(`. */
  LParen: 65,
  /** `)`. */
  RParen: 66,
} as const
export type T = (typeof T)[keyof typeof T]

const NAMES: readonly string[] = [
  'EOF',
  'USECASE',
  'ACTOR',
  'SYSTEM_BOUNDARY',
  'END',
  'DIRECTION',
  'TD',
  'TB',
  'BT',
  'LR',
  'RL',
  'NOTE',
  'FOR',
  'JSON',
  'CLASS_DEF',
  'CLASS',
  'STYLE',
  'INCLUDE',
  'EXTEND',
  'TRUE',
  'FALSE',
  'IDENTIFIER',
  'NUMBER',
  'AT',
  'COMMA',
  'COLON',
  'HASH_COLOR',
  'CSS_IDENTIFIER',
  'CSS_ESCAPED_COMMA',
  'DASH',
  'DOT',
  'PERCENT',
  'CSS_PUNCTUATION',
  'LABEL_PUNCTUATION',
  'LABEL_SYMBOL',
  'PLAIN_STRING',
  'MARKDOWN_STRING',
  'UNCLOSED_MARKDOWN_STRING',
  'COMMENT',
  'NEWLINE',
  'ACC_DESCR_BLOCK',
  'ACC_TITLE_LINE',
  'ACC_DESCR_LINE',
  'JSON_DECLARATION_START',
  'JSON_OBJECT_LITERAL',
  'UNCLOSED_JSON_OBJECT_LITERAL',
  'GENERALIZATION',
  'DEPENDENCY_ARROW',
  'STEREOTYPE_START',
  'STEREOTYPE_END',
  'STEREOTYPE_TEXT',
  'UNCLOSED_STEREOTYPE_TEXT',
  'CLASS_SEPARATOR',
  'FORWARD_SOLID',
  'BACKWARD_SOLID',
  'FORWARD_CIRCLE',
  'BACKWARD_CIRCLE',
  'FORWARD_CROSS',
  'BACKWARD_CROSS',
  'MARKERLESS_SOLID',
  'METADATA_START',
  'LBRACE',
  'RBRACE',
  'LBRACKET',
  'RBRACKET',
  'LPAREN',
  'RPAREN',
]

/** Mermaid's name for `t`, as its errors print it. */
export function name(t: T): string {
  return NAMES[t] ?? ''
}
