/**
 * @module The state lexer: a state machine equivalent to Mermaid's Jison lexer. Port of Pele's
 * `src/diagrams/state/lexer.ts`.
 *
 * Pele reads UTF-16 code units. The Rust crate reads UTF-8 bytes and decodes a non-ASCII character
 * whole wherever `\s` looks at it; this port reads UTF-16 units and decodes a character outside the
 * BMP whole in the same places, so token boundaries match.
 */
import { trim } from '../../text/label.ts'
import { isSpace, isWord } from '../../util/chars.ts'
import { T } from './tokens.ts'

/** A token: its kind, its start as a UTF-16 offset, and its text. */
export type Token = {
  /** The token kind. */
  kind: T
  /** The UTF-16 offset of the token in the source. */
  start: number
  /** The token text. */
  text: string
}

/** The tokens of a source. */
export type Tokens = {
  /** Set when lexing stopped on the grammar's own error rather than on unrecognized text. */
  error: string | undefined
  /** The tokens, ending with `End` or `Error`. */
  tokens: Token[]
}

/** Lexer start conditions, as in Mermaid's grammar. */
const S = {
  AccDescr: 'AccDescr',
  AccDescrMultiline: 'AccDescrMultiline',
  AccTitle: 'AccTitle',
  Class: 'Class',
  ClassDef: 'ClassDef',
  ClassDefId: 'ClassDefId',
  ClassStyle: 'ClassStyle',
  FloatingNote: 'FloatingNote',
  FloatingNoteId: 'FloatingNoteId',
  Initial: 'Initial',
  Note: 'Note',
  NoteId: 'NoteId',
  NoteText: 'NoteText',
  Scale: 'Scale',
  State: 'State',
  StateId: 'StateId',
  StateString: 'StateString',
  Struct: 'Struct',
  Style: 'Style',
  StyleDefStyles: 'StyleDefStyles',
} as const
type S = (typeof S)[keyof typeof S]

/**
 * The code past the end of the source, which no test matches. Pele's `charCodeAt` returns `NaN`
 * there.
 */
const NONE = 4294967295

/**
 * `String.prototype.charCodeAt` and `codePointAt`, called through module-local constants so the
 * optimizer reads the character directly whatever internal kind the source string is (see
 * `text/measure.ts`).
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt
const codePointAt: (this: string, index: number) => number | undefined = String.prototype.codePointAt

/** The direction tokens, in the grammar's rule order. */
const DIRECTIONS: T[] = [T.DirectionTb, T.DirectionBt, T.DirectionRl, T.DirectionLr]

/**
 * Pele's `finder`: the next match of a pattern at or after a position, remembered so that asking
 * at each token costs one scan of the text in total.
 */
type Finder = {
  /** Where the remembered answer was searched from. */
  from: number
  /** The remembered answer: the match, or `undefined` for no match. */
  next: number | undefined
  /** Whether there is a remembered answer. */
  searched: boolean
}

function finderDefault(): Finder {
  return { from: 0, next: undefined, searched: false }
}

function finderGet(
  self: Finder,
  src: string,
  q: number,
  find: (src: string, q: number) => number | undefined,
): number | undefined {
  if (!self.searched || q < self.from || (self.next !== undefined && q > self.next)) {
    self.next = find(src, q)
    self.from = q
    self.searched = true
  }
  return self.next
}

/** Lexer state. Pele keeps these as closure variables of `tokenize`. */
type Lexer = {
  n: number
  brace: Finder
  dirAt: (number | undefined)[]
  dirEnd: number[]
  dirFrom: number | undefined
  dirTo: number
  direction: Finder
  error: string | undefined
  lineEnd: Finder
  p: number
  percent: Finder
  src: string
  stack: S[]
  state: S
  stereoAt: (number | undefined)[]
  stereoFrom: number | undefined
  stereoTo: number
  stereotype: Finder
  tokens: Token[]
}

/**
 * Splits `src` into tokens. The list ends with an `End` token, or with an `Error` token where
 * no rule matches.
 */
