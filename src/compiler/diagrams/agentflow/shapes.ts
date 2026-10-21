/**
 * @module The shapes an agentflow draws, their author-facing aliases, and the reduction of every other
 * shape to the default. Port of Pele's `src/diagrams/agentflow/shapes.ts`.
 */
import { type AgentflowDb, agentflowDbEmit } from './db.ts'
import type { GraphNode } from './graph.ts'
import { isValidShape as flowchartIsValidShape } from '../flowchart/shapes.ts'

/** Whether agentflow removed `shape` in v0.8.1. */
function isRemovedShape(shape: string): boolean {
  switch (shape) {
    case 'doc':
    case 'stadium':
    case 'terminal':
    case 'circle':
    case 'trapezoid':
    case 'inv_trapezoid':
    case 'inv-trapezoid':
    case 'doublecircle':
    case 'double-circle':
    case 'typeDeclaration':
    case 'procs':
    case 'lean_left':
    case 'lean-left':
    case 'in-out':
    case 'cylinder':
    case 'ellipse':
    case 'odd':
    case 'tag-rect':
    case 'tagged-rectangle':
    case 'delay':
    case 'half-rounded-rectangle':
    case 'lin-rect':
    case 'lined-rectangle':
    case 'win-pane':
    case 'window-pane':
    case 'curv-trap':
    case 'curved-trapezoid':
      return true
    default:
      return false
  }
}

/** Whether agentflow draws `shape`. */
function isAllowedShape(shape: string): boolean {
  switch (shape) {
    case 'roundedRect':
    case 'subroutine':
    case 'subprocess':
    case 'subproc':
    case 'framed-rectangle':
    case 'lean-right':
    case 'diamond':
    case 'lin-doc':
    case 'lined-document':
    case 'hexagon':
    case 'hex':
    case 'connector':
    case 'collapsedGroup':
      return true
    default:
      return false
  }
}

/** The shape of a node that names none, or one agentflow does not draw. */
export const DEFAULT_SHAPE = 'roundedRect'

/**
 * The shape an alias stands for, or `shape` itself. The aliases are the author-facing names for
 * the shapes that carry meaning in an agentflow.
 */
export function resolveShapeAlias(shape: string): string {
  switch (shape) {
    case 'task':
      return 'roundedRect'
    case 'tool':
      return 'subroutine'
    case 'input':
      return 'lean-right'
    case 'decision':
      return 'diamond'
    case 'refdoc':
      return 'lin-doc'
    case 'action':
      return 'hexagon'
    case 'round':
      return 'rect'
    default:
      return shape
  }
}

/**
 * Whether `name` is a shape. Mermaid looks a shape name up with `in` on a plain object, so
 * `constructor` passes there too.
 */
export function isValidShape(name: string): boolean {
  return flowchartIsValidShape(name) || name === 'constructor'
}

/** Reduces every node's shape to one agentflow draws, reporting the removed and unsupported ones. */
export function normaliseNodeShapes(nodes: GraphNode[], db: AgentflowDb): void {
  for (const node of nodes) {
    if (node.isGroup) continue
    if (node.shape === '' || node.shape === 'squareRect' || node.shape === 'rect') node.shape = DEFAULT_SHAPE

    if (isRemovedShape(node.shape)) {
      const message = `shape "${node.shape}" was removed in v0.8.1, using "${DEFAULT_SHAPE}"`
      agentflowDbEmit(db, 'SHAPE_REMOVED', 'error', message, node.id)
      node.shape = DEFAULT_SHAPE
    } else if (!isAllowedShape(node.shape)) {
      const message = `shape "${node.shape}" is not supported, using "${DEFAULT_SHAPE}"`
      agentflowDbEmit(db, 'SHAPE_UNSUPPORTED', 'warning', message, node.id)
      node.shape = DEFAULT_SHAPE
    }
  }
}
