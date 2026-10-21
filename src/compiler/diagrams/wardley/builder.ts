/**
 * @module Collects a Wardley map's nodes, links, and decorations as Mermaid's database does. Port
 * of Pele's `src/diagrams/wardley/builder.ts`.
 */

/** Which way a link carries flow. */
export const Flow = {
  /** Both ways. */
  Bidirectional: 'Bidirectional',
  /** From target to source. */
  Backward: 'Backward',
  /** From source to target. */
  Forward: 'Forward',
} as const
export type Flow = (typeof Flow)[keyof typeof Flow]

/** The flow as Pele names it. */
export function flowAsStr(flow: Flow): string {
  switch (flow) {
    case Flow.Backward:
      return 'backward'
    case Flow.Bidirectional:
      return 'bidirectional'
    case Flow.Forward:
      return 'forward'
  }
}

/** A node. Coordinates are percentages: `x` is evolution, `y` is visibility. */
export type WardleyNode = {
  /** `anchor`, `component`, or `pipeline-component`. */
  className: string | undefined
  /** The id. */
  id: string
  /** Whether the node is a pipeline component. */
  inPipeline: boolean
  /** Whether `inertia` was given, when a statement said. */
  inertia: boolean | undefined
  /** Whether the node owns a pipeline. */
  isPipelineParent: boolean
  /** The label. */
  label: string
  /** The label's horizontal offset. */
  labelOffsetX: number | undefined
  /** The label's vertical offset. */
  labelOffsetY: number | undefined
  /** `build`, `buy`, `outsource`, or `market`. */
  sourceStrategy: string | undefined
  /**
   * Evolution, in percent. Pele allows it to be missing, but every node the parser adds has
   * one, so the `build` check for it is left out.
   */
  x: number
  /** Visibility, in percent. */
  y: number
}

/** `WardleyNode::default()`. */
export function wardleyNodeDefault(): WardleyNode {
  return {
    className: undefined,
    id: '',
    inPipeline: false,
    inertia: undefined,
    isPipelineParent: false,
    label: '',
    labelOffsetX: undefined,
    labelOffsetY: undefined,
    sourceStrategy: undefined,
    x: 0,
    y: 0,
  }
}

/**
 * What {@link wardleyBuilderAddNode} sets. A doubled option (Rust's `Option<Option<T>>`) is a
 * `{ value }` box here: a missing box keeps the existing value, as a key missing from Pele's
 * object does.
 */
export type NodeInput = {
  /** The class name. */
  className: string
  /** The id. */
  id: string
  /** The inertia, when the statement sets it. */
  inertia: { value: boolean | undefined } | undefined
  /** The label. */
  label: string
  /** The label's horizontal offset. */
  labelOffsetX: number | undefined
  /** The label's vertical offset. */
  labelOffsetY: number | undefined
  /** The source strategy, when the statement sets it. */
  sourceStrategy: { value: string | undefined } | undefined
  /** Evolution. */
  x: number
  /** Visibility. */
  y: number
}

/** A link. */
export type WardleyLink = {
  /** Whether the line is dashed. */
  dashed: boolean
  /** The flow. */
  flow: Flow | undefined
  /** The label. */
  label: string | undefined
  /** The source node id. */
  source: string
  /** The target node id. */
  target: string
}

/** Where a component is heading. */
export type WardleyTrend = {
  /** The node id. */
  nodeId: string
  /** The target evolution. */
  targetX: number
  /** The target visibility. */
  targetY: number
}

/** A pipeline. */
export type WardleyPipeline = {
  /** The component ids. */
  componentIds: string[]
  /** The parent node id. */
  nodeId: string
}

/** A numbered annotation. */
export type WardleyAnnotation = {
  /** Places the number is drawn, as `(x, y)`. */
  coordinates: [number, number][]
  /** The number. */
  number: number
  /** The text. */
  text: string | undefined
}

/** A note. */
export type WardleyNote = {
  /** The text. */
  text: string
  /** Evolution. */
  x: number
  /** Visibility. */
  y: number
}

