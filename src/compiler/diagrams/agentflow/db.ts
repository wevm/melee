/**
 * @module The agentflow model builder, equivalent to Mermaid's `AgentFlowDB`. Port of Pele's
 * `src/diagrams/agentflow/db.ts`.
 *
 * Pele keeps nodes, connectors, classes, and tooltips in `Map`s. Here each is an array in
 * insertion order with a `Map` index for lookups, as the Rust crate keeps them. A connector is a
 * node, so the connector list holds node ids.
 */
import { isValidShape, resolveShapeAlias } from './shapes.ts'
import {
  type AgentEdge,
  type AgentNode,
  type AgentSubgraph,
  type Diagnostic,
  type DocItem,
  type ElementMapping,
  type ElementPosition,
  type FlowClassDef,
  type FlowText,
  LabelType,
  type LinkInfo,
  type Loc,
  type Metadata,
} from './types.ts'
import { type CompileError, Code, errorNew, u32 } from '../../error.ts'
import { isSpace } from '../../util/chars.ts'
import { type Buf, buf, parseUint } from '../../util/rust.ts'
import { safeUrl } from '../../util/url.ts'
import * as yaml from '../../yaml.ts'
import { type Value, valuePushJsString, valueTruthy } from '../../yaml.ts'

/** Options Pele's agentflow entry passes to `AgentflowDb`. */
export type Options = {
  /**
   * The `direction` config value, which flows inherit when `inheritDir` is set and the
   * diagram has none.
   */
  direction: string | undefined
  /** Whether flows without a `direction` inherit the diagram's. */
  inheritDir: boolean
  /** Lines of front matter before the text the parser sees, added to every reported line. */
  lineOffset: number
  /** The most edges a diagram may have. */
  maxEdges: number | undefined
}

/** `Options::default()`. */
export function optionsDefault(): Options {
  return { direction: undefined, inheritDir: false, lineOffset: 0, maxEdges: undefined }
}

/** The parsed agentflow: Pele's `AgentflowDb`, which implements `AgentflowModel`. */
export type AgentflowDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Class definitions, in insertion order. */
  classes: FlowClassDef[]
  /** Ids of the nodes `connector` statements made, in insertion order. */
  connectors: string[]
  /** Styles from `linkStyle default`. */
  defaultEdgeStyle: string[] | undefined
  /** The curve from `linkStyle default interpolate`. */
  defaultInterpolate: string | undefined
  /** Shape and containment findings, in the order they were made. */
  diagnostics: Diagnostic[]
  /** The diagram direction. */
  direction: string | undefined
  /** Edges, in insertion order. */
  edges: AgentEdge[]
  /** Where each statement sits in the source, in the order the statements were read. */
  mappings: ElementMapping[]
  /** Nodes and connectors, in insertion order. */
  nodes: AgentNode[]
  /** Flows, in the order they close. */
  subgraphs: AgentSubgraph[]
  /** The front matter title. */
  title: string | undefined
  /** Tooltips by node id, in insertion order. */
  tooltips: [string, string][]

  bareMappings: Set<number>
  classIndex: Map<string, number>
  connectorIndex: Set<string>
  edgeById: Map<string, number>
  firstMapping: Map<string, number>
  globalNodes: Set<string>
  members: Set<string>
  nodeIndex: Map<string, number>
  options: Options
  pairCount: Map<string, Map<string, number>>
  /** Generated edge ids not yet in `edgeById`, which all start with `L_`. */
  pendingIds: string[]
  /** The edge index of each pending id. */
  pendingAt: number[]
  reported: Map<string, number[]>
  subCount: number
  subgraphLookup: Map<string, number>
  tooltipIndex: Map<string, number>
}

/** `AgentflowDb::default()`. */
export function agentflowDbDefault(): AgentflowDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    classes: [],
    connectors: [],
    defaultEdgeStyle: undefined,
    defaultInterpolate: undefined,
    diagnostics: [],
    direction: undefined,
    edges: [],
    mappings: [],
    nodes: [],
    subgraphs: [],
    title: undefined,
    tooltips: [],
    bareMappings: new Set(),
    classIndex: new Map(),
    connectorIndex: new Set(),
    edgeById: new Map(),
    firstMapping: new Map(),
    globalNodes: new Set(),
    members: new Set(),
    nodeIndex: new Map(),
    options: optionsDefault(),
    pairCount: new Map(),
    pendingIds: [],
    pendingAt: [],
    reported: new Map(),
    subCount: 0,
    subgraphLookup: new Map(),
    tooltipIndex: new Map(),
  }
}

/** Shapes that define a tool. */
const TOOL_SHAPES: readonly string[] = ['subroutine', 'subprocess', 'subproc', 'framed-rectangle', 'tool']

/** Whether `vertex` defines a tool. */
export function isToolDefinition(vertex: AgentNode): boolean {
  return vertex.type !== undefined && TOOL_SHAPES.includes(vertex.type)
}

/** Pele's `labelType`: a known label type name, or Markdown. */
function labelType(type: Value | undefined): LabelType {
  if (type !== undefined && type.kind === 'String') {
    if (type._0 === 'string') return LabelType.String
    if (type._0 === 'text') return LabelType.Text
  }
  return LabelType.Markdown
}

