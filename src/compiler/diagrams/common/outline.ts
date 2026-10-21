/**
 * @module The indented outline grammar that Mermaid's mindmap and kanban diagrams share. Kanban
 * adds `@{ ... }` metadata after a node and keeps `@` out of node ids. Port of Pele's
 * `src/diagrams/common/outline.ts`.
 *
 * Offsets are UTF-16. Every delimiter is ASCII, and the whitespace and line tests match only
 * characters in the Basic Multilingual Plane, so token boundaries match Pele's.
 */
import { errorSyntax } from '../../error.ts'
import type { CompileError } from '../../error.ts'
import { isLineEnd, isSpace, isWord } from '../../util/chars.ts'

/** Token types. The order is observable: it matches the generated parser's numbering. */
export const T = {
  /** The end of the tokens. */
  End: 0,
  /** Text no rule matches. */
  Error: 1,
  /** A line of only whitespace or a comment. */
  Spaceline: 2,
  /** A line break. */
  Nl: 3,
  /** The end of input. */
  Eof: 4,
  /** `mindmap` or `kanban`. */
  Keyword: 5,
  /** The indentation before a node. */
  Spacelist: 6,
  /** `::icon(...)` text. */
  Icon: 7,
  /** `:::` class text. */
  Class: 8,
  /** An opening node delimiter. */
  NodeDstart: 9,
  /** A node id. */
  NodeId: 10,
  /** Node text. */
  NodeDescr: 11,
  /** A closing node delimiter. */
  NodeDend: 12,
  /** Kanban `@{ ... }` metadata. */
  ShapeData: 13,
} as const
export type T = (typeof T)[keyof typeof T]

/**
 * The name the generated parser prints for a token type. It has no name for the end of input
 * and prints its number.
 */
export function tokenName(kind: T, kanban: boolean): string {
  switch (kind) {
    case T.End:
      return '1'
    case T.Error:
      return 'INVALID'
    case T.Spaceline:
      return 'SPACELINE'
    case T.Nl:
      return 'NL'
    case T.Eof:
      return 'EOF'
    case T.Keyword:
      return kanban ? 'KANBAN' : 'MINDMAP'
    case T.Spacelist:
      return 'SPACELIST'
    case T.Icon:
      return 'ICON'
    case T.Class:
      return 'CLASS'
    case T.NodeDstart:
      return 'NODE_DSTART'
    case T.NodeId:
      return 'NODE_ID'
    case T.NodeDescr:
      return 'NODE_DESCR'
    case T.NodeDend:
      return 'NODE_DEND'
    case T.ShapeData:
      return 'SHAPE_DATA'
  }
}

/** Tokens of an outline: parallel lists of types, texts, and UTF-16 starts. */
export type Tokens = {
  /** Where each token starts. */
  starts: number[]
  /** The text of each token. Quoted metadata has its line breaks rewritten. */
  texts: string[]
  /** The type of each token. */
  types: T[]
}

/** No tokens. */
export function tokensDefault(): Tokens {
  return { starts: [], texts: [], types: [] }
}

/** Node shapes, as Mermaid numbers them. */
export const node_type = {
  /** No shape given. */
  DEFAULT: 0,
  /** No border; the same as the default. */
  NO_BORDER: 0,
  /** `(text)`. */
  ROUNDED_RECT: 1,
  /** `[text]`. */
  RECT: 2,
  /** `((text))`. */
  CIRCLE: 3,
  /** `)text(`. */
  CLOUD: 4,
  /** `))text((`. */
  BANG: 5,
  /** `{{text}}`. */
  HEXAGON: 6,
} as const

/**
 * The node shape for an opening and a closing delimiter. Any opening delimiter pairs with any
 * closing one, as in Mermaid.
 */
export function getType(start: string, end: string): number {
  switch (start) {
    case '[':
      return node_type.RECT
    case '(':
      return end === ')' ? node_type.ROUNDED_RECT : node_type.CLOUD
    case ')':
      return node_type.CLOUD
    case '((':
      return node_type.CIRCLE
    case '))':
      return node_type.BANG
    case '{{':
      return node_type.HEXAGON
    default:
      return node_type.DEFAULT
  }
}

/** A decoration for the last node: an icon or a class. */
export type Decoration = {
  /** The class names. */
  class: string | undefined
  /** The icon name. */
  icon: string | undefined
}

/** A decoration with neither an icon nor a class. */
export function decorationDefault(): Decoration {
  return { class: undefined, icon: undefined }
}

/** What the grammar's actions call, as Pele's `OutlineDb` describes it. */
export type OutlineDb = {
  /**
   * Adds a node at indentation `level` (in UTF-16 units) with its shape `kind` and kanban
   * metadata.
   */
  addNode(level: number, id: string, descr: string, kind: number, shapeData: string | undefined): void

  /** Decorates the last node. */
  decorateNode(decoration: Decoration): void

  /**
   * The node shape for an opening and a closing delimiter. Without it, {@link getType} is
   * used, as the Rust trait's default method does.
   */
  getType?(start: string, end: string): number
}

