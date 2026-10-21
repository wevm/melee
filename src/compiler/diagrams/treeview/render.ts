/**
 * @module Draws a tree view: one row per entry, indented under its folder, with guide lines. Port of
 * Pele's `src/diagrams/treeview/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { tighten, titleRoom } from '../common/fit_width.ts'
import { leftLabelSvg, literalLabel } from '../common/literal_label.ts'
import { esc, escText, jsRound, labelSvg, pushNum } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS, classNames } from '../../svg/theme.ts'
import { decode } from '../../text/entities.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { BOLD, ITALIC } from '../../text/measure.ts'
import { isSpace } from '../../util/chars.ts'
import { buf, fmax, fmin, stripPrefix } from '../../util/rust.ts'
import type { Value } from '../../yaml.ts'
import { BUILTIN_PACK, getNodeIcon, glyph, iconConfig } from './icons.ts'
import { NodeType, type TreeViewModel, treeViewModelNode, treeViewModelRoots } from './model.ts'

/** Space between an icon and its label. */
const ICON_GAP = 6
/** Space between the widest label and the column of descriptions. */
const DESC_GAP = 16
/** Where a guide line runs, right of its folder's start. */
const GUIDE_INSET = 7
/** The radius of a guide line's last turn. */
const ELBOW = 4
/** How far a highlight reaches past its row. */
const HIGHLIGHT_OVERHANG = 4

/**
 * The `treeView` option `key` of `config` when it is a number from `min` to `max`, or
 * `fallback`.
 */
function setting(config: Value, key: string, fallback: number, min: number, max: number): number {
  if (config.kind !== 'Object') return fallback
  const section = config._0.find(([own]) => own === 'treeView')?.[1]
  const value = section !== undefined && section.kind === 'Object' ? section._0.find(([own]) => own === key)?.[1] : undefined
  if (value !== undefined && value.kind === 'Number' && value._0 >= min && value._0 <= max) return value._0
  return fallback
}

/** Mermaid's layout options, with Pele's defaults: Pele's `treeSettings`. */
type Settings = {
  /** The width of guide lines. */
  lineThickness: number
  /** Space between a guide's tick and the entries it leads to. */
  paddingX: number
  /** Space above and below each row's text. */
  paddingY: number
  /** How far each level is indented, besides `paddingX`. */
  rowIndent: number
}

/** The layout options of `config`. */
function treeSettings(config: Value): Settings {
  return {
    lineThickness: setting(config, 'lineThickness', 1, 0.25, 12),
    paddingX: setting(config, 'paddingX', 5, 0, 100),
    paddingY: setting(config, 'paddingY', 2, 0, 100),
    rowIndent: setting(config, 'rowIndent', 15, 0, 400),
  }
}

/** A drawn row. */
type Row = {
  /** The middle of the row's first line, from the top of the rows. */
  cy: number
  /** The description, laid out when drawing tightly. */
  description: Label | undefined
  /** The row's height. */
  height: number
  /** Whether the entry has the `highlight` class. */
  highlighted: boolean
  /** The qualified icon name, when the entry shows one. */
  icon: string | undefined
  /** The name, laid out when drawing tightly. */
  label: Label | undefined
  /** Where the name starts. */
  labelX: number
  /** The entry's index in the model. */
  node: number
  /** The name, with entities decoded. */
  text: string
  /** The row's top, from the top of the rows. */
  top: number
  /** Where the row starts, by its depth. */
  x: number
}

/** Draws `model` with the `treeView` section of `config`. */
export function render(model: TreeViewModel, config: Value, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(model, config, options, tight))
}

/** Whether a word of `classes`, split at JavaScript `\s`, is `highlight`. */
function hasHighlight(classes: string): boolean {
  let start = 0
  for (let i = 0; i <= classes.length; i++) {
    if (i === classes.length || isSpace(classes.charCodeAt(i))) {
      if (classes.slice(start, i) === 'highlight') return true
      start = i + 1
    }
  }
  return false
}

