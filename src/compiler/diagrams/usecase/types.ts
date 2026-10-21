/**
 * @module The use case model. Port of Pele's `src/diagrams/usecase/types.ts`.
 *
 * Pele also records each statement's source positions for Mermaid's syntax tree. Nothing Ondine
 * draws reads them, so they are left out.
 */
import type { JsonDoc } from './json.ts'

/** The kind of an actor's figure. */
export const ActorType = {
  /** A filled figure. */
  Awesome: 'Awesome',
  /** A hollow figure. */
  Hollow: 'Hollow',
  /** An icon in a box. */
  Icon: 'Icon',
  /** A stick figure. */
  Normal: 'Normal',
} as const
export type ActorType = (typeof ActorType)[keyof typeof ActorType]

/** The type as Pele names it. */
export function actorTypeAsStr(value: ActorType): string {
  switch (value) {
    case ActorType.Awesome:
      return 'awesome'
    case ActorType.Hollow:
      return 'hollow'
    case ActorType.Icon:
      return 'icon'
    case ActorType.Normal:
      return 'normal'
  }
}

/** The outline of a use case. */
export const Shape = {
  /** An ellipse. */
  Ellipse: 'Ellipse',
  /** A rectangle. */
  Rect: 'Rect',
} as const
export type Shape = (typeof Shape)[keyof typeof Shape]

/** The shape as Pele names it. */
export function shapeAsStr(value: Shape): string {
  return value === Shape.Ellipse ? 'ellipse' : 'rect'
}

/** An actor. */
export type Actor = {
  /** Whether it is a business actor. */
  business: boolean
  /** Its classes. */
  classes: string[]
  /** The icon of an `icon` actor. */
  icon: string | undefined
  /** Its id. */
  id: string
  /** Its label. */
  label: string
  /** Whether the label is markdown. */
  markdown: boolean
  /** The boundary it is in. */
  parentId: string | undefined
  /** Its stereotype. */
  stereotype: string | undefined
  /** Its inline styles. */
  styles: string[]
  /** Its figure. */
  type: ActorType
}

/** A use case. */
export type UseCase = {
  /** Whether it is a business use case. */
  business: boolean
  /** Its classes. */
  classes: string[]
  /** Its id. */
  id: string
  /** Its label. */
  label: string
  /** Whether the label is markdown. */
  markdown: boolean
  /** The boundary it is in. */
  parentId: string | undefined
  /** Its outline. */
  shape: Shape
  /** Its stereotype. */
  stereotype: string | undefined
  /** Its inline styles. */
  styles: string[]
}

/** A system boundary. */
export type SystemBoundary = {
  /** Its classes. */
  classes: string[]
  /** Its id. */
  id: string
  /** Its title. */
  label: string
  /** Whether the title is markdown. */
  markdown: boolean
  /** The ids of the elements in it. */
  members: string[]
  /** Whether it is drawn as a package rather than a rectangle. */
  package: boolean
  /** Its inline styles. */
  styles: string[]
}

/** The kind of a relationship. */
export const RelationshipType = {
  /** A plain line between two ends. */
  Association: 'Association',
  /** `..> : extend`. */
  Extend: 'Extend',
  /** `--|>`. */
  Generalization: 'Generalization',
  /** `..> : include`. */
  Include: 'Include',
} as const
export type RelationshipType = (typeof RelationshipType)[keyof typeof RelationshipType]

/** The type as Pele names it. */
export function relationshipTypeAsStr(value: RelationshipType): string {
  switch (value) {
    case RelationshipType.Association:
      return 'association'
    case RelationshipType.Extend:
      return 'extend'
    case RelationshipType.Generalization:
      return 'generalization'
    case RelationshipType.Include:
      return 'include'
  }
}

/** Arrow types, in the order of Pele's `Arrow` enum, whose values the model keeps. */
export const arrow = {
  /** An arrowhead at the target. */
  SOLID_ARROW: 0,
  /** An arrowhead at the source. */
  BACK_ARROW: 1,
  /** No arrowheads. */
  LINE_SOLID: 2,
  /** A circle at the target. */
  CIRCLE_ARROW: 3,
  /** A cross at the target. */
  CROSS_ARROW: 4,
  /** A circle at the source. */
  CIRCLE_ARROW_REVERSED: 5,
  /** A cross at the source. */
  CROSS_ARROW_REVERSED: 6,
} as const

/** A relationship between two elements. */
export type Relationship = {
  /** Whether it is drawn animated. */
  animate: boolean
  /** `fast` or `slow`. */
  animation: string | undefined
  /** One of [`arrow`]. */
  arrowType: number
  /** Its classes. */
  classes: string[]
  /** Whether the author named it. */
  explicitId: boolean
  /** Its id. */
  id: string
  /** Its label and whether the label is markdown. */
  label: [string, boolean] | undefined
  /** The least number of ranks between its ends. */
  minlen: number
  /** The source id. */
  source: string
  /** Its inline styles. */
  styles: string[]
  /** The target id. */
  target: string
  /** Its kind. */
  type: RelationshipType
}

/** A note about an actor or use case. */
export type Note = {
  /** Its id. */
  id: string
  /** Its text. */
  label: string
  /** Whether the text is markdown. */
  markdown: boolean
  /** The id it is about. */
  target: string
}

/** A JSON node. */
export type JsonNode = {
  /** Its classes. */
  classes: string[]
  /** Its id. */
  id: string
  /** Its inline styles. */
  styles: string[]
  /** Its value, with keys in the order they were written. */
  value: JsonDoc
}

/** A class definition. */
export type ClassDef = {
  /** Its name. */
  id: string
  /** Its style declarations. */
  styles: string[]
}

/** A parsed use case diagram: Pele's `UsecaseModel`. Collections keep Pele's `Map` order. */
export type UsecaseModel = {
  /** The accessible description, its lines' indentation dropped. */
  accDescr: string
  /** The accessible description as written. */
  accDescription: string
  /** The accessible title. */
  accTitle: string
  /** Actors. */
  actors: Actor[]
  /** Class definitions. */
  classDefs: ClassDef[]
  /** `TB`, `BT`, `LR`, or `RL`. */
  direction: string
  /** JSON nodes. */
  jsonNodes: JsonNode[]
  /** Notes. */
  notes: Note[]
  /** Relationships in source order. */
  relationships: Relationship[]
  /** System boundaries. */
  systemBoundaries: SystemBoundary[]
  /** The front matter title. */
  title: string | undefined
  /** Use cases. */
  useCases: UseCase[]
}

/** An empty model, as `UsecaseModel::default()` builds it. */
export function usecaseModelDefault(): UsecaseModel {
  return {
    accDescr: '',
    accDescription: '',
    accTitle: '',
    actors: [],
    classDefs: [],
    direction: '',
    jsonNodes: [],
    notes: [],
    relationships: [],
    systemBoundaries: [],
    title: undefined,
    useCases: [],
  }
}
