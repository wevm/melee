/**
 * @module Builds a git graph's commits and branches from its syntax tree, as Mermaid's git graph
 * database does. Port of Pele's `src/diagrams/git/db.ts`.
 */
import { CommitTypeName, type GitGraphAst } from './parser.ts'
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import type { Value } from '../../yaml.ts'

/** A plain commit. */
export const NORMAL = 0
/** A commit that reverses another. */
export const REVERSE = 1
/** A highlighted commit. */
export const HIGHLIGHT = 2
/** A merge commit. */
export const MERGE = 3
/** A cherry-picked commit. */
export const CHERRY_PICK = 4

/** A commit. */
export type GitCommit = {
  /** The branch it was made on. */
  branch: string
  /** For a merge, whether its id was written. */
  customId: boolean | undefined
  /** For a merge, the type written for it. */
  customType: number | undefined
  /** The id. */
  id: string
  /** The message. */
  message: string
  /** Parent ids: the previous head first. */
  parents: string[]
  /** Creation order. */
  seq: number
  /** Tags, in written order. */
  tags: string[]
  /** One of {@link NORMAL}, {@link REVERSE}, {@link HIGHLIGHT}, {@link MERGE}, and {@link CHERRY_PICK}. */
  type: number
}

/** A built git graph: Pele's `GitModel`. */
export type GitModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /**
   * Each branch and the id of its latest commit, or `undefined` while it has none, in creation
   * order.
   */
  branches: [string, string | undefined][]
  /**
   * Commits keyed by id, in the order the ids first appeared. A later commit with the same id
   * replaces the earlier one in its place, as `Map.set` does.
   */
  commits: GitCommit[]
  /** The checked-out branch. */
  currentBranch: string
  /** `LR`, `TB`, or `BT`. */
  direction: string
  /** The id of the head commit. */
  head: string | undefined
  /** Branch names in drawing order: by `order`, then by creation. */
  lanes: string[]
  /** The title. */
  title: string | undefined
  /** Warnings Mermaid logs. */
  warnings: string[]
}

/** `GitModel::default()`. */
export function gitModelDefault(): GitModel {
  return {
    accDescr: undefined,
    accTitle: undefined,
    branches: [],
    commits: [],
    currentBranch: '',
    direction: '',
    head: undefined,
    lanes: [],
    title: undefined,
    warnings: [],
  }
}

/** A semantic error naming the git graph. */
function fail(message: string): CompileError {
  const error = errorNew(Code.Semantic, message)
  error.type = 'gitGraph'
  return error
}

function typeCode(name: CommitTypeName): number {
  switch (name) {
    case CommitTypeName.Highlight:
      return HIGHLIGHT
    case CommitTypeName.Normal:
      return NORMAL
    case CommitTypeName.Reverse:
      return REVERSE
  }
}

/** A property of a YAML mapping. */
function property(value: Value, key: string): Value | undefined {
  if (value.kind !== 'Object') return undefined
  return value._0.find(([own]) => own === key)?.[1]
}

/** The first seven digits of `value` in lowercase hexadecimal, padded to eight digits. */
function hex7(value: number): string {
  return (value >>> 4).toString(16).padStart(7, '0')
}

/** The state of a build: Pele's closure variables. */
type Builder = {
  branches: [string, string | undefined][]
  commits: GitCommit[]
  current: string
  direction: string
  head: string | undefined
  index: Map<string, number>
  orders: [string, number][]
  seq: number
  warnings: string[]
}

function builderHas(self: Builder, id: string): boolean {
  return self.index.has(id)
}

function builderGet(self: Builder, id: string): GitCommit | undefined {
  const at = self.index.get(id)
  return at === undefined ? undefined : self.commits[at]
}

/** The branch's head: absent when no such branch exists, `[undefined]` while it has none. */
function builderBranch(self: Builder, name: string): [string | undefined] | undefined {
  const entry = self.branches.find(([own]) => own === name)
  return entry === undefined ? undefined : [entry[1]]
}

function builderSetBranch(self: Builder, name: string, head: string | undefined): void {
  const entry = self.branches.find(([own]) => own === name)
  if (entry !== undefined) entry[1] = head
  else self.branches.push([name, head])
}

/**
 * Mermaid appends seven random hex digits to the sequence number. These digits are derived
 * from the sequence number instead, so the same text always gives the same ids.
 */
function builderNextId(self: Builder): string {
  let salt = (self.seq + 1) >>> 0
  for (;;) {
    const id = `${self.seq}-${hex7(Math.imul(salt, 0x9e3779b1))}`
    if (!builderHas(self, id)) return id
    salt = (salt + 0x9e3779b1) >>> 0
  }
}

