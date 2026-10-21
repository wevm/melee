/** @module The records of a class diagram. Port of Pele's `src/diagrams/class/types.ts`. */
import type { ClassMember } from './members.ts'

/** An end of a relation: Mermaid's relation type number, or `none`. */
export type RelationEnd =
  /** No marker. */
  | { kind: 'None' }
  /**
   * Mermaid's relation type: 0 aggregation, 1 extension, 2 composition, 3 dependency,
   * 4 lollipop.
   */
  | { kind: 'Type'; _0: number }

/** Whether two relation ends are equal. */
export function relationEndEq(a: RelationEnd, b: RelationEnd): boolean {
  if (a.kind === 'None') return b.kind === 'None'
  return b.kind === 'Type' && a._0 === b._0
}

/** Mermaid's lollipop relation type. */
export const LOLLIPOP: RelationEnd = { kind: 'Type', _0: 4 }

/** A class. */
export type ClassNode = {
  /** Annotations such as `interface`. */
  annotations: string[]
  /** Class names, starting with `default`, separated by spaces. */
  cssClasses: string
  /** Set when a callback or `click ... call` names the class. */
  haveCallback: boolean
  /** The class name, without its generic type. */
  id: string
  /** The shown name. */
  label: string
  /** The link address. */
  link: string | undefined
  /** The link target, once a link is set. */
  linkTarget: string | undefined
  /** Attributes. */
  members: ClassMember[]
  /** Methods. */
  methods: ClassMember[]
  /** The namespace the class is declared in. */
  parent: string | undefined
  /** Style declarations from `style` statements and class definitions. */
  styles: string[]
  /** The tooltip. */
  tooltip: string | undefined
  /** The generic type, such as `T` for `List~T~`. */
  type: string
}

/** A relation between two classes. */
export type ClassRelation = {
  /** The first class, or the interface standing for a lollipop end. */
  id1: string
  /** The second class, or the interface standing for a lollipop end. */
  id2: string
  /** The line style: 0 solid, 1 dotted. */
  lineType: number
  /** The text at the first end, or `none`. */
  relationTitle1: string
  /** The text at the second end, or `none`. */
  relationTitle2: string
  /** The label. */
  title: string | undefined
  /** The marker at the first end. */
  type1: RelationEnd
  /** The marker at the second end. */
  type2: RelationEnd
}

/** A note, attached to a class or free. */
export type ClassNote = {
  /** The class the note is for, as written. */
  class: string | undefined
  /** `note` followed by the index. */
  id: string
  /** Position among the notes. */
  index: number
  /** The namespace the note is declared in. */
  parent: string | undefined
  /** The text. */
  text: string
}

/** The interface a lollipop end stands for. */
export type ClassInterface = {
  /** The class the lollipop is on. */
  classId: string
  /** `interface` followed by the index. */
  id: string
  /** The shown name. */
  label: string
}

/** A namespace. */
export type NamespaceNode = {
  /** Child namespaces, by id, in insertion order. */
  children: string[]
  /** Classes declared in it, by id, in insertion order. */
  classes: string[]
  /** False for the ancestors created on the way to a dotted name such as `A.B.C`. */
  explicit: boolean
  /** The full dotted name. */
  id: string
  /** The shown name. */
  label: string
  /** Notes declared in it, by id, in insertion order. */
  notes: string[]
  /** The enclosing namespace. */
  parent: string | undefined
}

/** A class definition from `classDef`. */
export type StyleClass = {
  /** The class name. */
  id: string
  /** Its declarations. */
  styles: string[]
  /** Its declarations that mention a color, with `fill` read as `bgFill`. */
  textStyles: string[]
}

export function styleClassDefault(): StyleClass {
  return { id: '', styles: [], textStyles: [] }
}