/** Strips one pair of surrounding double quotes. */
function unquote(text: string): string {
  if (text.startsWith('"') && text.endsWith('"')) {
    return text.length >= 1 ? text.slice(1, text.length - 1) : ''
  }
  return text
}

/** JavaScript's `String.prototype.trim`, which strips what `\s` matches. */
export function jsTrim(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && isSpace(text.charCodeAt(start))) start++
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--
  return start === 0 && end === text.length ? text : text.slice(start, end)
}

/** `trim_start_matches` of what `\s` matches. */
function jsTrimStart(text: string): string {
  let start = 0
  while (start < text.length && isSpace(text.charCodeAt(start))) start++
  return text.slice(start)
}

/** `trim_end_matches` of what `\s` matches. */
function jsTrimEnd(text: string): string {
  let end = text.length
  while (end > 0 && isSpace(text.charCodeAt(end - 1))) end--
  return text.slice(0, end)
}

/**
 * Drops `__proto__`, `constructor`, and `prototype` keys at every level, so that a consumer
 * merging metadata into its own objects cannot be made to pollute a prototype. YAML values nest
 * at most 64 deep, which bounds the recursion.
 */
function stripPrototypeKeys(value: Value): Value {
  switch (value.kind) {
    case 'Array':
      return { kind: 'Array', _0: value._0.map(stripPrototypeKeys) }
    case 'Object':
      return {
        kind: 'Object',
        _0: value._0
          .filter(([key]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
          .map(([key, item]): [string, Value] => [key, stripPrototypeKeys(item)]),
      }
    default:
      return value
  }
}

/**
 * Adds what a metadata block holds to an element's metadata, as `Object.assign` does. Mermaid
 * spreads the parsed YAML whatever it is, so a list adds its indexes as keys and a string its
 * characters. Returns the metadata, created when `into` is `undefined`.
 */
function merge(into: Metadata | undefined, doc: Value): Metadata {
  const target = into ?? []
  switch (doc.kind) {
    case 'Object':
      for (const [key, value] of doc._0) yaml.set(target, key, yaml.valueClone(value))
      break
    case 'Array':
      doc._0.forEach((item, at) => yaml.set(target, u32(at), yaml.valueClone(item)))
      break
    case 'String': {
      // JavaScript indexes a string by UTF-16 unit. A character outside the Basic
      // Multilingual Plane keeps its first index here, where JavaScript splits it in two.
      let at = 0
      for (const c of doc._0) {
        yaml.set(target, u32(at), { kind: 'String', _0: c })
        at += c.length
      }
      break
    }
    default:
      break
  }
  return target
}

/** Appends `value` as `JSON.stringify` writes it. */
export function pushJson(out: Buf, value: Value): void {
  switch (value.kind) {
    case 'Array':
      out.s += '['
      value._0.forEach((item, at) => {
        if (at > 0) out.s += ','
        pushJson(out, item)
      })
      out.s += ']'
      return
    case 'Bool':
      out.s += value._0 ? 'true' : 'false'
      return
    case 'Null':
      out.s += 'null'
      return
    case 'Number':
      if (!Number.isFinite(value._0)) out.s += 'null'
      else yaml.pushNumber(out, value._0)
      return
    case 'Object':
      out.s += '{'
      value._0.forEach(([key, item], at) => {
        if (at > 0) out.s += ','
        pushJsonString(out, key)
        out.s += ':'
        pushJson(out, item)
      })
      out.s += '}'
      return
    case 'String':
      pushJsonString(out, value._0)
      return
  }
}

/** Appends `text` as a JSON string literal, as `JSON.stringify` escapes it. */
export function pushJsonString(out: Buf, text: string): void {
  const HEX = '0123456789abcdef'
  let s = '"'
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    switch (code) {
      case 0x22:
        s += '\\"'
        break
      case 0x5c:
        s += '\\\\'
        break
      case 0x08:
        s += '\\b'
        break
      case 0x0c:
        s += '\\f'
        break
      case 0x0a:
        s += '\\n'
        break
      case 0x0d:
        s += '\\r'
        break
      case 0x09:
        s += '\\t'
        break
      default:
        if (code < 0x20) {
          s += '\\u00'
          s += HEX[code >> 4]
          s += HEX[code & 15]
        } else {
          s += text[i]
        }
    }
  }
  s += '"'
  out.s += s
}

/** Whether a line of a block scalar header ends the line: `/:\s*[>|][\d+-]*\s*$/`. */
function opensBlockScalar(code: string): boolean {
  const trimmed = jsTrimEnd(code)
  let end = trimmed.length
  for (;;) {
    if (end === 0) break
    const c = trimmed.charCodeAt(end - 1)
    if ((c >= 48 && c <= 57) || c === 0x2b || c === 0x2d) end--
    else break
  }
  const body = trimmed.slice(0, end)
  if (!body.endsWith('>') && !body.endsWith('|')) return false
  const rest = body.slice(0, body.length - 1)
  return jsTrimEnd(rest).endsWith(':')
}

/**
 * Removes the comma that ends a line of a multi-line metadata body, which block YAML does not
 * allow. Commas inside quoted scalars, flow collections, and block scalars are content and
 * stay.
 */
function stripLineTrailingCommas(body: string): string {
  let inSingle = false
  let inDouble = false
  let flowDepth = 0
  let blockScalarIndent: number | undefined
  const out: string[] = []

  for (const line of body.split('\n')) {
    const indent = line.length - jsTrimStart(line).length
    if (blockScalarIndent !== undefined) {
      if (jsTrim(line) === '' || indent > blockScalarIndent) {
        out.push(line)
        continue
      }
      blockScalarIndent = undefined
    }

    let commentStart: number | undefined
    let at = 0
    while (at < line.length) {
      const code = line.codePointAt(at) as number
      const width = code > 0xffff ? 2 : 1
      if (inDouble) {
        if (code === 0x5c) {
          // Skips the next character.
          at += width
          if (at < line.length) {
            const next = line.codePointAt(at) as number
            at += next > 0xffff ? 2 : 1
          }
          continue
        } else if (code === 0x22) {
          inDouble = false
        }
      } else if (inSingle) {
        if (code === 0x27) inSingle = false
      } else if (code === 0x22) {
        inDouble = true
      } else if (code === 0x27) {
        inSingle = true
      } else if (code === 0x23) {
        const previous = at === 0 ? undefined : line.charCodeAt(at - 1)
        if (at === 0 || previous === 0x20 || previous === 0x09) {
          commentStart = at
          break
        }
      } else if (code === 0x5b || code === 0x7b) {
        flowDepth += 1
      } else if (code === 0x5d || code === 0x7d) {
        flowDepth = flowDepth > 0 ? flowDepth - 1 : 0
      }
      at += width
    }
    if (inSingle || inDouble || flowDepth > 0) {
      out.push(line)
      continue
    }

    const code = commentStart === undefined ? line : line.slice(0, commentStart)
    const comment = commentStart === undefined ? '' : line.slice(commentStart)
    if (opensBlockScalar(code)) {
      blockScalarIndent = indent
      out.push(line)
      continue
    }

    // `code.replace(/,([\t ]*)$/, '$1')`.
    let keptEnd = code.length
    while (keptEnd > 0) {
      const c = code.charCodeAt(keptEnd - 1)
      if (c === 0x20 || c === 0x09) keptEnd--
      else break
    }
    let text: string
    if (keptEnd > 0 && code.charCodeAt(keptEnd - 1) === 0x2c) {
      text = code.slice(0, keptEnd - 1) + code.slice(keptEnd)
    } else {
      text = code
    }
    text += comment
    out.push(text)
  }
  return out.join('\n')
}

/** What an arrow means, for the arrows that mean something. */
function edgeSemantic(type: string, stroke: string): string | undefined {
  if (type === 'arrow_point' && stroke === 'normal') return 'sequence'
  if (type === 'arrow_cross' && stroke === 'normal') return 'failure'
  if (type === 'arrow_open' && stroke === 'dotted') return 'reference'
  return undefined
}

/** Pele's `destructEndLink`. */
function destructEndLink(raw: string): [string, string, number] {
  const s = jsTrim(raw)
  let line = s.slice(0, Math.max(0, s.length - 1))
  const last = s.length > 0 ? s.charCodeAt(s.length - 1) : -1
  let type: string
  if (last === 0x78) {
    type = 'arrow_cross'
  } else if (last === 0x3e) {
    type = 'arrow_point'
  } else if (last === 0x2d || last === 0x2e) {
    line = s
    type = 'arrow_open'
  } else {
    type = 'arrow_open'
  }

  let stroke = 'normal'
  let length = line.length - 1
  let dots = 0
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === 0x2e) dots++
  if (dots > 0) {
    stroke = 'dotted'
    length = dots
  }
  return [type, stroke, length]
}

