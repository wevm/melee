/**
 * @module The flowchart model builder, equivalent to Mermaid's `FlowDB`. Port of Pele's
 * `src/diagrams/flowchart/db.ts`.
 *
 * Pele's `FlowDb` keeps nodes, classes, and tooltips in `Map`s. Here each is an array in insertion
 * order with a `Map` index for lookups, as the Rust crate keeps them.
 */
import { isValidShape } from './shapes.ts'
import {
  type DocItem,
  type FlowClassDef,
  type FlowEdge,
  type FlowNode,
  type FlowSubgraph,
  type FlowText,
  LabelType,
  type LinkInfo,
  labelTypeAsStr,
} from './types.ts'
import { type CompileError, Code, errorNew, u32 } from '../../error.ts'
import { isSpace } from '../../util/chars.ts'
import * as float from '../../util/float.ts'
import { buf, parseUint } from '../../util/rust.ts'
import { safeUrl } from '../../util/url.ts'
import * as yaml from '../../yaml.ts'
import { type Value, valuePushJsString, valueTruthy } from '../../yaml.ts'

/**
 * Options Pele's flowchart entry passes to `FlowDb`. Pele's `direction` and `warn` options are
 * never set by it, so they are left out.
 */
export type Options = {
  /** Whether subgraphs without a `direction` inherit the diagram's. */
  inheritDir: boolean
  /** The most edges a diagram may have. */
  maxEdges: number | undefined
}

/** Default options. */
export function optionsDefault(): Options {
  return { inheritDir: false, maxEdges: undefined }
}

/** The parsed flowchart: Pele's `FlowDb`, which implements `FlowchartModel`. */
export type FlowDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Class definitions, in insertion order. */
  classes: FlowClassDef[]
  /** Styles from `linkStyle default`. */
  defaultEdgeStyle: string[] | undefined
  /** The curve from `linkStyle default interpolate`. */
  defaultInterpolate: string | undefined
  /** The diagram direction. */
  direction: string | undefined
  /** Edges, in insertion order. */
  edges: FlowEdge[]
  /** Nodes, in insertion order. */
  nodes: FlowNode[]
  /** Subgraphs, in the order they close. */
  subgraphs: FlowSubgraph[]
  /** The front matter title. */
  title: string | undefined
  /** Tooltips by node id, in insertion order. */
  tooltips: [string, string][]

  classIndex: Map<string, number>
  /**
   * The first edge with each id. Generated ids wait in `pendingIds` until a lookup could match
   * one, which only a key starting with `L_` can.
   */
  edgeById: Map<string, number>
  /** Generated edge ids not yet in `edgeById`, with their edges at the same places of `pendingAt`. */
  pendingIds: string[]
  pendingAt: number[]
  members: Set<string>
  nodeIndex: Map<string, number>
  options: Options
  /** Edge counts by start, then end. */
  pairCount: Map<string, Map<string, number>>
  subCount: number
  subgraphLookup: Map<string, number>
  tooltipIndex: Map<string, number>
}

/** An empty model with default options. */
export function flowDbDefault(): FlowDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    classes: [],
    defaultEdgeStyle: undefined,
    defaultInterpolate: undefined,
    direction: undefined,
    edges: [],
    nodes: [],
    subgraphs: [],
    title: undefined,
    tooltips: [],

    classIndex: new Map(),
    edgeById: new Map(),
    pendingIds: [],
    pendingAt: [],
    members: new Set(),
    nodeIndex: new Map(),
    options: optionsDefault(),
    pairCount: new Map(),
    subCount: 0,
    subgraphLookup: new Map(),
    tooltipIndex: new Map(),
  }
}

/** Pele's `labelType`: a known label type name, or Markdown. */
function labelType(type: string | undefined): LabelType {
  switch (type) {
    case 'string':
      return LabelType.String
    case 'text':
      return LabelType.Text
    default:
      return LabelType.Markdown
  }
}

/** Strips one pair of surrounding double quotes. */
function unquote(text: string): string {
  if (text.startsWith('"')) {
    const rest = text.slice(1)
    if (rest.endsWith('"')) return rest.slice(0, -1)
  }
  return text
}

