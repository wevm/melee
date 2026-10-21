/**
 * @module Resolves what the parser read into a model, once the whole diagram is read. Port of
 * Pele's `src/diagrams/usecase/db.ts`, which ports Mermaid's `UsecaseModelBuilder` and its
 * messages.
 */
import type { JsonDoc } from './json.ts'
import { error, locationText } from './lexer.ts'
import {
  type Actor,
  ActorType,
  actorTypeAsStr,
  type ClassDef,
  type JsonNode,
  type Note,
  type Relationship,
  RelationshipType,
  relationshipTypeAsStr,
  Shape,
  type SystemBoundary,
  type UseCase,
  type UsecaseModel,
  usecaseModelDefault,
} from './types.ts'
import { Code, type CompileError } from '../../error.ts'
import { isSpace } from '../../util/chars.ts'

/** Start and end offsets in the source, end exclusive. */
export type Span = [number, number]

/** A label as written, and where. */
export type DraftLabel = {
  /** Whether it is a markdown string. */
  markdown: boolean
  /** Where it is. */
  span: Span
  /** The text. */
  text: string
}

/** An empty label. */
export function draftLabelDefault(): DraftLabel {
  return { markdown: false, span: [0, 0], text: '' }
}

/** A metadata value. */
export type PropValue =
  /** `true` or `false`. */
  | { kind: 'Bool'; _0: boolean }
  /** A word or a string. */
  | { kind: 'Str'; _0: string }

/** A metadata property. Errors about it point at its key. */
export type DraftProperty = {
  /** The key. */
  key: string
  /** Where the key is. */
  keySpan: Span
  /** The value. */
  value: PropValue
}

/** What every mention of an id carries: where it is, and whether the id was made from a label. */
export type Named = {
  /** Whether the id was made from the label. */
  generated: boolean
  /** The id. */
  id: string
  /** The label. */
  label: DraftLabel
  /** Where the id is. */
  span: Span
}

/** An empty mention. */
export function namedDefault(): Named {
  return { generated: false, id: '', label: draftLabelDefault(), span: [0, 0] }
}

/** An actor or use case as one statement declares it. */
export type DraftElement = {
  /** Whether it is an actor. */
  actor: boolean
  /** Its `:::` classes. */
  classes: string[]
  /** Its inline metadata. */
  metadata: DraftProperty[] | undefined
  /** Its id and label. */
  named: Named
  /** The boundary around the statement, by index. */
  parent: number | undefined
  /** Its shape. */
  shape: Shape | undefined
  /** Its stereotype. */
  stereotype: string | undefined
}

/** A system boundary. */
export type DraftBoundary = {
  /** Its `:::` classes. */
  classes: string[]
  /** Its id and title. */
  named: Named
}

/** A JSON node. */
export type DraftJson = {
  /** Its `:::` classes. */
  classes: string[]
  /** Its id. */
  id: string
  /** Where its id is. */
  span: Span
  /** Its value. */
  value: JsonDoc
}

/** One end of a relationship. */
export type DraftEndpoint = {
  /** Whether it carries a `:::` suffix. */
  classed: boolean
  /** Whether this mention declares the element. */
  declares: boolean
  /** Its id and label. */
  named: Named
}

/** A relationship. */
export type DraftRelationship = {
  /** One of the arrow types. */
  arrowType: number
  /** The id the author gave it, and where. */
  id: [string, Span] | undefined
  /** Its label. */
  label: DraftLabel | undefined
  /** The least number of ranks between its ends. */
  minlen: number
  /** Its source. */
  source: DraftEndpoint
  /** Where the arrow and target are. */
  span: Span
  /** Its target. */
  target: DraftEndpoint
  /** Its kind. */
  type: RelationshipType
}

/** A note. */
export type DraftNote = {
  /** Its text. */
  label: DraftLabel
  /** Where its target is. */
  span: Span
  /** The id it is about. */
  target: string
}

/** A metadata statement, or a boundary's inline metadata. */
export type DraftMetadata = {
  /** Its properties. */
  properties: DraftProperty[]
  /** Where its target is. */
  span: Span
  /** The id it is about. */
  target: string
}

/** A `class` statement. */
export type DraftClasses = {
  /** The classes. */
  classes: string[]
  /** The ids, and where they are. */
  targets: [string, Span][]
}

/** A `style` statement. */
export type DraftStyle = {
  /** Where the target is. */
  span: Span
  /** The declarations. */
  styles: string[]
  /** The id. */
  target: string
}

