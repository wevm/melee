/**
 * @module Draws an info diagram: the title and the library version. Port of Pele's
 * `src/diagrams/info/render.ts`.
 */
import type { Rendered } from '../../diagrams.ts'
import { labelSvg } from '../../svg/builder.ts'
import { type RenderOptions, svgDocument } from '../../svg/root.ts'
import { layoutLabel } from '../../text/label.ts'
import { BOLD } from '../../text/measure.ts'
import { fmax } from '../../util/rust.ts'
import type { InfoModel } from './model.ts'

/** The text drawn under the title. Pele draws its own name and version, so this names Ondine's. */
const VERSION = 'Ondine v0.0.0'

/** Draws `model`. */
export function render(model: InfoModel, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16
  const pad = options.padding ?? 8

  const title = layoutLabel(model.title, false, size, 4000, BOLD, undefined)
  const titleHeight = title.height > 0 ? title.height + 8 : 0
  const text = layoutLabel(VERSION, false, size, 4000, 0, undefined)

  const width = Math.ceil(fmax(title.width, text.width) + 2 * pad)
  const height = Math.ceil(titleHeight + text.height + 2 * pad)
  let content = labelSvg(
    title,
    width / 2,
    pad + title.height / 2,
    ' class="ondine-title" font-weight="var(--_tw)"',
    undefined,
  )
  content += labelSvg(
    text,
    width / 2,
    pad + titleHeight + text.height / 2,
    ' class="ondine-version" fill="var(--_m)"',
    undefined,
  )

  const svg = svgDocument(
    'info',
    width,
    height,
    size,
    options,
    { accDescr: model.accDescr, accTitle: model.accTitle },
    content,
  )
  return { height, links: [], svg, width }
}
