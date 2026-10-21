/**
 * @module The sequence lexer, a state machine over Mermaid's lexer rules. Port of Pele's
 * `src/diagrams/sequence/lexer.ts`.
 *
 * Pele reads UTF-16 code units. The Rust crate reads UTF-8 bytes and decodes a non-ASCII character
 * whole wherever a rule looks at it; this port reads UTF-16 units and decodes a character outside
 * the BMP whole in the same places, so token boundaries match.
 */
import { trim } from '../../text/label.ts'
import { isDigit, isSpace, isWord } from '../../util/chars.ts'
import { T } from './tokens.ts'

/** A token: its kind, its UTF-16 offset, and its text. */
export type Token = {
  /** The kind. */
  kind: T
  /** The UTF-16 offset in the source. */
  start: number
  /** The text, trimmed for participant names. */
  text: string
}

/** A lexer state, as Mermaid's lexer names its start conditions. */
const S = {
  Initial: 0,
  Id: 1,
  Alias: 2,
  Line: 3,
  Config: 4,
  AccTitle: 5,
  AccDescr: 6,
  AccDescrMultiline: 7,
} as const
type S = (typeof S)[keyof typeof S]

const ACTOR_START = 1
const ACTOR_REST = 2
const ID = 4
const ID_WIDE = 8
const LINE = 16
const MENU = 32

/** Character classes of Mermaid's lexer rules, for ASCII. Other characters are tested by `\s`. */
const CLASS: Uint8Array = (() => {
  const table = new Uint8Array(128)
  for (let c = 0; c < 128; c++) {
    const ws = c === 32 || (c >= 9 && c <= 13)
    let bits = 0
    if (!inSet(c, '/\\+()<->:\n,;')) bits |= ACTOR_START
    if (!inSet(c, '+<->:\n,;')) bits |= ACTOR_REST
    if (!inSet(c, '<>:\n,;@')) bits |= ID_WIDE | (ws ? 0 : ID)
    if (!inSet(c, '#\n;')) bits |= LINE
    if (!inSet(c, '/\\+()<>:\n,;-') && !ws) bits |= MENU
    table[c] = bits
  }
  return table
})()

function inSet(c: number, set: string): boolean {
  for (let i = 0; i < set.length; i++) {
    if (set.charCodeAt(i) === c) return true
  }
  return false
}

/** What `charCodeAt` returns past the end. It is no character, so every test of it fails. */
const NONE = 4294967295

type Lexer = {
  /** Participant names emitted so far, so that a repeated name is the same string. */
  names: string[]
  n: number
  nextNl: number | undefined
  p: number
  src: string
  stack: S[]
  state: S
  tokens: Token[]
}

/** The character at UTF-16 offset `q`, or `NONE` past the end. */
function lexerAt(self: Lexer, q: number): number {
  if (q < 0 || q >= self.n) return NONE
  const c = self.src.charCodeAt(q)
  if (c < 0x80) return c
  return self.src.codePointAt(q) as number
}

/** The UTF-16 length of the character at `q`. */
function lexerLen(self: Lexer, q: number): number {
  if (q < 0 || q >= self.n) return 1
  const c = self.src.charCodeAt(q)
  if (c < 0x80) return 1
  return (self.src.codePointAt(q) as number) > 0xffff ? 2 : 1
}

function lexerSlice(self: Lexer, s: number, e: number): string {
  return self.src.slice(s, e)
}

/**
 * `text` or an equal participant name emitted before. Sharing one string per name lets the maps
 * keyed by names hash each name once.
 */
function lexerName(self: Lexer, text: string): string {
  const names = self.names
  for (let i = 0; i < names.length; i++) {
    const name = names[i] as string
    if (name === text) return name
  }
  if (names.length < 16) names.push(text)
  return text
}

function lexerEmit(self: Lexer, kind: T, s: number, e: number): void {
  const text = lexerSlice(self, s, e)
  lexerEmitText(self, kind, s, e, text)
}

function lexerEmitText(self: Lexer, kind: T, s: number, e: number, text: string): void {
  self.tokens.push({ kind, start: s, text })
  self.p = e
}

