/** @module Draws an Ishikawa diagram. Port of Pele's `src/diagrams/ishikawa/render.ts`. */
import { type IshikawaDb, ishikawaDbRoot } from './db.ts'
import type { Rendered } from '../../diagrams.ts'
import { titleRoom, turnToFit } from '../common/fit_width.ts'
import { breakLabel } from '../common/literal_label.ts'
import { escText, jsRound, labelSvg, num, pushNum } from '../../svg/builder.ts'
import { ARROW, marker } from '../../svg/edges.ts'
import { type RenderOptions, accessibleDefault, svgDocument } from '../../svg/root.ts'
import { RADIUS } from '../../svg/theme.ts'
import { type Label, labelDefault, layoutLabel } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { buf, fmax, fmin } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'

/** How far a bone moves toward the tail for each unit it rises from the spine. */
const SLANT = 0.5
const FIRST_ROW = 14.0
const ROW_GAP = 6.0
const BONE_END = 8.0
const TWIG_STEP = 22.0
const STUB = 18.0
const TEXT_GAP = 5.0
const PAIR_GAP = 26.0
const HEAD_GAP = 34.0
const TAIL = 28.0
const BOX_PAD_X = 10.0
const BOX_PAD_Y = 5.0

/** Pele's `Math.hypot(SLANT, 1)`: V8 sums the squares of each value over the larger, 1 here. */
function length(): number {
  return Math.sqrt(SLANT * SLANT + 1.0)
}

/**
 * A cause below a category. Bones at even depths run level, from the slanted bone above them
 * toward the tail. Bones at odd depths slant away from the spine, from the level bone above them.
 */
type Bone = {
  /**
   * Where it meets its parent, measured level from the category's bone: 0 on it, negative
   * toward the tail.
   */
  at: number
  depth: number
  kids: number
  label: Label
  parent: number | undefined
  /** How far its row is from the spine. */
  rise: number
  /** Its place among its siblings, counted from the spine outward. */
  slot: number
  /** Where its text ends. */
  textEnd: number
}

type Category = {
  bones: Bone[]
  boxH: number
  boxW: number
  label: Label
  /** How far its causes reach toward the tail, measured level from its bone. */
  reach: number
  /** The length of its bone, as distance from the spine. */
  rise: number
  text: string
}

type Frame = {
  /** Set when the bone was made and only its row is still to come. */
  bone: number | undefined
  depth: number
  node: number
  parent: number | undefined
  slot: number
}

/** {@link pushNumber} of `value`, as a string. */
function numberText(value: number): string {
  const out = buf()
  pushNumber(out, value)
  return out.s
}

function usizeF64(value: number): number {
  return Math.min(value, 4294967295)
}

/** Pushes the frames of `node`'s children, the first to be popped first. */
function pushChildren(
  model: IshikawaDb,
  stack: Frame[],
  node: number,
  depth: number,
  parent: number | undefined,
  up: boolean,
): void {
  const own = model.nodes[node]
  if (own === undefined) return
  const children = own.children
  const n = children.length
  for (let slot = n - 1; slot >= 0; slot--) {
    const child = children[up ? n - 1 - slot : slot]
    if (child !== undefined) {
      stack.push({ bone: undefined, depth, node: child, parent, slot })
    }
  }
}

/**
 * Gives every cause of a category a row of its own, so that no two texts can meet, and measures
 * how far the whole of it reaches. A level bone takes the row nearest the spine and its twigs
 * the rows beyond. A slanted twig takes the row beyond everything that hangs off it. The outline
 * may be nested as deep as its indentation goes, so the walk keeps a stack of its own.
 */
