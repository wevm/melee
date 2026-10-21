/**
 * @module The class lexer: a state machine equivalent to Mermaid's Jison lexer. Port of Pele's
 * `src/diagrams/class/lexer.ts`.
 *
 * Offsets are UTF-16 indexes. Every delimiter and keyword is ASCII, and non-ASCII characters are
 * decoded whole wherever `\s` or a letter test reads them, so token boundaries match. Each regular
 * expression in Pele is a hand-written matcher below.
 */
import { T } from './tokens.ts'
import { isLineEnd, isSpace, isWord } from '../../util/chars.ts'
import { isUnicodeLetter } from '../../util/unicode.ts'

/**
 * `String.prototype.charCodeAt`, called through a module-local constant so the hot loops below
 * stay monomorphic over the many string representations a source can have (see
 * `text/measure.ts`).
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** A token: its kind, its start as a UTF-16 offset, and its text. */
export type Token = {
  /** The token kind. */
  kind: T
  /** The UTF-16 offset of the token in the source. */
  start: number
  /** The matched text. */
  text: string
}

/** Lexer start conditions, as in Mermaid's grammar. */
const S = {
  AccDescr: 0,
  AccDescrMultiline: 1,
  AccTitle: 2,
  Bqstring: 3,
  CallbackArgs: 4,
  CallbackName: 5,
  Cls: 6,
  ClassBody: 7,
  Generic: 8,
  Initial: 9,
  Namespace: 10,
  NamespaceBody: 11,
  String: 12,
} as const

type S = (typeof S)[keyof typeof S]

/** The token each state gives at the end of input, before the parser sees the end itself. */
function atEnd(state: S): T {
  switch (state) {
    case S.Initial:
    case S.Bqstring:
    case S.Cls:
    case S.Namespace:
      return T.Eof
    case S.String:
      return T.Str
    case S.Generic:
      return T.Generictype
    case S.CallbackName:
      return T.CallbackName
    case S.CallbackArgs:
      return T.CallbackArgs
    case S.AccTitle:
      return T.AccTitleValue
    case S.AccDescr:
      return T.AccDescrValue
    case S.AccDescrMultiline:
      return T.AccDescrMultilineValue
    case S.ClassBody:
    case S.NamespaceBody:
      return T.EofInStruct
  }
}

/** The character at `at`, as a code point, or `undefined` past the end. */
function charAt(src: string, at: number): number | undefined {
  return src.codePointAt(at)
}

/**
 * Whether the character at `at` is JavaScript `\s`. Every `\s` character is a single UTF-16
 * unit and no surrogate is one, so the code unit decides.
 */
function spaceAt(src: string, at: number): boolean {
  return at < src.length && isSpace(charCodeAt.call(src, at))
}

/** The end of a run of JavaScript `\s` characters from `at`. */
function skipSpaces(src: string, at: number): number {
  let q = at
  // Every `\s` character is a single UTF-16 unit, and no surrogate is one.
  while (q < src.length && isSpace(charCodeAt.call(src, q))) q++
  return Math.max(q, at)
}

/** The first `code` at or after `from`, or the end of `src`. */
function until(src: string, from: number, code: number): number {
  const n = src.length
  for (let i = from; i < n; i++) {
    if (charCodeAt.call(src, i) === code) return i
  }
  return n
}

/**
 * Where a direction statement that the lexer could take at `p` ends, as
 * `/.*direction\s+XX[^\n]*\/y` matches: `kind` is 0 to 3 for `TB`, `BT`, `RL`, and `LR`.
 * `.*` is greedy, so the last `direction` on the line that is followed by the pair wins.
 */
function directionEnd(src: string, p: number, lineEnd: number, pair: string): number | undefined {
  const candidates: number[] = []
  let at = p
  for (;;) {
    if (at > lineEnd) break
    // The first `direction` from `at` that ends by `lineEnd`, as a search of the slice finds.
    const found = src.indexOf('direction', at)
    if (found < 0 || found + 9 > lineEnd) break
    candidates.push(found)
    at = found + 1
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const start = candidates[i] as number
    const q = skipSpaces(src, start + 9)
    if (q > start + 9 && q + 2 <= src.length && src.slice(q, q + 2) === pair) {
      return until(src, q + 2, 0x0a)
    }
  }
  return undefined
}

