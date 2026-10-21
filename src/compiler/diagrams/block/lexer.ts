/**
 * @module The block lexer: a state machine equivalent to Mermaid's Jison lexer. Port of Pele's
 * `src/diagrams/block/lexer.ts`.
 *
 * Pele reads UTF-16 code units, and so does this port. Every delimiter is ASCII, and no surrogate
 * is whitespace or a word character, so stepping over code units finds the same token boundaries
 * as the Rust crate's stepping over whole characters.
 */
import { isSpace, isWord } from '../../util/chars.ts'
import { T } from './tokens.ts'

/** A token: its kind, its start as a UTF-16 offset, and its text. */
export type Token = {
  /** The token kind. */
  kind: T
  /** The UTF-16 offset of the token in the source. */
  start: number
  /** The token text. Some tokens carry a fixed text in place of the matched one. */
  text: string
}

/** Lexer start conditions, as in Mermaid's grammar. */
const S = {
  AccDescr: 0,
  AccDescrMultiline: 1,
  AccTitle: 2,
  ArrowDir: 3,
  BlockArrow: 4,
  Class: 5,
  ClassDef: 6,
  ClassDefId: 7,
  ClassStyle: 8,
  Initial: 9,
  LLabel: 10,
  MdString: 11,
  Node: 12,
  String: 13,
  StyleDefinition: 14,
  StyleStmnt: 15,
} as const
type S = (typeof S)[keyof typeof S]

/**
 * `String.prototype.charCodeAt`, called as `charCodeAt.call(src, i)`. Sources reach the lexer as
 * strings of many internal kinds, and a method lookup per character that sees them all is slow;
 * see the comment in `text/measure.ts`.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** The code past the end of the source, which no test matches. Pele's `charCodeAt` returns `NaN`. */
const NONE = 4294967295

/** Block arrow directions, in the order Pele tries them. */
const DIRECTIONS = ['right', 'left', 'x', 'y', 'up', 'down'] as const

/** Whether an ASCII character ends a node id: `( ) [ { } < > - : =` and whitespace. */
function idStop(c: number): boolean {
  switch (c) {
    case 9:
    case 10:
    case 11:
    case 12:
    case 13:
    case 32:
    case 40:
    case 41:
    case 45:
    case 58:
    case 60:
    case 61:
    case 62:
    case 91:
    case 123:
    case 125:
      return true
    default:
      return false
  }
}

/** Lexer state. Pele keeps these as closure variables of `tokenize`. */
type Lexer = {
  p: number
  src: string
  stack: S[]
  state: S
  tokens: Token[]
}

/** The code unit at `at`, or {@link NONE} past the end. */
function code(self: Lexer, at: number): number {
  const src = self.src
  if (at >= src.length) return NONE
  return charCodeAt.call(src, at)
}

/** The offset after the code unit at `at`. */
function after(_self: Lexer, at: number): number {
  return at + 1
}

/** `src.startsWith(text, at)` for a non-empty ASCII `text`, compared unit by unit. */
function startsWith(self: Lexer, text: string, at: number): boolean {
  const src = self.src
  const n = text.length
  if (at + n > src.length) return false
  for (let i = 0; i < n; i++) if (charCodeAt.call(src, at + i) !== charCodeAt.call(text, i)) return false
  return true
}

function slice(self: Lexer, from: number, to: number): string {
  if (from > to || to > self.src.length) return ''
  return self.src.slice(from, to)
}

function put(self: Lexer, kind: T, text: string, end: number): boolean {
  self.tokens.push({ kind, start: self.p, text })
  self.p = end
  return true
}

function emit(self: Lexer, kind: T, end: number): boolean {
  const text = slice(self, self.p, end)
  return put(self, kind, text, end)
}

function push(self: Lexer, s: S): void {
  self.stack.push(self.state)
  self.state = s
}

function pop(self: Lexer): void {
  const s = self.stack.pop()
  if (s !== undefined) self.state = s
}

function ws(self: Lexer, q: number): number {
  while (q < self.src.length && isSpace(code(self, q))) q = after(self, q)
  return q
}

function digits(self: Lexer, q: number): number {
  const src = self.src
  while (q < src.length) {
    const c = charCodeAt.call(src, q)
    if (c < 48 || c > 57) break
    q += 1
  }
  return q
}

function word(self: Lexer, q: number): number {
  while (isWord(code(self, q))) q += 1
  return q
}