/** A property of a YAML mapping. */
function get(doc: [string, Value][], key: string): Value | undefined {
  return doc.find(([own]) => own === key)?.[1]
}

/** Whether lowercasing `text` would change it, as `text !== text.toLowerCase()` tests. */
function hasUpper(text: string): boolean {
  for (const c of text) {
    if (c.toLowerCase() !== c) return true
  }
  return false
}

/** JavaScript's `String(value)` for a YAML value. */
function jsString(value: Value): string {
  const out = buf()
  valuePushJsString(value, out)
  return out.s
}

/** An agentflow error without a source position. */
function agentflowError(code: Code, message: string): CompileError {
  const error = errorNew(code, message)
  error.type = 'agentflow'
  return error
}

/** Creates an empty model. */
export function agentflowDbNew(options: Options): AgentflowDb {
  const db = agentflowDbDefault()
  db.options = options
  return db
}

function agentflowDbNodeMut(db: AgentflowDb, id: string): AgentNode | undefined {
  const index = db.nodeIndex.get(id)
  return index === undefined ? undefined : db.nodes[index]
}

/** The node with `id`. */
export function agentflowDbNode(db: AgentflowDb, id: string): AgentNode | undefined {
  const index = db.nodeIndex.get(id)
  return index === undefined ? undefined : db.nodes[index]
}

