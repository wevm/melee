/** @module The sequence diagram database. Port of Pele's `src/diagrams/sequence/db.ts`. */
import { Code, type CompileError, errorNew } from '../../error.ts'
import { json } from '../../preprocess.ts'
import { trim, trimStart } from '../../text/label.ts'
import { isSpace, isWord } from '../../util/chars.ts'
import { buf } from '../../util/rust.ts'
import { type Value, parse as yamlParse, valuePushJsString, valueTruthy } from '../../yaml.ts'
import { isCssColor } from './colors.ts'
import {
  type MenuValue,
  type NoteActor,
  type SeqActor,
  type SeqBox,
  type SeqBoxData,
  type SeqMessage,
  type SeqNote,
  type SeqNumbering,
  type SeqText,
  line,
} from './types.ts'

/** A semantic error of a sequence diagram. */
function fail(message: string): CompileError {
  const error = errorNew(Code.Semantic, message)
  error.type = 'sequence'
  return error
}

/**
 * Whether `text` starts with `wrap:` or, when `no` is set, `nowrap:`, after an optional `:`.
 * Returns the length of the prefix.
 */
function wrapPrefix(text: string, no: boolean): number | undefined {
  const colon = text.charCodeAt(0) === 0x3a ? 1 : 0
  const word = no ? 'nowrap:' : 'wrap:'
  return text.startsWith(word, colon) ? colon + word.length : undefined
}

/** Mermaid's `parseMessage`: trims the text and reads a leading `wrap:` or `nowrap:`. */
export function extractWrap(raw: string): SeqText {
  const text = trim(raw)
  const yes = wrapPrefix(text, false)
  const no = wrapPrefix(text, true)
  let wrap: boolean | undefined
  let cut: number
  if (yes !== undefined) {
    wrap = true
    cut = yes
  } else if (no !== undefined) {
    wrap = false
    cut = no
  } else {
    wrap = undefined
    cut = 0
  }
  return { text: trim(text.slice(cut)), wrap }
}

/**
 * Splits a box line into a leading color and the rest, as Mermaid's
 * `/^((?:rgba?|hsla?)\s*\(.*\)|\w*)(.*)$/` does. `.` stops at a line terminator, so a line that
 * holds one outside the gap before the parenthesis does not match at all.
 */
function splitBox(text: string): [string, string] | undefined {
  const hasTerminator = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (c === 0x0d || c === 0x2028 || c === 0x2029) return true
    }
    return false
  }
  const name = ['rgba', 'rgb', 'hsla', 'hsl'].find((name) => text.startsWith(name))
  if (name !== undefined) {
    const rest = text.slice(name.length)
    const gap = rest.length - trimStart(rest).length
    let head = name.length + gap
    if (text.slice(head).startsWith('(')) {
      head = head + 1
      const close = text.lastIndexOf(')')
      if (close >= 0 && close >= head) {
        if (hasTerminator(text.slice(head))) return undefined
        return [text.slice(0, close + 1), text.slice(close + 1)]
      }
    }
  }
  if (hasTerminator(text)) return undefined
  let word = text.length
  for (let at = 0; at < text.length; at++) {
    if (!isWord(text.charCodeAt(at))) {
      word = at
      break
    }
  }
  return [text.slice(0, word), text.slice(word)]
}

/**
 * The key and value pairs of a parsed `links` or `properties` text, as Pele's `entries` lists
 * them: the characters of a string, the members of an object or array, and nothing otherwise.
 */
function entries(value: Value): [string, MenuValue][] {
  const key = (i: number): string => String(i)
  switch (value.kind) {
    case 'String': {
      const out: [string, MenuValue][] = []
      let i = 0
      for (const c of value._0) {
        out.push([key(i), { kind: 'String', _0: c }])
        i++
      }
      return out
    }
    case 'Object':
      return value._0
    case 'Array':
      return value._0.map((item, i): [string, MenuValue] => [key(i), item])
    case 'Bool':
    case 'Null':
    case 'Number':
      return []
  }
}