export function tokenize(src: string): Tokens {
  const lexer: Lexer = {
    n: src.length,
    brace: finderDefault(),
    dirAt: [undefined, undefined, undefined, undefined],
    dirEnd: [0, 0, 0, 0],
    dirFrom: undefined,
    dirTo: 0,
    direction: finderDefault(),
    error: undefined,
    lineEnd: finderDefault(),
    p: 0,
    percent: finderDefault(),
    src,
    stack: [],
    state: S.Initial,
    stereoAt: [undefined, undefined, undefined, undefined, undefined, undefined],
    stereoFrom: undefined,
    stereoTo: 0,
    stereotype: finderDefault(),
    tokens: [],
  }
  while (step(lexer)) {
    // Each step lexes one token or skips one stretch.
  }
  return { error: lexer.error, tokens: lexer.tokens }
}

/** Whether `src` holds `word` (lowercase ASCII) at `at`, ignoring ASCII case. */
function eqIgnoreAt(src: string, at: number, word: string): boolean {
  if (at + word.length > src.length) return false
  for (let k = 0; k < word.length; k++) {
    let c = charCodeAt.call(src, at + k)
    if (c >= 65 && c <= 90) c += 32
    if (c !== word.charCodeAt(k)) return false
  }
  return true
}

/** The first `direction` at or after `q`, ignoring case. */
function findDirection(src: string, q: number): number | undefined {
  // Without the `u` flag, `i` never matches a non-ASCII character to an ASCII one, so this is the
  // ASCII case folding of `eqIgnoreAt`.
  DIRECTION_RE.lastIndex = q
  const m = DIRECTION_RE.exec(src)
  return m === null ? undefined : m.index
}

const DIRECTION_RE = /direction/gi

/** The first stereotype at or after `q`. */
function findStereotype(src: string, q: number): number | undefined {
  for (let i = q; i < src.length; i++) {
    const c = charCodeAt.call(src, i)
    if ((c === 0x3c || c === 0x5b) && stereotypeAt(src, i) !== undefined) return i
  }
  return undefined
}

/** The first `%%` at or after `q`. */
function findPercent(src: string, q: number): number | undefined {
  if (q > src.length) return undefined
  const k = src.indexOf('%%', q)
  return k < 0 ? undefined : k
}

/** The first `{` at or after `q`. */
function findBrace(src: string, q: number): number | undefined {
  if (q > src.length) return undefined
  const k = src.indexOf('{', q)
  return k < 0 ? undefined : k
}

/** The direction words, in the grammar's rule order. */
const DIRECTION_WORDS = ['tb', 'bt', 'rl', 'lr']

/** The stereotype words, in `stereoAt` order. */
const STEREOTYPE_WORDS = ['fork', 'join', 'choice']

/**
 * The kind of stereotype at `i`, as an index into the lexer's `stereoAt`: `<<fork>>`,
 * `<<join>>`, `<<choice>>`, then the same in `[[ ]]`, ignoring case.
 */
function stereotypeAt(src: string, i: number): number | undefined {
  let open: number
  let close: string
  let base: number
  const b = i < src.length ? charCodeAt.call(src, i) : NONE
  if (b === 0x3c) {
    open = 0x3c
    close = '>>'
    base = 0
  } else if (b === 0x5b) {
    open = 0x5b
    close = ']]'
    base = 3
  } else {
    return undefined
  }
  if (i + 1 >= src.length || charCodeAt.call(src, i + 1) !== open) return undefined
  for (let kind = 0; kind < STEREOTYPE_WORDS.length; kind++) {
    const word = STEREOTYPE_WORDS[kind] as string
    const from = i + 2
    const to = from + word.length
    if (eqIgnoreAt(src, from, word) && to + 2 <= src.length && src.startsWith(close, to)) {
      return base + kind
    }
  }
  return undefined
}

/** The first line terminator (`\n`, `\r`, U+2028, U+2029) at or after `q`. */
function findLineEnd(src: string, q: number): number | undefined {
  for (let i = q; i < src.length; i++) {
    const c = charCodeAt.call(src, i)
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) return i
  }
  return undefined
}

/** The UTF-16 unit at `i`, or `NONE`. */
function byte(self: Lexer, i: number): number {
  return i < self.n ? charCodeAt.call(self.src, i) : NONE
}

/** The character at `i`, or `NONE`. */
function code(self: Lexer, i: number): number {
  if (i >= self.n) return NONE
  const c = charCodeAt.call(self.src, i)
  if (c < 0x80) return c
  return codePointAt.call(self.src, i) as number
}