/** Whether a `connector` statement made the node `id`. */
export function agentflowDbIsConnector(db: AgentflowDb, id: string): boolean {
  return db.connectorIndex.has(id)
}

/** The tooltip of node `id`. */
export function agentflowDbTooltip(db: AgentflowDb, id: string): string | undefined {
  const index = db.tooltipIndex.get(id)
  return index === undefined ? undefined : db.tooltips[index]?.[1]
}

/** The class definition named `id`. */
export function agentflowDbClass(db: AgentflowDb, id: string): FlowClassDef | undefined {
  const index = db.classIndex.get(id)
  return index === undefined ? undefined : db.classes[index]
}

/** The flow with `id`. */
export function agentflowDbSubgraph(db: AgentflowDb, id: string): AgentSubgraph | undefined {
  const index = db.subgraphLookup.get(id)
  return index === undefined ? undefined : db.subgraphs[index]
}

/** Whether `id` could be a generated edge id, which all start with `L_`. */
function maybeGenerated(id: string): boolean {
  return id.charCodeAt(0) === 0x4c && id.charCodeAt(1) === 0x5f
}

/** Moves the pending generated ids into `edgeById`, in the order their edges were added. */
function agentflowDbFlushEdgeIds(db: AgentflowDb): void {
  const ids = db.pendingIds
  if (ids.length === 0) return
  const at = db.pendingAt
  const map = db.edgeById
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as string
    if (!map.has(id)) map.set(id, at[i] as number)
  }
  db.pendingIds = []
  db.pendingAt = []
}

/** The index of the first edge with `id`. */
function agentflowDbEdgeIndex(db: AgentflowDb, id: string): number | undefined {
  if (maybeGenerated(id)) agentflowDbFlushEdgeIds(db)
  return db.edgeById.size === 0 ? undefined : db.edgeById.get(id)
}

/** Whether `text` is empty or only whitespace, as `jsTrim(text) === ''` tests. */
function isBlankText(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (!isSpace(text.charCodeAt(i))) return false
  return true
}

/** The line a span starts on, with the front matter offset. */
function agentflowDbLineOf(db: AgentflowDb, loc: Loc | undefined): number {
  return loc === undefined ? 0 : loc.firstLine + db.options.lineOffset
}

/**
 * Reads the text of a metadata block. Block YAML rejects the comma-separated style of the
 * single-line form, so a multi-line body is read once more without its trailing commas.
 */
function agentflowDbMetadata(db: AgentflowDb, id: string, source: string, loc: Loc | undefined): Value {
  const multiline = source.includes('\n')
  const text = multiline ? source + '\n' : '{\n' + source + '\n}'

  let parsed: Value
  const result = yaml.parse(text)
  if (result.ok) {
    parsed = result.value
  } else {
    const message = result.error
    const stripped = multiline ? stripLineTrailingCommas(source) : source
    let retried: Value | undefined
    if (stripped !== source) {
      const again = yaml.parse(stripped + '\n')
      if (again.ok) retried = again.value
    }
    if (retried === undefined) {
      let text = 'Metadata of "'
      text += id
      text += '" is not valid YAML. '
      text += message
      if (loc !== undefined) {
        text += ' ('
        text += u32(loc.firstLine + db.options.lineOffset)
        text += ':'
        text += u32(loc.firstColumn + 1)
        text += ')'
      }
      const error = agentflowError(Code.Syntax, text)
      error.line = agentflowDbLineOf(db, loc)
      error.column = loc === undefined ? 0 : loc.firstColumn + 1
      throw error
    }
    parsed = retried
  }
  if (parsed.kind === 'Null') parsed = { kind: 'Object', _0: [] }
  return stripPrototypeKeys(parsed)
}

function agentflowDbShapeError(db: AgentflowDb, message: string, loc: Loc | undefined): CompileError {
  const error = agentflowError(Code.Semantic, message)
  error.line = agentflowDbLineOf(db, loc)
  error.column = loc === undefined ? 0 : loc.firstColumn + 1
  return error
}

/**
 * Adds or updates a node, or adds metadata to the flow, connector, or edge `id` names.
 * `metadata` is the text of a `@{ ... }` block and its span. Pele's `classes` and `dir`
 * parameters are never passed by the parser, so they are left out.
 */