function lexerPush(self: Lexer, next: S): void {
  self.stack.push(self.state)
  self.state = next
}

function lexerPop(self: Lexer): void {
  const state = self.stack.pop()
  if (state !== undefined) self.state = state
}

function lexerEol(self: Lexer, q: number): number {
  if (self.nextNl === undefined || self.nextNl < q) {
    const found = q <= self.n ? self.src.indexOf('\n', q) : -1
    self.nextNl = found < 0 ? self.n : found
  }
  return self.nextNl
}

function lexerHas(self: Lexer, q: number, bit: number): boolean {
  const c = lexerAt(self, q)
  if (c < 128) return ((CLASS[c] as number) & bit) !== 0
  if (bit === ID || bit === MENU) return !isSpace(c)
  return true
}

/** The end of the run of characters with class `bit` from `q`. */
function lexerRunOf(self: Lexer, q: number, bit: number): number {
  const src = self.src
  const n = self.n
  while (q < n) {
    const c = src.charCodeAt(q)
    if (c < 128) {
      if (((CLASS[c] as number) & bit) === 0) return q
      q += 1
      continue
    }
    const code = src.codePointAt(q) as number
    if ((bit === ID || bit === MENU) && isSpace(code)) return q
    q += code > 0xffff ? 2 : 1
  }
  return q
}

/** Matches a lowercase literal without regard to the case of the source. */
function lexerCi(self: Lexer, q: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) {
    if (q + k >= self.n) return false
    const c = self.src.charCodeAt(q + k)
    const w = word.charCodeAt(k)
    if (w >= 97 && w <= 122) {
      if ((c | 32) !== w) return false
    } else if (c !== w) return false
  }
  return true
}

function lexerWord(self: Lexer, lit: string): boolean {
  return lexerCi(self, self.p, lit) && !isWord(lexerAt(self, self.p + lit.length))
}

function lexerSkipWs(self: Lexer, q: number): number {
  const src = self.src
  const n = self.n
  while (q < n) {
    const c = src.charCodeAt(q)
    if (c < 128) {
      if (!(c === 32 || (c >= 9 && c <= 13))) return q
      q += 1
      continue
    }
    const code = src.codePointAt(q) as number
    if (!isSpace(code)) return q
    q += code > 0xffff ? 2 : 1
  }
  return q
}

function lexerSkipSameLine(self: Lexer): boolean {
  let q = self.p
  while (q < self.n) {
    const c = lexerAt(self, q)
    if (c === 10 || !isSpace(c)) break
    q += lexerLen(self, q)
  }
  if (q === self.p) return false
  self.p = q
  return true
}

function lexerLineRun(self: Lexer, q: number): number {
  return lexerRunOf(self, q, LINE)
}

function lexerBegin(self: Lexer, kind: T, len: number, next: S): void {
  lexerEmit(self, kind, self.p, self.p + len)
  lexerPush(self, next)
}

function lexerKeyword(self: Lexer, lit: string, kind: T, next: S | undefined): boolean {
  if (!lexerWord(self, lit)) return false
  lexerEmit(self, kind, self.p, self.p + lit.length)
  if (next !== undefined) lexerPush(self, next)
  return true
}

/** The actor menu keywords count only when spaces and the start of a name follow. */
function lexerMenu(self: Lexer, lit: string, kind: T): boolean {
  if (!lexerCi(self, self.p, lit)) return false
  let q = self.p + lit.length
  let c = lexerAt(self, q)
  if (c !== 32 && c !== 9) return false
  while (c === 32 || c === 9) {
    q += 1
    c = lexerAt(self, q)
  }
  if (q >= self.n || !lexerHas(self, q, MENU)) return false
  lexerEmit(self, kind, self.p, self.p + lit.length)
  return true
}

