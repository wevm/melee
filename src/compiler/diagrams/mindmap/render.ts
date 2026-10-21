/**
 * @module Draws a mindmap: branches spreading to both sides of the root, or an indented outline
 * running down when that is narrower. Port of Pele's `src/diagrams/mindmap/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { titleRoom, turnToFit } from '../common/fit_width.ts'
import { iconSvg } from '../common/icon.ts'
import { escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { type RenderOptions, accessibleDefault, svgDocument } from '../../svg/root.ts'
import { drawShape, shapeInset, shapeSize } from '../../svg/shapes.ts'
import { classNames, seriesColor } from '../../svg/theme.ts'
import { type IconResolver, iconMarkup } from '../../text/icons.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import type { Value } from '../../yaml.ts'
import { fmax, fmin, midpoint } from '../../util/rust.ts'
import type { MindmapDb, MindmapNode } from './db.ts'

/** Indexed by Mermaid's node type. A node without delimiters is text on a line, except the root. */
const SHAPES: readonly string[] = ['', 'rounded', 'rect', 'circle', 'cloud', 'bang', 'hex']
const ROOT_SHAPE = 'stadium'

const GAP_X = 36.0
const GAP_Y = 8.0
/** Between two subtrees, of which at least one has children of its own. */
const GROUP_GAP = 18.0
const BRANCH_GAP_X = 52.0
const BRANCH_GAP_Y = 28.0
const TEXT_PAD = 6.0
const PILL_PAD = 12.0
const TINT = '0.22'
const ICON_GAP = 6.0
/**
 * Running down, each level is set in by this much, and links leave a node this far from its left
 * edge.
 */
const INDENT = 28.0
const STEM = 12.0
const BEND = 8.0
const ROW_GAP = 10.0

const LABEL_ATTRS = ' class="ondine-label"'

/** A property of a YAML mapping, as JavaScript's `value.key` reads it. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  const entries = value._0
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k]!
    if (entry[0] === key) return entry[1]
  }
  return undefined
}

/** JavaScript's truthiness of a number, as `a || b` reads it. */
function truthy(value: number): boolean {
  return value !== 0.0 && !Number.isNaN(value)
}

/**
 * A label with each line starting at `left`, for an outline, where centered lines would look
 * ragged.
 */
function leftLabel(label: Label, left: number, cy: number, icons: IconResolver | undefined): string {
  if (label.lines.length < 2) {
    return labelSvg(label, left + label.width / 2.0, cy, LABEL_ATTRS, icons)
  }
  let out = ''
  const count = label.lines.length
  const pairs = Math.min(label.lines.length, label.widths.length)
  for (let k = 0; k < pairs; k++) {
    const line = label.lines[k]!
    const width = label.widths[k]!
    const single: Label = {
      height: label.lineHeight,
      lineHeight: label.lineHeight,
      lines: [line.slice()],
      size: label.size,
      width,
      widths: [width],
    }
    const y = cy + (k - (count - 1.0) / 2.0) * label.lineHeight
    out += labelSvg(single, left + width / 2.0, y, LABEL_ATTRS, icons)
  }
  return out
}

/** Draws `model` with the `mindmap` section of `config`, running down when across does not fit. */
export function render(
  model: MindmapDb,
  config: Value,
  options: RenderOptions,
  icons: IconResolver | undefined,
): Rendered {
  return turnToFit(options, (down) => draw(model, config, options, icons, down))
}

/**
 * The height at which the parent's anchor belongs, from the last {@link stack}. A module-level
 * scalar rather than a returned tuple, so the hot loop allocates nothing.
 */
let stackMiddle = 0.0

/**
 * Stacks the subtrees `list[from..to]` top to bottom, setting their offsets in `rel`. Returns
 * the stacked height, and sets {@link stackMiddle} to the height at which their parent's anchor
 * belongs.
 */
function stack(
  nodes: readonly MindmapNode[],
  list: readonly number[],
  from: number,
  to: number,
  gap: number,
  rel: number[],
  extent: readonly number[],
  own: readonly number[],
  anchor: readonly number[],
): number {
  let y = 0.0
  let last = 0.0
  for (let k = from; k < to; k++) {
    const c = list[k]!
    rel[c] = y
    const grouped = nodes[c]!.children.length > 0 || (k + 1 < to && nodes[list[k + 1]!]!.children.length > 0)
    last = grouped ? fmax(gap, GROUP_GAP) : gap
    y += extent[c]! + last
  }
  const stacked = y - last
  if (from >= to) {
    stackMiddle = Number.NaN
    return stacked
  }
  const a = list[from]!
  const b = list[to - 1]!
  stackMiddle = (rel[a]! + own[a]! + anchor[a]! + rel[b]! + own[b]! + anchor[b]!) / 2.0
  return stacked
}