function keyword(self: Lexer, text: string): boolean {
  return startsWith(self, text, self.p) && !isWord(code(self, self.p + text.length))
}

function quote(self: Lexer): boolean {
  if (code(self, self.p + 1) === 96) {
    push(self, S.MdString)
    self.p += 2
  } else {
    push(self, S.String)
    self.p += 1
  }
  return true
}

/** The end of `.+-[xo>]?` at `q`, if there is one. */
function dotted(self: Lexer, q: number): number | undefined {
  if (code(self, q) !== 46) return undefined
  q += 1
  while (code(self, q) === 46) q += 1
  if (code(self, q) !== 45) return undefined
  const next = code(self, q + 1)
  return next === 120 || next === 111 || next === 62 ? q + 2 : q + 1
}

/** The end of a complete link at `q`, before its trailing whitespace, if there is one. */
function linkEnd(self: Lexer, q: number): number | undefined {
  const head = code(self, q)
  if (head === 120 || head === 111 || head === 60) q += 1
  const line = code(self, q)
  if (line === 46) return dotted(self, q)
  if (line !== 45 && line !== 61) return undefined
  let k = q + 1
  while (code(self, k) === line) k += 1
  if (k - q === 1) return line === 45 ? dotted(self, k) : undefined
  const tail = code(self, k)
  if (tail === 120 || tail === 111 || tail === 62) return k + 1
  return k - q >= 3 ? k : undefined
}

function link(self: Lexer): boolean {
  const e = linkEnd(self, self.p)
  if (e !== undefined) {
    const end = ws(self, e)
    return emit(self, T.Link, end)
  }
  const q = code(self, self.p) === 60 ? self.p + 1 : self.p
  const a = code(self, q)
  const b = code(self, q + 1)
  if ((a === 45 && (b === 45 || b === 46)) || (a === 61 && b === 61)) {
    push(self, S.LLabel)
    const end = ws(self, q + 2)
    return emit(self, T.StartLink, end)
  }
  return false
}

function lineState(self: Lexer, kind: T): boolean {
  const at = self.src.indexOf('\n', self.p)
  const e = at === -1 ? self.src.length : at
  pop(self)
  return emit(self, kind, e)
}

/** `\w+(,\s*\w+)*` */
function idList(self: Lexer, kind: T, next: S): boolean {
  let k = word(self, self.p)
  if (k === self.p) return false
  while (code(self, k) === 44) {
    const from = ws(self, k + 1)
    const to = word(self, from)
    if (to === from) break
    k = to
  }
  self.state = next
  return emit(self, kind, k)
}