function builderAdd(self: Builder, commit: GitCommit): void {
  self.head = commit.id
  builderSetBranch(self, self.current, commit.id)
  const at = self.index.get(commit.id)
  if (at !== undefined && at < self.commits.length) {
    self.commits[at] = commit
    return
  }
  self.index.set(commit.id, self.commits.length)
  self.commits.push(commit)
}

function builderCheckout(self: Builder, branch: string): void {
  const id = builderBranch(self, branch)
  if (id === undefined) {
    throw fail(
      `Trying to checkout branch which is not yet created. (Help try using "branch ${branch}")`,
    )
  }
  const own = id[0]
  const head = own !== undefined && own !== '' ? builderGet(self, own)?.id : undefined
  self.current = branch
  self.head = head
}

function builderCommit(
  self: Builder,
  id: string | undefined,
  msg: string,
  type: number,
  tags: string[],
): void {
  const written = id !== undefined && id !== ''
  const commit: GitCommit = {
    branch: self.current,
    customId: undefined,
    customType: undefined,
    id: written ? id : builderNextId(self),
    message: msg,
    parents: self.head === undefined ? [] : [self.head],
    seq: self.seq,
    tags: tags.slice(),
    type,
  }
  self.seq += 1
  // A made-up id is new by construction.
  if (written && builderHas(self, commit.id)) self.warnings.push(`Commit ID ${commit.id} already exists`)
  builderAdd(self, commit)
}

function builderBranchStatement(self: Builder, name: string, order: number): void {
  if (builderBranch(self, name) !== undefined) {
    throw fail(
      `Trying to create an existing branch. (Help: Either use a new name if you want create a new branch or try using "checkout ${name}")`,
    )
  }
  builderSetBranch(self, name, self.head)
  self.orders.push([name, order])
  builderCheckout(self, name)
}

function builderMerge(
  self: Builder,
  other: string,
  customId: string,
  type: number | undefined,
  tags: string[],
): void {
  const current = self.current
  const currentHead = builderBranch(self, current)?.[0]
  const otherHead = builderBranch(self, other)?.[0]
  const currentCommit =
    currentHead !== undefined && currentHead !== '' ? builderGet(self, currentHead) : undefined
  const otherCommit = otherHead !== undefined && otherHead !== '' ? builderGet(self, otherHead) : undefined
  if (currentCommit !== undefined && otherCommit !== undefined && currentCommit.branch === other) {
    throw fail(`Cannot merge branch '${other}' into itself.`)
  }
  if (current === other) {
    throw fail('Incorrect usage of "merge". Cannot merge a branch to itself')
  }
  if (currentCommit === undefined) {
    throw fail(`Incorrect usage of "merge". Current branch (${current})has no commits`)
  }
  if (builderBranch(self, other) === undefined) {
    throw fail(`Incorrect usage of "merge". Branch to be merged (${other}) does not exist`)
  }
  if (otherCommit === undefined) {
    throw fail(`Incorrect usage of "merge". Branch to be merged (${other}) has no commits`)
  }
  // `currentCommit === otherCommit` compares the objects the map holds.
  if (currentCommit === otherCommit) {
    throw fail('Incorrect usage of "merge". Both branches have same head')
  }
  if (customId !== '' && builderHas(self, customId)) {
    throw fail(
      `Incorrect usage of "merge". Commit with id:${customId} already exists, use different custom id`,
    )
  }

  const parents = self.head === undefined ? [] : [self.head, otherHead ?? '']
  const message = `merged branch ${other} into ${current}`
  const commit: GitCommit = {
    branch: current,
    customId: customId !== '',
    customType: type,
    id: customId === '' ? builderNextId(self) : customId,
    message,
    parents,
    seq: self.seq,
    tags: tags.slice(),
    type: MERGE,
  }
  self.seq += 1
  builderAdd(self, commit)
}

function builderCherryPick(
  self: Builder,
  sourceId: string | undefined,
  tags: string[] | undefined,
  parentId: string | undefined,
): void {
  const source = sourceId !== undefined && sourceId !== '' ? builderGet(self, sourceId) : undefined
  if (source === undefined) {
    throw fail('Incorrect usage of "cherryPick". Source commit id should exist and provided')
  }
  const parent = parentId !== undefined && parentId !== '' ? parentId : undefined
  if (parent !== undefined && !source.parents.includes(parent)) {
    throw fail(
      'Invalid operation: The specified parent commit is not an immediate parent of the cherry-picked commit.',
    )
  }
  if (source.type === MERGE && parent === undefined) {
    throw fail(
      'Incorrect usage of cherry-pick: If the source commit is a merge commit, an immediate parent commit must be specified.',
    )
  }
  if (source.branch === self.current) {
    throw fail('Incorrect usage of "cherryPick". Source commit is already on current branch')
  }
  const currentHead = builderBranch(self, self.current)?.[0]
  if (!(currentHead !== undefined && currentHead !== '' && builderHas(self, currentHead))) {
    throw fail(`Incorrect usage of "cherry-pick". Current branch (${self.current})has no commits`)
  }

  const id = source.id
  let picked: string[]
  if (tags !== undefined) {
    picked = tags.filter((tag) => tag !== '')
  } else {
    let tag = `cherry-pick:${id}`
    if (source.type === MERGE) {
      tag += '|parent:'
      // A merge always has its parent here, so `undefined` never shows.
      tag += parent ?? 'undefined'
    }
    picked = [tag]
  }
  const message = `cherry-picked ${source.message} into ${self.current}`
  const parents = self.head === undefined ? [] : [self.head, id]
  const commit: GitCommit = {
    branch: self.current,
    customId: undefined,
    customType: undefined,
    id: builderNextId(self),
    message,
    parents,
    seq: self.seq,
    tags: picked,
    type: CHERRY_PICK,
  }
  self.seq += 1
  builderAdd(self, commit)
}

