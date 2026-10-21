/**
 * @module Normalizes Mermaid source before detection: line endings, attribute quotes, front
 * matter, directives, and comments. Port of Pele's `src/preprocess.ts`.
 */
import { Code, errorNew } from './error.ts'
import { has, isLineEnd, isSpace, isWord } from './util/chars.ts'
import { parse as floatParse } from './util/float.ts'
import { type Buf, buf } from './util/rust.ts'
import * as yaml from './yaml.ts'
import type { Value } from './yaml.ts'

/** Configuration from front matter and init directives, as JavaScript object properties in order. */
export type Config = [string, Value][]

/** Source with front matter, directives, and comments removed. */
export type Preprocessed = {
  /** Configuration from front matter and init directives. */
  config: Config
  /** The number of front matter lines before `withComments`. */
  lineOffset: number
  /** The diagram text without comment lines, trimmed at the start. */
  text: string
  /** The front matter title. */
  title: string | undefined
  /** The diagram text before its comment lines are removed. */
  withComments: string
}

const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype']

function space(c: number): boolean {
  return isSpace(c)
}

function lineEnd(c: number): boolean {
  return isLineEnd(c)
}

function word(c: number): boolean {
  return isWord(c)
}

// `trim_start_matches(space)` as an offset: the first position at or after `at` that is not
// whitespace. JavaScript whitespace is all in the BMP, so stepping by UTF-16 units is exact.
function skipSpaces(text: string, at: number): number {
  while (at < text.length && space(text.charCodeAt(at))) at++
  return at
}

// `trim_matches(space)`.
function trimSpaces(text: string): string {
  let end = text.length
  const start = skipSpaces(text, 0)
  while (end > start && space(text.charCodeAt(end - 1))) end--
  return text.slice(start, end)
}

/** Removes comment lines (`%%` not followed by `{`) and leading whitespace. */
export function cleanupComments(text: string): string {
  const stripped = has(text, '%%') ? removeComments(text) : text
  return stripped.slice(skipSpaces(stripped, 0))
}

// `text.replace(/^\s*%%(?!{)[^\n]+\n?/gm, '')`.
function removeComments(text: string): string {
  let out = ''
  let last = 0
  let p = 0
  for (;;) {
    const lineStart = p === 0 || (p <= text.length && lineEnd(text.charCodeAt(p - 1)))
    if (lineStart) {
      const end = commentAt(text, p)
      if (end !== undefined) {
        out += text.slice(last, p)
        last = end
        p = end
        continue
      }
      // Every line start inside this whitespace run reaches the same `%%` test and fails.
      p = skipSpaces(text, p)
    }

    let q = p
    while (q < text.length && !lineEnd(text.charCodeAt(q))) q++
    if (q >= text.length) break
    // Line terminators are single UTF-16 units.
    p = q + 1
  }
  out += text.slice(last)
  return out
}

// The end of a comment matched at line start `p`. `\s*` cannot give back characters to `%%`, so
// its greedy run is the only candidate.
function commentAt(text: string, p: number): number | undefined {
  if (p > text.length) return undefined
  const q = skipSpaces(text, p)
  if (!text.startsWith('%%', q)) return undefined
  const start = q + 2
  if (start >= text.length || text.charCodeAt(start) === 0x7b || text.charCodeAt(start) === 0x0a) return undefined

  const at = text.indexOf('\n', start)
  return at < 0 ? text.length : at + 1
}

// The UTF-16 length of the character at `at` when it is whitespace.
function spaceAt(text: string, at: number): number | undefined {
  if (at >= text.length) return undefined
  // Whitespace is all in the BMP, and a surrogate unit is not whitespace.
  return space(text.charCodeAt(at)) ? 1 : undefined
}

function isBreak(text: string, at: number): boolean {
  const c = text.charCodeAt(at)
  return c === 0x0a || c === 0x0d
}

// The start of the last `needle` that starts at or before `from`.
function lastIndexOf(text: string, needle: string, from: number): number | undefined {
  const at = text.lastIndexOf(needle, from)
  return at < 0 ? undefined : at
}

// The start of the first `needle` that starts at or after `from`.
function indexOf(text: string, needle: string, from: number): number | undefined {
  if (from > text.length) return undefined
  const at = text.indexOf(needle, from)
  return at < 0 ? undefined : at
}

type FrontMatter = {
  body: string
  indent: string
  length: number
}