export function agentflowDbAddVertex(
  db: AgentflowDb,
  id: string,
  text: FlowText | undefined,
  type: string | undefined,
  style: string[] | undefined,
  props: [string, string] | undefined,
  metadata: [string, Loc | undefined] | undefined,
): void {
  if (isBlankText(id)) return

  let doc: Value | undefined
  let authoredShape: string | undefined
  let loc: Loc | undefined
  if (metadata !== undefined) {
    const [source, at] = metadata
    loc = at
    const value = agentflowDbMetadata(db, id, source, at)
    if (value.kind === 'Object') {
      const entry = value._0.find(([key]) => key === 'shape')
      if (entry !== undefined && entry[1].kind === 'String') {
        const shape = entry[1]._0
        authoredShape = shape
        entry[1] = { kind: 'String', _0: resolveShapeAlias(shape) }
      }
    }
    doc = value
  }
  if (doc !== undefined && !valueTruthy(doc)) doc = undefined

  const subgraphIndex = doc === undefined || db.subgraphLookup.size === 0 ? undefined : db.subgraphLookup.get(id)
  if (subgraphIndex !== undefined && doc !== undefined) {
    const subgraph = db.subgraphs[subgraphIndex]
    if (subgraph !== undefined) subgraph.metadata = merge(subgraph.metadata, doc)
    return
  }

  if (doc !== undefined && db.connectorIndex.size > 0 && db.connectorIndex.has(id)) {
    const connector = agentflowDbNodeMut(db, id)
    if (connector !== undefined) connector.metadata = merge(connector.metadata, doc)
    return
  }

  // Mermaid reserves this id and creates no node for it.
  if (id === 'connectors') return

  const edgeIndex = agentflowDbEdgeIndex(db, id)
  if (edgeIndex !== undefined) {
    const edge = db.edges[edgeIndex]
    if (edge !== undefined) {
      if (doc !== undefined && doc.kind === 'Object') {
        const fields = doc._0
        let value = get(fields, 'animate')
        if (value !== undefined) edge.animate = yaml.valueClone(value)
        value = get(fields, 'animation')
        if (value !== undefined) edge.animation = yaml.valueClone(value)
        value = get(fields, 'curve')
        if (value !== undefined) edge.interpolate = yaml.valueClone(value)
      }
      if (doc !== undefined) edge.metadata = merge(edge.metadata, doc)
    }
    return
  }

  let index = db.nodeIndex.get(id)
  if (index === undefined) {
    index = db.nodes.length
    db.nodeIndex.set(id, index)
    db.nodes.push({
      classes: [],
      dir: undefined,
      id,
      isConnector: false,
      labelType: LabelType.Text,
      link: undefined,
      linkTarget: undefined,
      metadata: undefined,
      props: undefined,
      styles: [],
      text: undefined,
      type: undefined,
    })
  }
  const vertex = db.nodes[index]
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
  vertex.metadata = merge(vertex.metadata, doc)
  if (doc.kind !== 'Object') return
  const fields = doc._0

  const shape = get(fields, 'shape')
  if (shape !== undefined && valueTruthy(shape)) {
    if (authoredShape === undefined) {
      const message = buf('No such shape: ')
      pushJson(message, shape)
      message.s += '.'
      throw agentflowDbShapeError(db, message.s, loc)
    }
    if (hasUpper(authoredShape) || authoredShape.includes('_')) {
      throw agentflowDbShapeError(
        db,
        `No such shape: ${authoredShape}. Shape names should be lowercase.`,
        loc,
      )
    }
    const name = jsString(shape)
    if (!isValidShape(name)) throw agentflowDbShapeError(db, `No such shape: ${name}.`, loc)
    vertex.type = name
  }

  const label = get(fields, 'label')
  if (label !== undefined && valueTruthy(label)) {
    vertex.text = jsString(label)
    vertex.labelType = labelType(get(fields, 'labelType'))
  }
}

/** Adds one edge. `id` is the user-defined id, without its `@`. */
function agentflowDbAddSingleLink(
  db: AgentflowDb,
  start: string,
  end: string,
  info: LinkInfo,
  id: string | undefined,
): void {
  const edge: AgentEdge = {
    animate: undefined,
    animation: undefined,
    classes: [],
    edgeSemantic: info.edgeSemantic,
    end,
    id: '',
    interpolate: db.defaultInterpolate === undefined ? undefined : { kind: 'String', _0: db.defaultInterpolate },
    isUserDefinedId: false,
    labelType: LabelType.Text,
    length: info.length === undefined ? undefined : Math.min(info.length, 10),
    metadata: undefined,
    start,
    stroke: info.stroke,
    style: undefined,
    text: '',
    type: info.type,
  }
  if (info.text !== undefined) {
    edge.text = unquote(jsTrim(info.text.text))
    edge.labelType = info.text.type
  }

  let ends = db.pairCount.get(start)
  if (ends === undefined) {
    ends = new Map()
    db.pairCount.set(start, ends)
  }
  const existing = ends.get(end) ?? 0
  if (id !== undefined && id !== '' && agentflowDbEdgeIndex(db, id) === undefined) {
    edge.isUserDefinedId = true
    edge.id = id
  } else {
    const count = existing === 0 ? 0 : existing + 1
    edge.id = `L_${start}_${end}_${u32(count)}`
  }

  const max = db.options.maxEdges
  if (max !== undefined && db.edges.length >= max) {
    throw agentflowError(
      Code.Limit,
      `Edge limit exceeded. ${u32(db.edges.length)} edges found, but the limit is ${u32(max)}.`,
    )
  }

  if (edge.isUserDefinedId) {
    // `id` starts with `L_` only if the pending ids were just moved in, so no pending id can
    // come before it.
    db.edgeById.set(edge.id, db.edges.length)
  } else {
    db.pendingIds.push(edge.id)
    db.pendingAt.push(db.edges.length)
  }
  db.edges.push(edge)
  ends.set(end, existing + 1)
}

/**
 * Adds an edge from every start to every end. Only the edge from the last start to the
 * first end takes the user-defined id.
 */