/**
 * `String.prototype.charCodeAt`, called as `charCodeAt.call(src, i)`, which stays a direct read
 * whatever internal kind of string arrives. It stays unexported, as `text/measure.ts` explains.
 */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** Lexer start conditions. */
const S = {
  Class: 0,
  Data: 1,
  DataStr: 2,
  Icon: 3,
  Initial: 4,
  Node: 5,
  Nstr: 6,
  Nstr2: 7,
} as const
type S = (typeof S)[keyof typeof S]

/** `\s+` from `p`, or `undefined` for an empty run. */
function spaces(src: string, p: number): number | undefined {
  let at = p
  const n = src.length
  // Every space is in the Basic Multilingual Plane, so stepping one unit steps one character.
  while (at < n && isSpace(charCodeAt.call(src, at))) at += 1
  return at > p ? at : undefined
}

/** `.+` from `p`: to the first line terminator, or `undefined` for an empty run. */
function line(src: string, p: number): number | undefined {
  const n = src.length
  if (p > n) return undefined
  let at = p
  // Every line terminator is in the Basic Multilingual Plane.
  while (at < n && !isLineEnd(charCodeAt.call(src, at))) at += 1
  return at > p ? at : undefined
}

/** A set of ASCII stop characters for {@link run}: 1 at each stop's code. */
function stopSet(stops: string): Uint8Array {
  const set = new Uint8Array(128)
  for (let k = 0; k < stops.length; k++) set[stops.charCodeAt(k)] = 1
  return set
}

const ID_STOPS = stopSet('([\n){}')
const KANBAN_ID_STOPS = stopSet('([\n){}@')
const DESCR_STOPS = stopSet(')](}')
const NSTR2_STOPS = stopSet('`"')
const DATA_STOPS = stopSet('}^"')

/** A run of units outside `stops` from `p`, or `undefined` for an empty run. Every stop is ASCII. */
function run(src: string, p: number, stops: Uint8Array): number | undefined {
  const n = src.length
  if (p > n) return undefined
  let at = p
  for (; at < n; at++) {
    const c = charCodeAt.call(src, at)
    if (c < 128 && stops[c] === 1) break
  }
  return at > p ? at : undefined
}

/** Jison's case-insensitive flag folds ASCII letters only. */
function letters(src: string, p: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) {
    if (p + k >= src.length) return false
    if ((charCodeAt.call(src, p + k) | 32) !== word.charCodeAt(k)) return false
  }
  return true
}

/** `text.replace(/\n\s*\/g, '<br/>')`. */
function breaks(text: string): string {
  if (!text.includes('\n')) return text
  let out = ''
  let at = 0
  while (at < text.length) {
    const c = text.charCodeAt(at)
    at += 1
    if (c !== 0x0a) {
      out += String.fromCharCode(c)
      continue
    }
    out += '<br/>'
    while (at < text.length && isSpace(text.charCodeAt(at))) at += 1
  }
  return out
}

/** Appends a token. */
function put(out: Tokens, kind: T, start: number, text: string): void {
  out.types.push(kind)
  out.texts.push(text)
  out.starts.push(start)
}

/**
 * Splits an outline into tokens. The list ends with `EOF` and `END`, or with `ERROR` where no
 * rule matches.
 */