// Finds a `---` fenced YAML block at the start of the text the way Mermaid's front matter regex does.
function matchFrontMatter(text: string): FrontMatter | undefined {
  let cursor = 0
  for (;;) {
    const length = spaceAt(text, cursor)
    if (length === undefined || isBreak(text, cursor)) break
    cursor += length
  }
  const indent = text.slice(0, cursor)
  if (!text.startsWith('---', cursor)) return undefined

  const openingEnds: number[] = []
  let i = cursor + 3
  for (;;) {
    const length = spaceAt(text, i)
    if (length === undefined) break
    if (isBreak(text, i)) openingEnds.push(i)
    i += length
  }
  const first = openingEnds[0]
  if (first === undefined) return undefined

  const fence = `${indent}---`
  const closingEnd = (i: number): number | undefined => {
    if (!isBreak(text, i) || !text.startsWith(fence, i + 1)) return undefined
    let last: number | undefined
    let j = i + 1 + fence.length
    for (;;) {
      const length = spaceAt(text, j)
      if (length === undefined) break
      if (isBreak(text, j)) last = j
      j += length
    }
    return last
  }

  const needle = `\n${fence}`
  let lastFence: number | undefined
  let at = lastIndexOf(text, needle, text.length)
  while (at !== undefined && at > first) {
    if (closingEnd(at) !== undefined) {
      lastFence = at
      break
    }
    at = lastIndexOf(text, needle, at - 1)
  }
  if (lastFence === undefined) return undefined
  const fenceAt = lastFence

  let openingEnd = first
  for (let k = openingEnds.length - 1; k >= 0; k--) {
    const candidate = openingEnds[k] as number
    if (candidate < fenceAt) {
      openingEnd = candidate
      break
    }
  }

  const bodyStart = openingEnd + 1
  at = indexOf(text, needle, bodyStart - 1)
  while (at !== undefined && at <= fenceAt) {
    if (at >= bodyStart) {
      const end = closingEnd(at)
      if (end !== undefined) {
        return {
          body: text.slice(bodyStart, at),
          indent,
          length: end + 1,
        }
      }
    }
    at = indexOf(text, needle, at + 1)
  }
  return undefined
}

function get(object: [string, Value][], key: string): Value | undefined {
  return object.find((entry) => entry[0] === key)?.[1]
}

function merge(target: Config, source: [string, Value][]): void {
  for (const [key, value] of source) {
    if (UNSAFE_KEYS.includes(key)) continue
    const current = target.find((entry) => entry[0] === key)
    if (value.kind === 'Object' && current !== undefined && current[1].kind === 'Object') {
      merge(current[1]._0, value._0)
    } else if (value.kind === 'Object') {
      const copy: Config = []
      merge(copy, value._0)
      yaml.set(target, key, { kind: 'Object', _0: copy })
    } else {
      yaml.set(target, key, yaml.valueClone(value))
    }
  }
}

/**
 * One match of Mermaid's directive pattern,
 * `/%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi`.
 */
type Directive = {
  /** The fourth group: the text after `type:` up to `}%%`, when it is not a single word. */
  args: string | undefined
  end: number
  /** The first or second group. */
  kind: string
  start: number
}

function findDirective(s: string, from: number): Directive | undefined {
  let at = from
  for (;;) {
    const start = indexOf(s, '%%{', at)
    if (start === undefined) return undefined
    const directive = directiveAt(s, start)
    if (directive !== undefined) return directive
    at = start + 1
  }
}

// Every part after the type is optional, so the first greedy choice at each step is the match.
function directiveAt(s: string, start: number): Directive | undefined {
  const skipSpace = (at: number): number => skipSpaces(s, at)
  const skipWord = (at: number): number => {
    while (at < s.length && word(s.charCodeAt(at))) at++
    return at
  }

  const wordStart = skipSpace(start + 3)
  const wordEnd = skipWord(wordStart)
  if (wordEnd === wordStart) return undefined
  const kind = s.slice(wordStart, wordEnd)

  let pos = skipSpace(wordEnd)
  if (s.charCodeAt(pos) === 0x3a) pos += 1
  else pos = wordEnd
  pos = skipSpace(pos)

  let args: string | undefined
  const valueEnd = skipWord(pos)
  if (valueEnd > pos) {
    pos = valueEnd
  } else {
    const argsStart = pos
    while (pos <= s.length) {
      if (s.startsWith('}%%', pos)) break
      if (s.startsWith('\r\n', pos)) {
        pos += 2
        continue
      }
      if (pos >= s.length) break
      const c = s.charCodeAt(pos)
      // A surrogate unit is not a line terminator, so stepping by units matches stepping by characters.
      if (c === 0x0a) pos += 1
      else if (!lineEnd(c)) pos += 1
      else break
    }
    args = s.slice(argsStart, pos)
  }

  pos = skipSpace(pos)
  if (s.startsWith('}%%', pos)) pos += 3
  return {
    args,
    end: pos,
    kind,
    start,
  }
}