function arrange(model: IshikawaDb, node: number, up: boolean, size: number, small: number): Category {
  const text = model.nodes[node]?.text ?? ''
  const label = layoutLabel(text, false, size, 180.0, 0, undefined)
  const lineHeight = jsRound(small * 1.5)
  const bones: Bone[] = []
  const rows: number[] = []
  const stack: Frame[] = []

  // Above the spine the first cause goes farthest out, so that the causes read from the top down.
  pushChildren(model, stack, node, 2, undefined, up)
  for (;;) {
    const frame = stack.pop()
    if (frame === undefined) break
    if (frame.bone !== undefined) {
      rows.push(frame.bone)
      continue
    }
    const index = bones.length
    const own = model.nodes[frame.node]
    bones.push({
      at: 0.0,
      depth: frame.depth,
      kids: own === undefined ? 0 : own.children.length,
      label: layoutLabel(own?.text, false, small, 200.0, 0, undefined),
      parent: frame.parent,
      rise: 0.0,
      slot: frame.slot,
      textEnd: 0.0,
    })
    const child = frame.node
    const depth = frame.depth
    if (depth % 2 === 0) {
      rows.push(index)
    } else {
      frame.bone = index
      stack.push(frame)
    }
    pushChildren(model, stack, child, depth + 1, index, up)
  }

  let rise = FIRST_ROW
  for (let k = 0; k < rows.length; k++) {
    const bone = bones[rows[k]!]
    if (bone !== undefined) {
      const height = fmax(bone.label.height, lineHeight) + ROW_GAP
      bone.rise = rise + height / 2.0
      rise += height
    }
  }
  const boxW = label.width + 2.0 * BOX_PAD_X
  let reach = boxW / 2.0
  for (let index = 0; index < bones.length; index++) {
    const bone = bones[index] as Bone
    const parentBone = bone.parent === undefined ? undefined : bones[bone.parent]
    if (bone.depth % 2 === 0) {
      bone.at = parentBone === undefined ? 0.0 : parentBone.at
      bone.textEnd = bone.at - (bone.kids > 0 ? usizeF64(bone.kids + 1) * TWIG_STEP : STUB) - TEXT_GAP
    } else {
      // Twigs stand along their level bone, the one nearest the spine nearest the tail.
      const at = parentBone === undefined ? 0.0 : parentBone.at
      const kids = parentBone === undefined ? 0 : parentBone.kids
      bone.at = at - (usizeF64(kids) - usizeF64(bone.slot)) * TWIG_STEP
      bone.textEnd = bone.at - TEXT_GAP
    }
    reach = fmax(reach, bone.label.width - bone.textEnd)
  }
  return {
    bones,
    boxH: label.height + 2.0 * BOX_PAD_Y,
    boxW,
    label,
    reach,
    rise: rise + BONE_END,
    text,
  }
}

/** Draws an Ishikawa diagram, turned to run down when it does not fit the host's width. */
export function render(model: IshikawaDb, options: RenderOptions): Rendered {
  return turnToFit(options, (down) => draw(model, options, down))
}

