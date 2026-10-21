/** @module The sequence diagram model. Port of Pele's `src/diagrams/sequence/types.ts`. */
import type { Value } from '../../yaml.ts'

/** The message kinds, numbered as in Mermaid. The numbers reach the model, so they are kept. */
export const line = {
  /** `->>`. */
  SOLID: 0,
  /** `-->>`. */
  DOTTED: 1,
  /** A note. */
  NOTE: 2,
  /** `-x`. */
  SOLID_CROSS: 3,
  /** `--x`. */
  DOTTED_CROSS: 4,
  /** `->`. */
  SOLID_OPEN: 5,
  /** `-->`. */
  DOTTED_OPEN: 6,
  /** `loop`. */
  LOOP_START: 10,
  /** The `end` of a `loop`. */
  LOOP_END: 11,
  /** `alt`. */
  ALT_START: 12,
  /** `else`. */
  ALT_ELSE: 13,
  /** The `end` of an `alt`. */
  ALT_END: 14,
  /** `opt`. */
  OPT_START: 15,
  /** The `end` of an `opt`. */
  OPT_END: 16,
  /** `activate` or a `+` mark. */
  ACTIVE_START: 17,
  /** `deactivate` or a `-` mark. */
  ACTIVE_END: 18,
  /** `par`. */
  PAR_START: 19,
  /** `and`. */
  PAR_AND: 20,
  /** The `end` of a `par`. */
  PAR_END: 21,
  /** `rect`. */
  RECT_START: 22,
  /** The `end` of a `rect`. */
  RECT_END: 23,
  /** `-)`. */
  SOLID_POINT: 24,
  /** `--)`. */
  DOTTED_POINT: 25,
  /** `autonumber`. */
  AUTONUMBER: 26,
  /** `critical`. */
  CRITICAL_START: 27,
  /** `option`. */
  CRITICAL_OPTION: 28,
  /** The `end` of a `critical`. */
  CRITICAL_END: 29,
  /** `break`. */
  BREAK_START: 30,
  /** The `end` of a `break`. */
  BREAK_END: 31,
  /** `par_over`. */
  PAR_OVER_START: 32,
  /** `<<->>`. */
  BIDIRECTIONAL_SOLID: 33,
  /** `<<-->>`. */
  BIDIRECTIONAL_DOTTED: 34,
  /** `-|\`. */
  SOLID_TOP: 41,
  /** `-|/`. */
  SOLID_BOTTOM: 42,
  /** `-\\`. */
  STICK_TOP: 43,
  /** `-//`. */
  STICK_BOTTOM: 44,
  /** `/|-`. */
  SOLID_ARROW_TOP_REVERSE: 45,
  /** `\|-`. */
  SOLID_ARROW_BOTTOM_REVERSE: 46,
  /** `//-`. */
  STICK_ARROW_TOP_REVERSE: 47,
  /** `\\-`. */
  STICK_ARROW_BOTTOM_REVERSE: 48,
  /** `--|\`. */
  SOLID_TOP_DOTTED: 51,
  /** `--|/`. */
  SOLID_BOTTOM_DOTTED: 52,
  /** `--\\`. */
  STICK_TOP_DOTTED: 53,
  /** `--//`. */
  STICK_BOTTOM_DOTTED: 54,
  /** `/|--`. */
  SOLID_ARROW_TOP_REVERSE_DOTTED: 55,
  /** `\|--`. */
  SOLID_ARROW_BOTTOM_REVERSE_DOTTED: 56,
  /** `//--`. */
  STICK_ARROW_TOP_REVERSE_DOTTED: 57,
  /** `\\--`. */
  STICK_ARROW_BOTTOM_REVERSE_DOTTED: 58,
  /** A `()` at the receiving end. */
  CENTRAL_CONNECTION: 59,
  /** A `()` at the sending end. */
  CENTRAL_CONNECTION_REVERSE: 60,
  /** A `()` at both ends. */
  CENTRAL_CONNECTION_DUAL: 61,
} as const

/** Where a note sits, numbered as in Mermaid. */
export const placement = {
  /** `left of`. */
  LEFT_OF: 0,
  /** `right of`. */
  RIGHT_OF: 1,
  /** `over`. */
  OVER: 2,
} as const