function directives(text: string, config: Config): string {
  if (!has(text, '%%{')) return text

  const normalized = trimSpaces(text).replaceAll("'", '"')
  let from = 0
  for (;;) {
    const directive = findDirective(normalized, from)
    if (directive === undefined) break
    from = directive.end
    switch (directive.kind) {
      case 'wrap':
        yaml.set(config, 'wrap', { kind: 'Bool', _0: true })
        break
      case 'init':
      case 'initialize': {
        // Mermaid ignores an init directive whose body is not valid JSON.
        const args = directive.args
        if (args !== undefined && args !== '') {
          const parsed = json(trimSpaces(args))
          if (parsed !== undefined && parsed.kind === 'Object') merge(config, parsed._0)
        }
        break
      }
    }
  }

  let out = ''
  let last = 0
  for (;;) {
    const directive = findDirective(text, last)
    if (directive === undefined) break
    out += text.slice(last, directive.start)
    last = directive.end
  }
  out += text.slice(last)
  return out
}

/**
 * Deepest nesting `JSON.parse` reads here. V8 has no fixed limit, but a deeper directive is
 * ignored instead of overflowing the stack.
 */
const MAX_JSON_DEPTH = 1000

/** `JSON.parse`, or `undefined` where it throws. */
export function json(text: string): Value | undefined {
  const parser: Json = { pos: 0, text }
  const value = jsonValue(parser, 0)
  if (value === undefined) return undefined
  jsonSkip(parser)
  return parser.pos === text.length ? value : undefined
}

type Json = {
  pos: number
  text: string
}

function jsonPeek(parser: Json): number | undefined {
  return parser.pos < parser.text.length ? parser.text.charCodeAt(parser.pos) : undefined
}

function jsonSkip(parser: Json): void {
  for (;;) {
    const c = jsonPeek(parser)
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break
    parser.pos += 1
  }
}

function jsonEat(parser: Json, literal: string): boolean {
  const found = parser.text.startsWith(literal, parser.pos)
  if (found) parser.pos += literal.length
  return found
}

function jsonValue(parser: Json, depth: number): Value | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined

  jsonSkip(parser)
  const c = jsonPeek(parser)
  if (c === undefined) return undefined
  switch (c) {
    case 0x7b: {
      parser.pos += 1
      const out: [string, Value][] = []
      jsonSkip(parser)
      if (jsonEat(parser, '}')) return { kind: 'Object', _0: out }
      for (;;) {
        jsonSkip(parser)
        const key = jsonString(parser)
        if (key === undefined) return undefined
        jsonSkip(parser)
        if (!jsonEat(parser, ':')) return undefined
        const value = jsonValue(parser, depth + 1)
        if (value === undefined) return undefined
        yaml.set(out, key, value)
        jsonSkip(parser)
        if (jsonEat(parser, '}')) return { kind: 'Object', _0: out }
        if (!jsonEat(parser, ',')) return undefined
      }
    }
    case 0x5b: {
      parser.pos += 1
      const out: Value[] = []
      jsonSkip(parser)
      if (jsonEat(parser, ']')) return { kind: 'Array', _0: out }
      for (;;) {
        const value = jsonValue(parser, depth + 1)
        if (value === undefined) return undefined
        out.push(value)
        jsonSkip(parser)
        if (jsonEat(parser, ']')) return { kind: 'Array', _0: out }
        if (!jsonEat(parser, ',')) return undefined
      }
    }
    case 0x22: {
      const string = jsonString(parser)
      return string === undefined ? undefined : { kind: 'String', _0: string }
    }
    case 0x74:
      return jsonEat(parser, 'true') ? { kind: 'Bool', _0: true } : undefined
    case 0x66:
      return jsonEat(parser, 'false') ? { kind: 'Bool', _0: false } : undefined
    case 0x6e:
      return jsonEat(parser, 'null') ? { kind: 'Null' } : undefined
    default:
      return jsonNumber(parser)
  }
}