export function tokenize(src: string, kanban: boolean): Tokens {
  const n = src.length
  const out = tokensDefault()
  const keyword = kanban ? 'kanban' : 'mindmap'
  const idStops = kanban ? KANBAN_ID_STOPS : ID_STOPS
  let state: S = S.Initial
  let p = 0
  let nextBreak: number | undefined

  // `charCodeAt` reads `NaN` past the end, which no comparison matches.
  while (p < n) {
    const c = charCodeAt.call(src, p)
    const d = charCodeAt.call(src, p + 1)
    const start = p
    // Each rule sets where the token ends (-1 where none matches) and the next state. A rule
    // that emits its text uses `kind`; `-1` emits nothing.
    let end = -1
    let kind = -1
    let next: S = state

    switch (state) {
      case S.Initial: {
        const w = spaces(src, p) ?? p
        if (kanban && c === 0x40 && d === 0x7b) {
          put(out, T.ShapeData, p, '')
          end = p + 2
          next = S.Data
        } else if (charCodeAt.call(src, w) === 0x25 && charCodeAt.call(src, w + 1) === 0x25) {
          kind = T.Spaceline
          end = line(src, w) ?? w
        } else if (w > p) {
          if (nextBreak === undefined || nextBreak < p) {
            const at = src.indexOf('\n', p)
            nextBreak = at === -1 ? n : at
          }
          // The last `\n` before `w`, where it is after `p`: the run from `p` holds it.
          let lastBreak = w - 1
          while (lastBreak > p && charCodeAt.call(src, lastBreak) !== 0x0a) lastBreak -= 1
          if (nextBreak >= w) {
            kind = T.Spacelist
            end = w
          } else if (lastBreak > p) {
            kind = T.Spaceline
            end = lastBreak + 1
          } else {
            kind = T.Nl
            end = p + 1
          }
        } else if (letters(src, p, keyword) && !isWord(charCodeAt.call(src, p + keyword.length))) {
          kind = T.Keyword
          end = p + keyword.length
        } else if (c === 0x3a && d === 0x3a && charCodeAt.call(src, p + 2) === 0x3a) {
          end = p + 3
          next = S.Class
        } else if (c === 0x3a && d === 0x3a && letters(src, p + 2, 'icon') && charCodeAt.call(src, p + 6) === 0x28) {
          end = p + 7
          next = S.Icon
        } else if (
          (c === 0x2d && d === 0x29) ||
          (c === 0x28 && (d === 0x2d || d === 0x28)) ||
          ((c === 0x29 || c === 0x7b) && d === c)
        ) {
          kind = T.NodeDstart
          end = p + 2
          next = S.Node
        } else if (c === 0x29 || c === 0x28 || c === 0x5b) {
          kind = T.NodeDstart
          end = p + 1
          next = S.Node
        } else {
          kind = T.NodeId
          end = run(src, p, idStops) ?? -1
        }
        break
      }
      case S.Node: {
        if (c === 0x22) {
          if (d === 0x60) {
            end = p + 2
            next = S.Nstr2
          } else {
            end = p + 1
            next = S.Nstr
          }
        } else if (c === 0x29 || c === 0x28) {
          kind = T.NodeDend
          end = d === c || (c === 0x28 && d === 0x2d) ? p + 2 : p + 1
          next = S.Initial
        } else if (c === 0x5d) {
          kind = T.NodeDend
          end = p + 1
          next = S.Initial
        } else if ((c === 0x7d && d === 0x7d) || (c === 0x2d && d === 0x29)) {
          kind = T.NodeDend
          end = p + 2
          next = S.Initial
        } else if (c === 0x7d) {
          // A lone closing brace takes the rest of its line as text.
          kind = T.NodeDescr
          end = line(src, p) ?? -1
        } else {
          kind = T.NodeDescr
          end = run(src, p, DESCR_STOPS) ?? -1
        }
        break
      }
      case S.Nstr: {
        if (c === 0x22) {
          end = p + 1
          next = S.Node
        } else {
          const at = src.indexOf('"', p)
          kind = T.NodeDescr
          end = at === -1 ? n : at
        }
        break
      }
      case S.Nstr2: {
        if (c === 0x60 && d === 0x22) {
          end = p + 2
          next = S.Node
        } else {
          kind = T.NodeDescr
          end = run(src, p, NSTR2_STOPS) ?? -1
        }
        break
      }
      case S.Class: {
        const e = line(src, p)
        if (e !== undefined) {
          kind = T.Class
          end = e
          next = S.Initial
        } else if (c === 0x0a) {
          end = p + 1
          next = S.Initial
        }
        break
      }
      case S.Icon: {
        if (c === 0x29) {
          end = p + 1
          next = S.Initial
        } else {
          const at = src.indexOf(')', p)
          kind = T.Icon
          end = at === -1 ? n : at
        }
        break
      }
      case S.Data: {
        if (c === 0x22) {
          kind = T.ShapeData
          end = p + 1
          next = S.DataStr
        } else if (c === 0x7d) {
          end = p + 1
          next = S.Initial
        } else {
          kind = T.ShapeData
          end = run(src, p, DATA_STOPS) ?? -1
        }
        break
      }
      case S.DataStr: {
        if (c === 0x22) {
          kind = T.ShapeData
          end = p + 1
          next = S.Data
        } else {
          const at = src.indexOf('"', p)
          end = at === -1 ? n : at
          put(out, T.ShapeData, p, breaks(src.slice(p, end)))
        }
        break
      }
    }

    if (end < 0) break
    if (kind >= 0) put(out, kind as T, start, src.slice(start, end))
    p = end
    state = next
  }

  if (p < n) {
    put(out, T.Error, p, '')
  } else {
    if (state === S.Initial) put(out, T.Eof, n, '')
    put(out, T.End, n, '')
  }
  return out
}

const STOP = "'SPACELINE', 'NL', 'EOF'"