/** Draws `model` with room to spare, or `tight`ly within the host's width. */
function draw(model: TreeViewModel, config: Value, options: RenderOptions, tight: boolean): Rendered {
  const size = options.fontSize ?? 16
  const pad = options.padding ?? 8
  const maxWidth = options.maxWidth ?? 320
  const icons = iconConfig(config)

  const { lineThickness, paddingX, paddingY, rowIndent } = treeSettings(config)
  let maxDepth = 0
  if (tight) {
    const depths: [number, number][] = treeViewModelRoots(model).map((node) => [node, 0])
    for (let i = 0; i < depths.length; i++) {
      const [index, depth] = depths[i] as [number, number]
      maxDepth = Math.max(maxDepth, depth)
      const node = treeViewModelNode(model, index)
      if (node !== undefined) for (const child of node.children) depths.push([child, depth + 1])
    }
  }
  const step = tight
    ? fmin(rowIndent + paddingX, fmax(2, (maxWidth - 120) / Math.max(maxDepth, 1)))
    : rowIndent + paddingX
  const rowHeight = jsRound(size * 1.5) + 2 * paddingY
  const iconSize = size

  const title = layoutLabel(model.title, false, size, tight ? titleRoom(options) : 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 12 : 0

  // Siblings line up: when one entry of a folder has an icon, the others leave room for one.
  const hasIcon = (list: number[]): boolean =>
    list.some((child) => {
      const node = treeViewModelNode(model, child)
      return node !== undefined && getNodeIcon(node, icons) !== undefined
    })
  const rows: Row[] = []
  const rowOf: number[] = []
  for (let i = 0; i < model.nodes.length; i++) rowOf.push(Number.MAX_SAFE_INTEGER)
  const pending: [number, number, boolean][] = []
  const push = (list: number[], depth: number): void => {
    const slot = hasIcon(list)
    for (let i = list.length - 1; i >= 0; i--) pending.push([list[i] as number, depth, slot])
  }
  push(treeViewModelRoots(model), 0)
  let labelRight = 0
  let anyHighlight = false
  let rowsHeight = 0
  for (;;) {
    const next = pending.pop()
    if (next === undefined) break
    const [index, depth, slot] = next
    const node = treeViewModelNode(model, index)
    if (node === undefined) continue
    const directory = node.nodeType === NodeType.Directory
    const style = directory ? BOLD : 0
    const x = depth * step
    const text = decode(node.name)
    const labelX = x + (slot ? iconSize + ICON_GAP : 0)
    const room = fmax(40, maxWidth - 2 * pad - 2 * HIGHLIGHT_OVERHANG - labelX)
    const label = tight ? literalLabel(text, size, room, style) : undefined
    const description =
      node.description !== undefined && tight ? literalLabel(decode(node.description), size, room, ITALIC) : undefined
    const width = label === undefined ? measure.width(text, size, style) : label.width
    if (labelX + width > labelRight) labelRight = labelX + width
    const highlighted = node.cssClass !== undefined && hasHighlight(node.cssClass)
    anyHighlight ||= highlighted
    const labelHeight = label === undefined ? 0 : label.height
    const height = tight
      ? fmax(rowHeight, labelHeight + (description === undefined ? 0 : description.height) + 2 * paddingY)
      : rowHeight
    const cy = rowsHeight + (tight ? paddingY + fmax(iconSize, labelHeight) / 2 : height / 2)
    if (index < rowOf.length) rowOf[index] = rows.length
    rows.push({
      cy,
      description,
      height,
      highlighted,
      icon: getNodeIcon(node, icons),
      label,
      labelX,
      node: index,
      text,
      top: rowsHeight,
      x,
    })
    rowsHeight += height
    push(node.children, depth + 1)
  }

  const descX = labelRight + DESC_GAP
  let width = labelRight
  for (const row of rows) {
    const description = treeViewModelNode(model, row.node)?.description
    if (description === undefined) continue
    const w = row.description === undefined ? measure.width(decode(description), size, ITALIC) : row.description.width
    width = fmax(width, (tight ? row.labelX : descX) + w)
  }
  width = fmax(width, title.width)
  const inset = pad + (anyHighlight ? HIGHLIGHT_OVERHANG : 0)
  const top = pad + titleHeight
  const totalWidth = Math.ceil(width + 2 * inset)
  const totalHeight = Math.ceil(top + rowsHeight + pad)

  const cyOf = (node: number): number => {
    const row = rowOf[node]
    const found = row === undefined ? undefined : rows[row]
    return found === undefined ? Number.NaN : found.cy
  }
  const guides = buf()
  for (const row of rows) {
    const node = treeViewModelNode(model, row.node)
    if (node === undefined) continue
    // An empty list is skipped before reading its last entry, which is slow to read as missing.
    if (node.children.length === 0) continue
    const lastChild = node.children[node.children.length - 1]
    if (lastChild === undefined) continue
    const gx = inset + row.x + GUIDE_INSET
    const tick = fmax(gx, inset + row.x + step - paddingX)
    const last = top + cyOf(lastChild)
    const r = fmin(ELBOW, tick - gx)
    guides.s += '<path d="M'
    pushNum(guides, gx)
    guides.s += ','
    pushNum(guides, top + row.top + row.height - 2)
    guides.s += 'V'
    pushNum(guides, last - r)
    if (r > 0) {
      guides.s += 'Q'
      pushNum(guides, gx)
      guides.s += ','
      pushNum(guides, last)
      guides.s += ' '
      pushNum(guides, gx + r)
      guides.s += ','
      pushNum(guides, last)
      guides.s += 'H'
      pushNum(guides, tick)
    }
    if (tick > gx) {
      for (let i = 0; i < node.children.length - 1; i++) {
        const child = node.children[i] as number
        guides.s += 'M'
        pushNum(guides, gx)
        guides.s += ','
        pushNum(guides, top + cyOf(child))
        guides.s += 'H'
        pushNum(guides, tick)
      }
    }
    guides.s += '"/>'
  }

  const baseline = size * 0.35
  const body = buf()
  for (const row of rows) {
    const node = treeViewModelNode(model, row.node)
    if (node === undefined) continue
    const cy = top + row.cy
    const directory = node.nodeType === NodeType.Directory
    const inner = buf()
    if (row.highlighted) {
      const x = inset + row.x - HIGHLIGHT_OVERHANG
      inner.s += '<rect class="ondine-tree-highlight" x="'
      pushNum(inner, x)
      inner.s += '" y="'
      pushNum(inner, top + row.top + 1)
      inner.s += '" width="'
      pushNum(inner, totalWidth - inset + HIGHLIGHT_OVERHANG - x)
      inner.s += '" height="'
      pushNum(inner, row.height - 2)
      inner.s += '" rx="'
      inner.s += RADIUS
      inner.s += '" fill="var(--_c)" fill-opacity="0.14"/>'
    }
    if (row.icon !== undefined) {
      const icon = row.icon
      const afterPack = stripPrefix(icon, BUILTIN_PACK)
      const name = (afterPack === undefined ? undefined : stripPrefix(afterPack, ':')) ?? ''
      const path = glyph(name) ?? glyph(directory ? 'folder' : 'file') ?? ''
      inner.s += '<svg class="ondine-icon" data-icon="'
      inner.s += escText(icon)
      inner.s += '" x="'
      pushNum(inner, inset + row.x)
      inner.s += '" y="'
      pushNum(inner, cy - iconSize / 2)
      inner.s += '" width="'
      pushNum(inner, iconSize)
      inner.s += '" height="'
      pushNum(inner, iconSize)
      inner.s +=
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="'
      inner.s += path
      inner.s += '" stroke="var(--_m)" stroke-width="1.5"/></svg>'
    }
    const weight = directory ? ' font-weight="var(--_hw)"' : ''
    if (row.label !== undefined) {
      const attrs = ` class="ondine-label"${weight}`
      inner.s += leftLabelSvg(row.label, inset + row.labelX, top + row.top + paddingY, attrs)
    } else if (row.text !== '') {
      inner.s += '<text class="ondine-label" x="'
      pushNum(inner, inset + row.labelX)
      inner.s += '" y="'
      pushNum(inner, cy + baseline)
      inner.s += '"'
      inner.s += weight
      inner.s += ' xml:space="preserve">'
      inner.s += esc(row.text)
      inner.s += '</text>'
    }
    if (row.description !== undefined) {
      inner.s += leftLabelSvg(
        row.description,
        inset + row.labelX,
        top + row.top + paddingY + (row.label === undefined ? 0 : row.label.height),
        ' class="ondine-tree-description" font-style="italic" fill="var(--_m)"',
      )
    } else if (node.description !== undefined) {
      inner.s += '<text class="ondine-tree-description" x="'
      pushNum(inner, inset + descX)
      inner.s += '" y="'
      pushNum(inner, cy + baseline)
      inner.s += '" font-style="italic" fill="var(--_m)" xml:space="preserve">'
      inner.s += esc(decode(node.description))
      inner.s += '</text>'
    }
    body.s += '<g class="ondine-node ondine-tree-'
    body.s += directory ? 'dir' : 'file'
    body.s += classNames(node.cssClass ?? '')
    body.s += '" data-id="'
    body.s += escText(node.name)
    body.s += '">'
    body.s += inner.s
    body.s += '</g>'
  }

  const content = buf(
    labelSvg(title, totalWidth / 2, pad + title.height / 2, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  )
  if (guides.s !== '') {
    content.s += '<g class="ondine-tree-guides" fill="none" stroke="var(--_b)" stroke-width="'
    pushNum(content, lineThickness)
    content.s += '">'
    content.s += guides.s
    content.s += '</g>'
  }
  content.s += body.s

  return {
    height: totalHeight,
    links: [],
    svg: svgDocument(
      'treeView',
      totalWidth,
      totalHeight,
      size,
      options,
      { accDescr: model.accDescr, accTitle: model.accTitle },
      content.s,
    ),
    width: totalWidth,
  }
}