/** Pele's `destructStartLink`. */
function destructStartLink(raw: string): [string, string] {
  let s = jsTrim(raw)
  let type = 'arrow_open'
  switch (s.charCodeAt(0)) {
    case 0x3c: // <
      type = 'arrow_point'
      break
    case 0x78: // x
      type = 'arrow_cross'
      break
    case 0x6f: // o
      type = 'arrow_circle'
      break
    default:
      break
  }
  if (type !== 'arrow_open') s = s.slice(1)

  let stroke = 'normal'
  if (s.includes('=')) stroke = 'thick'
  if (s.includes('.')) stroke = 'dotted'
  return [type, stroke]
}

/** Pele's `destructEndLink`. Link tokens are ASCII once trimmed. */
function destructEndLink(raw: string): LinkInfo {
  const s = jsTrim(raw)
  let line = s.slice(0, Math.max(0, s.length - 1))
  let type: string
  let double: boolean
  switch (s.charCodeAt(s.length - 1)) {
    case 0x78: // x
      type = 'arrow_cross'
      double = s.startsWith('x')
      break
    case 0x3e: // >
      type = 'arrow_point'
      double = s.startsWith('<')
      break
    case 0x6f: // o
      type = 'arrow_circle'
      double = s.startsWith('o')
      break
    default:
      type = 'arrow_open'
      double = false
  }
  if (double) {
    line = line.slice(1)
    switch (type) {
      case 'arrow_cross':
        type = 'double_arrow_cross'
        break
      case 'arrow_point':
        type = 'double_arrow_point'
        break
      default:
        type = 'double_arrow_circle'
    }
  }

  let stroke = 'normal'
  let length = line.length - 1
  if (line.startsWith('=')) stroke = 'thick'
  if (line.startsWith('~')) stroke = 'invisible'
  let dots = 0
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === 0x2e) dots++
  if (dots > 0) {
    stroke = 'dotted'
    length = dots
  }

  return { id: undefined, length, stroke, text: undefined, type }
}

/** Creates an empty model. */
export function flowDbNew(options: Options): FlowDb {
  const db = flowDbDefault()
  db.options = options
  return db
}

function flowDbNodeMut(db: FlowDb, id: string): FlowNode | undefined {
  const index = db.nodeIndex.get(id)
  if (index === undefined) return undefined
  return db.nodes[index]
}

/** Whether `id` could be a generated edge id, which all start with `L_`. */
function maybeGenerated(id: string): boolean {
  return id.charCodeAt(0) === 0x4c && id.charCodeAt(1) === 0x5f
}

/** Moves the pending generated ids into `edgeById`, in the order their edges were added. */
function flowDbFlushEdgeIds(db: FlowDb): void {
  const ids = db.pendingIds
  if (ids.length === 0) return
  const at = db.pendingAt
  const map = db.edgeById
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as string
    if (!map.has(id)) map.set(id, at[i] as number)
  }
  ids.length = 0
  at.length = 0
}

/** The index of the first edge with `id`. */
function flowDbEdgeIndex(db: FlowDb, id: string): number | undefined {
  if (maybeGenerated(id)) flowDbFlushEdgeIds(db)
  return db.edgeById.size === 0 ? undefined : db.edgeById.get(id)
}

/** Whether `text` is empty or only whitespace, as `jsTrim(text) === ''` tests. */
function isBlankText(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (!isSpace(text.charCodeAt(i))) return false
  return true
}

/**
 * Adds or updates a node. `metadata` is the text of a `@{ ... }` block. Pele's `classes`
 * and `dir` parameters are never passed by the parser, so they are left out.
 */
