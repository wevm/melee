/**
 * @module The Cynefin model: the declared domains with their items, and the transitions between
 * them. Port of Pele's `src/diagrams/cynefin/model.ts`.
 */
import { trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import type { CynefinAst } from './parser.ts'

/** A declared domain: Pele's `CynefinDomain`. */
export type CynefinDomain = {
  /** The item labels. */
  items: string[]
  /** The domain name. */
  name: string
}

/** A transition between two different domains: Pele's `CynefinTransition`. */
export type CynefinTransition = {
  /** The domain it leaves. */
  from: string
  /** The label, when it is not empty. */
  label: string | undefined
  /** The domain it enters. */
  to: string
}

/** A Cynefin diagram ready to draw: Pele's `CynefinModel`. */
export type CynefinModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** The domains the source declares, in first-declared order. All five are drawn either way. */
  domains: CynefinDomain[]
  /** The title. */
  title: string | undefined
  /** Transitions in authored order. */
  transitions: CynefinTransition[]
}

/** `CynefinModel::default()`. */
export function cynefinModelDefault(): CynefinModel {
  return { accDescr: undefined, accTitle: undefined, domains: [], title: undefined, transitions: [] }
}

/** The items declared for domain `name`. */
export function cynefinModelItems(self: CynefinModel, name: string): string[] {
  return self.domains.find((domain) => domain.name === name)?.items ?? []
}

/** `text.replace(/\n\s+/g, '\n')`. */
function dedentLines(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text.codePointAt(i) as number
    const step = c > 0xffff ? 2 : 1
    out += text.slice(i, i + step)
    i += step
    if (c === 0x0a) {
      while (i < n) {
        const next = text.codePointAt(i) as number
        if (!isSpace(next)) break
        i += next > 0xffff ? 2 : 1
      }
    }
  }
  return out
}

/** Builds the model from `ast`, as Pele's `buildCynefin` does. `title` comes from front matter. */
export function buildCynefin(ast: CynefinAst, title: string | undefined): CynefinModel {
  // A later block for a domain replaces an earlier one, which keeps its place.
  const domains: CynefinDomain[] = []
  for (const block of ast.domains) {
    const domain: CynefinDomain = { items: block.items, name: block.domain }
    const known = domains.findIndex((known) => known.name === domain.name)
    if (known >= 0) domains[known] = domain
    else domains.push(domain)
  }
  const transitions: CynefinTransition[] = ast.transitions
    .filter((transition) => transition.from !== transition.to)
    .map((transition) => ({
      from: transition.from,
      label: transition.label !== undefined && transition.label !== '' ? transition.label : undefined,
      to: transition.to,
    }))

  return {
    accDescr: ast.accDescr !== undefined && ast.accDescr !== '' ? dedentLines(ast.accDescr) : undefined,
    accTitle: ast.accTitle !== undefined && ast.accTitle !== '' ? trimStart(ast.accTitle) : undefined,
    domains,
    title: ast.title !== undefined && ast.title !== '' ? ast.title : title,
    transitions,
  }
}