export function agentflowDbAddLink(db: AgentflowDb, starts: string[], ends: string[], info: LinkInfo): void {
  const id = info.id === undefined ? undefined : info.id.replace('@', '')
  const lastStart = starts.length - 1
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s] as string
    for (let e = 0; e < ends.length; e++) {
      const end = ends[e] as string
      // Rust compares by value, so an equal id elsewhere in the lists counts too.
      const own = start === starts[lastStart] && end === ends[0]
      agentflowDbAddSingleLink(db, start, end, info, own ? id : undefined)
    }
  }
}

/** Sets the curve of the edges at `positions`, or the default curve. */
export function agentflowDbUpdateLinkInterpolate(db: AgentflowDb, positions: string[], interpolate: string): void {
  for (const pos of positions) {
    if (pos === 'default') db.defaultInterpolate = interpolate
    else agentflowDbEdgeAt(db, pos).interpolate = { kind: 'String', _0: interpolate }
  }
}

/** Sets the styles of the edges at `positions`, or the default styles. */
export function agentflowDbUpdateLink(db: AgentflowDb, positions: string[], style: string[]): void {
  // Pele assigns one array to every position and appends `fill:none` to it at the first
  // edge, so every position of the statement sees the appended value.
  if (
    positions.some((pos) => pos !== 'default') &&
    style.length > 0 &&
    !style.some((s) => s.startsWith('fill'))
  ) {
    style.push('fill:none')
  }
  for (const pos of positions) {
    if (pos === 'default') db.defaultEdgeStyle = style.slice()
    else agentflowDbEdgeAt(db, pos).style = style.slice()
  }
}

/**
 * The edge at a `linkStyle` index. Mermaid checks the bounds only for a numeric index and
 * crashes on the strings its own parser passes, so Pele reports both.
 */
function agentflowDbEdgeAt(db: AgentflowDb, pos: string): AgentEdge {
  const count = db.edges.length
  const parsed = parseUint(pos, 4294967295)
  const edge = parsed !== undefined && parsed < count ? db.edges[parsed] : undefined
  if (edge !== undefined) return edge

  let text = 'The index '
  text += pos
  text += ' for linkStyle is out of bounds. Valid indices for linkStyle are between 0 and '
  text += count === 0 ? '-1' : u32(count - 1)
  text += '. (Help: Ensure that the index is within the range of existing edges.)'
  throw agentflowError(Code.Semantic, text)
}

/** Defines classes from `classDef`. */
export function agentflowDbAddClass(db: AgentflowDb, ids: string, styles: string[]): void {
  const joined = styles.join(',')
  const escaped = replaceAll(joined, '\\,', '§§§')
  const separated = replaceAll(escaped, ',', ';')
  const restored = replaceAll(separated, '§§§', ',')

  for (const id of ids.split(',')) {
    let index = db.classIndex.get(id)
    if (index === undefined) {
      index = db.classes.length
      db.classIndex.set(id, index)
      db.classes.push({ id, styles: [], textStyles: [] })
    }
    const cls = db.classes[index]
    if (cls === undefined) continue
    for (const s of restored.split(';')) {
      if (s.includes('color')) cls.textStyles.push(s.replace('fill', 'bgFill'))
      cls.styles.push(s)
    }
  }
}

/** Sets the diagram direction, mapping arrow symbols to names. */
export function agentflowDbSetDirection(db: AgentflowDb, dir: string): void {
  let d = jsTrim(dir)
  if (d.includes('<')) d = 'RL'
  if (d.includes('^')) d = 'BT'
  if (d.includes('>')) d = 'LR'
  if (d.includes('v')) d = 'TB'
  if (d === 'TD') d = 'TB'
  db.direction = d
}

/** Adds a class to the nodes, edges, and flows named in a comma-separated list. */
export function agentflowDbSetClass(db: AgentflowDb, ids: string, className: string): void {
  for (const id of ids.split(',')) {
    const node = agentflowDbNodeMut(db, id)
    if (node !== undefined) node.classes.push(className)
    const edgeIndex = agentflowDbEdgeIndex(db, id)
    const edge = edgeIndex === undefined ? undefined : db.edges[edgeIndex]
    if (edge !== undefined) edge.classes.push(className)
    const subgraphIndex = db.subgraphLookup.get(id)
    const subgraph = subgraphIndex === undefined ? undefined : db.subgraphs[subgraphIndex]
    if (subgraph !== undefined) subgraph.classes.push(className)
  }
}

/** Sets the tooltip of each node in a comma-separated list. */
export function agentflowDbSetTooltip(db: AgentflowDb, ids: string, tooltip: string): void {
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
export function agentflowDbSetLink(db: AgentflowDb, ids: string, link: string, target: string | undefined): void {
  const url = jsTrim(link)
  for (const id of ids.split(',')) {
    const vertex = agentflowDbNodeMut(db, id)
    if (vertex !== undefined) {
      vertex.link = url === '' ? undefined : safeUrl(url)
      vertex.linkTarget = target
    }
  }
  agentflowDbSetClass(db, ids, 'clickable')
}

/** Marks nodes clickable. Callbacks are never executed, as in Mermaid's strict mode. */
export function agentflowDbSetClickEvent(db: AgentflowDb, ids: string): void {
  agentflowDbSetClass(db, ids, 'clickable')
}

/** Sets the accessible title without leading whitespace. */
export function agentflowDbSetAccTitle(db: AgentflowDb, text: string): void {
  db.accTitle = jsTrimStart(text)
}

/** Sets the accessible description, removing indentation after line breaks. */
export function agentflowDbSetAccDescription(db: AgentflowDb, text: string): void {
  // `text.replace(/\n\s+/g, '\n')`.
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 10) {
      while (i < text.length) {
        const code = text.codePointAt(i) as number
        if (!isSpace(code)) break
        i += code > 0xffff ? 2 : 1
      }
    }
  }
  db.accDescr = out
}