/** The offset after the character at `i`. */
function next(self: Lexer, i: number): number {
  if (i >= self.n) return i + 1
  const c = charCodeAt.call(self.src, i)
  if (c < 0xd800 || c > 0xdbff) return i + 1
  return i + ((codePointAt.call(self.src, i) as number) > 0xffff ? 2 : 1)
}

function emit(self: Lexer, kind: T, s: number, e: number): void {
  const text = s <= e && e <= self.n ? self.src.slice(s, e) : ''
  emitText(self, kind, text, s, e)
}

function emitText(self: Lexer, kind: T, text: string, s: number, e: number): void {
  self.tokens.push({ kind, start: s, text })
  self.p = e
}

function push(self: Lexer, state: S): void {
  self.stack.push(self.state)
  self.state = state
}

function pop(self: Lexer): void {
  const state = self.stack.pop()
  if (state !== undefined) self.state = state
}

/** Case-insensitive match of a lowercase ASCII word, as the grammar's `/i` flag gives. */
function word(self: Lexer, w: string, q: number): boolean {
  for (let i = 0; i < w.length; i++) {
    const a = w.charCodeAt(i)
    const c = byte(self, q + i)
    if (!(c === a || (a >= 97 && a <= 122 && c === a - 32))) return false
  }
  return true
}

function wsEnd(self: Lexer, q: number): number {
  let j = q
  while (j < self.n && isSpace(code(self, j))) j = next(self, j)
  return j
}

function wordEnd(self: Lexer, q: number): number {
  let j = q
  while (isWord(byte(self, j))) j++
  return j
}

/** The next `\n` at or after `q`, or the end. */
function eol(self: Lexer, q: number): number {
  if (q > self.n) return self.n
  const k = self.src.indexOf('\n', q)
  return k < 0 ? self.n : k
}

function findChar(self: Lexer, q: number, c: string): number | undefined {
  if (q > self.n) return undefined
  const k = self.src.indexOf(c, q)
  return k < 0 ? undefined : k
}

function lineEnd(self: Lexer, q: number): number {
  return finderGet(self.lineEnd, self.src, q, findLineEnd) ?? self.n
}

/**
 * Rules `.*direction\s+TB[^\n]*` and its three siblings: the first kind, in grammar order,
 * found between `q` and the end of its line.
 */
function direction(self: Lexer, q: number): number | undefined {
  if (self.dirFrom === undefined || q < self.dirFrom || q > self.dirTo) {
    const src = self.src
    const first = finderGet(self.direction, src, q, findDirection)
    const end = first === undefined ? self.n : lineEnd(self, q)
    self.dirFrom = q
    self.dirTo = end
    self.dirAt = [undefined, undefined, undefined, undefined]
    let d = first
    while (d !== undefined && d < end) {
      const at = d
      const w = wsEnd(self, at + 9)
      if (w !== at + 9) {
        let kind = -1
        for (let k = 0; k < DIRECTION_WORDS.length; k++) {
          if (word(self, DIRECTION_WORDS[k] as string, w)) {
            kind = k
            break
          }
        }
        if (kind >= 0) {
          self.dirAt[kind] = at
          self.dirEnd[kind] = w + 2
        }
      }
      d = finderGet(self.direction, src, at + 1, findDirection)
    }
  }
  return firstAtOrAfter(self.dirAt, q)
}

/** The first index whose position is at or after `q`. */
function firstAtOrAfter(list: (number | undefined)[], q: number): number | undefined {
  for (let k = 0; k < list.length; k++) {
    const at = list[k]
    if (at !== undefined && at >= q) return k
  }
  return undefined
}

function stereotype(self: Lexer, q: number): number | undefined {
  if (self.stereoFrom === undefined || q < self.stereoFrom || q > self.stereoTo) {
    const src = self.src
    const first = finderGet(self.stereotype, src, q, findStereotype)
    const end = first === undefined ? self.n : lineEnd(self, q)
    self.stereoFrom = q
    self.stereoTo = end
    self.stereoAt = [undefined, undefined, undefined, undefined, undefined, undefined]
    let d = first
    while (d !== undefined && d < end) {
      const at = d
      const kind = stereotypeAt(src, at)
      if (kind !== undefined) self.stereoAt[kind] = at
      d = finderGet(self.stereotype, src, at + 1, findStereotype)
    }
  }
  return firstAtOrAfter(self.stereoAt, q)
}