/** Sets `key` as `Map.prototype.set` does: an existing key keeps its place. */
function mapSet<V>(map: [string, V][], key: string, value: V): void {
  const entry = map.find(([own]) => own === key)
  if (entry !== undefined) entry[1] = value
  else map.push([key, value])
}

/**
 * `text.slice(start, end)` in UTF-16 units, with JavaScript's negative indices. A cut through a
 * surrogate pair leaves U+FFFD, as Rust's lossy UTF-16 decoding does.
 */
function jsSlice(text: string, start: number, end: number | undefined): string {
  const len = text.length
  const clamp = (at: number): number => (at < 0 ? Math.max(len + at, 0) : Math.min(at, len))
  const from = clamp(start)
  const to = clamp(end ?? len)
  if (from >= to) return ''
  return text.slice(from, to).toWellFormed()
}

/** A menu statement's kind. */
export const Menu = {
  /** `link`. */
  ALink: 'ALink',
  /** `details`. */
  Details: 'Details',
  /** `links`. */
  Links: 'Links',
  /** `properties`. */
  Properties: 'Properties',
} as const

/** A menu statement's kind. */
export type Menu = (typeof Menu)[keyof typeof Menu]

/** How a participant statement declares its participant. */
export const Declare = {
  /** Declared, or mentioned by a message. */
  Add: 'Add',
  /** `create`. */
  Create: 'Create',
  /** `destroy`. */
  Destroy: 'Destroy',
} as const

/** How a participant statement declares its participant. */
export type Declare = (typeof Declare)[keyof typeof Declare]

/**
 * One statement of the list the parser hands to `seqDbApply`, in document order.
 *
 * NOTE: Rust's `Statement::Menu` has a field named `kind`, which the union's tag takes here, so
 * that field is `menuKind`.
 */
export type Statement =
  /** A block's start or divider, with its text, or its end without one. */
  | {
      kind: 'Block'
      /** The kind, from `line`. */
      signalType: number
      /** The text. */
      text: SeqText | undefined
    }
  /** The end of a `box`. */
  | { kind: 'BoxEnd' }
  /** The start of a `box`. */
  | { kind: 'BoxStart'; _0: SeqBoxData }
  /** An activation or connection marker on one participant. */
  | {
      kind: 'Marker'
      /** The participant. */
      actor: string
      /** The kind, from `line`. */
      signalType: number
    }
  /** A menu statement. */
  | {
      kind: 'Menu'
      /** The participant. */
      actor: string
      /** The kind. */
      menuKind: Menu
      /** The text. */
      text: SeqText
    }
  /** A message. */
  | {
      kind: 'Message'
      /** Whether it activates its receiver. */
      activate: boolean
      /** The kind of `()` connection. */
      centralConnection: number | undefined
      /** The sender. */
      from: string
      /** The text. */
      msg: SeqText
      /** The kind, from `line`. */
      signalType: number
      /** The receiver. */
      to: string
    }
  /** A note. */
  | {
      kind: 'Note'
      /** The participants. */
      actor: NoteActor
      /** The placement. */
      placement: number
      /** The text. */
      text: SeqText
    }
  /** A participant. */
  | {
      kind: 'Participant'
      /** The id. */
      actor: string
      /** The `@{ ... }` config. */
      config: string | undefined
      /** The `as` label. */
      description: SeqText | undefined
      /** `participant` or `actor`, or `undefined` for a participant a message mentions. */
      draw: string | undefined
      /** How it is declared. */
      how: Declare
    }
  /** `autonumber`. */
  | { kind: 'SequenceIndex'; _0: SeqNumbering }

/** The parsed sequence diagram: Pele's `SeqDb`. */
export type SeqDb = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  active: Map<string, number>
  /** Participants, in insertion order. */
  actors: SeqActor[]
  actorAt: Map<string, number>
  /** Boxes, in order. */
  boxes: SeqBox[]
  /** The message count when each created participant was declared, in insertion order. */
  createdActors: [string, number][]
  currentBox: number | undefined
  /** The message count when each destroyed participant was declared, in insertion order. */
  destroyedActors: [string, number][]
  lastCreated: string | undefined
  lastDestroyed: string | undefined
  /** Messages, notes, and markers, in order. */
  messages: SeqMessage[]
  /** Notes, in order. */
  notes: SeqNote[]
  prevActor: string | undefined
  sequenceWrap: boolean
  /** The title. */
  title: string | undefined
  wrapEnabled: boolean | undefined
}

