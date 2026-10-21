/**
 * @module Whether the first word of a box title is a color. Port of Pele's
 * `src/diagrams/sequence/colors.ts`.
 *
 * Mermaid asks the browser. Pele has no browser, so it knows the color keywords and the `rgb()` and
 * `hsl()` notations. Other functions, such as `calc()` and `var()`, are not recognized.
 */
import { trim } from '../../text/label.ts'
import { isDigit, isSpace } from '../../util/chars.ts'
import { eqIgnoreAsciiCase } from '../../util/rust.ts'

const KEYWORDS: readonly string[] = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'accentcolor',
  'accentcolortext',
  'activetext',
  'buttonborder',
  'buttonface',
  'buttontext',
  'canvas',
  'canvastext',
  'field',
  'fieldtext',
  'graytext',
  'highlight',
  'highlighttext',
  'linktext',
  'mark',
  'marktext',
  'selecteditem',
  'selecteditemtext',
  'visitedtext',
  'activeborder',
  'activecaption',
  'appworkspace',
  'background',
  'buttonhighlight',
  'buttonshadow',
  'captiontext',
  'inactiveborder',
  'inactivecaption',
  'inactivecaptiontext',
  'infobackground',
  'infotext',
  'menu',
  'menutext',
  'scrollbar',
  'threeddarkshadow',
  'threedface',
  'threedhighlight',
  'threedlightshadow',
  'threedshadow',
  'window',
  'windowframe',
  'windowtext',
]

/** What a term of a color function is. */
const K = {
  Bad: 'Bad',
  Number: 'Number',
  Percent: 'Percent',
  Angle: 'Angle',
  None: 'None',
} as const
type K = (typeof K)[keyof typeof K]

/** Pele's `/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(%|deg|grad|rad|turn)?$/i`. */
function kind(term: string): K {
  if (eqIgnoreAsciiCase(term, 'none')) return K.None
  const digits = (i: number): number | undefined => {
    const start = i
    while (i < term.length && isDigit(term.charCodeAt(i))) i += 1
    return i > start ? i : undefined
  }
  const first = term.charCodeAt(0)
  let i = first === 0x2b || first === 0x2d ? 1 : 0
  const end = digits(i)
  if (end !== undefined) {
    if (term.charCodeAt(end) === 0x2e) {
      const after = digits(end + 1)
      i = after !== undefined ? after : end
    } else {
      i = end
    }
  } else if (term.charCodeAt(i) === 0x2e) {
    const end = digits(i + 1)
    if (end === undefined) return K.Bad
    i = end
  } else {
    return K.Bad
  }
  const e = term.charCodeAt(i)
  if (e === 0x65 || e === 0x45) {
    let j = i + 1
    const sign = term.charCodeAt(j)
    if (sign === 0x2b || sign === 0x2d) j += 1
    const end = digits(j)
    if (end !== undefined) i = end
  }
  const unit = term.slice(i)
  if (unit === '') return K.Number
  if (unit === '%') return K.Percent
  if (['deg', 'grad', 'rad', 'turn'].some((u) => eqIgnoreAsciiCase(unit, u))) return K.Angle
  return K.Bad
}

function isAlpha(term: string, modern: boolean): boolean {
  const k = kind(term)
  return k === K.Number || k === K.Percent || (modern && k === K.None)
}

function isFunction(color: string): boolean {
  const hsl = color.startsWith('hsl')
  const open = color.indexOf('(')
  if (open < 0) return false
  const name = color.slice(0, open)
  if (name !== 'rgb' && name !== 'rgba' && name !== 'hsl' && name !== 'hsla') return false
  if (color.length > 120 || color.indexOf(')') !== color.length - 1) return false
  const inner = trim(color.slice(open + 1, color.length - 1))
  const legacy = inner.includes(',')
  let alpha: string | undefined
  let parts: string[]
  if (legacy) {
    parts = inner.split(',').map(trim)
    if (parts.length === 4) alpha = parts.pop()
  } else {
    const slash = inner.split('/')
    if (slash.length > 2) return false
    const after = slash[1]
    if (after !== undefined) alpha = trim(after)
    parts = splitSpace(trim(slash[0] ?? ''))
  }
  if (parts.length !== 3 || (alpha !== undefined && !isAlpha(alpha, !legacy))) return false
  const kinds = parts.map((part) => kind(part))
  const [k0, k1, k2] = kinds
  if (k0 === undefined || k1 === undefined || k2 === undefined) return false
  if (legacy) {
    if (hsl) return (k0 === K.Number || k0 === K.Angle) && k1 === K.Percent && k2 === K.Percent
    return (k0 === K.Number || k0 === K.Percent) && k1 === k0 && k2 === k0
  }
  return kinds.every(
    (k, i) => k === K.Number || k === K.None || (hsl && i === 0 ? k === K.Angle : k === K.Percent),
  )
}

/** JavaScript's `text.split(/\s+/)`. */
function splitSpace(text: string): string[] {
  const parts: string[] = []
  let start = 0
  let at = 0
  while (at < text.length) {
    const c = text.charCodeAt(at)
    if (isSpace(c)) {
      parts.push(text.slice(start, at))
      let end = at + 1
      while (end < text.length && isSpace(text.charCodeAt(end))) end += 1
      start = end
      at = end
    } else {
      at += 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** Whether a browser would take `color` as a CSS color. */
export function isCssColor(color: string): boolean {
  if (color.includes('(')) return isFunction(color)
  return KEYWORDS.some((keyword) => eqIgnoreAsciiCase(keyword, color))
}