export function flowDbAddVertex(
  db: FlowDb,
  id: string,
  text: FlowText | undefined,
  type: string | undefined,
  style: string[] | undefined,
  props: [string, string] | undefined,
  metadata: string | undefined,
): void {
  if (isBlankText(id)) return

  let doc: [string, Value][] | undefined
  if (metadata !== undefined) {
    let source = ''
    if (metadata.includes('\n')) {
      source += metadata
      source += '\n'
    } else {
      source += '{\n'
      source += metadata
      source += '\n}'
    }

    const parsed = yaml.parse(source)
    if (parsed.ok) {
      if (parsed.value.kind === 'Object') doc = parsed.value._0
    } else {
      let message = 'Metadata of "'
      message += id
      message += '" is not valid YAML. '
      message += parsed.error
      throw flowError(Code.Syntax, message)
    }
  }

  const subgraphIndex = doc === undefined || db.subgraphLookup.size === 0 ? undefined : db.subgraphLookup.get(id)
  if (subgraphIndex !== undefined && doc !== undefined) {
    const subgraph = db.subgraphs[subgraphIndex]
    if (subgraph !== undefined) {
      if (subgraph.metadata === undefined) subgraph.metadata = []
      const merged = subgraph.metadata
      for (const [key, value] of doc) yaml.set(merged, key, value)
    }
    return
  }

  const edgeIndex = flowDbEdgeIndex(db, id)
  if (edgeIndex !== undefined) {
    const edge = db.edges[edgeIndex]
    if (edge !== undefined && doc !== undefined) {
      const animate = get(doc, 'animate')
      if (animate !== undefined) edge.animate = animate
      const animation = get(doc, 'animation')
      if (animation !== undefined) edge.animation = animation
      const curve = get(doc, 'curve')
      if (curve !== undefined) edge.interpolate = curve
    }
    return
  }

  let nodeAt = db.nodeIndex.get(id)
  if (nodeAt === undefined) {
    nodeAt = db.nodes.length
    db.nodeIndex.set(id, nodeAt)
    db.nodes.push({
      assetHeight: undefined,
      assetWidth: undefined,
      classes: [],
      constraint: undefined,
      dir: undefined,
      form: undefined,
      icon: undefined,
      id,
      img: undefined,
      labelType: LabelType.Text,
      link: undefined,
      linkTarget: undefined,
      pos: undefined,
      props: undefined,
      styles: [],
      text: undefined,
      type: undefined,
    })
  }
  const vertex = db.nodes[nodeAt]
  if (vertex === undefined) return

  if (text !== undefined) {
    vertex.labelType = text.type
    vertex.text = unquote(jsTrim(text.text))
  } else if (vertex.text === undefined) {
    vertex.text = id
  }
  if (type !== undefined) vertex.type = type
  if (style !== undefined) vertex.styles.push(...style)
  if (vertex.props === undefined) {
    vertex.props = props === undefined ? [] : [[props[0], props[1]]]
  } else if (props !== undefined) {
    // Without an own `__proto__`, `Object.assign` sets the prototype instead.
    const [key, value] = props
    const entry = vertex.props.find(([own]) => own === key)
    if (entry !== undefined) entry[1] = value
    else if (key !== '__proto__') vertex.props.push([key, value])
  }

  if (doc === undefined) return

  const shapeValue = get(doc, 'shape')
  if (shapeValue !== undefined && valueTruthy(shapeValue)) {
    const shape = jsString(shapeValue)
    if (hasUpper(shape) || shape.includes('_')) {
      let message = 'No such shape: '
      message += shape
      message += '. Shape names should be lowercase.'
      throw flowError(Code.Semantic, message)
    }
    if (!isValidShape(shape)) {
      let message = 'No such shape: '
      message += shape
      message += '.'
      throw flowError(Code.Semantic, message)
    }
    vertex.type = shape
  }

  const labelValue = get(doc, 'label')
  const label = labelValue?.kind === 'String' ? labelValue._0 : undefined
  const blankLabel = label === undefined || isBlankText(label)
  if (labelValue !== undefined && valueTruthy(labelValue)) {
    vertex.text = jsString(labelValue)
    const name = get(doc, 'labelType')
    vertex.labelType = labelType(name?.kind === 'String' ? name._0 : undefined)
  }
  const icon = get(doc, 'icon')
  if (icon !== undefined && valueTruthy(icon)) {
    vertex.icon = jsString(icon)
    if (blankLabel && vertex.text === id) vertex.text = ''
  }
  const form = get(doc, 'form')
  if (form !== undefined && valueTruthy(form)) vertex.form = jsString(form)
  const pos = get(doc, 'pos')
  if (pos !== undefined && valueTruthy(pos)) vertex.pos = jsString(pos)
  const img = get(doc, 'img')
  if (img !== undefined && valueTruthy(img)) {
    vertex.img = jsString(img)
    if (blankLabel && vertex.text === id) vertex.text = ''
  }
  const constraint = get(doc, 'constraint')
  if (constraint !== undefined && valueTruthy(constraint)) vertex.constraint = jsString(constraint)
  const w = get(doc, 'w')
  if (w !== undefined && valueTruthy(w)) vertex.assetWidth = jsNumber(w)
  const h = get(doc, 'h')
  if (h !== undefined && valueTruthy(h)) vertex.assetHeight = jsNumber(h)
}