/**
 * The grammar's `processId()`: an id ends at an inline `%%`, and a text that starts with one
 * is dropped.
 */
function emitId(self: Lexer, s: number, e: number): boolean {
  const at = finderGet(self.percent, self.src, s, findPercent)
  if (at !== undefined && at + 2 <= e) {
    if (at === s) {
      self.p = e
      return false
    }
    emit(self, T.Id, s, at)
    return true
  }
  emit(self, T.Id, s, e)
  return true
}

function finish(self: Lexer, kind: T): void {
  self.tokens.push({ kind, start: self.p, text: '' })
}

/** Lexes one token or skips one stretch. Returns false once the token list is finished. */
function step(self: Lexer): boolean {
  const n = self.n
  const p = self.p
  if (p >= n) {
    // Jison tries the current state's rules once more on the empty remainder.
    let kind: T | undefined
    switch (self.state) {
      case S.Initial:
        kind = T.Nl
        break
      case S.AccTitle:
        kind = T.AccTitleValue
        break
      case S.AccDescr:
        kind = T.AccDescrValue
        break
      case S.AccDescrMultiline:
        kind = T.AccDescrMultilineValue
        break
      case S.ClassDefId:
        kind = T.ClassDefStyleOpts
        break
      case S.ClassStyle:
        kind = T.StyleClass
        break
      case S.StyleDefStyles:
        kind = T.StyleDefStyleOpts
        break
      case S.StateString:
        kind = T.StateDescr
        break
      case S.FloatingNote:
        kind = T.NoteText
        break
      case S.StateId:
      case S.FloatingNoteId:
        kind = T.Id
        break
      default:
        kind = undefined
    }
    if (kind !== undefined) emit(self, kind, n, n)
    finish(self, T.End)
    return false
  }

  const c = code(self, p)
  switch (self.state) {
    case S.Initial:
    case S.Struct:
      return stepDocument(self, c)
    case S.State:
      return stepState(self, c)
    case S.StateString: {
      if (c === 34) {
        self.p += 1
        pop(self)
        return true
      }
      const close = findChar(self, p, '"') ?? n
      emit(self, T.StateDescr, p, close)
      return true
    }
    case S.StateId: {
      let j = p
      while (j < n && byte(self, j) !== 10 && byte(self, j) !== 123) j++
      if (emitId(self, p, j)) pop(self)
      return true
    }
    case S.Scale: {
      if (c >= 48 && c <= 57) {
        let j = p + 1
        while (byte(self, j) >= 48 && byte(self, j) <= 57) j++
        emit(self, T.Width, p, j)
        return true
      }
      const q = wsEnd(self, p)
      if (q > p && word(self, 'width', q) && !isWord(byte(self, q + 5))) {
        self.p = q + 5
        pop(self)
        return true
      }
      finish(self, T.Error)
      return false
    }
    case S.AccTitle: {
      const e = eol(self, p)
      emit(self, T.AccTitleValue, p, e)
      pop(self)
      return true
    }
    case S.AccDescr: {
      const e = eol(self, p)
      emit(self, T.AccDescrValue, p, e)
      pop(self)
      return true
    }
    case S.AccDescrMultiline: {
      if (c === 125) {
        self.p += 1
        pop(self)
        return true
      }
      const close = findChar(self, p, '}') ?? n
      emit(self, T.AccDescrMultilineValue, p, close)
      return true
    }
    case S.ClassDef: {
      const isDefault = word(self, 'default', p) && wsEnd(self, p + 7) > p + 7
      const j = isDefault ? p + 7 : wordEnd(self, p)
      const e = wsEnd(self, j)
      if (j === p || e === j) {
        finish(self, T.Error)
        return false
      }
      emit(self, isDefault ? T.DefaultClassDefId : T.ClassDefId, p, e)
      pop(self)
      push(self, S.ClassDefId)
      return true
    }
    case S.ClassDefId: {
      const e = eol(self, p)
      emit(self, T.ClassDefStyleOpts, p, e)
      pop(self)
      return true
    }
    case S.Class: {
      let j = wordEnd(self, p)
      if (j === p) {
        finish(self, T.Error)
        return false
      }
      while (byte(self, j) === 44) {
        const k = wsEnd(self, j + 1)
        const e = wordEnd(self, k)
        if (e === k) break
        j = e
      }
      emit(self, T.ClassEntityIds, p, j)
      pop(self)
      push(self, S.ClassStyle)
      return true
    }
    case S.ClassStyle: {
      const e = eol(self, p)
      emit(self, T.StyleClass, p, e)
      pop(self)
      return true
    }
    case S.Style: {
      let j = p
      while (j < n && (isWord(byte(self, j)) || byte(self, j) === 44)) j++
      const e = wsEnd(self, j)
      if (j === p || e === j) {
        finish(self, T.Error)
        return false
      }
      emit(self, T.StyleIds, p, e)
      pop(self)
      push(self, S.StyleDefStyles)
      return true
    }
    case S.StyleDefStyles: {
      const e = eol(self, p)
      emit(self, T.StyleDefStyleOpts, p, e)
      pop(self)
      return true
    }
    case S.Note: {
      if (word(self, 'left of', p) && !isWord(byte(self, p + 7))) {
        emit(self, T.LeftOf, p, p + 7)
        pop(self)
        push(self, S.NoteId)
        return true
      }
      if (word(self, 'right of', p) && !isWord(byte(self, p + 8))) {
        emit(self, T.RightOf, p, p + 8)
        pop(self)
        push(self, S.NoteId)
        return true
      }
      if (c === 34) {
        self.p += 1
        pop(self)
        push(self, S.FloatingNote)
        return true
      }
      finish(self, T.Error)
      return false
    }
    case S.NoteId: {
      const q = wsEnd(self, p)
      let j = q
      while (j < n) {
        const d = code(self, j)
        if (d === 58 || d === 45 || isSpace(d)) break
        j = next(self, j)
      }
      if (j === q) {
        finish(self, T.Error)
        return false
      }
      if (emitId(self, p, j)) {
        pop(self)
        push(self, S.NoteText)
      }
      return true
    }
    case S.NoteText:
      return stepNoteText(self)
    case S.FloatingNote: {
      const q = wsEnd(self, p)
      if (word(self, 'as', q)) {
        const e = wsEnd(self, q + 2)
        emit(self, T.As, p, e)
        pop(self)
        push(self, S.FloatingNoteId)
        return true
      }
      if (c === 34) {
        self.p += 1
        return true
      }
      const close = findChar(self, p, '"') ?? n
      emit(self, T.NoteText, p, close)
      return true
    }
    case S.FloatingNoteId: {
      const e = eol(self, p)
      if (emitId(self, p, e)) pop(self)
      return true
    }
  }
}

