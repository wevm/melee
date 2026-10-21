/**
 * @module Token kinds of the block lexer and the names Mermaid's parser reports for them. Port of
 * Pele's `src/diagrams/block/tokens.ts`.
 */

/** A token kind, in the order of Pele's `T` enum. */
export const T = {
  /** End of input, after `Eof`. */
  End: 0,
  /** Unrecognized text. */
  Error: 1,
  /** `block-beta` or `block`. */
  Key: 2,
  /** `block:`, which opens a composite with an id. */
  IdBlock: 3,
  /** `columns n` or `columns auto`. */
  Columns: 4,
  /** Markdown string text. */
  MdStr: 5,
  /** String text. */
  Str: 6,
  /** `space` or `space:n`. */
  SpaceBlock: 7,
  /** `default`. */
  Default: 8,
  /** `linkStyle`. */
  LinkStyle: 9,
  /** `interpolate`. */
  Interpolate: 10,
  /** `classDef`. */
  ClassDef: 11,
  /** `DEFAULT` after `classDef`. */
  DefaultClassDefId: 12,
  /** A class name after `classDef`. */
  ClassDefId: 13,
  /** The styles of a `classDef`. */
  ClassDefStyleOpts: 14,
  /** `class`. */
  Class: 15,
  /** The ids of a `class` statement. */
  ClassEntityIds: 16,
  /** The class name of a `class` statement. */
  StyleClass: 17,
  /** `style`. */
  Style: 18,
  /** The ids of a `style` statement. */
  StyleEntityIds: 19,
  /** The declarations of a `style` statement. */
  StyleDefinitionData: 20,
  /** `accTitle:`. */
  AccTitle: 21,
  /** The text of an `accTitle`. */
  AccTitleValue: 22,
  /** `accDescr:`. */
  AccDescr: 23,
  /** The text of an `accDescr`. */
  AccDescrValue: 24,
  /** The text of an `accDescr { }`. */
  AccDescrMultilineValue: 25,
  /** `end`. */
  EndKeyword: 26,
  /** The opening of a node shape. */
  NodeDStart: 27,
  /** The closing of a node shape. */
  NodeDEnd: 28,
  /** `<[`. */
  BlockArrowStart: 29,
  /** `]>(...)`. */
  BlockArrowEnd: 30,
  /** A direction of a block arrow. */
  Dir: 31,
  /** A node id. */
  NodeId: 32,
  /** A link. */
  Link: 33,
  /** The start of a link with a label. */
  StartLink: 34,
  /** The quote before a link label. */
  LinkLabel: 35,
  /** `:n` after a node. */
  Size: 36,
  /** End of input. */
  Eof: 37,
} as const
/** A token kind. */
export type T = (typeof T)[keyof typeof T]

/** The name Mermaid's parser reports, from Pele's `TOKEN_NAMES`. */
export function tName(value: T): string {
  switch (value) {
    case T.End:
      return '$end'
    case T.Error:
      return 'INVALID'
    case T.Key:
      return 'BLOCK_DIAGRAM_KEY'
    case T.IdBlock:
      return 'id-block'
    case T.Columns:
      return 'COLUMNS'
    case T.MdStr:
      return 'MD_STR'
    case T.Str:
      return 'STR'
    case T.SpaceBlock:
      return 'SPACE_BLOCK'
    case T.Default:
      return 'DEFAULT'
    case T.LinkStyle:
      return 'LINKSTYLE'
    case T.Interpolate:
      return 'INTERPOLATE'
    case T.ClassDef:
      return 'classDef'
    case T.DefaultClassDefId:
      return 'DEFAULT_CLASSDEF_ID'
    case T.ClassDefId:
      return 'CLASSDEF_ID'
    case T.ClassDefStyleOpts:
      return 'CLASSDEF_STYLEOPTS'
    case T.Class:
      return 'class'
    case T.ClassEntityIds:
      return 'CLASSENTITY_IDS'
    case T.StyleClass:
      return 'STYLECLASS'
    case T.Style:
      return 'style'
    case T.StyleEntityIds:
      return 'STYLE_ENTITY_IDS'
    case T.StyleDefinitionData:
      return 'STYLE_DEFINITION_DATA'
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
    case T.EndKeyword:
      return 'end'
    case T.NodeDStart:
      return 'NODE_DSTART'
    case T.NodeDEnd:
      return 'NODE_DEND'
    case T.BlockArrowStart:
      return 'BLOCK_ARROW_START'
    case T.BlockArrowEnd:
      return 'BLOCK_ARROW_END'
    case T.Dir:
      return 'DIR'
    case T.NodeId:
      return 'NODE_ID'
    case T.Link:
      return 'LINK'
    case T.StartLink:
      return 'START_LINK'
    case T.LinkLabel:
      return 'LINK_LABEL'
    case T.Size:
      return 'SIZE'
    case T.Eof:
      return 'EOF'
  }
}
