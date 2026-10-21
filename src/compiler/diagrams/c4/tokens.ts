/** @module C4 token kinds. Port of Pele's `src/diagrams/c4/tokens.ts`. */

/**
 * A token kind. The order mirrors Pele's `T` enum, and the parser compares kinds by it, so the
 * derived order is observable.
 */
export const T = {
  /** After the end of input. */
  End: 0,
  /** Unrecognized text. */
  Error: 1,
  /** `direction TB`. */
  DirectionTb: 2,
  /** `direction BT`. */
  DirectionBt: 3,
  /** `direction RL`. */
  DirectionRl: 4,
  /** `direction LR`. */
  DirectionLr: 5,
  /** `title` and its text. */
  Title: 6,
  /** `accDescription` and its text. */
  AccDescription: 7,
  /** `accTitle:`. */
  AccTitle: 8,
  /** The text of an accessible title. */
  AccTitleValue: 9,
  /** `accDescr:`. */
  AccDescr: 10,
  /** The text of an accessible description. */
  AccDescrValue: 11,
  /** The text of a braced accessible description. */
  AccDescrMultilineValue: 12,
  /** Line breaks. */
  Newline: 13,
  /** `C4Context`. */
  C4Context: 14,
  /** `C4Container`. */
  C4Container: 15,
  /** `C4Component`. */
  C4Component: 16,
  /** `C4Dynamic`. */
  C4Dynamic: 17,
  /** `C4Deployment`. */
  C4Deployment: 18,
  /** `Person`. */
  Person: 19,
  /** `Person_Ext`. */
  PersonExt: 20,
  /** `System`. */
  System: 21,
  /** `SystemDb`. */
  SystemDb: 22,
  /** `SystemQueue`. */
  SystemQueue: 23,
  /** `System_Ext`. */
  SystemExt: 24,
  /** `SystemDb_Ext`. */
  SystemExtDb: 25,
  /** `SystemQueue_Ext`. */
  SystemExtQueue: 26,
  /** `Container`. */
  Container: 27,
  /** `ContainerDb`. */
  ContainerDb: 28,
  /** `ContainerQueue`. */
  ContainerQueue: 29,
  /** `Container_Ext`. */
  ContainerExt: 30,
  /** `ContainerDb_Ext`. */
  ContainerExtDb: 31,
  /** `ContainerQueue_Ext`. */
  ContainerExtQueue: 32,
  /** `Component`. */
  Component: 33,
  /** `ComponentDb`. */
  ComponentDb: 34,
  /** `ComponentQueue`. */
  ComponentQueue: 35,
  /** `Component_Ext`. */
  ComponentExt: 36,
  /** `ComponentDb_Ext`. */
  ComponentExtDb: 37,
  /** `ComponentQueue_Ext`. */
  ComponentExtQueue: 38,
  /** `Enterprise_Boundary`. */
  EnterpriseBoundary: 39,
  /** `System_Boundary`. */
  SystemBoundary: 40,
  /** `Boundary`. */
  Boundary: 41,
  /** `Container_Boundary`. */
  ContainerBoundary: 42,
  /** `Deployment_Node` or `Node`. */
  Node: 43,
  /** `Node_L`. */
  NodeL: 44,
  /** `Node_R`. */
  NodeR: 45,
  /** `Rel`. */
  Rel: 46,
  /** `BiRel`. */
  Birel: 47,
  /** `Rel_Up` or `Rel_U`. */
  RelU: 48,
  /** `Rel_Down` or `Rel_D`. */
  RelD: 49,
  /** `Rel_Left` or `Rel_L`. */
  RelL: 50,
  /** `Rel_Right` or `Rel_R`. */
  RelR: 51,
  /** `Rel_Back`. */
  RelB: 52,
  /** `RelIndex`. */
  RelIndex: 53,
  /** `UpdateElementStyle`. */
  UpdateElStyle: 54,
  /** `UpdateRelStyle`. */
  UpdateRelStyle: 55,
  /** `UpdateLayoutConfig`. */
  UpdateLayoutConfig: 56,
  /** The end of input inside a statement's name. */
  EofInStruct: 57,
  /** An empty argument. */
  AttributeEmpty: 58,
  /** An argument. */
  Str: 59,
  /** The name of a named argument. */
  StrKey: 60,
  /** The value of a named argument. */
  StrValue: 61,
  /** `{`. */
  Lbrace: 62,
  /** `}`. */
  Rbrace: 63,
  /** The end of input. */
  Eof: 64,
} as const
export type T = (typeof T)[keyof typeof T]

