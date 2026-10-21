/**
 * @module What a use case diagram draws: every actor, use case, note, JSON table, and boundary as
 * a node with its class styles, and every relationship and note connector as an edge with its
 * markers. Port of Pele's `src/diagrams/usecase/graph.ts`, which ports `getData` from Mermaid's
 * use case DB.
 */
import { type JsonDoc, type JsonValue, jsonDocGet } from './json.ts'
import {
  type ActorType,
  type Relationship,
  RelationshipType,
  Shape,
  type UsecaseModel,
  actorTypeAsStr,
  arrow,
  relationshipTypeAsStr,
  shapeAsStr,
} from './types.ts'
import { trim } from '../../text/label.ts'
import { buf } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'

/** One row of a JSON table. */
export type JsonRow = {
  /** The key path. Blank on the second and later values of an array. */
  key: string
  /** The value. */
  value: string
}

/** What kind of node is drawn. */
export type NodeShape =
  /** An actor's figure. */
  | { kind: 'Actor'; _0: ActorType }
  /** A system boundary. */
  | { kind: 'Boundary' }
  /** A business use case's oval. */
  | { kind: 'Business' }
  /** A use case's oval. */
  | { kind: 'Ellipse' }
  /** A JSON table. */
  | { kind: 'Json' }
  /** A note. */
  | { kind: 'Note' }
  /** A rectangular use case. */
  | { kind: 'Rect' }

/** A node to draw. */
export type GraphNode = {
  /** Whether it is a business actor or use case. */
  business: boolean
  /** Its classes, starting with `default`. */
  cssClasses: string
  /** The declarations its classes give it. */
  cssCompiledStyles: string[]
  /** Its inline styles. */
  cssStyles: string[]
  /** The icon of an `icon` actor. */
  icon: string | undefined
  /** Its id. */
  id: string
  /** The rows of a JSON table. */
  jsonRows: JsonRow[] | undefined
  /** Its label. */
  label: string
  /** Whether the label is markdown. */
  markdown: boolean
  /** Whether a boundary is drawn as a package. */
  package: boolean
  /** Room around its text. */
  padding: number
  /** The boundary it is in. */
  parentId: string | undefined
  /** What is drawn. */
  shape: NodeShape
  /** Its stereotype. */
  stereotype: string | undefined
}

/** An edge to draw. */
export type GraphEdge = {
  /** Whether it is drawn animated. */
  animate: boolean
  /** The marker at its end. */
  arrowEnd: string
  /** The marker at its start. */
  arrowStart: string
  /** Its classes, starting with `default relationship`. */
  classes: string
  /** The declarations its classes give it. */
  cssCompiledStyles: string[]
  /** Whether it is dotted. */
  dotted: boolean
  /** The target id. */
  end: string
  /** Its id. */
  id: string
  /** The dotted line from a note to what it is about. */
  internal: boolean
  /** Its label and whether the label is markdown. */
  label: [string, boolean] | undefined
  /** The least number of ranks between its ends. */
  minlen: number
  /** Its kind, or `note`. */
  relationshipType: string
  /** The source id. */
  start: string
  /** Its inline styles. */
  style: string[]
}

/** The nodes and edges to draw. */
export type UsecaseGraph = {
  /** Edges: relationships, then note connectors. */
  edges: GraphEdge[]
  /** Nodes: actors, use cases, notes, JSON tables, then boundaries. */
  nodes: GraphNode[]
}

/** A JSON scalar as `String(value)` writes it. */
function scalar(value: JsonValue): string {
  switch (value.kind) {
    case 'String':
      return value._0
    case 'Null':
      return 'null'
    case 'Bool':
      return value._0 ? 'true' : 'false'
    case 'Number': {
      const out = buf()
      pushNumber(out, value._0)
      return out.s
    }
    default:
      return ''
  }
}

/**
 * One row for each leaf of a JSON object, depth first in the order the keys were written.
 * Nesting is kept on a stack of its own, so depth is limited by memory and not by the call
 * stack.
 */