function initial(self: Lexer, c: number): boolean {
  const p = self.p
  if (isSpace(c)) {
    self.p = ws(self, after(self, p))
    return true
  }
  switch (c) {
    case 98:
      if (startsWith(self, 'block', p)) {
        if (keyword(self, 'block-beta')) return emit(self, T.Key, p + 10)
        if (code(self, p + 5) === 58) return emit(self, T.IdBlock, p + 6)
        if (!isWord(code(self, p + 5))) return emit(self, T.Key, p + 5)
      }
      break
    case 99:
      if (startsWith(self, 'columns', p)) {
        const q = ws(self, p + 7)
        if (q > p + 7) {
          if (startsWith(self, 'auto', q) && !isWord(code(self, q + 4))) {
            return put(self, T.Columns, '-1', q + 4)
          }
          const e = digits(self, q)
          if (e > q) {
            const text = slice(self, q, e)
            return put(self, T.Columns, text, e)
          }
        }
      } else if (startsWith(self, 'class', p)) {
        const def = startsWith(self, 'Def', p + 5)
        const from = def ? p + 8 : p + 5
        const q = ws(self, from)
        if (q > from) {
          push(self, def ? S.ClassDef : S.Class)
          return emit(self, def ? T.ClassDef : T.Class, q)
        }
      }
      break
    case 34:
      return quote(self)
    case 115:
      if (startsWith(self, 'space', p)) {
        if (code(self, p + 5) === 58) {
          const e = digits(self, p + 6)
          if (e > p + 6) {
            const text = slice(self, p + 6, e)
            return put(self, T.SpaceBlock, text, e)
          }
        }
        if (!isWord(code(self, p + 5))) return put(self, T.SpaceBlock, '1', p + 5)
      } else if (startsWith(self, 'style', p)) {
        const q = ws(self, p + 5)
        if (q > p + 5) {
          push(self, S.StyleStmnt)
          return emit(self, T.Style, q)
        }
      }
      break
    case 100:
      if (keyword(self, 'default')) return emit(self, T.Default, p + 7)
      break
    case 108:
      if (keyword(self, 'linkStyle')) return emit(self, T.LinkStyle, p + 9)
      break
    case 105:
      if (keyword(self, 'interpolate')) return emit(self, T.Interpolate, p + 11)
      break
    case 97:
      if (startsWith(self, 'accTitle', p)) {
        const q = ws(self, p + 8)
        if (code(self, q) === 58) {
          push(self, S.AccTitle)
          const end = ws(self, q + 1)
          return emit(self, T.AccTitle, end)
        }
      } else if (startsWith(self, 'accDescr', p)) {
        const q = ws(self, p + 8)
        const d = code(self, q)
        if (d === 58) {
          push(self, S.AccDescr)
          const end = ws(self, q + 1)
          return emit(self, T.AccDescr, end)
        }
        if (d === 123) {
          push(self, S.AccDescrMultiline)
          self.p = ws(self, q + 1)
          return true
        }
      }
      break
    case 101:
      if (keyword(self, 'end')) {
        const end = ws(self, p + 3)
        return emit(self, T.EndKeyword, end)
      }
      break
    case 45:
      if (code(self, p + 1) === 41) {
        push(self, S.Node)
        return emit(self, T.NodeDStart, p + 2)
      }
      return link(self)
    case 61:
      return link(self)
    case 60:
      if (code(self, p + 1) === 91) {
        push(self, S.BlockArrow)
        return emit(self, T.BlockArrowStart, p + 2)
      }
      return link(self)
    case 40: {
      const d = code(self, p + 1)
      let len = 1
      if (d === 40 && code(self, p + 2) === 40) len = 3
      else if (d === 40 || d === 45 || d === 91) len = 2
      push(self, S.Node)
      return emit(self, T.NodeDStart, p + len)
    }
    case 41:
    case 123: {
      push(self, S.Node)
      const end = code(self, p + 1) === c ? p + 2 : p + 1
      return emit(self, T.NodeDStart, end)
    }
    case 62:
      push(self, S.Node)
      return emit(self, T.NodeDStart, p + 1)
    case 91: {
      const d = code(self, p + 1)
      push(self, S.Node)
      const end = d === 91 || d === 124 || d === 40 || d === 92 || d === 47 ? p + 2 : p + 1
      return emit(self, T.NodeDStart, end)
    }
    case 58: {
      const e = digits(self, p + 1)
      if (e > p + 1) {
        const text = slice(self, p + 1, e)
        return put(self, T.Size, text, e)
      }
      return false
    }
    default:
      break
  }

  let q = p
  while (q < self.src.length) {
    const ch = code(self, q)
    if (ch < 128 ? idStop(ch) : isSpace(ch)) break
    q = after(self, q)
  }
  return q > p && emit(self, T.NodeId, q)
}

function nodeEnd(self: Lexer, c: number): boolean {
  const p = self.p
  const d = code(self, p + 1)
  let len = 0
  switch (c) {
    case 34:
      return quote(self)
    case 40:
      if (d === 40 && code(self, p + 2) === 40) len = 3
      else if (d === 40 || d === 45) len = 2
      else len = 1
      break
    case 41:
      if (d === 41 && code(self, p + 2) === 41) len = 3
      else if (d === 41 || d === 93) len = 2
      else len = 1
      break
    case 125:
      len = d === 125 ? 2 : 1
      break
    case 45:
      if (d === 41) len = 2
      break
    case 93:
      len = d === 93 || d === 41 || d === 62 ? 2 : 1
      break
    case 92:
    case 47:
      if (d === 93) len = 2
      break
    default:
      break
  }
  if (len === 0) return false
  pop(self)
  return emit(self, T.NodeDEnd, p + len)
}

function arrowDir(self: Lexer, c: number): boolean {
  const p = self.p
  if (c === 41) {
    pop(self)
    pop(self)
    const end = ws(self, p + 1)
    return put(self, T.BlockArrowEnd, ']>', end)
  }
  const from = ws(self, c === 44 ? p + 1 : p)
  for (const dir of DIRECTIONS) {
    if (startsWith(self, dir, from)) {
      const e = ws(self, from + dir.length)
      const text = slice(self, c === 44 ? from : p, e)
      return put(self, T.Dir, text, e)
    }
  }
  return false
}