/** The rules of the root document (`INITIAL`) and of a composite's body (`struct`). */
function stepDocument(self: Lexer, c: number): boolean {
  const n = self.n
  const p = self.p
  const root = self.state === S.Initial
  const lc = c === NONE ? NONE : c | 32

  if (root) {
    if (lc === 99 && word(self, 'click', p) && !isWord(byte(self, p + 5))) {
      emit(self, T.Click, p, p + 5)
      return true
    }
    if (lc === 104 && word(self, 'href', p) && !isWord(byte(self, p + 4))) {
      emit(self, T.Href, p, p + 4)
      return true
    }
    if (c === 34) {
      const close = findChar(self, p + 1, '"')
      if (close !== undefined) {
        emit(self, T.String, p, close + 1)
        return true
      }
    }
    if (lc === 100 && word(self, 'default', p) && !isWord(byte(self, p + 7))) {
      emit(self, T.Default, p, p + 7)
      return true
    }
    if (emitDirection(self, p)) return true
    if (c === 10) {
      let j = p + 1
      while (byte(self, j) === 10) j++
      emit(self, T.Nl, p, j)
      return true
    }
    if (isSpace(c)) {
      self.p = wsEnd(self, p)
      return true
    }
  } else if (c !== 10 && isSpace(c)) {
    let j = next(self, p)
    while (j < n && byte(self, j) !== 10 && isSpace(code(self, j))) j = next(self, j)
    self.p = j
    return true
  }

  if (c === 35 || (c === 37 && byte(self, p + 1) === 37 && byte(self, p + 2) !== 123)) {
    self.p = eol(self, p)
    return true
  }

  if (lc === 115) {
    if (root && word(self, 'scale', p)) {
      const e = wsEnd(self, p + 5)
      if (e > p + 5) {
        emit(self, T.Scale, p, e)
        push(self, S.Scale)
        return true
      }
    }
    if (word(self, 'style', p)) {
      const e = wsEnd(self, p + 5)
      if (e > p + 5) {
        emit(self, T.Style, p, e)
        push(self, S.Style)
        return true
      }
    }
    if (word(self, 'state', p)) {
      const e = wsEnd(self, p + 5)
      if (e > p + 5) {
        self.p = e
        push(self, S.State)
        return true
      }
      if (root && word(self, 'diagram', p + 5)) {
        const from = word(self, '-v2', p + 12) ? p + 15 : p + 12
        const e = wsEnd(self, from)
        if (e > from) {
          emit(self, T.Sd, p, e)
          return true
        }
      }
    }
  } else if (lc === 99) {
    if (word(self, 'class', p)) {
      const def = word(self, 'def', p + 5)
      const from = def ? p + 8 : p + 5
      const e = wsEnd(self, from)
      if (e > from) {
        emit(self, def ? T.ClassDef : T.Class, p, e)
        push(self, def ? S.ClassDef : S.Class)
        return true
      }
    }
  } else if (lc === 97 && root && (word(self, 'acctitle', p) || word(self, 'accdescr', p))) {
    const title = (byte(self, p + 3) | 32) === 116
    const q = wsEnd(self, p + 8)
    const d = byte(self, q)
    if (d === 58) {
      const e = wsEnd(self, q + 1)
      emit(self, title ? T.AccTitle : T.AccDescr, p, e)
      push(self, title ? S.AccTitle : S.AccDescr)
      return true
    }
    if (d === 123 && !title) {
      self.p = wsEnd(self, q + 1)
      push(self, S.AccDescrMultiline)
      return true
    }
  }

  if (root) {
    if (c === 123) {
      emit(self, T.StructStart, p, p + 1)
      push(self, S.Struct)
      return true
    }
  } else {
    if (emitDirection(self, p)) return true
    if (c === 125) {
      emit(self, T.StructStop, p, p + 1)
      pop(self)
      return true
    }
    if (c === 10) {
      self.p += 1
      return true
    }
  }

  if (lc === 110 && word(self, 'note', p)) {
    const e = wsEnd(self, p + 4)
    if (e > p + 4) {
      emit(self, T.Note, p, e)
      push(self, S.Note)
      return true
    }
  }
  if (
    root &&
    lc === 104 &&
    word(self, 'hide empty description', p) &&
    !isWord(byte(self, p + 22))
  ) {
    emit(self, T.HideEmpty, p, p + 22)
    return true
  }
  if (c === 91 && byte(self, p + 1) === 42 && byte(self, p + 2) === 93) {
    emit(self, T.EdgeState, p, p + 3)
    return true
  }

  let j = p
  while (j < n) {
    const d = code(self, j)
    if (d === 58 || d === 45 || d === 123 || isSpace(d)) break
    j = next(self, j)
  }
  if (j > p) {
    emitId(self, p, j)
    return true
  }

  if (c === 58) {
    j = p + 1
    while (j < n) {
      const d = byte(self, j)
      if (d === 10 || d === 59) break
      if (d === 58) {
        const after = byte(self, j + 1)
        if (j + 1 >= n || after === 58 || after === 10 || after === 59) break
        j += 1
      }
      j += 1
    }
    if (j > p + 1) {
      const text = trim(self.src.slice(p, Math.min(j, n)))
      emitText(self, T.Descr, text, p, j)
      return true
    }
    if (byte(self, p + 1) === 58 && byte(self, p + 2) === 58) {
      emit(self, T.StyleSeparator, p, p + 3)
      return true
    }
  } else if (c === 45 && byte(self, p + 1) === 45) {
    if (byte(self, p + 2) === 62) {
      emit(self, T.Arrow, p, p + 3)
      return true
    }
    if (!root) {
      emit(self, T.Concurrent, p, p + 2)
      return true
    }
  }

  if (!root) {
    finish(self, T.Error)
    return false
  }
  emit(self, T.Invalid, p, p + 1)
  return true
}