/** An accelerator or deaccelerator. */
export type WardleyForce = {
  /** The name. */
  name: string
  /** Evolution. */
  x: number
  /** Visibility. */
  y: number
}

/** The axes. Pele's `xLabel` and `yLabel` are never set by the parser, so they are left out. */
export type WardleyAxes = {
  /** The right edge of each stage, from 0 to 1. */
  stageBoundaries: number[] | undefined
  /** The stage names. */
  stages: string[] | undefined
}

/** `WardleyAxes::default()`. */
export function wardleyAxesDefault(): WardleyAxes {
  return { stageBoundaries: undefined, stages: undefined }
}

/** What {@link wardleyBuilderBuild} returns: Pele's `WardleyBuildResult`. */
export type WardleyBuildResult = {
  /** Accelerators. */
  accelerators: WardleyForce[]
  /** Annotations. */
  annotations: WardleyAnnotation[]
  /** Where the annotation list goes, as `(x, y)`. */
  annotationsBox: [number, number] | undefined
  /** The axes. */
  axes: WardleyAxes
  /** Deaccelerators. */
  deaccelerators: WardleyForce[]
  /** Links. */
  links: WardleyLink[]
  /** Nodes, in the order they were first added. */
  nodes: WardleyNode[]
  /** Notes. */
  notes: WardleyNote[]
  /** Pipelines, in the order their parents first started one. */
  pipelines: WardleyPipeline[]
  /** The size, as `(width, height)`. */
  size: [number, number] | undefined
  /** Trends, in the order their nodes first got one. */
  trends: WardleyTrend[]
}

/** `WardleyBuildResult::default()`. */
export function wardleyBuildResultDefault(): WardleyBuildResult {
  return {
    accelerators: [],
    annotations: [],
    annotationsBox: undefined,
    axes: wardleyAxesDefault(),
    deaccelerators: [],
    links: [],
    nodes: [],
    notes: [],
    pipelines: [],
    size: undefined,
    trends: [],
  }
}

/**
 * Mermaid's Wardley database. Pele's `Map`s become vectors in insertion order with an index by
 * id.
 */
export type WardleyBuilder = {
  /** Node index by id. */
  ids: Map<string, number>
  /** The first node id of each label, built on demand. */
  labels: Map<string, string> | undefined
  /** Pipeline index by parent id. */
  pipelineIds: Map<string, number>
  /** What `build` returns. */
  result: WardleyBuildResult
  /** Trend index by node id. */
  trendIds: Map<string, number>
}

/** `WardleyBuilder::default()`. */
export function wardleyBuilderDefault(): WardleyBuilder {
  return {
    ids: new Map(),
    labels: undefined,
    pipelineIds: new Map(),
    result: wardleyBuildResultDefault(),
    trendIds: new Map(),
  }
}

/**
 * Adds a node, or updates one with the same id. An update keeps the class and label offsets
 * unless the new node sets them.
 */
export function wardleyBuilderAddNode(builder: WardleyBuilder, node: NodeInput): void {
  const nodes = builder.result.nodes
  let at = builder.ids.get(node.id)
  if (at === undefined) {
    nodes.push(wardleyNodeDefault())
    at = nodes.length - 1
    builder.ids.set(node.id, at)
  }
  const existing = nodes[at]
  if (existing !== undefined) {
    existing.id = node.id
    existing.label = node.label
    existing.x = node.x
    existing.y = node.y
    existing.className = node.className
    if (node.labelOffsetX !== undefined) existing.labelOffsetX = node.labelOffsetX
    if (node.labelOffsetY !== undefined) existing.labelOffsetY = node.labelOffsetY
    if (node.inertia !== undefined) existing.inertia = node.inertia.value
    if (node.sourceStrategy !== undefined) existing.sourceStrategy = node.sourceStrategy.value
  }
  builder.labels = undefined
}

/** Adds a link. */
export function wardleyBuilderAddLink(builder: WardleyBuilder, link: WardleyLink): void {
  builder.result.links.push(link)
}