/** `text.replace(/\n\s+/g, '\n')`. */
function squeezeLineStarts(text: string): string {
  let out = ''
  const n = text.length
  let start = 0
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    i++
    if (c === 0x0a) {
      let j = i
      while (j < n && isSpace(text.charCodeAt(j))) j++
      if (j > i) {
        out += text.slice(start, i)
        start = j
      }
      i = j
    }
  }
  out += text.slice(start)
  return out
}

/** A branch order as it sorts: NaN reads as zero. */
function orderKey(order: number): number {
  return Number.isNaN(order) ? 0.0 : order
}

/**
 * Builds the model of `ast` with the `gitGraph` section of `config`. `title` comes from front
 * matter.
 *
 * @throws {CompileError} A semantic error for a statement Mermaid rejects, such as checking out a
 * branch that does not exist.
 */
export function buildGit(ast: GitGraphAst, config: Value, title: string | undefined): GitModel {
  const git = property(config, 'gitGraph')
  const nameValue = git === undefined ? undefined : property(git, 'mainBranchName')
  const mainName = nameValue?.kind === 'String' ? nameValue._0 : 'main'
  const orderValue = git === undefined ? undefined : property(git, 'mainBranchOrder')
  const mainOrder = orderValue?.kind === 'Number' ? orderValue._0 : 0.0

  const b: Builder = {
    branches: [[mainName, undefined]],
    commits: [],
    current: mainName,
    direction: 'LR',
    head: undefined,
    index: new Map(),
    orders: [[mainName, mainOrder]],
    seq: 0,
    warnings: [],
  }

  if (ast.dir !== undefined) b.direction = ast.dir
  for (const statement of ast.statements) {
    switch (statement.kind) {
      case 'Commit':
        builderCommit(
          b,
          statement.id,
          statement.message ?? '',
          statement.type === undefined ? NORMAL : typeCode(statement.type),
          statement.tags,
        )
        break
      case 'Branch':
        builderBranchStatement(b, statement.name, statement.order ?? 0.0)
        break
      case 'Merge':
        builderMerge(
          b,
          statement.branch,
          statement.id ?? '',
          statement.type === undefined ? undefined : typeCode(statement.type),
          statement.tags,
        )
        break
      case 'Checkout':
        builderCheckout(b, statement.branch)
        break
      case 'CherryPicking':
        builderCherryPick(
          b,
          statement.id,
          statement.tags.length > 0 ? statement.tags : undefined,
          statement.parent,
        )
        break
    }
  }

  // A branch made without an order sorts by creation among those of order zero, as in Mermaid.
  // `a.order - b.order` is NaN for a NaN order, which JavaScript reads as equal; this reads NaN
  // as zero so the order stays total.
  // The comparator is a total preorder, so a list already in order is what the stable sort
  // returns, and the sort is skipped.
  const orders = b.orders
  let ordered = true
  for (let i = 1; i < orders.length; i++) {
    if (orderKey(orders[i - 1]![1]) > orderKey(orders[i]![1])) {
      ordered = false
      break
    }
  }
  if (!ordered) {
    orders.sort((a, b) => {
      const x = orderKey(a[1])
      const y = orderKey(b[1])
      return x < y ? -1 : x > y ? 1 : 0
    })
  }
  const lanes: string[] = []
  for (let i = 0; i < orders.length; i++) lanes.push(orders[i]![0])

  return {
    accDescr: ast.accDescr !== undefined && ast.accDescr !== '' ? squeezeLineStarts(ast.accDescr) : undefined,
    accTitle: ast.accTitle !== undefined && ast.accTitle !== '' ? trimStart(ast.accTitle) : undefined,
    branches: b.branches,
    commits: b.commits,
    currentBranch: b.current,
    direction: b.direction,
    head: b.head,
    lanes,
    title: ast.title !== undefined && ast.title !== '' ? ast.title : title,
    warnings: b.warnings,
  }
}
