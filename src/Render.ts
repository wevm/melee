/** @module Renders Mermaid source to monochrome SVG with the TypeScript compiler. */
import * as Compiler from './compiler/lib.ts'

/** Thrown when source cannot be rendered. Messages match Mermaid's diagnostics. */
export class RenderError extends Error {
  override name = 'Render.RenderError'

  /** The kind of failure. */
  readonly code: RenderError.Code
  /** One-based UTF-16 column, or 0 when the error has no position. */
  readonly column: number
  /** One-based line, or 0 when the error has no position. */
  readonly line: number
  /** The offending source line with a caret under the column, or empty. */
  readonly snippet: string
  /** The detected diagram type, when known. */
  readonly type: string | undefined

  constructor(options: RenderError.Options) {
    super(options.message)
    this.code = options.code
    this.column = options.column
    this.line = options.line
    this.snippet = options.snippet
    this.type = options.type
  }
}

export declare namespace RenderError {
  /** The kind of failure. */
  type Code = 'limit' | 'semantic' | 'syntax' | 'unsupported-diagram'

  /** Constructor fields. */
  type Options = {
    readonly code: Code
    readonly column: number
    readonly line: number
    readonly message: string
    readonly snippet: string
    readonly type: string | undefined
  }
}

/**
 * Renders Mermaid `source` to SVG.
 *
 * @example
 * ```ts
 * import { render } from 'ondine'
 *
 * // Compiles the diagram to an SVG string.
 * const { svg } = render('flowchart LR\n  A --> B')
 * ```
 *
 * @throws {RenderError} When the type is unsupported, the source is invalid, or a limit is exceeded.
 */
export function render(source: string, options: render.Options = {}): render.ReturnType {
  // The compiler reads no clock. Like JSON, it reads a time that is not a number as none.
  const time = options.now ?? Date.now()
  const now = typeof time === 'number' ? time : Number.NaN

  try {
    // Rust strings hold no lone surrogates. Ondine's WebAssembly boundary encodes them as U+FFFD,
    // and so does this one.
    const result = Compiler.render(source.toWellFormed(), serialize(options), now)
    return {
      height: result.height,
      links: result.links,
      svg: result.svg,
      type: result.type,
      width: result.width,
    }
  } catch (error) {
    if (!(error instanceof Compiler.CompileError)) throw error
    throw new RenderError({
      code: error.code,
      column: error.column,
      line: error.line,
      message: error.message,
      snippet: error.snippet,
      type: error.type,
    })
  }
}

export declare namespace render {
  /** Rendering options. Every field is optional. */
  type Options = {
    /** Lets a diagram that runs across be drawn running down when it does not fit `maxWidth`. Defaults to `true`. */
    readonly autoDirection?: boolean | undefined
    /** The width under which `autoDirection` turns a diagram. Defaults to `640`. */
    readonly directionBreakpoint?: number | undefined
    /** Font size in pixels. Defaults to `16`. */
    readonly fontSize?: number | undefined
    /** Prefix for element IDs, to keep several diagrams on one page apart. */
    readonly idPrefix?: string | undefined
    /** Schemes an image may use besides a relative address. */
    readonly imageSchemes?: readonly string[] | undefined
    /** Whether images are drawn. Defaults to `true`. */
    readonly images?: boolean | undefined
    /** The most characters of source to accept. Defaults to `50000`. */
    readonly limit?: number | undefined
    /** The `rel` of links. Defaults to `noopener`; empty omits it. */
    readonly linkRel?: string | undefined
    /** Schemes a link may use besides a relative address. */
    readonly linkSchemes?: readonly string[] | undefined
    /** Whether links are drawn. Defaults to `true`. */
    readonly links?: boolean | undefined
    /** The most edges a flowchart may have. Defaults to `5000`. */
    readonly maxEdges?: number | undefined
    /** The width available to the diagram, in pixels. */
    readonly maxWidth?: number | undefined
    /** The time a gantt chart schedules against, in milliseconds since the epoch. Defaults to the current time. */
    readonly now?: number | undefined
    /** The most characters of SVG to produce. Defaults to `4000000`. */
    readonly outputLimit?: number | undefined
    /** Padding around the diagram, in pixels. Defaults to `8`. */
    readonly padding?: number | undefined
    /** Whether the SVG scales to its container. Defaults to `true`. */
    readonly responsive?: boolean | undefined
  }

  /** A rendered diagram. */
  type ReturnType = {
    /** Height in pixels. */
    readonly height: number
    /** Links in drawing order. */
    readonly links: readonly Link[]
    /** The SVG document. */
    readonly svg: string
    /** The detected diagram type. */
    readonly type: string
    /** Width in pixels. */
    readonly width: number
  }

  /** A link drawn in a diagram. */
  type Link = {
    /** The address. */
    readonly href: string
    /** The id of the element that carries the link. */
    readonly id: string
    /** Whether the address points inside the page. */
    readonly internal: boolean
  }
}

/**
 * Options as the compiler reads them, without the time, which is passed apart. Empty for none.
 * The compiler reads JSON so it treats ill-typed and non-finite values as Ondine does.
 */
function serialize(options: render.Options): string {
  for (const _ in options) return JSON.stringify({ ...options, now: undefined })
  return ''
}
