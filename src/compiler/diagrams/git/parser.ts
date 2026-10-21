/** @module Reads git graph source into its syntax tree. Port of Pele's `src/diagrams/git/parser.ts`. */
import {
  ACC_DESCR,
  ACC_TITLE,
  DIRECTIVE,
  EOF,
  NEWLINE,
  type Reader,
  SINGLE_LINE_COMMENT,
  STRING,
  TITLE,
  type TokenType,
  WHITESPACE,
  YAML,
  accDescrHead,
  accDescrValue,
  accTitleValue,
  keyword,
  literal,
  readerAccept,
  readerExpect,
  readerFail,
  readerKind,
  readerNew,
  readerTake,
  stringValue,
  titleValue,
  tokenize,
} from '../common/tokens.ts'
import { parse as floatParse } from '../../util/float.ts'

/**
 * Token kinds, as indices into {@link GIT_TOKENS}. The order is the matching order. Pele lists the
 * keywords first; the accessibility and title types, `NEWLINE`, and `WHITESPACE` come first here
 * so blanks are not tried against every keyword. No two types whose relative order differs can
 * both match at one place (the moved ones start with blanks, line breaks, `a`, or `title`, which
 * no keyword does), so every token is the same.
 */
const t = {
  ACC_DESCR: 0,
  ACC_TITLE: 1,
  TITLE: 2,
  NEWLINE: 3,
  CHERRY_PICK: 5,
  GIT_GRAPH_COLON: 6,
  HIGHLIGHT: 7,
  GIT_GRAPH: 8,
  CHECKOUT: 9,
  REVERSE: 10,
  PARENT: 11,
  COMMIT: 12,
  NORMAL: 13,
  BRANCH: 14,
  ORDER: 15,
  SWITCH: 16,
  TYPE: 17,
  MERGE: 18,
  MSG: 19,
  TAG: 20,
  ID: 21,
  LR: 22,
  TB: 23,
  BT: 24,
  COLON: 25,
  INT: 26,
  STRING: 27,
  REFERENCE: 31,
} as const