/** Produces the token stream of Mermaid's class lexer. */
export function tokenize(src: string): Token[] {
  const found = src.indexOf('direction')
  const lexer: Lexer = {
    dirFailed: 0,
    dirNext: found < 0 ? undefined : found,
    lineEnd: undefined,
    p: 0,
    src,
    stack: [],
    state: S.Initial,
    tokens: [],
  }
  return run(lexer)
}

/** The lexer's position and state. */
type Lexer = {
  /** The end of the line on which no direction statement can start. */
  dirFailed: number
  /** The next `direction` at or after the position, or `undefined` once there is none. */
  dirNext: number | undefined
  /** The end of the line holding the position, once found. */
  lineEnd: number | undefined
  p: number
  src: string
  stack: S[]
  state: S
  tokens: Token[]
}

/** The code unit at `i`, or `NaN` past the end, which equals no code and is no class member. */
function at(self: Lexer, i: number): number {
  return charCodeAt.call(self.src, i)
}

/** Emits a token from `s` to `e` and moves to `e`. Always true, as Pele's `emit` is. */
function emit(self: Lexer, kind: T, s: number, e: number): boolean {
  self.tokens.push({ kind, start: s, text: self.src.slice(s, e) })
  self.p = e
  return true
}

/** Enters `state`, keeping the current one to return to. */
function push(self: Lexer, state: S): void {
  self.stack.push(self.state)
  self.state = state
}

/** Returns to the previous state, if there is one. */
function pop(self: Lexer): void {
  const state = self.stack.pop()
  if (state !== undefined) self.state = state
}

/** Whether the ASCII `word` starts at the position, not followed by a word character. */
function kw(self: Lexer, word: string): boolean {
  if (!startsAt(self.src, self.p, word)) return false
  return !isWord(at(self, self.p + word.length))
}

/** Whether the ASCII `word` starts at `at`. */
function starts(self: Lexer, from: number, word: string): boolean {
  return startsAt(self.src, from, word)
}

/** `src.startsWith(word, at)` for `at` from 0 to the length of `src`, compared unit by unit. */
function startsAt(src: string, at: number, word: string): boolean {
  const len = word.length
  if (at + len > src.length) return false
  for (let i = 0; i < len; i++) {
    if (charCodeAt.call(src, at + i) !== charCodeAt.call(word, i)) return false
  }
  return true
}

/** A run of whitespace is a NEWLINE up to its last line feed; the rest is skipped. */
function space(self: Lexer, leaves: boolean): void {
  let q = self.p
  let k: number | undefined
  const src = self.src
  while (q < src.length) {
    const c = charCodeAt.call(src, q)
    if (!isSpace(c)) break
    if (c === 10) k = q
    q += 1
  }
  if (k === undefined) {
    self.p = q
    return
  }
  if (leaves) pop(self)
  emit(self, T.Newline, self.p, k + 1)
}

/** The keywords that every state recognizes, even inside generics and backtick names. */
function keyword(self: Lexer, c: number): boolean {
  const p = self.p
  switch (c) {
    case 0x63: // c
      if (kw(self, 'cssClass')) return emit(self, T.Cssclass, p, p + 8)
      if (kw(self, 'callback')) return emit(self, T.Callback, p, p + 8)
      if (kw(self, 'click')) return emit(self, T.Click, p, p + 5)
      break
    case 0x6c: // l
      if (kw(self, 'link')) return emit(self, T.Link, p, p + 4)
      break
    case 0x6e: // n
      if (kw(self, 'note for')) return emit(self, T.NoteFor, p, p + 8)
      if (kw(self, 'note')) return emit(self, T.Note, p, p + 4)
      break
    case 0x3c: // <
      if (at(self, p + 1) === 0x3c) return emit(self, T.AnnotationStart, p, p + 2)
      break
    case 0x3e: // >
      if (at(self, p + 1) === 0x3e) return emit(self, T.AnnotationEnd, p, p + 2)
      break
    case 0x68: // h
      if (kw(self, 'href')) return emit(self, T.Href, p, p + 4)
      break
    default:
      break
  }
  return false
}

/** The link targets, in the order they are tried. */
const LINK_TARGETS: readonly string[] = ['_self', '_blank', '_parent', '_top']