/** Adds a flow from the items its body collected and returns its id. */
export function agentflowDbAddSubgraph(
  db: AgentflowDb,
  idText: FlowText | undefined,
  list: DocItem[],
  titleText: FlowText | undefined,
): string {
  const givenId = idText === undefined ? undefined : jsTrim(idText.text)
  const rawTitle = titleText === undefined ? '' : titleText.text

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
  if (dir === undefined && db.options.inheritDir) dir = db.direction ?? db.options.direction

  const id = givenId ?? `subGraph${u32(db.subCount)}`
  db.subCount += 1

  // A flow never contains itself, a globally scoped node, or a node another flow already
  // holds.
  const nodes = nodeList.filter((node) => node !== id && !db.globalNodes.has(node) && !db.members.has(node))
  for (const node of nodes) db.members.add(node)

  const title = jsTrim(rawTitle)
  const existingIndex = db.subgraphLookup.get(id)
  if (existingIndex !== undefined) {
    // A repeated id adds its members to the first flow. Its title and direction win.
    const existing = db.subgraphs[existingIndex]
    if (existing !== undefined) {
      existing.nodes.push(...nodes)
      if (title !== '') existing.title = title
      if (dir !== undefined && dir !== '') existing.dir = dir
    }
    return id
  }

  db.subgraphLookup.set(id, db.subgraphs.length)
  db.subgraphs.push({
    classes: [],
    dir,
    id,
    labelType: titleText === undefined ? LabelType.Markdown : titleText.type,
    metadata: undefined,
    nodes,
    title,
  })
  return id
}

/** Keeps every node named inside a `global` block out of the flows that mention it. */
export function agentflowDbAddGlobal(db: AgentflowDb, list: DocItem[]): void {
  let release = false
  const add = (item: string): void => {
    const id = jsTrim(item)
    if (id === '') return
    db.globalNodes.add(id)
    if (db.members.delete(id)) release = true
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
        break
    }
  }
  if (!release) return

  const globalNodes = db.globalNodes
  for (const subgraph of db.subgraphs) {
    subgraph.nodes = subgraph.nodes.filter((node) => !globalNodes.has(node))
  }
}

/** Adds a connector, or retitles one, and returns its id, or an empty id for none. */
export function agentflowDbAddConnector(
  db: AgentflowDb,
  text: FlowText | undefined,
  title: FlowText | undefined,
): string {
  const id = text === undefined ? '' : jsTrim(text.text)
  if (id === '') return ''
  const name = title === undefined ? '' : jsTrim(title.text)

  if (!db.connectorIndex.has(id)) {
    const created: AgentNode = {
      classes: [],
      dir: undefined,
      id,
      isConnector: true,
      labelType: LabelType.Text,
      link: undefined,
      linkTarget: undefined,
      metadata: undefined,
      props: undefined,
      styles: [],
      text: name === '' ? id : name,
      type: undefined,
    }
    db.connectorIndex.add(id)
    db.connectors.push(id)
    // `Map.set` keeps an existing key's place.
    const index = db.nodeIndex.get(id)
    if (index !== undefined) {
      if (db.nodes[index] !== undefined) db.nodes[index] = created
    } else {
      db.nodeIndex.set(id, db.nodes.length)
      db.nodes.push(created)
    }
  } else if (name !== '') {
    const connector = agentflowDbNodeMut(db, id)
    if (connector !== undefined) connector.text = name
  }
  return id
}

/** Pele's `destructLink`: reads an arrow, and its opening half when the label sits inside it. */
export function agentflowDbDestructLink(end: string, start: string | undefined): LinkInfo {
  const [type, stroke, length] = destructEndLink(end)
  if (start !== undefined && start !== '') {
    // The first half of a split arrow only says whether the line is dotted.
    const opening = start.includes('.') ? 'dotted' : 'normal'
    if (opening !== stroke) {
      return {
        edgeSemantic: undefined,
        id: undefined,
        length: undefined,
        stroke: 'INVALID',
        text: undefined,
        type: 'INVALID',
      }
    }
  }
  return {
    edgeSemantic: edgeSemantic(type, stroke),
    id: undefined,
    length,
    stroke,
    text: undefined,
    type,
  }
}