/** Text with its `wrap:` or `nowrap:` choice. */
export type SeqText = {
  /** The text. */
  text: string
  /** `true` after `wrap:`, `false` after `nowrap:`. */
  wrap: boolean | undefined
}

/** An empty text without a wrap choice. */
export function seqTextDefault(): SeqText {
  return { text: '', wrap: undefined }
}

/** What a `box` line says: its color and title. */
export type SeqBoxData = {
  /** The fill color, or `transparent`. */
  color: string
  /** The title. */
  text: string | undefined
  /** The title's wrap choice. */
  wrap: boolean | undefined
}

/** Box data without a color or title. */
export function seqBoxDataDefault(): SeqBoxData {
  return { color: '', text: undefined, wrap: undefined }
}

/** A box around participants. */
export type SeqBox = {
  /** The ids of the participants, in order. */
  actorKeys: string[]
  /** The fill color, or `transparent`. */
  fill: string
  /** The title. */
  name: string | undefined
  /** Whether the title wraps. */
  wrap: boolean
}

/** An empty box. */
export function seqBoxDefault(): SeqBox {
  return { actorKeys: [], fill: '', name: undefined, wrap: false }
}

/** A JSON value from a `links` or `properties` statement, in `JSON.parse`'s shapes. */
export type MenuValue = Value

/** A participant. */
export type SeqActor = {
  /** The index of its box in `SeqDb.boxes`. */
  box: number | undefined
  /** The label. */
  description: string
  /** The id of the page element named by a `details` statement. Pele has no page to read it from. */
  details: string | undefined
  /** Menu links, in insertion order. */
  links: [string, MenuValue][]
  /** The id. */
  name: string
  /** The id of the participant declared after it. */
  nextActor: string | undefined
  /** The id of the participant declared before it. */
  prevActor: string | undefined
  /** Properties, in insertion order. */
  properties: [string, MenuValue][]
  /** The kind: `participant`, `actor`, `database`, and so on. */
  type: string
  /** Whether the label wraps. */
  wrap: boolean
}

/** An empty participant. */
export function seqActorDefault(): SeqActor {
  return {
    box: undefined,
    description: '',
    details: undefined,
    links: [],
    name: '',
    nextActor: undefined,
    prevActor: undefined,
    properties: [],
    type: '',
    wrap: false,
  }
}

/** The numbering an `autonumber` statement sets. */
export type SeqNumbering = {
  /** The first number. */
  start: number | undefined
  /** The increment. */
  step: number | undefined
  /** Whether numbers are shown. */
  visible: boolean
}

/** Numbering without a start or step, hidden. */
export function seqNumberingDefault(): SeqNumbering {
  return { start: undefined, step: undefined, visible: false }
}

/** A message's text, or the numbering of an `autonumber` entry. */
export type MessageText =
  /** An `autonumber` entry's numbering. */
  | { kind: 'Numbering'; _0: SeqNumbering }
  /** Text. */
  | { kind: 'Text'; _0: string }

/** One entry of the message list: a message, a note, or a block or activation marker. */
export type SeqMessage = {
  /** Whether the message activates its receiver. Absent for notes and numbering. */
  activate: boolean | undefined
  /** The kind of `()` connection. Absent for notes and numbering. */
  centralConnection: number | undefined
  /** The sender. */
  from: string | undefined
  /** The position in the list, as a string. */
  id: string
  /** The text or numbering. */
  message: MessageText
  /** A note's placement. */
  placement: number | undefined
  /** The receiver. */
  to: string | undefined
  /** The kind, from `line`. */
  type: number | undefined
  /** Whether the text wraps. */
  wrap: boolean
}

/** The participants a note is attached to: one beside it, or one or two under it. */
export type NoteActor =
  /** The two participants of an `over` note, the same one twice for a single one. */
  | { kind: 'Over'; _0: string; _1: string }
  /** The participant of a `left of` or `right of` note. */
  | { kind: 'Single'; _0: string }

/** A note. */
export type SeqNote = {
  /** The participants. */
  actor: NoteActor
  /** The text. */
  message: string
  /** The placement, from `placement`. */
  placement: number
  /** Whether the text wraps. */
  wrap: boolean
}
