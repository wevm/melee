/**
 * @module Compiles Mermaid source to monochrome SVG.
 *
 * The pipeline follows Pele (MIT): preprocessing removes front matter, directives, and comments,
 * detection picks a diagram type, and each type parses into a model, lays it out, and emits SVG.
 */
import * as diagrams from './diagrams.ts'
import { detect } from './detect.ts'
import { Code, CompileError, errorNew } from './error.ts'
import { encodeEntities, preprocess } from './preprocess.ts'
import { type RenderOptions, renderOptionsDefault } from './svg/root.ts'
import { decode } from './text/entities.ts'
import { asUint, buf, trim } from './util/rust.ts'
import type { UrlOptions } from './util/url.ts'
import { parse, pushNumber, type Value } from './yaml.ts'

export { Code, CompileError } from './error.ts'

/** A link drawn in a diagram, as Pele's `LinkInfo` reports it. */
export type Link = {
  /** The address. */
  href: string
  /** The id of the element that carries the link. */
  id: string
  /** Whether the address points inside the page. */
  internal: boolean
}

/** A rendered diagram. */
export type Rendered = {
  /** Height in pixels. */
  height: number
  /** Links in drawing order. */
  links: Link[]
  /** The SVG document. */
  svg: string
  /** The detected diagram type, using Pele's names. */
  type: string
  /** Width in pixels. */
  width: number
}

/** Mermaid's default `maxTextSize`. */
const DEFAULT_LIMIT = 50_000
/** A source within the limit can still describe megabytes of drawing, which would stall a page. */
const DEFAULT_OUTPUT_LIMIT = 4_000_000
/** `A & B --> C & D` multiplies edges, so a few kilobytes of source can ask for millions. */
const DEFAULT_MAX_EDGES = 5_000

/**
 * Renders Mermaid `source` to SVG. `options` is a JSON object with Pele's `RenderOptions` fields,
 * or empty for defaults. `now` is the time a gantt chart schedules against when `options` sets
 * none, in milliseconds since the epoch. A non-finite `now` means the epoch.
 *
 * Throws a {@link CompileError} for unsupported diagram types, syntax errors, and exceeded limits.
 */
export function render(source: string, options: string, now: number): Rendered {
  const opts = optionsFromJson(options)
  if (opts.now === undefined && Number.isFinite(now)) opts.now = now

  const limit = opts.limit ?? DEFAULT_LIMIT
  if (exceeds(source, limit)) {
    const message = buf('Diagram source is longer than the limit of ')
    pushNumber(message, limit)
    message.s += ' characters.'
    throw errorNew(Code.Limit, message.s)
  }

  const pre = preprocess(source)
  const type = detect(pre.text)
  if (type === undefined) throw errorNew(Code.UnsupportedDiagram, 'No diagram type detected for the given text.')
  const config: Value = { _0: pre.config, kind: 'Object' }

  const diagram = diagrams.find(type)
  if (diagram === undefined) {
    const error = errorNew(Code.UnsupportedDiagram, `Diagram type "${type}" is not supported yet.`)
    error.type = type
    throw error
  }

  // A diagram whose config section sets `useMaxWidth: false` keeps its natural size.
  const sectionName = diagram.section ?? type
  const section = pre.config.find(([key]) => key === sectionName)?.[1]
  const fixed =
    section?.kind === 'Object' &&
    section._0.some(([key, value]) => key === 'useMaxWidth' && value.kind === 'Bool' && value._0 === false)
  opts.responsive = opts.responsive ?? !fixed

  const input: diagrams.Input = {
    config,
    lineOffset: pre.lineOffset,
    maxEdges: asUint(opts.maxEdges ?? DEFAULT_MAX_EDGES),
    source: encodeEntities(diagram.keepComments ? pre.withComments : pre.text) + '\n',
    title: pre.title,
  }

  const url: UrlOptions = {
    imageSchemes: opts.imageSchemes,
    images: opts.images,
    linkRel: opts.linkRel,
    linkSchemes: opts.linkSchemes,
    links: opts.links,
  }

  const drawn = diagram.render(input, opts, url)
  const rendered: Rendered = {
    height: drawn.height,
    links: drawn.links.map((link) => ({ href: link.href, id: link.id, internal: link.internal })),
    svg: drawn.svg,
    type,
    width: drawn.width,
  }

  const outputLimit = opts.outputLimit ?? DEFAULT_OUTPUT_LIMIT
  if (exceeds(rendered.svg, outputLimit)) {
    const message = buf('Diagram output is longer than the limit of ')
    pushNumber(message, outputLimit)
    message.s += ' characters.'
    const error = errorNew(Code.Limit, message.s)
    error.type = type
    throw error
  }

  // Hosts see link ids as the author meant them, with entity codes turned into characters.
  for (const link of rendered.links) link.id = decode(link.id)

  return rendered
}

/** Whether `text` is longer than `limit` UTF-16 units. */
function exceeds(text: string, limit: number): boolean {
  return text.length > limit
}

/** Reads host options from JSON. Unknown fields are ignored, as in Pele. */
function optionsFromJson(json: string): RenderOptions {
  const options = renderOptionsDefault()
  if (trim(json) === '') return options

  const parsed = parse(json)
  if (!parsed.ok) throw errorNew(Code.Limit, parsed.error)
  const root = parsed.value
  if (root.kind !== 'Object') return options

  const number = (value: Value) => (value.kind === 'Number' && Number.isFinite(value._0) ? value._0 : undefined)
  const boolean = (value: Value) => (value.kind === 'Bool' ? value._0 : undefined)
  const string = (value: Value) => (value.kind === 'String' ? value._0 : undefined)
  const strings = (value: Value) =>
    value.kind === 'Array'
      ? value._0.flatMap((item) => (item.kind === 'String' ? [item._0] : []))
      : undefined

  for (const [key, value] of root._0) {
    switch (key) {
      case 'autoDirection':
        options.autoDirection = boolean(value)
        break
      case 'directionBreakpoint':
        options.directionBreakpoint = number(value)
        break
      case 'fontSize':
        options.fontSize = number(value)
        break
      case 'idPrefix':
        options.idPrefix = string(value)
        break
      case 'imageSchemes':
        options.imageSchemes = strings(value)
        break
      case 'images':
        options.images = boolean(value)
        break
      case 'limit':
        options.limit = number(value)
        break
      case 'linkRel':
        options.linkRel = string(value)
        break
      case 'linkSchemes':
        options.linkSchemes = strings(value)
        break
      case 'links':
        options.links = boolean(value)
        break
      case 'maxEdges':
        options.maxEdges = number(value)
        break
      case 'maxWidth':
        options.maxWidth = number(value)
        break
      case 'now':
        options.now = number(value)
        break
      case 'outputLimit':
        options.outputLimit = number(value)
        break
      case 'padding':
        options.padding = number(value)
        break
      case 'responsive':
        options.responsive = boolean(value)
        break
    }
  }

  return options
}