function lexerArrowAhead(self: Lexer, q: number): boolean {
  const c = lexerAt(self, q)
  const d = lexerAt(self, q + 1)
  if (c === 45) {
    if (d === 120 || d === 88 || d === 41 || d === 92 || d === 47 || d === 45) return true
    const e = lexerAt(self, q + 2)
    return d === 124 && (e === 92 || e === 47)
  }
  if (c === 47 || c === 92) return (d === 124 || d === c) && lexerAt(self, q + 2) === 45
  return c === 40 && d === 41
}

function lexerActor(self: Lexer): void {
  const p = self.p
  let q = lexerRunOf(self, p + lexerLen(self, p), ACTOR_START)
  while (q < self.n && !lexerArrowAhead(self, q)) {
    let r = q
    while (lexerAt(self, r) === 45) r += 1
    if (r >= self.n || !lexerHas(self, r, ACTOR_REST)) break
    r = lexerRunOf(self, r + lexerLen(self, r), ACTOR_REST)
    q = r
  }
  const text = trim(lexerSlice(self, p, q))
  lexerEmitText(self, T.Actor, p, q, lexerName(self, text))
}

function lexerNumber(self: Lexer): boolean {
  const p = self.p
  let q = p
  while (isDigit(lexerAt(self, q))) q += 1
  const whole = q > p
  if (lexerAt(self, q) === 46 && isDigit(lexerAt(self, q + 1))) {
    const r = isDigit(lexerAt(self, q + 2)) ? q + 3 : q + 2
    const after = lexerAt(self, r)
    if (after === 32 || after === 10) {
      lexerEmit(self, T.Num, p, r)
      return true
    }
  }
  const after = lexerAt(self, q)
  if (whole && (after === 32 || after === 10)) {
    lexerEmit(self, T.Num, p, q)
    return true
  }
  return false
}

function lexerDash(self: Lexer): void {
  const p = self.p
  const d = lexerAt(self, p + 1)
  const e = lexerAt(self, p + 2)
  let kind: T
  let len: number
  if (d === 62 && e === 62) [kind, len] = [T.SolidArrow, 3]
  else if (d === 62) [kind, len] = [T.SolidOpenArrow, 2]
  else if (d === 120 || d === 88) [kind, len] = [T.SolidCross, 2]
  else if (d === 41) [kind, len] = [T.SolidPoint, 2]
  else if (d === 124 && e === 92) [kind, len] = [T.SolidArrowTop, 3]
  else if (d === 124 && e === 47) [kind, len] = [T.SolidArrowBottom, 3]
  else if (d === 92 && e === 92) [kind, len] = [T.StickArrowTop, 3]
  else if (d === 47 && e === 47) [kind, len] = [T.StickArrowBottom, 3]
  else if (d === 45) {
    const f = lexerAt(self, p + 3)
    if (e === 62 && f === 62) [kind, len] = [T.DottedArrow, 4]
    else if (e === 62) [kind, len] = [T.DottedOpenArrow, 3]
    else if (e === 120 || e === 88) [kind, len] = [T.DottedCross, 3]
    else if (e === 41) [kind, len] = [T.DottedPoint, 3]
    else if (e === 124 && f === 92) [kind, len] = [T.SolidArrowTopDotted, 4]
    else if (e === 124 && f === 47) [kind, len] = [T.SolidArrowBottomDotted, 4]
    else if (e === 92 && f === 92) [kind, len] = [T.StickArrowTopDotted, 4]
    else if (e === 47 && f === 47) [kind, len] = [T.StickArrowBottomDotted, 4]
    else [kind, len] = [T.Minus, 1]
  } else [kind, len] = [T.Minus, 1]
  lexerEmit(self, kind, p, p + len)
}

function lexerReverse(self: Lexer, c: number): boolean {
  const p = self.p
  const d = lexerAt(self, p + 1)
  if ((d !== 124 && d !== c) || lexerAt(self, p + 2) !== 45) return false
  const dotted = lexerAt(self, p + 3) === 45
  const top = c === 47
  let kind: T
  if (d === 124) {
    if (dotted) kind = top ? T.SolidArrowTopReverseDotted : T.SolidArrowBottomReverseDotted
    else kind = top ? T.SolidArrowTopReverse : T.SolidArrowBottomReverse
  } else if (dotted) kind = top ? T.StickArrowTopReverseDotted : T.StickArrowBottomReverseDotted
  else kind = top ? T.StickArrowTopReverse : T.StickArrowBottomReverse
  lexerEmit(self, kind, p, p + (dotted ? 4 : 3))
  return true
}

