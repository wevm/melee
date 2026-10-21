/**
 * @module Draws a git graph: lanes for branches, commits along them, and connectors for merges and
 * cherry-picks. Port of Pele's `src/diagrams/git/render.ts`.
 */
import { CHERRY_PICK, type GitCommit, type GitModel, HIGHLIGHT, MERGE, REVERSE } from './db.ts'
import type { Rendered } from '../../diagrams.ts'
import { plainLabel } from '../common/fit.ts'
import { turnToFit } from '../common/fit_width.ts'
import { escText, jsRound, labelSvg, num } from '../../svg/builder.ts'
import { type Accessible, type RenderOptions, svgDocument } from '../../svg/root.ts'
import { RADIUS, seriesColor } from '../../svg/theme.ts'
import { type Label, layoutLabel } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { buf, fmax, fmin, midpoint, totalCmp } from '../../util/rust.ts'
import { type Value, pushNumber } from '../../yaml.ts'

/** Radius of a commit dot. */
const DOT = 7.0
/** Least distance between commits along a lane. */
const STEP = 44.0
/** Least distance between lanes. */
const LANE = 44.0
/**
 * Length of a curve between lanes. Shorter than a step, so a curve between lanes never runs
 * through a commit on a lane it crosses.
 */
const CURVE = 36.0
/** Space between things that would otherwise touch. */
const GAP = 8.0
/** Space before the first commit, where branch names sit. */
const LABEL_GAP = 20.0
/** Length of a lane past its last commit. */
const TAIL = 20.0
/** Depth of a tag's notch. */
const NOTCH = 7.0
/** Space between a commit and its tags. */
const TAG_GAP = 6.0
/** The cosine of 45 degrees, for rotated ids. */
const HALF = Math.SQRT1_2
/** Class suffixes by commit type. */
const CLASSES = ['normal', 'reverse', 'highlight', 'merge', 'cherry-pick'] as const

/** A commit as drawn. */
type View = {
  commit: GitCommit
  index: number
  label: Label | undefined
  lane: number
  m: number
  tags: Label[]
}

/** A property of a YAML mapping. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

function flag(config: Value, key: string, fallback: boolean): boolean {
  const git = property(config, 'gitGraph')
  const value = git === undefined ? undefined : property(git, key)
  return value?.kind === 'Bool' ? value._0 : fallback
}

function tagWidth(tag: Label): number {
  return NOTCH + 4.0 + tag.width + 6.0
}

function color(lane: number): string {
  return seriesColor(lane)
}

/** `x,y`. */
function pair(x: number, y: number): string {
  return `${num(x)},${num(y)}`
}

/** A highlight's side, a merge ring's radius, and a dot's radius, formatted. */
const HIGHLIGHT_SIDE = num(2.0 * DOT + 2.0)
const RING = num(DOT - 1.0)
const DOT_RADIUS = num(DOT)

function symbol(type: number, x: number, y: number, color: string): string {
  if (type === HIGHLIGHT) {
    return `<rect x="${num(x - DOT - 1.0)}" y="${num(y - DOT - 1.0)}" width="${HIGHLIGHT_SIDE}" height="${HIGHLIGHT_SIDE}" rx="2" fill="${color}"/>`
  }
  const at = ` cx="${num(x)}" cy="${num(y)}"`
  if (type === MERGE) {
    return `<circle${at} r="${RING}" fill="var(--_bg)" stroke="${color}" stroke-width="2"/><circle${at} r="2.5" fill="${color}"/>`
  }
  const out = `<circle${at} r="${DOT_RADIUS}" fill="${color}"/>`
  if (type === REVERSE) {
    return `${out}<path d="M${pair(x - 3.0, y - 3.0)}l6,6M${pair(x - 3.0, y + 3.0)}l6,-6" fill="none" stroke="var(--_bg)" stroke-width="1.5" stroke-linecap="round"/>`
  }
  if (type === CHERRY_PICK) {
    const cy = num(y + 2.2)
    return `${out}<path d="M${pair(x - 2.6, y + 1.0)}L${pair(x + 0.8, y - 4.2)}L${pair(x + 2.6, y + 1.0)}" fill="none" stroke="var(--_bg)" stroke-linejoin="round"/><circle cx="${num(x - 2.6)}" cy="${cy}" r="1.8" fill="var(--_bg)"/><circle cx="${num(x + 2.6)}" cy="${cy}" r="1.8" fill="var(--_bg)"/>`
  }
  return out
}

