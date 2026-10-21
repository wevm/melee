/**
 * @module Shape names Mermaid accepts in flowchart shape data. Port of Pele's
 * `src/diagrams/flowchart/shapes.ts`.
 */

/** Mermaid's documented shape names: the short name first, then its aliases. */
const SHAPES: readonly (readonly string[])[] = [
  ['rect', 'proc', 'process', 'rectangle', 'squareRect'],
  ['rounded', 'event', 'roundedRect'],
  ['stadium', 'terminal', 'pill'],
  ['fr-rect', 'subprocess', 'subproc', 'framed-rectangle', 'subroutine'],
  ['cyl', 'db', 'database', 'cylinder'],
  ['datastore', 'data-store'],
  ['folder', 'directory'],
  ['bucket'],
  ['console'],
  ['browser'],
  ['person'],
  ['circle', 'circ'],
  ['bang'],
  ['cloud'],
  ['diam', 'decision', 'diamond', 'question'],
  ['hex', 'hexagon', 'prepare'],
  ['lean-r', 'lean-right', 'in-out', 'lean_right'],
  ['lean-l', 'lean-left', 'out-in', 'lean_left'],
  ['trap-b', 'priority', 'trapezoid-bottom', 'trapezoid'],
  ['trap-t', 'manual', 'trapezoid-top', 'inv-trapezoid', 'inv_trapezoid'],
  ['dbl-circ', 'double-circle', 'doublecircle'],
  ['text'],
  ['notch-rect', 'card', 'notched-rectangle'],
  ['lin-rect', 'lined-rectangle', 'lined-process', 'lin-proc', 'shaded-process'],
  ['sm-circ', 'start', 'small-circle', 'stateStart'],
  ['fr-circ', 'stop', 'framed-circle', 'stateEnd'],
  ['fork', 'join', 'forkJoin'],
  ['hourglass', 'collate'],
  ['brace', 'comment', 'brace-l'],
  ['brace-r'],
  ['braces'],
  ['bolt', 'com-link', 'lightning-bolt'],
  ['doc', 'document'],
  ['delay', 'half-rounded-rectangle'],
  ['h-cyl', 'das', 'horizontal-cylinder'],
  ['lin-cyl', 'disk', 'lined-cylinder'],
  ['curv-trap', 'curved-trapezoid', 'display'],
  ['div-rect', 'div-proc', 'divided-rectangle', 'divided-process'],
  ['tri', 'extract', 'triangle'],
  ['win-pane', 'internal-storage', 'window-pane'],
  ['f-circ', 'junction', 'filled-circle'],
  ['notch-pent', 'loop-limit', 'notched-pentagon'],
  ['flip-tri', 'manual-file', 'flipped-triangle'],
  ['sl-rect', 'manual-input', 'sloped-rectangle'],
  ['docs', 'documents', 'st-doc', 'stacked-document'],
  ['st-rect', 'procs', 'processes', 'stacked-rectangle'],
  ['bow-rect', 'stored-data', 'bow-tie-rectangle'],
  ['cross-circ', 'summary', 'crossed-circle'],
  ['tag-doc', 'tagged-document'],
  ['tag-rect', 'tagged-rectangle', 'tag-proc', 'tagged-process'],
  ['flag', 'paper-tape'],
  ['odd', 'rect_left_inv_arrow'],
  ['lin-doc', 'lined-document'],
]

/** Shapes Mermaid accepts by name without documenting them. */
const INTERNAL: readonly string[] = [
  'state',
  'choice',
  'note',
  'composite',
  'rectWithTitle',
  'labelRect',
  'block_arrow',
  'collapsedGroup',
  'iconSquare',
  'iconCircle',
  'icon',
  'iconRounded',
  'imageSquare',
  'anchor',
  'kanbanItem',
  'mindmapCircle',
  'defaultMindmapNode',
  'classBox',
  'erBox',
  'requirementBox',
  'usecaseActor',
  'usecaseActorHollow',
  'usecaseActorAwesome',
  'usecaseActorIcon',
  'usecaseBusiness',
  'usecaseEllipse',
  'usecaseJsonTable',
]

/** Shapes produced by the bracket syntax, mapped to their documented names. */
const SYNTAX: readonly (readonly [string, string])[] = [
  ['square', 'rect'],
  ['round', 'rounded'],
  ['ellipse', 'ellipse'],
  ['hexagon', 'hex'],
  ['diamond', 'diam'],
]

/** The documented name of every shape name and alias, and of every internal shape its own name. */
const CANONICAL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const own of INTERNAL) if (!map.has(own)) map.set(own, own)
  for (const names of SHAPES) {
    for (const name of names) if (!map.has(name)) map.set(name, names[0] as string)
  }
  return map
})()

/** The documented names of the shapes the bracket syntax produces. */
const SYNTAX_NAMES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [syntax, name] of SYNTAX) if (!map.has(syntax)) map.set(syntax, name)
  return map
})()

/** The documented name of a shape name or alias, or the name itself for an internal shape. */
function canonical(name: string): string | undefined {
  return CANONICAL.get(name)
}

/** Whether Mermaid accepts `name` in shape data. */
export function isValidShape(name: string): boolean {
  return canonical(name) !== undefined
}

/** The documented name of a node's shape, `rect` when it has none or an unknown one. */
export function canonicalShape(name: string | undefined): string {
  if (name === undefined) return 'rect'

  const syntax = SYNTAX_NAMES.get(name)
  if (syntax !== undefined) return syntax

  return canonical(name) ?? 'rect'
}