function lexerTitle(self: Lexer): boolean {
  const p = self.p
  if (!lexerCi(self, p, 'title')) return false
  let q = p + 5
  const legacy = lexerAt(self, q) === 58
  if (legacy) q += 1
  const next = q + lexerLen(self, q)
  if (!isSpace(lexerAt(self, q)) || next >= self.n || !lexerHas(self, next, LINE)) return false
  const end = lexerLineRun(self, next)
  lexerEmit(self, legacy ? T.LegacyTitle : T.Title, p, end)
  return true
}

function lexerAcc(self: Lexer): boolean {
  const p = self.p
  const descr = lexerCi(self, p, 'accdescr')
  if (!descr && !lexerCi(self, p, 'acctitle')) return false
  const q = lexerSkipWs(self, p + 8)
  const c = lexerAt(self, q)
  if (c === 58) {
    const end = lexerSkipWs(self, q + 1)
    lexerEmit(self, descr ? T.AccDescr : T.AccTitle, p, end)
    lexerPush(self, descr ? S.AccDescr : S.AccTitle)
    return true
  }
  if (descr && c === 123) {
    self.p = lexerSkipWs(self, q + 1)
    lexerPush(self, S.AccDescrMultiline)
    return true
  }
  return false
}

function lexerKeywords(self: Lexer, c: number): boolean {
  switch (c | 32) {
    case 97:
      return (
        lexerKeyword(self, 'actor', T.ParticipantActor, S.Id) ||
        lexerKeyword(self, 'alt', T.Alt, S.Line) ||
        lexerKeyword(self, 'and', T.And, S.Line) ||
        lexerKeyword(self, 'activate', T.Activate, S.Id) ||
        lexerAcc(self) ||
        lexerKeyword(self, 'autonumber', T.Autonumber, undefined)
      )
    case 98:
      return lexerKeyword(self, 'box', T.Box, S.Line) || lexerKeyword(self, 'break', T.Break, S.Line)
    case 99:
      return lexerKeyword(self, 'create', T.Create, undefined) || lexerKeyword(self, 'critical', T.Critical, S.Line)
    case 100:
      return (
        lexerKeyword(self, 'destroy', T.Destroy, S.Id) ||
        lexerMenu(self, 'details', T.Details) ||
        lexerKeyword(self, 'deactivate', T.Deactivate, S.Id)
      )
    case 101:
      return lexerKeyword(self, 'else', T.Else, S.Line) || lexerKeyword(self, 'end', T.End, undefined)
    case 108:
      return (
        lexerKeyword(self, 'loop', T.Loop, S.Line) ||
        lexerKeyword(self, 'left of', T.LeftOf, undefined) ||
        lexerMenu(self, 'links', T.Links) ||
        lexerMenu(self, 'link', T.Link)
      )
    case 110:
      return lexerKeyword(self, 'note', T.Note, undefined)
    case 111:
      return (
        lexerKeyword(self, 'opt', T.Opt, S.Line) ||
        lexerKeyword(self, 'option', T.Option, S.Line) ||
        lexerKeyword(self, 'over', T.Over, undefined) ||
        lexerKeyword(self, 'off', T.Off, undefined)
      )
    case 112:
      return (
        lexerKeyword(self, 'participant', T.Participant, S.Id) ||
        lexerKeyword(self, 'par', T.Par, S.Line) ||
        lexerKeyword(self, 'par_over', T.ParOver, S.Line) ||
        lexerMenu(self, 'properties', T.Properties)
      )
    case 114:
      return lexerKeyword(self, 'rect', T.Rect, S.Line) || lexerKeyword(self, 'right of', T.RightOf, undefined)
    case 115:
      return lexerKeyword(self, 'sequencediagram', T.Sd, undefined)
    case 116:
      return lexerTitle(self)
    default:
      return false
  }
}