function jsonString(parser: Json): string | undefined {
  if (!jsonEat(parser, '"')) return undefined

  // Escapes may pair surrogates, so the text is built from UTF-16 units.
  let out = ''
  for (;;) {
    if (parser.pos >= parser.text.length) return undefined
    const c = parser.text.charCodeAt(parser.pos)
    parser.pos += 1
    if (c === 0x22) {
      // `String::from_utf16_lossy`: an unpaired surrogate becomes U+FFFD.
      return out.toWellFormed()
    }
    if (c === 0x5c) {
      const e = jsonPeek(parser)
      if (e === undefined) return undefined
      parser.pos += 1
      let unit: number
      switch (e) {
        case 0x22:
          unit = 0x22
          break
        case 0x5c:
          unit = 0x5c
          break
        case 0x2f:
          unit = 0x2f
          break
        case 0x62:
          unit = 8
          break
        case 0x66:
          unit = 12
          break
        case 0x6e:
          unit = 10
          break
        case 0x72:
          unit = 13
          break
        case 0x74:
          unit = 9
          break
        case 0x75: {
          if (parser.pos + 4 > parser.text.length) return undefined
          const hex = parser.text.slice(parser.pos, parser.pos + 4)
          parser.pos += 4
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return undefined
          unit = Number.parseInt(hex, 16)
          break
        }
        default:
          return undefined
      }
      out += String.fromCharCode(unit)
      continue
    }
    if (c < 0x20) return undefined
    out += String.fromCharCode(c)
  }
}

function jsonNumber(parser: Json): Value | undefined {
  const start = parser.pos
  const digits = (parser: Json): number => {
    const from = parser.pos
    for (;;) {
      const c = jsonPeek(parser)
      if (c === undefined || c < 0x30 || c > 0x39) break
      parser.pos += 1
    }
    return parser.pos - from
  }

  jsonEat(parser, '-')
  if (!jsonEat(parser, '0') && digits(parser) === 0) return undefined
  if (jsonEat(parser, '.') && digits(parser) === 0) return undefined
  const e = jsonPeek(parser)
  if (e === 0x65 || e === 0x45) {
    parser.pos += 1
    if (!jsonEat(parser, '+')) jsonEat(parser, '-')
    if (digits(parser) === 0) return undefined
  }
  const number = floatParse(parser.text.slice(start, parser.pos))
  if (number === undefined) return undefined
  return { kind: 'Number', _0: number }
}

// `/<(\w+)([^>]*)>/g` with `="..."` attribute quotes turned to single quotes.
function quoteAttributes(text: string): string {
  const out = buf()
  let last = 0
  let at = 0
  for (;;) {
    const open = text.indexOf('<', at)
    if (open < 0) break
    let nameEnd = open + 1
    while (nameEnd < text.length && word(text.charCodeAt(nameEnd))) nameEnd++
    const close = text.indexOf('>', nameEnd)
    if (!(nameEnd > open + 1) || close < 0) {
      at = open + 1
      continue
    }
    out.s += text.slice(last, nameEnd)
    pushSingleQuoted(out, text.slice(nameEnd, close))
    out.s += '>'
    last = close + 1
    at = last
  }
  out.s += text.slice(last)
  return out.s
}

// `attrs.replace(/="([^"]*)"/g, "='$1'")`.
function pushSingleQuoted(out: Buf, attrs: string): void {
  let last = 0
  let at = 0
  for (;;) {
    const open = attrs.indexOf('="', at)
    if (open < 0) break
    const close = attrs.indexOf('"', open + 2)
    if (close < 0) {
      at = open + 1
      continue
    }
    out.s += attrs.slice(last, open)
    out.s += "='"
    out.s += attrs.slice(open + 2, close)
    out.s += "'"
    last = close + 1
    at = last
  }
  out.s += attrs.slice(last)
}

/**
 * Normalizes line endings and attribute quotes, reads front matter and directives into the title
 * and config, and removes comments.
 */