/** Adds one edge. `id` is the user-defined id, without its `@`. */
function flowDbAddSingleLink(
  db: FlowDb,
  start: string,
  end: string,
  info: LinkInfo,
  id: string | undefined,
): void {
  const edge: FlowEdge = {
    animate: undefined,
    animation: undefined,
    classes: [],
    end,
    id: undefined,
    interpolate:
      db.defaultInterpolate === undefined ? undefined : { kind: 'String', _0: db.defaultInterpolate },
    isUserDefinedId: false,
    labelType: LabelType.Text,
    length: undefined,
    start,
    stroke: info.stroke,
    style: undefined,
    text: '',
    type: info.type,
  }
  if (info.text !== undefined) {
    edge.text = unquote(jsTrim(info.text.text))
    edge.labelType = labelType(labelTypeAsStr(info.text.type))
  }
  edge.length = info.length === undefined ? undefined : Math.min(info.length, 10)

  let ends = db.pairCount.get(start)
  if (ends === undefined) {
    ends = new Map()
    db.pairCount.set(start, ends)
  }
  const existing = ends.get(end) ?? 0
  let edgeId: string
  if (id !== undefined && id !== '' && flowDbEdgeIndex(db, id) === undefined) {
    edge.isUserDefinedId = true
    edgeId = id
  } else {
    let generated = 'L_'
    generated += start
    generated += '_'
    generated += end
    generated += '_'
    const count = existing === 0 ? 0 : existing + 1
    generated += u32(count)
    edgeId = generated
  }

  const max = db.options.maxEdges
  if (max !== undefined && db.edges.length >= max) {
    let message = 'Edge limit exceeded. '
    message += u32(db.edges.length)
    message += ' edges found, but the limit is '
    message += u32(max)
    message += '.'
    throw flowError(Code.Limit, message)
  }

  if (edge.isUserDefinedId) {
    // `id` starts with `L_` only if the pending ids were just moved in, so no pending id can
    // come before it.
    db.edgeById.set(edgeId, db.edges.length)
  } else {
    db.pendingIds.push(edgeId)
    db.pendingAt.push(db.edges.length)
  }
  edge.id = edgeId
  db.edges.push(edge)
  ends.set(end, existing + 1)
}

/**
 * Adds an edge from every start to every end. Only the edge from the last start to the
 * first end takes the user-defined id.
 */
export function flowDbAddLink(db: FlowDb, starts: string[], ends: string[], info: LinkInfo): void {
  const id = info.id === undefined ? undefined : info.id.replace('@', '')
  const lastStart = starts[starts.length - 1]
  const firstEnd = ends[0]
  for (const start of starts) {
    for (const end of ends) {
      const own = start === lastStart && end === firstEnd
      flowDbAddSingleLink(db, start, end, info, own ? id : undefined)
    }
  }
}

/** Sets the curve of the edges at `positions`, or the default curve. */
export function flowDbUpdateLinkInterpolate(db: FlowDb, positions: string[], interpolate: string): void {
  for (const pos of positions) {
    if (pos === 'default') db.defaultInterpolate = interpolate
    else flowDbEdgeAt(db, pos).interpolate = { kind: 'String', _0: interpolate }
  }
}