function lexerInitial(self: Lexer): void {
  const p = self.p
  const c = lexerAt(self, p)
  if (c === 10) {
    let q = p + 1
    while (lexerAt(self, q) === 10) q += 1
    lexerEmit(self, T.Newline, p, q)
    return
  }
  if (isSpace(c)) {
    self.p = lexerSkipWs(self, p + lexerLen(self, p))
    return
  }
  if (c === 35 || (c === 37 && lexerAt(self, p + 1) !== 123)) {
    self.p = lexerEol(self, p)
    return
  }
  // Pele looks one UTF-16 unit on, which is half of a character outside the BMP.
  const next = p + lexerLen(self, p)
  if (c !== 125 && c <= 0xffff && lexerAt(self, next) === 37 && lexerAt(self, next + 1) === 37) {
    self.p = lexerEol(self, p)
    return
  }
  if ((isDigit(c) || c === 46) && lexerNumber(self)) return
  if (c < 128 && (c | 32) >= 97 && (c | 32) <= 122 && lexerKeywords(self, c)) return
  if (c === 44) lexerEmit(self, T.Comma, p, p + 1)
  else if (c === 59) lexerEmit(self, T.Newline, p, p + 1)
  else if (lexerHas(self, p, ACTOR_START)) lexerActor(self)
  else if (c === 45) lexerDash(self)
  else if (c === 60 && self.src.startsWith('<<->>', p)) lexerEmit(self, T.BidirectionalSolidArrow, p, p + 5)
  else if (c === 60 && self.src.startsWith('<<-->>', p)) lexerEmit(self, T.BidirectionalDottedArrow, p, p + 6)
  else if ((c === 47 || c === 92) && lexerReverse(self, c)) {
    // Emitted by `lexerReverse`.
  } else if (c === 58) {
    const end = lexerLineRun(self, p + 1)
    lexerEmit(self, T.Txt, p, end)
  } else if (c === 43) lexerEmit(self, T.Plus, p, p + 1)
  else if (c === 40 && lexerAt(self, p + 1) === 41) lexerEmit(self, T.Central, p, p + 2)
  else lexerEmit(self, T.Invalid, p, p + 1)
}

/** A participant name, up to an alias, a config object, or the end of the statement. */
function lexerId(self: Lexer): boolean {
  if (lexerSkipSameLine(self)) return true
  const p = self.p
  const c = lexerAt(self, p)
  if (c === 35) {
    self.p = lexerEol(self, p)
    return true
  }
  if (c === 64 && lexerAt(self, p + 1) === 123) {
    lexerBegin(self, T.ConfigStart, 2, S.Config)
    return true
  }
  const a = lexerRunOf(self, p, ID)
  if (a > p) {
    const w = lexerSkipWs(self, a)
    if (lexerAt(self, w) === 64 && lexerAt(self, w + 1) === 123) {
      lexerEmitText(self, T.Actor, p, a, lexerName(self, lexerSlice(self, p, a)))
      return true
    }
    if (w > a && lexerCi(self, w, 'as') && isSpace(lexerAt(self, w + 2))) {
      lexerEmitText(self, T.Actor, p, a, lexerName(self, lexerSlice(self, p, a)))
      lexerPush(self, S.Alias)
      return true
    }
  }
  const b = lexerRunOf(self, a, ID_WIDE)
  if (b > p) {
    const end = lexerAt(self, b)
    // Before any other delimiter the name must be followed by a comment, so it ends at the last
    // one.
    let cut = b
    if (b < self.n && end !== 10 && end !== 59) {
      cut -= 1
      while (cut > p && self.src.charCodeAt(cut) !== 35) cut -= 1
    }
    if (cut > p) {
      const text = trim(lexerSlice(self, p, cut))
      lexerEmitText(self, T.Actor, p, cut, lexerName(self, text))
      lexerPop(self)
      return true
    }
  }
  if (lexerAt(self, b) === 60) {
    const e = lexerEol(self, p)
    lexerEmit(self, T.Invalid, p, e)
    lexerPop(self)
    return true
  }
  if (c !== 10) {
    const e = lexerEol(self, p)
    const text = trim(lexerSlice(self, p, e))
    lexerEmitText(self, T.Invalid, p, e, text)
    lexerPop(self)
    return true
  }
  return false
}