/** The rules most states share. False when none matches. */
function common(self: Lexer, c: number): boolean {
  if (keyword(self, c)) return true
  const p = self.p
  const d = at(self, p + 1)
  switch (c) {
    case 0x22: // "
      push(self, S.String)
      self.p += 1
      return true
    case 0x7e: // ~
      push(self, S.Generic)
      self.p += 1
      return true
    case 0x60: // `
      push(self, S.Bqstring)
      self.p += 1
      return true
    case 0x5f: // _
      for (let i = 0; i < LINK_TARGETS.length; i++) {
        const target = LINK_TARGETS[i] as string
        if (kw(self, target)) return emit(self, T.LinkTarget, p, p + target.length)
      }
      break
    case 0x3c: // <
      return d === 0x7c ? emit(self, T.Extension, p, p + 2) : emit(self, T.Dependency, p, p + 1)
    case 0x7c: // |
      return d === 0x3e && emit(self, T.Extension, p, p + 2)
    case 0x3e: // >
      return emit(self, T.Dependency, p, p + 1)
    case 0x2a: // *
      return emit(self, T.Composition, p, p + 1)
    case 0x6f: // o
      if (!isWord(d)) return emit(self, T.Aggregation, p, p + 1)
      break
    case 0x28: // (
      return d === 0x29 && emit(self, T.Lollipop, p, p + 2)
    case 0x2d: // -
      return d === 0x2d ? emit(self, T.Line, p, p + 2) : emit(self, T.Minus, p, p + 1)
    case 0x2e: // .
      return d === 0x2e ? emit(self, T.DottedLine, p, p + 2) : emit(self, T.Dot, p, p + 1)
    case 0x3a: {
      // :
      const src = self.src
      const n = src.length
      let q = p + 1
      while (q < n) {
        const ch = charCodeAt.call(src, q)
        if (ch === 0x3a || ch === 0x0a || ch === 0x3b) break
        q += 1
      }
      if (q > p + 1) return emit(self, T.Label, p, q)
      return d === 0x3a && at(self, p + 2) === 0x3a && emit(self, T.StyleSeparator, p, p + 3)
    }
    case 0x2b: // +
      return emit(self, T.Plus, p, p + 1)
    case 0x25: // %
      return emit(self, T.Pct, p, p + 1)
    case 0x3d: // =
      return emit(self, T.Equals, p, p + 1)
    case 0x5b: // [
      return emit(self, T.Sqs, p, p + 1)
    case 0x5d: // ]
      return emit(self, T.Sqe, p, p + 1)
    case 0x21: // !
    case 0x23: // #
    case 0x24: // $
    case 0x26: // &
    case 0x27: // '
    case 0x2c: // ,
    case 0x3f: // ?
    case 0x5c: // \
    case 0x2f: // /
      return emit(self, T.Punctuation, p, p + 1)
    default:
      break
  }
  if (isWord(c)) {
    const src = self.src
    const n = src.length
    let q = p + 1
    while (q < n && isWord(charCodeAt.call(src, q))) q += 1
    return emit(self, T.Alpha, p, q)
  }
  const ch = charAt(self.src, p) ?? 0
  if (isUnicodeLetter(ch)) return emit(self, T.UnicodeText, p, p + (ch > 0xffff ? 2 : 1))
  return false
}

/** The direction token kinds, in the order their pairs are tried. */
const DIRECTION_KINDS: readonly T[] = [T.DirectionTb, T.DirectionBt, T.DirectionRl, T.DirectionLr]
/** The direction pairs, in the order they are tried. */
const DIRECTION_PAIRS: readonly string[] = ['TB', 'BT', 'RL', 'LR']

/** A direction statement swallows the rest of its line, from wherever the lexer stands on it. */
function direction(self: Lexer): boolean {
  const p = self.p
  let next = self.dirNext
  if (next === undefined) return false
  if (p < self.dirFailed) return false
  if (next < p) {
    const found = self.src.indexOf('direction', p)
    if (found < 0) {
      self.dirNext = undefined
      return false
    }
    next = found
    self.dirNext = next
  }
  let lineEnd: number
  if (self.lineEnd !== undefined && self.lineEnd >= p) {
    lineEnd = self.lineEnd
  } else {
    lineEnd = self.src.length
    const src = self.src
    for (let i = p; i < src.length; i++) {
      if (isLineEnd(charCodeAt.call(src, i))) {
        lineEnd = i
        break
      }
    }
    self.lineEnd = lineEnd
  }
  if (next >= lineEnd) return false
  for (let k = 0; k < DIRECTION_PAIRS.length; k++) {
    const end = directionEnd(self.src, p, lineEnd, DIRECTION_PAIRS[k] as string)
    if (end !== undefined) return emit(self, DIRECTION_KINDS[k] ?? T.DirectionTb, p, end)
  }
  // No direction statement starts anywhere in the rest of this line either.
  self.dirFailed = lineEnd
  return false
}