/** A `classDef` statement. */
export type DraftClassDef = {
  /** The class names. */
  ids: string[]
  /** The declarations. */
  styles: string[]
}

/** Everything the parser read, in source order, before any of it is resolved. */
export type Drafts = {
  /** The accessible description as written. */
  accDescription: string
  /** The accessible title. */
  accTitle: string
  /** System boundaries. */
  boundaries: DraftBoundary[]
  /** `classDef` statements. */
  classDefs: DraftClassDef[]
  /** `class` statements. */
  classes: DraftClasses[]
  /** The direction, when set. */
  direction: string | undefined
  /** Actor and use case declarations. */
  elements: DraftElement[]
  /** JSON nodes. */
  jsons: DraftJson[]
  /** Metadata statements. */
  metadata: DraftMetadata[]
  /** Notes. */
  notes: DraftNote[]
  /** Relationships. */
  relationships: DraftRelationship[]
  /** `style` statements. */
  styles: DraftStyle[]
}

/** Nothing read yet. */
export function draftsDefault(): Drafts {
  return {
    accDescription: '',
    accTitle: '',
    boundaries: [],
    classDefs: [],
    classes: [],
    direction: undefined,
    elements: [],
    jsons: [],
    metadata: [],
    notes: [],
    relationships: [],
    styles: [],
  }
}

/** What an id names. */
const SymbolKind = {
  /** An actor. */
  Actor: 'Actor',
  /** A system boundary. */
  Boundary: 'Boundary',
  /** A relationship the author named. */
  Edge: 'Edge',
  /** A JSON node. */
  Json: 'Json',
  /** A use case. */
  Usecase: 'Usecase',
} as const
type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind]

/** The kind as Mermaid names it in messages. */
function symbolKindAsStr(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.Actor:
      return 'actor'
    case SymbolKind.Boundary:
      return 'boundary'
    case SymbolKind.Edge:
      return 'edge'
    case SymbolKind.Json:
      return 'json'
    case SymbolKind.Usecase:
      return 'usecase'
  }
}

/** Where an id was first declared. */
type Origin = {
  /** Whether the id was made from a label. */
  generated: boolean
  /** What the id names. */
  kind: SymbolKind
  /** The label a generated id was derived from. */
  label: string | undefined
  /** Where the declaration is. */
  span: Span
}

/** An actor or use case as the statements so far describe it. */
type ElementState = {
  /** Whether it is an actor. */
  actor: boolean
  /** The figure metadata asked for. */
  actorType: ActorType | undefined
  /** Whether metadata made it a business element. */
  business: boolean | undefined
  /** Its `:::` classes. */
  classes: string[]
  /** The icon metadata asked for. */
  icon: string | undefined
  /** Its id and label, as first declared. */
  named: Named
  /** The boundary it is in, by index. */
  parent: number | undefined
  /** Its shape. */
  shape: Shape | undefined
  /** Its stereotype. */
  stereotype: string | undefined
  /** Where its stereotype was declared. */
  stereotypeSpan: Span | undefined
}

/** A system boundary as the statements so far describe it. */
type BoundaryState = {
  /** Its `:::` classes. */
  classes: string[]
  /** The ids of the elements in it. */
  members: string[]
  /** Its id and title. */
  named: Named
  /** Whether metadata made it a package. */
  package: boolean | undefined
}

/**
 * A declaration, by its index among the drafts of its kind. Declarations run in source order,
 * whatever kind they are.
 */
type Declaration =
  /** A system boundary. */
  | { kind: 'Boundary'; _0: number }
  /** A relationship id. */
  | { kind: 'Edge'; _0: number }
  /** An actor or use case. */
  | { kind: 'Element'; _0: number }
  /** A JSON node. */
  | { kind: 'Json'; _0: number }

/** Records in insertion order with an index by id, as Pele's `Map` keeps them. */
type Ordered<V> = {
  /** Positions by id. Only looked up, never iterated. */
  index: Map<string, number>
  /** The records in insertion order. */
  values: V[]
}

/** An empty collection. */
function orderedNew<V>(): Ordered<V> {
  return { index: new Map(), values: [] }
}

/** The position of `id`. */
function orderedPosition<V>(self: Ordered<V>, id: string): number | undefined {
  return self.index.get(id)
}