/** Whether `b` is a regular expression `\w` character. */
function isWord(b: number): boolean {
  return (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 0x5f
}

/**
 * `\w([-\./\w]*[-\w])?`: a word character, then the longest run of `-`, `.`, `/`, and word
 * characters that ends in `-` or a word character.
 */
function reference(src: string, p: number): number | undefined {
  if (p >= src.length || !isWord(src.charCodeAt(p))) return undefined
  let end = p + 1
  let at = p + 1
  while (at < src.length) {
    const b = src.charCodeAt(at)
    if (isWord(b) || b === 0x2d) {
      at += 1
      end = at
    } else if (b === 0x2e || b === 0x2f) {
      at += 1
    } else {
      break
    }
  }
  return end
}

/**
 * `0|[1-9][0-9]*(?!\.)`. The lookahead only guards the second branch, which gives back a digit
 * when a `.` follows.
 */
function int(src: string, p: number): number | undefined {
  const b = src.charCodeAt(p)
  if (b === 0x30) return p + 1
  if (b >= 0x31 && b <= 0x39) {
    let end = p + 1
    while (end < src.length && src.charCodeAt(end) >= 0x30 && src.charCodeAt(end) <= 0x39) end += 1
    if (src.charCodeAt(end) !== 0x2e) return end
    // Any shorter run is followed by a digit.
    return end > p + 1 ? end - 1 : undefined
  }
  return undefined
}

/** `[\t ]*accDescr\s*{`: the braced form's start. */
function accDescrOpener(src: string, p: number): boolean {
  const head = accDescrHead(src, p)
  return head !== undefined && head[1]
}

/** A keyword that is the start of a longer name is part of that name: `commits` is a branch. */
function word(name: string): TokenType {
  return {
    ...literal(name),
    longer: [t.REFERENCE],
  }
}

/** The token types, in matching order. */
export const GIT_TOKENS: TokenType[] = [
  // Without a closing brace the block form scans to the end of the text, and a brace is not a
  // token on its own, so the first failure is final.
  {
    ...ACC_DESCR,
    opener: accDescrOpener,
  },
  ACC_TITLE,
  TITLE,
  NEWLINE,
  WHITESPACE,
  word('cherry-pick'),
  literal('gitGraph:'),
  word('HIGHLIGHT'),
  {
    ...keyword('gitGraph'),
    longer: [t.REFERENCE],
  },
  word('checkout'),
  word('REVERSE'),
  literal('parent:'),
  word('commit'),
  word('NORMAL'),
  word('branch'),
  literal('order:'),
  word('switch'),
  literal('type:'),
  word('merge'),
  literal('msg:'),
  literal('tag:'),
  literal('id:'),
  word('LR'),
  word('TB'),
  word('BT'),
  literal(':'),
  {
    ...literal(''),
    first: '0123456789',
    name: 'INT',
    pattern: { kind: 'Match', _0: int },
  },
  STRING,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
  {
    ...literal(''),
    first: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz',
    name: 'REFERENCE',
    pattern: { kind: 'Match', _0: reference },
  },
]

/** A commit's type as written. */
export const CommitTypeName = {
  /** `HIGHLIGHT`. */
  Highlight: 'Highlight',
  /** `NORMAL`. */
  Normal: 'Normal',
  /** `REVERSE`. */
  Reverse: 'Reverse',
} as const

/** A commit's type as written. */
export type CommitTypeName = (typeof CommitTypeName)[keyof typeof CommitTypeName]

/** A statement of the graph. */
export type StatementAst =
  /** `branch name [order: n]`. */
  | {
      kind: 'Branch'
      /** The branch name. */
      name: string
      /** The written order. */
      order: number | undefined
    }
  /** `checkout name` or `switch name`. */
  | {
      kind: 'Checkout'
      /** The branch name. */
      branch: string
    }
  /** `cherry-pick id: ... [tag: ...] [parent: ...]`. */
  | {
      kind: 'CherryPicking'
      /** The source commit id. */
      id: string | undefined
      /** The parent of a merge commit to pick. */
      parent: string | undefined
      /** Tags, in written order. */
      tags: string[]
    }
  /** `commit [id: ...] [msg: ...] [tag: ...] [type: ...]`. */
  | {
      kind: 'Commit'
      /** The written id. */
      id: string | undefined
      /** The message. */
      message: string | undefined
      /** Tags, in written order. */
      tags: string[]
      /** The written type. */
      type: CommitTypeName | undefined
    }
  /** `merge name [id: ...] [tag: ...] [type: ...]`. */
  | {
      kind: 'Merge'
      /** The branch merged in. */
      branch: string
      /** The written id. */
      id: string | undefined
      /** Tags, in written order. */
      tags: string[]
      /** The written type. */
      type: CommitTypeName | undefined
    }

/** The syntax tree of a git graph. */
export type GitGraphAst = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** The direction the header gives: `LR`, `TB`, or `BT`. */
  dir: string | undefined
  /** Statements in written order. */
  statements: StatementAst[]
  /** The title. */
  title: string | undefined
}

/** `GitGraphAst::default()`. */
export function gitGraphAstDefault(): GitGraphAst {
  return { accDescr: undefined, accTitle: undefined, dir: undefined, statements: [], title: undefined }
}

/**
 * Parses git graph source.
 *
 * @throws {CompileError} A syntax error for text Mermaid's grammar rejects.
 */