/** Sets the styles of the edges at `positions`, or the default styles. */
export function flowDbUpdateLink(db: FlowDb, positions: string[], style: string[]): void {
  // Pele assigns one array to every edge and appends `fill:none` to it at the first edge,
  // so every edge of the statement sees the appended value.
  if (
    positions.some((pos) => pos !== 'default') &&
    style.length > 0 &&
    !style.some((s) => s.startsWith('fill'))
  ) {
    style.push('fill:none')
  }
  for (const pos of positions) {
    if (pos === 'default') db.defaultEdgeStyle = style.slice()
    else flowDbEdgeAt(db, pos).style = style.slice()
  }
}

function flowDbEdgeAt(db: FlowDb, pos: string): FlowEdge {
  const count = db.edges.length
  const parsed = parseUint(pos)
  const index = parsed !== undefined && parsed < count ? parsed : undefined
  const edge = index === undefined ? undefined : db.edges[index]
  if (edge !== undefined) return edge

  let message = 'The index '
  message += pos
  message += ' for linkStyle is out of bounds. Valid indices for linkStyle are between 0 and '
  if (count === 0) message += '-1'
  else message += u32(count - 1)
  message += '. (Help: Ensure that the index is within the range of existing edges.)'
  throw flowError(Code.Semantic, message)
}

/** Defines classes from `classDef`. */
export function flowDbAddClass(db: FlowDb, ids: string, styles: string[]): void {
  const joined = styles.join(',')
  const escaped = replaceAll(joined, '\\,', '§§§')
  const separated = replaceAll(escaped, ',', ';')
  const restored = replaceAll(separated, '§§§', ',')

  for (const id of ids.split(',')) {
    let index = db.classIndex.get(id)
    if (index === undefined) {
      db.classIndex.set(id, db.classes.length)
      db.classes.push({ id, styles: [], textStyles: [] })
      index = db.classes.length - 1
    }
    const klass = db.classes[index]
    if (klass === undefined) continue
    for (const s of restored.split(';')) {
      if (s.includes('color')) klass.textStyles.push(s.replace('fill', 'bgFill'))
      klass.styles.push(s)
    }
  }
}

/** Sets the diagram direction, mapping arrow symbols to names. */
export function flowDbSetDirection(db: FlowDb, dir: string): void {
  let d = jsTrim(dir)
  if (d.includes('<')) d = 'RL'
  if (d.includes('^')) d = 'BT'
  if (d.includes('>')) d = 'LR'
  if (d.includes('v')) d = 'TB'
  if (d === 'TD') d = 'TB'
  db.direction = d
}

/** Adds a class to the nodes, edges, and subgraphs named in a comma-separated list. */
export function flowDbSetClass(db: FlowDb, ids: string, className: string): void {
  for (const id of ids.split(',')) {
    const node = flowDbNodeMut(db, id)
    if (node !== undefined) node.classes.push(className)
    const edgeIndex = flowDbEdgeIndex(db, id)
    const edge = edgeIndex === undefined ? undefined : db.edges[edgeIndex]
    if (edge !== undefined) edge.classes.push(className)
    const subgraphIndex = db.subgraphLookup.get(id)
    const subgraph = subgraphIndex === undefined ? undefined : db.subgraphs[subgraphIndex]
    if (subgraph !== undefined) subgraph.classes.push(className)
  }
}

/** Sets the tooltip of each node in a comma-separated list. */
export function flowDbSetTooltip(db: FlowDb, ids: string, tooltip: string): void {
  for (const id of ids.split(',')) {
    const index = db.tooltipIndex.get(id)
    if (index !== undefined) {
      const entry = db.tooltips[index]
      if (entry !== undefined) entry[1] = tooltip
    } else {
      db.tooltipIndex.set(id, db.tooltips.length)
      db.tooltips.push([id, tooltip])
    }
  }
}

/** Sets the click target of each node in a comma-separated list and marks them clickable. */
export function flowDbSetLink(db: FlowDb, ids: string, link: string, target: string | undefined): void {
  const url = jsTrim(link)
  for (const id of ids.split(',')) {
    const vertex = flowDbNodeMut(db, id)
    if (vertex !== undefined) {
      vertex.link = url !== '' ? safeUrl(url) : undefined
      vertex.linkTarget = target
    }
  }
  flowDbSetClass(db, ids, 'clickable')
}