/**
 * Draws `model` with the `gitGraph` section of `config`. A left-to-right graph that does not fit
 * the host's width may run down instead.
 */
export function render(model: GitModel, config: Value, options: RenderOptions): Rendered {
  if (model.direction !== 'LR') return draw(model, config, options, model.direction)
  return turnToFit(options, (down) => draw(model, config, options, down ? 'TB' : 'LR'))
}

/** The extent of what is drawn. */
type Bounds = {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

function boundsGrow(self: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < self.minX) self.minX = x0
  if (y0 < self.minY) self.minY = y0
  if (x1 > self.maxX) self.maxX = x1
  if (y1 > self.maxY) self.maxY = y1
}

/**
 * Room each commit needs: along the main axis on either side (`half`), the part of that its
 * tags take (`tagHalf`), and across each lane towards the previous lane (`lo`) and the next one
 * (`hi`).
 */
type Room = {
  half: number[]
  hi: number[]
  lo: number[]
  tagHalf: number[]
}

function room(views: View[], laneCount: number, vertical: boolean, rotate: boolean): Room {
  const half: number[] = []
  const tagHalf: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  for (let i = 0; i < laneCount; i++) {
    lo.push(DOT)
    hi.push(DOT)
  }
  for (let k = 0; k < views.length; k++) {
    const view = views[k]!
    let tagsMain = 0.0
    let tagsCross = 0.0
    const tags = view.tags
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i]!
      const w = tagWidth(tag)
      if (vertical) {
        tagsMain = fmax(tagsMain, tag.height)
        tagsCross += w + 4.0
      } else {
        tagsMain = fmax(tagsMain, w)
        tagsCross += tag.height + 3.0
      }
    }
    let labelMain = 0.0
    let labelCross = 0.0
    const label = view.label
    if (label !== undefined && label.lines.length > 0) {
      if (rotate) {
        labelCross = 3.0 + HALF * (label.width + label.height)
      } else {
        labelMain = vertical ? label.height : label.width
        labelCross = 6.0 + (vertical ? label.width : label.height)
      }
    }
    half.push(fmax(fmax(DOT, tagsMain / 2.0), labelMain / 2.0))
    tagHalf.push(tagsMain / 2.0)
    const tagSide = DOT + (view.tags.length === 0 ? 0.0 : TAG_GAP + tagsCross)
    const labelSide = DOT + labelCross
    if (view.lane < lo.length) lo[view.lane] = fmax(lo[view.lane]!, vertical ? labelSide : tagSide)
    if (view.lane < hi.length) hi[view.lane] = fmax(hi[view.lane]!, vertical ? tagSide : labelSide)
  }
  return { half, hi, lo, tagHalf }
}

/** The positions of the commits on lane `lane`: whether one lies in `(from, to)`. */
function busy(taken: number[][], lane: number, from: number, to: number): boolean {
  const list = taken[lane]
  if (list === undefined) return false
  // `partitionPoint(list, (m) => m <= from)`, inlined step for step.
  let low = 0
  if (list.length > 0) {
    let size = list.length
    while (size > 1) {
      const half = size >> 1
      const mid = low + half
      if (list[mid]! <= from) low = mid
      size -= half
    }
    if (list[low]! <= from) low += 1
  }
  const m = list[low]
  return m !== undefined && m < to
}

/** Whether `list` is in non-decreasing `seq` order, so a stable sort keeps it as it is. */
function bySeq(list: GitCommit[]): boolean {
  for (let i = 1; i < list.length; i++) if (list[i - 1]!.seq > list[i]!.seq) return false
  return true
}

