/**
 * @module Outlines for the icon names Mermaid's architecture diagrams know without an icon pack,
 * drawn on a 24 by 24 grid. Any other name is left to the host's icon resolver. Port of Pele's
 * `src/diagrams/architecture/icons.ts`.
 */

/** The path data of each built-in icon. */
const GLYPHS: readonly (readonly [string, string])[] = [
  ['cloud', 'M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z'],
  ['database', 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 6v12a8 3 0 0 0 16 0V6M4 12a8 3 0 0 0 16 0'],
  ['disk', 'M5 3h14v18H5zM12 6.5a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 10.5h.01M8 18h3'],
  ['internet', 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M12 3a13 13 0 0 0 0 18M12 3a13 13 0 0 1 0 18'],
  ['server', 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6'],
]

/** The markup of built-in icon `name`, or empty when there is none. */
export function builtinIcon(name: string): string {
  const glyph = GLYPHS.find(([key]) => key === name)
  if (glyph === undefined) return ''
  let out = '<path d="'
  out += glyph[1]
  out += '" stroke="var(--_fg)" stroke-width="1.5"/>'
  return out
}