/** The record for `id`. */
function orderedGetMut<V>(self: Ordered<V>, id: string): V | undefined {
  const at = orderedPosition(self, id)
  return at === undefined ? undefined : self.values[at]
}

/** Adds a record for a new `id`. */
function orderedInsert<V>(self: Ordered<V>, id: string, value: V): void {
  self.index.set(id, self.values.length)
  self.values.push(value)
}

/** Appends each of `values` that `target` lacks. */
function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value)
  }
}

/** Which kind of element the keys of a metadata block could only belong to, for the message. */
function inferKind(properties: DraftProperty[]): string | undefined {
  /** The kinds, in the order Pele adds them to its set. */
  const KINDS = ['actor', 'usecase', 'boundary', 'edge']
  let possible = [true, true, true, true]
  for (const property of properties) {
    const value = property.value.kind === 'Str' ? property.value._0 : undefined
    switch (property.key) {
      case 'icon':
        possible = [true, false, false, false]
        break
      case 'animate':
      case 'animation':
        possible = [false, false, false, true]
        break
      case 'type':
        if (value === 'rect' || value === 'package') possible = [false, false, true, false]
        else if (value === 'normal' || value === 'hollow' || value === 'awesome') {
          possible = [true, false, false, false]
        } else possible = [false, false, false, false]
        break
      case 'business':
        possible[2] = false
        possible[3] = false
        break
      default:
        return undefined
    }
  }
  const kinds = KINDS.filter((_, i) => possible[i])
  return kinds.length === 1 ? kinds[0] : undefined
}

/**
 * `text` with every line break and the whitespace after it turned into one line break, as
 * `replace(/\n\s+/g, '\n')` does.
 */