/** What a node is: `tool`, `action`, `input`, `refdoc`, `decision`, or `task`. */
export function agentflowDbVertexKind(vertex: AgentNode): string {
  if (isToolDefinition(vertex)) return 'tool'
  switch (vertex.type === undefined ? undefined : resolveShapeAlias(vertex.type)) {
    case 'hexagon':
    case 'hex':
      return 'action'
    case 'lean-right':
    case 'lean_right':
      return 'input'
    case 'lin-doc':
    case 'lined-document':
      return 'refdoc'
    case 'diamond':
      return 'decision'
    default:
      return 'task'
  }
}

function agentflowDbPosition(db: AgentflowDb, loc: Loc | undefined): ElementPosition {
  const startLine = loc === undefined ? 0 : loc.firstLine
  const startColumn = loc === undefined ? 0 : loc.firstColumn
  return {
    endColumn: loc === undefined ? startColumn : loc.lastColumn,
    endLine: (loc === undefined ? startLine : loc.lastLine) + db.options.lineOffset,
    startColumn,
    startLine: startLine + db.options.lineOffset,
  }
}

function agentflowDbPushMapping(db: AgentflowDb, id: string, type: string, position: ElementPosition): number {
  const index = db.mappings.length
  db.mappings.push({ id, position, type })
  if (!db.firstMapping.has(id)) db.firstMapping.set(id, index)
  return index
}

/**
 * Records where a node statement sits. A bare reference becomes an attachment if a metadata
 * block follows it.
 */
export function agentflowDbAddVertexMapping(db: AgentflowDb, id: string, shaped: boolean, loc: Loc): void {
  if (id === '') return
  const position = agentflowDbPosition(db, loc)
  const index = agentflowDbPushMapping(db, id, 'vertex', position)
  if (!shaped) db.bareMappings.add(index)
}

/** Widens a node's span over the metadata block that follows it. */
export function agentflowDbExtendVertexMapping(db: AgentflowDb, id: string, loc: Loc): void {
  if (id === '') return
  const end = agentflowDbPosition(db, loc)
  for (let index = db.mappings.length - 1; index >= 0; index--) {
    const mapping = db.mappings[index]
    if (mapping === undefined) continue
    if (mapping.type !== 'vertex' || mapping.id !== id) continue
    if (db.bareMappings.delete(index)) mapping.type = 'attachment'
    const p = mapping.position
    if (end.endLine > p.endLine || (end.endLine === p.endLine && end.endColumn > p.endColumn)) {
      p.endLine = end.endLine
      p.endColumn = end.endColumn
    }
    return
  }
  agentflowDbPushMapping(db, id, 'attachment', end)
}

/** Records where an edge statement sits, named by the nodes it ends at. */
export function agentflowDbAddEdgeMapping(db: AgentflowDb, toNodes: string[], loc: Loc): void {
  let id: string
  if (toNodes.length === 1 && toNodes[0] !== '') {
    id = toNodes[0] as string
  } else {
    const ids = toNodes.filter((id) => id !== '')
    id = ids.length === 0 ? 'edge' : ids.join('>')
  }
  const position = agentflowDbPosition(db, loc)
  agentflowDbPushMapping(db, id, 'edge', position)
}

function agentflowDbBlockMapping(db: AgentflowDb, id: string, type: string, start: Loc, end: Loc): void {
  if (id === '') return
  const from = agentflowDbPosition(db, start)
  const to = agentflowDbPosition(db, end)
  agentflowDbPushMapping(db, id, type, {
    endColumn: to.endColumn,
    endLine: to.endLine,
    startColumn: from.startColumn,
    startLine: from.startLine,
  })
}

/** Records where a flow block sits, from its keyword to its `end`. */
export function agentflowDbAddSubgraphMapping(
  db: AgentflowDb,
  id: FlowText | undefined,
  start: Loc,
  end: Loc,
): void {
  agentflowDbBlockMapping(db, id === undefined ? '' : id.text, 'subgraph', start, end)
}

/** Records where a connector statement sits, from its keyword to its separator. */
export function agentflowDbAddConnectorMapping(
  db: AgentflowDb,
  text: FlowText | undefined,
  start: Loc,
  end: Loc,
): void {
  agentflowDbBlockMapping(db, text === undefined ? '' : jsTrim(text.text), 'connector', start, end)
}

/** Records a finding about node `nodeId` once. The graph may be built more than once. */
export function agentflowDbEmit(db: AgentflowDb, id: string, severity: string, message: string, nodeId: string): void {
  let position: ElementPosition | undefined
  if (nodeId !== '') {
    const index = db.firstMapping.get(nodeId)
    const mapping = index === undefined ? undefined : db.mappings[index]
    if (mapping !== undefined) position = { ...mapping.position }
  }
  const diagnostic: Diagnostic = {
    id,
    message,
    nodeId: nodeId === '' ? undefined : nodeId,
    position,
    severity,
  }

  let same = db.reported.get(nodeId)
  if (same === undefined) {
    same = []
    db.reported.set(nodeId, same)
  }
  for (const index of same) {
    const d = db.diagnostics[index]
    if (
      d !== undefined &&
      d.id === id &&
      d.severity === severity &&
      d.message === diagnostic.message &&
      d.nodeId === diagnostic.nodeId
    ) {
      return
    }
  }
  same.push(db.diagnostics.length)
  db.diagnostics.push(diagnostic)
}

/** `str.replace(from, to)` with a global pattern. */
function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to)
}
