/**
 * @module The event model: frames as boxes in lanes, the relations between them, notes, and
 * specifications. Port of Pele's `src/diagrams/eventmodeling/model.ts`.
 */
import type { EmFrame, EventModelAst } from './parser.ts'
import { accDescrValue, accTitleValue, titleValue } from '../common/tokens.ts'
import { Code, type CompileError, errorNew, locate } from '../../error.ts'
import { trim, trimEnd, trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'

/** What a frame draws. */
export const EntityKind = {
  /** A command. */
  Command: 'Command',
  /** An event. */
  Event: 'Event',
  /** An automated processor. */
  Processor: 'Processor',
  /** A read model. */
  Readmodel: 'Readmodel',
  /** A screen. */
  Ui: 'Ui',
} as const

/** What a frame draws. */
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind]

/** The kind as Pele names it. */
export function entityKindAsStr(kind: EntityKind): string {
  switch (kind) {
    case EntityKind.Command:
      return 'command'
    case EntityKind.Event:
      return 'event'
    case EntityKind.Processor:
      return 'processor'
    case EntityKind.Readmodel:
      return 'readmodel'
    case EntityKind.Ui:
      return 'ui'
  }
}

/** The group of lanes a kind of entity goes in. */
export const LaneGroup = {
  /** Commands and read models. */
  State: 'State',
  /** Events. */
  Stream: 'Stream',
  /** Screens and processors. */
  Trigger: 'Trigger',
} as const

/** The group of lanes a kind of entity goes in. */
export type LaneGroup = (typeof LaneGroup)[keyof typeof LaneGroup]

/** The group as Pele names it. */
export function laneGroupAsStr(group: LaneGroup): string {
  switch (group) {
    case LaneGroup.State:
      return 'state'
    case LaneGroup.Stream:
      return 'stream'
    case LaneGroup.Trigger:
      return 'trigger'
  }
}

/** A lane: Pele's `EmLane`. */
export type EmLane = {
  /** The lane's group. */
  group: LaneGroup
  /**
   * Mermaid's ordering key: 0 for UI/Automation, 100 for Command/Read Model, 200 for Events,
   * and the next free number after those for each namespace.
   */
  index: number
  /** The heading. */
  label: string
  /** The namespace, for a lane of one. */
  namespace: string | undefined
}

/** A frame's box: Pele's `EmBox`. */
export type EmBox = {
  /** Example data from the frame or from the data block it refers to. */
  data: string | undefined
  /** The data type of inline data. */
  dataType: string | undefined
  /** The entity's qualified name. */
  entity: string
  /** The frame number as written, such as "01". */
  id: string
  /** What the box draws. */
  kind: EntityKind
  /** The box's lane, as an index into {@link EventModelingModel.lanes}. */
  lane: number
  /** The entity's name without its namespace. */
  name: string
  /** The namespace of a two-part name. */
  namespace: string | undefined
  /** Whether the frame is a reset frame. */
  reset: boolean
}

/** A note: Pele's `EmNote`. */
export type EmNote = {
  /** The data type. */
  dataType: string | undefined
  /** The frame the note belongs to. */
  frame: string
  /** The note's text. */
  text: string
}

/** A given/when/then specification: Pele's `EmSpecification`. */
export type EmSpecification = {
  /** The frame the specification belongs to. */
  frame: string
  /** The `given` entities. */
  given: string[]
  /** The `then` entities. */
  then: string[]
  /** The `when` entities. */
  when: string[]
}

/** The parsed event model: Pele's `EventModelingModel`. */
export type EventModelingModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Boxes in frame order. */
  boxes: EmBox[]
  /** Model entity names. */
  entities: string[]
  /** Lanes from top to bottom. */
  lanes: EmLane[]
  /** Notes. */
  notes: EmNote[]
  /** Relations as indices into `boxes`: the source and the target. */
  relations: [number, number][]
  /** Specifications. */
  specifications: EmSpecification[]
  /** The title. */
  title: string | undefined
}

/** The kind of entity an entity type keyword names. Unknown types are events. */
function kindOf(keyword: string): EntityKind {
  switch (keyword) {
    case 'ui':
      return EntityKind.Ui
    case 'pcr':
    case 'processor':
      return EntityKind.Processor
    case 'rmo':
    case 'readmodel':
      return EntityKind.Readmodel
    case 'cmd':
    case 'command':
      return EntityKind.Command
    default:
      return EntityKind.Event
  }
}

/** The group of lanes `kind` goes in. */
function groupOf(kind: EntityKind): LaneGroup {
  switch (kind) {
    case EntityKind.Ui:
    case EntityKind.Processor:
      return LaneGroup.Trigger
    case EntityKind.Event:
      return LaneGroup.Stream
    case EntityKind.Command:
    case EntityKind.Readmodel:
      return LaneGroup.State
  }
}