export function flattenJsonRows(json: JsonDoc): JsonRow[] {
  const rows: JsonRow[] = []
  const stack: [number, string][] = [[0, '']]
  let children: [number, string][] = []
  for (;;) {
    const top = stack.pop()
    if (top === undefined) break
    const [node, path] = top
    children = []
    const value = jsonDocGet(json, node)
    if (value === undefined) {
      // Nothing to draw.
    } else if (value.kind === 'Array') {
      const items = value._0
      const leaf = (item: number): boolean => {
        const found = jsonDocGet(json, item)
        return !(found !== undefined && (found.kind === 'Array' || found.kind === 'Object'))
      }
      if (items.length === 0) {
        rows.push({ key: path, value: '[]' })
      } else if (items.every(leaf)) {
        items.forEach((item, i) => {
          const found = jsonDocGet(json, item)
          rows.push({ key: i === 0 ? path : '', value: found === undefined ? '' : scalar(found) })
        })
      } else {
        items.forEach((item, i) => {
          children.push([item, `${path}[${i}]`])
        })
      }
    } else if (value.kind === 'Object') {
      const entries = value._0
      if (entries.length === 0) rows.push({ key: path, value: '{}' })
      for (const [key, item] of entries) {
        children.push([item, path === '' ? key : `${path}.${key}`])
      }
    } else {
      rows.push({ key: path, value: scalar(value) })
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as [number, string])
  }
  return rows
}

/** `out` with `name` appended after a space, skipping an empty name. */
function addClass(out: string, name: string): string {
  if (name === '') return out
  return out === '' ? name : `${out} ${name}`
}

/** `head` followed by `names`, joined by spaces, skipping empty ones. */
function classListWith(head: string, names: string[]): string {
  let out = head
  for (let i = 0; i < names.length; i++) out = addClass(out, names[i] as string)
  return out
}

/** The start and end markers of a relationship. */
function markers(relationship: Relationship): [string, string] {
  switch (relationship.type) {
    case RelationshipType.Generalization:
      return ['none', 'extension']
    case RelationshipType.Include:
    case RelationshipType.Extend:
      return ['none', 'arrow_point']
    case RelationshipType.Association:
      switch (relationship.arrowType) {
        case arrow.SOLID_ARROW:
          return ['none', 'arrow_point']
        case arrow.BACK_ARROW:
          return ['arrow_point', 'none']
        case arrow.CIRCLE_ARROW:
          return ['none', 'arrow_circle']
        case arrow.CROSS_ARROW:
          return ['none', 'arrow_cross']
        case arrow.CIRCLE_ARROW_REVERSED:
          return ['arrow_circle', 'none']
        case arrow.CROSS_ARROW_REVERSED:
          return ['arrow_cross', 'none']
        default:
          return ['none', 'none']
      }
  }
}