/** Marks nodes clickable. Callbacks are never executed, as in Mermaid's strict mode. */
export function flowDbSetClickEvent(db: FlowDb, ids: string): void {
  flowDbSetClass(db, ids, 'clickable')
}

/** Sets the accessible title without leading whitespace. */
export function flowDbSetAccTitle(db: FlowDb, text: string): void {
  let start = 0
  while (start < text.length && isSpace(text.charCodeAt(start))) start++
  db.accTitle = text.slice(start)
}

/** Sets the accessible description, removing indentation after line breaks. */
export function flowDbSetAccDescription(db: FlowDb, text: string): void {
  // `text.replace(/\n\s+/g, '\n')`.
  db.accDescr = text.replace(/\n\s+/g, '\n')
}

/**
 * Adds a subgraph from the items its body collected and returns its id. `same` is set when
 * the title is the id text itself, as Pele compares the two objects.
 */
export function flowDbAddSubgraph(
  db: FlowDb,
  idText: FlowText | undefined,
  list: DocItem[],
  titleText: FlowText | undefined,
  same: boolean,
): string {
  const title = titleText === undefined ? '' : titleText.text
  let id = idText === undefined ? undefined : jsTrim(idText.text)
  if (idText !== undefined && same && hasSpace(title)) id = undefined

  const seen = new Set<string>()
  const nodeList: string[] = []
  let dir: string | undefined
  const add = (item: string): void => {
    if (jsTrim(item) !== '' && !seen.has(item)) {
      seen.add(item)
      nodeList.push(item)
    }
  }
  for (const entry of list) {
    switch (entry.kind) {
      case 'Str':
        add(entry._0)
        break
      case 'Ids':
        for (const item of entry._0) add(item)
        break
      case 'Dir':
        dir = entry._0
        break
    }
  }
  if (dir === undefined && db.options.inheritDir) dir = db.direction

  const subgraphId = id ?? `subGraph${u32(db.subCount)}`
  db.subCount += 1

  // A node belongs to the first subgraph that lists it, and a subgraph never contains itself.
  const nodes = nodeList.filter((node) => !db.members.has(node) && node !== subgraphId)
  for (const node of nodes) db.members.add(node)

  const index = db.subgraphLookup.get(subgraphId)
  if (index !== undefined) {
    const existing = db.subgraphs[index]
    if (existing !== undefined) existing.nodes.push(...nodes)
  } else {
    db.subgraphLookup.set(subgraphId, db.subgraphs.length)
    db.subgraphs.push({
      classes: [],
      dir,
      id: subgraphId,
      labelType: labelType(titleText === undefined ? undefined : labelTypeAsStr(titleText.type)),
      metadata: undefined,
      nodes,
      title: jsTrim(title),
    })
  }
  return subgraphId
}

/** Pele's `destructLink`: reads an arrow, and its opening half when the label sits inside it. */
export function flowDbDestructLink(end: string, start: string | undefined): LinkInfo {
  const info = destructEndLink(end)
  if (start === undefined || start === '') return info

  const invalid: LinkInfo = {
    id: undefined,
    length: undefined,
    stroke: 'INVALID',
    text: undefined,
    type: 'INVALID',
  }
  const [startType, stroke] = destructStartLink(start)
  if (stroke !== info.stroke) return invalid
  let type: string
  if (startType === 'arrow_open') {
    type = info.type
  } else if (startType !== info.type) {
    return invalid
  } else {
    switch (startType) {
      case 'arrow_point':
        type = 'double_arrow_point'
        break
      case 'arrow_cross':
        type = 'double_arrow_cross'
        break
      default:
        type = 'double_arrow_circle'
    }
  }

  return { id: undefined, length: info.length, stroke, text: undefined, type }
}

/** The subgraph with `id`. */
export function flowDbSubgraph(db: FlowDb, id: string): FlowSubgraph | undefined {
  const index = db.subgraphLookup.get(id)
  return index === undefined ? undefined : db.subgraphs[index]
}