/** Token types that can start a statement after the first. */
function startsStatement(kind: T): boolean {
  return (
    kind === T.Spaceline ||
    kind === T.Spacelist ||
    kind === T.Icon ||
    kind === T.Class ||
    kind === T.NodeDstart ||
    kind === T.NodeId
  )
}

function isStop(kind: T): boolean {
  return kind === T.Spaceline || kind === T.Nl || kind === T.Eof
}

/**
 * Parses an outline, making the calls on `db` that the grammar's actions make, in the same
 * order.
 *
 * @throws {CompileError} The syntax error the generated parser reports, in the state where it
 * would.
 */
export function parseOutline(src: string, db: OutlineDb, kanban: boolean): void {
  const diagram = kanban ? 'kanban' : 'mindmap'
  const tokens = tokenize(src, kanban)
  const kind = (i: number): T => tokens.types[i] ?? T.End
  const text = (i: number): string => tokens.texts[i] ?? ''
  const data = kanban ? ", 'SHAPE_DATA'" : ''
  let i = 0

  const fail = (i: number, expected: string): CompileError => {
    const start = tokens.starts[i] ?? src.length
    const t = kind(i)
    if (t === T.Error) return errorSyntax(diagram, src, start, '', true)
    const detail = `Expecting ${expected}, got '${tokenName(t, kanban)}'`
    return errorSyntax(diagram, src, start, detail, false)
  }
  const expected = (parts: string[]): string => parts.join('')

  const keyword = expected(["'", tokenName(T.Keyword, kanban), "'"])
  if (kind(i) === T.Spaceline) {
    i += 1
    while (kind(i) === T.Spaceline || kind(i) === T.Nl) i += 1
    if (kind(i) !== T.Keyword) throw fail(i, expected(["'SPACELINE', 'NL', ", keyword]))
  } else if (kind(i) !== T.Keyword) {
    throw fail(i, expected(["'SPACELINE', ", keyword]))
  }
  i += 1
  let first = "'SPACELINE', 'NL', 'SPACELIST', 'ICON', 'CLASS', 'NODE_DSTART', 'NODE_ID'"
  if (kind(i) === T.Nl) {
    i += 1
    first = "'SPACELINE', 'SPACELIST', 'ICON', 'CLASS', 'NODE_DSTART', 'NODE_ID'"
  }

  for (;;) {
    let t = kind(i)
    let level = 0
    const indented = t === T.Spacelist
    if (indented) {
      level = text(i).length
      i += 1
      t = kind(i)
    }

    if (t === T.NodeId || t === T.NodeDstart) {
      let id: string | undefined
      let nodeKind = 0
      if (t === T.NodeId) {
        id = text(i)
        i += 1
      }
      let descr: string
      if (kind(i) === T.NodeDstart) {
        const start = text(i)
        i += 1
        if (kind(i) !== T.NodeDescr) throw fail(i, "'NODE_DESCR'")
        descr = text(i)
        i += 1
        if (kind(i) !== T.NodeDend) throw fail(i, "'NODE_DEND'")
        const end = text(i)
        i += 1
        if (!isStop(kind(i)) && kind(i) !== T.ShapeData) throw fail(i, expected([STOP, data]))
        nodeKind = db.getType === undefined ? getType(start, end) : db.getType(start, end)
      } else {
        if (!isStop(kind(i)) && kind(i) !== T.ShapeData) {
          throw fail(i, expected([STOP, ", 'NODE_DSTART'", data]))
        }
        descr = id ?? ''
      }

      if (kind(i) === T.ShapeData) {
        let shapeData = text(i)
        i += 1
        while (kind(i) === T.ShapeData) {
          shapeData += text(i)
          i += 1
        }
        if (!isStop(kind(i))) throw fail(i, expected([STOP, data]))
        db.addNode(level, id ?? descr, descr, nodeKind, shapeData)
      } else {
        db.addNode(level, id ?? descr, descr, nodeKind, undefined)
      }
    } else if (t === T.Icon || t === T.Class) {
      const value = text(i)
      i += 1
      if (!isStop(kind(i))) throw fail(i, STOP)
      db.decorateNode(t === T.Icon ? { class: undefined, icon: value } : { class: value, icon: undefined })
    } else if (indented) {
      if (!isStop(t)) throw fail(i, expected([STOP, ", 'ICON', 'CLASS', 'NODE_DSTART', 'NODE_ID'"]))
    } else if (t === T.Spaceline) {
      i += 1
      if (!isStop(kind(i))) throw fail(i, STOP)
    } else {
      throw fail(i, first)
    }

    i += 1
    while (kind(i) === T.Nl || kind(i) === T.Eof) i += 1
    if (kind(i) === T.End) return
    if (!startsStatement(kind(i))) {
      throw fail(i, expected([STOP, ", 'SPACELIST', 'ICON', 'CLASS', 'NODE_DSTART', 'NODE_ID'"]))
    }
  }
}
