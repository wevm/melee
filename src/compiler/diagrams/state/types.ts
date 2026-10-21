/**
 * @module The statements of a state diagram document and the model built from them. Port of Pele's
 * `src/diagrams/state/types.ts`.
 */

/** A state's description: one text, or a title followed by more lines. */
export type Description =
  /** Several texts. */
  | { kind: 'Many'; _0: string[] }
  /** One text. */
  | { kind: 'One'; _0: string }

/** Whether JavaScript reads the value as true: a non-empty string, or any array. */
export function descriptionTruthy(self: Description): boolean {
  switch (self.kind) {
    case 'Many':
      return true
    case 'One':
      return self._0 !== ''
  }
}

/** The texts, as `[value].flat()` lists them. */
export function descriptionTexts(self: Description): string[] {
  switch (self.kind) {
    case 'Many':
      return self._0
    case 'One':
      return [self._0]
  }
}

/**
 * The body of a composite state. Rust wraps the statements in a newtype so that dropping a deeply
 * nested document cannot overflow the call stack; JavaScript needs no wrapper.
 */
export type Doc = Stmt[]

/** A note beside a state. */
export type StateNote = {
  /** `left of` or `right of`, as written. */
  position: string | undefined
  /** The note text. */
  text: string
}

/**
 * Pele's `StateStmt`: a state as a statement declares it, or as the model records it. Absent
 * fields are the ones JavaScript leaves `undefined`.
 */
export type StateStmt = {
  /** Class names applied to the state. */
  classes: string[] | undefined
  /** The description as written. */
  description: Description | undefined
  /** The descriptions the model collected. */
  descriptions: string[] | undefined
  /**
   * The body of a composite state. A state the model records keeps none: the model records
   * which root statement's body it is instead.
   */
  doc: Doc | undefined
  /** The state id. */
  id: string
  /** A note beside the state. */
  note: StateNote | undefined
  /** For `[*]`: whether it starts (rather than ends) its document. */
  start: boolean | undefined
  /** Inline styles. */
  styles: string[] | undefined
  /** Text styles. */
  textStyles: string[] | undefined
  /** `default`, `fork`, `join`, `choice`, or `divider`. */
  type: string | undefined
}

/** `StateStmt::default()`. */
export function stateStmtDefault(): StateStmt {
  return {
    classes: undefined,
    description: undefined,
    descriptions: undefined,
    doc: undefined,
    id: '',
    note: undefined,
    start: undefined,
    styles: undefined,
    textStyles: undefined,
    type: undefined,
  }
}

/** Pele's `RelationStmt`: a transition. */
export type RelationStmt = {
  /** The transition label. */
  description: string | undefined
  /** The state the transition leaves. */
  state1: StateStmt
  /** The state the transition reaches. */
  state2: StateStmt
}

/**
 * A statement of a document. Mermaid's grammar also leaves the text of statements that have no
 * effect in a document (`hide empty description`, `scale`, a floating note); those are `Text`.
 */
export type Stmt =
  /** `class ids name`. */
  | {
      kind: 'ApplyClass'
      /** The ids, comma-separated. */
      id: string
      /** The class name. */
      styleClass: string
    }
  /** `classDef id styles`. */
  | {
      kind: 'ClassDef'
      /** The style declarations. */
      classes: string
      /** The class name. */
      id: string
    }
  /** `click id ...`. */
  | {
      kind: 'Click'
      /** The state clicked. */
      id: StateStmt
      /** The tooltip, quotes included. */
      tooltip: string
      /** The target, quotes included. */
      url: string
    }
  /** `direction XX`. */
  | { kind: 'Dir'; _0: string }
  /** A transition. */
  | { kind: 'Relation'; _0: RelationStmt }
  /** A state declaration. */
  | { kind: 'State'; _0: StateStmt }
  /** `style ids styles`. */
  | {
      kind: 'Style'
      /** The ids, comma-separated. */
      id: string
      /** The style declarations. */
      styleClass: string
    }
  /** Text left by a statement with no effect. */
  | { kind: 'Text'; _0: string }

/** Pele's `StateRelation`. */
export type StateRelation = {
  /** The state the transition leaves. */
  id1: string
  /** The state the transition reaches. */
  id2: string
  /** The transition label. */
  relationTitle: string
}

/** Pele's `StateClassDef`. */
export type StateClassDef = {
  /** The class name. */
  id: string
  /** The style declarations. */
  styles: string[]
  /** The declarations that style text. */
  textStyles: string[]
}

/** Pele's `StateLink`. */
export type StateLink = {
  /** The tooltip, quotes included. */
  tooltip: string
  /** The target, quotes included. */
  url: string
}
