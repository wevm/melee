/**
 * @module Packet diagrams: protocol fields drawn as rows of bits. Port of Pele's
 * `src/diagrams/packet/index.ts`.
 */
import type { Diagram, Input, Rendered } from '../diagrams.ts'
import type { RenderOptions } from '../svg/root.ts'
import type { UrlOptions } from '../util/url.ts'
import type { Value } from '../yaml.ts'
import { type PacketModel, buildPacket } from './packet/model.ts'
import { parsePacket } from './packet/parser.ts'
import { render } from './packet/render.ts'

/** The `packet` diagram type. */
export const DIAGRAM: Diagram = {
  keepComments: false,
  render: renderInput,
  section: undefined,
}

function renderInput(input: Input, options: RenderOptions, _url: UrlOptions): Rendered {
  const model = parse(input.source, input.config, input.title)
  return render(model, input.config, options)
}

/** The parsed packet diagram: Pele's `PacketModel`. */
export type Model = PacketModel

/**
 * Parses preprocessed packet `source`, as Pele's `packet.parse` does, with the `packet` section
 * of `config`. `title` comes from front matter.
 *
 * @throws {CompileError} A syntax error for input Mermaid rejects, and a semantic error for
 *   fields that do not follow each other or have no bits.
 */
export function parse(source: string, config: Value, title: string | undefined): Model {
  return buildPacket(parsePacket(source), config, title)
}