/** Resolves a parsed use case diagram into what is drawn. */
export function buildUsecaseGraph(model: UsecaseModel): UsecaseGraph {
  // A later class wins a property but keeps the place the property first took.
  const compiled = (classNames: string[]): string[] => {
    if (model.classDefs.length === 0) return []
    const out: [string, string][] = []
    for (const name of ['default', ...classNames]) {
      const definition = model.classDefs.find((own) => own.id === name)
      if (definition === undefined) continue
      for (const raw of definition.styles) {
        const style = trim(raw)
        const colon = style.indexOf(':')
        const property = trim(colon < 0 ? style : style.slice(0, colon))
        if (property === '') continue
        const entry = out.find(([own]) => own === property)
        if (entry !== undefined) entry[1] = style
        else out.push([property, style])
      }
    }
    return out.map(([, style]) => style)
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (const actor of model.actors) {
    const kind = `usecase-actor-${actorTypeAsStr(actor.type)}`
    nodes.push({
      business: actor.business,
      cssClasses: classListWith(
        addClass(addClass('default usecase-actor', kind), actor.business ? 'usecase-business' : ''),
        actor.classes,
      ),
      cssCompiledStyles: compiled(actor.classes),
      cssStyles: actor.styles,
      icon: actor.icon !== undefined && actor.icon !== '' ? actor.icon : undefined,
      id: actor.id,
      jsonRows: undefined,
      label: actor.label,
      markdown: actor.markdown,
      package: false,
      padding: 10,
      parentId: actor.parentId !== undefined && actor.parentId !== '' ? actor.parentId : undefined,
      shape: { kind: 'Actor', _0: actor.type },
      stereotype: actor.stereotype !== undefined && actor.stereotype !== '' ? actor.stereotype : undefined,
    })
  }
  for (const useCase of model.useCases) {
    const ellipse = useCase.shape === Shape.Ellipse
    const kind = `usecase-${shapeAsStr(useCase.shape)}`
    nodes.push({
      business: useCase.business,
      cssClasses: classListWith(
        addClass(addClass('default usecase-element', kind), useCase.business ? 'usecase-business' : ''),
        useCase.classes,
      ),
      cssCompiledStyles: compiled(useCase.classes),
      cssStyles: useCase.styles,
      icon: undefined,
      id: useCase.id,
      jsonRows: undefined,
      label: useCase.label,
      markdown: useCase.markdown,
      package: false,
      padding: ellipse ? 20 : 10,
      parentId: useCase.parentId !== undefined && useCase.parentId !== '' ? useCase.parentId : undefined,
      shape: !ellipse ? { kind: 'Rect' } : useCase.business ? { kind: 'Business' } : { kind: 'Ellipse' },
      stereotype: useCase.stereotype !== undefined && useCase.stereotype !== '' ? useCase.stereotype : undefined,
    })
  }
  for (const note of model.notes) {
    nodes.push({
      business: false,
      cssClasses: 'default usecase-note',
      cssCompiledStyles: compiled([]),
      cssStyles: [],
      icon: undefined,
      id: note.id,
      jsonRows: undefined,
      label: note.label,
      markdown: note.markdown,
      package: false,
      padding: 10,
      parentId: undefined,
      shape: { kind: 'Note' },
      stereotype: undefined,
    })
  }
  for (const json of model.jsonNodes) {
    nodes.push({
      business: false,
      cssClasses: classListWith('default usecase-json-table', json.classes),
      cssCompiledStyles: compiled(json.classes),
      cssStyles: json.styles,
      icon: undefined,
      id: json.id,
      jsonRows: flattenJsonRows(json.value),
      label: json.id,
      markdown: false,
      package: false,
      padding: 10,
      parentId: undefined,
      shape: { kind: 'Json' },
      stereotype: undefined,
    })
  }
  for (const boundary of model.systemBoundaries) {
    nodes.push({
      business: false,
      cssClasses: classListWith(
        boundary.package ? 'default system-boundary system-boundary-package' : 'default system-boundary system-boundary-rect',
        boundary.classes,
      ),
      cssCompiledStyles: compiled(boundary.classes),
      cssStyles: boundary.styles,
      icon: undefined,
      id: boundary.id,
      jsonRows: undefined,
      label: boundary.label,
      markdown: boundary.markdown,
      package: boundary.package,
      padding: 20,
      parentId: undefined,
      shape: { kind: 'Boundary' },
      stereotype: undefined,
    })
  }

  for (const relationship of model.relationships) {
    const semantic =
      relationship.type === RelationshipType.Include || relationship.type === RelationshipType.Extend
    const [arrowStart, arrowEnd] = markers(relationship)
    const animated = relationship.animate || relationship.animation !== undefined
    const kind = `relationship-${relationshipTypeAsStr(relationship.type)}`
    const animation = animated ? `edge-animation-${relationship.animation ?? 'fast'}` : ''
    // Include and extend are labelled with their kind, whatever label the relationship carries.
    let label: [string, boolean] | undefined
    if (semantic) {
      label = [relationshipTypeAsStr(relationship.type), false]
    } else if (relationship.type === RelationshipType.Association) {
      label =
        relationship.label !== undefined && relationship.label[0] !== ''
          ? [relationship.label[0], relationship.label[1]]
          : undefined
    }
    edges.push({
      animate: relationship.animate,
      arrowEnd,
      arrowStart,
      classes: addClass(classListWith(addClass('default relationship', kind), relationship.classes), animation),
      cssCompiledStyles: compiled(relationship.classes),
      dotted: semantic,
      end: relationship.target,
      id: relationship.id,
      internal: false,
      label,
      minlen: relationship.minlen,
      relationshipType: relationshipTypeAsStr(relationship.type),
      start: relationship.source,
      style: relationship.styles,
    })
  }
  for (const note of model.notes) {
    edges.push({
      animate: false,
      arrowEnd: 'none',
      arrowStart: 'none',
      classes: 'default relationship relationship-note',
      cssCompiledStyles: compiled([]),
      dotted: true,
      end: note.target,
      id: `${note.id}-edge`,
      internal: true,
      label: undefined,
      minlen: 1,
      relationshipType: 'note',
      start: note.id,
      style: [],
    })
  }
  return { edges, nodes }
}