/** A flowchart error without a source position. */
function flowError(code: Code, message: string): CompileError {
  const error = errorNew(code, message)
  error.type = 'flowchart'
  return error
}

/** `str.replace(from, to)` with a global pattern. */
function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to)
}

/** Whether lowercasing `text` would change it, as `text !== text.toLowerCase()` tests. */
function hasUpper(text: string): boolean {
  for (const c of text) {
    if (c.toLowerCase() !== c) return true
  }
  return false
}

/** Whether `text` holds a character JavaScript's `\s` matches. */
function hasSpace(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (isSpace(text.charCodeAt(i))) return true
  return false
}

/** JavaScript's `String.prototype.trim`, which strips what `\s` matches. */
export function jsTrim(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && isSpace(text.charCodeAt(start))) start++
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--
  return start === 0 && end === text.length ? text : text.slice(start, end)
}

/** A property of a YAML mapping. */
function get(doc: [string, Value][], key: string): Value | undefined {
  return doc.find(([own]) => own === key)?.[1]
}

/** JavaScript's `String(value)` for a YAML value. */
function jsString(value: Value): string {
  const out = buf()
  valuePushJsString(value, out)
  return out.s
}

/** JavaScript's `Number(value)` for a YAML value. */
function jsNumber(value: Value): number {
  switch (value.kind) {
    case 'Array':
      return stringToNumber(jsString(value))
    case 'Bool':
      return value._0 ? 1 : 0
    case 'Null':
      return 0
    case 'Number':
      return value._0
    case 'Object':
      return Number.NaN
    case 'String':
      return stringToNumber(value._0)
  }
}

/** JavaScript's `StringToNumber`. */
function stringToNumber(raw: string): number {
  const text = jsTrim(raw)
  if (text === '') return 0

  if (text.charCodeAt(0) === 0x30 && text.length > 1) {
    const prefix = text.charCodeAt(1)
    let radix = 0
    if (prefix === 0x78 || prefix === 0x58) radix = 16
    else if (prefix === 0x6f || prefix === 0x4f) radix = 8
    else if (prefix === 0x62 || prefix === 0x42) radix = 2
    if (radix !== 0) {
      const digits = text.slice(2)
      if (digits === '') return Number.NaN
      let value = 0
      for (const c of digits) {
        const digit = toDigit(c, radix)
        if (digit === undefined) return Number.NaN
        value = value * radix + digit
      }
      return value
    }
  }

  const unsigned = text.startsWith('+') || text.startsWith('-') ? text.slice(1) : text
  if (unsigned === 'Infinity') {
    return text.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  }

  // StrDecimalLiteral: digits with an optional fraction, then an optional exponent.
  const isDigit = (at: number): boolean => {
    const b = unsigned.charCodeAt(at)
    return b >= 48 && b <= 57
  }
  let i = 0
  let digits = 0
  while (isDigit(i)) {
    i += 1
    digits += 1
  }
  if (unsigned.charCodeAt(i) === 0x2e) {
    i += 1
    while (isDigit(i)) {
      i += 1
      digits += 1
    }
  }
  if (digits === 0) return Number.NaN
  const e = unsigned.charCodeAt(i)
  if (e === 0x65 || e === 0x45) {
    i += 1
    const sign = unsigned.charCodeAt(i)
    if (sign === 0x2b || sign === 0x2d) i += 1
    const start = i
    while (isDigit(i)) i += 1
    if (i === start) return Number.NaN
  }
  if (i !== unsigned.length) return Number.NaN
  return float.parse(text) ?? Number.NaN
}

/** `char::to_digit(radix)` for radixes up to 16. */
function toDigit(c: string, radix: number): number | undefined {
  const code = c.codePointAt(0) as number
  let digit: number
  if (code >= 48 && code <= 57) digit = code - 48
  else if (code >= 97 && code <= 122) digit = code - 97 + 10
  else if (code >= 65 && code <= 90) digit = code - 65 + 10
  else return undefined
  return digit < radix ? digit : undefined
}
