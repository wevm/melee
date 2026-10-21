/** @module A diagram title above its content. Port of Pele's `src/svg/title.ts`. */
import { labelSvg, pushNum } from './builder.ts'
import { layoutLabel } from '../text/label.ts'
import { BOLD } from '../text/measure.ts'
import { buf, fmax } from '../util/rust.ts'

/** Content with a title placed above it, and the size of both together. */
export type Titled = {
  /** The SVG content. */
  content: string
  /** Height of the whole. */
  height: number
  /** Width of the whole. */
  width: number
}

/** Empty content of no size. */
export function titledDefault(): Titled {
  return { content: '', height: 0, width: 0 }
}

/**
 * Puts a bold `title` at font `size` above content of `width` by `height` that was laid out
 * without one, `pad` from the top. Without a title, the content is returned as it is.
 */
export function withTitle(
  title: string | undefined,
  size: number,
  pad: number,
  width: number,
  height: number,
  content: string,
): Titled {
  const label = layoutLabel(title, false, size, 4000, BOLD, undefined)
  if (label.height === 0) return { content, height, width }

  const shift = label.height + 12
  const full = fmax(width, Math.ceil(label.width + 2 * pad))
  const out = buf(
    labelSvg(label, full / 2, pad + label.height / 2, ' class="ondine-title" font-weight="var(--_tw)"', undefined),
  )
  out.s += '<g transform="translate('
  pushNum(out, (full - width) / 2)
  out.s += ','
  pushNum(out, shift)
  out.s += ')">'
  out.s += content
  out.s += '</g>'
  return { content: out.s, height: Math.ceil(height + shift), width: full }
}
