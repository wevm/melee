/** @module A square for a named icon. Port of Pele's `src/diagrams/common/icon.ts`. */
import { escText, pushNum } from '../../svg/builder.ts'
import { type IconResolver, iconMarkup } from '../../text/icons.ts'
import { buf } from '../../util/rust.ts'

/**
 * A square for icon `name` at (`x`, `y`), `side` wide, in the form labels use. The host's
 * resolver supplies the drawing, if any.
 */
export function iconSvg(
  name: string,
  x: number,
  y: number,
  side: number,
  icons: IconResolver | undefined,
): string {
  const out = buf('<svg class="ondine-icon" data-icon="')
  out.s += escText(name)
  out.s += '" x="'
  pushNum(out, x)
  out.s += '" y="'
  pushNum(out, y)
  out.s += '" width="'
  pushNum(out, side)
  out.s += '" height="'
  pushNum(out, side)
  out.s +=
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  out.s += iconMarkup(icons, name)
  out.s += '</svg>'
  return out.s
}