/** `text.trim() === ''`. */
function blank(text: string): boolean {
  return trim(text) === ''
}

/** Leading whitespace, counted in characters, each one UTF-16 unit as JavaScript counts it. */
function lead(line: string): number {
  let n = 0
  while (n < line.length && isSpace(line.charCodeAt(n))) n++
  return n
}

/** The text between the outer braces, without the indentation its lines share. */
export function blockText(raw: string): string {
  const open = raw.indexOf('{')
  const close = raw.lastIndexOf('}')
  let inner: string
  if (open >= 0 && close >= 0 && close > open) {
    inner = raw.slice(open + 1, close)
  } else if (open < 0 && raw.length > 1) {
    // Without braces the value is a quoted string, whose quotes are single units.
    const first = raw.codePointAt(0) ?? 0
    const start = first > 0xffff ? 2 : 1
    const last = raw.charCodeAt(raw.length - 1)
    const before = raw.length >= 2 ? raw.charCodeAt(raw.length - 2) : 0
    const end =
      last >= 0xdc00 && last <= 0xdfff && before >= 0xd800 && before <= 0xdbff && raw.length - 2 >= start
        ? raw.length - 2
        : raw.length - 1
    inner = end >= start ? raw.slice(start, end) : ''
  } else {
    inner = ''
  }

  const unreturned = inner.includes('\r') ? inner.split('\r').join('') : inner
  const lines = unreturned.split('\n')
  while (lines.length > 0 && blank(lines[0] as string)) lines.shift()
  while (lines.length > 0 && blank(lines[lines.length - 1] as string)) lines.pop()

  let indent = Number.MAX_SAFE_INTEGER
  for (const line of lines) if (!blank(line)) indent = Math.min(indent, lead(line))
  let out = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (i > 0) out += '\n'
    out += trimEnd(line.slice(Math.min(indent, lead(line))))
  }
  return out
}

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    out += text[i]
    i++
    if (c === 0x0a) while (i < n && isSpace(text.charCodeAt(i))) i++
  }
  return out
}

/** The most frames whose names are compared directly instead of through a `Map`. */
const SCAN_LIMIT = 32

/** The index of the frame named `name`, or -1. `ids` indexes the names of many frames. */
function frameIndex(frames: EmFrame[], ids: Map<string, number> | undefined, name: string): number {
  if (ids !== undefined) return ids.get(name) ?? -1
  for (let i = 0; i < frames.length; i++) if (frames[i]!.name === name) return i
  return -1
}

/** A group's next free lane index for a namespace. */
type NextIndex = { group: LaneGroup; index: number }

/** The lane `kind` and `namespace` go in, added when new. */
function lane(lanes: EmLane[], next: NextIndex[], kind: EntityKind, namespace: string | undefined): number {
  const group = groupOf(kind)
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i]!
    if (lane.group === group && lane.namespace === namespace) return i
  }
  const first = group === LaneGroup.Trigger ? 0 : group === LaneGroup.State ? 100 : 200
  let index: number
  let label: string
  if (namespace === undefined) {
    index = first
    label = group === LaneGroup.Trigger ? 'UI/Automation' : group === LaneGroup.State ? 'Command/Read Model' : 'Events'
  } else {
    let entry: NextIndex | undefined
    for (let i = 0; i < next.length; i++) {
      if (next[i]!.group === group) {
        entry = next[i]
        break
      }
    }
    index = entry === undefined ? first + 1 : entry.index
    if (entry !== undefined) entry.index = index + 1
    else next.push({ group, index: index + 1 })
    label = (group === LaneGroup.Trigger ? 'UI/A: ' : group === LaneGroup.State ? 'C/RM: ' : 'Stream: ') + namespace
  }
  lanes.push({ group, index, label, namespace })
  return lanes.length - 1
}

/** A duplicate frame ID on `line`. */
function duplicate(name: string, line: number): CompileError {
  const message = `Duplicate event modeling frame ID "${name}" on line ${line}`
  const error = errorNew(Code.Semantic, message)
  error.line = line
  error.type = 'eventmodeling'
  return error
}

/**
 * Builds the model from `ast` of `source`, as Pele's `buildEventModel` does. `title` comes from
 * front matter.
 *
 * @throws {CompileError} A semantic error when two frames share an ID.
 */