export function parseGit(src: string): GitGraphAst {
  const tokens = tokenize(src, GIT_TOKENS, 'gitGraph')
  const r = readerNew(tokens, GIT_TOKENS, 'gitGraph')
  const ast = gitGraphAstDefault()

  while (readerKind(r) === t.NEWLINE) r.i += 1
  if (!readerAccept(r, t.GIT_GRAPH_COLON)) {
    readerExpect(r, t.GIT_GRAPH)
    const next = r.tokens.tokens[r.i + 1]?.kind
    let dir: string | undefined
    switch (readerKind(r)) {
      case t.LR:
        dir = 'LR'
        break
      case t.TB:
        dir = 'TB'
        break
      case t.BT:
        dir = 'BT'
        break
      default:
        dir = undefined
    }
    if (dir !== undefined && next === t.COLON) {
      ast.dir = dir
      r.i += 2
    } else {
      readerAccept(r, t.COLON)
    }
  }

  while (readerKind(r) !== EOF) {
    switch (readerKind(r)) {
      case t.NEWLINE:
        r.i += 1
        break
      case t.ACC_DESCR:
        ast.accDescr = accDescrValue(readerTake(r))
        endOfLine(r)
        break
      case t.ACC_TITLE:
        ast.accTitle = accTitleValue(readerTake(r))
        endOfLine(r)
        break
      case t.TITLE:
        ast.title = titleValue(readerTake(r))
        endOfLine(r)
        break
      case t.COMMIT: {
        r.i += 1
        let id: string | undefined
        let message: string | undefined
        const tags: string[] = []
        let type: CommitTypeName | undefined
        for (;;) {
          if (readerAccept(r, t.ID)) id = string(r)
          else if (readerAccept(r, t.TAG)) tags.push(string(r))
          else if (readerAccept(r, t.TYPE)) type = commitType(r)
          else if (readerAccept(r, t.MSG) || readerKind(r) === t.STRING) message = string(r)
          else break
        }
        endOfLine(r)
        ast.statements.push({ kind: 'Commit', id, message, tags, type })
        break
      }
      case t.BRANCH: {
        r.i += 1
        const branch = name(r)
        const order = readerAccept(r, t.ORDER) ? parseInt(readerExpect(r, t.INT)) : undefined
        endOfLine(r)
        ast.statements.push({ kind: 'Branch', name: branch, order })
        break
      }
      case t.MERGE: {
        r.i += 1
        const branch = name(r)
        let id: string | undefined
        const tags: string[] = []
        let type: CommitTypeName | undefined
        for (;;) {
          if (readerAccept(r, t.ID)) id = string(r)
          else if (readerAccept(r, t.TAG)) tags.push(string(r))
          else if (readerAccept(r, t.TYPE)) type = commitType(r)
          else break
        }
        endOfLine(r)
        ast.statements.push({ kind: 'Merge', branch, id, tags, type })
        break
      }
      case t.CHECKOUT:
      case t.SWITCH: {
        r.i += 1
        const branch = name(r)
        endOfLine(r)
        ast.statements.push({ kind: 'Checkout', branch })
        break
      }
      case t.CHERRY_PICK: {
        r.i += 1
        let id: string | undefined
        let parent: string | undefined
        const tags: string[] = []
        for (;;) {
          if (readerAccept(r, t.ID)) id = string(r)
          else if (readerAccept(r, t.TAG)) tags.push(string(r))
          else if (readerAccept(r, t.PARENT)) parent = string(r)
          else break
        }
        endOfLine(r)
        ast.statements.push({ kind: 'CherryPicking', id, parent, tags })
        break
      }
      default:
        throw readerFail(r, 'a statement, a title, or a line break')
    }
  }
  return ast
}

/** The end of a statement: line breaks, or the end of input. */
function endOfLine(r: Reader): void {
  if (readerKind(r) === EOF) return
  if (readerKind(r) !== t.NEWLINE) throw readerFail(r, 'a line break or the end of input')
  while (readerKind(r) === t.NEWLINE) r.i += 1
}

/** A branch name: a reference or a quoted string. */
function name(r: Reader): string {
  switch (readerKind(r)) {
    case t.REFERENCE:
      return readerTake(r)
    case t.STRING:
      return stringValue(readerTake(r))
    default:
      throw readerFail(r, 'a branch name')
  }
}

/** A quoted string's value. */
function string(r: Reader): string {
  return stringValue(readerExpect(r, t.STRING))
}

/** `NORMAL`, `REVERSE`, or `HIGHLIGHT`. */
function commitType(r: Reader): CommitTypeName {
  let name: CommitTypeName
  switch (readerKind(r)) {
    case t.NORMAL:
      name = CommitTypeName.Normal
      break
    case t.REVERSE:
      name = CommitTypeName.Reverse
      break
    case t.HIGHLIGHT:
      name = CommitTypeName.Highlight
      break
    default:
      throw readerFail(r, 'NORMAL, REVERSE, or HIGHLIGHT')
  }
  r.i += 1
  return name
}

/** `parseInt` of an `INT` token, which holds only decimal digits. */
function parseInt(text: string): number {
  return floatParse(text) ?? Number.NaN
}
