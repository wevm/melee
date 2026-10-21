/**
 * @module Resolves a parsed flowchart into the nodes and edges that are drawn: group membership,
 * collapsed subgraphs, class styles, and edge defaults. Port of Pele's
 * `src/diagrams/flowchart/graph.ts`.
 */
import { type FlowDb, flowDbSubgraph, jsTrim } from './db.ts'
import type { FlowNode, LabelType } from './types.ts'
import { u32 } from '../../error.ts'
import { buf } from '../../util/rust.ts'
import { type Value, valuePushJsString, valueTruthy } from '../../yaml.ts'

/** A node or group to draw. Mirrors Pele's `GraphNode`; fields only variants read are omitted. */
export type GraphNode = {
  /** Height of an image or icon, when set. */
  assetHeight: number | undefined
  /** Width of an image or icon, when set. */
  assetWidth: number | undefined
  /** Space-separated class names. */
  cssClasses: string
  /** Declarations from the node's classes. */
  cssCompiledStyles: string[]
  /** Declarations written on the node itself. */
  cssStyles: string[]
  /** Whether an image keeps its aspect ratio (`on`). */
  constraint: string | undefined
  /** The direction inside a group. */
  dir: string | undefined
  /** Icon name. */
  icon: string | undefined
  /** Node id. */
  id: string
  /** Image address. */
  img: string | undefined
  /** Whether the node is drawn as a group. */
  isGroup: boolean
  /** Label text. */
  label: string | undefined
  /** How the label is written. */
  labelType: LabelType
  /** Link address. */
  link: string | undefined
  /** Link target. */
  linkTarget: string | undefined
  /** The enclosing group's id. */
  parentId: string | undefined
  /** Label position beside an image or icon (`t` or `b`). */
  pos: string | undefined
  /** Shape name. */
  shape: string
  /** Tooltip text. */
  tooltip: string | undefined
}

/** An edge to draw. Mirrors Pele's `GraphEdge`; fields no renderer reads are omitted. */
export type GraphEdge = {
  /** Marker at the head. */
  arrowTypeEnd: string
  /** Marker at the tail. */
  arrowTypeStart: string
  /** Space-separated class names. */
  classes: string
  /** Declarations from the edge's classes. */
  cssCompiledStyles: string[]
  /** Curve name, from the edge, the diagram default, or the config. */
  curve: string | undefined
  /** Head node id. */
  end: string
  /** Edge id. */
  id: string
  /** Label text. */
  label: string
  /** How the label is written. */
  labelType: LabelType
  /** Least rank span. */
  minlen: number | undefined
  /** Tail node id. */
  start: string
  /** Declarations from `linkStyle`, after the defaults. */
  style: string[]
  /** Stroke kind: `normal`, `thick`, `dotted`, or `invisible`. */
  thickness: string | undefined
}

/** The drawn nodes and edges. */
export type FlowGraph = {
  /** Edges in declaration order. */
  edges: GraphEdge[]
  /** Each node's place in `nodes`, by id. Node ids are unique. */
  index: Map<string, number>
  /** Groups (innermost declared last first), then vertices in declaration order. */
  nodes: GraphNode[]
}

/** An empty graph. */
export function flowGraphDefault(): FlowGraph {
  return { edges: [], index: new Map(), nodes: [] }
}

function shapeOf(vertex: FlowNode): string {
  if (vertex.img !== undefined && vertex.img !== '') return 'imageSquare'
  if (vertex.icon !== undefined && vertex.icon !== '') {
    switch (vertex.form) {
      case 'circle':
        return 'iconCircle'
      case 'square':
        return 'iconSquare'
      case 'rounded':
        return 'iconRounded'
      default:
        return 'icon'
    }
  }

  switch (vertex.type) {
    case undefined:
    case 'square':
      return 'squareRect'
    case 'round':
      return 'roundedRect'
    default:
      return vertex.type
  }
}

/** The marker at the tail of an edge of `type`. */
function arrowStart(type: string | undefined): string {
  switch (type) {
    case 'double_arrow_point':
      return 'arrow_point'
    case 'double_arrow_circle':
      return 'arrow_circle'
    case 'double_arrow_cross':
      return 'arrow_cross'
    default:
      return 'none'
  }
}

