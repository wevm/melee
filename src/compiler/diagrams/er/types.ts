/** @module The records of an ER diagram. Port of Pele's `src/diagrams/er/types.ts`. */

/** An entity's attribute. */
export type ErAttribute = {
  /** The comment, or empty. */
  comment: string
  /** Keys such as `PK`. */
  keys: string[]
  /** The name. */
  name: string
  /** The type. */
  type: string
}

/** `ErAttribute::default()`. */
export function erAttributeDefault(): ErAttribute {
  return { comment: '', keys: [], name: '', type: '' }
}

/** An entity. */
export type ErEntity = {
  /** The shown name in brackets, or empty. */
  alias: string
  /** Attributes in authored order. */
  attributes: ErAttribute[]
  /** Class names, starting with `default`, separated by spaces. */
  cssClasses: string
  /** Style declarations from `style` statements. */
  cssStyles: string[]
  /** `entity-`, the name, `-`, and the position among the entities. */
  id: string
  /** The name. */
  label: string
}

/** A cardinality, as Mermaid names it. */
export const Cardinality = {
  /** `MD_PARENT`. */
  MdParent: 'MdParent',
  /** `ONE_OR_MORE`. */
  OneOrMore: 'OneOrMore',
  /** `ONLY_ONE`. */
  OnlyOne: 'OnlyOne',
  /** `ZERO_OR_MORE`. */
  ZeroOrMore: 'ZeroOrMore',
  /** `ZERO_OR_ONE`. */
  ZeroOrOne: 'ZeroOrOne',
} as const

/** A cardinality, as Mermaid names it. */
export type Cardinality = (typeof Cardinality)[keyof typeof Cardinality]

/** Mermaid's name. */
export function cardinalityAsStr(self: Cardinality): string {
  switch (self) {
    case Cardinality.MdParent:
      return 'MD_PARENT'
    case Cardinality.OneOrMore:
      return 'ONE_OR_MORE'
    case Cardinality.OnlyOne:
      return 'ONLY_ONE'
    case Cardinality.ZeroOrMore:
      return 'ZERO_OR_MORE'
    case Cardinality.ZeroOrOne:
      return 'ZERO_OR_ONE'
  }
}

/** The lower-case name, which names the marker drawn for it. */
export function cardinalityMarker(self: Cardinality): string {
  switch (self) {
    case Cardinality.MdParent:
      return 'md_parent'
    case Cardinality.OneOrMore:
      return 'one_or_more'
    case Cardinality.OnlyOne:
      return 'only_one'
    case Cardinality.ZeroOrMore:
      return 'zero_or_more'
    case Cardinality.ZeroOrOne:
      return 'zero_or_one'
  }
}

/**
 * The cardinalities and identification of a relationship. `cardB` sits at entity A's end of the
 * line and `cardA` at entity B's, as in Mermaid.
 */
export type RelSpec = {
  /** The cardinality at entity B's end. */
  cardA: Cardinality
  /** The cardinality at entity A's end. */
  cardB: Cardinality
  /** Whether the relationship is identifying. */
  identifying: boolean
}

/**
 * A relationship. The ends hold an entity's id, or a subgraph's id when the name was a subgraph
 * at the time.
 */
export type ErRelationship = {
  /** The first end. */
  entityA: string
  /** The second end. */
  entityB: string
  /** The cardinalities and identification. */
  relSpec: RelSpec
  /** The label. */
  roleA: string
}

/** A class definition from `classDef`. */
export type ErClassDef = {
  /** The class name. */
  id: string
  /** Its declarations. */
  styles: string[]
  /** Its declarations that mention a color, with `fill` read as `bgFill`. */
  textStyles: string[]
}

/** `ErClassDef::default()`. */
export function erClassDefDefault(): ErClassDef {
  return { id: '', styles: [], textStyles: [] }
}

/** A subgraph. */
export type ErSubgraph = {
  /** Class names from `class` statements. */
  classes: string[]
  /** Style declarations from `style` statements. */
  cssStyles: string[]
  /** The direction inside, when set. */
  dir: string | undefined
  /** The id. */
  id: string
  /** The names it holds that no earlier subgraph claimed. */
  nodes: string[]
  /** The shown title. */
  title: string
}

/** An item of a subgraph's statement list, as Mermaid's grammar hands it over. */
export type DocItem =
  /** A `direction` statement. */
  | { kind: 'Dir'; _0: string }
  /** Any other statement's value. */
  | { kind: 'Name'; _0: string }
