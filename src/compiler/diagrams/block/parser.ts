/**
 * @module The block parser: a hand-written equivalent of Mermaid's Jison grammar that reports the
 * same errors at the same tokens. Port of Pele's `src/diagrams/block/parser.ts`.
 *
 * Pele keeps a statement that links blocks as a list, and flattens lists when it places them.
 * Lists here are flattened as they are built, which keeps the same order.
 */
import { type CompileError, errorSyntax } from '../../error.ts'
import { trim } from '../../text/label.ts'
import { parse } from '../../util/float.ts'
import {
  type BlockDb,
  blockDbAdd,
  blockDbGenerateId,
  blockDbSetHierarchy,
  edgeStrToEdgeData,
  edgeStrToEdgeStartData,
  edgeStrToPattern,
  edgeStrToThickness,
  typeStrToType,
} from './db.ts'
import { type Token, tokenize } from './lexer.ts'
import { T, tName } from './tokens.ts'
import { type Block, blockDefault } from './types.ts'

/** What a node statement names. */
type NodeInfo = {
  directions: string[] | undefined
  id: string
  label: string | undefined
  typeStr: string | undefined
}

/** A parsed statement: one block, or a list of blocks and the edges between them. */
type Statement = { kind: 'Chain'; _0: number[] } | { kind: 'One'; _0: number }

/** A composite being read: the statements of its parent, and its header, if it has one. */
type Frame = {
  header: Statement | undefined
  list: number[]
}

/** The tokens a statement may start with. */
const STATEMENT_START =
  "'NODE_ID', 'COLUMNS', 'SPACE_BLOCK', 'BLOCK_DIAGRAM_KEY', 'id-block', 'classDef', 'class', 'style'"

/** Parses JavaScript `parseInt` of a run of decimal digits, or of `-1`. */
function parseInt(text: string): number {
  return parse(text) ?? Number.NaN
}

/** A default block of `type`. */
function make(type: string): Block {
  const block = blockDefault()
  block.type = type
  return block
}

/** Parser state over the token list. */
type Parser = {
  db: BlockDb
  i: number
  src: string
  tokens: Token[]
}

function kind(self: Parser): T {
  return self.tokens[self.i]?.kind ?? T.End
}

function text(self: Parser): string {
  return self.tokens[self.i]?.text ?? ''
}

/** Takes the current token's text. */
function take(self: Parser): string {
  const value = text(self)
  self.i += 1
  return value
}

function fail(self: Parser, expected: string): CompileError {
  const token = self.tokens[self.i]
  const start = token === undefined ? self.src.length : token.start
  const current = kind(self)
  if (current === T.Error) return errorSyntax('block', self.src, start, '', true)
  const detail = `Expecting ${expected}, got '${tName(current)}'`
  return errorSyntax('block', self.src, start, detail, false)
}

function expect(self: Parser, want: T): string {
  if (kind(self) !== want) throw fail(self, `'${tName(want)}'`)
  return take(self)
}

function node(self: Parser): NodeInfo {
  const id = expect(self, T.NodeId)
  if (kind(self) === T.NodeDStart) {
    let typeStr = take(self)
    const label = expect(self, T.Str)
    typeStr += expect(self, T.NodeDEnd)
    return { directions: undefined, id, label, typeStr }
  }
  if (kind(self) === T.BlockArrowStart) {
    let typeStr = take(self)
    const label = expect(self, T.Str)
    const directions = [expect(self, T.Dir)]
    while (kind(self) === T.Dir) directions.push(take(self))
    typeStr += expect(self, T.BlockArrowEnd)
    return { directions, id, label, typeStr }
  }
  return { directions: undefined, id, label: undefined, typeStr: undefined }
}

function nodeStatement(self: Parser): Statement {
  const first = node(self)
  const size = kind(self) === T.Size ? parseInt(take(self)) : 1
  const from = make(typeStrToType(first.typeStr))
  from.directions = first.directions?.slice()
  from.id = first.id
  from.label = first.label
  from.widthInColumns = size
  let chain: number[] | undefined
  let lastId = first.id

  while (kind(self) === T.Link || kind(self) === T.StartLink) {
    let label = ''
    if (kind(self) === T.StartLink) {
      self.i += 1
      expect(self, T.LinkLabel)
      label = expect(self, T.Str)
      expect(self, T.Link)
    } else {
      self.i += 1
    }
    const link = self.tokens[self.i - 1]?.text ?? ''
    const to = node(self)
    // Mermaid keeps only the last link of `A --> B --> C` and loses its start. Here every link
    // counts.
    if (chain === undefined) {
      const head = make(from.type)
      head.directions = from.directions?.slice()
      head.id = from.id
      head.label = from.label
      chain = [blockDbAdd(self.db, head)]
    }
    const edgeBlock = make('edge')
    edgeBlock.arrowTypeEnd = edgeStrToEdgeData(link)
    edgeBlock.arrowTypeStart = edgeStrToEdgeStartData(link)
    edgeBlock.directions = to.directions?.slice()
    edgeBlock.end = to.id
    edgeBlock.id = `${lastId}-${to.id}`
    edgeBlock.label = label
    edgeBlock.pattern = edgeStrToPattern(link)
    edgeBlock.start = lastId
    edgeBlock.thickness = edgeStrToThickness(link)
    const edge = blockDbAdd(self.db, edgeBlock)
    const nextBlock = make(typeStrToType(to.typeStr))
    nextBlock.directions = to.directions
    nextBlock.id = to.id
    nextBlock.label = to.label
    const next = blockDbAdd(self.db, nextBlock)
    chain.push(edge)
    chain.push(next)
    lastId = to.id
  }
  if (chain !== undefined) return { kind: 'Chain', _0: chain }
  return { kind: 'One', _0: blockDbAdd(self.db, from) }
}