/** Sets the trend of a node, replacing an earlier one in its place. */
export function wardleyBuilderAddTrend(builder: WardleyBuilder, trend: WardleyTrend): void {
  const at = builder.trendIds.get(trend.nodeId)
  if (at !== undefined && at < builder.result.trends.length) {
    builder.result.trends[at] = trend
    return
  }
  builder.trendIds.set(trend.nodeId, builder.result.trends.length)
  builder.result.trends.push(trend)
}

/** Starts an empty pipeline owned by a node, replacing an earlier one in its place. */
export function wardleyBuilderStartPipeline(builder: WardleyBuilder, nodeId: string): void {
  const pipeline: WardleyPipeline = { componentIds: [], nodeId }
  const at = builder.pipelineIds.get(nodeId)
  if (at !== undefined && at < builder.result.pipelines.length) {
    builder.result.pipelines[at] = pipeline
  } else {
    builder.pipelineIds.set(nodeId, builder.result.pipelines.length)
    builder.result.pipelines.push(pipeline)
  }
  const node = nodeMut(builder, nodeId)
  if (node !== undefined) node.isPipelineParent = true
}

/** Adds a component to a pipeline. */
export function wardleyBuilderAddPipelineComponent(
  builder: WardleyBuilder,
  pipelineNodeId: string,
  componentId: string,
): void {
  const at = builder.pipelineIds.get(pipelineNodeId)
  const pipeline = at === undefined ? undefined : builder.result.pipelines[at]
  if (pipeline !== undefined) pipeline.componentIds.push(componentId)
  const node = nodeMut(builder, componentId)
  if (node !== undefined) node.inPipeline = true
}

/** Adds an annotation. */
export function wardleyBuilderAddAnnotation(builder: WardleyBuilder, annotation: WardleyAnnotation): void {
  builder.result.annotations.push(annotation)
}

/** Adds a note. */
export function wardleyBuilderAddNote(builder: WardleyBuilder, note: WardleyNote): void {
  builder.result.notes.push(note)
}

/** Adds an accelerator. */
export function wardleyBuilderAddAccelerator(builder: WardleyBuilder, accelerator: WardleyForce): void {
  builder.result.accelerators.push(accelerator)
}

/** Adds a deaccelerator. */
export function wardleyBuilderAddDeaccelerator(builder: WardleyBuilder, deaccelerator: WardleyForce): void {
  builder.result.deaccelerators.push(deaccelerator)
}

/** Places the annotation list. */
export function wardleyBuilderSetAnnotationsBox(builder: WardleyBuilder, x: number, y: number): void {
  builder.result.annotationsBox = [x, y]
}

/** Sets the axes. */
export function wardleyBuilderSetAxes(builder: WardleyBuilder, axes: WardleyAxes): void {
  builder.result.axes = axes
}

/** Sets the size. */
export function wardleyBuilderSetSize(builder: WardleyBuilder, width: number, height: number): void {
  builder.result.size = [width, height]
}

/** The node with `id`. */
export function wardleyBuilderGetNode(builder: WardleyBuilder, id: string): WardleyNode | undefined {
  const at = builder.ids.get(id)
  return at === undefined ? undefined : builder.result.nodes[at]
}

function nodeMut(builder: WardleyBuilder, id: string): WardleyNode | undefined {
  return wardleyBuilderGetNode(builder, id)
}

/**
 * A name is a node id, or else the label of the first node that has it. Pipeline components
 * have ids like `Parent_Child` and are linked by label.
 */
export function wardleyBuilderResolveNodeId(builder: WardleyBuilder, name: string): string {
  if (builder.ids.has(name)) return name
  let labels = builder.labels
  if (labels === undefined) {
    labels = new Map()
    for (const node of builder.result.nodes) {
      if (!labels.has(node.label)) labels.set(node.label, node.id)
    }
    builder.labels = labels
  }
  return labels.get(name) ?? name
}

/** The collected map. */
export function wardleyBuilderBuild(builder: WardleyBuilder): WardleyBuildResult {
  return builder.result
}