function draw(model: IshikawaDb, options: RenderOptions, down: boolean): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8.0
  if (down) return verticalCauses(model, options)
  const title = layoutLabel(model.title, false, size, 4000.0, BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 12.0 : 0.0

  let body = ''
  let minX = 0.0
  let maxX = 0.0
  let minY = 0.0
  let maxY = 0.0
  const root = ishikawaDbRoot(model)
  if (root !== undefined) {
    const head = layoutLabel(root.text, false, size, 200.0, BOLD, undefined)
    const headH = fmax(head.height + 24.0, 48.0)
    const headW = head.width + 24.0 + headH / 2.0
    const categories: Category[] = []
    for (let i = 0; i < root.children.length; i++) {
      categories.push(arrange(model, root.children[i]!, i % 2 === 0, size, small))
    }
    // Even a category without causes has a bone long enough to carry its name clear of the head.
    for (const category of categories) {
      category.rise = fmax(category.rise, headH / 2.0 + 14.0)
    }

    // Categories meet the spine in pairs, one above and one below, each pair as far toward the
    // tail from the one before as the wider of the two needs.
    const xs: number[] = []
    let x = -HEAD_GAP
    let i = 0
    while (i < categories.length) {
      if (i > 0) {
        let room = 0.0
        for (let side = 0; side < 2; side++) {
          const before = categories[i - 2 + side]
          const next = categories[i + side]
          if (before !== undefined) {
            room = fmax(room, before.reach + (next === undefined ? 0.0 : next.boxW / 2.0))
          }
        }
        x -= room + PAIR_GAP
      }
      xs.push(x)
      xs.push(x)
      i += 2
    }
    const tail = categories.length === 0 ? -HEAD_GAP : x - TAIL

    maxX = headW
    minX = tail
    minY = -headH / 2.0
    maxY = headH / 2.0
    const len = length()
    const fontSize = numberText(small)
    let groups = ''
    for (let i = 0; i < categories.length; i++) {
      const category = categories[i]!
      const sign = i % 2 === 0 ? -1.0 : 1.0
      const ax = xs[i] ?? 0.0
      // `ax + at - rise * SLANT` is where a bone at `at` meets the row `rise` from the spine.
      const endX = ax + 0.0 - category.rise * SLANT
      const endY = sign * category.rise
      // The bone stops short of the spine to leave its arrowhead a clean point.
      const trim = ARROW - 1.0
      let d = `M${num(ax - (SLANT / len) * trim)},${num((sign * trim) / len)}L${num(endX)},${num(endY)}`
      let texts = ''
      const bones = category.bones
      for (let k = 0; k < bones.length; k++) {
        const bone = bones[k]!
        const y = sign * bone.rise
        if (bone.depth % 2 === 0) {
          d += `M${num(ax + bone.at - bone.rise * SLANT)},${num(y)}H${num(ax + (bone.textEnd + TEXT_GAP) - bone.rise * SLANT)}`
        } else {
          const parent = bone.parent === undefined ? undefined : bones[bone.parent]
          const from = parent === undefined ? Number.NaN : parent.rise
          d += `M${num(ax + bone.at - from * SLANT)},${num(sign * from)}L${num(ax + bone.at - bone.rise * SLANT)},${num(y)}`
        }
        const right = ax + bone.textEnd - bone.rise * SLANT
        texts += labelSvg(
          bone.label,
          right - bone.label.width / 2.0,
          y,
          bone.depth > 2 ? ' fill="var(--_m)"' : '',
          undefined,
        )
        minX = fmin(minX, right - bone.label.width)
      }
      const boxY = endY + sign * (category.boxH / 2.0)
      minX = fmin(minX, endX - category.boxW / 2.0)
      maxX = fmax(maxX, endX + category.boxW / 2.0)
      minY = fmin(minY, boxY - category.boxH / 2.0)
      maxY = fmax(maxY, boxY + category.boxH / 2.0)

      groups += `<g class="ondine-ishikawa-category" data-id="${escText(category.text)}"><path class="ondine-ishikawa-bones" d="${d}" fill="none" stroke="var(--_l)"/>${marker('arrow_point', ax, 0.0, SLANT / len, -sign / len, 'var(--_l)')}<rect x="${num(endX - category.boxW / 2.0)}" y="${num(boxY - category.boxH / 2.0)}" width="${num(category.boxW)}" height="${num(category.boxH)}" rx="${RADIUS}" fill="var(--_s)" stroke="var(--_b)"/>${labelSvg(category.label, endX, boxY, ' class="ondine-label"', undefined)}`
      if (texts !== '') {
        groups += `<g class="ondine-ishikawa-causes" font-size="${fontSize}">${texts}</g>`
      }
      groups += '</g>'
    }

    const r = headH / 2.0
    body = `<path class="ondine-ishikawa-spine" d="M${num(tail)},0H${num(-(ARROW - 1.0))}" fill="none" stroke="var(--_l)"/>${marker('arrow_point', 0.0, 0.0, 1.0, 0.0, 'var(--_l)')}${groups}<g class="ondine-ishikawa-head" data-id="${escText(root.text)}"><path d="M0,${num(-r)}H${num(headW - r)}A${num(r)},${num(r)} 0 0 1 ${num(headW - r)},${num(r)}H0Z" fill="var(--_s)" stroke="var(--_b)" stroke-linejoin="round"/>${labelSvg(head, 12.0 + head.width / 2.0, 0.0, ' class="ondine-label" font-weight="var(--_hw)"', undefined)}</g>`
  }

  const inner = fmax(maxX - minX, title.width)
  const width = Math.ceil(inner + 2.0 * pad)
  const height = Math.ceil(maxY - minY + titleHeight + 2.0 * pad)
  const ox = pad + (inner - (maxX - minX)) / 2.0 - minX
  const oy = pad + titleHeight - minY
  let content = labelSvg(
    title,
    width / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  if (body !== '') {
    content += `<g transform="translate(${num(ox)},${num(oy)})">${body}</g>`
  }
  const svg = svgDocument('ishikawa', width, height, size, options, accessibleDefault(), content)
  return { height, links: [], svg, width }
}

/** A line of the outline drawn running down. */
type Entry = {
  depth: number
  h: number
  label: Label
  node: number
  parent: number | undefined
  w: number
  x: number
  y: number
}

function verticalCauses(model: IshikawaDb, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.875)
  const pad = options.padding ?? 8.0
  const room = fmax(140.0, (options.maxWidth ?? 320.0) - 2.0 * pad)
  const title = layoutLabel(model.title, false, size, titleRoom(options), BOLD, undefined)

  const order: Entry[] = []
  const pending: [number, number, number | undefined][] = ishikawaDbRoot(model) !== undefined ? [[0, 0, undefined]] : []
  let depth = 0
  for (;;) {
    const next = pending.pop()
    if (next === undefined) break
    const [node, own, parent] = next
    const index = order.length
    order.push({ depth: own, h: 0.0, label: labelDefault(), node, parent, w: 0.0, x: 0.0, y: 0.0 })
    depth = Math.max(depth, own)
    const entry = model.nodes[node]
    if (entry !== undefined) {
      for (let k = entry.children.length - 1; k >= 0; k--) {
        pending.push([entry.children[k] as number, own + 1, index])
      }
    }
  }

  const indent = fmin(20.0, fmax(2.0, (room - 120.0) / usizeF64(Math.max(depth, 1))))
  let y = pad + (title.height > 0.0 ? title.height + 12.0 : 0.0)
  let width = title.width
  const nodes = buf()
  const edges = buf()
  for (let index = 0; index < order.length; index++) {
    const entry = order[index] as Entry
    const text = model.nodes[entry.node]?.text ?? ''
    const depth = usizeF64(entry.depth)
    entry.x = pad + depth * indent
    const labelRoom = fmax(60.0, room - depth * indent - 20.0)
    const [font, style] = entry.depth < 2 ? [size, BOLD] : [small, 0]
    entry.label = breakLabel(layoutLabel(text, false, font, labelRoom, style, undefined), labelRoom)
    entry.w = entry.label.width + 20.0
    entry.h = entry.label.height + 12.0
    entry.y = y
    y += entry.h + 12.0
    width = fmax(width, entry.x - pad + entry.w)

    const framed = entry.depth < 2
    nodes.s += '<g class="ondine-node '
    nodes.s +=
      entry.depth === 0 ? 'ondine-ishikawa-head' : entry.depth === 1 ? 'ondine-ishikawa-category' : 'ondine-ishikawa-cause'
    nodes.s += '" data-id="'
    nodes.s += escText(text)
    nodes.s += '">'
    if (framed) {
      nodes.s += '<rect x="'
      pushNum(nodes, entry.x)
      nodes.s += '" y="'
      pushNum(nodes, entry.y)
      nodes.s += '" width="'
      pushNum(nodes, entry.w)
      nodes.s += '" height="'
      pushNum(nodes, entry.h)
      nodes.s += entry.depth === 0 ? '" rx="12"' : '" rx="4"'
      nodes.s += ' fill="var(--_s)" stroke="var(--_b)"/>'
    }
    const attrs = buf(' class="ondine-label"')
    if (entry.depth < 2) attrs.s += ' font-weight="var(--_hw)"'
    if (entry.depth > 1) {
      attrs.s += ' font-size="'
      pushNumber(attrs, small)
      attrs.s += '"'
    }
    nodes.s += labelSvg(entry.label, entry.x + entry.w / 2.0, entry.y + entry.h / 2.0, attrs.s, undefined)
    nodes.s += '</g>'

    const x = entry.x
    const top = entry.y
    const h = entry.h
    const parent = entry.parent === undefined ? undefined : order[entry.parent]
    if (parent !== undefined) {
      const gx = parent.x + indent / 2.0
      edges.s += '<path class="ondine-edge" d="M'
      pushNum(edges, gx)
      edges.s += ','
      pushNum(edges, parent.y + parent.h)
      edges.s += 'V'
      pushNum(edges, top + h / 2.0)
      edges.s += 'H'
      pushNum(edges, x)
      edges.s += '" fill="none" stroke="var(--_b)"/>'
    }
  }

  const totalWidth = Math.ceil(width + 2.0 * pad)
  const height = Math.ceil(fmax(pad + title.height, y - 12.0) + pad)
  let content = labelSvg(
    title,
    totalWidth / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += edges.s
  content += nodes.s
  return {
    height,
    links: [],
    svg: svgDocument('ishikawa', totalWidth, height, size, options, accessibleDefault(), content),
    width: totalWidth,
  }
}