export function buildEventModel(
  ast: EventModelAst,
  source: string,
  title: string | undefined,
): EventModelingModel {
  const frames = ast.frames
  // Frame names are unique, so a name finds the one box its frame makes, at the frame's index.
  // A few frames are compared directly, which costs less than hashing their names.
  const ids = frames.length > SCAN_LIMIT ? new Map<string, number>() : undefined
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    const name = frame.name
    if (ids === undefined) {
      for (let j = 0; j < i; j++) {
        if (frames[j]!.name === name) throw duplicate(name, locate(source, frame.offset).line)
      }
    } else {
      if (ids.has(name)) throw duplicate(name, locate(source, frame.offset).line)
      ids.set(name, i)
    }
  }

  // One lane per group, and one more per namespace within a group, in the order they are met.
  const lanes: EmLane[] = []
  const next: NextIndex[] = []

  const boxes: EmBox[] = []
  const relations: [number, number][] = []
  const dataEntities = ast.dataEntities
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!
    // Only a two-part name has a namespace.
    const entity = frame.entityIdentifier
    const dot = entity.indexOf('.')
    const pair = dot >= 0 && entity.indexOf('.', dot + 1) < 0
    const namespace = pair ? entity.slice(0, dot) : undefined
    const kind = kindOf(frame.modelEntityType)
    let text = frame.dataInlineValue === undefined ? undefined : blockText(frame.dataInlineValue)
    const reference = frame.dataReference
    if (reference !== undefined) {
      for (let i = 0; i < dataEntities.length; i++) {
        const block = dataEntities[i]!
        if (block.name === reference) {
          text = blockText(block.dataBlockValue)
          break
        }
      }
    }
    const laneIndex = lane(lanes, next, kind, namespace)
    const target = boxes.length
    boxes.push({
      data: text,
      dataType: frame.dataType,
      entity,
      id: frame.name,
      kind,
      lane: laneIndex,
      name: pair ? entity.slice(dot + 1) : entity,
      namespace,
      reset: frame.reset,
    })

    const sourceFrames = frame.sourceFrames
    if (sourceFrames.length > 0) {
      // Sources connect in frame order, and only frames that already have a box.
      const found: number[] = []
      for (let i = 0; i < sourceFrames.length; i++) {
        const source = frameIndex(frames, ids, sourceFrames[i]!)
        if (source >= 0 && source <= target && !found.includes(source)) found.push(source)
      }
      if (found.length > 1) found.sort((a, b) => a - b)
      for (let i = 0; i < found.length; i++) relations.push([found[i]!, target])
    } else if (index > 0 && !frame.reset) {
      // Otherwise the nearest earlier frame in another lane feeds this one.
      for (let i = target - 1; i >= 0; i--) {
        if (boxes[i]!.lane !== laneIndex) {
          relations.push([i, target])
          break
        }
      }
    }
  }

  // Lanes go top to bottom by index; boxes follow their lanes to the sorted positions.
  const order: number[] = []
  for (let i = 0; i < lanes.length; i++) order.push(i)
  // A stable insertion sort by lane index, as `sort` orders them.
  for (let i = 1; i < order.length; i++) {
    const item = order[i]!
    const key = lanes[item]!.index
    let j = i - 1
    while (j >= 0 && lanes[order[j]!]!.index > key) {
      order[j + 1] = order[j]!
      j--
    }
    order[j + 1] = item
  }
  const position: number[] = []
  for (let i = 0; i < lanes.length; i++) position.push(0)
  for (let to = 0; to < order.length; to++) position[order[to]!] = to
  for (let i = 0; i < boxes.length; i++) {
    const item = boxes[i]!
    item.lane = position[item.lane] ?? item.lane
  }
  const sorted: EmLane[] = []
  for (let i = 0; i < order.length; i++) sorted.push(lanes[order[i]!]!)

  return {
    accDescr:
      ast.accDescr !== undefined && ast.accDescr !== '' ? dedentLines(accDescrValue(ast.accDescr)) : undefined,
    accTitle:
      ast.accTitle !== undefined && ast.accTitle !== '' ? trimStart(accTitleValue(ast.accTitle)) : undefined,
    boxes,
    entities: ast.modelEntities.slice(),
    lanes: sorted,
    notes: ast.noteEntities.map((note) => ({
      dataType: note.dataType,
      frame: note.sourceFrame,
      text: blockText(note.dataBlockValue),
    })),
    relations,
    specifications: ast.gwtEntities.map((gwt) => ({
      frame: gwt.sourceFrame,
      given: gwt.given.slice(),
      then: gwt.then.slice(),
      when: gwt.when.slice(),
    })),
    title: (() => {
      const own = ast.title === undefined ? undefined : titleValue(ast.title)
      return own !== undefined && own !== '' ? own : title
    })(),
  }
}
