/**
 * @module Picks the diagram type from preprocessed source with Mermaid's detectors. Port of Pele's
 * `src/detect.ts`.
 */
import { isSpace, isWord } from './util/chars.ts'
import { eqIgnoreAsciiCase } from './util/rust.ts'

function space(c: number): boolean {
  return isSpace(c)
}

/** Whether `s` starts with `prefix` at `at`, ignoring ASCII case as a non-Unicode `/i` pattern does. */
function startsIgnoreCase(s: string, prefix: string, at: number): boolean {
  return s.length - at >= prefix.length && eqIgnoreAsciiCase(s.slice(at, at + prefix.length), prefix)
}

/** Whether `\b` holds after the ASCII prefix that ends at `at`. */
function boundary(s: string, at: number): boolean {
  return at >= s.length || !isWord(s.codePointAt(at) as number)
}

/** Whether the character at `at` is whitespace or `extra`, or the text ends there. */
function endsOr(s: string, at: number, extra: string): boolean {
  if (at >= s.length) return true
  const c = s.codePointAt(at) as number
  return space(c) || String.fromCodePoint(c) === extra
}

/** The C4 diagram names Mermaid finds anywhere in the text, all starting with `C4`. */
const C4_ANYWHERE: readonly string[] = ['C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']

/** Whether `text` contains one of {@link C4_ANYWHERE}. */
function hasC4(text: string): boolean {
  for (let at = text.indexOf('C4'); at >= 0; at = text.indexOf('C4', at + 1)) {
    for (const name of C4_ANYWHERE) if (text.startsWith(name, at)) return true
  }
  return false
}

/** Prefixes tried after the C4 detector, in order, with their types. */
const FIRST: readonly (readonly [string, string])[] = [
  ['kanban', 'kanban'],
  ['classDiagram', 'class'],
  ['erDiagram', 'er'],
  ['gantt', 'gantt'],
  ['info', 'info'],
  ['pie', 'pie'],
  ['requirement', 'requirement'],
  ['sequenceDiagram', 'sequence'],
]

/** Prefixes tried after the swimlane detector, in order, with their types. */
const SECOND: readonly (readonly [string, string])[] = [
  ['graph', 'flowchart'],
  ['flowchart', 'flowchart'],
  ['timeline', 'timeline'],
  ['gitGraph', 'gitGraph'],
  ['stateDiagram', 'state'],
  ['journey', 'journey'],
  ['quadrantChart', 'quadrantChart'],
  ['sankey', 'sankey'],
  ['packet', 'packet'],
  ['xychart', 'xychart'],
  ['block', 'block'],
  ['eventmodeling', 'eventmodeling'],
  ['treeView-beta', 'treeView'],
  ['radar-beta', 'radar'],
]

const RAILROAD_TAILS: readonly string[] = ['beta', 'ebnf-beta', 'abnf-beta', 'peg-beta']

/**
 * Returns the diagram type, using Pele's type names, or `undefined` when no detector matches.
 * Detectors run in the order Mermaid registers them, and the first match wins.
 */
export function detect(cleaned: string): string | undefined {
  // Every detector but one anchors at `^\s*`. `s` is the text from `start`.
  let start = 0
  while (start < cleaned.length && space(cleaned.charCodeAt(start))) start++
  const s = cleaned
  // A prefix can only match where its first character is.
  const first = s.charCodeAt(start)
  const starts = (prefix: string): boolean => prefix.charCodeAt(0) === first && s.startsWith(prefix, start)

  if (starts('flowchart-elk')) return 'flowchart'
  if (starts('mindmap')) return 'mindmap'
  if (starts('architecture')) return 'architecture'
  if (starts('agentflow-beta') && boundary(s, start + 14)) return 'agentflow'
  // Mermaid's pattern anchors only its first alternative, so the others match anywhere.
  if (starts('C4Context') || hasC4(cleaned)) return 'c4'

  for (const [prefix, type] of FIRST) if (starts(prefix)) return type
  if (starts('swimlane-beta') && boundary(s, start + 13)) return 'swimlane'

  for (const [prefix, type] of SECOND) if (starts(prefix)) return type
  // `ishikawa(-beta)?\b` backtracks to `ishikawa\b` when `-beta` is not followed by a boundary.
  if (startsIgnoreCase(s, 'ishikawa', start) && boundary(s, start + 8)) return 'ishikawa'
  if (starts('treemap')) return 'treemap'
  if (startsIgnoreCase(s, 'railroad-', start)) {
    const rest = start + 9
    if (RAILROAD_TAILS.some((tail) => startsIgnoreCase(s, tail, rest))) return 'railroad'
  }
  if (starts('venn-beta')) return 'venn'
  if (startsIgnoreCase(s, 'wardley-beta', start)) return 'wardley'
  if (starts('cynefin-beta') && endsOr(s, start + 12, ':')) return 'cynefin'
  if (starts('usecase-beta') && endsOr(s, start + 12, ' ')) return 'usecase'
  return undefined
}