/** An empty database. */
export function seqDbDefault(): SeqDb {
  return {
    accDescr: undefined,
    accTitle: undefined,
    active: new Map(),
    actors: [],
    actorAt: new Map(),
    boxes: [],
    createdActors: [],
    currentBox: undefined,
    destroyedActors: [],
    lastCreated: undefined,
    lastDestroyed: undefined,
    messages: [],
    notes: [],
    prevActor: undefined,
    sequenceWrap: false,
    title: undefined,
    wrapEnabled: undefined,
  }
}

/** A database for the top-level `wrap` setting and `sequence.wrap`. */
export function seqDbNew(wrap: boolean | undefined, sequenceWrap: boolean): SeqDb {
  const db = seqDbDefault()
  db.sequenceWrap = sequenceWrap
  db.wrapEnabled = wrap
  return db
}

function seqDbAutoWrap(self: SeqDb): boolean {
  return self.wrapEnabled ?? self.sequenceWrap
}

/** The participant with `id`. */
export function seqDbActor(self: SeqDb, id: string): SeqActor | undefined {
  const at = self.actorAt.get(id)
  return at === undefined ? undefined : self.actors[at]
}

function seqDbActorMut(self: SeqDb, id: string): SeqActor | undefined {
  const at = self.actorAt.get(id)
  return at === undefined ? undefined : self.actors[at]
}

/** Sets the accessible title, without leading whitespace. */
export function seqDbSetAccTitle(self: SeqDb, text: string): void {
  self.accTitle = trimStart(text)
}

/** Sets the accessible description, without the indentation of its lines. */
export function seqDbSetAccDescription(self: SeqDb, text: string): void {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i++
    if (c === 10 && i < text.length && isSpace(text.charCodeAt(i))) {
      // `/\n\s+/` takes the newline and every whitespace character after it.
      while (i < text.length && isSpace(text.charCodeAt(i))) i++
    }
  }
  self.accDescr = out
}

/** Sets the title. */
export function seqDbSetDiagramTitle(self: SeqDb, text: string): void {
  self.title = text
}

/** Mermaid's `parseBoxData`: a leading color, then a title. */
export function seqDbParseBoxData(text: string): SeqBoxData {
  const split = splitBox(text)
  let color = split !== undefined && split[0] !== '' ? trim(split[0]) : 'transparent'
  let title = split !== undefined && split[1] !== '' ? trim(split[1]) : undefined
  if (!isCssColor(color)) {
    color = 'transparent'
    title = trim(text)
  }
  if (title === undefined) return { color, text: undefined, wrap: undefined }
  const { text: titleText, wrap } = extractWrap(title)
  return { color, text: titleText !== '' ? titleText : undefined, wrap }
}

function seqDbAddBox(self: SeqDb, data: SeqBoxData): void {
  self.currentBox = self.boxes.length
  self.boxes.push({
    actorKeys: [],
    fill: data.color,
    name: data.text,
    wrap: data.wrap ?? seqDbAutoWrap(self),
  })
}

function seqDbBoxName(self: SeqDb, at: number): string {
  return self.boxes[at]?.name ?? 'undefined'
}

