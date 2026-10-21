/** @module The info model built from the parsed diagram. Port of Pele's `src/diagrams/info/model.ts`. */
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import type { InfoAst } from './parser.ts'

/** An info diagram ready to draw: Pele's `InfoModel`. */
export type InfoModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** The title. */
  title: string | undefined
}

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 0x0a) {
      while (i < text.length && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/** Builds the model from `ast`, as Pele's `buildInfo` does. `title` comes from front matter. */
export function buildInfo(ast: InfoAst, title: string | undefined): InfoModel {
  const accDescr = ast.accDescr
  const accTitle = ast.accTitle
  return {
    accDescr: accDescr !== undefined && accDescr !== '' ? dedentLines(accDescr) : undefined,
    accTitle: accTitle !== undefined && accTitle !== '' ? trimStart(accTitle) : undefined,
    title: ast.title !== undefined && ast.title !== '' ? ast.title : title,
  }
}