function dropIndentation(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    i += 1
    out += c
    if (c === '\n') {
      while (i < text.length && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/** A semantic error: `message` at `span`. */
function fail(src: string, message: string, span: Span): CompileError {
  return error(src, Code.Semantic, `${message} at ${locationText(src, span[0], span[1])}`, span[0])
}

/** A semantic error about two declarations, each with the label its id was made from. */
function conflict(
  src: string,
  message: string,
  current: Span,
  previous: Span,
  currentLabel: string | undefined,
  previousLabel: string | undefined,
): CompileError {
  const suffix = (label: string | undefined): string => (label === undefined ? '' : ` (label "${label}")`)
  let text = message
  text += ` at ${locationText(src, current[0], current[1])}`
  text += suffix(currentLabel)
  text += `; previous declaration at ${locationText(src, previous[0], previous[1])}`
  text += suffix(previousLabel)
  return error(src, Code.Semantic, text, current[0])
}

/** `Metadata property '<key>' is invalid for <kind> '<id>'`. */
function invalid(src: string, id: string, kind: string, property: DraftProperty): CompileError {
  return fail(src, `Metadata property '${property.key}' is invalid for ${kind} '${id}'`, property.keySpan)
}

/** A message of literal parts and values. */
function text(parts: string[]): string {
  return parts.join('')
}

/** A copy of `named`, as `Named::clone` makes one. */
function cloneNamed(named: Named): Named {
  return {
    generated: named.generated,
    id: named.id,
    label: { markdown: named.label.markdown, span: [named.label.span[0], named.label.span[1]], text: named.label.text },
    span: [named.span[0], named.span[1]],
  }
}

/**
 * Resolves what the parser read into a model: which ids are actors, use cases, boundaries, JSON
 * nodes, or edges, in what order they appear, and whether the statements about them agree.
 *
 * Throws Mermaid's semantic error for the first statement that disagrees with another.
 */
/**
 * Sorts `items` stably. A list already in order is left as it is, which is what a stable sort
 * gives it.
 */
function stableSort<V>(items: V[], cmp: (a: V, b: V) => number): void {
  for (let i = 1; i < items.length; i++) {
    if (cmp(items[i - 1] as V, items[i] as V) > 0) {
      items.sort(cmp)
      return
    }
  }
}

function byOffsetFirst(a: [number, Declaration], b: [number, Declaration]): number {
  return a[0] - b[0]
}

function byNamedOffset(a: DraftElement, b: DraftElement): number {
  return a.named.span[0] - b.named.span[0]
}

/** Records that `id` is mentioned at `offset`, keeping the earliest. */
function mention(first: Map<string, number>, id: string, offset: number): void {
  const entry = first.get(id)
  if (entry === undefined || offset < entry) first.set(id, offset)
}

/** Records where `named` was declared and as what. */
function register(symbols: Map<string, Origin>, named: Named, kind: SymbolKind): void {
  symbols.set(named.id, {
    generated: named.generated,
    kind,
    label: named.label.text,
    span: named.span,
  })
}

/**
 * An id means one thing in the whole diagram, and an id made from a label may be declared
 * once.
 */
function claim(src: string, symbols: Map<string, Origin>, draft: Named, kind: SymbolKind): void {
  const origin = symbols.get(draft.id)
  if (origin === undefined) return
  const label = draft.generated ? draft.label.text : undefined
  const originLabel = origin.generated ? origin.label : undefined
  if (origin.kind !== kind) {
    throw conflict(
      src,
      text(["ID '", draft.id, "' is declared as both ", symbolKindAsStr(origin.kind), ' and ', symbolKindAsStr(kind)]),
      draft.span,
      origin.span,
      label,
      originLabel,
    )
  }
  if (origin.generated || draft.generated) {
    throw conflict(
      src,
      text(["Generated ID '", draft.id, "' collides with another declaration"]),
      draft.span,
      origin.span,
      label,
      originLabel,
    )
  }
}

function unique(src: string, symbols: Map<string, Origin>, id: string, kind: SymbolKind, span: Span): void {
  const previous = symbols.get(id)
  if (previous !== undefined) {
    throw conflict(
      src,
      text(["ID '", id, "' is declared more than once (", symbolKindAsStr(previous.kind), ' and ', symbolKindAsStr(kind), ')']),
      span,
      previous.span,
      undefined,
      previous.generated ? previous.label : undefined,
    )
  }
  symbols.set(id, { generated: false, kind, label: undefined, span })
}

/** Throws when a declaration's actor metadata disagrees with an earlier one's. */
function actorClash(
  src: string,
  state: ElementState,
  property: DraftProperty,
  replace: boolean,
  previous: boolean,
  same: boolean,
): void {
  if (!replace && previous && !same) {
    throw conflict(
      src,
      text(["Actor '", state.named.id, "' has conflicting ", property.key, ' metadata']),
      property.keySpan,
      state.named.span,
      undefined,
      undefined,
    )
  }
}

/** A metadata statement replaces what a declaration said; two declarations have to agree. */
function elementMetadata(
  src: string,
  state: ElementState,
  properties: DraftProperty[] | undefined,
  replace: boolean,
): void {
  if (properties === undefined) return
  for (let p = 0; p < properties.length; p++) {
    const property = properties[p] as DraftProperty
    const id = state.named.id
    const key = property.key
    if (state.actor) {
      const value = property.value
      if (
        key === 'type' &&
        value.kind === 'Str' &&
        (value._0 === 'normal' || value._0 === 'hollow' || value._0 === 'awesome')
      ) {
        const type =
          value._0 === 'hollow' ? ActorType.Hollow : value._0 === 'awesome' ? ActorType.Awesome : ActorType.Normal
        actorClash(src, state, property, replace, state.actorType !== undefined, state.actorType === type)
        state.actorType = type
      } else if (key === 'icon' && value.kind === 'Str') {
        actorClash(src, state, property, replace, state.icon !== undefined, state.icon === value._0)
        state.icon = value._0
      } else if (key === 'business' && value.kind === 'Bool') {
        actorClash(src, state, property, replace, state.business !== undefined, state.business === value._0)
        state.business = value._0
      } else {
        throw invalid(src, id, 'actor', property)
      }
    } else if (key === 'business' && property.value.kind === 'Bool') {
      const value = property.value._0
      if (!replace && state.business !== undefined && state.business !== value) {
        throw conflict(
          src,
          text(["Use case '", id, "' has conflicting business metadata"]),
          property.keySpan,
          state.named.span,
          undefined,
          undefined,
        )
      }
      state.business = value
    } else {
      throw invalid(src, id, 'usecase', property)
    }
  }
}

/** The boundary drafted at `index`. */
function boundaryNamed(drafts: Drafts, index: number | undefined): Named | undefined {
  return index === undefined ? undefined : drafts.boundaries[index]?.named
}

/** The kind of a relationship's end, which becomes a use case when nothing declares it. */
function endpoint(
  src: string,
  symbols: Map<string, Origin>,
  elements: Ordered<ElementState>,
  first: Map<string, number>,
  end: DraftEndpoint,
): SymbolKind {
  if (end.classed && !end.declares) {
    throw fail(
      src,
      text(["Relationship endpoint '", end.named.id, "' uses ::: without declaring the node"]),
      end.named.span,
    )
  }
  const origin = symbols.get(end.named.id)
  if (origin !== undefined) return origin.kind
  orderedInsert(elements, end.named.id, {
    actor: false,
    actorType: undefined,
    business: undefined,
    classes: [],
    icon: undefined,
    named: cloneNamed(end.named),
    parent: undefined,
    shape: Shape.Ellipse,
    stereotype: undefined,
    stereotypeSpan: undefined,
  })
  register(symbols, end.named, SymbolKind.Usecase)
  mention(first, end.named.id, end.named.span[0])
  return SymbolKind.Usecase
}

/** Throws unless a relationship's end is an actor, a use case, or a JSON node. */
function checkRelated(
  src: string,
  symbols: Map<string, Origin>,
  end: DraftEndpoint,
  kind: SymbolKind,
  role: string,
): void {
  if (kind === SymbolKind.Actor || kind === SymbolKind.Usecase || kind === SymbolKind.Json) return
  throw conflict(
    src,
    text(['Relationship ', role, " '", end.named.id, "' cannot be ", symbolKindAsStr(kind)]),
    end.named.span,
    symbols.get(end.named.id)?.span ?? [0, 0],
    undefined,
    undefined,
  )
}

export function resolveUsecase(src: string, drafts: Drafts, title: string | undefined): UsecaseModel {
  const symbols = new Map<string, Origin>()
  const elements: Ordered<ElementState> = orderedNew()
  const boundaries: Ordered<BoundaryState> = orderedNew()
  // The offset at which each id is first mentioned, which decides the order of the model.
  const first = new Map<string, number>()

  const declarations: [number, Declaration][] = []
  for (const relationship of drafts.relationships) {
    mention(first, relationship.source.named.id, relationship.source.named.span[0])
    mention(first, relationship.target.named.id, relationship.target.named.span[0])
  }
  for (let i = 0; i < drafts.elements.length; i++) {
    const draft = drafts.elements[i] as DraftElement
    mention(first, draft.named.id, draft.named.span[0])
    declarations.push([draft.named.span[0], { kind: 'Element', _0: i }])
  }
  for (let i = 0; i < drafts.boundaries.length; i++) {
    const draft = drafts.boundaries[i] as DraftBoundary
    mention(first, draft.named.id, draft.named.span[0])
    declarations.push([draft.named.span[0], { kind: 'Boundary', _0: i }])
  }
  for (let i = 0; i < drafts.jsons.length; i++) {
    const draft = drafts.jsons[i] as DraftJson
    mention(first, draft.id, draft.span[0])
    declarations.push([draft.span[0], { kind: 'Json', _0: i }])
  }
  for (let i = 0; i < drafts.relationships.length; i++) {
    const relationship = drafts.relationships[i] as DraftRelationship
    if (relationship.id !== undefined) declarations.push([relationship.id[1][0], { kind: 'Edge', _0: i }])
  }
  stableSort(declarations, byOffsetFirst)

  for (const [, declaration] of declarations) {
    switch (declaration.kind) {
      case 'Element': {
        const draft = drafts.elements[declaration._0]
        if (draft === undefined) continue
        const kind = draft.actor ? SymbolKind.Actor : SymbolKind.Usecase
        claim(src, symbols, draft.named, kind)
        const named = boundaryNamed(drafts, draft.parent)
        const parent = named !== undefined && named.id !== '' ? draft.parent : undefined
        const existing = orderedGetMut(elements, draft.named.id)
        if (existing === undefined) {
          const state: ElementState = {
            actor: draft.actor,
            actorType: undefined,
            business: undefined,
            classes: draft.classes.slice(),
            icon: undefined,
            named: cloneNamed(draft.named),
            parent,
            shape: draft.shape,
            stereotype: draft.stereotype,
            stereotypeSpan: draft.stereotype !== undefined ? draft.named.span : undefined,
          }
          elementMetadata(src, state, draft.metadata, false)
          orderedInsert(elements, draft.named.id, state)
          register(symbols, draft.named, kind)
          continue
        }
        const id = draft.named.id
        if (
          existing.named.label.text !== draft.named.label.text ||
          existing.named.label.markdown !== draft.named.label.markdown
        ) {
          throw conflict(
            src,
            text(["ID '", id, "' has conflicting labels"]),
            draft.named.span,
            existing.named.span,
            undefined,
            undefined,
          )
        }
        if (draft.shape !== undefined && existing.shape !== undefined && draft.shape !== existing.shape) {
          throw conflict(
            src,
            text(["Use case '", id, "' has conflicting shapes"]),
            draft.named.span,
            existing.named.span,
            undefined,
            undefined,
          )
        }
        // A boundary whose title makes an empty id is no parent, but it still takes the place
        // of one.
        const parentNamed = boundaryNamed(drafts, parent)
        const own = boundaryNamed(drafts, existing.parent)
        if (parentNamed !== undefined && own !== undefined && own.id !== '' && parentNamed.id !== own.id) {
          throw conflict(
            src,
            text(["Element '", id, "' belongs to more than one system boundary"]),
            parentNamed.span,
            own.span,
            undefined,
            undefined,
          )
        }
        if (
          draft.stereotype !== undefined &&
          existing.stereotype !== undefined &&
          draft.stereotype !== existing.stereotype
        ) {
          throw conflict(
            src,
            text(["Element '", id, "' has conflicting stereotypes"]),
            draft.named.span,
            existing.stereotypeSpan ?? existing.named.span,
            undefined,
            undefined,
          )
        }
        existing.shape = existing.shape ?? draft.shape
        existing.parent = existing.parent ?? draft.parent
        if (existing.stereotype === undefined) existing.stereotype = draft.stereotype
        if (existing.stereotypeSpan === undefined) {
          existing.stereotypeSpan = draft.stereotype !== undefined ? draft.named.span : undefined
        }
        pushUnique(existing.classes, draft.classes)
        elementMetadata(src, existing, draft.metadata, false)
        break
      }
      case 'Boundary': {
        const draft = drafts.boundaries[declaration._0]
        if (draft === undefined) continue
        claim(src, symbols, draft.named, SymbolKind.Boundary)
        const existing = orderedGetMut(boundaries, draft.named.id)
        if (existing !== undefined) {
          if (
            existing.named.label.text !== draft.named.label.text ||
            existing.named.label.markdown !== draft.named.label.markdown
          ) {
            throw conflict(
              src,
              text(["Boundary '", draft.named.id, "' has conflicting titles"]),
              draft.named.span,
              existing.named.span,
              undefined,
              undefined,
            )
          }
          pushUnique(existing.classes, draft.classes)
          continue
        }
        orderedInsert(boundaries, draft.named.id, {
          classes: draft.classes.slice(),
          members: [],
          named: cloneNamed(draft.named),
          package: undefined,
        })
        register(symbols, draft.named, SymbolKind.Boundary)
        break
      }
      case 'Json': {
        const draft = drafts.jsons[declaration._0]
        if (draft !== undefined) unique(src, symbols, draft.id, SymbolKind.Json, draft.span)
        break
      }
      case 'Edge': {
        const found = drafts.relationships[declaration._0]?.id
        if (found !== undefined) unique(src, symbols, found[0], SymbolKind.Edge, found[1])
        break
      }
    }
  }

  // An end of a relationship that nothing declares becomes a use case.
  const relationships: Relationship[] = []
  const edges = new Map<string, number>()
  let anonymous = 0
  for (const draft of drafts.relationships) {
    const sourceKind = endpoint(src, symbols, elements, first, draft.source)
    const targetKind = endpoint(src, symbols, elements, first, draft.target)
    checkRelated(src, symbols, draft.source, sourceKind, 'source')
    checkRelated(src, symbols, draft.target, targetKind, 'target')
    const type = draft.type
    if (
      (type === RelationshipType.Include || type === RelationshipType.Extend) &&
      (sourceKind !== SymbolKind.Usecase || targetKind !== SymbolKind.Usecase)
    ) {
      throw fail(src, text([relationshipTypeAsStr(type), ' relationship requires use-case endpoints']), draft.span)
    }
    if (type === RelationshipType.Generalization && (sourceKind === SymbolKind.Json || sourceKind !== targetKind)) {
      throw fail(src, 'Generalization requires actor-to-actor or use-case-to-use-case endpoints', draft.span)
    }
    if (
      type === RelationshipType.Association &&
      (sourceKind === SymbolKind.Json || targetKind === SymbolKind.Json) &&
      draft.arrowType > 2
    ) {
      throw fail(
        src,
        text([
          "JSON relationship '",
          draft.source.named.id,
          "' to '",
          draft.target.named.id,
          "' permits only point, reversed-point, or markerless solid association",
        ]),
        draft.span,
      )
    }
    let id: string
    if (draft.id !== undefined) {
      id = draft.id[0]
    } else {
      id = `edge-${anonymous}`
      anonymous += 1
    }
    edges.set(id, relationships.length)
    relationships.push({
      animate: false,
      animation: undefined,
      arrowType: draft.arrowType,
      classes: [],
      explicitId: draft.id !== undefined,
      id,
      label: draft.label === undefined ? undefined : [draft.label.text, draft.label.markdown],
      minlen: draft.minlen,
      source: draft.source.named.id,
      styles: [],
      target: draft.target.named.id,
      type,
    })
  }

  for (const metadata of drafts.metadata) {
    const target = metadata.target
    const origin = symbols.get(target)
    if (origin === undefined) {
      let message = text(["Metadata target '", target, "' is unresolved"])
      const kind = inferKind(metadata.properties)
      if (kind !== undefined) message += ` (metadata implies ${kind})`
      throw fail(src, message, metadata.span)
    }
    const kind = origin.kind
    if (kind === SymbolKind.Actor || kind === SymbolKind.Usecase) {
      const state = orderedGetMut(elements, target)
      if (state !== undefined) elementMetadata(src, state, metadata.properties, true)
      continue
    }
    const edge = edges.get(target)
    for (const property of metadata.properties) {
      const key = property.key
      const value = property.value
      if (
        kind === SymbolKind.Boundary &&
        key === 'type' &&
        value.kind === 'Str' &&
        (value._0 === 'rect' || value._0 === 'package') &&
        orderedPosition(boundaries, target) !== undefined
      ) {
        const boundary = orderedGetMut(boundaries, target)
        if (boundary !== undefined) boundary.package = value._0 === 'package'
      } else if (kind === SymbolKind.Edge && key === 'animate' && value.kind === 'Bool' && edge !== undefined) {
        const found = relationships[edge]
        if (found !== undefined) found.animate = value._0
      } else if (
        kind === SymbolKind.Edge &&
        key === 'animation' &&
        value.kind === 'Str' &&
        edge !== undefined &&
        (value._0 === 'fast' || value._0 === 'slow')
      ) {
        const found = relationships[edge]
        if (found !== undefined) {
          found.animation = value._0 === 'fast' ? 'fast' : 'slow'
          found.animate = true
        }
      } else {
        throw invalid(src, target, symbolKindAsStr(kind), property)
      }
    }
  }
  for (const relationship of relationships) {
    if (relationship.animation !== undefined) relationship.animate = true
  }

  for (const state of elements.values) {
    const id = state.named.id
    const icon = state.icon !== undefined && state.icon !== ''
    if (state.actor) {
      if (state.actorType !== undefined && icon && state.actorType !== ActorType.Normal) {
        throw fail(
          src,
          text(["Actor '", id, "' cannot combine icon with type '", actorTypeAsStr(state.actorType), "'"]),
          state.named.span,
        )
      }
      if (state.business === true && (icon || state.actorType === ActorType.Awesome)) {
        throw fail(src, text(["Business actor '", id, "' must use normal or hollow geometry"]), state.named.span)
      }
    } else if (state.shape === Shape.Rect && state.business === true) {
      throw fail(src, text(["Rectangular use case '", id, "' cannot be a business use case"]), state.named.span)
    }
  }

  const byOffset = drafts.elements.slice()
  stableSort(byOffset, byNamedOffset)
  for (const draft of byOffset) {
    const parent = boundaryNamed(drafts, draft.parent)
    if (parent === undefined || parent.id === '') continue
    const boundary = orderedGetMut(boundaries, parent.id)
    if (boundary !== undefined && !boundary.members.includes(draft.named.id)) {
      boundary.members.push(draft.named.id)
    }
  }

  const order = (id: string): number => first.get(id) ?? 0
  const byOrder = (a: { named: Named }, b: { named: Named }): number => order(a.named.id) - order(b.named.id)
  const model = usecaseModelDefault()
  model.accDescr = dropIndentation(drafts.accDescription)
  model.direction = drafts.direction ?? 'LR'
  model.title = title

  const states = elements.values.slice()
  stableSort(states, byOrder)
  for (const state of states) {
    const named = state.named
    const parentNamed = boundaryNamed(drafts, state.parent)
    const parentId = parentNamed !== undefined && parentNamed.id !== '' ? parentNamed.id : undefined
    const stereotype = state.stereotype !== undefined && state.stereotype !== '' ? state.stereotype : undefined
    if (state.actor) {
      const icon = state.icon !== undefined && state.icon !== '' ? state.icon : undefined
      model.actors.push({
        business: state.business ?? false,
        classes: state.classes.slice(),
        type: icon !== undefined ? ActorType.Icon : (state.actorType ?? ActorType.Normal),
        icon,
        id: named.id,
        label: named.label.text,
        markdown: named.label.markdown,
        parentId,
        stereotype,
        styles: [],
      })
    } else {
      model.useCases.push({
        business: state.business ?? false,
        classes: state.classes.slice(),
        id: named.id,
        label: named.label.text,
        markdown: named.label.markdown,
        parentId,
        shape: state.shape ?? Shape.Ellipse,
        stereotype,
        styles: [],
      })
    }
  }

  const ordered = boundaries.values.slice()
  stableSort(ordered, byOrder)
  for (const state of ordered) {
    model.systemBoundaries.push({
      classes: state.classes.slice(),
      id: state.named.id,
      label: state.named.label.text,
      markdown: state.named.label.markdown,
      members: state.members.slice(),
      package: state.package === true,
      styles: [],
    })
  }

  const jsons = drafts.jsons.slice()
  stableSort(jsons, (a, b) => order(a.id) - order(b.id))
  for (const draft of jsons) {
    model.jsonNodes.push({
      classes: draft.classes.slice(),
      id: draft.id,
      styles: [],
      value: draft.value,
    })
  }

  for (let count = 0; count < drafts.notes.length; count++) {
    const draft = drafts.notes[count] as DraftNote
    const origin = symbols.get(draft.target)
    if (origin === undefined) {
      throw fail(src, text(["Note target '", draft.target, "' is unresolved"]), draft.span)
    }
    if (origin.kind !== SymbolKind.Actor && origin.kind !== SymbolKind.Usecase) {
      throw conflict(
        src,
        text(["Note target '", draft.target, "' must be an actor or use case, not ", symbolKindAsStr(origin.kind)]),
        draft.span,
        origin.span,
        undefined,
        undefined,
      )
    }
    model.notes.push({
      id: `note-${count}`,
      label: draft.label.text,
      markdown: draft.label.markdown,
      target: draft.target,
    })
  }

  for (const definition of drafts.classDefs) {
    for (const id of definition.ids) {
      const styles = definition.styles.slice()
      const own = model.classDefs.find((c) => c.id === id)
      if (own !== undefined) own.styles = styles
      else model.classDefs.push({ id, styles })
    }
  }

  model.relationships = relationships
  for (const assignment of drafts.classes) {
    for (const [id, span] of assignment.targets) {
      const [classes] = target(model, symbols, edges, src, id, span)
      pushUnique(classes, assignment.classes)
    }
  }
  for (const assignment of drafts.styles) {
    const [, styles] = target(model, symbols, edges, src, assignment.target, assignment.span)
    styles.push(...assignment.styles)
  }

  model.accTitle = drafts.accTitle
  model.accDescription = drafts.accDescription
  return model
}

/**
 * The classes and styles of `id`, wherever it lives in the model. An id no symbol names may
 * still be an anonymous edge.
 */
function target(
  model: UsecaseModel,
  symbols: Map<string, Origin>,
  edges: Map<string, number>,
  src: string,
  id: string,
  span: Span,
): [string[], string[]] {
  let found: { classes: string[]; styles: string[] } | undefined
  switch (symbols.get(id)?.kind) {
    case SymbolKind.Actor:
      found = model.actors.find((actor) => actor.id === id)
      break
    case SymbolKind.Usecase:
      found = model.useCases.find((useCase) => useCase.id === id)
      break
    case SymbolKind.Boundary:
      found = model.systemBoundaries.find((boundary) => boundary.id === id)
      break
    case SymbolKind.Json:
      found = model.jsonNodes.find((json) => json.id === id)
      break
    default: {
      const at = edges.get(id)
      found = at === undefined ? undefined : model.relationships[at]
    }
  }
  if (found === undefined) {
    throw fail(src, text(["Class/style target '", id, "' is unresolved or anonymous"]), span)
  }
  return [found.classes, found.styles]
}