/** The rules of the initial state. False when none matches. */
function initial(self: Lexer, c: number): boolean {
  if (direction(self)) return true
  const p = self.p
  if (spaceAt(self.src, p)) {
    space(self, false)
    return true
  }
  switch (c) {
    case 0x25: // %
      if (at(self, p + 1) === 0x25) {
        let e = until(self.src, p, 0x0a)
        for (;;) {
          const ch = at(self, e)
          if (ch !== 0x0a && ch !== 0x0d) break
          e += 1
        }
        self.p = e
        return true
      }
      break
    case 0x61: {
      // a
      const title = starts(self, p, 'accTitle')
      if (title || starts(self, p, 'accDescr')) {
        const q = skipSpaces(self.src, p + 8)
        const ch = at(self, q)
        if (ch === 0x3a) {
          const e = skipSpaces(self.src, q + 1)
          emit(self, title ? T.AccTitle : T.AccDescr, p, e)
          push(self, title ? S.AccTitle : S.AccDescr)
          return true
        }
        if (ch === 0x7b && !title) {
          self.p = skipSpaces(self.src, q + 1)
          push(self, S.AccDescrMultiline)
          return true
        }
      }
      break
    }
    case 0x63: // c
      if (kw(self, 'classDiagram-v2')) return emit(self, T.ClassDiagram, p, p + 15)
      if (kw(self, 'classDiagram')) return emit(self, T.ClassDiagram, p, p + 12)
      if (starts(self, p, 'call') && spaceAt(self.src, p + 4)) {
        self.p = skipSpaces(self.src, p + 4)
        push(self, S.CallbackName)
        return true
      }
      if (kw(self, 'classDef')) return emit(self, T.Classdef, p, p + 8)
      if (kw(self, 'class')) {
        push(self, S.Cls)
        return emit(self, T.Class, p, p + 5)
      }
      break
    case 0x5b: // [
      if (starts(self, p + 1, '*]')) return emit(self, T.EdgeState, p, p + 3)
      break
    case 0x73: // s
      if (kw(self, 'style')) return emit(self, T.Style, p, p + 5)
      break
    case 0x6e: // n
      if (kw(self, 'namespace')) {
        push(self, S.Namespace)
        return emit(self, T.Namespace, p, p + 9)
      }
      break
    case 0x2c: // ,
      return emit(self, T.Comma, p, p + 1)
    case 0x23: // #
      return emit(self, T.Brkt, p, p + 1)
    default:
      break
  }
  return common(self, c) || (c === 0x3a && emit(self, T.Colon, p, p + 1))
}