export function preprocess(source: string): Preprocessed {
  let text = source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source

  // A tag needs a closing bracket, so nothing after the last one can match.
  const lastClose = text.includes('<') ? text.lastIndexOf('>') : -1
  if (lastClose > 0) {
    text = quoteAttributes(text.slice(0, lastClose + 1)) + text.slice(lastClose + 1)
  }

  const config: Config = []
  let title: string | undefined
  let lineOffset = 0

  const front = has(text, '---') ? matchFrontMatter(text) : undefined
  if (front !== undefined) {
    let body: string
    if (front.indent === '') {
      body = front.body
    } else {
      body = ''
      const lines = front.body.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as string
        if (i > 0) body += '\n'
        body += line.startsWith(front.indent) ? line.slice(front.indent.length) : line
      }
    }

    const parsed = yaml.parse(body)
    if (!parsed.ok) throw errorNew(Code.Syntax, `Front matter is not valid YAML. ${parsed.error}`)
    if (parsed.value.kind === 'Object') {
      const object = parsed.value._0
      const titleValue = get(object, 'title')
      if (titleValue !== undefined && yaml.valueTruthy(titleValue)) {
        const out = buf()
        yaml.valuePushJsString(titleValue, out)
        title = out.s
      }
      const inner = get(object, 'config')
      if (inner !== undefined && inner.kind === 'Object') merge(config, inner._0)
      const displayMode = get(object, 'displayMode')
      if (displayMode !== undefined && yaml.valueTruthy(displayMode)) {
        const mode = buf()
        yaml.valuePushJsString(displayMode, mode)
        const entry: [string, Value] = ['displayMode', { kind: 'String', _0: mode.s }]
        const gantt = config.find((entry) => entry[0] === 'gantt')
        if (gantt !== undefined && gantt[1].kind === 'Object') yaml.set(gantt[1]._0, entry[0], entry[1])
        else yaml.set(config, 'gantt', { kind: 'Object', _0: [entry] })
      }
    }

    const head = text.slice(0, front.length)
    for (let at = head.indexOf('\n'); at >= 0; at = head.indexOf('\n', at + 1)) lineOffset++
    text = text.slice(front.length)
  }

  const withComments = directives(text, config)
  return {
    config,
    lineOffset,
    text: cleanupComments(withComments),
    title,
    withComments,
  }
}

// Does what Mermaid's `text.replace(/keyword.*:\S*#.*;/g, drop the last character)` does: on a
// line where the keyword is followed by a colon, a color-like `#`, and later a semicolon, the last
// semicolon goes. Mermaid's regex backtracks without bound; this is one pass.
function dropColorSemicolons(text: string, keyword: string): string {
  let from = text.indexOf(keyword)
  if (from < 0) return text

  let out = ''
  let last = 0
  for (;;) {
    // Line terminators are single UTF-16 units.
    let end = from
    while (end < text.length && !lineEnd(text.charCodeAt(end))) end++
    const width = end < text.length ? 1 : 0

    let afterColon = false
    let hash: number | undefined
    const scanned = text.slice(from + keyword.length, end)
    for (let j = 0; j < scanned.length; j++) {
      const c = scanned.charCodeAt(j)
      if (c === 0x3a) {
        afterColon = true
      } else if (c === 0x23) {
        if (afterColon) {
          hash = from + keyword.length + j
          break
        }
      } else if (space(c)) {
        afterColon = false
      }
    }
    if (hash !== undefined) {
      const semi = end > 0 ? text.lastIndexOf(';', end - 1) : -1
      if (semi >= 0 && semi > hash) {
        out += text.slice(last, semi)
        last = semi + 1
      }
    }

    if (end >= text.length) break
    const next = end + width
    const at = text.indexOf(keyword, next)
    if (at < 0) break
    from = at
  }

  if (last === 0) return text
  out += text.slice(last)
  return out
}

/** Whether `text` holds only ASCII digits, as `/^[0-9]*$/` tests. */
function isDigits(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) return false
  }
  return true
}

/**
 * Hides `#name;` entity codes behind Mermaid's placeholder characters so `#` and `;` survive
 * parsing.
 */
export function encodeEntities(text: string): string {
  if (!text.includes('#')) return text

  const styled = dropColorSemicolons(text, 'style')
  const dropped = dropColorSemicolons(styled, 'classDef')
  let out = ''
  let last = 0
  let at = 0
  for (;;) {
    const hash = dropped.indexOf('#', at)
    if (hash < 0) break
    let innerEnd = hash + 1
    while (innerEnd < dropped.length && word(dropped.charCodeAt(innerEnd))) innerEnd++
    const inner = dropped.slice(hash + 1, innerEnd)
    if (inner === '' || dropped.charCodeAt(innerEnd) !== 0x3b) {
      at = hash + 1
      continue
    }

    out += dropped.slice(last, hash)
    out += isDigits(inner) ? '\u{fb02}\u{b0}\u{b0}' : '\u{fb02}\u{b0}'
    out += inner
    out += '\u{b6}\u{df}'
    last = hash + inner.length + 2
    at = last
  }
  out += dropped.slice(last)
  return out
}
