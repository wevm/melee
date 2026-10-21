/** @module The C4 diagram model. Port of Pele's `src/diagrams/c4/types.ts`. */

/** A `$key="value"` argument. */
export type C4Named = {
  /** The name after `$`. */
  key: string
  /** The quoted value. */
  value: string
}

/** An argument of a statement: positional text or a named argument. */
export type C4Attr =
  /** A `$key="value"` argument. */
  | { kind: 'Named'; _0: C4Named }
  /** A positional argument, trimmed. */
  | { kind: 'Text'; _0: string }

/**
 * A shape or boundary. Pele's `C4Shape` and `C4Boundary` share this record: `kind` is set on
 * shapes and `nodeType` on deployment nodes.
 */
export type C4Element = {
  /** The alias, or empty when a named argument was written in its place. */
  alias: string
  /** A named argument written where the alias belongs. It is applied to the field it names. */
  aliasAttr: C4Named | undefined
  /** `$bgColor`. */
  bgColor: string | undefined
  /** `$borderColor`. */
  borderColor: string | undefined
  /** The description. */
  descr: string | undefined
  /** Named arguments that set no known field, in the order they were first set. */
  extra: [string, string][] | undefined
  /** `$fontColor`. */
  fontColor: string | undefined
  /**
   * Mermaid's typeC4Shape of a shape: person, `external_system_db`, `container_queue` and so
   * on. Empty on a boundary.
   */
  kind: string
  /** The label. */
  label: string
  /** A named argument written where the label belongs. It is applied to the field it names. */
  labelAttr: C4Named | undefined
  /** `$legendSprite`. */
  legendSprite: string | undefined
  /** `$legendText`. */
  legendText: string | undefined
  /** The link. */
  link: string | undefined
  /** Set on deployment nodes: `node`, `nodeL` or `nodeR`. */
  nodeType: string | undefined
  /** The index of the boundary it was declared in. */
  parent: number | undefined
  /** `$shadowing`. */
  shadowing: string | undefined
  /** `$shape`. */
  shape: string | undefined
  /** The sprite. */
  sprite: string | undefined
  /** The tags. */
  tags: string | undefined
  /** The technology. */
  techn: string | undefined
  /** The type of a boundary. */
  type: string | undefined
}

/** `C4Element::default()`. */
export function c4ElementDefault(): C4Element {
  return {
    alias: '',
    aliasAttr: undefined,
    bgColor: undefined,
    borderColor: undefined,
    descr: undefined,
    extra: undefined,
    fontColor: undefined,
    kind: '',
    label: '',
    labelAttr: undefined,
    legendSprite: undefined,
    legendText: undefined,
    link: undefined,
    nodeType: undefined,
    parent: undefined,
    shadowing: undefined,
    shape: undefined,
    sprite: undefined,
    tags: undefined,
    techn: undefined,
    type: undefined,
  }
}

/** A relation between two shapes or boundaries. */
export type C4Rel = {
  /** The description. */
  descr: string | undefined
  /** Named arguments that set no known field, in the order they were first set. */
  extra: [string, string][] | undefined
  /** The alias it starts at, or empty when a named argument was written in its place. */
  from: string
  /** A named argument written where the start belongs. */
  fromAttr: C4Named | undefined
  /** The label. */
  label: string
  /** A named argument written where the label belongs. It is applied to the field it names. */
  labelAttr: C4Named | undefined
  /** `$lineColor`. */
  lineColor: string | undefined
  /** The link. */
  link: string | undefined
  /** How far the label moves right, as JavaScript's `parseInt` read it. */
  offsetX: number | undefined
  /** How far the label moves down, as JavaScript's `parseInt` read it. */
  offsetY: number | undefined
  /** The sprite. */
  sprite: string | undefined
  /** The tags. */
  tags: string | undefined
  /** The technology. */
  techn: string | undefined
  /** `$textColor`. */
  textColor: string | undefined
  /** The alias it ends at, or empty when a named argument was written in its place. */
  to: string
  /** A named argument written where the end belongs. */
  toAttr: C4Named | undefined
  /** `rel`, `birel`, `rel_u`, `rel_d`, `rel_l`, `rel_r` or `rel_b`. */
  type: string
}

/** `C4Rel::default()`. */
export function c4RelDefault(): C4Rel {
  return {
    descr: undefined,
    extra: undefined,
    from: '',
    fromAttr: undefined,
    label: '',
    labelAttr: undefined,
    lineColor: undefined,
    link: undefined,
    offsetX: undefined,
    offsetY: undefined,
    sprite: undefined,
    tags: undefined,
    techn: undefined,
    textColor: undefined,
    to: '',
    toAttr: undefined,
    type: '',
  }
}
