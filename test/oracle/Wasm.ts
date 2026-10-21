/** @module Instantiates an Ondine WebAssembly module and decodes its length-prefixed results. Copied from wevm/ondine (MIT) to record oracle outputs. */
/// <reference lib="dom" />

/** A compiled diagram module. */
export type Instance = {
  /**
   * Renders `source` with JSON `options`, or empty for defaults, at `now` in milliseconds since
   * the epoch, returning the decoded result.
   */
  readonly render: (source: string, options: string, now: number) => Result
}

/** A decoded result from the module's `render` export. */
export type Result =
  | {
      readonly height: number
      readonly links: readonly Link[]
      readonly ok: true
      readonly svg: string
      readonly type: string
      readonly width: number
    }
  | {
      readonly code: string
      readonly column: number
      readonly line: number
      readonly message: string
      readonly ok: false
      readonly snippet: string
      readonly type: string | undefined
    }

/** A link drawn in a diagram. */
export type Link = {
  readonly href: string
  readonly id: string
  readonly internal: boolean
}

type Exports = {
  readonly alloc: (len: number) => number
  readonly memory: WebAssembly.Memory
  readonly render: (
    source: number,
    sourceLen: number,
    options: number,
    optionsLen: number,
    now: number,
  ) => number
  readonly reset: () => void
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/**
 * Instantiates a diagram module and returns its render function.
 *
 * Base64 bytes compile synchronously. Hosts that disallow runtime compilation, such as
 * Cloudflare Workers, pass a module their bundler compiled ahead of time.
 */
export function instantiate(input: string | WebAssembly.Module): Instance {
  const module = typeof input === 'string' ? new WebAssembly.Module(bytes(input)) : input
  const exports = new WebAssembly.Instance(module, {}).exports as unknown as Exports
  const reader = read(exports.memory)

  // Growth detaches the old buffer, which empties views of it, so the views are renewed after
  // every call that may allocate.
  const fresh = () => {
    if (reader.bytes.byteLength === 0) Object.assign(reader, read(exports.memory))
    return reader
  }

  // Encodes `text` straight into linear memory at `at` and returns its length in bytes. A UTF-16
  // unit takes at most three UTF-8 bytes.
  const write = (text: string, at: number) =>
    text === ''
      ? 0
      : encoder.encodeInto(text, reader.bytes.subarray(at, at + text.length * 3)).written

  return {
    render(source, options, now) {
      exports.reset()

      // Source and options share one allocation.
      const sourceAt = exports.alloc((source.length + options.length) * 3)
      fresh()
      const sourceLength = write(source, sourceAt)
      const optionsAt = sourceAt + sourceLength
      const optionsLength = write(options, optionsAt)

      const at = exports.render(sourceAt, sourceLength, optionsAt, optionsLength, now)
      fresh().at = at
      return decode(reader)
    },
  }
}

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Views of linear memory and a cursor into it. */
type Reader = { at: number; bytes: Uint8Array; view: DataView }

function read(memory: WebAssembly.Memory): Reader {
  return { at: 0, bytes: new Uint8Array(memory.buffer), view: new DataView(memory.buffer) }
}

/**
 * Decodes the result at the reader's cursor: a status byte, then fields that are each a
 * little-endian `u32` length and its bytes.
 */
function decode(reader: Reader): Result {
  const status = reader.bytes[reader.at++]

  if (status === 1) {
    const code = text(reader)
    const type = text(reader)
    const line = reader.view.getUint32(field(reader), true)
    const column = reader.view.getUint32(field(reader), true)
    const snippet = text(reader)
    const message = text(reader)

    return { code, column, line, message, ok: false, snippet, type: type || undefined }
  }

  const type = text(reader)
  const width = reader.view.getFloat64(field(reader), true)
  const height = reader.view.getFloat64(field(reader), true)
  const count = reader.view.getUint32(field(reader), true)
  const links: Link[] = []
  for (let i = 0; i < count; i++)
    links.push({
      href: text(reader),
      id: text(reader),
      internal: reader.bytes[field(reader)] === 1,
    })
  const svg = text(reader)

  return { height, links, ok: true, svg, type, width }
}

/** Skips the next field and returns where its bytes start. */
function field(reader: Reader): number {
  const length = reader.view.getUint32(reader.at, true)
  reader.at += 4 + length
  return reader.at - length
}

/** Reads the next field as UTF-8 text. */
function text(reader: Reader): string {
  const start = field(reader)
  return start === reader.at ? '' : decoder.decode(reader.bytes.subarray(start, reader.at))
}