/** The name Mermaid's parser reports, from Pele's `TOKEN_NAMES`, indexed by kind. */
const NAMES: readonly string[] = [
  '$end',
  'INVALID',
  'direction_tb',
  'direction_bt',
  'direction_rl',
  'direction_lr',
  'title',
  'accDescription',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'NEWLINE',
  'C4_CONTEXT',
  'C4_CONTAINER',
  'C4_COMPONENT',
  'C4_DYNAMIC',
  'C4_DEPLOYMENT',
  'PERSON',
  'PERSON_EXT',
  'SYSTEM',
  'SYSTEM_DB',
  'SYSTEM_QUEUE',
  'SYSTEM_EXT',
  'SYSTEM_EXT_DB',
  'SYSTEM_EXT_QUEUE',
  'CONTAINER',
  'CONTAINER_DB',
  'CONTAINER_QUEUE',
  'CONTAINER_EXT',
  'CONTAINER_EXT_DB',
  'CONTAINER_EXT_QUEUE',
  'COMPONENT',
  'COMPONENT_DB',
  'COMPONENT_QUEUE',
  'COMPONENT_EXT',
  'COMPONENT_EXT_DB',
  'COMPONENT_EXT_QUEUE',
  'ENTERPRISE_BOUNDARY',
  'SYSTEM_BOUNDARY',
  'BOUNDARY',
  'CONTAINER_BOUNDARY',
  'NODE',
  'NODE_L',
  'NODE_R',
  'REL',
  'BIREL',
  'REL_U',
  'REL_D',
  'REL_L',
  'REL_R',
  'REL_B',
  'REL_INDEX',
  'UPDATE_EL_STYLE',
  'UPDATE_REL_STYLE',
  'UPDATE_LAYOUT_CONFIG',
  'EOF_IN_STRUCT',
  'ATTRIBUTE_EMPTY',
  'STR',
  'STR_KEY',
  'STR_VALUE',
  'LBRACE',
  'RBRACE',
  'EOF',
]

/** The name Mermaid's parser reports, from Pele's `TOKEN_NAMES`. */
export function tName(t: T): string {
  return NAMES[t] as string
}

/** The token of each keyword, as Pele's `KEYWORDS` maps it. */
const KEYWORDS: ReadonlyMap<string, T> = new Map<string, T>([
  ['C4Context', T.C4Context],
  ['C4Container', T.C4Container],
  ['C4Component', T.C4Component],
  ['C4Dynamic', T.C4Dynamic],
  ['C4Deployment', T.C4Deployment],
  ['Person', T.Person],
  ['Person_Ext', T.PersonExt],
  ['System', T.System],
  ['SystemDb', T.SystemDb],
  ['SystemQueue', T.SystemQueue],
  ['System_Ext', T.SystemExt],
  ['SystemDb_Ext', T.SystemExtDb],
  ['SystemQueue_Ext', T.SystemExtQueue],
  ['Container', T.Container],
  ['ContainerDb', T.ContainerDb],
  ['ContainerQueue', T.ContainerQueue],
  ['Container_Ext', T.ContainerExt],
  ['ContainerDb_Ext', T.ContainerExtDb],
  ['ContainerQueue_Ext', T.ContainerExtQueue],
  ['Component', T.Component],
  ['ComponentDb', T.ComponentDb],
  ['ComponentQueue', T.ComponentQueue],
  ['Component_Ext', T.ComponentExt],
  ['ComponentDb_Ext', T.ComponentExtDb],
  ['ComponentQueue_Ext', T.ComponentExtQueue],
  ['Enterprise_Boundary', T.EnterpriseBoundary],
  ['System_Boundary', T.SystemBoundary],
  ['Boundary', T.Boundary],
  ['Container_Boundary', T.ContainerBoundary],
  ['Deployment_Node', T.Node],
  ['Node', T.Node],
  ['Node_L', T.NodeL],
  ['Node_R', T.NodeR],
  ['Rel', T.Rel],
  ['BiRel', T.Birel],
  ['Rel_Up', T.RelU],
  ['Rel_U', T.RelU],
  ['Rel_Down', T.RelD],
  ['Rel_D', T.RelD],
  ['Rel_Left', T.RelL],
  ['Rel_L', T.RelL],
  ['Rel_Right', T.RelR],
  ['Rel_R', T.RelR],
  ['Rel_Back', T.RelB],
  ['RelIndex', T.RelIndex],
  ['UpdateElementStyle', T.UpdateElStyle],
  ['UpdateRelStyle', T.UpdateRelStyle],
  ['UpdateLayoutConfig', T.UpdateLayoutConfig],
])

/** The token of a keyword, as Pele's `KEYWORDS` maps it. */
export function tKeyword(word: string): T | undefined {
  return KEYWORDS.get(word)
}
