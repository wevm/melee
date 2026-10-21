/** @module The records of a requirement diagram. Port of Pele's `src/diagrams/requirement/types.ts`. */

/** A requirement. */
export type Requirement = {
  /** Class names, starting with `default`. */
  classes: string[]
  /** Style declarations from `style` statements and classes. */
  cssStyles: string[]
  /** The requirement's name. */
  name: string
  /** The `id` field. */
  requirementId: string
  /** The `risk` field. */
  risk: string
  /** The `text` field. */
  text: string
  /** Its kind, such as `Functional Requirement`. */
  type: string
  /** The `verifymethod` field. */
  verifyMethod: string
}

/** `Requirement::default()`. */
export function requirementDefault(): Requirement {
  return { classes: [], cssStyles: [], name: '', requirementId: '', risk: '', text: '', type: '', verifyMethod: '' }
}

/** An element. */
export type RequirementElement = {
  /** Class names, starting with `default`. */
  classes: string[]
  /** Style declarations from `style` statements and classes. */
  cssStyles: string[]
  /** The `docref` field. */
  docRef: string
  /** The element's name. */
  name: string
  /** The `type` field. */
  type: string
}

/** `RequirementElement::default()`. */
export function requirementElementDefault(): RequirementElement {
  return { classes: [], cssStyles: [], docRef: '', name: '', type: '' }
}

/** A relationship between two names. */
export type Relation = {
  /** The destination name. */
  dst: string
  /** The source name. */
  src: string
  /** The relationship, such as `contains`. */
  type: string
}

/** A class from `classDef`. */
export type RequirementClass = {
  /** The class name. */
  id: string
  /** Its declarations. */
  styles: string[]
  /** Its declarations that mention a color, with `fill` read as `bgFill`. */
  textStyles: string[]
}

/** `RequirementClass::default()`. */
export function requirementClassDefault(): RequirementClass {
  return { id: '', styles: [], textStyles: [] }
}