/** The marker at the head of an edge of `type`. */
function arrowEnd(type: string | undefined): string {
  switch (type) {
    case 'arrow_circle':
    case 'double_arrow_circle':
      return 'arrow_circle'
    case 'arrow_cross':
    case 'double_arrow_cross':
      return 'arrow_cross'
    default:
      return 'arrow_point'
  }
}

function isCollapsed(metadata: [string, Value][] | undefined): boolean {
  if (metadata === undefined) return false
  return metadata.some(([key, value]) => key === 'view' && value.kind === 'String' && value._0 === 'collapsed')
}

/** Builds the drawn graph. `defaultCurve` comes from the `flowchart.curve` config. */
export function build(model: FlowDb, defaultCurve: string | undefined): FlowGraph {
  const subgraphs = model.subgraphs

  // Pele concatenates and trims after each class, so earlier declarations are trimmed again.
  // Class ids are unique, so the index finds the one definition `find` would.
  const compiled = (names: Iterable<string>): string[] => {
    const out: string[] = []
    if (model.classes.length === 0) return out
    for (const name of names) {
      const at = model.classIndex.get(name)
      const def = at === undefined ? undefined : model.classes[at]
      if (def !== undefined) {
        out.push(...def.styles)
        out.push(...def.textStyles)
        for (let i = 0; i < out.length; i++) out[i] = jsTrim(out[i] as string)
      }
    }
    return out
  }

  // Each subgraph declared inside another, by child id.
  const subgraphParent = new Map<string, string>()
  for (const sg of subgraphs) {
    for (const child of sg.nodes) {
      if (flowDbSubgraph(model, child) !== undefined) subgraphParent.set(child, sg.id)
    }
  }

  // A subgraph's color index follows declaration order through the nesting. Ondine's
  // monochrome theme does not read it, so only the traversal Pele performs is skipped.

  const anyCollapsed = subgraphs.some((sg) => isCollapsed(sg.metadata))
  const outermost = new Map<string, string | undefined>()
  const hidden = new Set<string>()
  const collapsedInto = new Map<string, string>()

  if (anyCollapsed) {
    for (const sg of subgraphs) {
      const ancestor = outermostCollapsed(model, subgraphParent, outermost, sg.id)
      if (ancestor === undefined) continue

      if (sg.id !== ancestor) {
        hidden.add(sg.id)
        collapsedInto.set(sg.id, ancestor)
      }
      for (const child of sg.nodes) {
        if (child === ancestor) continue
        hidden.add(child)
        collapsedInto.set(child, ancestor)
      }
    }
  }
  const isHidden = (id: string): boolean => hidden.has(id)

  const parentOf = new Map<string, string>()
  const groups = new Set<string>()
  for (let at = subgraphs.length - 1; at >= 0; at--) {
    const sg = subgraphs[at]
    if (sg === undefined || isHidden(sg.id)) continue
    if (sg.nodes.length > 0) groups.add(sg.id)
    for (const id of sg.nodes) parentOf.set(id, sg.id)
  }
  const tooltips = new Map<string, string>()
  for (const [id, text] of model.tooltips) tooltips.set(id, text)

  const nodes: GraphNode[] = []
  const byId = new Map<string, number>()

  for (let at = subgraphs.length - 1; at >= 0; at--) {
    const sg = subgraphs[at]
    if (sg === undefined || isHidden(sg.id)) continue
    const collapsed = isCollapsed(sg.metadata)
    const node: GraphNode = {
      assetHeight: undefined,
      assetWidth: undefined,
      cssClasses: sg.classes.join(' '),
      cssCompiledStyles: compiled(sg.classes),
      cssStyles: [],
      constraint: undefined,
      dir: sg.dir,
      icon: undefined,
      id: sg.id,
      img: undefined,
      isGroup: !collapsed,
      label: sg.title,
      labelType: sg.labelType,
      link: undefined,
      linkTarget: undefined,
      parentId: parentOf.get(sg.id),
      pos: undefined,
      shape: collapsed ? 'collapsedGroup' : 'rect',
      tooltip: undefined,
    }
    byId.set(sg.id, nodes.length)
    nodes.push(node)
  }

  for (const vertex of model.nodes) {
    if (isHidden(vertex.id)) continue

    const existing = byId.get(vertex.id)
    const node = existing === undefined ? undefined : nodes[existing]
    if (node !== undefined) {
      node.cssStyles = vertex.styles.slice()
      node.cssCompiledStyles = compiled(vertex.classes)
      node.cssClasses = vertex.classes.join(' ')
      continue
    }

    const isGroup = groups.has(vertex.id)
    let cssClasses = 'default '
    cssClasses += vertex.classes.join(' ')
    const fresh: GraphNode = {
      assetHeight: vertex.assetHeight,
      assetWidth: vertex.assetWidth,
      cssClasses,
      cssCompiledStyles: model.classes.length === 0 ? [] : compiled(['default', 'node', ...vertex.classes]),
      cssStyles: vertex.styles.slice(),
      constraint: vertex.constraint,
      dir: vertex.dir,
      icon: vertex.icon,
      id: vertex.id,
      img: vertex.img,
      isGroup,
      label: vertex.text,
      labelType: vertex.labelType,
      link: vertex.link,
      linkTarget: vertex.linkTarget,
      parentId: parentOf.get(vertex.id),
      pos: vertex.pos,
      shape: isGroup ? 'rect' : shapeOf(vertex),
      tooltip: tooltips.get(vertex.id),
    }
    byId.set(vertex.id, nodes.length)
    nodes.push(fresh)
  }

  const edges: GraphEdge[] = []
  for (let index = 0; index < model.edges.length; index++) {
    const raw = model.edges[index]
    if (raw === undefined) continue
    const startInto = collapsedInto.size === 0 ? undefined : collapsedInto.get(raw.start)
    const endInto = collapsedInto.size === 0 ? undefined : collapsedInto.get(raw.end)
    const start = startInto ?? raw.start
    const end = endInto ?? raw.end
    if (start === end && (startInto !== undefined || endInto !== undefined)) continue

    const style = model.defaultEdgeStyle === undefined ? [] : model.defaultEdgeStyle.slice()
    if (raw.style !== undefined) style.push(...raw.style)
    const invisible = raw.stroke === 'invisible'
    const plain = invisible || raw.type === 'arrow_open'

    let id: string
    if (raw.id !== undefined && raw.id !== '') {
      id = raw.id
    } else {
      id = 'L_'
      id += start
      id += '_'
      id += end
      id += '_'
      id += u32(index)
    }

    // `raw.interpolate || model.defaultInterpolate || defaultCurve`, as JavaScript reads it.
    let curve: string | undefined
    if (raw.interpolate !== undefined && valueTruthy(raw.interpolate)) {
      const text = buf()
      valuePushJsString(raw.interpolate, text)
      curve = text.s
    } else if (model.defaultInterpolate !== undefined && model.defaultInterpolate !== '') {
      curve = model.defaultInterpolate
    } else if (defaultCurve !== undefined && defaultCurve !== '') {
      curve = defaultCurve
    } else {
      curve = undefined
    }

    edges.push({
      arrowTypeEnd: plain ? 'none' : arrowEnd(raw.type),
      arrowTypeStart: plain ? 'none' : arrowStart(raw.type),
      classes: invisible ? '' : 'edge-thickness-normal edge-pattern-solid flowchart-link',
      cssCompiledStyles: compiled(raw.classes),
      curve,
      end,
      id,
      label: raw.text,
      labelType: raw.labelType,
      minlen: raw.length,
      start,
      style,
      thickness: raw.stroke,
    })
  }

  return { edges, index: byId, nodes }
}

/** The outermost collapsed subgraph around `id`, resolved once per chain of parents. */
function outermostCollapsed(
  model: FlowDb,
  parents: Map<string, string>,
  cache: Map<string, string | undefined>,
  id: string,
): string | undefined {
  const chain: string[] = []
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current !== undefined) {
    const key: string = current
    if (cache.has(key) || seen.has(key)) break
    seen.add(key)
    chain.push(key)
    current = parents.get(key)
  }

  let result = current === undefined ? undefined : cache.get(current)
  for (let at = chain.length - 1; at >= 0; at--) {
    const key = chain[at] as string
    if (result === undefined && isCollapsed(flowDbSubgraph(model, key)?.metadata)) result = key
    cache.set(key, result)
  }
  return result
}