function draw(model: GitModel, config: Value, options: RenderOptions, direction: string): Rendered {
  const size = options.fontSize ?? 16.0
  const small = jsRound(size * 0.75)
  const pad = options.padding ?? 8.0

  const showBranches = flag(config, 'showBranches', true)
  const showCommitLabel = flag(config, 'showCommitLabel', true)
  const rotate = flag(config, 'rotateCommitLabel', true)
  const parallel = flag(config, 'parallelCommits', false)
  const vertical = direction !== 'LR'
  const flip = direction === 'BT'

  const lanes = model.lanes
  const laneCount = lanes.length
  const laneOf = new Map<string, number>()
  for (let i = 0; i < laneCount; i++) laneOf.set(lanes[i]!, i)
  const medium = jsRound(size * 0.875)
  // Mermaid writes branch names, tags, and commit ids as plain text, so tags in them show as
  // written.
  const names: Label[] = []
  const laneColors: string[] = []
  for (let i = 0; i < laneCount; i++) {
    names.push(plainLabel(showBranches ? lanes[i]! : '', medium, 4000.0, 0))
    laneColors.push(color(i))
  }

  const sorted: GitCommit[] = model.commits.slice()
  if (!bySeq(sorted)) sorted.sort((a, b) => a.seq - b.seq)
  const views: View[] = []
  const byId = new Map<string, number>()
  // Commits come in runs on one branch, so the last lookup is kept.
  let lastBranch: string | undefined
  let lastLane = 0
  for (let i = 0; i < sorted.length; i++) {
    const commit = sorted[i]!
    if (commit.branch !== lastBranch) {
      lastBranch = commit.branch
      lastLane = laneOf.get(commit.branch) ?? 0
    }
    const labelled =
      showCommitLabel && commit.type !== CHERRY_PICK && (commit.type !== MERGE || commit.customId === true)
    const tags: Label[] = []
    for (let j = 0; j < commit.tags.length; j++) {
      const label = plainLabel(commit.tags[j]!, small, 4000.0, 0)
      if (label.lines.length > 0) tags.push(label)
    }
    byId.set(commit.id, views.length)
    views.push({
      commit,
      index: views.length,
      label: labelled ? plainLabel(commit.id, small, 4000.0, 0) : undefined,
      lane: lastLane,
      m: 0.0,
      tags,
    })
  }
  const viewCount = views.length

  const { half, hi, lo, tagHalf } = room(views, laneCount, vertical, rotate)

  // In a left-to-right graph the tags stand over their commit. A connector that comes down from
  // a lane above joins the commit's lane this far before the commit, clear of the tags, and the
  // commit is placed far enough along to leave room for that.
  const lead: number[] = []
  for (let k = 0; k < viewCount; k++) lead.push(0.0)
  if (!vertical) {
    for (let k = 0; k < viewCount; k++) {
      const view = views[k]!
      const tagHalfK = tagHalf[k] ?? 0.0
      if (tagHalfK === 0.0) continue
      const parents = view.commit.parents
      for (let j = 0; j < parents.length; j++) {
        const p = byId.get(parents[j]!)
        const parent = p === undefined ? undefined : views[p]
        if (parent !== undefined && parent.lane < view.lane) lead[k] = tagHalfK + 4.0
      }
    }
  }

  for (let k = 0; k < viewCount; k++) {
    // The space from the commit at `p` to the one at `k`.
    const halfK = half[k] ?? 0.0
    const leadK = lead[k] ?? 0.0
    let m: number
    if (parallel) {
      // Mermaid's `parallelCommits`: a commit sits one step after its furthest parent, so
      // branches that grow side by side share positions instead of taking turns.
      m = 0.0
      const parents = views[k]!.commit.parents
      for (let j = 0; j < parents.length; j++) {
        const p = byId.get(parents[j]!)
        const parent = p === undefined ? undefined : views[p]
        if (parent === undefined) continue
        if (parent.index >= k) continue
        const halfP = half[parent.index] ?? 0.0
        const curve = leadK > 0.0 ? halfP + CURVE + leadK : 0.0
        m = fmax(m, parent.m + fmax(fmax(STEP, halfP + halfK + GAP), curve))
      }
    } else if (k === 0) {
      m = 0.0
    } else {
      const halfP = half[k - 1] ?? 0.0
      const curve = leadK > 0.0 ? halfP + CURVE + leadK : 0.0
      m = (views[k - 1]?.m ?? 0.0) + fmax(fmax(STEP, halfP + halfK + GAP), curve)
    }
    views[k]!.m = m
  }
  let end = 0.0
  for (let k = 0; k < viewCount; k++) end = fmax(end, views[k]!.m)

  const cross: number[] = []
  for (let i = 0; i < laneCount; i++) cross.push(0.0)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const reach =
      name.lines.length === 0 ? 0.0 : vertical ? name.width / 2.0 + 8.0 : name.height / 2.0 + 2.0
    if (i < lo.length) lo[i] = fmax(lo[i]!, reach)
    if (i < hi.length) hi[i] = fmax(hi[i]!, reach)
    if (i > 0) {
      const value = (cross[i - 1] ?? 0.0) + fmax(LANE, (hi[i - 1] ?? 0.0) + (lo[i] ?? 0.0) + GAP)
      if (i < cross.length) cross[i] = value
    }
  }

  // A point at `m` along the main axis and `c` across it.
  const point = (m: number, c: number): string =>
    vertical ? pair(c, flip ? -m : m) : pair(m, c)

  const bounds: Bounds = {
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
  }

  let branches = ''
  if (showBranches) {
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!
      const laneColor = laneColors[i] ?? color(i)
      const c = cross[i] ?? 0.0
      const w = name.width + 16.0
      const h = name.height + 4.0
      const long = vertical ? h : w
      const from = name.lines.length === 0 ? -LABEL_GAP : -LABEL_GAP - long
      const mid = from + long / 2.0
      const cx = vertical ? c : mid
      const cy = vertical ? (flip ? -mid : mid) : c
      {
        const x = vertical ? c : -LABEL_GAP
        const y = vertical ? (flip ? LABEL_GAP : -LABEL_GAP) : c
        boundsGrow(bounds, x, y, x, y)
      }
      {
        const x = vertical ? c : end + TAIL
        const y = vertical ? (flip ? -(end + TAIL) : end + TAIL) : c
        boundsGrow(bounds, x, y, x, y)
      }
      branches += `<g class="ondine-branch" data-id="${escText(lanes[i] ?? '')}"><path class="ondine-lane" d="M${point(-LABEL_GAP, c)}L${point(end + TAIL, c)}" stroke="${laneColor}" stroke-dasharray="2 4"/>`
      if (name.lines.length > 0) {
        boundsGrow(bounds, cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0)
        branches += `<rect x="${num(cx - w / 2.0)}" y="${num(cy - h / 2.0)}" width="${num(w)}" height="${num(h)}" rx="${RADIUS}" fill="${laneColor}"/>${labelSvg(name, cx, cy, ' class="ondine-label" fill="var(--_bg)"', undefined)}`
      }
      branches += '</g>'
    }
  }

  // Positions of the commits on each lane, to tell whether a connector may run along it.
  const taken: number[][] = []
  for (let i = 0; i < laneCount; i++) taken.push([])
  for (let k = 0; k < viewCount; k++) {
    const view = views[k]!
    taken[view.lane]?.push(view.m)
  }
  if (parallel) for (const list of taken) list.sort(totalCmp)

  let curves = ''
  let lines = ''
  for (let k = 0; k < viewCount; k++) {
    const view = views[k]!
    const commit = view.commit
    const c2 = cross[view.lane] ?? 0.0
    const m2 = view.m
    const parents = commit.parents
    for (let j = 0; j < parents.length; j++) {
      const p = byId.get(parents[j]!)
      if (p === undefined) continue
      const parent = p !== view.index ? views[p] : undefined
      if (parent === undefined) continue
      const c1 = cross[parent.lane] ?? 0.0
      const m1 = parent.m
      if (parent.lane === view.lane) {
        lines += `<path class="ondine-edge" d="M${point(m1, c1)}L${point(m2, c2)}" stroke="${laneColors[view.lane] ?? color(view.lane)}"/>`
        continue
      }
      const merged = j > 0 && commit.type === MERGE
      const picked = j > 0 && !merged
      let d: string
      if (m2 <= m1) {
        const mid = midpoint(m1, m2)
        d = `M${point(m1, c1)}C${point(mid, c1)} ${point(mid, c2)} ${point(m2, c2)}`
      } else if (!merged && !busy(taken, view.lane, m1, m2)) {
        // Leaves the parent at once and runs along the child's lane.
        const s = fmin(CURVE, m2 - m1)
        d = `M${point(m1, c1)}C${point(m1 + s / 2.0, c1)} ${point(m1 + s / 2.0, c2)} ${point(m1 + s, c2)}L${point(m2, c2)}`
      } else {
        // Turns in just before the child, or before its tags when it comes from their
        // side.
        const leadK = lead[view.index] ?? 0.0
        const to = parent.lane < view.lane && m2 - leadK > m1 ? m2 - leadK : m2
        let s = fmin(CURVE, to - m1)
        let along = c1
        d = `M${point(m1, c1)}`
        if (!merged || busy(taken, parent.lane, m1, m2)) {
          // Neither lane is free to run along. Between two lanes, past the ids of one
          // and before the tags of the next, a strip stays empty, and the connector
          // takes that.
          along =
            c1 > c2 ? c2 + (hi[view.lane] ?? 0.0) + GAP / 2.0 : c2 - (lo[view.lane] ?? 0.0) - GAP / 2.0
          s = fmin(CURVE, (to - m1) / 2.0)
          d += `C${point(m1 + s / 2.0, c1)} ${point(m1 + s / 2.0, along)} ${point(m1 + s, along)}`
        }
        d += `L${point(to - s, along)}C${point(to - s / 2.0, along)} ${point(to - s / 2.0, c2)} ${point(to, c2)}`
        if (to < m2) d += `L${point(m2, c2)}`
      }
      const lane = merged ? parent.lane : view.lane
      curves += `<path class="ondine-edge${merged ? ' ondine-edge-merge' : picked ? ' ondine-edge-cherry-pick' : ''}" d="${d}" stroke="${laneColors[lane] ?? color(lane)}"${picked ? ' stroke-dasharray="4 3"' : ''}/>`
    }
  }

  let commits = ''
  for (let k = 0; k < viewCount; k++) {
    const view = views[k]!
    const commit = view.commit
    const c = cross[view.lane] ?? 0.0
    const x = vertical ? c : view.m
    const y = vertical ? (flip ? -view.m : view.m) : c
    const type = commit.customType ?? commit.type
    boundsGrow(bounds, x - DOT - 1.0, y - DOT - 1.0, x + DOT + 1.0, y + DOT + 1.0)
    // Merges and cherry-picks carry a message Mermaid makes up; only a written one is worth
    // showing.
    let body =
      commit.type < MERGE && commit.message !== '' ? `<title>${escText(commit.message)}</title>` : ''
    body += symbol(type, x, y, laneColors[view.lane] ?? color(view.lane))

    const label = view.label
    if (label !== undefined && label.lines.length > 0) {
      const w = label.width
      const h = label.height
      if (rotate) {
        // The text ends beside the commit and trails back the way the history came.
        const k = (HALF * h) / 2.0
        const ax = vertical ? x - DOT - 3.0 - k : x + 3.0
        const ay = vertical ? y : y + DOT + 3.0 + k
        const reach = HALF * w + k
        boundsGrow(bounds, ax - reach, flip ? ay - reach : ay - k, ax + k, flip ? ay + k : ay + reach)
        const bx = ax - w / 2.0
        body += `<g class="ondine-commit-label" transform="rotate(${flip ? '45' : '-45'} ${num(ax)} ${num(ay)})">${back(bx, ay, w, h)}${labelSvg(label, bx, ay, '', undefined)}</g>`
      } else {
        const cx = vertical ? x - DOT - 6.0 - w / 2.0 : x
        const cy = vertical ? y : y + DOT + 6.0 + h / 2.0
        boundsGrow(bounds, cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0)
        body += `<g class="ondine-commit-label">${back(cx, cy, w, h)}${labelSvg(label, cx, cy, '', undefined)}</g>`
      }
    }

    // Beside the lane the tags form a row; above it they stack, the first one furthest out.
    let offset = DOT + TAG_GAP
    const tags = view.tags
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[vertical ? i : tags.length - 1 - i]!
      const w = tagWidth(tag)
      const h = tag.height
      const left = vertical ? x + offset : x - w / 2.0
      const cy = vertical ? y : y - offset - h / 2.0
      offset += vertical ? w + 4.0 : h + 3.0
      boundsGrow(bounds, left, cy - h / 2.0, left + w, cy + h / 2.0)
      body += `<g class="ondine-tag"><path d="M${pair(left, cy)}L${pair(left + NOTCH, cy - h / 2.0)}H${num(left + w)}V${num(cy + h / 2.0)}H${num(left + NOTCH)}Z" fill="var(--_s)" stroke="var(--_b)" stroke-linejoin="round"/><circle cx="${num(left + NOTCH)}" cy="${num(cy)}" r="1.5" fill="var(--_b)"/>${labelSvg(tag, left + NOTCH + 4.0 + tag.width / 2.0, cy, ' fill="var(--_fg)"', undefined)}</g>`
    }

    commits += `<g class="ondine-commit ondine-commit-${CLASSES[type] ?? CLASSES[0]}${commit.type === MERGE && type !== MERGE ? ' ondine-commit-merge' : ''}" data-id="${escText(commit.id)}">${body}</g>`
  }

  if (bounds.minX > bounds.maxX) boundsGrow(bounds, 0.0, 0.0, 0.0, 0.0)
  const title = layoutLabel(model.title, false, size, 4000.0, BOLD, undefined)
  const titleHeight = title.height > 0.0 ? title.height + 16.0 : 0.0
  const inner = fmax(bounds.maxX - bounds.minX, title.width)
  const width = Math.ceil(inner + 2.0 * pad)
  const height = Math.ceil(bounds.maxY - bounds.minY + titleHeight + 2.0 * pad)
  const dx = pad - bounds.minX + (inner - (bounds.maxX - bounds.minX)) / 2.0
  const dy = pad + titleHeight - bounds.minY

  let content = `${labelSvg(
    title,
    width / 2.0,
    pad + title.height / 2.0,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )}<g transform="translate(${pair(dx, dy)})">`
  if (branches !== '') {
    const out = buf('<g class="ondine-branches" fill="none" font-size="')
    pushNumber(out, medium)
    content += `${out.s}">${branches}</g>`
  }
  if (curves !== '' || lines !== '') {
    content += `<g class="ondine-edges" fill="none" stroke-width="2" stroke-linecap="round">${curves}${lines}</g>`
  }
  if (commits !== '') {
    const out = buf('<g class="ondine-commits" font-size="')
    pushNumber(out, small)
    content += `${out.s}" fill="var(--_m)">${commits}</g>`
  }
  content += '</g>'

  const acc: Accessible = { accDescr: model.accDescr, accTitle: model.accTitle }
  return {
    height,
    links: [],
    svg: svgDocument('gitGraph', width, height, size, options, acc, content),
    width,
  }
}

/** The backdrop of a commit id `w` by `h` centred on `cx`, `cy`. */
function back(cx: number, cy: number, w: number, h: number): string {
  return `<rect x="${num(cx - w / 2.0 - 2.0)}" y="${num(cy - h / 2.0 + 2.0)}" width="${num(w + 4.0)}" height="${num(h - 4.0)}" rx="3" fill="var(--_bg)"/>`
}