function seqDbAddActor(
  self: SeqDb,
  id: string,
  description: SeqText | undefined,
  type: string | undefined,
  metadata: string | undefined,
): void {
  const name = id
  let doc: [string, Value][] | undefined
  let assignedBox = self.currentBox
  if (metadata !== undefined) {
    const src = metadata.includes('\n') ? `${metadata}\n` : `{\n${metadata}\n}`
    const parsed = yamlParse(src)
    if (parsed.ok) {
      if (parsed.value.kind === 'Object') doc = parsed.value._0
    } else {
      const error = errorNew(
        Code.Syntax,
        `Config of participant "${id}" is not valid YAML. ${parsed.error}`,
      )
      error.type = 'sequence'
      throw error
    }
  }
  const member = (key: string): Value | undefined => doc?.find(([own]) => own === key)?.[1]
  const docType = member('type')
  if (docType !== undefined && docType.kind !== 'Null') {
    const text = buf()
    valuePushJsString(docType, text)
    type = text.s
  }
  const alias = member('alias')
  if (
    alias !== undefined &&
    valueTruthy(alias) &&
    (description === undefined || description.text === name)
  ) {
    const text = buf()
    valuePushJsString(alias, text)
    description = { text: text.s, wrap: description?.wrap }
  }

  const existing = self.actorAt.get(id)
  if (existing !== undefined) {
    const oldBox = self.actors[existing]?.box
    const current = self.currentBox
    if (current !== undefined && oldBox !== undefined && current !== oldBox) {
      throw fail(
        `A same participant should only be defined in one Box: ${name} can't be in '${seqDbBoxName(self, oldBox)}' and in '${seqDbBoxName(self, current)}' at the same time.`,
      )
    }
    assignedBox = oldBox ?? self.currentBox
    const old = self.actors[existing]
    if (old !== undefined) old.box = assignedBox
    if (description === undefined) return
  }
  // A participant that is only mentioned in a message has no kind and takes its name as its
  // label.
  const label: SeqText =
    description !== undefined && type !== undefined ? description : { text: name, wrap: undefined }

  const actor: SeqActor = {
    box: assignedBox,
    description: label.text,
    details: undefined,
    links: [],
    name,
    nextActor: undefined,
    prevActor: self.prevActor,
    properties: [],
    type: type ?? 'participant',
    wrap: label.wrap ?? seqDbAutoWrap(self),
  }
  // A redeclared participant keeps its place, as `Map.prototype.set` keeps a key's.
  const slot = self.actorAt.get(id)
  if (slot !== undefined && self.actors[slot] !== undefined) {
    self.actors[slot] = actor
  } else {
    self.actorAt.set(id, self.actors.length)
    self.actors.push(actor)
  }
  const prevId = self.prevActor
  if (prevId !== undefined && prevId !== '') {
    const prev = seqDbActorMut(self, prevId)
    if (prev !== undefined) prev.nextActor = id
  }
  const current = self.currentBox === undefined ? undefined : self.boxes[self.currentBox]
  if (current !== undefined) current.actorKeys.push(id)
  self.prevActor = id
}

function seqDbAddSignal(
  self: SeqDb,
  from: string | undefined,
  to: string | undefined,
  message: SeqText | undefined,
  type: number,
  activate: boolean,
  centralConnection: number | undefined,
): void {
  // Mermaid recounts every earlier message here. A running count per participant says the same.
  if (type === line.ACTIVE_END) {
    const count = from !== undefined && from !== '' ? (self.active.get(from) ?? 0) : 0
    if (count < 1) {
      throw fail(`Trying to inactivate an inactive participant (${from ?? 'undefined'})`)
    }
    if (from !== undefined) self.active.set(from, count - 1)
  } else if (type === line.ACTIVE_START && from !== undefined && from !== '') {
    self.active.set(from, (self.active.get(from) ?? 0) + 1)
  }
  const text = message === undefined ? '' : message.text
  const wrap = message === undefined ? undefined : message.wrap
  self.messages.push({
    activate,
    centralConnection: centralConnection ?? 0,
    from,
    id: seqDbNextId(self),
    message: { kind: 'Text', _0: text },
    placement: undefined,
    to,
    type,
    wrap: wrap ?? seqDbAutoWrap(self),
  })
}

function seqDbNextId(self: SeqDb): string {
  return String(self.messages.length)
}

function seqDbAddNote(self: SeqDb, actor: NoteActor, placement: number, message: SeqText): void {
  const wrap = message.wrap ?? seqDbAutoWrap(self)
  const [from, to] = actor.kind === 'Single' ? [actor._0, actor._0] : [actor._0, actor._1]
  self.notes.push({ actor, message: message.text, placement, wrap })
  self.messages.push({
    activate: undefined,
    centralConnection: undefined,
    from,
    id: seqDbNextId(self),
    message: { kind: 'Text', _0: message.text },
    placement,
    to,
    type: line.NOTE,
    wrap,
  })
}