/** Appends a statement's blocks to a list. */
function push(list: number[], statement: Statement): void {
  if (statement.kind === 'Chain') for (const block of statement._0) list.push(block)
  else list.push(statement._0)
}

/**
 * Parses preprocessed block diagram `src` into `db`.
 *
 * Throws a syntax error for input Mermaid rejects, and a limit error for too many spaces.
 */
export function parseBlock(src: string, db: BlockDb): void {
  const p: Parser = { db, i: 0, src, tokens: tokenize(src) }

  expect(p, T.Key)
  // Composites nest without recursion: each open one keeps the statement list of its parent.
  const open: Frame[] = []
  let list: number[] = []
  for (;;) {
    switch (kind(p)) {
      case T.NodeId: {
        const statement = nodeStatement(p)
        push(list, statement)
        break
      }
      case T.Columns: {
        const columns = parseInt(take(p))
        const block = make('column-setting')
        block.columns = columns
        list.push(blockDbAdd(p.db, block))
        break
      }
      case T.SpaceBlock: {
        const width = parseInt(take(p))
        const id = blockDbGenerateId(p.db)
        const block = make('space')
        block.children = []
        block.id = id
        block.label = ''
        block.width = width
        list.push(blockDbAdd(p.db, block))
        break
      }
      case T.Key:
        p.i += 1
        open.push({ header: undefined, list })
        list = []
        break
      case T.IdBlock: {
        p.i += 1
        if (kind(p) !== T.NodeId) throw fail(p, "'NODE_ID'")
        const header = nodeStatement(p)
        open.push({ header, list })
        list = []
        break
      }
      case T.EndKeyword: {
        const frame = list.length > 0 ? open.pop() : undefined
        if (frame === undefined) throw fail(p, STATEMENT_START)
        p.i += 1
        const id = blockDbGenerateId(p.db)
        const children = list
        list = frame.list
        let composite: number
        const header = frame.header
        if (header === undefined) {
          const block = make('composite')
          block.children = children
          block.id = id
          block.label = ''
          composite = blockDbAdd(p.db, block)
        } else if (header.kind === 'One') {
          const block = p.db.arena[header._0]
          if (block !== undefined) {
            block.type = 'composite'
            block.children = children
          }
          composite = header._0
        } else {
          // Spreading a list into an object keeps none of the block fields.
          const block = make('composite')
          block.children = children
          composite = blockDbAdd(p.db, block)
        }
        list.push(composite)
        break
      }
      case T.ClassDef: {
        p.i += 1
        const id = trim(expect(p, T.ClassDefId))
        const css = trim(expect(p, T.ClassDefStyleOpts))
        const block = make('classDef')
        block.css = css
        block.id = id
        list.push(blockDbAdd(p.db, block))
        break
      }
      case T.Class: {
        p.i += 1
        const id = trim(expect(p, T.ClassEntityIds))
        const styleClass = trim(expect(p, T.StyleClass))
        const block = make('applyClass')
        block.id = id
        block.styleClass = styleClass
        list.push(blockDbAdd(p.db, block))
        break
      }
      case T.Style: {
        p.i += 1
        const id = trim(expect(p, T.StyleEntityIds))
        const styles = trim(expect(p, T.StyleDefinitionData))
        const block = make('applyStyles')
        block.id = id
        block.stylesStr = styles
        list.push(blockDbAdd(p.db, block))
        break
      }
      case T.Eof:
        if (open.length > 0) throw fail(p, `${STATEMENT_START}, 'end'`)
        if (list.length === 0) throw fail(p, STATEMENT_START)
        blockDbSetHierarchy(p.db, list)
        return
      default: {
        const expected =
          list.length === 0
            ? STATEMENT_START
            : open.length === 0
              ? `${STATEMENT_START}, 'EOF'`
              : `${STATEMENT_START}, 'end'`
        throw fail(p, expected)
      }
    }
  }
}
