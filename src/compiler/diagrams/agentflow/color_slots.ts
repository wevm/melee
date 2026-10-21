/**
 * @module Palette slots for nodes and containers. Port of Pele's `src/diagrams/agentflow/colorSlots.ts`.
 *
 * Two rules, as in Mermaid: a node takes the color of its kind, from a fixed slot, so editing the
 * diagram around it never recolors it. Containers count through the slots above the kinds, in
 * the order they were declared, so a frame does not take the color of a node inside it.
 */
import type { GraphNode } from './graph.ts'

/** Each kind's slot. Slot order is observable, so the list keeps Pele's order. */
export const KIND_SLOT: readonly [string, number][] = [
  ['tool', 0],
  ['task', 1],
  ['decision', 2],
  ['input', 3],
  ['refdoc', 4],
  ['connector', 5],
  ['action', 6],
]

/** The number of kinds. */
export const KIND_COUNT = 7

/** The slot of `kind`. */
export function kindSlot(kind: string): number | undefined {
  // `KIND_SLOT` as a switch.
  switch (kind) {
    case 'tool':
      return 0
    case 'task':
      return 1
    case 'decision':
      return 2
    case 'input':
      return 3
    case 'refdoc':
      return 4
    case 'connector':
      return 5
    case 'action':
      return 6
    default:
      return undefined
  }
}

/**
 * The slot of the `n`th container. At least one slot is kept for containers, so that a palette
 * shorter than the kinds still gives them one.
 */
function containerSlot(n: number, paletteLength: number): number {
  const count = Math.max(paletteLength > KIND_COUNT ? paletteLength - KIND_COUNT : 0, 1)
  const slot = KIND_COUNT + (n % count)
  return paletteLength > 0 ? slot % paletteLength : slot
}

/**
 * Gives every container its slot and every node its kind. `kindOf` names a node's kind, and
 * `containerOrder` numbers the containers in the order they were written.
 */
export function assignColorSlots(
  nodes: GraphNode[],
  kindOf: (id: string) => string | undefined,
  containerOrder: Map<string, number>,
  paletteLength: number,
): void {
  let fallback = containerOrder.size
  for (const node of nodes) {
    // A collapsed container is drawn as a node but keeps its slot, so collapsing one does not
    // recolor the containers after it.
    if (node.isGroup || node.shape === 'collapsedGroup') {
      let n = containerOrder.get(node.id)
      if (n === undefined) {
        n = fallback
        fallback += 1
      }
      node.colorIndex = containerSlot(n, paletteLength)
      continue
    }
    const kind = kindOf(node.id)
    if (kind !== undefined && kindSlot(kind) !== undefined) node.kind = kind
  }
}