// Mermaid logs and ignores menu text that is not valid JSON. It also undoes the `&amp;` and
// `&equals;` its sanitizer writes; Pele has no sanitizer, and a `;` cannot occur in the text.
function seqDbAddMenu(self: SeqDb, actorId: string, kind: Menu, text: string): void {
  const actor = seqDbActorMut(self, actorId)
  if (actor === undefined) return
  switch (kind) {
    case Menu.Links:
    case Menu.Properties: {
      const parsed = json(text)
      if (parsed === undefined) return
      const map = kind === Menu.Links ? actor.links : actor.properties
      for (const [key, value] of entries(parsed)) mapSet(map, key, value)
      break
    }
    case Menu.ALink: {
      const sep = text.indexOf('@')
      const key = jsSlice(text, 0, sep - 1)
      const value = jsSlice(text, sep + 1, undefined)
      mapSet<MenuValue>(actor.links, trim(key), { kind: 'String', _0: trim(value) })
      break
    }
    case Menu.Details:
      actor.details = text
      break
  }
}

/**
 * Applies the parsed statements in order. Throws a semantic error for a participant in two boxes,
 * a created participant declared twice or not created by the next message, a destroyed
 * participant not in the next message, and a deactivation of an inactive participant, and a
 * syntax error for a participant config that is not valid YAML.
 */
export function seqDbApply(self: SeqDb, statements: Statement[]): void {
  for (const statement of statements) seqDbApplyOne(self, statement)
}

function seqDbApplyOne(self: SeqDb, statement: Statement): void {
  switch (statement.kind) {
    case 'SequenceIndex': {
      const id = seqDbNextId(self)
      self.messages.push({
        activate: undefined,
        centralConnection: undefined,
        from: undefined,
        id,
        message: { kind: 'Numbering', _0: statement._0 },
        placement: undefined,
        to: undefined,
        type: line.AUTONUMBER,
        wrap: false,
      })
      break
    }
    case 'Participant': {
      const { actor, config, description, draw, how } = statement
      switch (how) {
        case Declare.Add:
          seqDbAddActor(self, actor, description, draw, config)
          break
        case Declare.Create: {
          if (self.actorAt.has(actor)) {
            throw fail(
              "It is not possible to have actors with the same id, even if one is destroyed before the next is created. Use 'AS' aliases to simulate the behavior",
            )
          }
          self.lastCreated = actor
          seqDbAddActor(self, actor, description, draw, config)
          const count = self.messages.length
          mapSet(self.createdActors, actor, count)
          break
        }
        case Declare.Destroy: {
          self.lastDestroyed = actor
          const count = self.messages.length
          mapSet(self.destroyedActors, actor, count)
          break
        }
      }
      break
    }
    case 'Marker':
      seqDbAddSignal(self, statement.actor, undefined, undefined, statement.signalType, false, undefined)
      break
    case 'Note':
      seqDbAddNote(self, statement.actor, statement.placement, statement.text)
      break
    case 'Menu':
      seqDbAddMenu(self, statement.actor, statement.menuKind, statement.text.text)
      break
    case 'Message': {
      const { activate, centralConnection, from, msg, signalType, to } = statement
      const created = self.lastCreated
      self.lastCreated = undefined
      if (created !== undefined) {
        if (to !== created) {
          throw fail(
            `The created participant ${created} does not have an associated creating message after its declaration. Please check the sequence diagram.`,
          )
        }
      } else {
        const destroyed = self.lastDestroyed
        self.lastDestroyed = undefined
        if (destroyed !== undefined && to !== destroyed && from !== destroyed) {
          throw fail(
            `The destroyed participant ${destroyed} does not have an associated destroying message after its declaration. Please check the sequence diagram.`,
          )
        }
      }
      seqDbAddSignal(self, from, to, msg, signalType, activate, centralConnection)
      break
    }
    case 'BoxStart':
      seqDbAddBox(self, statement._0)
      break
    case 'BoxEnd':
      self.currentBox = undefined
      break
    case 'Block':
      seqDbAddSignal(self, undefined, undefined, statement.text, statement.signalType, false, undefined)
      break
  }
}