/** Zeros, `n` long, packed. */
function zeros(n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(0)
  return out
}

/** The opening of a node's link path. */
const EDGE_OPEN = '<path class="ondine-edge" d="M'

/**
 * Draws the map. `down` draws it as an outline: the root at the top, and each level set in under
 * its parent. It is far narrower than branches spreading to both sides, and as tall as it needs
 * to be.
 *
 * Every node's children are later nodes (`children` holds indexes the database appended), so
 * each per-node array below is read only at indexes under `n`.
 */
function draw(
  model: MindmapDb,
  config: Value,
  options: RenderOptions,
  icons: IconResolver | undefined,
  down: boolean,
): Rendered {
  const size = options.fontSize ?? 16.0
  const pad = options.padding ?? 8.0
  const conf = property(config, 'mindmap')
  const maxNodeWidth = conf === undefined ? undefined : property(conf, 'maxNodeWidth')
  const wrap =
    maxNodeWidth !== undefined && maxNodeWidth.kind === 'Number' && maxNodeWidth._0 > 0.0
      ? fmin(maxNodeWidth._0, 2000.0)
      : 200.0
  const glyph = size * 1.25

  const nodes = model.nodes
  const n = nodes.length
  const parent = zeros(n)
  const depth = zeros(n)
  for (let i = 0; i < n; i++) {
    const children = nodes[i]!.children
    const own = depth[i]!
    for (let k = 0; k < children.length; k++) {
      const child = children[k]!
      parent[child] = i
      depth[child] = own + 1
    }
  }

  // An outline has the width the host gives it, less what its level is set in.
  const maxWidth = options.maxWidth
  const room = maxWidth !== undefined && down && maxWidth > 0.0 ? maxWidth - 2.0 * pad : Number.POSITIVE_INFINITY
  const labels: Label[] = []
  const shapes: string[] = []
  const w = zeros(n)
  const h = zeros(n)
  const dy = zeros(n)
  // Where links meet the node, measured down from its top: its middle.
  const anchor = zeros(n)
  // Whether the host has the node's icon. One it does not have takes no room.
  const drawn: boolean[] = []
  const minHeight = jsRound(size * 1.5)

  for (let i = 0; i < n; i++) {
    const node = nodes[i]!
    const hasIcon = node.icon !== undefined && iconMarkup(icons, node.icon) !== ''
    const iconRoom = hasIcon ? glyph + ICON_GAP : 0.0
    const level = depth[i]!
    const fit = fmin(wrap, fmax(72.0, room - level * INDENT - 2.0 * TEXT_PAD - iconRoom))
    const label = layoutLabel(node.descr, true, size, fit, 0, icons)
    const tw = label.width + (hasIcon ? glyph + (label.width > 0.0 ? ICON_GAP : 0.0) : 0.0)
    const th = fmax(label.height, minHeight)
    const own = SHAPES[node.kind]
    let shape = own !== undefined && own !== '' ? own : i === 0 ? ROOT_SHAPE : ''
    // In an outline the root heads a column, and the trunk drops from under its left end. A
    // circle or a cloud would stand wide of that, so the root is a pill there unless it is a
    // box already.
    if (down && i === 0 && shape !== 'rect' && shape !== 'rounded') {
      shape = ROOT_SHAPE
    }
    if (shape === '') {
      // A node with no shape of its own is plain text when it ends a branch, and text in a
      // tinted pill when the branch goes on from it, which sets the levels apart.
      const pill = node.children.length > 0
      const hi = th + (pill ? 6.0 : 0.0)
      w[i] = tw + 2.0 * (pill ? PILL_PAD : TEXT_PAD)
      h[i] = hi
      anchor[i] = hi / 2.0
    } else {
      const s = shapeSize(shape, tw, th)
      w[i] = s.w
      h[i] = s.h
      dy[i] = s.dy
      anchor[i] = s.h / 2.0
    }
    drawn.push(hasIcon)
    labels.push(label)
    shapes.push(shape)
  }

  // Each subtree takes a band of height `extent`. `rel` is a subtree's offset among its
  // siblings, `own` the node's offset inside its band, and `kids` the offset of its children's
  // bands.
  const extent = zeros(n)
  const rel = zeros(n)
  const own = zeros(n)
  const kids = zeros(n)

  // Nodes are in depth-first order, so going backwards visits children before their parent.
  for (let i = n - 1; i >= 1; i--) {
    const children = nodes[i]!.children
    const hi = h[i]!
    if (children.length === 0) {
      extent[i] = hi
      continue
    }
    const stacked = stack(nodes, children, 0, children.length, GAP_Y, rel, extent, own, anchor)
    const top = stackMiddle - anchor[i]!
    const low = fmin(top, 0.0)
    extent[i] = fmax(stacked, top + hi) - low
    own[i] = top - low
    kids[i] = -low
  }

  const x = zeros(n)
  const y = zeros(n)
  const band = zeros(n)
  const side = zeros(n)
  // Running down: how far the trunk under each node has been drawn.
  const trunk = zeros(n)

  if (down) {
    // Nodes are in depth-first order, which is the order of an outline's rows.
    let row = 0.0
    for (let i = 0; i < n; i++) {
      if (i > 0 && parent[i] === 0) {
        row += ROW_GAP
      }
      x[i] = depth[i]! * INDENT + w[i]! / 2.0
      y[i] = row
      row += h[i]! + ROW_GAP
    }
  } else if (n > 0) {
    // The first branches go right and the rest left, split where the two sides are closest
    // in height.
    const branches = nodes[0]!.children
    const count = branches.length
    let total = 0
    for (let k = 0; k < count; k++) total += extent[branches[k]!]!
    let split = count
    let best = Number.POSITIVE_INFINITY
    let right = 0.0
    for (let k = 1; k < count; k++) {
      right += extent[branches[k - 1]!]!
      const diff = Math.abs(2.0 * right - total + (2.0 * k - count) * BRANCH_GAP_Y)
      if (diff < best) {
        best = diff
        split = k
      }
    }
    for (let r = 0; r < 2; r++) {
      const from = r === 0 ? 0 : split
      const to = r === 0 ? split : count
      if (from >= to) continue
      const dir = r === 0 ? 1.0 : -1.0
      stack(nodes, branches, from, to, BRANCH_GAP_Y, rel, extent, own, anchor)
      const middle = stackMiddle
      for (let k = from; k < to; k++) {
        const c = branches[k]!
        band[c] = rel[c]! - middle
        side[c] = dir
      }
    }
    y[0] = -h[0]! / 2.0
    for (let i = 0; i < n; i++) {
      const children = nodes[i]!.children
      if (i > 0) {
        y[i] = band[i]! + own[i]!
      }
      const wi = w[i]!
      const xi = x[i]!
      for (let k = 0; k < children.length; k++) {
        const c = children[k]!
        if (i > 0) {
          side[c] = side[i]!
          band[c] = band[i]! + kids[i]! + rel[c]!
        }
        const gap = i > 0 ? GAP_X : BRANCH_GAP_X
        x[c] = xi + side[c]! * (wi / 2.0 + gap + w[c]! / 2.0)
      }
    }
  }

  let minX = 0.0
  let maxX = 0.0
  let minY = 0.0
  let maxY = 0.0
  let out = ''
  let edges = ''
  let body = ''
  let color = ''

  // The root is drawn last, on top of the links that leave it.
  for (let k = 1; k <= n; k++) {
    const i = k % n
    const node = nodes[i]!
    const shape = shapes[i]!
    const label = labels[i]!
    const wi = w[i]!
    const hi = h[i]!
    const cx = x[i]!
    const top = y[i]!
    minX = fmin(minX, cx - wi / 2.0)
    maxX = fmax(maxX, cx + wi / 2.0)
    minY = fmin(minY, top)
    maxY = fmax(maxY, top + hi)

    const p = parent[i]!
    if ((i === 0 || p === 0) && body !== '') {
      const section = nodes[k - 1]!.section
      out += `<g class="ondine-branch ondine-section-${num(section ?? 0)}"><g class="ondine-edges" fill="none" stroke="${color}" stroke-width="1.5">${edges}</g>${body}</g>`
      edges = ''
      body = ''
    }
    if (i > 0 && p === 0) {
      color = seriesColor(node.section ?? 0)
    }
    const wp = w[p]!
    const hp = h[p]!
    if (i > 0 && down) {
      // The link drops from under its parent and turns in to the node's left. It starts
      // where the link to the sibling above turned in, so each stretch of a shared trunk
      // has one color. Under the root's rounded end, the trunk starts where that end has
      // come down to the bottom.
      const stem = p === 0 ? fmin(fmax(STEM, h[0]! / 2.0), INDENT - BEND) : STEM
      const x1 = x[p]! - wp / 2.0 + fmin(stem, wp / 2.0)
      const drawnTo = trunk[p]!
      const y1 = truthy(drawnTo) ? drawnTo : y[p]! + hp
      const left = cx - wi / 2.0
      const x2 = left + (shape === '' ? 0.0 : shapeInset(shape, wi, hi, 3, 0.0))
      const y2 = top + anchor[i]!
      const bend = fmax(fmin(fmin(BEND, x2 - x1), y2 - y1), 0.0)
      // The next link carries on from where this one leaves the trunk, so the trunk has no
      // gap.
      trunk[p] = y2 - bend
      edges += `${EDGE_OPEN}${num(x1)},${num(y1)}V${num(y2 - bend)}Q${num(x1)},${num(y2)} ${num(x1 + bend)},${num(y2)}H${num(x2)}"/>`
    } else if (i > 0) {
      const dir = side[i]!
      const from = dir > 0.0 ? 1 : 3
      const parentShape = shapes[p]!
      const x1 = x[p]! + dir * (wp / 2.0 - (parentShape === '' ? 0.0 : shapeInset(parentShape, wp, hp, from, 0.0)))
      const y1 = y[p]! + anchor[p]!
      const near = cx - (dir * wi) / 2.0
      const x2 = near + (shape === '' ? 0.0 : dir * shapeInset(shape, wi, hi, 4 - from, 0.0))
      const y2 = top + anchor[i]!
      const mid = num(midpoint(x1, x2))
      const sy1 = num(y1)
      const sy2 = num(y2)
      edges += `${EDGE_OPEN}${num(x1)},${sy1}C${mid},${sy1} ${mid},${sy2} ${num(x2)},${sy2}"/>`
    }

    const pill = shape === '' && node.children.length > 0
    // Every node off the root is filled with a tint of its branch's color and outlined in
    // it, whether its shape was given in the source or is the pill of a node that branches.
    // The root is neutral.
    let inner = ''
    if (shape !== '') {
      if (i > 0) {
        inner = drawShape(
          shape,
          wi,
          hi,
          ` fill="${color}" fill-opacity="${TINT}" stroke="${color}"`,
          ` stroke="${color}"`,
        )
      } else {
        inner = drawShape(shape, wi, hi, ' fill="var(--_s)" stroke="var(--_b)"', ' stroke="var(--_b)"')
      }
    } else if (pill) {
      inner = `<rect x="${num(-wi / 2.0)}" y="${num(-hi / 2.0)}" width="${num(wi)}" height="${num(hi)}" rx="${num(hi / 2.0)}" fill="${color}" fill-opacity="${TINT}" stroke="${color}"/>`
    }
    let shift = 0.0
    const icon = node.icon
    if (icon !== undefined && icon !== '' && drawn[i] === true) {
      shift = midpoint(glyph, label.width > 0.0 ? ICON_GAP : 0.0)
      inner += iconSvg(icon, -shift - label.width / 2.0, dy[i]! - glyph / 2.0, glyph, icons)
    }

    const text =
      down && shape === ''
        ? leftLabel(label, shift - label.width / 2.0, dy[i]!, icons)
        : labelSvg(label, shift, dy[i]!, LABEL_ATTRS, icons)
    const group = `<g class="ondine-node ondine-shape-${shape !== '' ? shape : pill ? 'branch' : 'text'}${i === 0 ? ' ondine-root' : ''}${classNames(node.class ?? '')}" data-id="${escText(node.nodeId)}" transform="translate(${num(cx)},${num(top + hi / 2.0)})">${inner}${text}</g>`
    if (i > 0) body += group
    else out += group
  }

  const title = layoutLabel(model.title, false, size, titleRoom(options), BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 16.0 : 0.0
  const width = fmax(maxX - minX, title.width)
  const totalWidth = Math.ceil(width + 2.0 * pad)
  const totalHeight = Math.ceil(maxY - minY + titleHeight + 2.0 * pad)
  const content = `${labelSvg(title, totalWidth / 2.0, pad + title.height / 2.0, ' class="ondine-title" font-weight="var(--_tw)"', undefined)}<g transform="translate(${num(pad - minX + midpoint(width - maxX, minX))},${num(pad + titleHeight - minY)})">${out}</g>`

  return {
    height: totalHeight,
    links: [],
    svg: svgDocument('mindmap', totalWidth, totalHeight, size, options, accessibleDefault(), content),
    width: totalWidth,
  }
}