/** Emits a direction token at `p` when one of the direction rules matches. */
function emitDirection(self: Lexer, p: number): boolean {
  const kind = direction(self, p)
  if (kind === undefined) return false
  const token = DIRECTIONS[kind]
  const end = self.dirEnd[kind]
  if (token === undefined || end === undefined) return false
  const e = eol(self, end)
  emit(self, token, p, e)
  return true
}

/** The rules after `state `: a stereotype, a quoted description, `as`, a body, or a name. */
function stepState(self: Lexer, c: number): boolean {
  const n = self.n
  const p = self.p
  if (c !== 10 && isSpace(c)) {
    let j = next(self, p)
    while (j < n && byte(self, j) !== 10 && isSpace(code(self, j))) j = next(self, j)
    self.p = j
    return true
  }
  if (c === 35 || (c === 37 && byte(self, p + 1) === 37 && byte(self, p + 2) !== 123)) {
    self.p = eol(self, p)
    return true
  }

  const kind = stereotype(self, p)
  if (kind !== undefined) {
    const at = self.stereoAt[kind]
    if (at !== undefined) {
      const choice = kind === 2 || kind === 5
      const token = choice ? T.Choice : kind % 3 === 0 ? T.Fork : T.Join
      const text = trim(p <= at ? self.src.slice(p, at) : '')
      emitText(self, token, text, p, at + (choice ? 10 : 8))
      pop(self)
      return true
    }
  }

  if (c === 34) {
    self.p += 1
    push(self, S.StateString)
    return true
  }
  const q = c === 10 ? wsEnd(self, p) : p
  if (word(self, 'as', q)) {
    const e = wsEnd(self, q + 2)
    if (e > q + 2) {
      emit(self, T.As, p, e)
      push(self, S.StateId)
      return true
    }
  }
  if (c === 10) {
    self.p += 1
    pop(self)
    return true
  }
  if (c === 123) {
    emit(self, T.StructStart, p, p + 1)
    pop(self)
    push(self, S.Struct)
    return true
  }

  if (isWord(c)) {
    const first = wordEnd(self, p)
    const second = wsEnd(self, first)
    if (second > first && isWord(byte(self, second))) {
      const brace = finderGet(self.brace, self.src, second + 1, findBrace)
      if (brace !== undefined && brace < lineEnd(self, second)) {
        let error = 'Error: State name must be a single word. Found: "'
        error += trim(self.src.slice(p, brace + 1))
        error += '"'
        self.error = error
        finish(self, T.Error)
        return false
      }
    }
  }

  let j = next(self, p)
  while (j < n) {
    const d = code(self, j)
    if (d === 123 || isSpace(d)) break
    j = next(self, j)
  }
  emit(self, T.CompositState, p, j)
  return true
}

/** The text of a note beside a state: after a colon on one line, or up to `end note`. */
function stepNoteText(self: Lexer): boolean {
  const n = self.n
  const p = self.p
  const q = wsEnd(self, p)
  if (byte(self, q) === 58) {
    let j = q + 1
    while (j < n) {
      const d = byte(self, j)
      if (d === 58 || d === 10 || d === 59) break
      j++
    }
    if (j > q + 1) {
      // Mermaid drops two characters here, expecting " :"; with no space before the colon the
      // first character of the note goes too.
      const from = Math.min(next(self, next(self, p)), j)
      const text = trim(self.src.slice(from, j))
      emitText(self, T.NoteText, text, p, j)
      pop(self)
      return true
    }
  }

  let k = findChar(self, p, '\n')
  let e = 0
  while (k !== undefined) {
    e = wsEnd(self, k)
    if (word(self, 'end note', e) && !isWord(byte(self, e + 8))) break
    k = findChar(self, e, '\n')
  }
  if (k === undefined) {
    finish(self, T.Error)
    return false
  }
  const text = trim(p <= e ? self.src.slice(p, e) : '')
  emitText(self, T.NoteText, text, p, e + 8)
  pop(self)
  return true
}
