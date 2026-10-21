/** @module The pie model built from the parsed chart. Port of Pele's `src/diagrams/pie/model.ts`. */
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { buf } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'
import type { PieAst } from './parser.ts'

/** A pie chart ready to draw: Pele's `PieModel`. */
export type PieModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** Slices by label in first-seen order. A repeated label keeps its first value. */
  sections: [string, number][]
  /** Whether the legend shows values. */
  showData: boolean
  /** The title. */
  title: string | undefined
}

/** `PieModel::default()`. */
export function pieModelDefault(): PieModel {
  return { accDescr: undefined, accTitle: undefined, sections: [], showData: false, title: undefined }
}

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 0x0a) {
      while (i < n && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/** The error for a slice with a negative value. */
function negative(label: string, value: number): CompileError {
  const message = buf('"')
  message.s += label
  message.s += '" has invalid value: '
  pushNumber(message, value)
  message.s += '. Negative values are not allowed in pie charts. All slice values must be >= 0.'
  const error = errorNew(Code.Semantic, message.s)
  error.type = 'pie'
  return error
}

/**
 * Builds the model from `ast`, as Pele's `buildPie` does. `title` comes from front matter.
 *
 * Throws a semantic error for a negative slice.
 */
export function buildPie(ast: PieAst, title: string | undefined): PieModel {
  const seen = new Set<string>()
  const sections: [string, number][] = []
  for (const section of ast.sections) {
    if (section.value < 0) throw negative(section.label, section.value)
    if (!seen.has(section.label)) {
      seen.add(section.label)
      sections.push([section.label, section.value])
    }
  }

  const accDescr = ast.accDescr
  const accTitle = ast.accTitle
  const ownTitle = ast.title
  return {
    accDescr: accDescr !== undefined && accDescr !== '' ? dedentLines(accDescr) : undefined,
    accTitle: accTitle !== undefined && accTitle !== '' ? trimStart(accTitle) : undefined,
    sections,
    showData: ast.showData,
    title: ownTitle !== undefined && ownTitle !== '' ? ownTitle : title,
  }
}