/** Reads the whole source. */
function run(self: Lexer): Token[] {
  const n = self.src.length
  for (;;) {
    const p = self.p
    if (p >= n) {
      const kind = atEnd(self.state)
      emit(self, kind, n, n)
      break
    }
    const c = at(self, p)
    const beforeP = p
    const beforeState = self.state
    const beforeLen = self.stack.length
    let ok: boolean
    switch (self.state) {
      case S.Initial:
        ok = initial(self, c)
        break
      case S.Cls:
        if (spaceAt(self.src, p)) {
          space(self, true)
          ok = true
        } else if (c === 0x7d) {
          pop(self)
          pop(self)
          ok = emit(self, T.StructStop, p, p + 1)
        } else if (c === 0x7b) {
          push(self, S.ClassBody)
          ok = emit(self, T.StructStart, p, p + 1)
        } else {
          ok = common(self, c)
        }
        break
      case S.ClassBody:
        if (c === 0x22) {
          push(self, S.String)
          self.p += 1
        } else if (c === 0x7d) {
          pop(self)
          emit(self, T.StructStop, p, p + 1)
        } else if (c === 0x5b && starts(self, p + 1, '*]')) {
          emit(self, T.EdgeState, p, p + 3)
        } else if (c === 0x7b) {
          emit(self, T.OpenInStruct, p, p + 1)
        } else if (c === 0x0a) {
          self.p += 1
        } else {
          const src = self.src
          let q = p + 1
          while (q < n) {
            const ch = charCodeAt.call(src, q)
            if (ch === 0x7b || ch === 0x7d || ch === 0x0a) break
            q += 1
          }
          emit(self, T.Member, p, q)
        }
        ok = true
        break
      case S.Namespace:
        if (spaceAt(self.src, p)) {
          space(self, true)
          ok = true
        } else if (c === 0x7b) {
          push(self, S.NamespaceBody)
          ok = emit(self, T.StructStart, p, p + 1)
        } else if (c === 0x7d) {
          // The brace is read again in the state the namespace was opened from.
          pop(self)
          ok = true
        } else if (c === 0x6e && kw(self, 'namespace')) {
          push(self, S.Namespace)
          ok = emit(self, T.Namespace, p, p + 9)
        } else {
          ok = common(self, c)
        }
        break
      case S.NamespaceBody:
        if (spaceAt(self.src, p)) {
          space(self, false)
          ok = true
        } else if (c === 0x7d) {
          pop(self)
          ok = emit(self, T.StructStop, p, p + 1)
        } else if (c === 0x6e && kw(self, 'namespace')) {
          push(self, S.Namespace)
          ok = emit(self, T.Namespace, p, p + 9)
        } else if (c === 0x5b && starts(self, p + 1, '*]')) {
          ok = emit(self, T.EdgeState, p, p + 3)
        } else if (c === 0x63 && kw(self, 'class')) {
          push(self, S.Cls)
          ok = emit(self, T.Class, p, p + 5)
        } else {
          ok = common(self, c)
        }
        break
      case S.String:
        if (c === 0x22) {
          pop(self)
          self.p += 1
        } else {
          const e = until(self.src, p, 0x22)
          emit(self, T.Str, p, e)
        }
        ok = true
        break
      case S.Generic:
        if (c === 0x22) {
          push(self, S.String)
          self.p += 1
        } else if (keyword(self, c)) {
          // Taken.
        } else if (c === 0x7e) {
          pop(self)
          self.p += 1
        } else {
          const e = until(self.src, p, 0x7e)
          emit(self, T.Generictype, p, e)
        }
        ok = true
        break
      case S.Bqstring:
        if (c === 0x22) {
          push(self, S.String)
          self.p += 1
        } else if (keyword(self, c)) {
          // Taken.
        } else if (c === 0x7e) {
          push(self, S.Generic)
          self.p += 1
        } else if (c === 0x60) {
          pop(self)
          self.p += 1
        } else {
          const e = until(self.src, p, 0x60)
          emit(self, T.BquoteStr, p, e)
        }
        ok = true
        break
      case S.CallbackName:
        if (c === 0x28) {
          const q = skipSpaces(self.src, p + 1)
          pop(self)
          if (at(self, q) === 0x29) {
            self.p = q + 1
          } else {
            push(self, S.CallbackArgs)
            self.p += 1
          }
        } else {
          const e = until(self.src, p, 0x28)
          emit(self, T.CallbackName, p, e)
        }
        ok = true
        break
      case S.CallbackArgs:
        if (c === 0x29) {
          pop(self)
          self.p += 1
        } else {
          const e = until(self.src, p, 0x29)
          emit(self, T.CallbackArgs, p, e)
        }
        ok = true
        break
      case S.AccTitle:
      case S.AccDescr: {
        const kind = self.state === S.AccTitle ? T.AccTitleValue : T.AccDescrValue
        const e = until(self.src, p, 0x0a)
        emit(self, kind, p, e)
        pop(self)
        ok = true
        break
      }
      case S.AccDescrMultiline:
        if (c === 0x7d) {
          pop(self)
          self.p += 1
        } else {
          const e = until(self.src, p, 0x7d)
          emit(self, T.AccDescrMultilineValue, p, e)
        }
        ok = true
        break
    }

    if (!ok) {
      self.tokens.push({ kind: T.Error, start: self.p, text: '' })
      return self.tokens
    }
    // Every step reads input or changes state. A namespace closing with nothing below it
    // would do neither, and is reported as unrecognized text rather than looping.
    if (self.p === beforeP && self.state === beforeState && self.stack.length === beforeLen) {
      self.tokens.push({ kind: T.Error, start: self.p, text: '' })
      return self.tokens
    }
  }

  self.tokens.push({ kind: T.End, start: n, text: '' })
  return self.tokens
}