function lexerStep(self: Lexer): boolean {
  switch (self.state) {
    case S.Initial:
      lexerInitial(self)
      return true
    case S.Id:
      return lexerId(self)
    case S.Alias:
      if (lexerSkipSameLine(self)) return true
      if (lexerAt(self, self.p) === 35) {
        self.p = lexerEol(self, self.p)
        return true
      }
      lexerPop(self)
      lexerPop(self)
      if (lexerWord(self, 'as')) lexerBegin(self, T.As, 2, S.Line)
      else lexerEmit(self, T.Newline, self.p, self.p)
      return true
    case S.Line: {
      if (lexerSkipSameLine(self)) return true
      if (lexerAt(self, self.p) === 35) {
        self.p = lexerEol(self, self.p)
        return true
      }
      const end = lexerLineRun(self, self.p)
      lexerEmit(self, T.RestOfLine, self.p, end)
      lexerPop(self)
      return true
    }
    case S.Config: {
      const p = self.p
      if (lexerAt(self, p) === 125) {
        const w = lexerSkipWs(self, p + 1)
        const alias = w > p + 1 && lexerCi(self, w, 'as') && isSpace(lexerAt(self, w + 2))
        lexerEmit(self, T.ConfigEnd, p, p + 1)
        lexerPop(self)
        if (alias) lexerPush(self, S.Alias)
        else lexerPop(self)
      } else {
        const q = lexerCloseBrace(self, p)
        lexerEmit(self, T.ConfigContent, p, q)
      }
      return true
    }
    case S.AccTitle:
    case S.AccDescr: {
      const kind = self.state === S.AccTitle ? T.AccTitleValue : T.AccDescrValue
      const e = lexerEol(self, self.p)
      lexerEmit(self, kind, self.p, e)
      lexerPop(self)
      return true
    }
    case S.AccDescrMultiline: {
      const p = self.p
      if (lexerAt(self, p) === 125) {
        self.p += 1
        lexerPop(self)
      } else {
        const q = lexerCloseBrace(self, p)
        lexerEmit(self, T.AccDescrMultilineValue, p, q)
      }
      return true
    }
  }
}

/** The offset of the next `}` from `q`, or the end. */
function lexerCloseBrace(self: Lexer, q: number): number {
  const at = q <= self.n ? self.src.indexOf('}', q) : -1
  return at < 0 ? self.n : at
}

/**
 * Splits preprocessed sequence diagram `src` into tokens, ending with `T.Eof`, or with `T.Error`
 * where no rule matches.
 */
export function tokenize(src: string): Token[] {
  const lexer: Lexer = {
    names: [],
    n: src.length,
    nextNl: undefined,
    p: 0,
    src,
    stack: [],
    state: S.Initial,
    tokens: [],
  }

  while (lexer.p < lexer.n) {
    if (!lexerStep(lexer)) {
      const p = lexer.p
      lexer.tokens.push({ kind: T.Error, start: p, text: '' })
      return lexer.tokens
    }
  }

  // Mermaid's lexer tries its rules once more on the empty remainder before reporting the end.
  const n = lexer.n
  let last: T | undefined
  switch (lexer.state) {
    case S.Initial:
    case S.Alias:
      last = T.Newline
      break
    case S.Line:
      last = T.RestOfLine
      break
    case S.AccTitle:
      last = T.AccTitleValue
      break
    case S.AccDescr:
      last = T.AccDescrValue
      break
    case S.AccDescrMultiline:
      last = T.AccDescrMultilineValue
      break
    case S.Id:
    case S.Config:
      last = undefined
      break
  }
  if (last !== undefined) lexerEmit(lexer, last, n, n)
  lexer.tokens.push({ kind: T.Eof, start: n, text: '' })
  return lexer.tokens
}
