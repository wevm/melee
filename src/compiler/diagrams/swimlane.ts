/**
 * @module Swimlane diagrams: flowcharts whose top-level subgraphs are lanes, with the same syntax
 * and model. Port of Pele's `src/diagrams/swimlane/index.ts`.
 */
import type { FlowGraph } from './flowchart/graph.ts'
import { type Variant, render } from './flowchart/render.ts'
import { LabelType } from './flowchart/types.ts'
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import { parse } from './flowchart.ts'
import { type CEdge, type CNode, type CompoundResult, Dir } from '../layout/compound.ts'
import { LANE_PAD, laneLayout } from '../layout/lanes.ts'
import type { LayeredOptions } from '../layout/layered.ts'
import { labelSvg, num } from '../svg/builder.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { ResolvedStyle } from '../svg/theme.ts'
import type { Label } from '../text/label.ts'
import type { UrlOptions } from '../util/url.ts'

/** The `swimlane` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

/** The lane that holds nodes outside every lane. */
const DEFAULT_LANE = '__swimlane_default__'

/** The flowchart variant that draws lanes. */
const VARIANT: Variant = {
  drawGroup: drawLane,
  layout,
  prepare,
  type: 'swimlane',
}

function renderInput(input: Input, options: RenderOptions, url: UrlOptions): Rendered {
  const db = parse(input.source, input.config, input.title, input.maxEdges)
  return render(db, input.config, options, url, VARIANT)
}

/**
 * Nodes outside every lane share one unnamed lane, as in Mermaid. Lanes all run the same way, so
 * a `direction` inside a subgraph has no effect.
 */
function prepare(graph: FlowGraph): void {
  let loose = false
  for (const node of graph.nodes) {
    if (node.isGroup) {
      node.dir = undefined
    } else if (node.parentId === undefined) {
      loose = true
    }
  }
  if (!loose) return

  for (const node of graph.nodes) {
    if (!node.isGroup && node.parentId === undefined) node.parentId = DEFAULT_LANE
  }
  graph.nodes.push({
    assetHeight: undefined,
    assetWidth: undefined,
    cssClasses: '',
    cssCompiledStyles: [],
    cssStyles: [],
    constraint: undefined,
    dir: undefined,
    icon: undefined,
    id: DEFAULT_LANE,
    img: undefined,
    isGroup: true,
    label: undefined,
    labelType: LabelType.Text,
    link: undefined,
    linkTarget: undefined,
    parentId: undefined,
    pos: undefined,
    shape: 'rect',
    tooltip: undefined,
  })
}

function layout(
  nodes: CNode[],
  edges: CEdge[],
  dir: Dir,
  options: LayeredOptions,
  tight: boolean,
): CompoundResult {
  return laneLayout(nodes, edges, dir, options, tight ? 12 : LANE_PAD)
}

/** A lane: an outline the length of the diagram, with its title in a band at the start. */
function drawLane(
  c: CNode,
  label: Label,
  style: ResolvedStyle,
  classes: string,
  id: string,
  dir: Dir,
): string {
  const left = c.x - c.w / 2
  const top = c.y - c.h / 2
  const sideways = dir === Dir.Lr || dir === Dir.Rl
  const cx = sideways ? left + c.padTop / 2 : c.x
  const cy = sideways ? c.y : top + c.padTop / 2
  const attrs = ' class="ondine-cluster-label" fill="var(--_m)"' + style.text
  const text = labelSvg(label, cx, cy, attrs, undefined)

  let out = `<g class="ondine-cluster ondine-lane${classes}" data-id="${id}"><rect x="${num(left)}" y="${num(top)}" width="${num(c.w)}" height="${num(c.h)}" fill="none" stroke="var(--_b)"/><rect x="${num(left)}" y="${num(top)}" width="${num(sideways ? c.padTop : c.w)}" height="${num(sideways ? c.h : c.padTop)}" fill="var(--_a)" stroke="var(--_b)"${style.shape}/>`
  if (sideways && text !== '') {
    out += `<g transform="rotate(-90 ${num(cx)} ${num(cy)})">${text}</g>`
  } else {
    out += text
  }
  out += '</g>'
  return out
}