/** The token kind a state yields at the end of input, if any. */
function finalKind(self: Lexer): T | undefined {
  switch (self.state) {
    case S.Initial:
      return T.Eof
    case S.String:
      return T.Str
    case S.ClassDefId:
      return T.ClassDefStyleOpts
    case S.ClassStyle:
      return T.StyleClass
    case S.StyleDefinition:
      return T.StyleDefinitionData
    case S.AccTitle:
      return T.AccTitleValue
    case S.AccDescr:
      return T.AccDescrValue
    case S.AccDescrMultiline:
      return T.AccDescrMultilineValue
    default:
      return undefined
  }
}

/** The end of text up to the next `needle` from the current position, or the end of input. */
function until(self: Lexer, needle: string): number {
  const at = self.src.indexOf(needle, self.p)
  return at === -1 ? self.src.length : at
}

function step(self: Lexer, c: number): boolean {
  const p = self.p
  switch (self.state) {
    case S.Initial:
      return initial(self, c)
    case S.String:
      if (c === 34) {
        pop(self)
        self.p += 1
      } else {
        const e = until(self, '"')
        emit(self, T.Str, e)
      }
      return true
    case S.MdString: {
      if (c === 96) {
        const ok = code(self, p + 1) === 34
        if (ok) {
          pop(self)
          self.p += 2
        }
        return ok
      }
      if (c === 34) return false
      let q = after(self, p)
      while (q < self.src.length) {
        const ch = code(self, q)
        if (ch === 96 || ch === 34) break
        q = after(self, q)
      }
      return emit(self, T.MdStr, q)
    }
    case S.Node:
      return nodeEnd(self, c)
    case S.BlockArrow: {
      if (c === 34) return quote(self)
      if (c === 93 && code(self, p + 1) === 62) {
        const q = ws(self, p + 2)
        const ok = code(self, q) === 40
        if (ok) {
          push(self, S.ArrowDir)
          self.p = q + 1
        }
        return ok
      }
      return false
    }
    case S.ArrowDir:
      return arrowDir(self, c)
    case S.LLabel: {
      if (c === 34) {
        if (code(self, p + 1) === 96) {
          quote(self)
        } else {
          emit(self, T.LinkLabel, p + 1)
          push(self, S.String)
        }
        return true
      }
      const from = ws(self, p)
      const e = linkEnd(self, from)
      if (e === undefined) return false
      pop(self)
      const end = ws(self, e)
      return emit(self, T.Link, end)
    }
    case S.ClassDef: {
      let kind: T = T.DefaultClassDefId
      let k = startsWith(self, 'DEFAULT', p) ? p + 7 : p
      let q = ws(self, k)
      if (k === p || q === k) {
        kind = T.ClassDefId
        k = word(self, p)
        q = ws(self, k)
      }
      const ok = k > p && q > k
      if (ok) {
        self.state = S.ClassDefId
        emit(self, kind, q)
      }
      return ok
    }
    case S.ClassDefId:
      return lineState(self, T.ClassDefStyleOpts)
    case S.Class:
      return idList(self, T.ClassEntityIds, S.ClassStyle)
    case S.ClassStyle:
      return lineState(self, T.StyleClass)
    case S.StyleStmnt:
      return idList(self, T.StyleEntityIds, S.StyleDefinition)
    case S.StyleDefinition:
      return lineState(self, T.StyleDefinitionData)
    case S.AccTitle:
      return lineState(self, T.AccTitleValue)
    case S.AccDescr:
      return lineState(self, T.AccDescrValue)
    case S.AccDescrMultiline:
      if (c === 125) {
        pop(self)
        self.p += 1
      } else {
        const e = until(self, '}')
        emit(self, T.AccDescrMultilineValue, e)
      }
      return true
  }
}

/**
 * Splits `src` into tokens. The list ends with {@link T.End}, or with {@link T.Error} at
 * unrecognized text.
 */
export function tokenize(src: string): Token[] {
  const lexer: Lexer = { p: 0, src, stack: [], state: S.Initial, tokens: [] }
  const n = src.length

  for (;;) {
    if (lexer.p >= n) {
      lexer.p = n
      const kind = finalKind(lexer)
      if (kind !== undefined) put(lexer, kind, '', n)
      break
    }

    const c = code(lexer, lexer.p)
    if (!step(lexer, c)) {
      lexer.tokens.push({ kind: T.Error, start: lexer.p, text: '' })
      return lexer.tokens
    }
  }

  lexer.tokens.push({ kind: T.End, start: n, text: '' })
  return lexer.tokens
}
